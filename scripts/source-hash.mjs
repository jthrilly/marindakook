import { readFile } from "node:fs/promises";
import { sourceHashOf } from "../src/lib/source-hash.ts";

export async function sourceHash(ref) {
  const raw = JSON.parse(
    await readFile(new URL(`../content/${ref}.json`, import.meta.url), "utf8"),
  );
  return sourceHashOf(raw);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log(await sourceHash(process.argv[2]));
}
