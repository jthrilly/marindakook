# Typed Content Contract (Track A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the untyped JSON content layer with a zod contract that is the single source of truth for schemas, the `sourceHash` computation, and the derived post index / term counts — validated in CI on every push.

**Architecture:** `src/lib/content-schema.ts` holds zod schemas for every authored content file; inferred types replace the hand-written interfaces in `src/lib/types.ts` (which is deleted). Derived state (`posts-index.json`, term counts) stops being committed: `src/lib/content-derive.ts` recomputes it from `content/posts/*.json` at build time, consumed by both the site loaders and the search-index prebuild script. A pure `sourceHashOf()` in `src/lib/source-hash.ts` becomes the only hash implementation. A `validate-content` script gates CI.

**Tech Stack:** zod v4 (runtime dependency), vitest (test runner), tsx (runs `.mjs` scripts that import `.ts` modules), Next.js 16.2.10 static export, Node 24 in CI.

**Spec:** Track A of `docs/superpowers/specs/2026-07-20-chat-cms-design.md`.

## Global Constraints

- **Migration proof:** all 397 posts, 399 translations (397 posts + 2 pages), 2 pages, `site.json`, and `terms.json` must parse under the contract; the derived index must deep-equal the committed `posts-index.json` before that file is deleted; `sourceHashOf` must reproduce the stored hash of every committed translation.
- **Hash stability is sacred:** the `sourceHash` basis is `JSON.stringify({title, excerpt ?? null, html, recipe ?? null, seo})` in exactly that key order (from `scripts/source-hash.mjs`). Any change invalidates 399 committed hashes.
- **Schemas are `z.strictObject`** — unknown keys are contract drift and must fail.
- All content files are written with `JSON.stringify(data, null, 1)` and **no trailing newline** (the `writeJson` convention in `scripts/sync-content.mjs:45-49`). One-off migration edits must match or diffs will be whole-file noise.
- Index sort order: date descending, **id ascending on equal dates** (verified against the committed index: ids 5236 then 5247 share `2018-11-29T17:25:06`).
- No `as` type assertions. No barrel files. Comments only where the code is genuinely unusual. TypeScript `strict` is on.
- After modifying files run `npx eslint <files> --fix` and `npx tsc --noEmit`. There is no separate formatter (no prettier config; eslint is the only tool).
- Never import `src/lib/content.ts` from a vitest test — it imports `server-only`, which throws outside Next. Loaders are verified by `npm run build`.
- NEVER run `git stash`, `git checkout <ref> -- <path>`, `git clean`, or `git reset` — untracked files in the working tree must never be at risk.
- Every commit must leave `npm run build` green. Run it before each commit that touches `src/` or `scripts/`.
- `AGENTS.md` warning applies: this Next.js version may differ from training data — consult `node_modules/next/dist/docs/` before using any Next API not already used in the repo (this plan needs none).

---

### Task 1: Test tooling + Post/Recipe schemas + parse-all-posts fixture

**Files:**
- Modify: `package.json` (deps + `test` script)
- Create: `vitest.config.ts`
- Create: `src/lib/content-schema.ts`
- Test: `tests/content-schema.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `postSchema` (zod strict object) and inferred types `Locale`, `ImageRef`, `FeaturedImage`, `RecipeDetail`, `Recipe`, `Comment`, `Post` exported from `@/lib/content-schema`. Later tasks extend this same file with `pageSchema`, `translationSchema`, `siteSchema`, `termsFileSchema`.

- [ ] **Step 1: Install dependencies and add the test script**

```bash
npm install zod
npm install -D vitest tsx
```

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
```

- [ ] **Step 2: Create vitest config with the `@` alias**

```ts
// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 3: Write the failing fixture test**

```ts
// tests/content-schema.test.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postSchema } from "@/lib/content-schema";

const CONTENT = join(process.cwd(), "content");

async function readJson(...parts: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(CONTENT, ...parts), "utf8"));
}

async function listJson(dir: string): Promise<string[]> {
  return (await readdir(join(CONTENT, dir))).filter((f) => f.endsWith(".json"));
}

describe("post contract", () => {
  it("parses all committed posts", async () => {
    const files = await listJson("posts");
    expect(files.length).toBe(397);
    for (const file of files) {
      const raw = await readJson("posts", file);
      const result = postSchema.safeParse(raw);
      expect(result.success, `${file}: ${result.error?.message}`).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/content-schema'` (or equivalent resolve error).

- [ ] **Step 5: Implement the schemas**

Key order inside each object mirrors the on-disk key order of the sync-written
files (this matters later: `sourceHashOf` must be able to hash a zod-parsed
object to the same string as the raw disk object).

```ts
// src/lib/content-schema.ts
import { z } from "zod";

export type Locale = "af" | "en";

const imageRefSchema = z.strictObject({
  src: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

const featuredImageSchema = z.strictObject({
  alt: z.string(),
  card: imageRefSchema.nullable(),
  portrait: imageRefSchema.nullable(),
  thumb: imageRefSchema.nullable(),
});

const seoSchema = z.strictObject({
  title: z.string(),
  description: z.string().nullable(),
});

const recipeDetailSchema = z.strictObject({
  icon: z.strictObject({ set: z.string(), name: z.string() }).nullable(),
  label: z.string(),
  pairs: z.array(z.strictObject({ value: z.string(), unit: z.string() })),
});

const recipeSchema = z.strictObject({
  style: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  image: z
    .strictObject({
      src: z.string(),
      srcset: z.string().nullable(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      alt: z.string(),
    })
    .nullable(),
  courses: z.array(z.string()),
  cuisines: z.array(z.string()),
  difficulties: z.array(z.string()),
  summaryHtml: z.string().nullable(),
  details: z.array(recipeDetailSchema),
  ingredientsTitle: z.string().nullable(),
  ingredientGroups: z.array(
    z.strictObject({ title: z.string().nullable(), items: z.array(z.string()) }),
  ),
  directionsTitle: z.string().nullable(),
  directionGroups: z.array(
    z.strictObject({ title: z.string().nullable(), steps: z.array(z.string()) }),
  ),
  notesTitle: z.string().nullable(),
  notes: z.array(z.string()),
  videoHtml: z.string().nullable(),
});

const commentSchema = z.strictObject({
  id: z.number().int(),
  parent: z.number().int(),
  author: z.string(),
  avatar: z.string().nullable(),
  date: z.string(),
  html: z.string(),
});

export const postSchema = z.strictObject({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  date: z.string(),
  modified: z.string(),
  excerpt: z.string(),
  categories: z.array(z.number().int()),
  tags: z.array(z.number().int()),
  featured: featuredImageSchema.nullable(),
  commentStatus: z.string(),
  seo: seoSchema,
  html: z.string(),
  recipe: recipeSchema.nullable(),
  comments: z.array(commentSchema),
});

export type ImageRef = z.infer<typeof imageRefSchema>;
export type FeaturedImage = z.infer<typeof featuredImageSchema>;
export type RecipeDetail = z.infer<typeof recipeDetailSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Post = z.infer<typeof postSchema>;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 397 files. If a file fails, the assertion message names it and
the zod issue — inspect that file and adjust the schema **only if the data is
legitimate** (the nullabilities above were verified against all 397 files;
unknown keys mean the scan missed something, so extend the schema to match
reality, keeping `strictObject`).

- [ ] **Step 7: Lint and type-check**

Run: `npx eslint vitest.config.ts src/lib/content-schema.ts tests/content-schema.test.ts --fix && npx tsc --noEmit`
Expected: no errors (pre-existing `<img>` warnings elsewhere are fine).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/content-schema.ts tests/content-schema.test.ts
git commit -m "Add zod content contract: Post schema with parse-all fixture"
```

---

### Task 2: Page + Translation schemas + fixtures

**Files:**
- Modify: `src/lib/content-schema.ts`
- Test: `tests/content-schema.test.ts`

**Interfaces:**
- Consumes: `seoSchema`, `recipeSchema`, `readJson`/`listJson` test helpers from Task 1.
- Produces: `pageSchema`, `translationSchema` and inferred types `Page`, `Translation` from `@/lib/content-schema`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/content-schema.test.ts` (add `pageSchema, translationSchema` to the existing `@/lib/content-schema` import):

```ts
describe("page contract", () => {
  it("parses both committed pages", async () => {
    const files = await listJson("pages");
    expect(files.length).toBe(2);
    for (const file of files) {
      const result = pageSchema.safeParse(await readJson("pages", file));
      expect(result.success, `${file}: ${result.error?.message}`).toBe(true);
    }
  });
});

describe("translation contract", () => {
  it("parses all committed translations and cross-checks id/slug", async () => {
    let total = 0;
    for (const type of ["posts", "pages"] as const) {
      for (const file of await listJson(join("translations", "en", type))) {
        total++;
        const raw = await readJson("translations", "en", type, file);
        const result = translationSchema.safeParse(raw);
        expect(result.success, `${type}/${file}: ${result.error?.message}`).toBe(true);
        if (!result.success) continue;
        const source =
          type === "posts"
            ? postSchema.parse(await readJson("posts", file))
            : pageSchema.parse(await readJson("pages", file));
        expect(result.data.id, `${type}/${file} id`).toBe(source.id);
        expect(result.data.slug, `${type}/${file} slug`).toBe(source.slug);
      }
    }
    expect(total).toBe(399);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — `pageSchema`/`translationSchema` not exported. Task 1's test still passes.

- [ ] **Step 3: Implement the schemas**

Append to `src/lib/content-schema.ts` (before the type exports; add the two new type exports beside the others):

```ts
export const pageSchema = z.strictObject({
  id: z.number().int(),
  slug: z.string(),
  title: z.string(),
  date: z.string(),
  modified: z.string(),
  seo: seoSchema,
  html: z.string(),
});

export const translationSchema = z.strictObject({
  id: z.number().int(),
  slug: z.string(),
  sourceHash: z.string(),
  title: z.string(),
  excerpt: z.string().optional(),
  seo: seoSchema,
  html: z.string(),
  recipe: recipeSchema.nullable().optional(),
});

export type Page = z.infer<typeof pageSchema>;
export type Translation = z.infer<typeof translationSchema>;
```

(Data facts: page translations have no `excerpt`; 108 post translations omit
the `recipe` key entirely while others carry `recipe: null` — hence
`.nullable().optional()`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 397 posts, 2 pages, 399 translations.

- [ ] **Step 5: Lint, type-check, commit**

```bash
npx eslint src/lib/content-schema.ts tests/content-schema.test.ts --fix && npx tsc --noEmit
git add src/lib/content-schema.ts tests/content-schema.test.ts
git commit -m "Add Page and Translation schemas with cross-check fixtures"
```

---

### Task 3: Site + Terms schemas + fixtures

**Files:**
- Modify: `src/lib/content-schema.ts`
- Test: `tests/content-schema.test.ts`

**Interfaces:**
- Consumes: test helpers from Task 1.
- Produces: `siteSchema`, `termsFileSchema` and inferred types `NavItem`, `Site`, `Term` from `@/lib/content-schema`. NOTE: these model the files **as they exist today**, including `wpUrl` and `count` — Task 7 removes those vestiges from files and schemas together.

- [ ] **Step 1: Write the failing tests**

Append to `tests/content-schema.test.ts`:

```ts
describe("site + terms contract", () => {
  it("parses site.json", async () => {
    const result = siteSchema.safeParse(await readJson("site.json"));
    expect(result.success, result.error?.message).toBe(true);
  });

  it("parses terms.json", async () => {
    const result = termsFileSchema.safeParse(await readJson("terms.json"));
    expect(result.success, result.error?.message).toBe(true);
    if (result.success) {
      expect(result.data.categories.length).toBe(32);
      expect(result.data.tags.length).toBe(334);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — `siteSchema`/`termsFileSchema` not exported.

- [ ] **Step 3: Implement the schemas**

Append to `src/lib/content-schema.ts`:

```ts
const navItemSchema = z.strictObject({ label: z.string(), path: z.string() });

export const siteSchema = z.strictObject({
  wpUrl: z.string(),
  name: z.string(),
  tagline: z.string(),
  logo: z
    .strictObject({
      src: z.string(),
      srcset: z.string().nullable(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    })
    .nullable(),
  nav: z.strictObject({ top: z.array(navItemSchema), main: z.array(navItemSchema) }),
  social: z.array(z.strictObject({ network: z.string(), url: z.string(), color: z.string() })),
  bio: z.strictObject({
    name: z.string(),
    about: z.string(),
    photo: z.string().nullable(),
    button: z.strictObject({ label: z.string(), path: z.string() }),
  }),
  sidebar: z.strictObject({
    tabs: z.strictObject({ views: z.string(), comments: z.string() }),
    popularViews: z.array(z.strictObject({ title: z.string(), slug: z.string() })),
    popularComments: z.array(z.strictObject({ title: z.string(), slug: z.string() })),
    featurePosts: z.strictObject({ title: z.string(), count: z.number().int() }),
    socialWidget: z.strictObject({ title: z.string(), description: z.string() }),
    categoriesWidget: z.strictObject({ title: z.string() }),
  }),
  home: z.strictObject({
    sectionTitle: z.string(),
    featuredCategory: z.string(),
    readMore: z.string(),
  }),
  newsletter: z.strictObject({
    heading: z.string(),
    placeholder: z.string(),
    button: z.string(),
    action: z.string(),
  }),
  postsPerPage: z.number().int(),
});

const termSchema = z.strictObject({
  id: z.number().int(),
  count: z.number().int(),
  description: z.string(),
  name: z.string(),
  slug: z.string(),
  parent: z.number().int().optional(),
});

export const termsFileSchema = z.strictObject({
  categories: z.array(termSchema),
  tags: z.array(termSchema),
});

export type NavItem = z.infer<typeof navItemSchema>;
export type Site = z.infer<typeof siteSchema>;
export type Term = z.infer<typeof termSchema>;
```

(All 32 categories carry `parent`; no tag does — hence `.optional()`, which
`strictObject` still allows to be absent.)

- [ ] **Step 4: Run tests, lint, type-check**

Run: `npm test && npx eslint src/lib/content-schema.ts tests/content-schema.test.ts --fix && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-schema.ts tests/content-schema.test.ts
git commit -m "Add Site and Terms schemas"
```

---

### Task 4: `sourceHashOf` core + script refactor + round-trip fixture

**Files:**
- Create: `src/lib/source-hash.ts`
- Modify: `scripts/source-hash.mjs` (becomes a thin wrapper)
- Modify: `scripts/check-translation.mjs` (exports a function; keeps CLI)
- Modify: `scripts/check-all-translations.mjs` (imports instead of spawning)
- Modify: `package.json` (`check:translations` runs under tsx)
- Test: `tests/source-hash.test.ts`

**Interfaces:**
- Consumes: `postSchema` from Task 1 (for the normalization-transparency test).
- Produces: `sourceHashOf(source: TranslationSource): string` from `@/lib/source-hash`; `checkTranslation(ref: string): Promise<{ status: "ok" | "missing" | "fail"; issues: string[] }>` from `scripts/check-translation.mjs`. Track D's Worker will import both.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/source-hash.test.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postSchema } from "@/lib/content-schema";
import { sourceHashOf } from "@/lib/source-hash";

const CONTENT = join(process.cwd(), "content");

async function readJson(...parts: string[]): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(CONTENT, ...parts), "utf8"));
}

describe("sourceHashOf", () => {
  it("reproduces the stored hash of every committed translation", async () => {
    for (const type of ["posts", "pages"] as const) {
      const dir = join(CONTENT, "translations", "en", type);
      for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
        const translation = await readJson("translations", "en", type, file);
        const source = await readJson(type, file);
        expect(sourceHashOf(source), `${type}/${file}`).toBe(translation.sourceHash);
      }
    }
  });

  it("is transparent to zod normalization of posts", async () => {
    // The Worker will hash zod-parsed objects; committed hashes were computed
    // over raw disk JSON. Schema key order must therefore match disk order.
    for (const file of (await readdir(join(CONTENT, "posts"))).filter((f) =>
      f.endsWith(".json"),
    )) {
      const raw = await readJson("posts", file);
      const parsed = postSchema.parse(raw);
      expect(sourceHashOf(parsed), file).toBe(sourceHashOf(raw));
    }
  });
});
```

Note: `sourceHashOf` accepts both raw JSON records and parsed `Post` objects —
its parameter type below is structural, so no assertions are needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/source-hash'`.

- [ ] **Step 3: Implement the pure core**

```ts
// src/lib/source-hash.ts
import { createHash } from "node:crypto";

// Only field SELECTION matters to the hash; value types are enforced by the
// content schemas, not here. `unknown` fields let callers pass raw disk JSON
// (Record<string, unknown>) and parsed Post/Page objects without assertions.
export interface TranslationSource {
  title: unknown;
  excerpt?: unknown;
  html: unknown;
  recipe?: unknown;
  seo: unknown;
}

// The field picks and their order are a persisted contract: every committed
// translation stores a sourceHash over exactly this basis. Do not change.
export function sourceHashOf(source: TranslationSource): string {
  const basis = JSON.stringify({
    title: source.title,
    excerpt: source.excerpt ?? null,
    html: source.html,
    recipe: source.recipe ?? null,
    seo: source.seo,
  });
  return createHash("sha1").update(basis).digest("hex");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. If the normalization-transparency test fails, the schema key
order in `content-schema.ts` differs from disk order — fix the schema's key
order, never the hash.

- [ ] **Step 5: Rewrite `scripts/source-hash.mjs` as a wrapper**

Replace the entire file with:

```js
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
```

- [ ] **Step 6: Refactor `scripts/check-translation.mjs` to export a function**

Replace the file-level execution (everything from `const ref = process.argv[2];` down) so the logic lives in an exported function. The checks themselves are unchanged — keep `tagSignature` and `checkHtmlPair` exactly as they are, but `checkHtmlPair` must push into a local `issues` array passed via closure. Final shape:

```js
import { readFile } from "node:fs/promises";
import { parse } from "node-html-parser";
import { sourceHashOf } from "../src/lib/source-hash.ts";

function tagSignature(html) {
  /* unchanged from current file */
}

export async function checkTranslation(ref) {
  const issues = [];

  function checkHtmlPair(name, af, en) {
    /* unchanged body, pushing into the `issues` above */
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
  /* …all remaining checks unchanged, with `await sourceHash(ref)` replaced by
     `sourceHashOf(af)` … */

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
```

The `import { sourceHash } from "./source-hash.mjs"` line is removed — the af
object is already in hand, so hash it directly with `sourceHashOf(af)`.

- [ ] **Step 7: Refactor `scripts/check-all-translations.mjs` to import instead of spawn**

Replace the spawn loop:

```js
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
```

- [ ] **Step 8: Point the npm script at tsx**

In `package.json`:

```json
"check:translations": "tsx scripts/check-all-translations.mjs",
```

- [ ] **Step 9: Verify the checker end-to-end**

Run: `npm run check:translations`
Expected: `399 items: 399 ok, 0 missing, 0 failed` (matches the pre-refactor state).

Run: `npx tsx scripts/source-hash.mjs posts/lemoen-stroopkoek`
Expected: prints a 40-char hex hash equal to `sourceHash` in `content/translations/en/posts/lemoen-stroopkoek.json`.

- [ ] **Step 10: Lint, type-check, commit**

```bash
npx eslint src/lib/source-hash.ts scripts/source-hash.mjs scripts/check-translation.mjs scripts/check-all-translations.mjs tests/source-hash.test.ts --fix && npx tsc --noEmit
git add src/lib/source-hash.ts scripts/source-hash.mjs scripts/check-translation.mjs scripts/check-all-translations.mjs tests/source-hash.test.ts package.json
git commit -m "Extract sourceHashOf into shared core; checker becomes importable"
```

---

### Task 5: Derivation module + migration equality fixture

**Files:**
- Create: `src/lib/content-derive.ts`
- Test: `tests/content-derive.test.ts`

**Interfaces:**
- Consumes: `Post`, `FeaturedImage` types from Task 1.
- Produces: `derivePostIndex(posts: Post[]): PostSummary[]`, `deriveTermCounts(index: PostSummary[]): Map<number, number>`, and `interface PostSummary` from `@/lib/content-derive`. Task 6's loaders and prebuild script consume all three.

- [ ] **Step 1: Write the failing migration test**

```ts
// tests/content-derive.test.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postSchema, termsFileSchema, type Post } from "@/lib/content-schema";
import { derivePostIndex, deriveTermCounts } from "@/lib/content-derive";

const CONTENT = join(process.cwd(), "content");

async function allPosts(): Promise<Post[]> {
  const dir = join(CONTENT, "posts");
  return Promise.all(
    (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .map(async (f) =>
        postSchema.parse(JSON.parse(await readFile(join(dir, f), "utf8"))),
      ),
  );
}

describe("derived post index", () => {
  it("deep-equals the committed posts-index.json", async () => {
    const committed = JSON.parse(
      await readFile(join(CONTENT, "posts-index.json"), "utf8"),
    );
    const derived = JSON.parse(JSON.stringify(derivePostIndex(await allPosts())));
    expect(derived).toEqual(committed);
  });

  it("reproduces the committed WordPress term counts", async () => {
    const counts = deriveTermCounts(derivePostIndex(await allPosts()));
    const terms = termsFileSchema.parse(
      JSON.parse(await readFile(join(CONTENT, "terms.json"), "utf8")),
    );
    for (const term of [...terms.categories, ...terms.tags]) {
      expect(counts.get(term.id) ?? 0, `${term.slug}`).toBe(term.count);
    }
  });
});
```

(The WP counts were verified to match index-derived counts exactly for all 366
terms, so strict equality is safe. This test is a **migration gate**: Task 7
deletes `posts-index.json` and strips `count`, then replaces this file's
assertions — see Task 7 Step 4.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/content-derive'`.

- [ ] **Step 3: Implement the derivation module**

```ts
// src/lib/content-derive.ts
import type { FeaturedImage, Post } from "./content-schema";

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  categories: number[];
  tags: number[];
  featured: FeaturedImage | null;
  hasRecipe: boolean;
  commentCount: number;
}

export function derivePostIndex(posts: Post[]): PostSummary[] {
  return posts
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      date: p.date,
      excerpt: p.excerpt,
      categories: p.categories,
      tags: p.tags,
      featured: p.featured,
      hasRecipe: p.recipe !== null,
      commentCount: p.comments.length,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id - b.id));
}

export function deriveTermCounts(index: PostSummary[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const post of index) {
    for (const id of [...post.categories, ...post.tags]) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}
```

- [ ] **Step 4: Run tests, lint, type-check**

Run: `npm test && npx eslint src/lib/content-derive.ts tests/content-derive.test.ts --fix && npx tsc --noEmit`
Expected: all PASS. If the deep-equal fails only on the two `2018-11-29T17:25:06` entries (positions 180/181), the tiebreak is wrong — it must be id **ascending**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-derive.ts tests/content-derive.test.ts
git commit -m "Derive post index and term counts from post files"
```

---

### Task 6: Loader refactor + type migration + prebuild derivation

**Files:**
- Modify: `src/lib/content.ts` (parse through schemas; derive the index)
- Delete: `src/lib/types.ts`
- Modify: all 23 importers of `@/lib/types` / `./types` (mechanical, listed below)
- Modify: `scripts/build-search-index.mjs` (derives the index itself)
- Modify: `package.json` (`prebuild` runs under tsx)

**Interfaces:**
- Consumes: every schema and type from Tasks 1–3; `derivePostIndex`, `deriveTermCounts`, `PostSummary` from Task 5.
- Produces: `src/lib/content.ts` keeps its existing exported API surface (`getSite`, `getTerms`, `getPostIndex`, `getPageSlugs`, `getPost`, `getPage`, `getPostSummary`, `localizeSummaries`, `paginate`) with identical call signatures, so no view/component logic changes — only type-import paths change.

- [ ] **Step 1: Rewrite `src/lib/content.ts`**

```ts
import "server-only";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import {
  pageSchema,
  postSchema,
  siteSchema,
  termsFileSchema,
  translationSchema,
  type Locale,
  type Page,
  type Post,
  type Site,
  type Term,
  type Translation,
} from "./content-schema";
import { derivePostIndex, deriveTermCounts, type PostSummary } from "./content-derive";

const CONTENT_DIR = join(process.cwd(), "content");

async function readJson(...parts: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(CONTENT_DIR, ...parts), "utf8"));
}

export const getSite = cache(async (): Promise<Site> => siteSchema.parse(await readJson("site.json")));

const getAllPosts = cache(async (): Promise<Post[]> => {
  const files = await readdir(join(CONTENT_DIR, "posts"));
  return Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => postSchema.parse(await readJson("posts", f))),
  );
});

export const getPostIndex = cache(async (): Promise<PostSummary[]> =>
  derivePostIndex(await getAllPosts()),
);

export const getTerms = cache(
  async (): Promise<{ categories: Term[]; tags: Term[] }> => {
    const terms = termsFileSchema.parse(await readJson("terms.json"));
    const counts = deriveTermCounts(await getPostIndex());
    // Parameter is the file-parse shape (not Term) so this compiles unchanged
    // when Task 7 removes `count` from the schema and redefines Term.
    const withDerivedCounts = (list: typeof terms.categories): Term[] =>
      list.map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }));
    return {
      categories: withDerivedCounts(terms.categories),
      tags: withDerivedCounts(terms.tags),
    };
  },
);

export const getPageSlugs = cache(async () => {
  const files = await readdir(join(CONTENT_DIR, "pages"));
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
});

const getTranslation = cache(
  async (type: "posts" | "pages", slug: string): Promise<Translation | null> => {
    let raw: unknown;
    try {
      raw = await readJson("translations", "en", type, `${slug}.json`);
    } catch {
      return null;
    }
    // Parse OUTSIDE the try: a malformed translation must fail the build
    // loudly, not silently fall back to Afrikaans.
    return translationSchema.parse(raw);
  },
);

export const getPost = cache(async (slug: string, locale: Locale): Promise<Post> => {
  const post = postSchema.parse(await readJson("posts", `${slug}.json`));
  if (locale === "af") return post;
  const t = await getTranslation("posts", slug);
  if (!t) return post;
  return {
    ...post,
    title: t.title,
    excerpt: t.excerpt ?? post.excerpt,
    seo: t.seo ?? post.seo,
    html: t.html,
    recipe: t.recipe ?? post.recipe,
  };
});

export const getPage = cache(async (slug: string, locale: Locale): Promise<Page> => {
  const page = pageSchema.parse(await readJson("pages", `${slug}.json`));
  if (locale === "af") return page;
  const t = await getTranslation("pages", slug);
  if (!t) return page;
  return { ...page, title: t.title, seo: t.seo ?? page.seo, html: t.html };
});

export const getPostSummary = cache(
  async (slug: string, locale: Locale): Promise<PostSummary | null> => {
    const index = await getPostIndex();
    const summary = index.find((p) => p.slug === slug);
    if (!summary) return null;
    if (locale === "af") return summary;
    const t = await getTranslation("posts", slug);
    if (!t) return summary;
    return { ...summary, title: t.title, excerpt: t.excerpt ?? summary.excerpt };
  },
);

export async function localizeSummaries(posts: PostSummary[], locale: Locale) {
  if (locale === "af") return posts;
  return Promise.all(posts.map(async (p) => (await getPostSummary(p.slug, locale)) ?? p));
}

export function paginate<T>(items: T[], page: number, perPage: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  return {
    items: items.slice((page - 1) * perPage, page * perPage),
    page,
    totalPages,
  };
}
```

Note for Task 7: the `Term` type still includes `count` here (it comes from the
file schema until the vestige removal), so `withDerivedCounts` merely
overwrites it with the derived value. Task 7 makes `count` derived-only.

- [ ] **Step 2: Migrate the 23 type importers**

Mechanical rewrite (macOS `sed -i ''`):

```bash
grep -rl 'from "@/lib/types"' src | xargs sed -i '' 's|from "@/lib/types"|from "@/lib/content-schema"|'
grep -rl 'from "\./types"' src/lib | xargs sed -i '' 's|from "\./types"|from "./content-schema"|'
```

Then fix the files that import `PostSummary` (it now lives in
`@/lib/content-derive`, not the schema module). Exactly these six files
reference it: `src/components/FeaturedGrid.tsx`, `src/components/PostCard.tsx`,
`src/components/post/PostExtras.tsx`, `src/components/widgets/Sidebar.tsx`,
`src/views/PostView.tsx` (plus `src/lib/content.ts`, already handled above).
In each, split the import — e.g. in `PostCard.tsx`:

```ts
// before (post-sed)
import type { Locale, PostSummary, Term } from "@/lib/content-schema";
// after
import type { Locale, Term } from "@/lib/content-schema";
import type { PostSummary } from "@/lib/content-derive";
```

(Keep whatever other names each file imports; only `PostSummary` moves.)

- [ ] **Step 3: Delete the old types module**

```bash
git rm src/lib/types.ts
```

- [ ] **Step 4: Type-check and fix fallout**

Run: `npx tsc --noEmit`
Expected: clean. Any error is a missed import path or a type that only existed
in `types.ts` — every one of its 13 exports now comes from `content-schema.ts`
(12) or `content-derive.ts` (`PostSummary`); do not re-create `types.ts`.

- [ ] **Step 5: Rewrite `scripts/build-search-index.mjs` to derive the index**

Replace the two top reads (`posts-index.json` stays untouched on disk until
Task 7, but nothing reads it from here on):

```js
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { derivePostIndex } from "../src/lib/content-derive.ts";

const CONTENT = new URL("../content/", import.meta.url);
const PUBLIC = new URL("../public/", import.meta.url);

const postsDir = new URL("posts/", CONTENT);
const posts = await Promise.all(
  (await readdir(postsDir))
    .filter((f) => f.endsWith(".json"))
    .map(async (f) => JSON.parse(await readFile(new URL(f, postsDir), "utf8"))),
);
const index = derivePostIndex(posts);
const terms = JSON.parse(await readFile(new URL("terms.json", CONTENT), "utf8"));
```

Everything below (`enCategoryNames`, `catNames`, `tagById`, `translation`,
`entry`, the locale loop) is unchanged and keeps reading from `index`.

- [ ] **Step 6: Run prebuild under tsx**

In `package.json`:

```json
"prebuild": "tsx scripts/build-search-index.mjs",
```

- [ ] **Step 7: Full verification build**

```bash
npm test && npm run build
find out -name index.html | wc -l
```

Expected: tests pass; build succeeds; page count is **1693** (identical to the
pre-refactor build). Spot-check derived data reached the output:

```bash
python3 -c "import json; d=json.load(open('public/search-index.af.json')); print(len(d))"
```

Expected: 397 entries (the prebuild derived the index itself).

- [ ] **Step 8: Lint and commit**

```bash
npx eslint src scripts/build-search-index.mjs --fix && npx tsc --noEmit
git add -A
git commit -m "Loaders parse through the zod contract; post index derived at build time"
```

---

### Task 7: Vestige removal — delete `posts-index.json`, strip `count`/`wpUrl`, fix sync writers

**Files:**
- Delete: `content/posts-index.json`
- Modify: `content/terms.json` (strip `count`), `content/site.json` (strip `wpUrl`) — one-off edits
- Modify: `src/lib/content-schema.ts` (schemas drop `count`/`wpUrl`)
- Modify: `scripts/sync-content.mjs` (stop writing the index; strip on write)
- Test: `tests/content-derive.test.ts`, `tests/content-schema.test.ts` (updated)

**Interfaces:**
- Consumes: everything from Task 6 (nothing reads `posts-index.json` or the committed counts anymore — verified there).
- Produces: final contract state — `Term` inferred type no longer has `count`; `export type Term = z.infer<typeof termSchema> & { count: number }` gives loaders/components the enriched runtime shape unchanged.

- [ ] **Step 1: Confirm nothing reads the vestiges**

```bash
grep -rn "posts-index" src scripts --include='*.ts' --include='*.tsx' --include='*.mjs' | grep -v sync-content
grep -rn "wpUrl" src
```

Expected: no matches (sync-content.mjs is handled below). If anything matches, stop — Task 6 was incomplete.

- [ ] **Step 2: One-off strip of the committed files**

The files use `JSON.stringify(data, null, 1)` with **no trailing newline** — match it exactly so the diff is only the removed lines:

```bash
node -e '
const fs = require("node:fs");
const terms = JSON.parse(fs.readFileSync("content/terms.json", "utf8"));
for (const list of [terms.categories, terms.tags]) for (const t of list) delete t.count;
fs.writeFileSync("content/terms.json", JSON.stringify(terms, null, 1));
const site = JSON.parse(fs.readFileSync("content/site.json", "utf8"));
delete site.wpUrl;
fs.writeFileSync("content/site.json", JSON.stringify(site, null, 1));
'
git rm content/posts-index.json
git diff --stat content/terms.json content/site.json
```

Expected diff stat: `terms.json` −366 lines (one `count` per term), `site.json` −1 line, nothing else. A whole-file diff means the formatting convention was violated — investigate before committing.

- [ ] **Step 3: Update the schemas**

In `src/lib/content-schema.ts`: remove `count: z.number().int(),` from `termSchema`, remove `wpUrl: z.string(),` from `siteSchema`, and change the `Term` export to carry the derived count:

```ts
export type Term = z.infer<typeof termSchema> & { count: number };
```

(`src/lib/content.ts` already builds exactly this shape via `withDerivedCounts`; components like `Sidebar.tsx` that read `c.count` keep compiling unchanged.)

- [ ] **Step 4: Update the tests that asserted the old state**

In `tests/content-derive.test.ts`, the two migration-gate assertions lose their reference data. Replace the whole `describe` block body with structural invariants (keep `allPosts` as is):

```ts
describe("derived post index", () => {
  it("is date-descending with ascending-id tiebreak and unique slugs", async () => {
    const index = derivePostIndex(await allPosts());
    expect(index.length).toBe(397);
    for (let i = 1; i < index.length; i++) {
      const prev = index[i - 1];
      const cur = index[i];
      const ordered =
        prev.date > cur.date || (prev.date === cur.date && prev.id < cur.id);
      expect(ordered, `${prev.slug} -> ${cur.slug}`).toBe(true);
    }
    expect(new Set(index.map((p) => p.slug)).size).toBe(index.length);
  });

  it("counts every category and tag reference", async () => {
    const index = derivePostIndex(await allPosts());
    const counts = deriveTermCounts(index);
    const total = index.reduce((n, p) => n + p.categories.length + p.tags.length, 0);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(total);
  });
});
```

In `tests/content-schema.test.ts`, the terms test keeps its length assertions (32 categories / 334 tags still hold) — no change needed there; it now simply validates count-less terms. In `tests/content-derive.test.ts`, the `termsFileSchema` import is now unused — remove it from the import statement (eslint reports it but will not auto-remove).

- [ ] **Step 5: Update `scripts/sync-content.mjs` writers**

Three edits (sync stays alive until Track C; it must not resurrect vestiges):

1. Line 56 — strip counts on write. `count` arrives from the WP API fields; drop it via rest-destructuring (rename to `_count` if eslint complains about the unused binding):

```js
await writeJson("terms.json", {
  categories: categories.map(({ count: _count, ...t }) => t),
  tags: tags.map(({ count: _count, ...t }) => t),
});
```

2. Line 174 — delete only the write, keep the in-memory `postIndex` (lines 302/309 still use it for the sync report and log):

```js
// DELETE this line:
await writeJson("posts-index.json", postIndex);
```

3. Line 221 — delete `wpUrl: WP_URL,` from the `site` object literal.

- [ ] **Step 6: Full verification**

```bash
npm test
npm run build
find out -name index.html | wc -l
grep -o "Bykosse ([0-9]*)" out/index.html | head -1
```

Expected: tests pass; 1693 pages; `Bykosse (86)` — the sidebar category count now comes from derivation, not the file.

- [ ] **Step 7: Lint and commit**

```bash
npx eslint src scripts/sync-content.mjs --fix && npx tsc --noEmit
git add -A
git commit -m "Remove committed derived state: posts-index.json, term counts, wpUrl"
```

---

### Task 8: `validate-content` script + CI gate + docs

**Files:**
- Create: `scripts/validate-content.mjs`
- Modify: `package.json` (`validate:content` script)
- Modify: `.github/workflows/deploy.yml` (validation step after `npm ci`)
- Modify: `README.md` (commands table + tsx-based hash command in "Translate new content")
- Test: `tests/validate-content.test.ts`

**Interfaces:**
- Consumes: all schemas (Tasks 1–3, post-Task-7 state) and `sourceHashOf` is NOT used here (staleness stays `check:translations`' job — this gate is structural validity + referential integrity only).
- Produces: `validateContent(root: string): Promise<string[]>` (list of human-readable issues, empty = valid) from `scripts/validate-content.mjs`; CI fails on non-empty.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/validate-content.test.ts
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- .mjs script module without type declarations
import { validateContent } from "../scripts/validate-content.mjs";

describe("validateContent", () => {
  it("passes on the real repo content", async () => {
    const issues = await validateContent(join(process.cwd(), "content"));
    expect(issues).toEqual([]);
  });

  it("reports a corrupted post", async () => {
    const dir = await mkdtemp(join(tmpdir(), "content-"));
    await cp(join(process.cwd(), "content"), dir, { recursive: true });
    const victim = join(dir, "posts", "lemoen-stroopkoek.json");
    const post = JSON.parse(await readFile(victim, "utf8"));
    delete post.title;
    post.bogus = true;
    await writeFile(victim, JSON.stringify(post, null, 1));
    const issues = await validateContent(dir);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).toContain("lemoen-stroopkoek");
  });
});
```

Note: if `@ts-expect-error` is flagged as unused, the import resolved types
fine — just delete the directive. Do not add a `.d.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../scripts/validate-content.mjs`.

- [ ] **Step 3: Implement the validator**

```js
// scripts/validate-content.mjs
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  pageSchema,
  postSchema,
  siteSchema,
  termsFileSchema,
  translationSchema,
} from "../src/lib/content-schema.ts";

function zodIssues(name, error) {
  return error.issues.map((i) => `${name}: ${i.path.join(".") || "(root)"} — ${i.message}`);
}

export async function validateContent(root) {
  const issues = [];
  const readJson = async (...parts) =>
    JSON.parse(await readFile(join(root, ...parts), "utf8"));
  const listJson = async (...parts) =>
    (await readdir(join(root, ...parts))).filter((f) => f.endsWith(".json"));

  const site = siteSchema.safeParse(await readJson("site.json"));
  if (!site.success) issues.push(...zodIssues("site.json", site.error));

  const terms = termsFileSchema.safeParse(await readJson("terms.json"));
  if (!terms.success) issues.push(...zodIssues("terms.json", terms.error));
  const termIds = new Set(
    terms.success
      ? [...terms.data.categories, ...terms.data.tags].map((t) => t.id)
      : [],
  );

  const posts = new Map();
  for (const file of await listJson("posts")) {
    const result = postSchema.safeParse(await readJson("posts", file));
    if (!result.success) {
      issues.push(...zodIssues(`posts/${file}`, result.error));
      continue;
    }
    posts.set(result.data.slug, result.data);
    if (`${result.data.slug}.json` !== file) {
      issues.push(`posts/${file}: slug "${result.data.slug}" does not match filename`);
    }
    if (terms.success) {
      for (const id of [...result.data.categories, ...result.data.tags]) {
        if (!termIds.has(id)) issues.push(`posts/${file}: unknown term id ${id}`);
      }
    }
  }

  const pages = new Map();
  for (const file of await listJson("pages")) {
    const result = pageSchema.safeParse(await readJson("pages", file));
    if (!result.success) {
      issues.push(...zodIssues(`pages/${file}`, result.error));
      continue;
    }
    pages.set(result.data.slug, result.data);
    if (posts.has(result.data.slug)) {
      issues.push(`pages/${file}: slug collides with a post (posts win in the router)`);
    }
  }

  for (const [type, sources] of [
    ["posts", posts],
    ["pages", pages],
  ]) {
    for (const file of await listJson("translations", "en", type)) {
      const name = `translations/en/${type}/${file}`;
      const result = translationSchema.safeParse(
        await readJson("translations", "en", type, file),
      );
      if (!result.success) {
        issues.push(...zodIssues(name, result.error));
        continue;
      }
      const source = sources.get(result.data.slug);
      if (!source) {
        issues.push(`${name}: no ${type} source with slug "${result.data.slug}"`);
      } else if (source.id !== result.data.id) {
        issues.push(`${name}: id ${result.data.id} does not match source id ${source.id}`);
      }
    }
  }

  return issues;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const issues = await validateContent(new URL("../content", import.meta.url).pathname);
  if (issues.length) {
    console.error(`Content validation FAILED (${issues.length} issues):`);
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log("Content validation OK");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (both the clean run and the corrupted-fixture run).

- [ ] **Step 5: Wire up npm script and CI**

`package.json`:

```json
"validate:content": "tsx scripts/validate-content.mjs",
```

`.github/workflows/deploy.yml` — insert directly after the `- run: npm ci` step:

```yaml
      - name: Validate content
        run: npm run validate:content
```

- [ ] **Step 6: Verify the CLI locally**

Run: `npm run validate:content`
Expected: `Content validation OK`, exit 0.

- [ ] **Step 7: Update the README**

In the Commands table add:

```markdown
| `npm run validate:content` | Validate all content JSON against the zod contract (CI runs this on every push) |
| `npm test` | Contract + derivation test suite |
```

In "Translate new content to English", change the hash command to
`npx tsx scripts/source-hash.mjs posts/<slug>` and the check command to
`npx tsx scripts/check-translation.mjs posts/<slug>`. In the Content layout
section, delete the `posts-index.json` line (it is no longer committed; the
index is derived at build time).

- [ ] **Step 8: Lint, final full check, commit, push**

```bash
npx eslint scripts/validate-content.mjs tests/validate-content.test.ts --fix && npx tsc --noEmit
npm test && npm run check:translations && npm run build
git add -A
git commit -m "Add validate-content CI gate and contract docs"
git push
```

Expected: everything green; the push triggers a Pages deploy whose output is
byte-identical content-wise (only build tooling changed). Watch it:
`gh run watch $(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')`
Expected: conclusion `success` in ~3 minutes.
