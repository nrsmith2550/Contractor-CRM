#!/usr/bin/env bash
# Takes a full backup of one database and PROVES it works: the dump is restored into a scratch
# database and every table's row count is compared with the source. A backup nobody has restored
# is only a hope, so the nightly job runs this before it keeps anything.
#
#   SOURCE_URL   the database to back up (use the direct, non-pooled connection, owner role)
#   VERIFY_URL   an EMPTY scratch database to restore into (it is wiped first)
#   OUT          where to write the dump (custom format), e.g. backup.dump
#
# VERIFY_URL is wiped, so this refuses to run if it is the same database as SOURCE_URL or if it
# already holds a business's data. For a local re-run into the same scratch database, set
# VERIFY_ALLOW_WIPE=1.
#
# The source must not be changing while this runs, or the counts can differ by a few rows: point it
# at a frozen copy (the nightly job uses a fresh Neon branch).
set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL is not set}"
: "${VERIFY_URL:?VERIFY_URL is not set}"
: "${OUT:?OUT is not set}"

# Same server and database name = same database, whatever the user, password or options.
target() { printf '%s' "$1" | sed -E 's#^[a-z]+://([^@/]*@)?([^/?]+)/([^?]*).*#\2/\3#'; }
if [ "$(target "$SOURCE_URL")" = "$(target "$VERIFY_URL")" ]; then
  echo "REFUSING: VERIFY_URL and SOURCE_URL are the same database. The scratch database is wiped." >&2
  exit 2
fi
has_data=$(psql "$VERIFY_URL" -At -c "select case when to_regclass('public.tenant') is not null then (select count(*) from public.tenant) else 0 end" 2>/dev/null || echo 0)
if [ "${has_data:-0}" != "0" ] && [ "${VERIFY_ALLOW_WIPE:-}" != "1" ]; then
  echo "REFUSING: the scratch database already holds $has_data business(es). It is wiped first; if that is really a scratch copy, set VERIFY_ALLOW_WIPE=1." >&2
  exit 2
fi

# One row per table: "schema.table<TAB>count", for every ordinary table outside the system schemas.
COUNT_SQL="
select table_schema || '.' || table_name || E'\t' ||
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and table_schema not in ('pg_catalog', 'information_schema')
 order by 1"

echo "Dumping the source database..."
pg_dump --format=custom --no-owner --no-privileges --file "$OUT" "$SOURCE_URL"
pg_restore --list "$OUT" > /dev/null   # the file is a readable archive
echo "Dump written: $(wc -c < "$OUT") bytes"

echo "Preparing the scratch database..."
# Roles named in row-level-security policies must exist for the policies to restore.
psql "$VERIFY_URL" -q -c "create role crm_app nologin" >/dev/null 2>&1 || true
psql "$VERIFY_URL" -v ON_ERROR_STOP=1 -q -c "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;"

echo "Restoring into the scratch database..."
# Not --exit-on-error: platform-specific extras can fail harmlessly. The row counts below are the proof.
pg_restore --no-owner --no-privileges --dbname "$VERIFY_URL" "$OUT" 2> restore-warnings.txt || true
echo "Restore warnings: $(grep -c . restore-warnings.txt || true) lines (see restore-warnings.txt)"

echo "Comparing every table..."
psql "$SOURCE_URL" -At -c "$COUNT_SQL" > counts-source.txt
psql "$VERIFY_URL" -At -c "$COUNT_SQL" > counts-restored.txt
TABLES=$(wc -l < counts-source.txt)
if [ "$TABLES" -lt 10 ]; then
  echo "FAILED: only $TABLES tables found in the source; that does not look like the app's database." >&2
  exit 1
fi
if ! diff counts-source.txt counts-restored.txt; then
  echo "FAILED: the restored copy does not match the source (differences above)." >&2
  exit 1
fi
ROWS=$(awk -F'\t' '{s+=$2} END {print s+0}' counts-source.txt)
echo "OK: $TABLES tables and $ROWS rows restored and matched exactly."
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Backup verified"
    echo "- Tables: $TABLES"
    echo "- Rows: $ROWS"
    echo "- Dump size: $(wc -c < "$OUT") bytes"
  } >> "$GITHUB_STEP_SUMMARY"
fi
