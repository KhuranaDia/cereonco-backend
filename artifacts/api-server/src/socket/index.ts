import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { verifyToken } from "../utils/token";
import { logger } from "../lib/logger";
import { setIo, userRoom, conversationRoom } from "./io";
import {
  addUserSocket,
  removeUserSocket,
  getOnlineUserIds,
} from "./onlineUsers";
import {
  loadOwnedConversation,
  sendMessageToConversation,
  markConversationRead,
} from "../services/messages";

type Ack = ((response: unknown) => void) | undefined;

function call(ack: Ack, response: unknown): void {
  if (typeof ack === "function") ack(response);
}

/**
 * Wrap an async socket handler so an unexpected error (DB outage, bug) is
 * logged and reported back via ack instead of surfacing as an unhandled
 * rejection that could tear down the connection.
 */
function safeHandler(
  event: string,
  handler: (payload: unknown, ack: Ack) => Promise<void>,
): (payload: unknown, ack: Ack) => void {
  return (payload, ack) => {
    handler(payload, ack).catch((err: unknown) => {
      logger.error({ err, event }, "Socket handler failed");
      call(ack, { ok: false, error: "Internal server error" });
    });
  };
}

function extractToken(socket: {
  handshake: {
    auth?: Record<string, unknown>;
    headers: Record<string, unknown>;
    query: Record<string, unknown>;
  };
}): string | null {
  const authToken = socket.handshake.auth?.["token"];
  if (typeof authToken === "string" && authToken.length > 0) return authToken;

  const header = socket.handshake.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7);
  }

  const queryToken = socket.handshake.query["token"];
  if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;

  return null;
}

function toConversationId(payload: unknown): number | null {
  const raw = (payload as { conversationId?: unknown } | undefined)
    ?.conversationId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Attach the Socket.IO server to the existing HTTP server. The path is scoped
 * under `/api` so it routes through the same reverse proxy as the REST API
 * (both in the Replit preview and on Render, which terminates WebSockets on the
 * service's single port — no extra config required).
 */
export function initSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/api/socket.io",
    cors: { origin: "*" },
  });
  setIo(io);

  // JWT handshake auth — reuses the same SESSION_SECRET as the REST middleware.
  io.use((socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      next(new Error("Unauthorized: missing token"));
      return;
    }
    try {
      const { userId } = verifyToken(token);
      socket.data.userId = userId;
      next();
    } catch {
      next(new Error("Unauthorized: invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as number;

    // Personal room so we can target all of a user's devices at once.
    socket.join(userRoom(userId));
    const becameOnline = addUserSocket(userId, socket.id);
    if (becameOnline) io.emit("userOnline", { userId });
    // Hand the freshly connected client the current presence snapshot.
    socket.emit("onlineUsers", { userIds: getOnlineUserIds() });

    socket.on(
      "joinConversation",
      safeHandler("joinConversation", async (payload, ack) => {
        const conversationId = toConversationId(payload);
        if (!conversationId) {
          call(ack, { ok: false, error: "Invalid conversationId" });
          return;
        }
        const result = await loadOwnedConversation(conversationId, userId);
        if ("status" in result) {
          call(ack, { ok: false, error: result.message });
          return;
        }
        socket.join(conversationRoom(conversationId));
        call(ack, { ok: true, conversationId });
      }),
    );

    socket.on("leaveConversation", (payload, ack: Ack) => {
      const conversationId = toConversationId(payload);
      if (conversationId) socket.leave(conversationRoom(conversationId));
      call(ack, { ok: true });
    });

    socket.on(
      "sendMessage",
      safeHandler("sendMessage", async (payload, ack) => {
        const conversationId = toConversationId(payload);
        if (!conversationId) {
          call(ack, { ok: false, error: "Invalid conversationId" });
          return;
        }
        const body = payload as
          | { content?: unknown; mediaUrls?: unknown }
          | undefined;
        const content = typeof body?.content === "string" ? body.content : "";
        const mediaUrls = Array.isArray(body?.mediaUrls)
          ? body.mediaUrls.filter((u): u is string => typeof u === "string")
          : [];
        if (content.trim().length === 0 && mediaUrls.length === 0) {
          call(ack, {
            ok: false,
            error: "Message must have content or media",
          });
          return;
        }
        const result = await sendMessageToConversation(
          conversationId,
          userId,
          content,
          mediaUrls,
        );
        if ("status" in result) {
          call(ack, { ok: false, error: result.message });
          return;
        }
        call(ack, { ok: true, message: result.message });
      }),
    );

    socket.on(
      "markRead",
      safeHandler("markRead", async (payload, ack) => {
        const conversationId = toConversationId(payload);
        if (!conversationId) {
          call(ack, { ok: false, error: "Invalid conversationId" });
          return;
        }
        const result = await markConversationRead(conversationId, userId);
        if ("status" in result) {
          call(ack, { ok: false, error: result.message });
          return;
        }
        call(ack, { ok: true, updatedCount: result.updatedCount });
      }),
    );

    // Typing is only allowed in a conversation the socket has already joined.
    // joinConversation membership-checks against the DB before adding the
    // socket to the room, so requiring room membership here blocks spoofed
    // typing events into conversations the user is not part of.
    socket.on("typingStart", (payload) => {
      const conversationId = toConversationId(payload);
      if (!conversationId) return;
      if (!socket.rooms.has(conversationRoom(conversationId))) return;
      socket
        .to(conversationRoom(conversationId))
        .emit("typing", { conversationId, userId });
    });

    socket.on("typingStop", (payload) => {
      const conversationId = toConversationId(payload);
      if (!conversationId) return;
      if (!socket.rooms.has(conversationRoom(conversationId))) return;
      socket
        .to(conversationRoom(conversationId))
        .emit("stopTyping", { conversationId, userId });
    });

    socket.on("disconnect", () => {
      const becameOffline = removeUserSocket(userId, socket.id);
      if (becameOffline) io.emit("userOffline", { userId });
    });
  });

  logger.info("Socket.IO initialised at /api/socket.io");
  return io;
}
