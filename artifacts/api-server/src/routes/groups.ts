import { Router, type IRouter } from "express";
import { eq, and, sql, desc, ne, inArray } from "drizzle-orm";
import {
  db,
  groupsTable,
  groupMembersTable,
  postsTable,
  likesTable,
  bookmarksTable,
  commentsTable,
  usersTable,
} from "@workspace/db";
import { createNotifications } from "../utils/notify";
import {
  ListGroupsQueryParams,
  GetGroupParams,
  CreateGroupBody,
  JoinGroupParams,
  LeaveGroupParams,
  GetGroupFeedParams,
  GetGroupFeedQueryParams,
  CreateGroupPostParams,
  CreateGroupPostBody,
  UpdateGroupPostParams,
  UpdateGroupPostBody,
  DeleteGroupPostParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { uploadGroupImage, publicUrl } from "../middlewares/upload";
import { success, error } from "../utils/response";
import { formatZodError } from "../utils/validation";
import { z } from "zod/v4";

const router: IRouter = Router();

async function getMemberCount(groupId: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.groupId, groupId));
  return count;
}

async function getIsMember(groupId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: groupMembersTable.id })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.userId, userId),
      ),
    );
  return !!row;
}

function buildGroupResponse(
  group: { id: number; name: string; description: string; tagline: string | null; category: string; imageUrl: string | null; creatorUserId: number | null; createdAt: Date; updatedAt: Date },
  memberCount: number,
  isMember: boolean,
  isAdmin: boolean,
) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    tagline: group.tagline,
    category: group.category,
    imageUrl: group.imageUrl,
    creatorUserId: group.creatorUserId,
    memberCount,
    isMember,
    isAdmin,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

type RawGroupPost = {
  id: number;
  groupId: number | null;
  userId: number;
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
};

/**
 * Select group posts (posts rows with a non-null groupId) for one group, with
 * the same author + counts shape as the main feed. `postId` narrows to a single
 * post (used after create/update); otherwise paginate the group feed.
 */
async function queryGroupPosts(opts: {
  groupId: number;
  limit?: number;
  offset?: number;
  postId?: number;
}): Promise<RawGroupPost[]> {
  const where =
    opts.postId !== undefined
      ? and(
          eq(postsTable.groupId, opts.groupId),
          eq(postsTable.id, opts.postId),
        )
      : eq(postsTable.groupId, opts.groupId);

  const base = db
    .select({
      id: postsTable.id,
      groupId: postsTable.groupId,
      userId: postsTable.userId,
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
    .where(where)
    .groupBy(postsTable.id, usersTable.id)
    .orderBy(desc(postsTable.createdAt));

  if (opts.postId === undefined) {
    return base.limit(opts.limit ?? 20).offset(opts.offset ?? 0);
  }
  return base;
}

/** Shape raw group posts with per-user isLiked/isBookmarked flags. */
async function buildGroupPosts(
  rawPosts: RawGroupPost[],
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
    groupId: p.groupId,
    userId: p.userId,
    content: p.content,
    feeling: p.feeling,
    imageUrl: p.imageUrl,
    mediaUrls: p.mediaUrls ?? [],
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
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

/** True only for well-formed http(s) URLs. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Zod schema for Create Group. Inputs are trimmed; optional string fields treat
 * empty/whitespace as "not provided". `imageUrl`, when present, must be a valid
 * http(s) URL. Raw Zod messages here are never sent to the client — they are
 * mapped to friendly text by `CREATE_GROUP_FIELD_MESSAGES` via `formatZodError`.
 */
const createGroupSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  category: z.string().trim().min(1),
  tagline: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null)),
  imageUrl: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isHttpUrl(v), { message: "invalid_url" }),
});

/**
 * Friendly, actionable message per field for Create Group. Keyed by field path
 * so the reusable `formatZodError` can surface exactly one clear message and
 * never the raw Zod array, "Required", or "Invalid input".
 */
const CREATE_GROUP_FIELD_MESSAGES = {
  name: "Group name is required. Please enter a group name.",
  description: "Group description is required. Please enter a group description.",
  category: "Category is invalid. Please select a valid category.",
  imageUrl:
    "Image URL must be a valid URL, e.g. https://example.com/image.png.",
  tagline: "Tagline must be text.",
} as const;

const CREATE_GROUP_FIELD_ORDER = [
  "name",
  "description",
  "category",
  "imageUrl",
  "tagline",
];

// GET /groups
router.get("/groups", requireAuth, async (req, res): Promise<void> => {
  const query = ListGroupsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const userId = req.userId!;

  // Only groups where the current user is the creator OR a member. We compute
  // memberCount over ALL members via a correlated subquery so it isn't skewed
  // by the membership filter join.
  const rows = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      description: groupsTable.description,
      tagline: groupsTable.tagline,
      category: groupsTable.category,
      imageUrl: groupsTable.imageUrl,
      creatorUserId: groupsTable.creatorUserId,
      createdAt: groupsTable.createdAt,
      updatedAt: groupsTable.updatedAt,
      memberCount: sql<number>`cast((select count(*) from ${groupMembersTable} gm_all where gm_all.group_id = ${groupsTable.id}) as integer)`,
      isMember: sql<boolean>`exists (select 1 from ${groupMembersTable} gm_me where gm_me.group_id = ${groupsTable.id} and gm_me.user_id = ${userId})`,
    })
    .from(groupsTable)
    .where(
      sql`(${groupsTable.creatorUserId} = ${userId} or exists (select 1 from ${groupMembersTable} gm where gm.group_id = ${groupsTable.id} and gm.user_id = ${userId}))`,
    )
    .orderBy(desc(groupsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const groups = rows.map((r) =>
    buildGroupResponse(r, r.memberCount, r.isMember, r.creatorUserId === userId),
  );

  success(res, "Groups retrieved", groups);
});

// POST /groups
// Accepts application/json (no file) OR multipart/form-data with an optional
// `image` file — mirrors POST /posts. The upload middleware passes JSON bodies
// straight through, so backward compatibility is preserved.
router.post(
  "/groups",
  requireAuth,
  uploadGroupImage,
  async (req, res): Promise<void> => {
  // Parse with the Zod schema, then convert any issues into a single friendly,
  // field-level message via the reusable formatter — never a raw Zod array or
  // "Required"/"Invalid input".
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    error(
      res,
      formatZodError(parsed.error, {
        fields: CREATE_GROUP_FIELD_MESSAGES,
        order: CREATE_GROUP_FIELD_ORDER,
      }),
      400,
    );
    return;
  }
  const data = parsed.data;

  // An uploaded image file (multipart) takes precedence over any imageUrl sent
  // in the body. JSON requests without a file keep using data.imageUrl.
  const file = req.file as Express.Multer.File | undefined;
  const imageUrl = file ? publicUrl("groups", file.filename) : data.imageUrl;

  const [created] = await db
    .insert(groupsTable)
    .values({
      name: data.name,
      description: data.description,
      tagline: data.tagline,
      category: data.category,
      imageUrl,
      creatorUserId: req.userId!,
    })
    .returning();

  // Creator auto-joins their own group as its admin.
  await db
    .insert(groupMembersTable)
    .values({ groupId: created.id, userId: req.userId!, role: "admin" })
    .onConflictDoNothing();

  success(res, "Group created", buildGroupResponse(created, 1, true, true), 201);
  },
);

// GET /groups/:id
router.get("/groups/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetGroupParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid group ID", 400);
    return;
  }

  const [group] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, params.data.id));

  if (!group) {
    error(res, "Group not found", 404);
    return;
  }

  const [memberCount, isMember] = await Promise.all([
    getMemberCount(params.data.id),
    getIsMember(params.data.id, req.userId!),
  ]);

  const isAdmin = group.creatorUserId === req.userId;

  success(res, "Group retrieved", buildGroupResponse(group, memberCount, isMember, isAdmin));
});

// POST /groups/:id/join
router.post("/groups/:id/join", requireAuth, async (req, res): Promise<void> => {
  const params = JoinGroupParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid group ID", 400);
    return;
  }

  const [group] = await db
    .select({ id: groupsTable.id, name: groupsTable.name })
    .from(groupsTable)
    .where(eq(groupsTable.id, params.data.id));

  if (!group) {
    error(res, "Group not found", 404);
    return;
  }

  const existingMembers = await db
    .select({ userId: groupMembersTable.userId })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, params.data.id),
        ne(groupMembersTable.userId, req.userId!),
      ),
    );

  await db
    .insert(groupMembersTable)
    .values({ groupId: params.data.id, userId: req.userId! })
    .onConflictDoNothing();

  if (existingMembers.length > 0) {
    void createNotifications(
      existingMembers.map((m) => ({
        userId: m.userId,
        actorId: req.userId!,
        type: "group_joined" as const,
        entityType: "group" as const,
        entityId: group.id,
        message: `joined the group "${group.name}"`,
      })),
    );
  }

  const memberCount = await getMemberCount(params.data.id);
  success(res, "Joined group", { joined: true, memberCount });
});

// DELETE /groups/:id/join
router.delete("/groups/:id/join", requireAuth, async (req, res): Promise<void> => {
  const params = LeaveGroupParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid group ID", 400);
    return;
  }

  const [group] = await db
    .select({ id: groupsTable.id, creatorUserId: groupsTable.creatorUserId })
    .from(groupsTable)
    .where(eq(groupsTable.id, params.data.id));

  if (!group) {
    error(res, "Group not found", 404);
    return;
  }

  // The creator/admin cannot abandon their own group.
  if (group.creatorUserId === req.userId) {
    error(res, "You cannot leave a group you created.", 403);
    return;
  }

  await db
    .delete(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, params.data.id),
        eq(groupMembersTable.userId, req.userId!),
      ),
    );

  const memberCount = await getMemberCount(params.data.id);
  success(res, "Left group", { joined: false, memberCount });
});

// GET /groups/:id/posts
router.get("/groups/:id/posts", requireAuth, async (req, res): Promise<void> => {
  const params = GetGroupFeedParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid group ID", 400);
    return;
  }

  const [group] = await db
    .select({ id: groupsTable.id })
    .from(groupsTable)
    .where(eq(groupsTable.id, params.data.id));

  if (!group) {
    error(res, "Group not found", 404);
    return;
  }

  const query = GetGroupFeedQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const rawPosts = await queryGroupPosts({
    groupId: params.data.id,
    limit,
    offset,
  });
  const formatted = await buildGroupPosts(rawPosts, req.userId);

  success(res, "Group feed retrieved", formatted);
});

// POST /groups/:id/posts
router.post("/groups/:id/posts", requireAuth, async (req, res): Promise<void> => {
  const params = CreateGroupPostParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid group ID", 400);
    return;
  }

  const parsed = CreateGroupPostBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const [group] = await db
    .select({ id: groupsTable.id, name: groupsTable.name })
    .from(groupsTable)
    .where(eq(groupsTable.id, params.data.id));

  if (!group) {
    error(res, "Group not found", 404);
    return;
  }

  // Group posts now live in the shared posts table with groupId set, so they
  // get the same likes/bookmarks/comments behaviour as the main feed.
  const [inserted] = await db
    .insert(postsTable)
    .values({
      groupId: params.data.id,
      userId: req.userId!,
      content: parsed.data.content,
      feeling: parsed.data.feeling ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      mediaUrls: parsed.data.mediaUrls ?? [],
    })
    .returning();

  const groupMembers = await db
    .select({ userId: groupMembersTable.userId })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, params.data.id),
        ne(groupMembersTable.userId, req.userId!),
      ),
    );

  if (groupMembers.length > 0) {
    void createNotifications(
      groupMembers.map((m) => ({
        userId: m.userId,
        actorId: req.userId!,
        type: "group_post_created" as const,
        entityType: "group_post" as const,
        entityId: inserted.id,
        message: `posted in "${group.name}"`,
      })),
    );
  }

  const rawPosts = await queryGroupPosts({
    groupId: params.data.id,
    postId: inserted.id,
  });
  const [formatted] = await buildGroupPosts(rawPosts, req.userId);

  success(res, "Group post created", formatted, 201);
});

// PATCH /groups/posts/:postId
router.patch("/groups/posts/:postId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateGroupPostParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid post ID", 400);
    return;
  }

  const parsed = UpdateGroupPostBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  if (
    parsed.data.content === undefined &&
    parsed.data.feeling === undefined &&
    parsed.data.imageUrl === undefined &&
    parsed.data.mediaUrls === undefined
  ) {
    error(res, "No fields provided to update", 400);
    return;
  }

  // Group posts are posts rows with a non-null groupId.
  const [existing] = await db
    .select({
      id: postsTable.id,
      userId: postsTable.userId,
      groupId: postsTable.groupId,
    })
    .from(postsTable)
    .where(eq(postsTable.id, params.data.postId));

  if (!existing || existing.groupId === null) {
    error(res, "Post not found", 404);
    return;
  }

  if (existing.userId !== req.userId) {
    error(res, "Forbidden — you do not own this post", 403);
    return;
  }

  const updateData: Partial<{
    content: string;
    feeling: string | null;
    imageUrl: string | null;
    mediaUrls: string[];
  }> = {};
  if (parsed.data.content !== undefined) updateData.content = parsed.data.content;
  if (parsed.data.feeling !== undefined) updateData.feeling = parsed.data.feeling ?? null;
  if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;
  if (parsed.data.mediaUrls !== undefined) updateData.mediaUrls = parsed.data.mediaUrls;

  await db
    .update(postsTable)
    .set(updateData)
    .where(eq(postsTable.id, params.data.postId));

  const rawPosts = await queryGroupPosts({
    groupId: existing.groupId,
    postId: params.data.postId,
  });
  const [formatted] = await buildGroupPosts(rawPosts, req.userId);

  success(res, "Group post updated", formatted);
});

// DELETE /groups/posts/:postId
router.delete("/groups/posts/:postId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteGroupPostParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid post ID", 400);
    return;
  }

  const [existing] = await db
    .select({
      id: postsTable.id,
      userId: postsTable.userId,
      groupId: postsTable.groupId,
    })
    .from(postsTable)
    .where(eq(postsTable.id, params.data.postId));

  if (!existing || existing.groupId === null) {
    error(res, "Post not found", 404);
    return;
  }

  if (existing.userId !== req.userId) {
    error(res, "Forbidden — you do not own this post", 403);
    return;
  }

  await db.delete(postsTable).where(eq(postsTable.id, params.data.postId));
  success(res, "Deleted successfully", {});
});

export default router;
