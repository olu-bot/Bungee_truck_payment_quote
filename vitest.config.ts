import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "client", "src"),
      "@shared": path.resolve(rootDir, "shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["client/src/**/*.test.{ts,tsx}", "shared/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["client/src/lib/**", "shared/**"],
    },
  },
});
