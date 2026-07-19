import { mkdir, readFile, writeFile } from "node:fs/promises";

const CONTENT = new URL("../content/", import.meta.url);
const PUBLIC = new URL("../public/", import.meta.url);

const index = JSON.parse(await readFile(new URL("posts-index.json", CONTENT), "utf8"));
const terms = JSON.parse(await readFile(new URL("terms.json", CONTENT), "utf8"));
const enCategoryNames = JSON.parse(
  await readFile(new URL("../src/lib/en-category-names.json", import.meta.url), "utf8"),
);
const catNames = {
  af: new Map(terms.categories.map((c) => [c.id, c.name])),
  en: new Map(terms.categories.map((c) => [c.id, enCategoryNames[c.slug] ?? c.name])),
};
const tagById = new Map(terms.tags.map((t) => [t.id, t.name]));

async function translation(slug) {
  try {
    return JSON.parse(
      await readFile(new URL(`translations/en/posts/${slug}.json`, CONTENT), "utf8"),
    );
  } catch {
    return null;
  }
}

async function entry(post, locale) {
  let { title, excerpt } = post;
  if (locale === "en") {
    const t = await translation(post.slug);
    if (t) {
      title = t.title;
      excerpt = t.excerpt ?? excerpt;
    }
  }
  return {
    slug: post.slug,
    title,
    excerpt,
    cats: post.categories.map((id) => catNames[locale].get(id)).filter(Boolean),
    tags: post.tags.map((id) => tagById.get(id)).filter(Boolean),
    thumb: post.featured?.thumb?.src ?? null,
    date: post.date,
  };
}

await mkdir(PUBLIC, { recursive: true });
for (const locale of ["af", "en"]) {
  const entries = await Promise.all(index.map((p) => entry(p, locale)));
  await writeFile(new URL(`search-index.${locale}.json`, PUBLIC), JSON.stringify(entries));
  console.log(`search-index.${locale}.json: ${entries.length} entries`);
}
