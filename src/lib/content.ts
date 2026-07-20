import "server-only";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import {
  pageSchema,
  postSchema,
  siteSchema,
  siteTranslationSchema,
  termsFileSchema,
  translationSchema,
  type Locale,
  type Page,
  type Post,
  type Site,
  type SiteStrings,
  type Term,
  type Translation,
} from "./content-schema";
import { derivePostIndex, deriveTermCounts, type PostSummary } from "./content-derive";
import { siteChromeHashOf } from "./source-hash";

const CONTENT_DIR = join(process.cwd(), "content");

async function readJson(...parts: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(CONTENT_DIR, ...parts), "utf8"));
}

export const getSite = cache(async (): Promise<Site> => siteSchema.parse(await readJson("site.json")));

export const getSiteStrings = cache(async (locale: Locale): Promise<SiteStrings | null> => {
  if (locale === "af") return null;
  let raw: unknown;
  try {
    raw = await readJson("translations", "en", "site.json");
  } catch {
    return null;
  }
  const { sourceHash, ...strings } = siteTranslationSchema.parse(raw);
  // Stale chrome translation falls back to Afrikaans, same policy as posts.
  if (sourceHash !== siteChromeHashOf(await getSite())) return null;
  return strings;
});

const getAllPosts = cache(async (): Promise<Post[]> => {
  const files = await readdir(join(CONTENT_DIR, "posts"));
  return Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => postSchema.parse(await readJson("posts", f))),
  );
});

export const getPostIndex = cache(async (): Promise<PostSummary[]> =>
  derivePostIndex(await getAllPosts()),
);

export const getTerms = cache(
  async (): Promise<{ categories: Term[]; tags: Term[] }> => {
    const terms = termsFileSchema.parse(await readJson("terms.json"));
    const counts = deriveTermCounts(await getPostIndex());
    // Parameter is the file-parse shape: Term includes the derived count,
    // which the file no longer carries.
    const withDerivedCounts = (list: typeof terms.categories): Term[] =>
      list.map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }));
    return {
      categories: withDerivedCounts(terms.categories),
      tags: withDerivedCounts(terms.tags),
    };
  },
);

export const getPageSlugs = cache(async () => {
  const files = await readdir(join(CONTENT_DIR, "pages"));
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
});

const getTranslation = cache(
  async (type: "posts" | "pages", slug: string): Promise<Translation | null> => {
    let raw: unknown;
    try {
      raw = await readJson("translations", "en", type, `${slug}.json`);
    } catch {
      return null;
    }
    // Parse OUTSIDE the try: a malformed translation must fail the build
    // loudly, not silently fall back to Afrikaans.
    return translationSchema.parse(raw);
  },
);

export const getPost = cache(async (slug: string, locale: Locale): Promise<Post> => {
  const post = postSchema.parse(await readJson("posts", `${slug}.json`));
  if (locale === "af") return post;
  const t = await getTranslation("posts", slug);
  if (!t) return post;
  return {
    ...post,
    title: t.title,
    excerpt: t.excerpt ?? post.excerpt,
    seo: t.seo ?? post.seo,
    html: t.html,
    recipe: t.recipe ?? post.recipe,
  };
});

export const getPage = cache(async (slug: string, locale: Locale): Promise<Page> => {
  const page = pageSchema.parse(await readJson("pages", `${slug}.json`));
  if (locale === "af") return page;
  const t = await getTranslation("pages", slug);
  if (!t) return page;
  return { ...page, title: t.title, seo: t.seo ?? page.seo, html: t.html };
});

export const getPostSummary = cache(
  async (slug: string, locale: Locale): Promise<PostSummary | null> => {
    const index = await getPostIndex();
    const summary = index.find((p) => p.slug === slug);
    if (!summary) return null;
    if (locale === "af") return summary;
    const t = await getTranslation("posts", slug);
    if (!t) return summary;
    return { ...summary, title: t.title, excerpt: t.excerpt ?? summary.excerpt };
  },
);

export async function localizeSummaries(posts: PostSummary[], locale: Locale) {
  if (locale === "af") return posts;
  return Promise.all(posts.map(async (p) => (await getPostSummary(p.slug, locale)) ?? p));
}

export function paginate<T>(items: T[], page: number, perPage: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  return {
    items: items.slice((page - 1) * perPage, page * perPage),
    page,
    totalPages,
  };
}
