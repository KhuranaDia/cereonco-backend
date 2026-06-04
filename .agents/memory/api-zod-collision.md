---
name: api-zod TS2308 collision fix
description: When an OpenAPI operation has both path params AND query params, Orval generates the same XxxParams name in both api.ts (Zod const) and types/ (TS type), causing TS2308 when both are re-exported.
---

## The rule

Do NOT re-export `generated/types` from `lib/api-zod/src/index.ts`.

Keep `index.ts` as:
```ts
export * from "./generated/api";
// Do NOT add: export * from "./generated/types";
```

**Why:** Orval generates `GetXxxParams` as a Zod `const` in `api.ts` AND as a `type` in `types/getXxxParams.ts`. When both are re-exported via `export *` from the same barrel, TypeScript 5.x raises TS2308 ("Module has already exported a member"). This only fires for operations that have BOTH a path param (e.g. `{id}`) AND query params (e.g. `limit`, `offset`).

**How to apply:** Every time you run `pnpm --filter @workspace/api-spec run codegen`, confirm `lib/api-zod/src/index.ts` still only has the single `export * from "./generated/api"` line. The codegen does NOT overwrite `index.ts` (it's outside `generated/`), but double-check after any Orval config changes.

**First observed with:** `GET /groups/{id}/posts` (`getGroupFeed`) which has path param `{id}` and query params `limit`/`offset`.
