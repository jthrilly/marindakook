import { readdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// Mirrors server/src/core/publish-build.ts renditionUrl(): the Worker turns
// `hero.jpg` into `hero-760x760.jpg` by inserting `-WxH` before the
// extension. To materialize a missing rendition we invert that: strip the
// trailing `-WxH` suffix to recover the committed original's filename.
const RENDITION_SUFFIX = /^(.*)-(\d+)x(\d+)(\.[^./]+)$/;

function parseRendition(src) {
  const match = RENDITION_SUFFIX.exec(src);
  if (!match) return null;
  const [, base, width, height, ext] = match;
  return { originalSrc: `${base}${ext}`, width: Number(width), height: Number(height) };
}

// Every `featured`/`recipe.image` src the Worker writes is a site-absolute
// URL like `/media/uploads/2026/07/hero-760x760.jpg`; the on-disk commit
// path is the same string under `public/` (see mediaCommitPath in
// publish-build.ts).
function srcToRelPath(src) {
  return join("public", src.replace(/^\//, ""));
}

// The featured/recipe.image refs a post JSON may carry `-WxH` renditions on.
function collectImageRefs(post) {
  const refs = [];
  const featured = post?.featured;
  if (featured) {
    for (const key of ["card", "portrait", "thumb"]) {
      const src = featured[key]?.src;
      if (typeof src === "string") refs.push(src);
    }
  }
  const recipeSrc = post?.recipe?.image?.src;
  if (typeof recipeSrc === "string") refs.push(recipeSrc);
  return refs;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function materializeOne(root, src, created) {
  const parsed = parseRendition(src);
  if (!parsed) return; // not a `-WxH` sized reference; nothing to derive

  const renditionRelPath = srcToRelPath(src);
  const renditionPath = join(root, renditionRelPath);
  if (await exists(renditionPath)) return; // idempotent: already materialized

  const originalPath = join(root, srcToRelPath(parsed.originalSrc));
  if (!(await exists(originalPath))) {
    // Legacy post whose original was never committed (WordPress generated
    // the rendition directly and it's either already present or gone at
    // origin) — skip gracefully, don't crash the whole CI run over it.
    return;
  }

  const tmpPath = `${renditionPath}.tmp`;
  try {
    await sharp(originalPath, { failOn: "none" })
      .rotate()
      .resize(parsed.width, parsed.height, { fit: "cover", position: "centre" })
      .toFile(tmpPath);
    await rename(tmpPath, renditionPath);
    created.push(renditionRelPath.split("\\").join("/"));
  } catch (err) {
    console.error(`  skip ${src}: ${err.message}`);
  }
}

export async function materializeRenditions(root) {
  const postsDir = join(root, "content", "posts");
  const created = [];
  let entries;
  try {
    entries = await readdir(postsDir);
  } catch (err) {
    if (err.code === "ENOENT") return { created, skipped: 0 };
    throw err;
  }

  let skipped = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    let post;
    try {
      post = JSON.parse(await readFile(join(postsDir, entry), "utf8"));
    } catch (err) {
      console.error(`  skip ${entry}: unreadable/invalid JSON (${err.message})`);
      skipped++;
      continue;
    }
    for (const src of collectImageRefs(post)) {
      await materializeOne(root, src, created);
    }
  }

  return { created, skipped };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { created } = await materializeRenditions(process.cwd());
  console.error(`materialize-renditions: created ${created.length} rendition file(s)`);
  for (const path of created) console.log(path);
}
