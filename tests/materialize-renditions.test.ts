import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { materializeRenditions } from "../scripts/materialize-renditions.mjs";

// A minimal, schema-shaped post: only the fields materializeRenditions reads
// (featured/recipe.image) matter for these tests; the rest are filler so a
// fixture reads like a real content/posts/*.json file.
function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "test-post",
    title: "Test post",
    date: "2026-07-01T00:00:00",
    modified: "2026-07-01T00:00:00",
    excerpt: "",
    categories: [],
    tags: [],
    featured: null,
    commentStatus: "closed",
    seo: { title: "Test post", description: null },
    html: "<p>hi</p>",
    recipe: null,
    comments: [],
    ...overrides,
  };
}

async function makeTempRoot() {
  const dir = await mkdtemp(join(tmpdir(), "materialize-renditions-"));
  await mkdir(join(dir, "content", "posts"), { recursive: true });
  await mkdir(join(dir, "public", "media", "uploads", "2026", "07"), { recursive: true });
  return dir;
}

async function writeOriginal(root: string, filename: string, width = 3000, height = 2000) {
  const path = join(root, "public", "media", "uploads", "2026", "07", filename);
  await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } },
  })
    .jpeg()
    .toFile(path);
  return path;
}

async function writePost(root: string, filename: string, post: unknown) {
  await writeFile(join(root, "content", "posts", filename), JSON.stringify(post, null, 1));
}

describe("materializeRenditions", () => {
  it("creates card/portrait/thumb renditions at the correct dimensions from the hero original", async () => {
    const root = await makeTempRoot();
    await writeOriginal(root, "foo.jpg");
    await writePost(
      root,
      "test-post.json",
      makePost({
        featured: {
          alt: "Foo",
          card: { src: "/media/uploads/2026/07/foo-760x760.jpg", width: 760, height: 760 },
          portrait: { src: "/media/uploads/2026/07/foo-760x990.jpg", width: 760, height: 990 },
          thumb: { src: "/media/uploads/2026/07/foo-150x150.jpg", width: 150, height: 150 },
        },
      }),
    );

    const result = await materializeRenditions(root);
    expect(result.created.sort()).toEqual(
      [
        "public/media/uploads/2026/07/foo-760x760.jpg",
        "public/media/uploads/2026/07/foo-760x990.jpg",
        "public/media/uploads/2026/07/foo-150x150.jpg",
      ].sort(),
    );

    const card = await sharp(join(root, "public/media/uploads/2026/07/foo-760x760.jpg")).metadata();
    expect(card.width).toBe(760);
    expect(card.height).toBe(760);

    const portrait = await sharp(join(root, "public/media/uploads/2026/07/foo-760x990.jpg")).metadata();
    expect(portrait.width).toBe(760);
    expect(portrait.height).toBe(990);

    const thumb = await sharp(join(root, "public/media/uploads/2026/07/foo-150x150.jpg")).metadata();
    expect(thumb.width).toBe(150);
    expect(thumb.height).toBe(150);
  });

  it("also materializes recipe.image when it references a sized file needing generation", async () => {
    const root = await makeTempRoot();
    await writeOriginal(root, "bar.jpg");
    await writePost(
      root,
      "test-post.json",
      makePost({
        recipe: {
          style: "default",
          title: "Test recipe",
          author: null,
          image: {
            src: "/media/uploads/2026/07/bar-400x300.jpg",
            srcset: null,
            width: 400,
            height: 300,
            alt: "Bar",
          },
          courses: [],
          cuisines: [],
          difficulties: [],
          summaryHtml: null,
          details: [],
          ingredientsTitle: null,
          ingredientGroups: [],
          directionsTitle: null,
          directionGroups: [],
          notesTitle: null,
          notes: [],
          videoHtml: null,
        },
      }),
    );

    const result = await materializeRenditions(root);
    expect(result.created).toEqual(["public/media/uploads/2026/07/bar-400x300.jpg"]);

    const meta = await sharp(join(root, "public/media/uploads/2026/07/bar-400x300.jpg")).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it("is idempotent: an already-present rendition is left byte-for-byte untouched", async () => {
    const root = await makeTempRoot();
    await writeOriginal(root, "foo.jpg");
    const thumbPath = join(root, "public/media/uploads/2026/07/foo-150x150.jpg");
    // Deliberately not a valid rendition of foo.jpg — proves the file is
    // skipped by existence check alone, never re-derived from the original.
    const sentinel = Buffer.from("not-a-real-image-just-a-sentinel");
    await writeFile(thumbPath, sentinel);
    const before = await stat(thumbPath);

    await writePost(
      root,
      "test-post.json",
      makePost({
        featured: {
          alt: "Foo",
          card: null,
          portrait: null,
          thumb: { src: "/media/uploads/2026/07/foo-150x150.jpg", width: 150, height: 150 },
        },
      }),
    );

    const result = await materializeRenditions(root);
    expect(result.created).toEqual([]);

    const after = await stat(thumbPath);
    const bytes = await readFile(thumbPath);
    expect(bytes.equals(sentinel)).toBe(true);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("skips a post with no featured image and no recipe image, without crashing", async () => {
    const root = await makeTempRoot();
    await writePost(root, "test-post.json", makePost());

    const result = await materializeRenditions(root);
    expect(result.created).toEqual([]);
  });

  it("skips a rendition whose original is absent, without crashing or leaving a partial file", async () => {
    const root = await makeTempRoot();
    // No "missing.jpg" original written on disk.
    await writePost(
      root,
      "test-post.json",
      makePost({
        featured: {
          alt: "Missing",
          card: { src: "/media/uploads/2026/07/missing-760x760.jpg", width: 760, height: 760 },
          portrait: null,
          thumb: null,
        },
      }),
    );

    const result = await materializeRenditions(root);
    expect(result.created).toEqual([]);
    await expect(stat(join(root, "public/media/uploads/2026/07/missing-760x760.jpg"))).rejects.toThrow();
  });

  it("scans multiple committed posts under content/posts", async () => {
    const root = await makeTempRoot();
    await writeOriginal(root, "foo.jpg");
    await writeOriginal(root, "baz.jpg");
    await writePost(
      root,
      "post-a.json",
      makePost({
        slug: "post-a",
        featured: {
          alt: "Foo",
          card: { src: "/media/uploads/2026/07/foo-760x760.jpg", width: 760, height: 760 },
          portrait: null,
          thumb: null,
        },
      }),
    );
    await writePost(
      root,
      "post-b.json",
      makePost({
        slug: "post-b",
        featured: {
          alt: "Baz",
          card: null,
          portrait: null,
          thumb: { src: "/media/uploads/2026/07/baz-150x150.jpg", width: 150, height: 150 },
        },
      }),
    );

    const result = await materializeRenditions(root);
    expect(result.created.sort()).toEqual(
      [
        "public/media/uploads/2026/07/foo-760x760.jpg",
        "public/media/uploads/2026/07/baz-150x150.jpg",
      ].sort(),
    );
  });
});

describe("deploy.yml commit-back", () => {
  it("carries [skip ci] in the rendition commit-back message", async () => {
    const workflow = await readFile(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    expect(workflow).toMatch(/materialize-renditions\.mjs/);
    expect(workflow).toMatch(/\[skip ci\]/);
  });
});
