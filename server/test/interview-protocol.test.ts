/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
// Vite's `?raw` suffix inlines the file's text at transform time (on the
// host, via the pool's Vite plugin), so the string is a bundled literal by
// the time this module runs inside workerd — no runtime `node:fs` access
// (unavailable in the vitest-pool-workers sandbox) is needed. The
// `*?raw` module type comes from vite/client (referenced above).
import protocol from "../prompts/interview-af.md?raw";

// Guards against `server/prompts/interview-af.md` drifting from what the MCP
// tests assume. mcp-drafts.test.ts injects a hand-authored fixture instead of
// reading this file (see its DISTINCTIVE constant), so an edit here could
// silently break `begin_draft`/`resume_draft` behaviour without failing that
// suite. This test reads the real file's content and asserts the
// load-bearing phrases the interview connector depends on are still present.

describe("interview-af.md protocol file", () => {
  it("asks explicitly whether the recipe should show on the front page", () => {
    // Same sentence mcp-drafts.test.ts's DISTINCTIVE constant keys on — keeps
    // the fixture and the real file from drifting apart silently.
    expect(protocol).toContain("Moet hierdie resep op die voorblad wys?");
  });

  it("instructs excluding the internal categories from the offered choices", () => {
    expect(protocol).toContain(
      "moenie die interne terme *Featured*, *Uncategorised* of *Eenhede* as keuses",
    );
  });

  it("instructs asking one question at a time", () => {
    expect(protocol).toContain("Een vraag op 'n slag");
  });

  it("instructs never inventing quantities", () => {
    expect(protocol).toContain("Versin nooit hoeveelhede nie");
  });

  it("instructs the model to translate in-conversation via request_translation and submit_translation", () => {
    expect(protocol).toContain("request_translation");
    expect(protocol).toContain("submit_translation");
  });
});
