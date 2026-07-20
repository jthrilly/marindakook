import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postSchema, termsFileSchema, type Post } from "@/lib/content-schema";
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
  it("deep-equals the committed posts-index.json", async () => {
    const committed = JSON.parse(
      await readFile(join(CONTENT, "posts-index.json"), "utf8"),
    );
    const derived = JSON.parse(JSON.stringify(derivePostIndex(await allPosts())));
    expect(derived).toEqual(committed);
  });

  it("reproduces the committed WordPress term counts", async () => {
    const counts = deriveTermCounts(derivePostIndex(await allPosts()));
    const terms = termsFileSchema.parse(
      JSON.parse(await readFile(join(CONTENT, "terms.json"), "utf8")),
    );
    for (const term of [...terms.categories, ...terms.tags]) {
      expect(counts.get(term.id) ?? 0, `${term.slug}`).toBe(term.count);
    }
  });
});
