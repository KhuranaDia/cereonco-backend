import { Router, type IRouter } from "express";
import { eq, and, or, sql, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  conversationsTable,
  messagesTable,
  usersTable,
} from "@workspace/db";
import {
  CreateConversationBody,
  SendMessageBody,
  SendMessageParams,
  GetConversationMessagesParams,
  MarkConversationReadParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { success, error } from "../utils/response";
import {
  shapeMessage,
  otherUserId,
  loadOwnedConversation,
  createOrGetConversation,
  sendMessageToConversation,
  markConversationRead,
} from "../services/messages";

const router: IRouter = Router();

router.post(
  "/messages/conversations",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = CreateConversationBody.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
      return;
    }

    const result = await createOrGetConversation(
      req.userId!,
      parsed.data.recipientId,
    );
    if ("status" in result) {
      error(res, result.message, result.status);
      return;
    }

    success(res, "Conversation ready", result, 201);
  },
);

router.get(
  "/messages/conversations",
  requireAuth,
  async (req, res): Promise<void> => {
    const currentUserId = req.userId!;

    const convos = await db
      .select()
      .from(conversationsTable)
      .where(
        or(
          eq(conversationsTable.userOneId, currentUserId),
          eq(conversationsTable.userTwoId, currentUserId),
        ),
      )
      .orderBy(desc(conversationsTable.updatedAt));

    if (convos.length === 0) {
      success(res, "Conversations retrieved", { conversations: [], total: 0 });
      return;
    }

    const convoIds = convos.map((c) => c.id);
    const otherIds = convos.map((c) => otherUserId(c, currentUserId));

    const [participants, lastMessages, unreadRows] = await Promise.all([
      db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          role: usersTable.role,
          avatarUrl: usersTable.avatarUrl,
          profilePhotoUrl: usersTable.profilePhotoUrl,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, otherIds)),
      db
        .selectDistinctOn([messagesTable.conversationId])
        .from(messagesTable)
        .where(inArray(messagesTable.conversationId, convoIds))
        .orderBy(messagesTable.conversationId, desc(messagesTable.createdAt)),
      db
        .select({
          conversationId: messagesTable.conversationId,
          unreadCount: sql<number>`cast(count(*) as integer)`,
        })
        .from(messagesTable)
        .where(
          and(
            inArray(messagesTable.conversationId, convoIds),
            eq(messagesTable.receiverId, currentUserId),
            eq(messagesTable.isRead, false),
          ),
        )
        .groupBy(messagesTable.conversationId),
    ]);

    const participantMap = new Map(participants.map((p) => [p.id, p]));
    const lastMessageMap = new Map(
      lastMessages.map((m) => [m.conversationId, m]),
    );
    const unreadMap = new Map(
      unreadRows.map((r) => [r.conversationId, r.unreadCount]),
    );

    const conversations = convos.flatMap((c) => {
      const participant = participantMap.get(otherUserId(c, currentUserId));
      if (!participant) return [];
      const last = lastMessageMap.get(c.id);
      return [
        {
          id: c.id,
          participant,
          lastMessage: last ? shapeMessage(last) : null,
          unreadCount: unreadMap.get(c.id) ?? 0,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
      ];
    });

    success(res, "Conversations retrieved", {
      conversations,
      total: conversations.length,
    });
  },
);

router.get(
  "/messages/unread-count",
  requireAuth,
  async (req, res): Promise<void> => {
    const [{ unreadCount }] = await db
      .select({ unreadCount: sql<number>`cast(count(*) as integer)` })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.receiverId, req.userId!),
          eq(messagesTable.isRead, false),
        ),
      );

    success(res, "Unread count retrieved", { unreadCount });
  },
);

router.get(
  "/messages/conversations/:conversationId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetConversationMessagesParams.safeParse(req.params);
    if (!params.success) {
      error(res, "Invalid conversation ID", 400);
      return;
    }

    const result = await loadOwnedConversation(
      params.data.conversationId,
      req.userId!,
    );
    if ("status" in result) {
      error(res, result.message, result.status);
      return;
    }

    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, params.data.conversationId))
      .orderBy(asc(messagesTable.createdAt));

    success(res, "Messages retrieved", {
      messages: messages.map(shapeMessage),
      total: messages.length,
    });
  },
);

router.post(
  "/messages/conversations/:conversationId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = SendMessageParams.safeParse(req.params);
    if (!params.success) {
      error(res, "Invalid conversation ID", 400);
      return;
    }

    const parsed = SendMessageBody.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
      return;
    }

    const result = await sendMessageToConversation(
      params.data.conversationId,
      req.userId!,
      parsed.data.content,
      parsed.data.mediaUrls ?? [],
    );
    if ("status" in result) {
      error(res, result.message, result.status);
      return;
    }

    success(res, "Message sent", result.message, 201);
  },
);

router.patch(
  "/messages/conversations/:conversationId/read",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = MarkConversationReadParams.safeParse(req.params);
    if (!params.success) {
      error(res, "Invalid conversation ID", 400);
      return;
    }

    const result = await markConversationRead(
      params.data.conversationId,
      req.userId!,
    );
    if ("status" in result) {
      error(res, result.message, result.status);
      return;
    }

    success(res, "Conversation marked as read", {
      updatedCount: result.updatedCount,
      unreadCount: 0,
    });
  },
);

export default router;
