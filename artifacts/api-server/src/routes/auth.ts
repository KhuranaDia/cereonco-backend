import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { generateToken } from "../utils/token";
import { success, error } from "../utils/response";

const router: IRouter = Router();

function safeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _pw, ...pub } = user;
  return pub;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const { name, email, password, role } = parsed.data;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing) {
    error(res, "Email already in use", 409);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db
    .insert(usersTable)
    .values({ name, email, passwordHash, role })
    .returning();

  const token = generateToken({ userId: user.id });
  success(res, "Registered successfully", { token, user: safeUser(user) }, 201);
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (!user) {
    error(res, "Invalid email or password", 401);
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    error(res, "Invalid email or password", 401);
    return;
  }

  const token = generateToken({ userId: user.id });
  success(res, "Logged in successfully", { token, user: safeUser(user) });
});

router.post("/auth/logout", (_req, res): void => {
  success(res, "Logged out successfully");
});

export default router;
