import { execFile } from "node:child_process";
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const BATCH = 100;

async function have(tool) {
  try {
    await run("which", [tool]);
    return true;
  } catch {
    return false;
  }
}

async function totalSize(paths) {
  let total = 0;
  for (const p of paths) total += (await stat(p)).size;
  return total;
}

let skipped = 0;

// A single unreadable/misnamed file (e.g. a PNG with a .jpg extension) makes
// the whole batch exit non-zero, so fall back to per-file on batch failure.
async function inBatches(files, fn) {
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    try {
      await fn(batch);
    } catch {
      for (const file of batch) {
        try {
          await fn([file]);
        } catch {
          skipped++;
          console.log(`  skip (not optimizable): ${file}`);
        }
      }
    }
    if (i > 0 && i % 1000 === 0) console.log(`  ${i}/${files.length}`);
  }
}

const jpegs = [];
const pngs = [];
for await (const path of glob("public/media/**/*.{jpg,jpeg,JPG,JPEG}")) jpegs.push(path);
for await (const path of glob("public/media/**/*.{png,PNG}")) pngs.push(path);
console.log(`${jpegs.length} JPEGs, ${pngs.length} PNGs`);

const before = (await totalSize(jpegs)) + (await totalSize(pngs));

if (await have("jpegoptim")) {
  console.log("jpegoptim: lossless optimization + strip, lossy cap at quality 76…");
  await inBatches(jpegs, async (batch) => {
    // -m76 only re-encodes files whose estimated quality exceeds 76, so files
    // already compressed harder are left untouched (no generational loss).
    await run("jpegoptim", ["--strip-all", "-m76", "-T3", "-q", ...batch]);
  });
} else {
  console.log("jpegoptim not found — skipping JPEGs (brew install jpegoptim / apt-get install jpegoptim)");
}

if (pngs.length && (await have("oxipng"))) {
  console.log("oxipng: lossless PNG optimization…");
  await inBatches(pngs, async (batch) => {
    await run("oxipng", ["-o2", "--strip", "safe", "-q", ...batch]);
  });
} else if (pngs.length) {
  console.log("oxipng not found — skipping PNGs (brew install oxipng / apt-get install oxipng)");
}

const after = (await totalSize(jpegs)) + (await totalSize(pngs));
console.log(
  `CLI optimization done: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB (saved ${((before - after) / 1e6).toFixed(1)} MB, ${skipped} skipped)`,
);

// Sync the sharp optimizer's state to the new file sizes so the next
// optimize-media run doesn't re-encode files this pass just rewrote.
const stateUrl = new URL("../content/media-optimized.json", import.meta.url);
let state = {};
try {
  state = JSON.parse(await readFile(stateUrl, "utf8"));
} catch {}
for (const path of [...jpegs, ...pngs]) {
  state[path.replace(/^public\//, "")] = (await stat(path)).size;
}
const tmp = new URL(`${stateUrl.pathname}.tmp`, stateUrl);
await writeFile(tmp, JSON.stringify(state));
await rename(tmp, stateUrl);
console.log("optimizer state synced");
