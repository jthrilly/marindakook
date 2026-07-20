import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareTranslation } from "../src/lib/translation-check.mjs";

const CONTENT = join(process.cwd(), "content");

async function pair(slug: string) {
  const af = JSON.parse(await readFile(join(CONTENT, "posts", `${slug}.json`), "utf8"));
  const en = JSON.parse(
    await readFile(join(CONTENT, "translations", "en", "posts", `${slug}.json`), "utf8"),
  );
  return { af, en };
}

describe("compareTranslation", () => {
  it("accepts a known-good pair", async () => {
    const { af, en } = await pair("lemoen-stroopkoek");
    expect(compareTranslation(af, en)).toEqual([]);
  });

  it("flags structural mutations", async () => {
    const { af, en } = await pair("lemoen-stroopkoek");
    const dropStep = structuredClone(en);
    dropStep.recipe.directionGroups[0].steps.pop();
    expect(compareTranslation(af, dropStep).join("\n")).toContain("structure counts differ");

    const wrongId = structuredClone(en);
    wrongId.id = 1;
    expect(compareTranslation(af, wrongId).join("\n")).toContain("id mismatch");

    const brokenHtml = structuredClone(en);
    brokenHtml.html = brokenHtml.html.replace(
      '<p class="wp-block-paragraph">',
      '<div class="wp-block-paragraph">',
    );
    expect(compareTranslation(af, brokenHtml).join("\n")).toContain("tag structure differs");

    const changedDetails = structuredClone(en);
    changedDetails.recipe.details[0].label = "changed";
    expect(compareTranslation(af, changedDetails).join("\n")).toContain(
      "details must be copied unchanged",
    );
  });

  it("does not check sourceHash (storage concern, not structural)", async () => {
    const { af, en } = await pair("lemoen-stroopkoek");
    const noHash = structuredClone(en);
    delete noHash.sourceHash;
    expect(compareTranslation(af, noHash)).toEqual([]);
  });
});
