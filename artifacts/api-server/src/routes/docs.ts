import { Router, type IRouter } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "../openapi-spec";

const router: IRouter = Router();

router.use("/docs", swaggerUi.serveFiles(openApiSpec));

router.get(
  "/docs",
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "CereOnco API Docs",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  }),
);

router.get("/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

export default router;
