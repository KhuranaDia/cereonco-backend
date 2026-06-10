# CereOnco Community API

A modular REST API backend for the CereOnco Community platform — supporting cancer patients, caregivers, and medical professionals. Phase 1–5 complete.

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
- **DB schema**: `lib/db/src/schema/` — users.ts, posts.ts, comments.ts, groups.ts
- **Routes**: `artifacts/api-server/src/routes/` — auth, users, posts, comments, groups, docs, health
- **Middlewares**: `artifacts/api-server/src/middlewares/` — auth.ts (requireAuth), optionalAuth.ts
- **Utils**: `artifacts/api-server/src/utils/` — response.ts, token.ts
- **Docs**: `docs/` — README.md, PROJECT_STATUS.md, postman-collection.json

## Architecture decisions

- **OpenAPI-first**: `lib/api-spec/openapi.yaml` is the single source of truth. Zod schemas generated via `pnpm --filter @workspace/api-spec run codegen` — never hand-write types that codegen produces.
- **Response envelope**: Every endpoint returns `{ success, message, data }`. Spec defines just the `data` shape; server wraps via `utils/response.ts`.
- **Optional auth on feed**: `GET /posts` and `GET /posts/:id` accept optional Bearer tokens for per-user `isLiked`/`isBookmarked` state.
- **Idempotent likes/bookmarks/joins**: Double-joining silently ignored via `onConflictDoNothing()`.
- **Auto-pending verification**: Submitting `medicalLicenseNumber` when `verificationStatus = none` auto-sets it to `pending`.
- **Soft delete on comments**: Comments are never hard-deleted — `isDeleted = true`, content masked as `[deleted]`, author nulled. Threads never break.
- **commentCount via FILTER**: `COUNT(...) FILTER (WHERE NOT is_deleted)` in the same feed JOIN — no extra query.
- **JWT via SESSION_SECRET**: 7-day expiry; logout is client-side.
- **Passwordless registration**: `POST /auth/register` collects no password — it stores a hashed, 24h single-use setup token and emails (or logs) a setup link. `POST /auth/set-password {token, password}` verifies the account, bcrypt-hashes the password, and auto-logs-in. `passwordHash` is nullable until then; login before setup returns 403. Only the SHA-256 hash of the setup token is persisted. SMTP is pluggable via `SMTP_HOST`/`SMTP_USER`; `FRONTEND_URL` sets the link base.
- **api-zod barrel**: `lib/api-zod/src/index.ts` exports only `generated/api` (Zod schemas). The `generated/types` barrel is NOT re-exported to avoid TS2308 collisions when operations have both path params and query params.

## Product

Phase 1–5 complete:
- User registration/login with JWT + bcrypt
- Role-based profiles (patient, caregiver, medical_professional, admin)
- Extended profile fields: cancerType, treatmentStage, interests (patient/caregiver); specialty, hospitalAffiliation, medicalLicenseNumber (medical professionals)
- Medical professional verification: none → pending → approved/rejected
- Passwordless registration: register without a password → email/log a setup-token link → `POST /auth/set-password` to verify + set password
- Posts with CRUD, paginated feed, like/unlike, bookmark/unbookmark
- `commentCount` on all post responses
- Comments & Replies: threaded structure, edit, soft delete, auth-gated
- Community Groups: list/view groups with memberCount+isMember, join/leave (idempotent), group feed, group post CRUD with ownership checks
- Swagger UI at `/api/docs`

## User preferences

- **Backend only** — no frontend code, React components, or UI
- Stop and wait for explicit approval before building each new phase
- Response format: `{ success: bool, message: string, data: {} }`
- Modular folder structure
- Every endpoint testable in Postman

## Gotchas

- Always run codegen after changing `openapi.yaml`
- Always run `pnpm --filter @workspace/db run push` after changing any schema file in `lib/db/src/schema/`
- Express 5: `req.params.id` is `string | string[]` — use generated Zod `GetXParams` for coercion
- `zod/v4` requires `zod` in each package's own `dependencies`
- Body schema names in the spec must be entity-shaped (not `<OperationIdPascal>Body`) to avoid TS2308 codegen collisions
- Self-referencing FK in Drizzle requires `(): AnyPgColumn =>` arrow wrapper
- Operations with BOTH path params AND query params generate `XxxParams` in both `api.ts` (Zod) and `types/` (TS type), causing TS2308. Fix: do NOT re-export `generated/types` from `lib/api-zod/src/index.ts`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Full API documentation: `docs/README.md`
- Full project status: `docs/PROJECT_STATUS.md`
- Postman collection: `docs/postman-collection.json`
