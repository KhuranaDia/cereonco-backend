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

The server starts on `$PORT` (default 5000 in dev).

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
| POST | `/api/auth/logout` | No | Logout (client deletes token) |

### Users

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/users/me` | Bearer | Get current user profile |
| PATCH | `/api/users/me` | Bearer | Update current user profile |
| GET | `/api/users/:id` | No | Get any user's public profile |

### Posts

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/posts` | Optional | Get feed (newest first) |
| POST | `/api/posts` | Bearer | Create a post |
| GET | `/api/posts/:id` | Optional | Get a single post |
| PATCH | `/api/posts/:id` | Bearer | Update own post |
| DELETE | `/api/posts/:id` | Bearer | Delete own post |
| POST | `/api/posts/:id/like` | Bearer | Like a post |
| DELETE | `/api/posts/:id/like` | Bearer | Unlike a post |
| POST | `/api/posts/:id/bookmark` | Bearer | Bookmark a post |
| DELETE | `/api/posts/:id/bookmark` | Bearer | Remove bookmark |

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
Expected: `{ "status": "ok" }`

**Step 2 — Register**
```
POST {{base_url}}/auth/register
Body: { "name": "Dia", "email": "dia@example.com", "password": "password123", "role": "patient" }
```
Copy the `data.token` from the response.

**Step 3 — Set Token**
In Postman, set the collection variable `token` to the JWT from step 2.

**Step 4 — Get Profile**
```
GET {{base_url}}/users/me
Headers: Authorization: Bearer {{token}}
```

**Step 5 — Create Post**
```
POST {{base_url}}/posts
Headers: Authorization: Bearer {{token}}
Body: { "content": "Hello CereOnco community!" }
```
Copy the `data.id` from the response as `post_id`.

**Step 6 — Like the Post**
```
POST {{base_url}}/posts/{{post_id}}/like
Headers: Authorization: Bearer {{token}}
```

**Step 7 — Bookmark the Post**
```
POST {{base_url}}/posts/{{post_id}}/bookmark
Headers: Authorization: Bearer {{token}}
```

**Step 8 — Get Feed**
```
GET {{base_url}}/posts
Headers: Authorization: Bearer {{token}}
```

---

## Architecture Decisions

- **OpenAPI-first**: The `lib/api-spec/openapi.yaml` is the single source of truth. Zod validation schemas are code-generated from it — never hand-written.
- **Response envelope**: All routes return `{ success, message, data }` for consistent client handling.
- **Optional auth on feed**: The feed and single-post endpoints accept optional Bearer tokens to return per-user `isLiked` / `isBookmarked` state when authenticated.
- **Cascade deletes**: Deleting a user removes all their posts, likes, and bookmarks. Deleting a post removes all its likes and bookmarks.
- **JWT expiry**: Tokens expire after 7 days. Logout is client-side (delete the token).

## Future Modules (Phase 3+)

- Comments & Replies
- Groups
- Direct Messages
- Notifications
- Admin Dashboard
- Cognie AI integration
- File uploads (OCI Object Storage)
