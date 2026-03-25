import fs from "fs";
import path from "path";
import type { Express } from "express";
import type { Server } from "http";
import { createServer as createViteServer } from "vite";

export async function setupVite(app: Express, server: Server): Promise<void> {
  const clientRoot = path.resolve(process.cwd(), "client");
  const vite = await createViteServer({
    root: clientRoot,
    configFile: path.resolve(process.cwd(), "vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: { server },
      watch: { usePolling: true, interval: 200 },
    },
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      let template = fs.readFileSync(path.join(clientRoot, "index.html"), "utf-8");
      template = await vite.transformIndexHtml(url, template);
      res.status(200).setHeader("Content-Type", "text/html").end(template);
    } catch (e) {
      next(e);
    }
  });
}
