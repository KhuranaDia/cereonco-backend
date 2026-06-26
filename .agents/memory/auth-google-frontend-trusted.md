---
name: /auth/google is frontend-trusted by design
description: Why POST /auth/google trusts a raw client profile and the known takeover risk
---

# /auth/google trusts a raw client-supplied Google profile

`POST /auth/google` accepts a Google profile JSON straight from the frontend
(`sub` required; `email`/`name`/`picture` optional), looks the user up by email
then `googleSub`, creates the account if missing, and returns a JWT.

**Why:** This was explicitly requested as a "frontend-trusted" flow. It is NOT
an oversight — do not silently replace it with server-side ID-token verification
unless the user asks.

**Known risk (documented as SECURITY/TODO in the route + docs/README.md):**
email-first lookup means a caller can POST a victim's email + arbitrary `sub`
and receive a valid token = account takeover. Hardening path when approved:
verify a Google **ID token** server-side (`google-auth-library verifyIdToken`),
trust only claims from that token, and reject mismatched `sub` for an already
linked account.

**How to apply:** If asked to "secure" or "harden" Google login, implement the
ID-token verification above. Otherwise leave the frontend-trusted contract intact.
