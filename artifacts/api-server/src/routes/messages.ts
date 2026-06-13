import { Router, type IRouter } from "express";
import { eq, and, or, sql, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  conversationsTable,
  messagesTable,
  usersTable,
  type Conversation,
  type Message,
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

const router: IRouter = Router();

function shapeMessage(m: Message) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    receiverId: m.receiverId,
    content: m.content,
    mediaUrls: m.mediaUrls ?? [],
    isRead: m.isRead,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

function otherUserId(convo: Conversation, currentUserId: number): number {
  return convo.userOneId === currentUserId ? convo.userTwoId : convo.userOneId;
}

function isParticipant(convo: Conversation, currentUserId: number): boolean {
  return (
    convo.userOneId === currentUserId || convo.userTwoId === currentUserId
  );
}

async function loadParticipant(userId: number) {
  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
      avatarUrl: usersTable.avatarUrl,
      profilePhotoUrl: usersTable.profilePhotoUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user ?? null;
}

router.post(
  "/messages/conversations",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = CreateConversationBody.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
      return;
    }

    const currentUserId = req.userId!;
    const { recipientId } = parsed.data;

    if (recipientId === currentUserId) {
      error(res, "You cannot start a conversation with yourself", 400);
      return;
    }

    const recipient = await loadParticipant(recipientId);
    if (!recipient) {
      error(res, "Recipient not found", 404);
      return;
    }

    const userOneId = Math.min(currentUserId, recipientId);
    const userTwoId = Math.max(currentUserId, recipientId);

    let [convo] = await db
      .insert(conversationsTable)
      .values({ userOneId, userTwoId })
      .onConflictDoNothing()
      .returning();

    if (!convo) {
      [convo] = await db
        .select()
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.userOneId, userOneId),
            eq(conversationsTable.userTwoId, userTwoId),
          ),
        );
    }

    if (!convo) {
      error(res, "Failed to create conversation", 500);
      return;
    }

    success(
      res,
      "Conversation ready",
      {
        id: convo.id,
        participant: recipient,
        lastMessage: null,
        unreadCount: 0,
        createdAt: convo.createdAt,
        updatedAt: convo.updatedAt,
      },
      201,
    );
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

async function loadOwnedConversation(
  conversationId: number,
  currentUserId: number,
): Promise<
  { convo: Conversation } | { status: number; message: string }
> {
  const [convo] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId));

  if (!convo) {
    return { status: 404, message: "Conversation not found" };
  }
  if (!isParticipant(convo, currentUserId)) {
    return {
      status: 403,
      message: "Forbidden — you are not part of this conversation",
    };
  }
  return { convo };
}

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

    const currentUserId = req.userId!;
    const result = await loadOwnedConversation(
      params.data.conversationId,
      currentUserId,
    );
    if ("status" in result) {
      error(res, result.message, result.status);
      return;
    }

    const receiverId = otherUserId(result.convo, currentUserId);

    const [message] = await db
      .insert(messagesTable)
      .values({
        conversationId: result.convo.id,
        senderId: currentUserId,
        receiverId,
        content: parsed.data.content,
        mediaUrls: parsed.data.mediaUrls ?? [],
      })
      .returning();

    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, result.convo.id));

    success(res, "Message sent", shapeMessage(message), 201);
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

    const currentUserId = req.userId!;
    const result = await loadOwnedConversation(
      params.data.conversationId,
      currentUserId,
    );
    if ("status" in result) {
      error(res, result.message, result.status);
      return;
    }

    const updated = await db
      .update(messagesTable)
      .set({ isRead: true })
      .where(
        and(
          eq(messagesTable.conversationId, result.convo.id),
          eq(messagesTable.receiverId, currentUserId),
          eq(messagesTable.isRead, false),
        ),
      )
      .returning({ id: messagesTable.id });

    success(res, "Conversation marked as read", {
      updatedCount: updated.length,
      unreadCount: 0,
    });
  },
);

export default router;
