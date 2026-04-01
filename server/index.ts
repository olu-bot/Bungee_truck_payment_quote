import "dotenv/config";
import express, { type Request } from "express";
import cors from "cors";
import { createServer } from "http";
import { registerRoutes } from "./routes";
type RequestWithRaw = Request & { rawBody?: Buffer };

async function main() {
  const app = express();

  // Redirect www.shipbungee.com/* → shipbungee.com/* (preserves full path + query).
  // Must run before everything else so the canonical domain is always used.
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (host.startsWith("www.")) {
      const proto = (req.headers["x-forwarded-proto"] as string) || "https";
      const canonical = host.slice(4); // strip "www."
      return res.redirect(301, `${proto}://${canonical}${req.originalUrl}`);
    }
    next();
  });

  // Build CORS allowed-origins list — include both bare and www variants so that
  // any request that slips through before the redirect above still works.
  const publicUrl = process.env.PUBLIC_APP_URL || "";
  const wwwUrl = publicUrl.replace("://", "://www.");
  const allowedOrigins = [
    publicUrl,
    wwwUrl,
    "http://localhost:5000",
    "http://localhost:5173",
  ].filter(Boolean) as string[];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);
      if (allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
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
