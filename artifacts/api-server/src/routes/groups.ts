import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  db,
  groupsTable,
  groupMembersTable,
  groupPostsTable,
  usersTable,
} from "@workspace/db";
import {
  ListGroupsQueryParams,
  GetGroupParams,
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
import { success, error } from "../utils/response";

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
  group: { id: number; name: string; description: string; category: string; imageUrl: string | null; createdAt: Date; updatedAt: Date },
  memberCount: number,
  isMember: boolean,
) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    category: group.category,
    imageUrl: group.imageUrl,
    memberCount,
    isMember,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

// GET /groups
router.get("/groups", requireAuth, async (req, res): Promise<void> => {
  const query = ListGroupsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const rows = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      description: groupsTable.description,
      category: groupsTable.category,
      imageUrl: groupsTable.imageUrl,
      createdAt: groupsTable.createdAt,
      updatedAt: groupsTable.updatedAt,
      memberCount: sql<number>`cast(count(distinct ${groupMembersTable.id}) as integer)`,
    })
    .from(groupsTable)
    .leftJoin(groupMembersTable, eq(groupMembersTable.groupId, groupsTable.id))
    .groupBy(groupsTable.id)
    .orderBy(desc(groupsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const userId = req.userId!;
  const groupIds = rows.map((r) => r.id);

  // Batch membership check
  let memberSet = new Set<number>();
  if (groupIds.length > 0) {
    const memberships = await db
      .select({ groupId: groupMembersTable.groupId })
      .from(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.userId, userId),
          sql`${groupMembersTable.groupId} = ANY(${sql.raw(`ARRAY[${groupIds.join(",")}]::int[]`)})`,
        ),
      );
    memberSet = new Set(memberships.map((m) => m.groupId));
  }

  const groups = rows.map((r) =>
    buildGroupResponse(r, r.memberCount, memberSet.has(r.id)),
  );

  success(res, "Groups retrieved", { groups, total: groups.length });
});

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

  success(res, "Group retrieved", buildGroupResponse(group, memberCount, isMember));
});

// POST /groups/:id/join
router.post("/groups/:id/join", requireAuth, async (req, res): Promise<void> => {
  const params = JoinGroupParams.safeParse(req.params);
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

  await db
    .insert(groupMembersTable)
    .values({ groupId: params.data.id, userId: req.userId! })
    .onConflictDoNothing();

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
    .select({ id: groupsTable.id })
    .from(groupsTable)
    .where(eq(groupsTable.id, params.data.id));

  if (!group) {
    error(res, "Group not found", 404);
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

  const posts = await db
    .select({
      id: groupPostsTable.id,
      groupId: groupPostsTable.groupId,
      userId: groupPostsTable.userId,
      content: groupPostsTable.content,
      imageUrl: groupPostsTable.imageUrl,
      createdAt: groupPostsTable.createdAt,
      updatedAt: groupPostsTable.updatedAt,
      authorId: usersTable.id,
      authorName: usersTable.name,
      authorRole: usersTable.role,
      authorAvatarUrl: usersTable.avatarUrl,
    })
    .from(groupPostsTable)
    .innerJoin(usersTable, eq(groupPostsTable.userId, usersTable.id))
    .where(eq(groupPostsTable.groupId, params.data.id))
    .orderBy(desc(groupPostsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const formatted = posts.map((p) => ({
    id: p.id,
    groupId: p.groupId,
    userId: p.userId,
    content: p.content,
    imageUrl: p.imageUrl,
    author: {
      id: p.authorId,
      name: p.authorName,
      role: p.authorRole,
      avatarUrl: p.authorAvatarUrl,
    },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  success(res, "Group feed retrieved", { posts: formatted, total: formatted.length });
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
    .select({ id: groupsTable.id })
    .from(groupsTable)
    .where(eq(groupsTable.id, params.data.id));

  if (!group) {
    error(res, "Group not found", 404);
    return;
  }

  const [inserted] = await db
    .insert(groupPostsTable)
    .values({
      groupId: params.data.id,
      userId: req.userId!,
      content: parsed.data.content,
      imageUrl: parsed.data.imageUrl ?? null,
    })
    .returning();

  const [author] = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  success(
    res,
    "Group post created",
    {
      id: inserted.id,
      groupId: inserted.groupId,
      userId: inserted.userId,
      content: inserted.content,
      imageUrl: inserted.imageUrl,
      author,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    },
    201,
  );
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

  if (!parsed.data.content && parsed.data.imageUrl === undefined) {
    error(res, "No fields provided to update", 400);
    return;
  }

  const [existing] = await db
    .select({ id: groupPostsTable.id, userId: groupPostsTable.userId })
    .from(groupPostsTable)
    .where(eq(groupPostsTable.id, params.data.postId));

  if (!existing) {
    error(res, "Post not found", 404);
    return;
  }

  if (existing.userId !== req.userId) {
    error(res, "Forbidden — you do not own this post", 403);
    return;
  }

  const updateData: Partial<{ content: string; imageUrl: string | null }> = {};
  if (parsed.data.content !== undefined) updateData.content = parsed.data.content;
  if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;

  const [updated] = await db
    .update(groupPostsTable)
    .set(updateData)
    .where(eq(groupPostsTable.id, params.data.postId))
    .returning();

  const [author] = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  success(res, "Group post updated", {
    id: updated.id,
    groupId: updated.groupId,
    userId: updated.userId,
    content: updated.content,
    imageUrl: updated.imageUrl,
    author,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
});

// DELETE /groups/posts/:postId
router.delete("/groups/posts/:postId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteGroupPostParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid post ID", 400);
    return;
  }

  const [existing] = await db
    .select({ id: groupPostsTable.id, userId: groupPostsTable.userId })
    .from(groupPostsTable)
    .where(eq(groupPostsTable.id, params.data.postId));

  if (!existing) {
    error(res, "Post not found", 404);
    return;
  }

  if (existing.userId !== req.userId) {
    error(res, "Forbidden — you do not own this post", 403);
    return;
  }

  await db.delete(groupPostsTable).where(eq(groupPostsTable.id, params.data.postId));
  res.sendStatus(204);
});

export default router;
