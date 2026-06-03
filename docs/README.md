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

## Verification Statuses (medical_professional only)

| Status | Description |
|---|---|
| `none` | Not submitted (default) |
| `pending` | License submitted, awaiting review |
| `approved` | Verified medical professional |
| `rejected` | Verification denied |

> **Auto-pending rule:** When a `medical_professional` submits their `medicalLicenseNumber` for the first time (and `verificationStatus` is currently `none`), the server automatically transitions status to `pending`.

---

## User Profile Fields

### Common (all roles)

| Field | Type | Updatable | Description |
|---|---|---|---|
| `name` | string | Yes | Display name |
| `bio` | string \| null | Yes | Short bio |
| `location` | string \| null | Yes | City / country |
| `avatarUrl` | string \| null | Yes | Legacy avatar URL |
| `profilePhotoUrl` | string \| null | Yes | Profile photo URL |
| `onboardingCompleted` | boolean | Yes | Onboarding flow flag |
| `role` | UserRole | No (set at register) | User role |
| `verificationStatus` | VerificationStatus | Auto / admin | MD verification state |

### Patient / Caregiver

| Field | Type | Updatable | Description |
|---|---|---|---|
| `cancerType` | string \| null | Yes | Cancer type / diagnosis |
| `treatmentStage` | string \| null | Yes | e.g. `remission`, `active_treatment` |
| `interests` | string[] \| null | Yes | Topic interests array |

### Medical Professional

| Field | Type | Updatable | Description |
|---|---|---|---|
| `specialty` | string \| null | Yes | Medical specialty |
| `hospitalAffiliation` | string \| null | Yes | Hospital or institution |
| `medicalLicenseNumber` | string \| null | Yes | License number (triggers auto-pending) |

---

## PATCH /api/users/me — Request Body

All fields are optional. Send only what you want to change.

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
Expected: `{ "status": "ok" }`

**Step 2 — Register (patient)**
```
POST {{base_url}}/auth/register
Body: { "name": "Ananya Sharma", "email": "ananya@example.com", "password": "password123", "role": "patient" }
```
Copy `data.token` — collection auto-saves to `token` variable.

**Step 3 — Register (medical professional)**
```
POST {{base_url}}/auth/register
Body: { "name": "Dr. Priya Nair", "email": "priya@example.com", "password": "password123", "role": "medical_professional" }
```
Copy `data.token` — save as `token_md`.

**Step 4 — Update patient profile (onboarding)**
```
PATCH {{base_url}}/users/me
Authorization: Bearer {{token}}
Body: {
  "cancerType": "Breast Cancer",
  "treatmentStage": "remission",
  "interests": ["support_groups", "nutrition"],
  "onboardingCompleted": true
}
```

**Step 5 — Update MD profile (triggers auto-pending)**
```
PATCH {{base_url}}/users/me
Authorization: Bearer {{token_md}}
Body: {
  "specialty": "Oncology",
  "hospitalAffiliation": "AIIMS Delhi",
  "medicalLicenseNumber": "MH-2024-ON-7831",
  "onboardingCompleted": true
}
```
Expected: `verificationStatus` = `"pending"` in response.

**Step 6 — Get profile (GET /users/me)**
```
GET {{base_url}}/users/me
Authorization: Bearer {{token}}
```

**Step 7 — Get user by ID**
```
GET {{base_url}}/users/1
```

**Step 8 — Create Post**
```
POST {{base_url}}/posts
Authorization: Bearer {{token}}
Body: { "content": "Hello CereOnco community!" }
```
Collection auto-saves `data.id` to `post_id`.

**Step 9 — Like the Post**
```
POST {{base_url}}/posts/{{post_id}}/like
Authorization: Bearer {{token}}
```

**Step 10 — Bookmark the Post**
```
POST {{base_url}}/posts/{{post_id}}/bookmark
Authorization: Bearer {{token}}
```

**Step 11 — Get Feed**
```
GET {{base_url}}/posts
Authorization: Bearer {{token}}
```
Expected: posts with `isLiked: true`, `isBookmarked: true`.

---

## Architecture Decisions

- **OpenAPI-first**: The `lib/api-spec/openapi.yaml` is the single source of truth. Zod validation schemas are code-generated from it — never hand-written.
- **Response envelope**: All routes return `{ success, message, data }` for consistent client handling.
- **Optional auth on feed**: The feed and single-post endpoints accept optional Bearer tokens to return per-user `isLiked` / `isBookmarked` state when authenticated.
- **Auto-pending verification**: When a `medical_professional` submits `medicalLicenseNumber` for the first time, `verificationStatus` is automatically set to `pending` — no separate submission endpoint needed.
- **Cascade deletes**: Deleting a user removes all their posts, likes, and bookmarks. Deleting a post removes all its likes and bookmarks.
- **JWT expiry**: Tokens expire after 7 days. Logout is client-side (delete the token).

## Future Modules (Phase 4+)

- Comments & Replies
- Groups
- Direct Messages
- Notifications
- Admin Dashboard (verification approval/rejection)
- Cognie AI integration
- File uploads (OCI Object Storage)
