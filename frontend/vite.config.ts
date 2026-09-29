import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import http from "node:http";

// In development the Vite dev server proxies API calls to the backend.
// Override the target with BACKEND_ORIGIN when 8000 is taken locally.
// In production (Docker) nginx serves the SPA and proxies /api itself.
const backendOrigin = process.env.BACKEND_ORIGIN || "http://localhost:8000";

// Node >=19 enables keep-alive on the global agent, while uvicorn closes idle
// connections after 5s — a reused half-closed socket then stalls requests
// (POSTs are never retried). A fresh non-keep-alive agent per proxy makes the
// dev proxy deterministic.
const proxyAgent = new http.Agent({ keepAlive: false, maxSockets: 64 });

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: backendOrigin,
        agents: [proxyAgent],
      },
      "/health": {
        target: backendOrigin,
        agents: [proxyAgent],
      },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
