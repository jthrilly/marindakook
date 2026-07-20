import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// vitest-pool-workers v0.18 (vitest 4): the pool is a Vite plugin
// (`cloudflareTest`) rather than the old `defineWorkersConfig` wrapper. Tests
// run inside workerd via miniflare — no Cloudflare account or network needed.
// KV/R2 are bound here (the wrangler.toml stubs stay commented) so later
// store/MCP tasks get real bindings; this task's modules are pure.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        kvNamespaces: ["DRAFTS"],
        r2Buckets: ["PHOTOS"],
      },
    }),
  ],
  resolve: {
    alias: { "@site": new URL("../src", import.meta.url).pathname },
  },
});
