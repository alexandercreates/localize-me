import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// Quellcode der Oberfläche liegt in web/, der fertige Build in ui/ (wird mit dem npm-Paket ausgeliefert).
export default defineConfig({
  root: r("./web"),
  plugins: [svelte()],
  resolve: {
    alias: {
      "@shared": r("./src"),
      "@fonts": r("./node_modules/@fontsource-variable"),
    },
  },
  build: {
    outDir: r("./ui"),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    // Ziel setzt scripts/dev.js, sobald der API-Server läuft.
    proxy: { "/api": { target: process.env.LOCALIZE_ME_API || "http://127.0.0.1:4848", changeOrigin: false } },
  },
});
