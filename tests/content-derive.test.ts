import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postSchema, type Post } from "@/lib/content-schema";
import { derivePostIndex, deriveTermCounts } from "@/lib/content-derive";

const CONTENT = join(process.cwd(), "content");

async function allPosts(): Promise<Post[]> {
  const dir = join(CONTENT, "posts");
  return Promise.all(
    (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .map(async (f) =>
        postSchema.parse(JSON.parse(await readFile(join(dir, f), "utf8"))),
      ),
  );
}

describe("derived post index", () => {
  it("is date-descending with ascending-id tiebreak and unique slugs", async () => {
    const index = derivePostIndex(await allPosts());
    expect(index.length).toBe(397);
    for (let i = 1; i < index.length; i++) {
      const prev = index[i - 1];
      const cur = index[i];
      const ordered =
        prev.date > cur.date || (prev.date === cur.date && prev.id < cur.id);
      expect(ordered, `${prev.slug} -> ${cur.slug}`).toBe(true);
    }
    expect(new Set(index.map((p) => p.slug)).size).toBe(index.length);
  });

  it("counts every category and tag reference", async () => {
    const index = derivePostIndex(await allPosts());
    const counts = deriveTermCounts(index);
    const total = index.reduce((n, p) => n + p.categories.length + p.tags.length, 0);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(total);
  });
});
