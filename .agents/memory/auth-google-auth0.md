---
name: /auth/google verifies an Auth0 access token
description: POST /auth/google trusts only the Auth0 /userinfo profile, never a raw client payload
---

# /auth/google verifies an Auth0 access token server-side

`POST /auth/google` accepts `{ accessToken }` (an Auth0 access token the frontend
obtained after Auth0 login, where Auth0 can broker Google). The server calls the
tenant's OIDC `/userinfo` endpoint with that bearer token; a non-2xx response
means the token is invalid/expired. It then trusts ONLY the profile Auth0 returns
(`sub`, `email`, `email_verified`, `name`, `picture`, …), reusing the existing
lookup-by-email-then-`googleSub`, create-if-missing, `emailVerified=true`,
placeholder-email (`${sanitizedSub}@google.local`) logic, and returns the same
`{ token, user }` payload as `POST /auth/login`.

**Why:** Replaces the older "frontend-trusted raw profile" contract (which had a
known account-takeover risk: a caller could POST a victim's email + arbitrary
`sub`). Verifying the token server-side removes that risk — the profile can no
longer be forged by the client. This was explicitly requested.

**Config:** requires `AUTH0_DOMAIN` (e.g. `your-tenant.auth0.com`) — non-secret
config; the access token is the client's credential. Not a Replit integration.

**Errors:** missing `accessToken` → 400; invalid/expired token → 401;
`AUTH0_DOMAIN` unset → 503 (verification helper throws `Auth0NotConfiguredError`).

**How to apply:** verification lives in `utils/auth0.ts`
(`verifyAuth0AccessToken`, `auth0Configured`, `Auth0NotConfiguredError`). Do not
reintroduce a raw-profile path. If switching IdPs, swap the `/userinfo` call but
keep trusting only token-derived claims.
