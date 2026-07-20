import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTranslatePrompt } from "@/lib/translate-prompt";

describe("buildTranslatePrompt", () => {
  it("substitutes both placeholders and leaves none behind", async () => {
    const template = await readFile(
      join(process.cwd(), "server", "prompts", "translate-en.md"),
      "utf8",
    );
    const prompt = buildTranslatePrompt({
      template,
      styleGuide: "STYLE_MARKER",
      sourceJson: '{"slug":"SOURCE_MARKER"}',
    });
    expect(prompt).toContain("STYLE_MARKER");
    expect(prompt).toContain("SOURCE_MARKER");
    expect(prompt).not.toContain("{{STYLE_GUIDE}}");
    expect(prompt).not.toContain("{{SOURCE_JSON}}");
  });

  it("the committed template states the full output contract", async () => {
    const template = await readFile(
      join(process.cwd(), "server", "prompts", "translate-en.md"),
      "utf8",
    );
    for (const marker of [
      "{{STYLE_GUIDE}}",
      "{{SOURCE_JSON}}",
      "sourceHash",
      "details",
      "tag structure",
      "copied unchanged",
    ]) {
      expect(template).toContain(marker);
    }
  });
});
