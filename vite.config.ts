import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(rootDir, "client"),
  /** Load `.env` from repo root (beside this file), not from `client/`. */
  envDir: rootDir,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "client", "src"),
      "@shared": path.resolve(rootDir, "shared"),
    },
  },
  build: {
    outDir: path.resolve(rootDir, "dist", "public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [rootDir],
    },
  },
});
