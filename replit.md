# CereOnco Community API

A modular REST API backend for the CereOnco Community platform — supporting cancer patients, caregivers, and medical professionals. Phase 1 (Auth/Users) + Phase 2 (Posts/Likes/Bookmarks) are complete.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `SESSION_SECRET` — JWT signing secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Auth: JWT (jsonwebtoken) + bcrypt (bcryptjs)
- Logging: Pino + pino-http
- API codegen: Orval (from OpenAPI spec)
- Docs: swagger-ui-express at `/api/docs`
- Build: esbuild (CJS bundle)

## Where things live

- **API contract**: `lib/api-spec/openapi.yaml` — source of truth, edit here first
- **DB schema**: `lib/db/src/schema/` — users.ts, posts.ts (postsTable, likesTable, bookmarksTable)
- **Routes**: `artifacts/api-server/src/routes/` — auth, users, posts, docs, health
- **Middlewares**: `artifacts/api-server/src/middlewares/` — auth.ts (requireAuth), optionalAuth.ts
- **Utils**: `artifacts/api-server/src/utils/` — response.ts (success/error), token.ts (JWT)
- **Swagger spec object**: `artifacts/api-server/src/openapi-spec.ts`
- **Docs**: `docs/` — README.md, PROJECT_STATUS.md, postman-collection.json

## Architecture decisions

- **OpenAPI-first**: `lib/api-spec/openapi.yaml` is the single source of truth. Zod schemas generated via `pnpm --filter @workspace/api-spec run codegen` — never hand-write types that codegen produces.
- **Response envelope**: Every endpoint returns `{ success, message, data }` for consistent client handling. Spec defines just the `data` payload shape; the server wraps with the envelope using `utils/response.ts`.
- **Optional auth on feed**: `GET /posts` and `GET /posts/:id` accept optional Bearer tokens. Authenticated clients get per-post `isLiked`/`isBookmarked` state; unauthenticated clients get counts but false for state.
- **Idempotent likes/bookmarks**: Double-liking is silently ignored via `onConflictDoNothing()`. Unlike/unbookmark on non-existent records also succeeds silently.
- **JWT via SESSION_SECRET**: Uses the existing `SESSION_SECRET` env var as the JWT signing key — no extra secret needed.

## Product

Phase 1 & 2 complete:
- User registration/login with JWT + bcrypt
- Role-based user profiles (patient, caregiver, medical_professional, admin)
- Posts with CRUD, feed (paginated, newest-first), per-post author info
- Like/unlike toggle with live counts
- Bookmark/unbookmark toggle
- Per-user `isLiked`/`isBookmarked` state in feed responses
- Swagger UI at `/api/docs`

## User preferences

- **Backend only** — no frontend code, React components, or UI
- Build Phase 1 + 2 together, stop and wait for approval before Phase 3+ (Comments, Roles Extension)
- Response format: `{ success: bool, message: string, data: {} }`
- Modular folder structure
- Every endpoint testable in Postman

## Gotchas

- Always run codegen after changing `openapi.yaml`
- Always run `pnpm --filter @workspace/db run push` after changing any schema file in `lib/db/src/schema/`
- Express 5: `req.params.id` is `string | string[]` — the generated `GetXParams` Zod schemas handle coercion automatically
- `zod/v4` requires `zod` in each package's own `dependencies`
- Body schema names in the spec must be entity-shaped (not `<OperationIdPascal>Body`) to avoid TS2308 codegen collisions

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Full API documentation: `docs/README.md`
- Full project status: `docs/PROJECT_STATUS.md`
- Postman collection: `docs/postman-collection.json`
