import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3100",
      "/multiview": "http://127.0.0.1:3100",
      "/pipgm": "http://127.0.0.1:3100"
    }
  }
});
