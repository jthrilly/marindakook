import { mkdir, writeFile, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

const manifest = JSON.parse(
  await readFile(new URL("../content/media-manifest.json", import.meta.url), "utf8"),
);

const CONCURRENCY = 8;
const FORCE = process.env.FORCE_MEDIA_REFRESH === "1";
let done = 0;
let downloaded = 0;
let missing = 0;
let failed = 0;
let bytes = 0;

async function exists(path) {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function download({ url, path }) {
  if (!FORCE && (await exists(path))) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "marindakook-static-sync/1.0" } });
      if (res.status === 404 || res.status === 410) {
        missing++;
        console.log(`  gone at origin (${res.status}): ${url}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, buf);
      await rename(tmp, path);
      bytes += buf.length;
      downloaded++;
      return;
    } catch (err) {
      if (attempt === 2) {
        failed++;
        console.log(`  FAILED: ${url} (${err.message})`);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

const queue = [...manifest];
async function worker() {
  while (queue.length) {
    const item = queue.shift();
    await download(item);
    done++;
    if (done % 100 === 0) {
      console.log(`${done}/${manifest.length} (${(bytes / 1e6).toFixed(0)} MB new)`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(
  `Media sync done: ${manifest.length} total, ${downloaded} downloaded (${(bytes / 1e6).toFixed(1)} MB), ${missing} gone at origin, ${failed} failed.`,
);
// Origin 404s are recorded but tolerated (those images are broken on the live
// site too); anything else failing means the mirror is incomplete.
if (failed > 0) process.exitCode = 1;
