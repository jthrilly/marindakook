import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Production/deploy build ONLY. Tests use vitest.config.ts (the
// @cloudflare/vitest-pool-workers pipeline) and never load this file — Vitest
// prefers vitest.config.ts when both exist. Using the Cloudflare Vite plugin
// here means `wrangler deploy` bundles through the SAME Vite pipeline the tests
// already run under, so the `?raw` text/JSON imports in src/index.ts resolve and
// inline identically (esbuild's bare `wrangler deploy` cannot resolve `?raw`).
// The `@site` alias mirrors vitest.config.ts / tsconfig `paths` so the Worker's
// imports of the repo's shared `../src/lib` modules resolve during the build.
export default defineConfig({
  plugins: [cloudflare({ configPath: "./wrangler.toml" })],
  resolve: {
    alias: { "@site": new URL("../src", import.meta.url).pathname },
  },
});
