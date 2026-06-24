# CereOnco Community API — Project Status

**Last updated:** 22 June 2026
**Status:** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 ✅ · Phase 6 ✅ · Phase 7 ✅ · Phase 8 ✅

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
- **Real-Time Messaging (Phase 7)**:
  - 1:1 direct messaging with one conversation per user pair (normalized participant pair)
  - REST endpoints: create/get conversation, list conversations (participant + lastMessage + unreadCount), get messages, send (fallback), mark read, unread count
  - **Socket.IO** on the same server/port (path `/api/socket.io`), JWT handshake auth
  - Live events: `newMessage`, `messageReceived`, `messageRead`, `typing`/`stopTyping`, `userOnline`/`userOffline`, `onlineUsers`
  - Messages persist to PostgreSQL first, then emit — offline recipients get history on reconnect
  - In-memory presence map (no Redis); typing is never persisted
- **File Uploads, Groups, Notifications & Events (Phase 8)**:
  - Avatar upload on `PATCH /users/me` (`multipart/form-data`, `avatar` field, ≤5 MB) — sets both `avatarUrl` and `profilePhotoUrl`
  - Post media upload on `POST /posts` (`multipart/form-data`, up to 10 `media` files, ≤10 MB each); files served from `/uploads/...`
  - Saved posts: `GET /posts/saved` returns the user's bookmarked posts (newest-saved first)
  - Group creation: `POST /groups` (creator auto-joins); `tagline` field on all group responses
  - Grouped posts: posts carry optional `groupId`; the main feed excludes grouped posts (`groupId IS NULL`)
  - Notification filters: `GET /notifications/unread`, `/mentioned`, `/system`
  - Consistent delete envelope: post / comment / group post / event deletes return `{ success, message: "Deleted successfully", data: {} }`
  - Events & RSVPs: full event CRUD (creator-only update/delete), upcoming-first list with `creator`, `rsvpCount`, `myRsvpStatus`; idempotent RSVP set/remove
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
| Real-time | Socket.IO (shared HTTP server) |
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
│           │   ├── optionalAuth.ts    # optionalAuth
│           │   └── upload.ts          # multer (avatar/post media) + publicUrl (Phase 8)
│           ├── routes/
│           │   ├── index.ts              # Mounts all routers
│           │   ├── health.ts             # GET /api/healthz
│           │   ├── auth.ts               # Auth endpoints
│           │   ├── users.ts              # User profile endpoints (+ avatar upload)
│           │   ├── posts.ts              # Posts + likes + bookmarks + saved + media
│           │   ├── comments.ts           # Comments + replies (Phase 4)
│           │   ├── groups.ts             # Community groups (Phase 5, + create/tagline)
│           │   ├── notifications.ts      # Notifications (Phase 6, + filters)
│           │   ├── messages.ts           # Messages REST (Phase 7)
│           │   ├── events.ts             # Events & RSVPs (Phase 8)
│           │   └── docs.ts               # Swagger UI
│           ├── services/
│           │   └── messages.ts           # Shared message ops + socket emit (Phase 7)
│           ├── socket/
│           │   ├── index.ts              # Socket.IO init, JWT handshake, event handlers
│           │   ├── io.ts                 # io singleton + emit helpers
│           │   └── onlineUsers.ts        # In-memory presence map
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
│       ├── groups.ts                  # groupsTable (+ tagline), groupMembersTable, groupPostsTable (Phase 5)
│       ├── notifications.ts           # notificationsTable (Phase 6)
│       └── events.ts                  # eventsTable, eventRsvpsTable (Phase 8)
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
| password_hash | text | nullable (set via /auth/set-password) |
| role | text | NOT NULL, DEFAULT 'patient' |
| country_code | text | nullable |
| phone_number | text | nullable |
| email_verified | boolean | NOT NULL, DEFAULT false |
| password_setup_token | text | nullable (SHA-256 hash of setup token) |
| password_setup_token_expires_at | timestamptz | nullable |
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
| group_id | integer | nullable, FK → groups.id CASCADE (grouped posts excluded from main feed) |
| content | text | NOT NULL |
| image_url | text | nullable |
| media_urls | text[] | nullable |
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
| tagline | text | nullable |
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

**NotificationType values:** `post_liked` · `post_commented` · `comment_replied` · `group_joined` · `group_post_created` · `verification_updated` · `mention` · `system`

**EntityType values:** `post` · `comment` · `group` · `group_post` · `user` · `event`

### events

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| title | text | NOT NULL |
| description | text | nullable |
| event_date | timestamptz | NOT NULL |
| location | text | nullable |
| image_url | text | nullable |
| created_by | integer | NOT NULL, FK → users.id CASCADE |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

### event_rsvps

| Column | Type | Constraints |
|---|---|---|
| id | serial | PRIMARY KEY |
| event_id | integer | NOT NULL, FK → events.id CASCADE |
| user_id | integer | NOT NULL, FK → users.id CASCADE |
| status | text | NOT NULL, DEFAULT 'going' (going / interested / not_going) |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| — | — | UNIQUE (event_id, user_id) |

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
- `groups` ──< `posts` (CASCADE delete; optional `group_id`)
- `users` ──< `events` as creator (CASCADE delete)
- `events` ──< `event_rsvps` (CASCADE delete)
- `users` ──< `event_rsvps` (CASCADE delete)

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
| POST | `/auth/register` | No | `{ name, email, role, country_code?, phone_number?, specialty? }` | `{ user }` (passwordless — emails setup link) |
| POST | `/auth/set-password` | No | `{ token, password }` | `{ token, user }` (verifies + auto-login) |
| POST | `/auth/forgot-password` | No | `{ email }` | generic success (emails reset link if user exists; reuses set-password) |
| POST | `/auth/login` | No | `{ email, password }` | `{ token, user }` |
| POST | `/auth/logout` | Optional | — | success |
| POST | `/auth/test-email` | Admin | `{ to }` | `{ messageId, accepted, rejected, response }` (verifies SMTP) |

### Users

| Method | Route | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/users/me` | Bearer | — | Full user object |
| PATCH | `/users/me` | Bearer | See profile fields (JSON or multipart `image`/`avatar` file, ≤20 MB) | Updated user (`imageUrl`+`avatarUrl`+`profilePhotoUrl` mirrored) |
| GET | `/users/search` | Bearer | `?q=&limit=20&offset=0` (q ≥2 chars) | `{ users: [...safe fields incl. imageUrl], total }` |
| GET | `/users/:id` | No | — | Full user object |

### Posts

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/posts` | Optional | Feed with `commentCount`, `likeCount`, `bookmarkCount`, `isLiked`, `isBookmarked` (ungrouped only) |
| POST | `/posts` | Bearer | Create post (JSON or multipart `media` files ≤50 MB, up to 10; optional `groupId`) |
| GET | `/posts/saved` | Bearer | Current user's bookmarked posts (newest-saved first) |
| GET | `/posts/:id` | Optional | Single post with all counts |
| PATCH | `/posts/:id` | Bearer | Update own post (JSON, or multipart `remainingMedia` + `media` to merge media) |
| DELETE | `/posts/:id` | Bearer | Delete own post → `{ message: "Deleted successfully", data: {} }` |
| POST | `/posts/:id/like` | Bearer | Like → `{ liked: true, likeCount }` |
| DELETE | `/posts/:id/like` | Bearer | Unlike → `{ liked: false, likeCount }` |
| POST | `/posts/:id/bookmark` | Bearer | Bookmark → `{ bookmarked: true }` |
| DELETE | `/posts/:id/bookmark` | Bearer | Unbookmark → `{ bookmarked: false }` |

### Comments

| Method | Route | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/posts/:id/comments` | Bearer | — | `{ comments, total }` — threaded; each has `mentionedUserId` + `mentionedUserName` |
| POST | `/posts/:id/comments` | Bearer | `{ content, parentCommentId?, mentionedUserId? }` | Created comment (mention → `mention` notification) |
| PATCH | `/comments/:id` | Bearer | `{ content }` | Updated comment |
| DELETE | `/comments/:id` | Bearer | — | `{ message: "Deleted successfully", data: {} }` (soft delete) |

### Groups (Phase 5)

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/groups` | Bearer | List all groups with `memberCount`, `isMember`, `tagline` |
| POST | `/groups` | Bearer | Create group → 201 (creator auto-joins) |
| GET | `/groups/:id` | Bearer | Single group detail |
| POST | `/groups/:id/join` | Bearer | Join group → `{ joined: true, memberCount }` |
| DELETE | `/groups/:id/join` | Bearer | Leave group → `{ joined: false, memberCount }` |
| GET | `/groups/:id/posts` | Bearer | Group feed (paginated, newest-first, with author) |
| POST | `/groups/:id/posts` | Bearer | Create group post → 201 |
| PATCH | `/groups/posts/:postId` | Bearer | Edit own group post |
| DELETE | `/groups/posts/:postId` | Bearer | Delete own group post → `{ message: "Deleted successfully", data: {} }` |

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
| GET | `/notifications/unread` | Bearer | Only unread notifications (paginated) |
| GET | `/notifications/mentioned` | Bearer | Only `mention`-type notifications (paginated) |
| GET | `/notifications/system` | Bearer | Only `system`-type notifications (paginated) |
| POST | `/notifications/seed-system` | Bearer | Seed demo `system` notifications (idempotent) → `{ created }` |
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
| User A mentions User B in a comment | User B | `mention` |
| `POST /notifications/seed-system` (demo helper) | Current user | `system` |

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

### Events & RSVPs (Phase 8)

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/events` | Bearer | List events (upcoming-first by `eventDate`) with `creator`, `rsvpCount`, `myRsvpStatus` |
| POST | `/events` | Bearer | Create event → 201 |
| GET | `/events/:id` | Bearer | Single event detail |
| PATCH | `/events/:id` | Bearer | Update own event (creator only, else 403) |
| DELETE | `/events/:id` | Bearer | Delete own event → `{ message: "Deleted successfully", data: {} }` |
| PUT | `/events/:id/rsvp` | Bearer | Set/update RSVP `{ status? }` → `{ rsvpCount, myRsvpStatus }` |
| DELETE | `/events/:id/rsvp` | Bearer | Remove RSVP → `{ rsvpCount, myRsvpStatus: null }` |

**Event rules:**
- All event endpoints require authentication (Bearer token)
- Only the creator can update or delete an event (403 otherwise)
- RSVP is idempotent — one row per `(event_id, user_id)`; `PUT` upserts the status
- `status` defaults to `going`; valid values: `going`, `interested`, `not_going`
- `myRsvpStatus` is the current user's own status (or `null`); `rsvpCount` is the total

### Uploads & Delete Envelope (Phase 8)

- **Avatar:** `PATCH /users/me` accepts `multipart/form-data` with an `avatar` file (≤5 MB, jpg/jpeg/png/webp) — stored URL set on both `avatarUrl` + `profilePhotoUrl`
- **Post media:** `POST /posts` accepts up to 10 `media` files (≤10 MB each; images or mp4/mov/webm); appended to `mediaUrls`
- Files are served statically from `/uploads/avatars/...` and `/uploads/posts/...`
- **Delete envelope:** all resource deletes (post, comment, group post, event) return `{ success: true, message: "Deleted successfully", data: {} }`

## 6. Authentication Flow

**Passwordless registration (Phase 7):**

1. **Register** → no password collected from the frontend. Backend generates a random temporary password hash, emails (or logs) a 24h single-use setup link, and **issues a JWT immediately** — returns `{ user, token }` (auto-login).
2. **Set Password** → validates token + expiry, bcrypt-hashes password, sets `email_verified = true`, clears `password_setup_token` + `password_setup_token_expires_at`, returns JWT (7-day) + user (auto-login).
3. **Login** → verifies bcrypt hash, returns JWT + user. Email verification is independent and does NOT block login.
4. **Authenticated requests** → `Authorization: Bearer <token>` header
5. **Logout** → client deletes the token (stateless)

**Setup token security:** only the SHA-256 hash of the token is stored, so a DB leak cannot be replayed. The raw token lives only in the email link. SMTP is pluggable via `SMTP_HOST`/`SMTP_USER`; until configured the link is logged via pino (never `console.log`). In non-production, register also returns `setupToken` for testing.

---

## 7. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | JWT signing secret |
| `PORT` | Yes | Server port (set by Replit workflow) |
| `NODE_ENV` | No | `development` / `production` |
| `FRONTEND_URL` | No | Base URL for the password-setup link (default `http://localhost:5173`); `APP_BASE_URL` also accepted |
| `SMTP_HOST` | No | SMTP host — enables real nodemailer delivery when set |
| `SMTP_PORT` | No | SMTP port (default `587`; `465` = implicit TLS, else STARTTLS) |
| `SMTP_USER` | No | SMTP username/credential |
| `SMTP_PASS` | No | SMTP password (alias: `SMTP_PASSWORD`; `SMTP_PASS` wins if both set) |
| `SMTP_PASSWORD` | No | SMTP password (alias of `SMTP_PASS`) |
| `SMTP_FROM` | No | From address; falls back to `SMTP_USER` |

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
| Phase 7 | Real-Time Direct Messaging (Socket.IO) | ✅ Done |
| Phase 8 | File uploads (avatar + post media via multer) | ✅ Complete |
| Phase 8 | Groups create + tagline, grouped posts, saved posts | ✅ Complete |
| Phase 8 | Notification filters (unread/mentioned/system) | ✅ Complete |
| Phase 8 | Events & RSVPs | ✅ Complete |
| Phase 9 | Phone/OTP verification (Twilio) | Planned |
| Phase 9 | Cognie AI integration | Planned |
| Phase 9 | Admin endpoints (verify/reject MDs, moderate content) | Planned |
| Phase 9 | Survivor Stories | Planned |
