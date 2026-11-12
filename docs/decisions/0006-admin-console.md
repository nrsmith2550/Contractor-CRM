# 0006 — Platform admin console

- **Separate identity.** Platform admins live in `platform_admin`, never in a tenant. Their cookie
  (`crm_admin`) is a different name, scoped to `/admin`, and SameSite=Strict, so a tenant session can
  never act as an admin session and a cross-site request never carries it. Tested both ways.
- **Mandatory two-factor, in two stages.** The password creates a short-lived (10 minute) _pending_
  session; only a valid one-time code turns it into a full session (8 hours, absolute, not sliding).
  An admin without an enrolled authenticator can never sign in. A password alone, or a pending cookie
  alone, reaches nothing (the console redirects back to the code step).
- **TOTP is implemented directly** (RFC 6238, HMAC-SHA1, 6 digits, 30 s, ±1 step) and checked against
  the RFC's published test vectors, rather than adding a dependency for ~40 lines. An accepted code is
  burned: `platform_admin.totp_last_step` is advanced with an atomic conditional `UPDATE`, so replaying
  a code, or two simultaneous submissions of one code, can succeed at most once.
- **Secrets at rest.** The authenticator secret is encrypted with AES-256-GCM (random IV, versioned
  format) under `ADMIN_TOTP_KEY` (32 random bytes, base64, environment only), so a database leak alone
  does not hand out anyone's second factor. Admin passwords are argon2id.
- **Throttling.** Password attempts per IP and per hashed email, and code attempts per admin and per IP
  (5 per 15 minutes each), so a distributed guess is still capped per account.
- **Optional IP allowlist** (`ADMIN_IP_ALLOWLIST`, IPs and IPv4 CIDRs). A blocked caller gets a plain 404. It is an extra layer, never a replacement for the password and code.
- **Every action needs a written reason and writes an immutable `admin_audit_log` row in the same
  transaction** (who, what, target, why, IP). The log is append-only for the app role (trigger +
  revoked privileges). Temporary passwords, license keys and TOTP secrets never appear in it.
- **Owner recovery** (each signs the owner out): send a reset link (default); issue a temporary
  password, returned to the admin once, never stored or logged, with `must_change_password`; change the
  owner email (the old and new address are both notified; the email is sent before commit so a failed
  send changes nothing); and re-activate as a last resort.
- **Re-activate** returns the license to `issued` while keeping its `tenant_id`; the previous owner is
  disabled and their address renamed (`name+former-<id>@domain`) so the address can be reused. The
  ordinary activation page then reuses the tenant (no new roles or sequences, original `activated_at`
  kept) and creates only the new owner. Everyone is signed out until the key is claimed again.
- **Admins act through the app role**, one tenant at a time, by pinning the tenant for each operation.
  There is no cross-tenant read path. The businesses list therefore does one small query per business
  (capped at 100); a definer function can replace that if it ever matters.
- **Bootstrap:** `pnpm admin:create` (prints the authenticator secret once; use `read -rs` for the
  password) and `pnpm license:mint` for CLI-minted keys, which are audited too.
