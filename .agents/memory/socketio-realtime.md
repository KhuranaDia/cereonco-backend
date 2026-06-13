---
name: Socket.IO real-time layer (api-server)
description: How real-time messaging is wired so it survives the proxy and stays consistent with REST
---

Real-time messaging shares the Express HTTP server; it is not a separate service.

**Why these choices:**
- **One shared `http.createServer(app)`** — Express + Socket.IO listen on the same
  `PORT`. Render terminates WebSockets on the service's single port with no extra
  config, and the Replit preview proxy only routes the api-server's `/api` path.
- **Path must be `/api/socket.io`** (not default `/socket.io`). The api-server owns
  only `/api` in the reverse proxy, so the default path 404s behind the preview proxy.
- **Persist-then-emit** — DB write happens before any socket emit, so REST stays the
  durable source of truth and offline users get full history on reconnect (no offline
  queue needed beyond the DB).
- **Shared service module** — `services/messages.ts` holds the create/send/mark-read
  logic and the emits; BOTH the REST routes and the socket handlers call it, so the two
  transports can never diverge.

**How to apply:** Room model = personal room `user:<id>` (emit to all a user's devices,
e.g. `messageReceived`/presence) + per-chat room `conversation:<id>` joined via
`joinConversation` after a membership check (emit `newMessage`/`typing`/`messageRead`).
Presence is a process-local in-memory map (no Redis) — it resets on restart and is NOT
shared across multiple instances; if the deploy is ever scaled past one instance,
presence/typing need a Socket.IO adapter (e.g. Redis). esbuild bundles socket.io without
extra config (native `bufferutil`/`utf-8-validate` already externalized in build.mjs).
