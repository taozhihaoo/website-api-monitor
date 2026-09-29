import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development the Vite dev server proxies API calls to the backend.
// Override the target with BACKEND_ORIGIN when 8000 is taken locally.
// In production (Docker) nginx serves the SPA and proxies /api itself.
const backendOrigin = process.env.BACKEND_ORIGIN || "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": backendOrigin,
      "/health": backendOrigin,
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
