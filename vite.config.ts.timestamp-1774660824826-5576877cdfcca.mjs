// vite.config.ts
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "file:///sessions/vibrant-tender-bohr/mnt/Bungee%20Connect%20Launch/Video%20Demo/Bungee_truck_payment_quote/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/vibrant-tender-bohr/mnt/Bungee%20Connect%20Launch/Video%20Demo/Bungee_truck_payment_quote/node_modules/@vitejs/plugin-react/dist/index.js";
var __vite_injected_original_import_meta_url = "file:///sessions/vibrant-tender-bohr/mnt/Bungee%20Connect%20Launch/Video%20Demo/Bungee_truck_payment_quote/vite.config.ts";
var rootDir = path.dirname(fileURLToPath(__vite_injected_original_import_meta_url));
var vite_config_default = defineConfig({
  root: path.resolve(rootDir, "client"),
  /** Load `.env` from repo root (beside this file), not from `client/`. */
  envDir: rootDir,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "client", "src"),
      "@shared": path.resolve(rootDir, "shared")
    }
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
          "vendor-ui": ["@tanstack/react-query", "@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tooltip"]
        }
      }
    }
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
      "lucide-react"
    ]
  },
  server: {
    fs: {
      allow: [rootDir]
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvdmlicmFudC10ZW5kZXItYm9oci9tbnQvQnVuZ2VlIENvbm5lY3QgTGF1bmNoL1ZpZGVvIERlbW8vQnVuZ2VlX3RydWNrX3BheW1lbnRfcXVvdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy92aWJyYW50LXRlbmRlci1ib2hyL21udC9CdW5nZWUgQ29ubmVjdCBMYXVuY2gvVmlkZW8gRGVtby9CdW5nZWVfdHJ1Y2tfcGF5bWVudF9xdW90ZS92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvdmlicmFudC10ZW5kZXItYm9oci9tbnQvQnVuZ2VlJTIwQ29ubmVjdCUyMExhdW5jaC9WaWRlbyUyMERlbW8vQnVuZ2VlX3RydWNrX3BheW1lbnRfcXVvdGUvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XG5cbmNvbnN0IHJvb3REaXIgPSBwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKTtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcm9vdDogcGF0aC5yZXNvbHZlKHJvb3REaXIsIFwiY2xpZW50XCIpLFxuICAvKiogTG9hZCBgLmVudmAgZnJvbSByZXBvIHJvb3QgKGJlc2lkZSB0aGlzIGZpbGUpLCBub3QgZnJvbSBgY2xpZW50L2AuICovXG4gIGVudkRpcjogcm9vdERpcixcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUocm9vdERpciwgXCJjbGllbnRcIiwgXCJzcmNcIiksXG4gICAgICBcIkBzaGFyZWRcIjogcGF0aC5yZXNvbHZlKHJvb3REaXIsIFwic2hhcmVkXCIpLFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgb3V0RGlyOiBwYXRoLnJlc29sdmUocm9vdERpciwgXCJkaXN0XCIsIFwicHVibGljXCIpLFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICAvKiBDb3JlIFJlYWN0IHJ1bnRpbWUgXHUyMDE0IGNhY2hlZCBhY3Jvc3MgYWxsIHJvdXRlcyAqL1xuICAgICAgICAgIFwidmVuZG9yLXJlYWN0XCI6IFtcInJlYWN0XCIsIFwicmVhY3QtZG9tXCIsIFwicmVhY3QvanN4LXJ1bnRpbWVcIiwgXCJ3b3V0ZXJcIl0sXG4gICAgICAgICAgLyogRmlyZWJhc2UgU0RLIFx1MjAxNCBoZWF2eSBidXQgb25seSBuZWVkZWQgYWZ0ZXIgYXV0aCBjaGVjayAqL1xuICAgICAgICAgIFwidmVuZG9yLWZpcmViYXNlXCI6IFtcImZpcmViYXNlL2FwcFwiLCBcImZpcmViYXNlL2F1dGhcIiwgXCJmaXJlYmFzZS9maXJlc3RvcmVcIl0sXG4gICAgICAgICAgLyogRGF0YS1mZXRjaGluZyAmIFVJIHByaW1pdGl2ZXMgKi9cbiAgICAgICAgICBcInZlbmRvci11aVwiOiBbXCJAdGFuc3RhY2svcmVhY3QtcXVlcnlcIiwgXCJAcmFkaXgtdWkvcmVhY3QtZGlhbG9nXCIsIFwiQHJhZGl4LXVpL3JlYWN0LXNlbGVjdFwiLCBcIkByYWRpeC11aS9yZWFjdC10b29sdGlwXCJdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBvcHRpbWl6ZURlcHM6IHtcbiAgICBpbmNsdWRlOiBbXG4gICAgICBcInJlYWN0XCIsXG4gICAgICBcInJlYWN0LWRvbVwiLFxuICAgICAgXCJyZWFjdC9qc3gtcnVudGltZVwiLFxuICAgICAgXCJ3b3V0ZXJcIixcbiAgICAgIFwiZmlyZWJhc2UvYXBwXCIsXG4gICAgICBcImZpcmViYXNlL2F1dGhcIixcbiAgICAgIFwiZmlyZWJhc2UvZmlyZXN0b3JlXCIsXG4gICAgICBcIkB0YW5zdGFjay9yZWFjdC1xdWVyeVwiLFxuICAgICAgXCJsdWNpZGUtcmVhY3RcIixcbiAgICBdLFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBmczoge1xuICAgICAgYWxsb3c6IFtyb290RGlyXSxcbiAgICB9LFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQStjLE9BQU8sVUFBVTtBQUNoZSxTQUFTLHFCQUFxQjtBQUM5QixTQUFTLG9CQUFvQjtBQUM3QixPQUFPLFdBQVc7QUFIZ1IsSUFBTSwyQ0FBMkM7QUFLblYsSUFBTSxVQUFVLEtBQUssUUFBUSxjQUFjLHdDQUFlLENBQUM7QUFFM0QsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsTUFBTSxLQUFLLFFBQVEsU0FBUyxRQUFRO0FBQUE7QUFBQSxFQUVwQyxRQUFRO0FBQUEsRUFDUixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsU0FBUyxVQUFVLEtBQUs7QUFBQSxNQUMxQyxXQUFXLEtBQUssUUFBUSxTQUFTLFFBQVE7QUFBQSxJQUMzQztBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVEsS0FBSyxRQUFRLFNBQVMsUUFBUSxRQUFRO0FBQUEsSUFDOUMsYUFBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sY0FBYztBQUFBO0FBQUEsVUFFWixnQkFBZ0IsQ0FBQyxTQUFTLGFBQWEscUJBQXFCLFFBQVE7QUFBQTtBQUFBLFVBRXBFLG1CQUFtQixDQUFDLGdCQUFnQixpQkFBaUIsb0JBQW9CO0FBQUE7QUFBQSxVQUV6RSxhQUFhLENBQUMseUJBQXlCLDBCQUEwQiwwQkFBMEIseUJBQXlCO0FBQUEsUUFDdEg7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLGNBQWM7QUFBQSxJQUNaLFNBQVM7QUFBQSxNQUNQO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sSUFBSTtBQUFBLE1BQ0YsT0FBTyxDQUFDLE9BQU87QUFBQSxJQUNqQjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
