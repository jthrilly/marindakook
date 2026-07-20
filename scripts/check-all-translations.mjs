import { readdir } from "node:fs/promises";
import { checkTranslation } from "./check-translation.mjs";

const refs = [];
for (const [type, dir] of [
  ["posts", new URL("../content/posts/", import.meta.url)],
  ["pages", new URL("../content/pages/", import.meta.url)],
]) {
  for (const f of await readdir(dir)) {
    if (f.endsWith(".json")) refs.push(`${type}/${f.replace(/\.json$/, "")}`);
  }
}

let missing = 0;
let failed = 0;
for (const ref of refs) {
  const { status, issues } = await checkTranslation(ref);
  if (status === "missing") {
    missing++;
    console.log(`MISSING ${ref}`);
  } else if (status === "fail") {
    failed++;
    console.log(`FAIL ${ref}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
  }
}
console.log(
  `\n${refs.length} items: ${refs.length - missing - failed} ok, ${missing} missing, ${failed} failed`,
);
if (missing + failed > 0) process.exitCode = 1;
