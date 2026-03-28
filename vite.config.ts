import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** Subpath when hosted at e.g. https://shipbungee.com/connect/ (`/connect/`). Default `/` for Cloud Run root. */
function normalizeViteBase(raw: string | undefined): string {
  const b = (raw || "/").trim();
  if (!b || b === "/") return "/";
  let x = b.startsWith("/") ? b : `/${b}`;
  if (!x.endsWith("/")) x += "/";
  return x;
}
const viteBase = normalizeViteBase(process.env.VITE_BASE_PATH);

export default defineConfig({
  base: viteBase,
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
    rollupOptions: {
      output: {
        manualChunks: {
          /* Core React runtime — cached across all routes */
          "vendor-react": ["react", "react-dom", "react/jsx-runtime", "wouter"],
          /* Firebase SDK — heavy but only needed after auth check */
          "vendor-firebase": ["firebase/app", "firebase/auth", "firebase/firestore"],
          /* Data-fetching & UI primitives */
          "vendor-ui": ["@tanstack/react-query", "@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tooltip"],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "wouter",
      "firebase/app",
      "firebase/auth",
      "firebase/firestore",
      "@tanstack/react-query",
      "lucide-react",
    ],
  },
  server: {
    fs: {
      allow: [rootDir],
    },
  },
});
