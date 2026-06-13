---
name: drizzle push blocked by phone_number drift
description: Why `pnpm --filter @workspace/db run push` fails in dev and how to add new tables anyway
---

`drizzle-kit push` (and `push-force`) cannot complete in this repo's dev DB.

**Why:** The committed schema has `users.phone_number` as `.unique()`, but the dev DB
contains duplicate non-null phone numbers (test seed data). Pushing tries to add the
`users_phone_number_unique` constraint, which interactively prompts to truncate the
users table; `push-force` instead errors on the duplicate values. Push also requires a
TTY, so it cannot run from the agent shell non-interactively at all.

**How to apply:** When you add a NEW table and need it in the dev DB, do not rely on
`push`. Create only the new table(s) via direct SQL DDL that mirrors the Drizzle schema,
matching Drizzle's auto-generated constraint names so a future clean push detects no
drift:
- unique: `<table>_<col1>_<col2>_unique`
- FK: `<table>_<col>_<reftable>_<refcol>_fk`
Use `text[] DEFAULT '{}'` for `text("x").array().notNull().default([])` columns.
The unrelated phone_number drift must be remediated separately (dedupe phone numbers)
before a full `push` can succeed — flag it to the user rather than truncating data.
