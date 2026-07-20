import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateContent } from "../scripts/validate-content.mjs";

describe("validateContent", () => {
  it("passes on the real repo content", async () => {
    const issues = await validateContent(join(process.cwd(), "content"));
    expect(issues).toEqual([]);
  });

  it("reports a corrupted post", async () => {
    const dir = await mkdtemp(join(tmpdir(), "content-"));
    await cp(join(process.cwd(), "content"), dir, { recursive: true });
    const victim = join(dir, "posts", "lemoen-stroopkoek.json");
    const post = JSON.parse(await readFile(victim, "utf8"));
    delete post.title;
    post.bogus = true;
    await writeFile(victim, JSON.stringify(post, null, 1));
    const issues = await validateContent(dir);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).toContain("lemoen-stroopkoek");
  });
});
