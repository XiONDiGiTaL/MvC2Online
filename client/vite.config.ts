import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Served from https://xiondigital.net/MvC2Online (GitHub Pages project path).
// Override with BASE_PATH=/ for a root-hosted deployment (e.g. Railway).
export default defineConfig({
  root: here,
  base: process.env.BASE_PATH ?? "/MvC2Online/",
  build: {
    outDir: resolve(here, "../dist"),
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
});
