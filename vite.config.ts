import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Client build. The SPA lives under /mp/ in both host modes so that the
// dashboard proxy and the standalone server can serve the same bundle.
const apiPort = process.env["MP_PORT"] ?? "8105";

export default defineConfig({
  root: fileURLToPath(new URL("./src/client", import.meta.url)),
  base: "/mp/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/client", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    open: "/mp/",
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
});
