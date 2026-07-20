import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseModelJson, scoreCandidate } from "../scripts/translation-regression.mjs";

describe("translation regression harness (offline)", () => {
  it("parseModelJson tolerates code fences and leading prose", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Here is the JSON:\n{"a":1}')).toEqual({ a: 1 });
    expect(() => parseModelJson("no json here")).toThrow();
  });

  it("scoreCandidate passes the committed translation and fails a mutation", async () => {
    const CONTENT = join(process.cwd(), "content");
    const af = JSON.parse(
      await readFile(join(CONTENT, "posts", "lemoen-stroopkoek.json"), "utf8"),
    );
    const en = JSON.parse(
      await readFile(
        join(CONTENT, "translations", "en", "posts", "lemoen-stroopkoek.json"),
        "utf8",
      ),
    );
    expect(scoreCandidate(af, en).pass).toBe(true);
    const bad = structuredClone(en);
    bad.recipe.ingredientGroups[0].items.pop();
    const scored = scoreCandidate(af, bad);
    expect(scored.pass).toBe(false);
    expect(scored.issues.length).toBeGreaterThan(0);
  });
});
