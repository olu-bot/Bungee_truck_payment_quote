// vite.config.ts
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "file:///sessions/gifted-cool-clarke/mnt/Bungee%20Connect%20Launch/Bungee_truck_payment_quote/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/gifted-cool-clarke/mnt/Bungee%20Connect%20Launch/Bungee_truck_payment_quote/node_modules/@vitejs/plugin-react/dist/index.js";
var __vite_injected_original_import_meta_url = "file:///sessions/gifted-cool-clarke/mnt/Bungee%20Connect%20Launch/Bungee_truck_payment_quote/vite.config.ts";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvZ2lmdGVkLWNvb2wtY2xhcmtlL21udC9CdW5nZWUgQ29ubmVjdCBMYXVuY2gvQnVuZ2VlX3RydWNrX3BheW1lbnRfcXVvdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy9naWZ0ZWQtY29vbC1jbGFya2UvbW50L0J1bmdlZSBDb25uZWN0IExhdW5jaC9CdW5nZWVfdHJ1Y2tfcGF5bWVudF9xdW90ZS92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvZ2lmdGVkLWNvb2wtY2xhcmtlL21udC9CdW5nZWUlMjBDb25uZWN0JTIwTGF1bmNoL0J1bmdlZV90cnVja19wYXltZW50X3F1b3RlL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwidXJsXCI7XG5pbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuXG5jb25zdCByb290RGlyID0gcGF0aC5kaXJuYW1lKGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKSk7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHJvb3Q6IHBhdGgucmVzb2x2ZShyb290RGlyLCBcImNsaWVudFwiKSxcbiAgLyoqIExvYWQgYC5lbnZgIGZyb20gcmVwbyByb290IChiZXNpZGUgdGhpcyBmaWxlKSwgbm90IGZyb20gYGNsaWVudC9gLiAqL1xuICBlbnZEaXI6IHJvb3REaXIsXG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICBcIkBcIjogcGF0aC5yZXNvbHZlKHJvb3REaXIsIFwiY2xpZW50XCIsIFwic3JjXCIpLFxuICAgICAgXCJAc2hhcmVkXCI6IHBhdGgucmVzb2x2ZShyb290RGlyLCBcInNoYXJlZFwiKSxcbiAgICB9LFxuICB9LFxuICBidWlsZDoge1xuICAgIG91dERpcjogcGF0aC5yZXNvbHZlKHJvb3REaXIsIFwiZGlzdFwiLCBcInB1YmxpY1wiKSxcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgLyogQ29yZSBSZWFjdCBydW50aW1lIFx1MjAxNCBjYWNoZWQgYWNyb3NzIGFsbCByb3V0ZXMgKi9cbiAgICAgICAgICBcInZlbmRvci1yZWFjdFwiOiBbXCJyZWFjdFwiLCBcInJlYWN0LWRvbVwiLCBcInJlYWN0L2pzeC1ydW50aW1lXCIsIFwid291dGVyXCJdLFxuICAgICAgICAgIC8qIEZpcmViYXNlIFNESyBcdTIwMTQgaGVhdnkgYnV0IG9ubHkgbmVlZGVkIGFmdGVyIGF1dGggY2hlY2sgKi9cbiAgICAgICAgICBcInZlbmRvci1maXJlYmFzZVwiOiBbXCJmaXJlYmFzZS9hcHBcIiwgXCJmaXJlYmFzZS9hdXRoXCIsIFwiZmlyZWJhc2UvZmlyZXN0b3JlXCJdLFxuICAgICAgICAgIC8qIERhdGEtZmV0Y2hpbmcgJiBVSSBwcmltaXRpdmVzICovXG4gICAgICAgICAgXCJ2ZW5kb3ItdWlcIjogW1wiQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5XCIsIFwiQHJhZGl4LXVpL3JlYWN0LWRpYWxvZ1wiLCBcIkByYWRpeC11aS9yZWFjdC1zZWxlY3RcIiwgXCJAcmFkaXgtdWkvcmVhY3QtdG9vbHRpcFwiXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgb3B0aW1pemVEZXBzOiB7XG4gICAgaW5jbHVkZTogW1xuICAgICAgXCJyZWFjdFwiLFxuICAgICAgXCJyZWFjdC1kb21cIixcbiAgICAgIFwicmVhY3QvanN4LXJ1bnRpbWVcIixcbiAgICAgIFwid291dGVyXCIsXG4gICAgICBcImZpcmViYXNlL2FwcFwiLFxuICAgICAgXCJmaXJlYmFzZS9hdXRoXCIsXG4gICAgICBcImZpcmViYXNlL2ZpcmVzdG9yZVwiLFxuICAgICAgXCJAdGFuc3RhY2svcmVhY3QtcXVlcnlcIixcbiAgICAgIFwibHVjaWRlLXJlYWN0XCIsXG4gICAgXSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgZnM6IHtcbiAgICAgIGFsbG93OiBbcm9vdERpcl0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5YSxPQUFPLFVBQVU7QUFDMWIsU0FBUyxxQkFBcUI7QUFDOUIsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxXQUFXO0FBSHdQLElBQU0sMkNBQTJDO0FBSzNULElBQU0sVUFBVSxLQUFLLFFBQVEsY0FBYyx3Q0FBZSxDQUFDO0FBRTNELElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLE1BQU0sS0FBSyxRQUFRLFNBQVMsUUFBUTtBQUFBO0FBQUEsRUFFcEMsUUFBUTtBQUFBLEVBQ1IsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLFNBQVMsVUFBVSxLQUFLO0FBQUEsTUFDMUMsV0FBVyxLQUFLLFFBQVEsU0FBUyxRQUFRO0FBQUEsSUFDM0M7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRLEtBQUssUUFBUSxTQUFTLFFBQVEsUUFBUTtBQUFBLElBQzlDLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGNBQWM7QUFBQTtBQUFBLFVBRVosZ0JBQWdCLENBQUMsU0FBUyxhQUFhLHFCQUFxQixRQUFRO0FBQUE7QUFBQSxVQUVwRSxtQkFBbUIsQ0FBQyxnQkFBZ0IsaUJBQWlCLG9CQUFvQjtBQUFBO0FBQUEsVUFFekUsYUFBYSxDQUFDLHlCQUF5QiwwQkFBMEIsMEJBQTBCLHlCQUF5QjtBQUFBLFFBQ3RIO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixTQUFTO0FBQUEsTUFDUDtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLElBQUk7QUFBQSxNQUNGLE9BQU8sQ0FBQyxPQUFPO0FBQUEsSUFDakI7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
