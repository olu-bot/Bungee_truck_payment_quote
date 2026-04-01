import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";

function serveConnectOnly(app: Express, connectDist: string): void {
  app.use(
    express.static(connectDist, {
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(connectDist, "index.html"));
  });
}

/**
 * When SERVE_UNIFIED_SITE=1:
 * - `/` → static marketing site from `website/shipbungee_website`
 * - `/connect/` → Bungee Connect SPA (build with VITE_BASE_PATH=/connect/)
 * - `/api/*` → already registered on `app` before this runs
 *
 * Otherwise: Connect only at `/` (Cloud Run default).
 */
export function serveStatic(app: Express): void {
  const connectDist = path.resolve(process.cwd(), "dist", "public");
  const unified =
    process.env.SERVE_UNIFIED_SITE === "1" || process.env.SERVE_UNIFIED_SITE === "true";

  if (!unified) {
    serveConnectOnly(app, connectDist);
    return;
  }

  const marketing = path.resolve(process.cwd(), "website", "shipbungee_website");
  if (!fs.existsSync(marketing)) {
    console.warn(
      "[static] SERVE_UNIFIED_SITE is set but website/shipbungee_website is missing — serving Connect only at /",
    );
    serveConnectOnly(app, connectDist);
    return;
  }

  // Do not 308 /connect → /connect/ (some LBs normalize paths and cause a redirect loop).

  // Hash-named assets: cache aggressively (1 year, immutable).
  // index.html: never cache — must always be fresh after deployments so browsers
  // load the latest chunk filenames instead of stale ones.
  app.use(
    "/connect",
    express.static(connectDist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/connect")) return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/connect/assets/")) return next();
    if (/\.[a-zA-Z0-9]{2,8}$/.test(req.path)) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(connectDist, "index.html"));
  });

  app.use(
    express.static(marketing, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
      },
    }),
  );

  app.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(marketing, "index.html"));
  });

  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    if (req.path.startsWith("/connect")) return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (/\.[a-zA-Z0-9]{2,8}$/.test(req.path)) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(marketing, "index.html"));
  });
}
