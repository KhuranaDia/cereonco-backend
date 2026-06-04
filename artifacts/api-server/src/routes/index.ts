import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import postsRouter from "./posts";
import commentsRouter from "./comments";
import groupsRouter from "./groups";
import docsRouter from "./docs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(postsRouter);
router.use(commentsRouter);
router.use(groupsRouter);
router.use(docsRouter);

export default router;
