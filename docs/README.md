# CereOnco Community API

A modular REST API backend for the CereOnco Community platform — supporting cancer patients, caregivers, and medical professionals.

## Stack

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
| Build | esbuild |
| Package manager | pnpm workspaces |

## Base URL

```
https://<your-domain>/api
```

## Interactive Docs

Swagger UI is available at:

```
https://<your-domain>/api/docs
```

---

## Setup & Running

### Prerequisites

- Node.js 24+
- pnpm
- PostgreSQL (or use Replit's managed database)

### Environment Variables

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SESSION_SECRET=your-secret-key-here
PORT=5000
NODE_ENV=development
```

### Install Dependencies

```bash
pnpm install
```

### Push Database Schema

```bash
pnpm --filter @workspace/db run push
```

### Start Development Server

```bash
pnpm --filter @workspace/api-server run dev
```

---

## API Endpoints

### Health

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/healthz` | No | Server health check |

### Authentication

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register a new user |
| POST | `/api/auth/login` | No | Login and get JWT |
| POST | `/api/auth/logout` | Optional Bearer | Logout (client deletes token) |

### Users

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/users/me` | Bearer | Get current user profile |
| PATCH | `/api/users/me` | Bearer | Update current user profile |
| GET | `/api/users/:id` | No | Get any user's public profile |

### Posts

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/posts` | Optional | Get feed (newest first, includes `commentCount`) |
| POST | `/api/posts` | Bearer | Create a post |
| GET | `/api/posts/:id` | Optional | Get a single post (includes `commentCount`) |
| PATCH | `/api/posts/:id` | Bearer | Update own post |
| DELETE | `/api/posts/:id` | Bearer | Delete own post |
| POST | `/api/posts/:id/like` | Bearer | Like a post |
| DELETE | `/api/posts/:id/like` | Bearer | Unlike a post |
| POST | `/api/posts/:id/bookmark` | Bearer | Bookmark a post |
| DELETE | `/api/posts/:id/bookmark` | Bearer | Remove bookmark |

### Comments

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/posts/:id/comments` | Bearer | Get threaded comments for a post |
| POST | `/api/posts/:id/comments` | Bearer | Add a comment or reply |
| PATCH | `/api/comments/:id` | Bearer | Edit own comment |
| DELETE | `/api/comments/:id` | Bearer | Soft-delete own comment |

---

## Response Format

All responses follow a consistent envelope:

**Success:**
```json
{
  "success": true,
  "message": "...",
  "data": {}
}
```

**Error:**
```json
{
  "success": false,
  "message": "Error description"
}
```

---

## User Roles

| Role | Description |
|---|---|
| `patient` | Cancer patient (default) |
| `caregiver` | Family member / supporter |
| `medical_professional` | Oncologist, nurse, researcher etc. |
| `admin` | Internal team — full access |

---

## Verification Statuses (medical_professional only)

| Status | Description |
|---|---|
| `none` | Not submitted (default) |
| `pending` | License submitted, awaiting review |
| `approved` | Verified medical professional |
| `rejected` | Verification denied |

> **Auto-pending rule:** When a `medical_professional` submits `medicalLicenseNumber` for the first time (status = `none`), the server automatically transitions status to `pending`.

---

## Comments — Design

### POST /api/posts/:id/comments

**Top-level comment:**
```json
{ "content": "My comment" }
```

**Reply to a comment:**
```json
{ "content": "Reply text", "parentCommentId": 123 }
```

### GET /api/posts/:id/comments — Response

Returns top-level comments with nested replies:

```json
{
  "comments": [
    {
      "id": 1,
      "postId": 5,
      "userId": 3,
      "content": "Great post!",
      "parentCommentId": null,
      "isDeleted": false,
      "author": { "id": 3, "name": "Ananya", "role": "patient", "avatarUrl": null },
      "replyCount": 2,
      "replies": [
        {
          "id": 2,
          "content": "[deleted]",
          "parentCommentId": 1,
          "isDeleted": true,
          "author": null,
          ...
        },
        {
          "id": 3,
          "content": "Thanks for the support!",
          "parentCommentId": 1,
          "isDeleted": false,
          "author": { ... },
          ...
        }
      ],
      ...
    }
  ],
  "total": 1
}
```

### Soft Delete

Deleting a comment sets `isDeleted = true`. The comment row is kept so reply threads are never broken. In responses:
- `content` → `"[deleted]"`
- `author` → `null`
- `userId` → `null`
- `replyCount` and `replies` still reflect the thread correctly

### commentCount on Posts

Feed (`GET /api/posts`) and single post (`GET /api/posts/:id`) both include `commentCount` — the count of all non-deleted comments (top-level + replies).

---

## PATCH /api/users/me — Request Body

All fields optional. Send only what you want to change.

```json
{
  "name": "string",
  "bio": "string",
  "location": "string",
  "avatarUrl": "string",
  "profilePhotoUrl": "string",
  "onboardingCompleted": true,
  "cancerType": "string",
  "treatmentStage": "string",
  "interests": ["string"],
  "specialty": "string",
  "hospitalAffiliation": "string",
  "medicalLicenseNumber": "string"
}
```

---

## Postman Testing Guide

### 1. Import the Collection

Import `docs/postman-collection.json` into Postman.

### 2. Set the Base URL

In the collection variables, set:
- `base_url`: `https://<your-domain>/api`

### 3. Test Sequence

**Step 1 — Health check**
```
GET {{base_url}}/healthz
```

**Step 2 — Register (patient)**
```
POST {{base_url}}/auth/register
Body: { "name": "Ananya Sharma", "email": "ananya@example.com", "password": "password123", "role": "patient" }
```
Token auto-saves to `token`.

**Step 3 — Register (second user)**
```
POST {{base_url}}/auth/register
Body: { "name": "Ravi Mehta", "email": "ravi@example.com", "password": "password123", "role": "caregiver" }
```
Token auto-saves to `token2`.

**Step 4 — Create Post** (uses `token`) → `post_id` auto-saved

**Step 5 — POST comment** (uses `token`) → `comment_id` auto-saved

**Step 6 — POST reply** (uses `token2`, sends `parentCommentId: {{comment_id}}`)

**Step 7 — GET comments** — verify threaded structure

**Step 8 — PATCH comment** (uses `token`) — edit own comment

**Step 9 — DELETE comment** (uses `token2`) — soft delete reply

**Step 10 — GET comments again** — verify deleted reply shows `[deleted]`, thread intact

**Step 11 — GET single post** — verify `commentCount` is correct

---

## Architecture Decisions

- **OpenAPI-first**: `lib/api-spec/openapi.yaml` is the single source of truth. Zod schemas are code-generated — never hand-written.
- **Response envelope**: All routes return `{ success, message, data }` for consistent client handling.
- **Optional auth on feed**: Feed and single-post endpoints accept optional Bearer tokens for per-user `isLiked`/`isBookmarked` state.
- **Auto-pending verification**: Submitting `medicalLicenseNumber` when status is `none` automatically sets it to `pending`.
- **Soft delete on comments**: Comments are never hard-deleted so reply threads are preserved. Deleted content is masked in all responses.
- **commentCount via FILTER**: Uses PostgreSQL `COUNT(...) FILTER (WHERE NOT is_deleted)` for efficient per-post comment counts in the same feed query.
- **Cascade deletes**: Deleting a user removes all their posts + comments. Deleting a post removes all its comments (CASCADE). Deleting a parent comment sets child `parentCommentId` to NULL (SET NULL).
- **JWT expiry**: 7 days. Logout is client-side.

## Future Modules (Phase 5+)

- Admin endpoints (verify/reject MDs, moderate content)
- Groups
- Direct Messages
- Notifications (real-time)
- Cognie AI integration
- File uploads
