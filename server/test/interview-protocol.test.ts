/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
// Vite's `?raw` suffix inlines the file's text at transform time (on the
// host, via the pool's Vite plugin), so the string is a bundled literal by
// the time this module runs inside workerd — no runtime `node:fs` access
// (unavailable in the vitest-pool-workers sandbox) is needed. The
// `*?raw` module type comes from vite/client (referenced above).
import protocol from "../prompts/interview-af.md?raw";
import { draftRecipeSchema } from "../src/core/draft-schema";

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

  it("notes the internal categories are already excluded from the offered list", () => {
    expect(protocol).toContain("interne terme");
    expect(protocol).toContain("is reeds uitgelaat");
  });

  it("points the model at the category list begin_draft provides, not a separate tool", () => {
    // The categories are appended to begin_draft/resume_draft text as
    // "Beskikbare kategorieë" (drafts.ts categoriesBlock), so the model never has
    // to find list_categories — which claude.ai's tool-search can hide.
    expect(protocol).toContain("Beskikbare kategorieë");
  });

  it("documents the exact recipe structure so the model never guesses the keys", () => {
    expect(protocol).toContain("ingredientGroups");
    expect(protocol).toContain("directionGroups");
    expect(protocol).toContain("Die `recipe`-objek");
  });

  it("the documented recipe example is valid against draftRecipeSchema (docs cannot drift)", () => {
    // Pull the first ```json fence (the worked recipe example) straight from the
    // protocol and validate it, so the shape the model is told to copy is proven
    // schema-valid and can never silently diverge from draftRecipeSchema.
    const match = protocol.match(/```json\n([\s\S]*?)\n```/);
    expect(match).not.toBeNull();
    const example = JSON.parse(match![1]);
    const parsed = draftRecipeSchema.safeParse(example);
    expect(parsed.success).toBe(true);
  });

  it("instructs asking one question at a time", () => {
    expect(protocol).toContain("Een vraag op 'n slag");
  });

  it("forbids exposing technical detail (tool/field names, IDs, jargon) to Marinda", () => {
    expect(protocol).toContain("Praat mensetaal");
    expect(protocol).toContain("nooit tegniese detail");
    // The machine-facing data-shape section is flagged internal-only.
    expect(protocol).toContain("INTERN — moenie dit vir Marinda wys");
  });

  it("instructs never inventing quantities", () => {
    expect(protocol).toContain("Versin nooit hoeveelhede nie");
  });

  it("instructs the model to translate in-conversation via request_translation and submit_translation", () => {
    expect(protocol).toContain("request_translation");
    expect(protocol).toContain("submit_translation");
  });
});
