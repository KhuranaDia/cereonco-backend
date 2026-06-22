import { Router, type IRouter } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db, commentsTable, postsTable, usersTable } from "@workspace/db";
import { createNotification } from "../utils/notify";
import {
  GetPostCommentsParams,
  CreateCommentParams,
  CreateCommentBody,
  UpdateCommentParams,
  UpdateCommentBody,
  DeleteCommentParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { success, error } from "../utils/response";

const router: IRouter = Router();

type RawComment = {
  id: number;
  postId: number;
  userId: number | null;
  content: string;
  parentCommentId: number | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  authorId: number | null;
  authorName: string | null;
  authorRole: string | null;
  authorAvatarUrl: string | null;
};

function formatComment(row: RawComment) {
  const author =
    row.isDeleted || row.authorId === null
      ? null
      : {
          id: row.authorId,
          name: row.authorName!,
          role: row.authorRole!,
          avatarUrl: row.authorAvatarUrl,
        };
  return {
    id: row.id,
    postId: row.postId,
    userId: row.isDeleted ? null : row.userId,
    content: row.isDeleted ? "[deleted]" : row.content,
    parentCommentId: row.parentCommentId,
    isDeleted: row.isDeleted,
    author,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function fetchAllComments(postId: number): Promise<RawComment[]> {
  return db
    .select({
      id: commentsTable.id,
      postId: commentsTable.postId,
      userId: commentsTable.userId,
      content: commentsTable.content,
      parentCommentId: commentsTable.parentCommentId,
      isDeleted: commentsTable.isDeleted,
      createdAt: commentsTable.createdAt,
      updatedAt: commentsTable.updatedAt,
      authorId: usersTable.id,
      authorName: usersTable.name,
      authorRole: usersTable.role,
      authorAvatarUrl: usersTable.avatarUrl,
    })
    .from(commentsTable)
    .leftJoin(usersTable, eq(commentsTable.userId, usersTable.id))
    .where(eq(commentsTable.postId, postId))
    .orderBy(commentsTable.createdAt);
}

// GET /posts/:id/comments
router.get("/posts/:id/comments", async (req, res): Promise<void> => {
  const params = GetPostCommentsParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid post ID", 400);
    return;
  }

  const [post] = await db
    .select({ id: postsTable.id })
    .from(postsTable)
    .where(eq(postsTable.id, params.data.id));

  if (!post) {
    error(res, "Post not found", 404);
    return;
  }

  const allRows = await fetchAllComments(params.data.id);

  // Build reply map
  const replyMap = new Map<number, ReturnType<typeof formatComment>[]>();
  const replyCounts = new Map<number, number>();

  for (const row of allRows) {
    if (row.parentCommentId !== null) {
      const arr = replyMap.get(row.parentCommentId) ?? [];
      arr.push(formatComment(row));
      replyMap.set(row.parentCommentId, arr);
      replyCounts.set(row.parentCommentId, (replyCounts.get(row.parentCommentId) ?? 0) + 1);
    }
  }

  // Build top-level comments with replies
  const topLevel = allRows.filter((r) => r.parentCommentId === null);
  const comments = topLevel.map((row) => ({
    ...formatComment(row),
    replyCount: replyCounts.get(row.id) ?? 0,
    replies: replyMap.get(row.id) ?? [],
  }));

  success(res, "Comments retrieved", { comments, total: comments.length });
});

// POST /posts/:id/comments  (top-level or reply)
router.post("/posts/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const params = CreateCommentParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid post ID", 400);
    return;
  }

  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const { content, parentCommentId } = parsed.data;
  const postId = params.data.id;

  const [post] = await db
    .select({ id: postsTable.id, userId: postsTable.userId })
    .from(postsTable)
    .where(eq(postsTable.id, postId));

  if (!post) {
    error(res, "Post not found", 404);
    return;
  }

  let parentAuthorId: number | null = null;

  if (parentCommentId !== undefined) {
    const [parent] = await db
      .select({
        id: commentsTable.id,
        postId: commentsTable.postId,
        userId: commentsTable.userId,
        isDeleted: commentsTable.isDeleted,
      })
      .from(commentsTable)
      .where(eq(commentsTable.id, parentCommentId));

    if (!parent || parent.postId !== postId) {
      error(res, "Parent comment not found on this post", 404);
      return;
    }
    if (parent.isDeleted) {
      error(res, "Cannot reply to a deleted comment", 400);
      return;
    }
    parentAuthorId = parent.userId;
  }

  const [inserted] = await db
    .insert(commentsTable)
    .values({
      postId,
      userId: req.userId!,
      content,
      parentCommentId: parentCommentId ?? null,
    })
    .returning();

  const author = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  if (parentCommentId !== undefined && parentAuthorId !== null) {
    void createNotification({
      userId: parentAuthorId,
      actorId: req.userId!,
      type: "comment_replied",
      entityType: "comment",
      entityId: inserted.id,
      message: "replied to your comment",
    });
  } else {
    void createNotification({
      userId: post.userId,
      actorId: req.userId!,
      type: "post_commented",
      entityType: "post",
      entityId: post.id,
      message: "commented on your post",
    });
  }

  const responseComment = {
    id: inserted.id,
    postId: inserted.postId,
    userId: inserted.userId,
    content: inserted.content,
    parentCommentId: inserted.parentCommentId,
    isDeleted: inserted.isDeleted,
    author: author[0] ?? null,
    createdAt: inserted.createdAt,
    updatedAt: inserted.updatedAt,
  };

  success(res, "Comment created", responseComment, 201);
});

// PATCH /comments/:id
router.patch("/comments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateCommentParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid comment ID", 400);
    return;
  }

  const parsed = UpdateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const [existing] = await db
    .select({
      id: commentsTable.id,
      userId: commentsTable.userId,
      isDeleted: commentsTable.isDeleted,
    })
    .from(commentsTable)
    .where(eq(commentsTable.id, params.data.id));

  if (!existing) {
    error(res, "Comment not found", 404);
    return;
  }
  if (existing.isDeleted) {
    error(res, "Cannot edit a deleted comment", 400);
    return;
  }
  if (existing.userId !== req.userId) {
    error(res, "Forbidden — you do not own this comment", 403);
    return;
  }

  const [updated] = await db
    .update(commentsTable)
    .set({ content: parsed.data.content })
    .where(eq(commentsTable.id, params.data.id))
    .returning();

  const author = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  success(res, "Comment updated", {
    id: updated.id,
    postId: updated.postId,
    userId: updated.userId,
    content: updated.content,
    parentCommentId: updated.parentCommentId,
    isDeleted: updated.isDeleted,
    author: author[0] ?? null,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
});

// DELETE /comments/:id  (soft delete)
router.delete("/comments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteCommentParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid comment ID", 400);
    return;
  }

  const [existing] = await db
    .select({
      id: commentsTable.id,
      userId: commentsTable.userId,
      isDeleted: commentsTable.isDeleted,
    })
    .from(commentsTable)
    .where(eq(commentsTable.id, params.data.id));

  if (!existing) {
    error(res, "Comment not found", 404);
    return;
  }
  if (existing.isDeleted) {
    error(res, "Comment is already deleted", 400);
    return;
  }
  if (existing.userId !== req.userId) {
    error(res, "Forbidden — you do not own this comment", 403);
    return;
  }

  await db
    .update(commentsTable)
    .set({ isDeleted: true })
    .where(eq(commentsTable.id, params.data.id));

  success(res, "Deleted successfully", {});
});

export default router;
