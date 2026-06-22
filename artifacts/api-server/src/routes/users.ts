import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { UpdateMeBody, GetUserParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { uploadAvatar, publicUrl } from "../middlewares/upload";
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

  // Multipart avatar upload: store the public URL on both avatarUrl and the
  // legacy profilePhotoUrl so existing clients keep working.
  const avatarPath = req.file
    ? publicUrl("avatars", req.file.filename)
    : undefined;

  if (Object.keys(updates).length === 0 && !avatarPath) {
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
    avatarUrl?: string;
    profilePhotoUrl?: string;
  } = { ...updates };
  if (avatarPath) {
    finalUpdates.avatarUrl = avatarPath;
    finalUpdates.profilePhotoUrl = avatarPath;
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
