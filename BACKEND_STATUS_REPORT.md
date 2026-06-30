# CereOnco Backend — Status & Handover Report

> **Purpose:** A single source of truth for the current state of the CereOnco Community backend. Any developer (or AI continuation) should be able to read this and pick up work without context loss. This is a handover + status report, not a tutorial.

---

## 1. Project Overview

The **CereOnco Community** backend is a modular REST API powering a support platform for cancer patients, caregivers, and medical professionals. It provides authentication, user profiles, a social feed (posts, likes, bookmarks, comments), community groups, notifications, 1:1 messaging, and email-based account flows.

**Tech stack:**

- **Runtime:** Node.js 24, TypeScript 5.9
- **Web framework:** Express 5
- **Database:** PostgreSQL with **Drizzle ORM**
- **Auth:** JWT (`jsonwebtoken`) + **bcrypt** (`bcryptjs`)
- **Validation:** Zod (`zod/v4`) + `drizzle-zod`
- **API contract:** OpenAPI (source of truth), client/server artifacts generated with **Orval**
- **Docs:** Swagger UI at `/api/docs`
- **Logging:** Pino + `pino-http`
- **Build:** esbuild (CJS/ESM bundle)
- **Repo:** pnpm monorepo (workspaces)

---

## 2. Architecture Summary

- **Auth system** — JWT-based. Registration is passwordless: a user registers, receives an emailed (or logged) setup-token link, and sets their password via `set-password`. Login issues a 7-day JWT. Logout is client-side.
- **Posts system** — A single `posts` table backs both the main feed and group feeds. A post with `groupId IS NULL` is a normal feed post; a post with a non-null `groupId` is a group post. Likes, bookmarks, and comments all attach to the same `posts` rows.
- **Groups system** — Groups have a creator/owner (admin) and members. **There is no separate group-posts table** — group posts are `posts` rows scoped by `groupId`. Group creation uses descriptive, field-level validation.
- **Email system** — Pluggable SMTP via nodemailer. The frontend link base is resolved dynamically per request (request origin first, then env fallbacks). When SMTP is unconfigured, dev logs the link; prod fails closed (never logs the token).
- **Password reset system** — Reuses the exact same single-use, 24h, SHA-256-hashed token mechanism as registration. `forgot-password` issues a link; `set-password` consumes the token and sets the password.
- **Google login system** — `POST /auth/google` accepts a **frontend-trusted** Google profile, finds or creates the user, and returns a JWT. (See Known Issues for the security caveat.)

---

## 3. Features Completed

- **Authentication (JWT)** — Passwordless register → emailed setup link → `set-password` → auto-login. Login + logout. 7-day JWT signed with `SESSION_SECRET`.
- **Google OAuth login (frontend-trusted)** — Create-or-reuse user from a Google profile; returns `{ token, user }`.
- **Posts system (unified table)** — CRUD, paginated feed (newest-first), like/unlike, bookmark/unbookmark, `commentCount` on every post, media uploads, saved-posts endpoint. `groupId` distinguishes feed vs group posts.
- **Group creation + group feeds** — List/view groups with `memberCount` + `isMember`, join/leave (idempotent), group feed, and group-post CRUD with ownership checks. Field-level CreateGroup validation.
- **Comments & replies** — Threaded, edit, soft-delete (threads never break), mentions with notifications.
- **Notifications** — Paginated list, unread count, mark single/all read; triggered by likes, comments, replies, group joins, and group posts.
- **Messaging** — 1:1 conversations (idempotent create-or-get), conversation list, message history, send, mark-read, global unread count, plus real-time delivery over Socket.IO.
- **Password reset flow** — Email + single-use token, shared with registration.
- **Email service** — Dynamic frontend URL resolution + pluggable SMTP.
- **OpenAPI + Postman integration** — Spec kept in sync; Postman collection updated with executable tests.
- **Database migrations applied** — Idempotent, Render-compatible SQL migrations.

---

## 4. Current Implementation Details

### Posts System
- **Single `posts` table** is the only store for both feed and group content.
- `groupId` is **nullable**.
- **Main feed** = `groupId IS NULL` (group posts are excluded from `GET /posts`).
- **Group feed** = `groupId = :groupId`.
- Group posts share the same shape as feed posts: `content`, `feeling`, `imageUrl`, `mediaUrls[]`, `author`, `likeCount`, `bookmarkCount`, `commentCount`, and per-user `isLiked` / `isBookmarked`.
- A non-existent `groupId` on post creation returns `404`.

### Groups
- **No separate group-posts table** — group posts are `posts` rows scoped by `groupId`.
- Group-post edit/delete are **owner-only** (`403` otherwise) and return `404` if the target row is not actually a group post.
- Creating a group post still notifies other members (`group_post_created`).
- **Validation improved** — CreateGroup returns descriptive, field-level messages (e.g. *"name is required. Please enter a group name."*) instead of raw Zod "Required". Malformed `imageUrl` is rejected with a URL-format hint; optional `tagline`/`imageUrl` are trimmed (empty → null).

### Auth
- **JWT-based** (7-day expiry, signed with `SESSION_SECRET`).
- **Google login** — looks up the user by **email first**, then by **`googleSub`**; creates the account if neither matches (`role = patient`, `emailVerified = true`, `passwordHash` stays null). When Google omits an email, a placeholder `${sanitizedSub}@google.local` is generated to satisfy the unique-email constraint. Existing users get `googleSub` and profile photo backfilled if missing. Returns `201` for a new account, `200` for an existing one.
- **Password reset + set-password** — `set-password` accepts the token as a raw token, a `?token=...` fragment, or the full setup URL; it extracts and trims the token, hashes it with the same SHA-256 function, validates expiry, clears the token fields, and returns an auto-login JWT.

### Email
- Frontend URL base resolved in priority order:
  1. **request `Origin` header** (the calling frontend)
  2. env **`FRONTEND_URL`**
  3. env **`TEST_FRONTEND_URL`**
  4. fallback **`http://localhost:5173`**
- The chosen origin is sanitized (scheme + host only, trailing slash stripped) before the `/set-password?token=...` path is appended.

---

## 5. APIs Implemented

> Full route table lives in `docs/README.md`. Highlights below.

**Auth**
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `POST /api/auth/forgot-password`
- `POST /api/auth/set-password`
- `POST /api/auth/logout`

**Posts**
- `GET /api/posts`
- `POST /api/posts`
- `GET /api/posts/saved`
- `GET /api/posts/:id`
- `PATCH /api/posts/:id`, `DELETE /api/posts/:id`
- `POST|DELETE /api/posts/:id/like`
- `POST|DELETE /api/posts/:id/bookmark`

**Groups**
- `GET /api/groups`, `POST /api/groups`
- `GET /api/groups/:id`
- `POST|DELETE /api/groups/:id/join`
- `GET /api/groups/:id/posts`
- `POST /api/groups/:id/posts`
- `PATCH|DELETE /api/groups/posts/:postId`

**Also implemented:** comments (`/api/posts/:id/comments`, `/api/comments/:id`), notifications (`/api/notifications/...`), messaging (`/api/conversations/...`, `/api/messages/...`), users (`/api/users/...`), docs (`/api/docs`), health (`/api/healthz`).

---

## 6. Database Schema Changes

> **Note:** Primary keys in this project are **serial integers**, not UUIDs. Foreign keys are integers accordingly.

- **`posts.group_id`** — nullable `integer`, FK → `groups.id` **`ON DELETE SET NULL`**. `NULL` = main-feed post; non-null = group post. Deleting a group detaches its posts (they remain as normal posts) instead of cascade-deleting them.
- **`posts.feeling`** — nullable `text` (reused by group posts).
- **`posts.media_urls`** — `jsonb` array of strings, default `[]` (reused by group posts).
- **`users.google_sub`** — nullable, **unique** `text` (the Google subject id).
- **Password-reset / setup token fields on `users`:**
  - `password_setup_token` — nullable `text` (only the SHA-256 hash is stored).
  - `password_setup_token_expires_at` — nullable timestamp (24h single-use).
  - `password_hash` — nullable until the user sets a password.
- **Relationships:**
  - `posts.user_id` → `users.id` (author)
  - `posts.group_id` → `groups.id` (optional group membership of the post)
  - `groups.creator_user_id` → `users.id` (group owner/admin)
  - `group_members(group_id, user_id)` — unique membership pair with a `role` column

**Migration files (idempotent, Render-compatible):**
- `lib/db/drizzle/phase_google_group_email_fixes.sql` — adds `users.google_sub` + unique constraint, ensures `posts.group_id` / `feeling` / `media_urls`, and backfills legacy `group_posts` rows into `posts`.
- `lib/db/drizzle/phase_group_posts_unify.sql` — re-points the `posts.group_id` FK to **`ON DELETE SET NULL`**, performs a final safety backfill, and **drops the now-unused `group_posts` table**. Group posts are exclusively `posts` rows from here on.

---

## 7. Known Issues / Edge Cases

- **Google login is frontend-trusted** — `POST /auth/google` trusts the client-supplied profile and does **not** verify a Google ID token yet. Because lookup is email-first, a caller could POST a victim's email with an arbitrary `sub` and receive a token (account-takeover risk). This is an **intentional, documented design** (`SECURITY/TODO` in the route and docs), not an oversight.
- **Token-based reset/set-password** — full-URL/query/raw token forms are handled, but the end-to-end flow should be verified once more against the live frontend.
- **Validation edge cases** — descriptive CreateGroup validation is in place; other endpoints still use generated Zod messages, so minor edge cases may surface under unusual payloads.

---

## 8. Pending Work

- **Final end-to-end API testing via Postman** (all core flows).
- **Optional security upgrade:** server-side Google **ID token** verification (`google-auth-library verifyIdToken`) and rejecting mismatched `sub` for already-linked accounts. **Not blocking.**
- **Final validation cleanup** if edge cases appear during testing.

---

## 9. Testing Status

- **Postman collection** — updated, including new Google sign-in requests (new user `201`, existing user `200`, missing `sub` `400`) and group-post assertions (counts, `isLiked`/`isBookmarked`, `mediaUrls`, `feeling`).
- **OpenAPI** — both spec sources synced; codegen re-run.
- **Core flows exercised:**
  - Auth flow (register → set-password → login)
  - Group posts (create/edit/delete on the unified posts table)
  - Password reset
  - Google login (smoke-tested live: `400` missing sub, `201` new user)

---

## 10. Deployment Readiness

- **Build:** passing (`pnpm --filter @workspace/api-server build`).
- **Typecheck:** passing for the API server and shared libs.
- **Migration:** applied cleanly (idempotent, Render-compatible).
- **APIs:** stable; server boots clean and `/api/healthz` returns `{ "status": "ok" }`.

---

## 11. Handover Note

> **This backend is in a production-stabilization stage.** All core modules are implemented. Remaining work is limited to testing, edge-case handling, and optional security hardening (Google ID token verification). A new developer or AI can continue from here using `docs/README.md` (full route reference), `docs/PROJECT_STATUS.md`, and the Postman collection at `docs/postman-collection.json`.
