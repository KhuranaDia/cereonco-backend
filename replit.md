# CereOnco Community API

A modular REST API backend for the CereOnco Community platform — supporting cancer patients, caregivers, and medical professionals. Phase 1–7 complete.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `SESSION_SECRET` — JWT signing secret
- Optional env: `FRONTEND_URL` — base URL for email action links (password setup/reset) when no trusted request `Origin` header is present
- Optional env: `TEST_FRONTEND_URL` — fallback base URL for email links when neither a trusted `Origin` nor `FRONTEND_URL` is set
- Optional env: `ALLOWED_FRONTEND_ORIGINS` — comma-separated list of extra frontend origins allowed to be used as an email-link host (in addition to `FRONTEND_URL`, `TEST_FRONTEND_URL`, and the `http://localhost:5173` dev default)

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
- **DB schema**: `lib/db/src/schema/` — users.ts, posts.ts, comments.ts, groups.ts, notifications.ts, messages.ts
- **Routes**: `artifacts/api-server/src/routes/` — auth, users, posts, comments, groups, notifications, messages, docs, health
- **Services**: `artifacts/api-server/src/services/` — messages.ts (shared DB ops + socket emit, used by both REST routes and socket handlers)
- **Socket.IO**: `artifacts/api-server/src/socket/` — index.ts (init + JWT handshake + event handlers), io.ts (singleton + emit helpers), onlineUsers.ts (in-memory presence map)
- **Server entry**: `artifacts/api-server/src/index.ts` — Express + Socket.IO share one `http.createServer(app)` on the same PORT
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
- **Passwordless registration**: `POST /auth/register` collects no password — it stores a hashed, 24h single-use setup token and emails (or logs) a setup link. `POST /auth/set-password {token, password}` verifies the account, bcrypt-hashes the password, and auto-logs-in. `passwordHash` is nullable until then; login before setup returns 403. Only the SHA-256 hash of the setup token is persisted. SMTP is pluggable via `SMTP_HOST`/`SMTP_USER`.
- **set-password token validation (shared by setup + reset)**: `POST /auth/set-password` finishes BOTH passwordless registration and the forgot-password reset flow. It tolerates the `token` field being the raw token, a full URL (`http://host/reset-password?token=...`), or a bare `?token=...` fragment (`extractSetupToken` extracts + URL-decodes + trims). Differentiated outcomes: no hash match → `400 "Invalid password reset token."`; match with NULL expiry → `400 "This reset link has already been used."`; match with past expiry → `410 "Reset link has expired."`; success → `{token, user}` + `"Password updated successfully."`. CONSUME DESIGN: on success it KEEPS the SHA-256 hash and nulls only the expiry — retaining the (one-way) hash is what lets a replay be reported as "already used" instead of a generic "invalid" without needing a schema migration; the token still can't authenticate because every accept path requires a non-null future expiry. Consumption is atomic: the UPDATE re-checks hash + non-null + future expiry in its WHERE clause and treats a zero-row result as "already used", so two concurrent requests with the same token can't both succeed. Dev-only (`NODE_ENV !== "production"`) debug logs record token-generated/hash prefixes + expiry (forgot-password) and lookup-hash prefix + stored expiry + current timestamp (set-password); raw passwords are never logged.
- **Dynamic email link host**: the reusable `getFrontendBaseUrl(req)` (in `utils/email.ts`) resolves the base URL for all email action links in this order: (1) request `Origin` header — but only when it matches an allowlisted origin, (2) `FRONTEND_URL`, (3) `TEST_FRONTEND_URL`, (4) `http://localhost:5173`. SECURITY: only the browser-set `Origin` header is consulted from the request (never request-body input), AND it must match the allowlist (`FRONTEND_URL` / `TEST_FRONTEND_URL` / `ALLOWED_FRONTEND_ORIGINS` / the localhost dev default) before it is used. This blocks Origin-header poisoning — an attacker POSTing `/auth/forgot-password` with a victim's email and a forged `Origin` cannot redirect the victim's reset-token link to an attacker domain; a non-allowed Origin falls back to the configured defaults. Setup emails link to `/set-password?token=...`; forgot-password (reset) emails link to `/reset-password?token=...`. Both still complete via the same `POST /auth/set-password` backend endpoint.
- **api-zod barrel**: `lib/api-zod/src/index.ts` exports only `generated/api` (Zod schemas). The `generated/types` barrel is NOT re-exported to avoid TS2308 collisions when operations have both path params and query params.
- **Group image upload (mirrors posts)**: `POST /groups` accepts BOTH `application/json` (no file) AND `multipart/form-data` with an optional single `image` file, reusing the same multer/local-disk flow as posts (`uploadGroupImage` → subdir `uploads/groups`, images-only jpg/jpeg/png/webp, max 20MB). The upload middleware passes JSON bodies straight through (multer only touches multipart), so JSON callers are unaffected. An uploaded file's `publicUrl("groups", …)` is saved into `groups.imageUrl` and takes precedence over any `imageUrl` sent in the body. All existing validation (descriptive per-field messages, creatorUserId, admin groupMember auto-join) is preserved. SPEC NOTE: like posts/avatar, the multipart capability is documented via the requestBody `description` prose with `application/json` as the only declared content type — do NOT add an explicit `multipart/form-data` content block with a `format: binary` field to `openapi.yaml`, because Orval then generates a `*BodyTwo.ts` type referencing the DOM `Blob` global, which fails `typecheck:libs` (TS2304 Cannot find name 'Blob') in the lib's Node-only TS config.
- **Conversation identity**: conversations store a normalized participant pair (`userOneId = min(a,b)`, `userTwoId = max(a,b)`) with a `unique(userOneId, userTwoId)` constraint, so `(A,B)` and `(B,A)` map to one row. Create-or-get uses insert `onConflictDoNothing()` then re-select for race safety.
- **Real-time messaging (Socket.IO)**: Express and Socket.IO share ONE `http.createServer(app)` on the same `PORT`. Socket path is `/api/socket.io` so it routes through the same reverse proxy as REST (the api-server only owns the `/api` path). Handshake auth reuses `verifyToken` (JWT in `handshake.auth.token`, `Authorization` header, or `?token=`). Persist-then-emit: `sendMessage` writes to Postgres first, then emits — REST stays the durable source of truth. Each socket joins a personal room `user:<id>` (targets all devices) and per-chat rooms `conversation:<id>` (joined via `joinConversation`, membership-checked). The shared `services/messages.ts` is called by BOTH REST routes and socket handlers so the two paths never diverge. Presence is a process-local in-memory map (no Redis); typing is never persisted.

## Product

Phase 1–7 complete:
- User registration/login with JWT + bcrypt
- Role-based profiles (patient, caregiver, medical_professional, admin)
- Extended profile fields: cancerType, treatmentStage, interests (patient/caregiver); specialty, hospitalAffiliation, medicalLicenseNumber (medical professionals)
- Medical professional verification: none → pending → approved/rejected
- Passwordless registration: register without a password → email/log a setup-token link → `POST /auth/set-password` to verify + set password
- Posts with CRUD, paginated feed, like/unlike, bookmark/unbookmark
- `commentCount` on all post responses
- Comments & Replies: threaded structure, edit, soft delete, auth-gated
- Community Groups: list/view groups with memberCount+isMember, join/leave (idempotent), group feed, group post CRUD with ownership checks
- Notifications: list (paginated), unread-count, mark single/all read; triggered by likes/comments/replies/group-joins/group-posts
- Messages: 1:1 real-time messaging — create-or-get conversation (idempotent, normalized participant pair), conversation list (otherParticipant + lastMessage + unreadCount, newest-updated first), conversation messages (oldest-first, membership-gated), send message (touches conversation updatedAt), mark-read (only messages received by current user), global unread-count
- Real-time messaging over Socket.IO (same server/port, path `/api/socket.io`, JWT handshake auth): live delivery (newMessage/messageReceived), read receipts (messageRead), typing (typing/stopTyping), presence (userOnline/userOffline/onlineUsers). REST remains the durable source of truth; sockets emit only after a successful DB write
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
- Socket.IO must use path `/api/socket.io` (not the default `/socket.io`) — the api-server only owns the `/api` proxy path, so the default path would 404 behind the Replit preview proxy. esbuild bundles socket.io fine (bundle grows ~0.7mb); the optional native deps `bufferutil`/`utf-8-validate` are already externalized in `build.mjs`.
- `pnpm --filter @workspace/db run push` currently blocks on a pre-existing, unrelated drift: the dev DB has duplicate non-null `phone_number` values, so adding the `users_phone_number_unique` constraint prompts to truncate users (and `push-force` would error). It needs a TTY and cannot run non-interactively. When this drift blocks a push for a NEW table, create just the new tables via direct DDL matching Drizzle's constraint naming (`<table>_<col>_<reftable>_<refcol>_fk`, `<table>_<col1>_<col2>_unique`) so a future clean push sees no drift.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Full API documentation: `docs/README.md`
- Full project status: `docs/PROJECT_STATUS.md`
- Postman collection: `docs/postman-collection.json`
