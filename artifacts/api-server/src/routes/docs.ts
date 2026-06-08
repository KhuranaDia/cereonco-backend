import { Router, type IRouter } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "../openapi-spec";

const router: IRouter = Router();

router.get("/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

router.use("/docs", swaggerUi.serve);

router.get("/docs", (_req, res) => {
  res.send(
    swaggerUi.generateHTML(openApiSpec, {
      customSiteTitle: "CereOnco API Docs",
      swaggerOptions: {
        url: "/api/openapi.json",
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    }),
  );
});

export default router;
