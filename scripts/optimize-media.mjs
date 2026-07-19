import { readFile, writeFile, stat, rename } from "node:fs/promises";
import { glob } from "node:fs/promises";
import sharp from "sharp";

const STATE_URL = new URL("../content/media-optimized.json", import.meta.url);
const MAX_WIDTH = 1600;
const MIN_BYTES = 120_000;

let state = {};
try {
  state = JSON.parse(await readFile(STATE_URL, "utf8"));
} catch {}

let processed = 0;
let saved = 0;
let skipped = 0;

for await (const path of glob("public/media/**/*.{jpg,jpeg,JPG,JPEG,png,PNG}")) {
  const s = await stat(path);
  const key = path.replace(/^public\//, "");
  if (state[key] === s.size) {
    skipped++;
    continue;
  }
  if (s.size < MIN_BYTES) {
    state[key] = s.size;
    skipped++;
    continue;
  }
  try {
    const isPng = /png$/i.test(path);
    let pipeline = sharp(path, { failOn: "none" }).rotate();
    const meta = await pipeline.metadata();
    if ((meta.width ?? 0) > MAX_WIDTH) {
      pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
    }
    const buf = isPng
      ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
      : await pipeline.jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    if (buf.length < s.size * 0.92) {
      const tmp = `${path}.tmp`;
      await writeFile(tmp, buf);
      await rename(tmp, path);
      saved += s.size - buf.length;
      state[key] = buf.length;
    } else {
      state[key] = s.size;
    }
    processed++;
    if (processed % 250 === 0) {
      console.log(`${processed} processed, ${(saved / 1e6).toFixed(0)} MB saved`);
      await writeFile(STATE_URL, JSON.stringify(state));
    }
  } catch (err) {
    console.log(`  skip ${path}: ${err.message}`);
  }
}

await writeFile(STATE_URL, JSON.stringify(state));
console.log(`Optimized ${processed} images (${skipped} already done), saved ${(saved / 1e6).toFixed(1)} MB total.`);
