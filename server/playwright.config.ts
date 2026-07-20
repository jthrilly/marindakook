import { defineConfig } from "@playwright/test";

// Drives the upload page's browser re-encode against real Chromium. Kept apart
// from the vitest workers pool (which runs `*.test.ts` inside workerd) — here
// we need a browser with canvas/createImageBitmap, not a Worker isolate.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: { browserName: "chromium" },
});
