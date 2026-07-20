import { readFile } from "node:fs/promises";
import { parse } from "node-html-parser";
import { sourceHashOf } from "../src/lib/source-hash.ts";

function tagSignature(html) {
  const root = parse(html ?? "");
  const sig = [];
  function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        const src = child.getAttribute?.("src") ?? "";
        const href = child.getAttribute?.("href") ?? "";
        sig.push(`${child.rawTagName}|${src}|${href}`);
        walk(child);
      }
    }
  }
  walk(root);
  return sig.join("\n");
}

export async function checkTranslation(ref) {
  const issues = [];

  function checkHtmlPair(name, af, en) {
    if ((af ?? null) === null && (en ?? null) === null) return;
    if ((af ?? null) === null || (en ?? null) === null) {
      issues.push(`${name}: present in one language only`);
      return;
    }
    if (tagSignature(af) !== tagSignature(en)) {
      issues.push(`${name}: HTML tag structure differs from source`);
    }
  }

  let af, en;
  try {
    af = JSON.parse(
      await readFile(new URL(`../content/${ref}.json`, import.meta.url), "utf8"),
    );
  } catch (e) {
    return { status: "fail", issues: [`cannot read source ${ref}: ${e.message}`] };
  }
  try {
    en = JSON.parse(
      await readFile(
        new URL(`../content/translations/en/${ref}.json`, import.meta.url),
        "utf8",
      ),
    );
  } catch {
    return { status: "missing", issues: [] };
  }

  if (en.id !== af.id) issues.push(`id mismatch: ${en.id} != ${af.id}`);
  if (en.slug !== af.slug) issues.push(`slug mismatch`);
  if (!en.title?.trim()) issues.push("empty title");
  if (typeof af.excerpt === "string" && !en.excerpt?.trim()) issues.push("empty excerpt");
  if (!en.seo?.title?.trim()) issues.push("empty seo.title");
  const hash = sourceHashOf(af);
  if (en.sourceHash !== hash) issues.push(`sourceHash mismatch: expected ${hash}`);
  checkHtmlPair("html", af.html, en.html);

  if (af.recipe) {
    const a = af.recipe;
    const e = en.recipe;
    if (!e) {
      issues.push("recipe missing in translation");
    } else {
      if (!e.title?.trim()) issues.push("recipe: empty title");
      checkHtmlPair("recipe.summaryHtml", a.summaryHtml, e.summaryHtml);
      checkHtmlPair("recipe.videoHtml", a.videoHtml, e.videoHtml);
      if (JSON.stringify(a.details) !== JSON.stringify(e.details)) {
        issues.push("recipe.details must be copied unchanged");
      }
      if (JSON.stringify(a.image) !== JSON.stringify(e.image)) {
        issues.push("recipe.image must be copied unchanged");
      }
      const counts = (r) => [
        r.ingredientGroups?.length,
        ...(r.ingredientGroups ?? []).map((g) => g.items.length),
        r.directionGroups?.length,
        ...(r.directionGroups ?? []).map((g) => g.steps.length),
        r.notes?.length,
      ].join(",");
      if (counts(a) !== counts(e)) {
        issues.push(`recipe structure counts differ: af=${counts(a)} en=${counts(e)}`);
      }
      for (const [gi, g] of (e.ingredientGroups ?? []).entries()) {
        for (const [ii, item] of g.items.entries()) {
          checkHtmlPair(`ingredient[${gi}][${ii}]`, a.ingredientGroups[gi]?.items[ii], item);
        }
      }
      for (const [gi, g] of (e.directionGroups ?? []).entries()) {
        for (const [si, step] of g.steps.entries()) {
          checkHtmlPair(`step[${gi}][${si}]`, a.directionGroups[gi]?.steps[si], step);
        }
      }
    }
  } else if (en.recipe) {
    issues.push("translation has recipe but source does not");
  }

  return { status: issues.length ? "fail" : "ok", issues };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const ref = process.argv[2];
  if (!ref) {
    console.error("usage: tsx scripts/check-translation.mjs posts/<slug>|pages/<slug>");
    process.exit(2);
  }
  const { status, issues } = await checkTranslation(ref);
  if (status === "ok") {
    console.log(`OK ${ref}`);
  } else if (status === "missing") {
    console.error(`cannot read translation for ${ref}`);
    process.exit(1);
  } else {
    console.error(`FAIL ${ref}:`);
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }
}
