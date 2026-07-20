import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  pageSchema,
  postSchema,
  siteSchema,
  termsFileSchema,
  translationSchema,
} from "../src/lib/content-schema.ts";

function zodIssues(name, error) {
  return error.issues.map((i) => `${name}: ${i.path.join(".") || "(root)"} — ${i.message}`);
}

export async function validateContent(root) {
  const issues = [];
  const readJson = async (...parts) =>
    JSON.parse(await readFile(join(root, ...parts), "utf8"));
  const listJson = async (...parts) =>
    (await readdir(join(root, ...parts))).filter((f) => f.endsWith(".json"));

  const site = siteSchema.safeParse(await readJson("site.json"));
  if (!site.success) issues.push(...zodIssues("site.json", site.error));

  const terms = termsFileSchema.safeParse(await readJson("terms.json"));
  if (!terms.success) issues.push(...zodIssues("terms.json", terms.error));
  const termIds = new Set(
    terms.success
      ? [...terms.data.categories, ...terms.data.tags].map((t) => t.id)
      : [],
  );

  const posts = new Map();
  for (const file of await listJson("posts")) {
    const result = postSchema.safeParse(await readJson("posts", file));
    if (!result.success) {
      issues.push(...zodIssues(`posts/${file}`, result.error));
      continue;
    }
    posts.set(result.data.slug, result.data);
    if (`${result.data.slug}.json` !== file) {
      issues.push(`posts/${file}: slug "${result.data.slug}" does not match filename`);
    }
    if (terms.success) {
      for (const id of [...result.data.categories, ...result.data.tags]) {
        if (!termIds.has(id)) issues.push(`posts/${file}: unknown term id ${id}`);
      }
    }
  }

  const pages = new Map();
  for (const file of await listJson("pages")) {
    const result = pageSchema.safeParse(await readJson("pages", file));
    if (!result.success) {
      issues.push(...zodIssues(`pages/${file}`, result.error));
      continue;
    }
    pages.set(result.data.slug, result.data);
    if (`${result.data.slug}.json` !== file) {
      issues.push(`pages/${file}: slug "${result.data.slug}" does not match filename`);
    }
    if (posts.has(result.data.slug)) {
      issues.push(`pages/${file}: slug collides with a post (posts win in the router)`);
    }
  }

  for (const [type, sources] of [
    ["posts", posts],
    ["pages", pages],
  ]) {
    for (const file of await listJson("translations", "en", type)) {
      const name = `translations/en/${type}/${file}`;
      const result = translationSchema.safeParse(
        await readJson("translations", "en", type, file),
      );
      if (!result.success) {
        issues.push(...zodIssues(name, result.error));
        continue;
      }
      if (`${result.data.slug}.json` !== file) {
        issues.push(`${name}: slug "${result.data.slug}" does not match filename`);
      }
      const source = sources.get(result.data.slug);
      if (!source) {
        issues.push(`${name}: no ${type} source with slug "${result.data.slug}"`);
      } else if (source.id !== result.data.id) {
        issues.push(`${name}: id ${result.data.id} does not match source id ${source.id}`);
      }
    }
  }

  return issues;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const issues = await validateContent(new URL("../content", import.meta.url).pathname);
  if (issues.length) {
    console.error(`Content validation FAILED (${issues.length} issues):`);
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log("Content validation OK");
}
