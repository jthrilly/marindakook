import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

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
  const res = spawnSync("node", ["scripts/check-translation.mjs", ref], { encoding: "utf8" });
  if (res.status !== 0) {
    const out = (res.stderr || res.stdout).trim();
    if (out.includes("cannot read translation")) {
      missing++;
      console.log(`MISSING ${ref}`);
    } else {
      failed++;
      console.log(out);
    }
  }
}
console.log(`\n${refs.length} items: ${refs.length - missing - failed} ok, ${missing} missing, ${failed} failed`);
if (missing + failed > 0) process.exitCode = 1;
