# CereOnco Community API — Project Status

**Last updated:** 3 June 2026  
**Status:** Phase 1 ✅ Complete · Phase 2 ✅ Complete · Phase 3+ Planned

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Folder Structure](#3-folder-structure)
4. [Database Tables & Relationships](#4-database-tables--relationships)
5. [Completed APIs](#5-completed-apis)
6. [Authentication Flow](#6-authentication-flow)
7. [Environment Variables](#7-environment-variables)
8. [Running the Project](#8-running-the-project)
9. [Future Modules Roadmap](#9-future-modules-roadmap)

---

## 1. Project Overview

A modular REST API backend designed to serve both web and mobile clients for the CereOnco Community platform. Built API-first with a clear contract defined in OpenAPI 3.1, code-generated Zod validation schemas, and a consistent JSON response envelope on every endpoint.

**What's live:**
- User registration and login with JWT authentication
- Password hashing with bcrypt
- User profile retrieval and update
- Posts with full CRUD (create, read, update, delete)
- Like / unlike toggle per post (with live count)
- Bookmark / unbookmark toggle per post
- Feed endpoint returning per-user like and bookmark state
- Optional auth on feed — unauthenticated clients get posts without state; authenticated clients get `isLiked` / `isBookmarked` per post
- Interactive Swagger UI at `/api/docs`
- Postman collection in `docs/`

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 (strict) |
| Framework | Express 5 |
| Database | PostgreSQL (Replit-managed) |
| ORM | Drizzle ORM + drizzle-kit |
| Validation | Zod v4 + drizzle-zod |
| Auth | JWT (jsonwebtoken) + bcrypt (bcryptjs) |
| Logging | Pino + pino-http |
| API Spec | OpenAPI 3.1 (Orval codegen) |
| Docs UI | swagger-ui-express |
| Build | esbuild (CJS bundle) |
| Package manager | pnpm workspaces |

---

## 3. Folder Structure

```
workspace/
│
├── artifacts/
│   └── api-server/                    # Deployable API server
│       ├── build.mjs                  # esbuild bundler config
│       ├── package.json               # Runtime deps: express, drizzle, bcryptjs, jwt…
│       ├── tsconfig.json
│       └── src/
│           ├── app.ts                 # Express app: CORS, JSON body parser, pino logger
│           ├── index.ts               # Entry point — reads PORT, starts HTTP server
│           ├── openapi-spec.ts        # OpenAPI spec as JS object (powers Swagger UI)
│           ├── lib/
│           │   └── logger.ts          # Pino logger singleton
│           ├── middlewares/
│           │   ├── auth.ts            # requireAuth — verifies Bearer JWT, attaches userId
│           │   └── optionalAuth.ts    # optionalAuth — attaches userId if token present
│           ├── routes/
│           │   ├── index.ts           # Mounts all routers under /api prefix
│           │   ├── health.ts          # GET /api/healthz
│           │   ├── auth.ts            # POST /api/auth/register, /login, /logout
│           │   ├── users.ts           # GET/PATCH /api/users/me, GET /api/users/:id
│           │   ├── posts.ts           # Full posts CRUD + likes + bookmarks
│           │   └── docs.ts            # Swagger UI at /api/docs
│           └── utils/
│               ├── response.ts        # success(res, msg, data) / error(res, msg, code)
│               └── token.ts           # generateToken(payload) / verifyToken(token)
│
├── lib/
│   ├── api-spec/                      # OpenAPI contract (source of truth)
│   │   ├── openapi.yaml               # Spec file — edit when adding endpoints
│   │   └── orval.config.ts            # Codegen config
│   │
│   └── db/                            # Shared database layer
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts               # Exports db (Drizzle client) + schema
│           └── schema/
│               ├── index.ts           # Re-exports all schemas
│               ├── users.ts           # usersTable
│               └── posts.ts           # postsTable, likesTable, bookmarksTable
│
└── docs/
    ├── PROJECT_STATUS.md              # This file
    ├── README.md                      # Setup guide + Postman testing steps
    └── postman-collection.json        # Importable Postman collection (v2.1)
```

**Key conventions:**
- Never use `console.log` in server code — use `req.log` in handlers, `logger` singleton elsewhere.
- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`.
- Always run `pnpm --filter @workspace/db run push` after changing any schema file.
- Route params in Express 5 are `string | string[]` — parse with `Array.isArray` check before using.

---

## 4. Database Tables & Relationships

### users

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| name | text | NOT NULL |
| email | text | NOT NULL, UNIQUE |
| password_hash | text | NOT NULL (bcrypt) |
| role | text | NOT NULL, DEFAULT 'patient' |
| bio | text | nullable |
| location | text | nullable |
| avatar_url | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

### posts

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| user_id | integer | NOT NULL, FK → users.id CASCADE |
| content | text | NOT NULL |
| image_url | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

### likes

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| user_id | integer | NOT NULL, FK → users.id CASCADE |
| post_id | integer | NOT NULL, FK → posts.id CASCADE |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| — | — | UNIQUE (user_id, post_id) |

### bookmarks

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| user_id | integer | NOT NULL, FK → users.id CASCADE |
| post_id | integer | NOT NULL, FK → posts.id CASCADE |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| — | — | UNIQUE (user_id, post_id) |

**Relationships:**
- `users` (1) ──< (many) `posts`
- `users` (1) ──< (many) `likes`
- `users` (1) ──< (many) `bookmarks`
- `posts` (1) ──< (many) `likes`
- `posts` (1) ──< (many) `bookmarks`
- Deleting a user removes all their posts, likes, and bookmarks (CASCADE).
- Deleting a post removes all its likes and bookmarks (CASCADE).

---

## 5. Completed APIs

**Base URL:** `https://<your-domain>/api`  
**Response format:** `{ success: bool, message: string, data: any }`

### Health

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/healthz` | No | Returns `{ status: "ok" }` |

### Auth

| Method | Route | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | No | `{ name, email, password, role }` | `{ token, user }` |
| POST | `/auth/login` | No | `{ email, password }` | `{ token, user }` |
| POST | `/auth/logout` | No | — | success message |

### Users

| Method | Route | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/users/me` | Bearer | — | User object |
| PATCH | `/users/me` | Bearer | `{ name?, bio?, location?, avatarUrl? }` | Updated user |
| GET | `/users/:id` | No | — | User object |

### Posts

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/posts` | Optional | Feed — newest first, paginated with `?limit=&offset=` |
| POST | `/posts` | Bearer | Create post: `{ content, imageUrl? }` |
| GET | `/posts/:id` | Optional | Single post with author, counts, like/bookmark state |
| PATCH | `/posts/:id` | Bearer | Update own post: `{ content?, imageUrl? }` |
| DELETE | `/posts/:id` | Bearer | Delete own post → 204 |
| POST | `/posts/:id/like` | Bearer | Like → `{ liked: true, likeCount }` |
| DELETE | `/posts/:id/like` | Bearer | Unlike → `{ liked: false, likeCount }` |
| POST | `/posts/:id/bookmark` | Bearer | Bookmark → `{ bookmarked: true }` |
| DELETE | `/posts/:id/bookmark` | Bearer | Unbookmark → `{ bookmarked: false }` |

---

## 6. Authentication Flow

1. **Register** — `POST /auth/register` with `{ name, email, password, role }`. Password is bcrypt-hashed (10 rounds). Returns JWT + user object.
2. **Login** — `POST /auth/login` with `{ email, password }`. Compares bcrypt hash. Returns JWT + user object.
3. **Authenticated requests** — Add `Authorization: Bearer <token>` header. The `requireAuth` middleware validates the JWT and attaches `req.userId`.
4. **Logout** — Client deletes the token. Server-side: `POST /auth/logout` returns success (stateless).
5. **Token expiry** — 7 days. User must re-login after expiry.

---

## 7. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | JWT signing secret |
| `PORT` | Yes | Server port (set by Replit workflow) |
| `NODE_ENV` | No | `development` / `production` |

---

## 8. Running the Project

```bash
# Install dependencies
pnpm install

# Push DB schema (first time + after schema changes)
pnpm --filter @workspace/db run push

# Run API server in dev mode
pnpm --filter @workspace/api-server run dev

# Typecheck
pnpm run typecheck

# Regenerate API types after spec changes
pnpm --filter @workspace/api-spec run codegen
```

---

## 9. Future Modules Roadmap

| Phase | Module | Status |
|---|---|---|
| Phase 3 | Comments & Replies | Planned |
| Phase 3 | Role Extensions (MD verification, admin) | Planned |
| Phase 4 | Groups (create, join, group feed) | Planned |
| Phase 4 | Direct Messages | Planned |
| Phase 5 | Notifications (real-time) | Planned |
| Phase 5 | Cognie AI integration | Planned |
| Phase 6 | File uploads (OCI Object Storage) | Planned |
| Phase 6 | Admin Dashboard APIs | Planned |
| Phase 7 | Events & RSVPs | Planned |
| Phase 7 | Survivor Stories | Planned |
