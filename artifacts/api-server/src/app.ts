import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { UPLOADS_ROOT } from "./middlewares/upload";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve locally-stored uploads. Mounted at both `/uploads` (Render host) and
// `/api/uploads` (so it routes through the Replit reverse proxy, which only
// forwards the `/api` prefix to this service).
const staticOpts = { fallthrough: true, maxAge: "1d" };
app.use("/uploads", express.static(UPLOADS_ROOT, staticOpts));
app.use("/api/uploads", express.static(UPLOADS_ROOT, staticOpts));

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "CereOnco API is running",
    data: {
      version: "v1",
      api: "/api",
      health: "/api/healthz",
      docs: "/api/docs",
    },
  });
});

app.use("/api", router);

export default app;
