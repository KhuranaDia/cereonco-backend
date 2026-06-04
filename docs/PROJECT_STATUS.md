# CereOnco Community API — Project Status

**Last updated:** 4 June 2026
**Status:** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 ✅ · Phase 6+ Planned

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

A modular REST API backend for the CereOnco Community platform. Built API-first with OpenAPI 3.1, code-generated Zod validation, and a consistent JSON response envelope on every endpoint.

**What's live:**
- User registration and login with JWT + bcrypt
- Role-based user profiles: `patient`, `caregiver`, `medical_professional`, `admin`
- Extended profile fields: `cancerType`, `treatmentStage`, `interests` (patient/caregiver); `specialty`, `hospitalAffiliation`, `medicalLicenseNumber` (medical professionals)
- Medical professional verification states: `none` → `pending` → `approved` / `rejected`
- Auto-pending: submitting a license number automatically sets status to `pending`
- Onboarding flag and profile photo URL
- Posts with full CRUD, feed (paginated, newest-first)
- Like / unlike toggle with live counts
- Bookmark / unbookmark toggle
- Per-user `isLiked` / `isBookmarked` state in feed responses
- Comments & Replies with full threaded structure
- `commentCount` on all post responses
- Soft delete on comments — threads never broken
- Edit own comment, delete own comment
- **Community Groups (Phase 5)**:
  - List all groups with membership count and `isMember` flag
  - Get single group detail
  - Join / leave groups (idempotent join — no duplicate memberships)
  - Group feed: paginated posts newest-first with author info
  - Create group post, edit own post, delete own post
  - 401/403/404 auth guards on all write endpoints
- Swagger UI at `/api/docs`
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
│   └── api-server/
│       └── src/
│           ├── middlewares/
│           │   ├── auth.ts            # requireAuth
│           │   └── optionalAuth.ts    # optionalAuth
│           ├── routes/
│           │   ├── index.ts           # Mounts all routers
│           │   ├── health.ts          # GET /api/healthz
│           │   ├── auth.ts            # Auth endpoints
│           │   ├── users.ts           # User profile endpoints
│           │   ├── posts.ts           # Posts + likes + bookmarks
│           │   ├── comments.ts        # Comments + replies (Phase 4)
│           │   ├── groups.ts          # Community groups (Phase 5)
│           │   └── docs.ts            # Swagger UI
│           └── utils/
│               ├── response.ts        # success() / error()
│               └── token.ts           # generateToken() / verifyToken()
│
├── lib/
│   ├── api-spec/openapi.yaml          # OpenAPI contract (source of truth)
│   └── db/src/schema/
│       ├── users.ts                   # usersTable
│       ├── posts.ts                   # postsTable, likesTable, bookmarksTable
│       ├── comments.ts                # commentsTable (Phase 4)
│       └── groups.ts                  # groupsTable, groupMembersTable, groupPostsTable (Phase 5)
│
└── docs/
    ├── PROJECT_STATUS.md
    ├── README.md
    └── postman-collection.json
```

---

## 4. Database Tables & Relationships

### users

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| name | text | NOT NULL |
| email | text | NOT NULL, UNIQUE |
| password_hash | text | NOT NULL |
| role | text | NOT NULL, DEFAULT 'patient' |
| bio | text | nullable |
| location | text | nullable |
| avatar_url | text | nullable |
| profile_photo_url | text | nullable |
| onboarding_completed | boolean | NOT NULL, DEFAULT false |
| cancer_type | text | nullable |
| treatment_stage | text | nullable |
| interests | text[] | nullable |
| specialty | text | nullable |
| hospital_affiliation | text | nullable |
| medical_license_number | text | nullable |
| verification_status | text | NOT NULL, DEFAULT 'none' |
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

### comments

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| post_id | integer | NOT NULL, FK → posts.id CASCADE |
| user_id | integer | NOT NULL, FK → users.id CASCADE |
| content | text | NOT NULL |
| parent_comment_id | integer | nullable, FK → comments.id SET NULL |
| is_deleted | boolean | NOT NULL, DEFAULT false |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

### groups

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| name | text | NOT NULL |
| description | text | NOT NULL |
| category | text | NOT NULL |
| image_url | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

### group_members

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| group_id | integer | NOT NULL, FK → groups.id CASCADE |
| user_id | integer | NOT NULL, FK → users.id CASCADE |
| joined_at | timestamptz | NOT NULL, DEFAULT now() |
| — | — | UNIQUE (group_id, user_id) |

### group_posts

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| group_id | integer | NOT NULL, FK → groups.id CASCADE |
| user_id | integer | NOT NULL, FK → users.id CASCADE |
| content | text | NOT NULL |
| image_url | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

**Relationships:**
- `users` ──< `posts` (CASCADE delete)
- `users` ──< `likes` (CASCADE delete)
- `users` ──< `bookmarks` (CASCADE delete)
- `users` ──< `comments` (CASCADE delete)
- `posts` ──< `likes` (CASCADE delete)
- `posts` ──< `bookmarks` (CASCADE delete)
- `posts` ──< `comments` (CASCADE delete)
- `comments` ──< `comments` (self-ref: parent → child; SET NULL on parent delete)
- `groups` ──< `group_members` (CASCADE delete)
- `groups` ──< `group_posts` (CASCADE delete)
- `users` ──< `group_members` (CASCADE delete)
- `users` ──< `group_posts` (CASCADE delete)

---

## 5. Completed APIs

**Base URL:** `https://<your-domain>/api`
**Response format:** `{ success: bool, message: string, data: any }`

### Health

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/healthz` | No | Returns `{ status: "ok" }` |

### Auth

| Method | Route | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | No | `{ name, email, password, role }` | `{ token, user }` |
| POST | `/auth/login` | No | `{ email, password }` | `{ token, user }` |
| POST | `/auth/logout` | Optional | — | success |

### Users

| Method | Route | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/users/me` | Bearer | — | Full user object |
| PATCH | `/users/me` | Bearer | See profile fields | Updated user |
| GET | `/users/:id` | No | — | Full user object |

### Posts

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/posts` | Optional | Feed with `commentCount`, `likeCount`, `bookmarkCount`, `isLiked`, `isBookmarked` |
| POST | `/posts` | Bearer | Create post |
| GET | `/posts/:id` | Optional | Single post with all counts |
| PATCH | `/posts/:id` | Bearer | Update own post |
| DELETE | `/posts/:id` | Bearer | Delete own post → 204 |
| POST | `/posts/:id/like` | Bearer | Like → `{ liked: true, likeCount }` |
| DELETE | `/posts/:id/like` | Bearer | Unlike → `{ liked: false, likeCount }` |
| POST | `/posts/:id/bookmark` | Bearer | Bookmark → `{ bookmarked: true }` |
| DELETE | `/posts/:id/bookmark` | Bearer | Unbookmark → `{ bookmarked: false }` |

### Comments

| Method | Route | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/posts/:id/comments` | Bearer | — | `{ comments, total }` — threaded |
| POST | `/posts/:id/comments` | Bearer | `{ content, parentCommentId? }` | Created comment |
| PATCH | `/comments/:id` | Bearer | `{ content }` | Updated comment |
| DELETE | `/comments/:id` | Bearer | — | `{ deleted: true, id }` |

### Groups (Phase 5)

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/groups` | Bearer | List all groups with `memberCount` and `isMember` |
| GET | `/groups/:id` | Bearer | Single group detail |
| POST | `/groups/:id/join` | Bearer | Join group → `{ joined: true, memberCount }` |
| DELETE | `/groups/:id/join` | Bearer | Leave group → `{ joined: false, memberCount }` |
| GET | `/groups/:id/posts` | Bearer | Group feed (paginated, newest-first, with author) |
| POST | `/groups/:id/posts` | Bearer | Create group post → 201 |
| PATCH | `/groups/posts/:postId` | Bearer | Edit own group post |
| DELETE | `/groups/posts/:postId` | Bearer | Delete own group post → 204 |

**Group rules:**
- All group endpoints require authentication (Bearer token)
- Joining twice is idempotent — no duplicate memberships (`onConflictDoNothing`)
- Leaving a group you haven't joined is a no-op (safe)
- Only post owner can edit or delete their group post (403 otherwise)
- `memberCount` is computed via efficient LEFT JOIN + COUNT in the same query
- `isMember` is computed via a batched membership lookup for list endpoints

---

## 6. Authentication Flow

1. **Register** → bcrypt-hashed password, returns JWT (7-day expiry) + full user object
2. **Login** → verifies bcrypt hash, returns JWT + full user object
3. **Authenticated requests** → `Authorization: Bearer <token>` header
4. **Logout** → client deletes the token (stateless)

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
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm run typecheck
pnpm --filter @workspace/api-spec run codegen
```

---

## 9. Future Modules Roadmap

| Phase | Module | Status |
|---|---|---|
| Phase 6 | Admin endpoints (verify/reject MDs, moderate content) | Planned |
| Phase 6 | Notifications (real-time) | Planned |
| Phase 7 | Direct Messages | Planned |
| Phase 7 | Cognie AI integration | Planned |
| Phase 8 | File uploads (Object Storage) | Planned |
| Phase 8 | Events & RSVPs | Planned |
| Phase 8 | Survivor Stories | Planned |
