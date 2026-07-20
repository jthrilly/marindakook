import { readFile } from "node:fs/promises";
import { sourceHashOf } from "../src/lib/source-hash.ts";
import { compareTranslation } from "../src/lib/translation-check.mjs";

export async function checkTranslation(ref) {
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

  const issues = compareTranslation(af, en);
  const hash = sourceHashOf(af);
  if (en.sourceHash !== hash) issues.push(`sourceHash mismatch: expected ${hash}`);

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
