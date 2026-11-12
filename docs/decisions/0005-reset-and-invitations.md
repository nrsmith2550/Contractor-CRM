# 0005 — Password reset and invitations

- **Reset links:** 256-bit random token, only its sha256 stored, 30-minute expiry, single use. A
  new request invalidates the previous link. The link is consumed with an atomic
  `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`, so two simultaneous submissions
  produce exactly one winner (covered by a race test). A weak or mismatched password is rejected
  _before_ the link is spent. Success signs out every session for that user.
- **No account enumeration:** "forgot password" returns the same answer, and the page the same
  message, for known, unknown, disabled and suspended accounts, and also when the email provider
  fails (that is only logged). It is rate-limited per IP and per hashed address. Known limitation:
  the known-user path does a little more work, so a very precise timing attack could distinguish
  them; the rate limits bound how many probes are possible.
- **Pre-login lookups** for reset and invitation tokens use two more narrow `SECURITY DEFINER`
  functions (`auth_find_reset_token`, `auth_find_invitation`), like sign-in, because the visitor has
  no tenant yet.
- **Invitations:** 7-day, single-use, hashed token, emailed before commit (a failed send stores
  nothing). Seats: active users + pending invitations must stay within the license `seat_limit`, so
  the "Upgrade your license" refusal happens when inviting, and it is re-checked inside the
  accept transaction (the license may have shrunk). Revoking or disabling a user frees a seat. A
  newer invitation to the same address replaces the older one.
- **Invitee email is auto-verified** because opening the emailed link proves control of the address.
- **Same wording for "address already registered"** whether the account is in this business or
  another one, so an inviter learns nothing about other businesses (emails are unique platform-wide,
  see ADR 0002).
- **Users page** (`/app/settings/users`) is the first settings screen: it shows seats in use, the
  user list, pending invitations (with revoke) and the invite form. Every action runs
  auth → `can()` → domain. A Salesperson can't open it.
- **Mail transport:** `EMAIL_DEV_DIR` is an explicit file transport (development and the end-to-end
  tests, which run a production build). Production still refuses to send with neither a provider key
  nor that directory, so a license key or link can never be silently lost. Leave `EMAIL_DEV_DIR` unset
  in production.
- **Server errors are shown once**, as a banner, not also as a field message, so screen readers
  don't announce a refusal twice.
