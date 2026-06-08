import { Router, type IRouter } from "express";
import { openApiSpec } from "../openapi-spec";

const router: IRouter = Router();

router.get("/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

router.get("/docs", (_req, res) => {
  res.type("html").send(`
<!DOCTYPE html>
<html>
<head>
  <title>CereOnco API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: "#swagger-ui",
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout",
        persistAuthorization: true,
        displayRequestDuration: true
      });
    };
  </script>
</body>
</html>
`);
});

export default router;
