-- Applied after migrations by scripts/apply-rls.ts, as the OWNER role. Idempotent.
-- Placeholders substituted by the script: {{APP_ROLE}} (quoted identifier) and
-- {{TENANT_TABLES}} (SQL array literal built from src/db/tenant-tables.ts).
--
-- Tables are NOT `FORCE ROW LEVEL SECURITY`: the owner (migrations, SECURITY DEFINER
-- functions below) bypasses policies, while the restricted app role is always subject to them.

-- ---------------------------------------------------------------------------
-- Privileges for the restricted app role
-- ---------------------------------------------------------------------------
grant usage on schema public to {{APP_ROLE}};
grant select, insert, update, delete on all tables in schema public to {{APP_ROLE}};
grant usage, select on all sequences in schema public to {{APP_ROLE}};
alter default privileges in schema public
  grant select, insert, update, delete on tables to {{APP_ROLE}};
alter default privileges in schema public grant usage, select on sequences to {{APP_ROLE}};

-- ---------------------------------------------------------------------------
-- Admin audit log is append-only
-- ---------------------------------------------------------------------------
revoke update, delete, truncate on admin_audit_log from {{APP_ROLE}};

create or replace function reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end
$$;

drop trigger if exists admin_audit_log_immutable on admin_audit_log;
create trigger admin_audit_log_immutable
  before update or delete on admin_audit_log
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------------
-- Row-Level Security: tenant_id must equal the transaction's app.tenant_id setting.
-- With no setting (or an empty one) no rows are visible or writable.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array {{TENANT_TABLES}} loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Pre-authentication lookups. Sign-in happens before the tenant is known, so these narrow
-- SECURITY DEFINER functions (running as the owner, which bypasses RLS) are the only way
-- the app role can resolve a user / session across tenants. They return one row at most
-- and never expose more columns than sign-in needs.
-- ---------------------------------------------------------------------------
create or replace function auth_find_user_by_email(p_email text)
returns table (
  user_id uuid, tenant_id uuid, password_hash text, must_change_password boolean,
  disabled_at timestamptz, is_owner boolean, license_status text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.tenant_id, u.password_hash, u.must_change_password, u.disabled_at,
         u.is_owner, l.status::text
    from "system_user" u
    left join license l on l.tenant_id = u.tenant_id
   where lower(u.email) = lower(p_email)
   limit 1
$$;

create or replace function auth_find_session(p_token_hash text)
returns table (
  session_id uuid, user_id uuid, tenant_id uuid, expires_at timestamptz,
  must_change_password boolean, disabled_at timestamptz, is_owner boolean,
  license_status text, email text, full_name text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.user_id, s.tenant_id, s.expires_at, u.must_change_password, u.disabled_at,
         u.is_owner, l.status::text, u.email, u.full_name
    from session s
    join "system_user" u on u.id = s.user_id
    left join license l on l.tenant_id = s.tenant_id
   where s.token_hash = p_token_hash
   limit 1
$$;

-- Password-reset links are used while signed out, so the token must resolve to its tenant.
create or replace function auth_find_reset_token(p_token_hash text)
returns table (
  token_id uuid, tenant_id uuid, user_id uuid, expires_at timestamptz, used_at timestamptz,
  email text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.tenant_id, t.user_id, t.expires_at, t.used_at, u.email
    from password_reset_token t
    join "system_user" u on u.id = t.user_id
   where t.token_hash = p_token_hash
   limit 1
$$;

-- Invitation links are opened by someone who has no account yet.
create or replace function auth_find_invitation(p_token_hash text)
returns table (
  invitation_id uuid, tenant_id uuid, email text, role_id uuid, expires_at timestamptz,
  accepted_at timestamptz, tenant_name text, seat_limit integer, license_status text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.tenant_id, i.email, i.role_id, i.expires_at, i.accepted_at, t.name,
         l.seat_limit, l.status::text
    from invitation i
    join tenant t on t.id = i.tenant_id
    left join license l on l.tenant_id = i.tenant_id
   where i.token_hash = p_token_hash
   limit 1
$$;

revoke all on function auth_find_user_by_email(text) from public;
revoke all on function auth_find_session(text) from public;
revoke all on function auth_find_reset_token(text) from public;
revoke all on function auth_find_invitation(text) from public;
grant execute on function auth_find_user_by_email(text) to {{APP_ROLE}};
grant execute on function auth_find_session(text) to {{APP_ROLE}};
grant execute on function auth_find_reset_token(text) to {{APP_ROLE}};
grant execute on function auth_find_invitation(text) to {{APP_ROLE}};
