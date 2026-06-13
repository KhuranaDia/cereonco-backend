import { createServer } from "node:http";
import app from "./app";
import { initSocket } from "./socket";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Express and Socket.IO share one HTTP server so WebSockets and REST live on
// the same port (required by the reverse proxy and by Render).
const httpServer = createServer(app);
initSocket(httpServer);

httpServer.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
