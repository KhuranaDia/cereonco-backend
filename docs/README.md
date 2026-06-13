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

```
https://<your-domain>/api/docs
```

---

## Setup & Running

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SESSION_SECRET=your-secret-key-here
PORT=5000
NODE_ENV=development
```

```bash
pnpm install
pnpm --filter @workspace/db run push
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
| POST | `/api/auth/register` | No | Register a new user (passwordless — sends setup email) |
| POST | `/api/auth/set-password` | No | Set password via setup token, verifies account |
| POST | `/api/auth/login` | No | Login and get JWT |
| POST | `/api/auth/logout` | Optional | Logout (client deletes token) |

#### Passwordless registration flow

Registration no longer collects a password. The flow is:

1. **Register** with profile fields only (no password):
   ```json
   POST /api/auth/register
   {
     "name": "Asha Rao",
     "email": "asha@example.com",
     "country_code": "+91",
     "phone_number": "9876543210",
     "role": "medical_professional",
     "specialty": "Oncology"
   }
   ```
   - `name`, `email`, `role` are required. `country_code`, `phone_number`, `specialty` are optional.
   - No password is collected from the frontend. The backend internally generates a random temporary password hash so the account is always login-capable.
   - The user is **logged in immediately**: response data is `{ user, token }` (JWT). In non-production (`NODE_ENV !== "production"`) the response also includes `setupToken` for testing convenience — never in production.
   - A single-use, 24-hour password-setup token is also generated (only its SHA-256 hash is stored) and a setup link is emailed. **Until SMTP is configured, the link is logged** (via pino, never `console.log`).

2. **Set password** using the token from the email link:
   ```json
   POST /api/auth/set-password
   { "token": "<token-from-link>", "password": "NewPass123" }
   ```
   - Validates token + expiry, bcrypt-hashes the password, sets `emailVerified = true`, clears `passwordSetupToken` + `passwordSetupTokenExpiresAt`.
   - Returns `{ token, user }` (auto-login JWT). Token is single-use — reusing it returns `400`.

3. **Login** works for any registered user with a password — email verification is independent and does not block login.

**Email/SMTP config (optional):** set `SMTP_HOST` + `SMTP_USER` to enable real delivery; `FRONTEND_URL` (or `APP_BASE_URL`) controls the link base (defaults to `http://localhost:5173`).

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
| GET | `/api/posts/:id` | Optional | Get a single post |
| PATCH | `/api/posts/:id` | Bearer | Update own post |
| DELETE | `/api/posts/:id` | Bearer | Delete own post |
| POST | `/api/posts/:id/like` | Bearer | Like a post |
| DELETE | `/api/posts/:id/like` | Bearer | Unlike a post |
| POST | `/api/posts/:id/bookmark` | Bearer | Bookmark a post |
| DELETE | `/api/posts/:id/bookmark` | Bearer | Remove bookmark |

### Comments

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/posts/:id/comments` | Bearer | Get threaded comments |
| POST | `/api/posts/:id/comments` | Bearer | Add comment or reply |
| PATCH | `/api/comments/:id` | Bearer | Edit own comment |
| DELETE | `/api/comments/:id` | Bearer | Soft-delete own comment |

### Groups

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/groups` | Bearer | List all groups with `memberCount` + `isMember` |
| GET | `/api/groups/:id` | Bearer | Single group detail |
| POST | `/api/groups/:id/join` | Bearer | Join a group |
| DELETE | `/api/groups/:id/join` | Bearer | Leave a group |
| GET | `/api/groups/:id/posts` | Bearer | Group feed (paginated, newest-first) |
| POST | `/api/groups/:id/posts` | Bearer | Create a group post |
| PATCH | `/api/groups/posts/:postId` | Bearer | Edit own group post |
| DELETE | `/api/groups/posts/:postId` | Bearer | Delete own group post |

---

## Response Format

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

## Groups — Design

### Group Object

```json
{
  "id": 1,
  "name": "Breast Cancer Warriors",
  "description": "A supportive community for breast cancer patients and survivors",
  "category": "breast_cancer",
  "imageUrl": null,
  "memberCount": 42,
  "isMember": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

`isMember` reflects the authenticated user's current membership status.

### Join / Leave

```
POST /api/groups/:id/join     → { joined: true,  memberCount: 43 }
DELETE /api/groups/:id/join   → { joined: false, memberCount: 42 }
```

Joining twice is idempotent — no duplicate rows created.

### Group Feed

```
GET /api/groups/:id/posts?limit=20&offset=0
```

Returns `{ posts: [...], total: N }`. Each post includes full author info.

### Group Post CRUD

```
POST   /api/groups/:id/posts          → 201 created post with author
PATCH  /api/groups/posts/:postId      → updated post (owner only, else 403)
DELETE /api/groups/posts/:postId      → 204 (owner only, else 403)
```

---

## Comments — Design

### Threading

- Top-level comment: `parentCommentId` omitted
- Reply: `parentCommentId: <id>`
- `GET /posts/:id/comments` returns top-level comments with nested `replies[]`

### Soft Delete

Content → `"[deleted]"`, author → `null`. Thread structure preserved.

### commentCount on Posts

`commentCount` on all post responses counts only non-deleted comments (top-level + replies).

---

## Architecture Decisions

- **OpenAPI-first**: `lib/api-spec/openapi.yaml` is the single source of truth. Zod schemas are code-generated — never hand-written.
- **Response envelope**: All routes return `{ success, message, data }`.
- **Optional auth on feed**: Feed and single-post endpoints accept optional Bearer tokens for per-user `isLiked`/`isBookmarked` state.
- **Auto-pending verification**: Submitting `medicalLicenseNumber` when status is `none` auto-transitions to `pending`.
- **Soft delete on comments**: Comments never hard-deleted; threads preserved.
- **commentCount via FILTER**: Uses `COUNT(...) FILTER (WHERE NOT is_deleted)` in the same JOIN.
- **Idempotent joins**: `onConflictDoNothing()` on group membership and post likes.
- **JWT expiry**: 7 days. Logout is client-side (stateless).

## Notifications (Phase 6)

### Fetch notifications

```
GET /api/notifications?limit=20&offset=0
Authorization: Bearer <token>
```

Returns `{ notifications: [...], total: N, unreadCount: N }`.

### Unread count

```
GET /api/notifications/unread-count
Authorization: Bearer <token>
```

### Mark single as read

```
PATCH /api/notifications/:id/read
Authorization: Bearer <token>
```

Idempotent. Returns updated notification object.

### Mark all as read

```
PATCH /api/notifications/read-all
Authorization: Bearer <token>
```

Returns `{ updatedCount: N }`.

### Triggers

| Action | Recipient | Type |
|---|---|---|
| Like a post | Post author | `post_liked` |
| Comment on a post | Post author | `post_commented` |
| Reply to a comment | Comment author | `comment_replied` |
| Join a group | Existing group members | `group_joined` |
| Create a group post | Group members (excl. poster) | `group_post_created` |

Users are never notified about their own actions.

---

## Messages (Phase 7)

Direct (1:1) messaging between users. A conversation is uniquely identified by its
participant pair; participant IDs are normalized (`userOneId = min`, `userTwoId = max`)
so `(A,B)` and `(B,A)` resolve to the same conversation.

### Create or get a conversation

```
POST /api/messages/conversations
Authorization: Bearer <token>
{ "recipientId": 2 }
```

Returns the `Conversation` (`201`). Idempotent — returns the existing conversation if
one already exists. Returns `400` when messaging yourself, `404` when the recipient
does not exist.

### List conversations

```
GET /api/messages/conversations
Authorization: Bearer <token>
```

Returns `{ conversations: [...], total: N }`, newest-updated first. Each conversation
includes the other `participant`, the `lastMessage` (or `null`), and `unreadCount`.

### Get messages in a conversation

```
GET /api/messages/conversations/:conversationId
Authorization: Bearer <token>
```

Returns `{ messages: [...], total: N }`, oldest-first. `403` if you are not a participant.

### Send a message

```
POST /api/messages/conversations/:conversationId
Authorization: Bearer <token>
{ "content": "Hello", "mediaUrls": ["https://..."] }
```

Returns the created `Message` (`201`). `403` if you are not a participant. Touches the
conversation's `updatedAt` so it sorts to the top of the list.

### Mark conversation as read

```
PATCH /api/messages/conversations/:conversationId/read
Authorization: Bearer <token>
```

Marks only messages received by the current user as read. Returns
`{ updatedCount: N, unreadCount: 0 }`.

### Unread message count

```
GET /api/messages/unread-count
Authorization: Bearer <token>
```

Returns `{ unreadCount: N }` across all conversations.

---

## Future Modules (Phase 8+)

- Cognie AI integration
- Admin endpoints (verify/reject MDs, moderate content)
- File uploads
- Events & RSVPs
