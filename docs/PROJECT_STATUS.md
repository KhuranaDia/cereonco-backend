# CereOnco Community API — Project Status

**Last updated:** 5 June 2026
**Status:** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 ✅ · Phase 6 ✅ · Phase 7 Planned

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
- **Notifications (Phase 6)**:
  - Automatic notifications on: post liked, post commented, comment replied, group joined, group post created
  - Never notifies users about their own actions
  - Actor info (id, name, role, profilePhotoUrl) returned with every notification
  - Paginated notification feed, newest-first
  - Unread count endpoint
  - Mark single notification as read (idempotent)
  - Mark all as read
  - 403 guard: users can only act on their own notifications
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
│           │   ├── index.ts              # Mounts all routers
│           │   ├── health.ts             # GET /api/healthz
│           │   ├── auth.ts               # Auth endpoints
│           │   ├── users.ts              # User profile endpoints
│           │   ├── posts.ts              # Posts + likes + bookmarks
│           │   ├── comments.ts           # Comments + replies (Phase 4)
│           │   ├── groups.ts             # Community groups (Phase 5)
│           │   ├── notifications.ts      # Notifications (Phase 6)
│           │   └── docs.ts               # Swagger UI
│           └── utils/
│               ├── response.ts           # success() / error()
│               ├── token.ts              # generateToken() / verifyToken()
│               └── notify.ts             # createNotification() / createNotifications()
│
├── lib/
│   ├── api-spec/openapi.yaml          # OpenAPI contract (source of truth)
│   └── db/src/schema/
│       ├── users.ts                   # usersTable
│       ├── posts.ts                   # postsTable, likesTable, bookmarksTable
│       ├── comments.ts                # commentsTable (Phase 4)
│       ├── groups.ts                  # groupsTable, groupMembersTable, groupPostsTable (Phase 5)
│       └── notifications.ts           # notificationsTable (Phase 6)
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

### notifications

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| user_id | integer | NOT NULL, FK → users.id CASCADE |
| actor_id | integer | NOT NULL, FK → users.id CASCADE |
| type | text | NOT NULL (enum: see NotificationType) |
| entity_type | text | NOT NULL (enum: post, comment, group, group_post, user) |
| entity_id | integer | NOT NULL |
| message | text | NOT NULL |
| is_read | boolean | NOT NULL, DEFAULT false |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

**NotificationType values:** `post_liked` · `post_commented` · `comment_replied` · `group_joined` · `group_post_created` · `verification_updated`

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
- `users` ──< `notifications` as recipient (CASCADE delete)
- `users` ──< `notifications` as actor (CASCADE delete)

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

### Notifications (Phase 6)

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | Bearer | Paginated list (newest-first) with actor info. Query: `?limit=20&offset=0` |
| GET | `/notifications/unread-count` | Bearer | `{ unreadCount }` |
| PATCH | `/notifications/:id/read` | Bearer | Mark single as read (idempotent) → returns updated notification |
| PATCH | `/notifications/read-all` | Bearer | Mark all unread as read → `{ updatedCount }` |

**Notification triggers:**

| Action | Recipient | Type |
|---|---|---|
| User A likes User B's post | User B | `post_liked` |
| User A comments on User B's post (top-level) | User B | `post_commented` |
| User A replies to User B's comment | User B | `comment_replied` |
| User A joins a group | All existing group members | `group_joined` |
| User A creates a group post | All group members (excl. poster) | `group_post_created` |

**Notification rules:**
- Never notifies users about their own actions
- Notifications are fire-and-forget (`void`) — they don't block the primary response
- Users can only read and mark their own notifications (403 otherwise)
- Marking an already-read notification is idempotent (no error)
- `read-all` returns `{ updatedCount }` — number of notifications actually updated

**Notification response shape:**
```json
{
  "id": 1,
  "type": "post_liked",
  "entityType": "post",
  "entityId": 5,
  "message": "liked your post",
  "isRead": false,
  "actor": {
    "id": 3,
    "name": "Ravi Mehta",
    "role": "caregiver",
    "profilePhotoUrl": null
  },
  "createdAt": "2026-06-05T...",
  "updatedAt": "2026-06-05T..."
}
```

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
| Phase 6 | Notifications | ✅ Complete |
| Phase 7 | Direct Messages | Planned |
| Phase 7 | Cognie AI integration | Planned |
| Phase 8 | Admin endpoints (verify/reject MDs, moderate content) | Planned |
| Phase 8 | File uploads (Object Storage) | Planned |
| Phase 8 | Events & RSVPs | Planned |
| Phase 8 | Survivor Stories | Planned |
