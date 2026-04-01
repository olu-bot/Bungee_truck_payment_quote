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
    globals: true,
    environment: "happy-dom",
    include: [
      "client/src/**/*.test.{ts,tsx}",
      "server/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "client/src/lib/**",
        "server/**",
        "shared/**",
      ],
    },
  },
});
