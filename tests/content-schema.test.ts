import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  pageSchema,
  postSchema,
  siteSchema,
  siteTranslationSchema,
  termsFileSchema,
  translationSchema,
} from "@/lib/content-schema";

const CONTENT = join(process.cwd(), "content");

async function readJson(...parts: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(CONTENT, ...parts), "utf8"));
}

async function listJson(dir: string): Promise<string[]> {
  return (await readdir(join(CONTENT, dir))).filter((f) => f.endsWith(".json"));
}

describe("post contract", () => {
  it("parses all committed posts", async () => {
    const files = await listJson("posts");
    expect(files.length).toBe(397);
    for (const file of files) {
      const raw = await readJson("posts", file);
      const result = postSchema.safeParse(raw);
      expect(result.success, `${file}: ${result.error?.message}`).toBe(true);
    }
  });
});

describe("page contract", () => {
  it("parses both committed pages", async () => {
    const files = await listJson("pages");
    expect(files.length).toBe(2);
    for (const file of files) {
      const result = pageSchema.safeParse(await readJson("pages", file));
      expect(result.success, `${file}: ${result.error?.message}`).toBe(true);
    }
  });
});

describe("translation contract", () => {
  it("parses all committed translations and cross-checks id/slug", async () => {
    let total = 0;
    for (const type of ["posts", "pages"] as const) {
      for (const file of await listJson(join("translations", "en", type))) {
        total++;
        const raw = await readJson("translations", "en", type, file);
        const result = translationSchema.safeParse(raw);
        expect(result.success, `${type}/${file}: ${result.error?.message}`).toBe(true);
        if (!result.success) continue;
        const source =
          type === "posts"
            ? postSchema.parse(await readJson("posts", file))
            : pageSchema.parse(await readJson("pages", file));
        expect(result.data.id, `${type}/${file} id`).toBe(source.id);
        expect(result.data.slug, `${type}/${file} slug`).toBe(source.slug);
      }
    }
    expect(total).toBe(399);
  });
});

describe("site + terms contract", () => {
  it("parses site.json", async () => {
    const result = siteSchema.safeParse(await readJson("site.json"));
    expect(result.success, result.error?.message).toBe(true);
  });

  it("parses terms.json", async () => {
    const result = termsFileSchema.safeParse(await readJson("terms.json"));
    expect(result.success, result.error?.message).toBe(true);
    if (result.success) {
      expect(result.data.categories.length).toBe(32);
      expect(result.data.tags.length).toBe(334);
    }
  });
});

describe("site translation contract", () => {
  it("parses content/translations/en/site.json", async () => {
    const result = siteTranslationSchema.safeParse(
      await readJson("translations", "en", "site.json"),
    );
    expect(result.success, result.error?.message).toBe(true);
  });
});
