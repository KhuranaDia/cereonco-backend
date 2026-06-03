import { Router, type IRouter } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "../openapi-spec";

const router: IRouter = Router();

router.use("/docs", swaggerUi.serve);
router.get("/docs", swaggerUi.setup(openApiSpec, {
  customSiteTitle: "CereOnco API Docs",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
  },
}));

export default router;
