import "server-only";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import type { Locale, Page, Post, PostSummary, Site, Term, Translation } from "./types";

const CONTENT_DIR = join(process.cwd(), "content");

async function readJson<T>(...parts: string[]): Promise<T> {
  return JSON.parse(await readFile(join(CONTENT_DIR, ...parts), "utf8")) as T;
}

export const getSite = cache(() => readJson<Site>("site.json"));

export const getTerms = cache(() =>
  readJson<{ categories: Term[]; tags: Term[] }>("terms.json"),
);

export const getPostIndex = cache(() => readJson<PostSummary[]>("posts-index.json"));

export const getPageSlugs = cache(async () => {
  const files = await readdir(join(CONTENT_DIR, "pages"));
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
});

const getTranslation = cache(async (type: "posts" | "pages", slug: string) => {
  try {
    return await readJson<Translation>("translations", "en", type, `${slug}.json`);
  } catch {
    return null;
  }
});

export const getPost = cache(async (slug: string, locale: Locale): Promise<Post> => {
  const post = await readJson<Post>("posts", `${slug}.json`);
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
  const page = await readJson<Page>("pages", `${slug}.json`);
  if (locale === "af") return page;
  const t = await getTranslation("pages", slug);
  if (!t) return page;
  return { ...page, title: t.title, seo: t.seo ?? page.seo, html: t.html };
});

export const getPostSummary = cache(async (slug: string, locale: Locale): Promise<PostSummary | null> => {
  const index = await getPostIndex();
  const summary = index.find((p) => p.slug === slug);
  if (!summary) return null;
  if (locale === "af") return summary;
  const t = await getTranslation("posts", slug);
  if (!t) return summary;
  return { ...summary, title: t.title, excerpt: t.excerpt ?? summary.excerpt };
});

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
