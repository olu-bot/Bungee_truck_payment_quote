import "dotenv/config";
import express, { type Request } from "express";
import cors from "cors";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { validateEnv } from "./envValidation";

type RequestWithRaw = Request & { rawBody?: Buffer };

async function main() {
  validateEnv();

  const app = express();
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim())
    : undefined;

  app.use(cors({
    origin: process.env.NODE_ENV === "production" && allowedOrigins
      ? allowedOrigins
      : true,
    credentials: true,
  }));

  app.use(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    (req: RequestWithRaw, _res, next) => {
      req.rawBody = req.body as Buffer;
      next();
    },
  );

  app.use(express.json({ limit: "2mb" }));

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const { setupVite } = await import("./vite");
    await setupVite(app, httpServer);
  } else {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  }

  const port = Number(process.env.PORT) || 5000;
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(port, host, () => {
    console.log(`[server] http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
