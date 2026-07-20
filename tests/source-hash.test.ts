import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageSchema, postSchema, siteSchema } from "@/lib/content-schema";
import { siteChromeHashOf, sourceHashOf, type TranslationSource } from "@/lib/source-hash";

const CONTENT = join(process.cwd(), "content");

// Disk JSON for posts/pages/translations always carries the source fields
// `sourceHashOf` reads, plus extras (id, slug, sourceHash, …) reached through
// the index signature — so the intersection needs no assertion at call sites.
async function readJson(...parts: string[]): Promise<Record<string, unknown> & TranslationSource> {
  return JSON.parse(await readFile(join(CONTENT, ...parts), "utf8"));
}

describe("sourceHashOf", () => {
  it("reproduces the stored hash of every committed translation", async () => {
    for (const type of ["posts", "pages"] as const) {
      const dir = join(CONTENT, "translations", "en", type);
      for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
        const translation = await readJson("translations", "en", type, file);
        const source = await readJson(type, file);
        expect(sourceHashOf(source), `${type}/${file}`).toBe(translation.sourceHash);
      }
    }
  });

  it("is transparent to zod normalization of posts", async () => {
    // The Worker will hash zod-parsed objects; committed hashes were computed
    // over raw disk JSON. Schema key order must therefore match disk order.
    for (const file of (await readdir(join(CONTENT, "posts"))).filter((f) =>
      f.endsWith(".json"),
    )) {
      const raw = await readJson("posts", file);
      const parsed = postSchema.parse(raw);
      expect(sourceHashOf(parsed), file).toBe(sourceHashOf(raw));
    }
  });

  it("is transparent to zod normalization of pages", async () => {
    for (const file of (await readdir(join(CONTENT, "pages"))).filter((f) =>
      f.endsWith(".json"),
    )) {
      const raw = await readJson("pages", file);
      const parsed = pageSchema.parse(raw);
      expect(sourceHashOf(parsed), file).toBe(sourceHashOf(raw));
    }
  });
});

describe("siteChromeHashOf", () => {
  it("matches the seeded site translation's stored hash", async () => {
    const site = siteSchema.parse(await readJson("site.json"));
    const translation = await readJson("translations", "en", "site.json");
    expect(siteChromeHashOf(site)).toBe(translation.sourceHash);
  });
});
