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
        // OAUTH_KV backs the OAuthProvider's token store (D9); DRAFTS/PHOTOS are
        // the draft + photo bindings (D3).
        kvNamespaces: ["DRAFTS", "OAUTH_KV"],
        r2Buckets: ["PHOTOS"],
        // Non-secret test fakes for the D9 routing/auth tests. Real secrets are
        // set with `wrangler secret put` at provisioning time (spec D11).
        bindings: {
          LINK_SECRET: "toets-geheim-moenie-gebruik-nie",
          OAUTH_MARINDA_USERNAME: "marinda",
          OAUTH_MARINDA_PASSWORD: "wagwoord-marinda",
          OAUTH_JOSHUA_USERNAME: "joshua",
          OAUTH_JOSHUA_PASSWORD: "wagwoord-joshua",
        },
      },
    }),
  ],
  // Unit/integration tests run inside workerd (`*.test.ts`). The upload page's
  // browser re-encode is exercised by Playwright against real Chromium
  // (`test/e2e/*.spec.ts`, run via `npm run test:e2e`) — those must not be
  // pulled into the workers pool, where `@playwright/test` cannot load.
  test: { include: ["test/**/*.test.ts"] },
  resolve: {
    alias: { "@site": new URL("../src", import.meta.url).pathname },
  },
});
