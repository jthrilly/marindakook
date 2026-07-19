import { mkdir, writeFile, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

const manifest = JSON.parse(
  await readFile(new URL("../content/media-manifest.json", import.meta.url), "utf8"),
);

const CONCURRENCY = Number(process.env.MEDIA_CONCURRENCY) || 8;
const REQUEST_TIMEOUT_MS = 90_000;
const FORCE = process.env.FORCE_MEDIA_REFRESH === "1";
const MAX_ROUNDS = 4;
const BREAKER_THRESHOLD = 8;
const COOLDOWN_MS = 90_000;

let done = 0;
let downloaded = 0;
let missing = 0;
let failed = 0;
let bytes = 0;
let cooldowns = 0;

// Shared-host origins tend to rate-limit sustained request streams; when many
// requests fail back to back, pause every worker instead of burning retries.
let consecutiveFailures = 0;
let pauseUntil = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tripBreakerMaybe() {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_THRESHOLD && Date.now() >= pauseUntil) {
    pauseUntil = Date.now() + COOLDOWN_MS;
    cooldowns++;
    consecutiveFailures = 0;
    console.log(`origin appears to be throttling; cooling down ${COOLDOWN_MS / 1000}s (queue ${queue.length} left)`);
  }
}

async function exists(path) {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function download({ url, path }) {
  if (!FORCE && (await exists(path))) return "ok";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() < pauseUntil) await sleep(pauseUntil - Date.now());
    try {
      await sleep(50 + Math.random() * 150);
      const res = await fetch(url, {
        headers: { "User-Agent": "marindakook-static-sync/1.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 404 || res.status === 410) {
        console.log(`  gone at origin (${res.status}): ${url}`);
        return "gone";
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, buf);
      await rename(tmp, path);
      bytes += buf.length;
      downloaded++;
      consecutiveFailures = 0;
      return "ok";
    } catch (err) {
      tripBreakerMaybe();
      if (attempt === 1) return { retry: err.message };
      await sleep(3000);
    }
  }
  return { retry: "unreachable" };
}

const queue = manifest.map((item) => ({ ...item, rounds: 0 }));
async function worker() {
  while (queue.length) {
    if (Date.now() < pauseUntil) await sleep(pauseUntil - Date.now());
    const item = queue.shift();
    if (!item) break;
    const result = await download(item);
    if (typeof result === "object") {
      if (item.rounds + 1 >= MAX_ROUNDS) {
        failed++;
        done++;
        console.log(`  FAILED after ${MAX_ROUNDS} rounds: ${item.url} (${result.retry})`);
      } else {
        queue.push({ ...item, rounds: item.rounds + 1 });
      }
      continue;
    }
    if (result === "gone") missing++;
    done++;
    if (done % 100 === 0) {
      console.log(`${done}/${manifest.length} (${(bytes / 1e6).toFixed(0)} MB new)`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(
  `Media sync done: ${manifest.length} total, ${downloaded} downloaded (${(bytes / 1e6).toFixed(1)} MB), ` +
    `${missing} gone at origin, ${failed} failed, ${cooldowns} throttle cooldowns.`,
);
// Origin 404s are recorded but tolerated (those images are broken on the live
// site too); anything else failing means the mirror is incomplete.
if (failed > 0) process.exitCode = 1;
