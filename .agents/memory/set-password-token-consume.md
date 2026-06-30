---
name: set-password single-use token consumption
description: How POST /auth/set-password distinguishes invalid vs already-used vs expired tokens and consumes them atomically.
---

# set-password token consumption (setup + reset share one endpoint)

`POST /auth/set-password` serves BOTH passwordless registration setup AND the
forgot-password reset flow (both mint the same SHA-256-hashed, expiry-bearing
single-use token stored on `users.passwordSetupToken` / `passwordSetupTokenExpiresAt`).

## The three differentiated outcomes
- no row matches the token hash → `400 "Invalid password reset token."`
- row found, expiry IS NULL → `400 "This reset link has already been used."`
- row found, expiry in the past → `410 "Reset link has expired."`
- success → `{ token, user }` + `"Password updated successfully."`

## Key decision: keep the hash, null only the expiry on consume
**Rule:** on successful set-password, KEEP `passwordSetupToken` (the SHA-256 hash)
and null only `passwordSetupTokenExpiresAt`. Do NOT null the hash.

**Why:** nulling the hash would make a replayed link look identical to a token
that never existed → you could only ever return a generic "invalid". Retaining
the (one-way) hash lets a replay match a row whose expiry is null → reported as
"already used". No schema migration needed. The token still can't authenticate
because every accept path requires a non-null, future expiry.

**How to apply:** if you ever add a `usedAt` column or change the consume step,
preserve the ability to match a consumed token by its hash, or you lose the
already-used signal. A NEW forgot-password overwrites hash+expiry, so an old
consumed token may then read as "invalid" — that's expected.

## Consume atomically (race safety)
The consuming UPDATE re-checks hash + `isNotNull(expiry)` + `gt(expiry, now)` in
its WHERE clause and treats a zero-row result as "already used". This stops two
concurrent requests with the same token from both succeeding (the read-then-write
checks above are not enough on their own).

## Token input tolerance
`extractSetupToken` (utils/token.ts) accepts the raw token, a full URL
(`http://host/reset-password?token=...`), or a bare `?token=...` fragment, then
URL-decodes + trims. Both setup and reset links resolve through this one endpoint.
