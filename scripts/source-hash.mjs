import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function sourceHash(ref) {
  const raw = JSON.parse(
    await readFile(new URL(`../content/${ref}.json`, import.meta.url), "utf8"),
  );
  const basis = JSON.stringify({
    title: raw.title,
    excerpt: raw.excerpt ?? null,
    html: raw.html,
    recipe: raw.recipe ?? null,
    seo: raw.seo,
  });
  return createHash("sha1").update(basis).digest("hex");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log(await sourceHash(process.argv[2]));
}
