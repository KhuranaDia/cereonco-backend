---
name: Email link host allowlist
description: Why email action links resolve their host via an Origin allowlist, not a raw Origin/Host header
---

# Email action link host resolution

All email action links (password setup, forgot-password reset, future auth
emails) build their host through the single reusable resolver
`getFrontendBaseUrl(req)` in `artifacts/api-server/src/utils/email.ts`. Do not
duplicate this logic — new email flows must call it.

Resolution order: (1) request `Origin` header **only if it matches the
allowlist**, (2) `FRONTEND_URL`, (3) `TEST_FRONTEND_URL`, (4)
`http://localhost:5173`. Allowlist = `FRONTEND_URL` + `TEST_FRONTEND_URL` +
`ALLOWED_FRONTEND_ORIGINS` (comma-separated) + the localhost dev default.

**Why:** a token-bearing reset/setup link whose host comes from an unvalidated
request header is an account-takeover vector (Origin/Host-header poisoning): an
attacker POSTs `/auth/forgot-password` with a victim's email and a forged
`Origin`, and the victim receives a real reset token on an attacker-controlled
domain. The product spec asked to "trust the Origin if present"; the allowlist
keeps that behavior for legitimate frontends (e.g. localhost:5173) while
refusing arbitrary origins. Request-body input is NEVER consulted for the host.

**How to apply:** to honor a new production frontend origin, add it to
`FRONTEND_URL` or `ALLOWED_FRONTEND_ORIGINS` — otherwise its `Origin` is ignored
and links fall back to the configured default. Setup links use `/set-password`,
reset links use `/reset-password`, but both still complete via the same
`POST /auth/set-password` backend endpoint.
