import { Router, type IRouter } from "express";
import { eq, desc, sql, and, inArray, isNull } from "drizzle-orm";
import {
  db,
  postsTable,
  usersTable,
  likesTable,
  bookmarksTable,
  commentsTable,
  groupsTable,
} from "@workspace/db";
import { createNotification } from "../utils/notify";
import {
  CreatePostBody,
  UpdatePostBody,
  GetPostParams,
  UpdatePostParams,
  DeletePostParams,
  LikePostParams,
  UnlikePostParams,
  BookmarkPostParams,
  UnbookmarkPostParams,
  GetFeedQueryParams,
  GetSavedPostsQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { optionalAuth } from "../middlewares/optionalAuth";
import { uploadPostMedia, publicUrl } from "../middlewares/upload";
import { success, error } from "../utils/response";

const router: IRouter = Router();

async function buildFeedPosts(
  rawPosts: Array<{
    id: number;
    userId: number;
    groupId: number | null;
    content: string;
    feeling: string | null;
    imageUrl: string | null;
    mediaUrls: string[] | null;
    createdAt: Date;
    updatedAt: Date;
    authorId: number;
    authorName: string;
    authorRole: string;
    authorAvatarUrl: string | null;
    likeCount: number;
    bookmarkCount: number;
    commentCount: number;
  }>,
  currentUserId?: number,
) {
  let likedPostIds = new Set<number>();
  let bookmarkedPostIds = new Set<number>();

  if (currentUserId && rawPosts.length > 0) {
    const postIds = rawPosts.map((p) => p.id);

    const [likes, bookmarks] = await Promise.all([
      db
        .select({ postId: likesTable.postId })
        .from(likesTable)
        .where(
          and(
            eq(likesTable.userId, currentUserId),
            inArray(likesTable.postId, postIds),
          ),
        ),
      db
        .select({ postId: bookmarksTable.postId })
        .from(bookmarksTable)
        .where(
          and(
            eq(bookmarksTable.userId, currentUserId),
            inArray(bookmarksTable.postId, postIds),
          ),
        ),
    ]);

    likedPostIds = new Set(likes.map((l) => l.postId));
    bookmarkedPostIds = new Set(bookmarks.map((b) => b.postId));
  }

  return rawPosts.map((p) => ({
    id: p.id,
    userId: p.userId,
    groupId: p.groupId,
    content: p.content,
    feeling: p.feeling,
    imageUrl: p.imageUrl,
    mediaUrls: p.mediaUrls ?? [],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    author: {
      id: p.authorId,
      name: p.authorName,
      role: p.authorRole,
      avatarUrl: p.authorAvatarUrl,
    },
    likeCount: p.likeCount,
    bookmarkCount: p.bookmarkCount,
    commentCount: p.commentCount,
    isLiked: likedPostIds.has(p.id),
    isBookmarked: bookmarkedPostIds.has(p.id),
  }));
}

async function queryFeed(limit: number, offset: number) {
  return db
    .select({
      id: postsTable.id,
      userId: postsTable.userId,
      groupId: postsTable.groupId,
      content: postsTable.content,
      feeling: postsTable.feeling,
      imageUrl: postsTable.imageUrl,
      mediaUrls: postsTable.mediaUrls,
      createdAt: postsTable.createdAt,
      updatedAt: postsTable.updatedAt,
      authorId: usersTable.id,
      authorName: usersTable.name,
      authorRole: usersTable.role,
      authorAvatarUrl: usersTable.avatarUrl,
      likeCount: sql<number>`cast(count(distinct ${likesTable.id}) as integer)`,
      bookmarkCount: sql<number>`cast(count(distinct ${bookmarksTable.id}) as integer)`,
      commentCount: sql<number>`cast(count(distinct ${commentsTable.id}) filter (where not ${commentsTable.isDeleted}) as integer)`,
    })
    .from(postsTable)
    .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
    .leftJoin(likesTable, eq(likesTable.postId, postsTable.id))
    .leftJoin(bookmarksTable, eq(bookmarksTable.postId, postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    // Main feed shows only ungrouped posts; group-scoped posts live in the
    // group feed (GET /groups/:id/posts).
    .where(isNull(postsTable.groupId))
    .groupBy(postsTable.id, usersTable.id)
    .orderBy(desc(postsTable.createdAt))
    .limit(limit)
    .offset(offset);
}

async function querySavedPosts(
  userId: number,
  limit: number,
  offset: number,
) {
  return db
    .select({
      id: postsTable.id,
      userId: postsTable.userId,
      groupId: postsTable.groupId,
      content: postsTable.content,
      feeling: postsTable.feeling,
      imageUrl: postsTable.imageUrl,
      mediaUrls: postsTable.mediaUrls,
      createdAt: postsTable.createdAt,
      updatedAt: postsTable.updatedAt,
      authorId: usersTable.id,
      authorName: usersTable.name,
      authorRole: usersTable.role,
      authorAvatarUrl: usersTable.avatarUrl,
      bookmarkedAt: bookmarksTable.createdAt,
      likeCount: sql<number>`cast(count(distinct ${likesTable.id}) as integer)`,
      bookmarkCount: sql<number>`cast(count(distinct ${bookmarksTable.id}) as integer)`,
      commentCount: sql<number>`cast(count(distinct ${commentsTable.id}) filter (where not ${commentsTable.isDeleted}) as integer)`,
    })
    .from(bookmarksTable)
    .innerJoin(postsTable, eq(bookmarksTable.postId, postsTable.id))
    .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
    .leftJoin(likesTable, eq(likesTable.postId, postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    .where(eq(bookmarksTable.userId, userId))
    .groupBy(postsTable.id, usersTable.id, bookmarksTable.createdAt)
    .orderBy(desc(bookmarksTable.createdAt))
    .limit(limit)
    .offset(offset);
}

router.get("/posts", optionalAuth, async (req, res): Promise<void> => {
  const query = GetFeedQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const rawPosts = await queryFeed(limit, offset);
  const posts = await buildFeedPosts(rawPosts, req.userId);

  success(res, "Feed retrieved", posts);
});

router.post(
  "/posts",
  requireAuth,
  uploadPostMedia,
  async (req, res): Promise<void> => {
    // Multipart sends scalar fields as strings; coerce numeric/empty groupId
    // before Zod validation so the same schema serves JSON and form-data.
    const body: Record<string, unknown> = { ...req.body };
    if (typeof body.groupId === "string") {
      body.groupId = body.groupId.trim() === "" ? null : Number(body.groupId);
    }

    const parsed = CreatePostBody.safeParse(body);

    if (!parsed.success) {
      error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
      return;
    }

    // If a group is specified, ensure it exists (FK would otherwise 500).
    if (parsed.data.groupId != null) {
      const [group] = await db
        .select({ id: groupsTable.id })
        .from(groupsTable)
        .where(eq(groupsTable.id, parsed.data.groupId));
      if (!group) {
        error(res, "Group not found", 404);
        return;
      }
    }

    // Merge uploaded media file URLs with any URLs sent in the body.
    const uploaded = Array.isArray(req.files)
      ? (req.files as Express.Multer.File[]).map((f) =>
          publicUrl("posts", f.filename),
        )
      : [];
    const mediaUrls = [...(parsed.data.mediaUrls ?? []), ...uploaded];

    const [post] = await db
      .insert(postsTable)
      .values({
        userId: req.userId!,
        ...parsed.data,
        mediaUrls,
      })
      .returning();

    success(
      res,
      "Post created",
      { ...post, mediaUrls: post.mediaUrls ?? [] },
      201,
    );
  },
);

router.get("/posts/saved", requireAuth, async (req, res): Promise<void> => {
  const query = GetSavedPostsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const rawPosts = await querySavedPosts(req.userId!, limit, offset);
  const posts = await buildFeedPosts(rawPosts, req.userId);

  success(res, "Saved posts retrieved", posts);
});

router.get("/posts/:id", optionalAuth, async (req, res): Promise<void> => {
  const params = GetPostParams.safeParse(req.params);

  if (!params.success) {
    error(res, "Invalid post ID", 400);
    return;
  }

  const [raw] = await db
    .select({
      id: postsTable.id,
      userId: postsTable.userId,
      groupId: postsTable.groupId,
      content: postsTable.content,
      feeling: postsTable.feeling,
      imageUrl: postsTable.imageUrl,
      mediaUrls: postsTable.mediaUrls,
      createdAt: postsTable.createdAt,
      updatedAt: postsTable.updatedAt,
      authorId: usersTable.id,
      authorName: usersTable.name,
      authorRole: usersTable.role,
      authorAvatarUrl: usersTable.avatarUrl,
      likeCount: sql<number>`cast(count(distinct ${likesTable.id}) as integer)`,
      bookmarkCount: sql<number>`cast(count(distinct ${bookmarksTable.id}) as integer)`,
      commentCount: sql<number>`cast(count(distinct ${commentsTable.id}) filter (where not ${commentsTable.isDeleted}) as integer)`,
    })
    .from(postsTable)
    .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
    .leftJoin(likesTable, eq(likesTable.postId, postsTable.id))
    .leftJoin(bookmarksTable, eq(bookmarksTable.postId, postsTable.id))
    .leftJoin(commentsTable, eq(commentsTable.postId, postsTable.id))
    .where(eq(postsTable.id, params.data.id))
    .groupBy(postsTable.id, usersTable.id);

  if (!raw) {
    error(res, "Post not found", 404);
    return;
  }

  const [post] = await buildFeedPosts([raw], req.userId);
  success(res, "Post retrieved", post);
});

/**
 * Parse the `remainingMedia` field from a multipart PATCH body. It can arrive
 * as a JSON array string, repeated form fields (string[]), or a comma-separated
 * string. Returns:
 *   - undefined when the field was not sent at all (→ keep existing media)
 *   - string[]  otherwise (an empty array explicitly clears media)
 */
function parseRemainingMedia(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;

  const fromOne = (s: string): string[] => {
    const t = s.trim();
    if (t === "") return [];
    if (t.startsWith("[")) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) return arr.map(String).filter((x) => x !== "");
      } catch {
        // fall through to comma-splitting
      }
    }
    return t
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x !== "");
  };

  if (Array.isArray(raw)) {
    return raw.flatMap((item) => (typeof item === "string" ? fromOne(item) : []));
  }
  if (typeof raw === "string") return fromOne(raw);
  return undefined;
}

router.patch(
  "/posts/:id",
  requireAuth,
  uploadPostMedia,
  async (req, res): Promise<void> => {
    const params = UpdatePostParams.safeParse(req.params);

    if (!params.success) {
      error(res, "Invalid post ID", 400);
      return;
    }

    // Validate only the text fields against the body schema; media is handled
    // separately via remainingMedia + uploaded files.
    const parsed = UpdatePostBody.safeParse({
      content: req.body.content,
      feeling: req.body.feeling,
    });

    if (!parsed.success) {
      error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
      return;
    }

    // Build the final media list per the merge rules.
    const uploaded = Array.isArray(req.files)
      ? (req.files as Express.Multer.File[]).map((f) => publicUrl("posts", f.filename))
      : [];
    const remaining = parseRemainingMedia(req.body.remainingMedia);

    let finalMediaUrls: string[] | undefined;
    if (remaining !== undefined && uploaded.length > 0) {
      finalMediaUrls = [...remaining, ...uploaded];
    } else if (uploaded.length > 0) {
      finalMediaUrls = uploaded;
    } else if (remaining !== undefined) {
      finalMediaUrls = remaining; // empty array clears media
    } else {
      finalMediaUrls = undefined; // neither provided → leave unchanged
    }

    const updates: Record<string, unknown> = { ...parsed.data };
    if (finalMediaUrls !== undefined) updates.mediaUrls = finalMediaUrls;

    if (Object.keys(updates).length === 0) {
      error(res, "No fields provided to update", 400);
      return;
    }

    const [existing] = await db
      .select({ userId: postsTable.userId })
      .from(postsTable)
      .where(eq(postsTable.id, params.data.id));

    if (!existing) {
      error(res, "Post not found", 404);
      return;
    }

    if (existing.userId !== req.userId) {
      error(res, "Forbidden — you do not own this post", 403);
      return;
    }

    const [updated] = await db
      .update(postsTable)
      .set(updates)
      .where(eq(postsTable.id, params.data.id))
      .returning();

    success(res, "Post updated", { ...updated, mediaUrls: updated.mediaUrls ?? [] });
  },
);

router.delete("/posts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeletePostParams.safeParse(req.params);

  if (!params.success) {
    error(res, "Invalid post ID", 400);
    return;
  }

  const [existing] = await db
    .select({ userId: postsTable.userId })
    .from(postsTable)
    .where(eq(postsTable.id, params.data.id));

  if (!existing) {
    error(res, "Post not found", 404);
    return;
  }

  if (existing.userId !== req.userId) {
    error(res, "Forbidden — you do not own this post", 403);
    return;
  }

  await db.delete(postsTable).where(eq(postsTable.id, params.data.id));
  success(res, "Deleted successfully", {});
});

router.post("/posts/:id/like", requireAuth, async (req, res): Promise<void> => {
  const params = LikePostParams.safeParse(req.params);

  if (!params.success) {
    error(res, "Invalid post ID", 400);
    return;
  }

  const [post] = await db
    .select({ id: postsTable.id, userId: postsTable.userId })
    .from(postsTable)
    .where(eq(postsTable.id, params.data.id));

  if (!post) {
    error(res, "Post not found", 404);
    return;
  }

  await db
    .insert(likesTable)
    .values({ userId: req.userId!, postId: params.data.id })
    .onConflictDoNothing();

  const [{ likeCount }] = await db
    .select({ likeCount: sql<number>`cast(count(*) as integer)` })
    .from(likesTable)
    .where(eq(likesTable.postId, params.data.id));

  void createNotification({
    userId: post.userId,
    actorId: req.userId!,
    type: "post_liked",
    entityType: "post",
    entityId: post.id,
    message: "liked your post",
  });

  success(res, "Post liked", { liked: true, likeCount });
});

router.delete(
  "/posts/:id/like",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UnlikePostParams.safeParse(req.params);

    if (!params.success) {
      error(res, "Invalid post ID", 400);
      return;
    }

    await db
      .delete(likesTable)
      .where(
        and(
          eq(likesTable.userId, req.userId!),
          eq(likesTable.postId, params.data.id),
        ),
      );

    const [{ likeCount }] = await db
      .select({ likeCount: sql<number>`cast(count(*) as integer)` })
      .from(likesTable)
      .where(eq(likesTable.postId, params.data.id));

    success(res, "Post unliked", { liked: false, likeCount });
  },
);

router.post(
  "/posts/:id/bookmark",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = BookmarkPostParams.safeParse(req.params);

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

    await db
      .insert(bookmarksTable)
      .values({ userId: req.userId!, postId: params.data.id })
      .onConflictDoNothing();

    success(res, "Post bookmarked", { bookmarked: true });
  },
);

router.delete(
  "/posts/:id/bookmark",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UnbookmarkPostParams.safeParse(req.params);

    if (!params.success) {
      error(res, "Invalid post ID", 400);
      return;
    }

    await db
      .delete(bookmarksTable)
      .where(
        and(
          eq(bookmarksTable.userId, req.userId!),
          eq(bookmarksTable.postId, params.data.id),
        ),
      );

    success(res, "Bookmark removed", { bookmarked: false });
  },
);

export default router;
