import "dotenv/config";
import express, { type Request } from "express";
import cors from "cors";
import { createServer } from "http";
import { registerRoutes } from "./routes";
type RequestWithRaw = Request & { rawBody?: Buffer };

async function main() {
  const app = express();

  // Normalise incoming URLs before anything else:
  //   1. Strip www. subdomain (301 to canonical domain).
  //   2. Normalise /CONNECT or /Connect prefix → /connect  (case-insensitive typed URLs).
  //
  // IMPORTANT: only the leading /connect segment is lowercased — never the rest of the
  // path.  Vite asset filenames contain uppercase hash chars (e.g. index-D3QuA1g2.js)
  // and lowercasing them would cause 404s → blank page.
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";

    // 1. www → canonical
    if (host.toLowerCase().startsWith("www.")) {
      const canonical = host.slice(4);
      return res.redirect(301, `${proto}://${canonical}${req.originalUrl}`);
    }

    // 2. /CONNECT[/...] → /connect[/...] — replace prefix only, preserve the rest as-is
    const url = req.originalUrl;
    const pathOnly = url.split("?")[0];
    if (/^\/connect(?=\/|$)/i.test(pathOnly) && !pathOnly.startsWith("/connect")) {
      const qs = url.includes("?") ? url.slice(url.indexOf("?")) : "";
      const normalised = pathOnly.replace(/^\/connect/i, "/connect");
      return res.redirect(301, normalised + qs);
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
