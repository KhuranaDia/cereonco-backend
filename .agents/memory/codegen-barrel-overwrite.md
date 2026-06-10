---
name: api-zod codegen overwrites index.ts barrel
description: Orval codegen rewrites lib/api-zod/src/index.ts and re-adds the types export, reintroducing a TS2308 build break
---

The api-zod barrel must export ONLY the generated Zod schemas (`generated/api`), never `generated/types`.

**Why:** any operation with BOTH path params and query params emits the same `XxxParams` name in both `generated/api.ts` (Zod) and `generated/types/` (TS), so re-exporting both collides → TS2308. Codegen regenerates the barrel and re-adds the types export every run, so the fix does not stick.

**How to apply:** after every `api-spec run codegen`, reset the barrel to a single `export * from "./generated/api";` line, then re-run `typecheck:libs`. A codegen failure ending in TS2308 on `index.ts` is this, not a real type error.
