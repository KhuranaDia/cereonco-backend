import { Router, type IRouter } from "express";
import { eq, or, ilike, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { UpdateMeBody, GetUserParams, SearchUsersQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { uploadAvatar, pickProfileImage, publicUrl } from "../middlewares/upload";
import { safeUser } from "../utils/safeUser";
import { success, error } from "../utils/response";

const router: IRouter = Router();

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  if (!user) {
    error(res, "User not found", 404);
    return;
  }
  success(res, "Profile retrieved", safeUser(user));
});

router.patch(
  "/users/me",
  requireAuth,
  uploadAvatar,
  async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const updates = parsed.data;

  // Multipart image upload: accept the new `image` field (preferred) or the
  // legacy `avatar` field, and mirror the public URL onto imageUrl, avatarUrl
  // and profilePhotoUrl so every client variant keeps working.
  const file = pickProfileImage(req);
  const imagePath = file ? publicUrl("avatars", file.filename) : undefined;

  if (Object.keys(updates).length === 0 && !imagePath) {
    error(res, "No fields provided to update", 400);
    return;
  }

  // Fetch current user to apply business logic
  const [current] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  if (!current) {
    error(res, "User not found", 404);
    return;
  }

  // Auto-pending: when a medical_professional submits their license number
  // for the first time (verificationStatus is currently 'none'), set status to 'pending'
  const finalUpdates: typeof updates & {
    verificationStatus?: "pending";
    imageUrl?: string;
    avatarUrl?: string;
    profilePhotoUrl?: string;
  } = { ...updates };
  if (imagePath) {
    finalUpdates.imageUrl = imagePath;
    finalUpdates.avatarUrl = imagePath;
    finalUpdates.profilePhotoUrl = imagePath;
  }
  if (
    current.role === "medical_professional" &&
    updates.medicalLicenseNumber !== undefined &&
    updates.medicalLicenseNumber.length > 0 &&
    current.verificationStatus === "none"
  ) {
    finalUpdates.verificationStatus = "pending";
  }

  const [updated] = await db
    .update(usersTable)
    .set(finalUpdates)
    .where(eq(usersTable.id, req.userId!))
    .returning();

  if (!updated) {
    error(res, "User not found", 404);
    return;
  }
  success(res, "Profile updated", safeUser(updated));
});

// GET /users/search?q=&limit=&offset= — must precede /users/:id so "search"
// is not captured as an :id. Case-insensitive match on name OR email; returns
// only safe public fields plus a total count of all matches.
router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const query = SearchUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    error(res, "Query 'q' must be at least 2 characters", 400);
    return;
  }

  const { q, limit, offset } = query.data;
  const pattern = `%${q}%`;
  const match = or(ilike(usersTable.name, pattern), ilike(usersTable.email, pattern));

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        avatarUrl: usersTable.avatarUrl,
        profilePhotoUrl: usersTable.profilePhotoUrl,
        imageUrl: usersTable.imageUrl,
      })
      .from(usersTable)
      .where(match)
      .orderBy(usersTable.name)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`cast(count(*) as integer)` })
      .from(usersTable)
      .where(match),
  ]);

  success(res, "Users retrieved successfully", { users: rows, total });
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid user ID", 400);
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    error(res, "User not found", 404);
    return;
  }
  success(res, "User profile retrieved", safeUser(user));
});

export default router;
