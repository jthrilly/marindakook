# Voice & Chrome (Track B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the future chat CMS Marinda's voice (committed style guides + the canonical translation prompt + a regression harness) and complete the contract item deferred from Track A: a real English translation file for site chrome.

**Architecture:** Two editorial artifacts (`content/style-guide.af.md`, `content/style-guide.en.md`) distilled from the 397-post corpus; the structural translation validator extracted into a pure, fs-free comparator (`src/lib/translation-check.mjs`) shared by scripts, the regression harness, and later the Worker; the canonical prompt as a committed template (`server/prompts/translate-en.md`) with a pure builder; site chrome translated via `content/translations/en/site.json` with its own `sourceHash`, replacing the hard-coded `enSiteStrings` in `i18n.ts`.

**Tech Stack:** Existing Track A stack (zod v4, vitest, tsx, Node 24). Anthropic API (key required only to *run* the regression harness, not to build it).

**Spec:** Track B of `docs/superpowers/specs/2026-07-20-chat-cms-design.md`, plus the site-chrome deferral recorded in its Phasing section.

## Global Constraints

- **Do not touch `sourceHashOf`** or its basis — it is a persisted contract (399 files).
- New hash `siteChromeHashOf` is a NEW contract: exact basis defined in Task 6; once the seed file is committed, it is persisted too.
- All content files: `JSON.stringify(data, null, 1)`, no trailing newline.
- Schemas `z.strictObject`; no `as` assertions; no barrel files; TypeScript strict; comments only where genuinely unusual.
- `npm run check:translations` output gains a `site` line but the 399 post/page items must stay `399 ok`.
- After every task that touches `src/` or `scripts/`: `npx eslint <files> --fix && npx tsc --noEmit && npm test`; full `npm run build` (must stay 1692 pages) before committing loader/chrome changes.
- Never import `src/lib/content.ts` from vitest tests.
- Style guides are **editorial artifacts**: every stylistic claim must carry at least one verbatim quoted example with its post slug. They are written once by corpus analysis, then human-curated (owner: Joshua) — note this in each file's header.
- Editorial tasks (1, 2, 4) have no TDD cycle; their acceptance criteria are listed in the task and enforced by review.

---

### Task 1: Afrikaans style guide (`content/style-guide.af.md`)

**Files:**
- Create: `content/style-guide.af.md`

**Interfaces:**
- Consumes: the corpus (`content/posts/*.json`, `content/pages/*.json`).
- Produces: the committed af voice reference; Track D's `get_style_guide` tool serves this file verbatim.

- [ ] **Step 1: Sample the corpus deliberately**

Read at least 40 posts spanning the whole archive — pick by varied date (oldest ~2013 to newest 2025), mix of recipe and non-recipe posts, plus both pages (`oor-my`, `optredes`). List the slugs you sampled in the document's header comment.

- [ ] **Step 2: Write the guide**

Structure (Afrikaans headings; the guide itself is written in Afrikaans since its consumer is a model writing Afrikaans):

1. `# Marinda se stem — stylgids (Afrikaans)` + header note: generated 2026-07-20 by corpus analysis of N posts; manually curated hereafter (owner: Joshua); regeneration is a deliberate act.
2. `## Toon en persona` — warm, personal, self-deprecating? formal/informal register, humour patterns.
3. `## Openings` — how posts typically begin (personal anecdote, direct address, season/occasion), 4–6 quoted openings.
4. `## Leser-aanspreek` — jy/julle usage, imperative style in method text, rhetorical questions.
5. `## Tipiese frases en uitroepe` — recurring phrases, exclamations, transitions; each quoted.
6. `## Struktuur van 'n pos` — story-then-recipe pattern, typical intro length, how the recipe is introduced, sign-offs.
7. `## Resep-instruksie styl` — how method steps are phrased (person, tense, level of detail), ingredient phrasing conventions.
8. `## Woordkeuse` — characteristic vocabulary, Afrikaans/English code-switching habits (the blog mixes freely), food terms she prefers.
9. `## Moenie` — what would ring false: over-formality, generic-LLM warmth, phrases she never uses.

**Acceptance criteria (reviewer enforces):** every section's claims carry ≥1 verbatim quote with source slug in the form `— *slug*`; quotes must actually exist in the named file (spot-checkable with grep); 120–300 lines total; written in Afrikaans; no invented quotes.

- [ ] **Step 3: Verify quotes are genuine**

For each quoted phrase, `grep -l` a distinctive substring in `content/posts/` and confirm the named slug matches. Fix any misattribution.

- [ ] **Step 4: Commit**

```bash
git add content/style-guide.af.md
git commit -m "Add Afrikaans voice style guide distilled from the corpus"
```

---

### Task 2: English style guide (`content/style-guide.en.md`)

**Files:**
- Create: `content/style-guide.en.md`

**Interfaces:**
- Consumes: `content/translations/en/posts/*.json` (the 397 existing translations) and `content/style-guide.af.md` (Task 1).
- Produces: the committed en voice reference; consumed by the translation prompt (Task 4) via `{{STYLE_GUIDE}}`.

- [ ] **Step 1: Sample the translations**

Read the English translations of ≥25 of the same posts sampled in Task 1 (so af/en pairs can be contrasted), plus 10 others. List sampled slugs in the header.

- [ ] **Step 2: Write the guide**

English headings, written in English (its consumer is a model writing English). Structure mirrors Task 1 (header note, tone, openings, reader address, recurring phrases, structure, method style, word choice, don'ts) with one extra section:

- `## Translation conventions` — how the existing corpus renders her Afrikaans quirks in English: what stays untranslated (dish names like "melktert", exclamations), how code-switching is handled, how idioms were carried over vs. localized, SA English vocabulary choices (e.g. what "braai" stays as), units/temperatures conventions.

**Acceptance criteria:** same evidence rules as Task 1 (verbatim quotes + slugs, verified); 120–300 lines; explicitly contrasts at least 5 af→en pairs (quote both sides).

- [ ] **Step 3: Verify quotes** (same grep method as Task 1, against `content/translations/en/posts/`).

- [ ] **Step 4: Commit**

```bash
git add content/style-guide.en.md
git commit -m "Add English voice style guide distilled from existing translations"
```

---

### Task 3: Extract the pure translation comparator

**Files:**
- Create: `src/lib/translation-check.mjs`
- Modify: `scripts/check-translation.mjs` (becomes a thin fs + hash wrapper)
- Test: `tests/translation-check.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `compareTranslation(af, en): string[]` from `src/lib/translation-check.mjs` — pure, fs-free, **no sourceHash check** (that stays a storage concern in the wrapper). Consumers: `scripts/check-translation.mjs` (Task 3), the regression harness (Task 5), Track D's Worker (validates candidate translations in-memory before stamping a hash).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/translation-check.test.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- untyped .mjs module (delete directive if unused)
import { compareTranslation } from "../src/lib/translation-check.mjs";

const CONTENT = join(process.cwd(), "content");

async function pair(slug: string) {
  const af = JSON.parse(await readFile(join(CONTENT, "posts", `${slug}.json`), "utf8"));
  const en = JSON.parse(
    await readFile(join(CONTENT, "translations", "en", "posts", `${slug}.json`), "utf8"),
  );
  return { af, en };
}

describe("compareTranslation", () => {
  it("accepts a known-good pair", async () => {
    const { af, en } = await pair("lemoen-stroopkoek");
    expect(compareTranslation(af, en)).toEqual([]);
  });

  it("flags structural mutations", async () => {
    const { af, en } = await pair("lemoen-stroopkoek");
    const dropStep = structuredClone(en);
    dropStep.recipe.directionGroups[0].steps.pop();
    expect(compareTranslation(af, dropStep).join("\n")).toContain("structure counts differ");

    const wrongId = structuredClone(en);
    wrongId.id = 1;
    expect(compareTranslation(af, wrongId).join("\n")).toContain("id mismatch");

    const brokenHtml = structuredClone(en);
    brokenHtml.html = brokenHtml.html.replace("<p>", "<div>");
    expect(compareTranslation(af, brokenHtml).join("\n")).toContain("tag structure differs");

    const changedDetails = structuredClone(en);
    changedDetails.recipe.details[0].label = "changed";
    expect(compareTranslation(af, changedDetails).join("\n")).toContain(
      "details must be copied unchanged",
    );
  });

  it("does not check sourceHash (storage concern, not structural)", async () => {
    const { af, en } = await pair("lemoen-stroopkoek");
    const noHash = structuredClone(en);
    delete noHash.sourceHash;
    expect(compareTranslation(af, noHash)).toEqual([]);
  });
});
```

(`lemoen-stroopkoek` is a recipe post with `<p>` in its html and a details array — verified. If `.pop()` on its directionGroups steps leaves counts equal for some reason, pick another mutation; do not weaken the assertion.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/lib/translation-check.mjs`.

- [ ] **Step 3: Implement by extraction**

Create `src/lib/translation-check.mjs` by MOVING logic from `scripts/check-translation.mjs`, unchanged in behavior:

```js
import { parse } from "node-html-parser";

function tagSignature(html) {
  /* moved verbatim from scripts/check-translation.mjs */
}

// Structural comparison of a translation against its Afrikaans source.
// Deliberately excludes sourceHash: candidates fresh from a model have no
// stored hash yet; staleness belongs to the storage layer (see the script
// wrapper and Track D's publish flow).
export function compareTranslation(af, en) {
  const issues = [];

  function checkHtmlPair(name, a, e) {
    /* moved verbatim, pushing into issues */
  }

  if (en.id !== af.id) issues.push(`id mismatch: ${en.id} != ${af.id}`);
  if (en.slug !== af.slug) issues.push(`slug mismatch`);
  if (!en.title?.trim()) issues.push("empty title");
  if (typeof af.excerpt === "string" && !en.excerpt?.trim()) issues.push("empty excerpt");
  if (!en.seo?.title?.trim()) issues.push("empty seo.title");
  checkHtmlPair("html", af.html, en.html);
  /* recipe block moved verbatim */
  return issues;
}
```

Rewrite `scripts/check-translation.mjs` as the wrapper: keep `checkTranslation(ref)` reading both files (same missing/fail mapping as today), then:

```js
const issues = compareTranslation(af, en);
if (en.sourceHash !== sourceHashOf(af)) {
  issues.push(`sourceHash mismatch: expected ${sourceHashOf(af)}`);
}
return { status: issues.length ? "fail" : "ok", issues };
```

CLI block unchanged. `check-all-translations.mjs` needs no change.

- [ ] **Step 4: Run tests + end-to-end checker**

Run: `npm test && npm run check:translations`
Expected: all tests pass; `399 items: 399 ok, 0 missing, 0 failed`.

- [ ] **Step 5: Lint, type-check, commit**

```bash
npx eslint src/lib/translation-check.mjs scripts/check-translation.mjs tests/translation-check.test.ts --fix && npx tsc --noEmit
git add src/lib/translation-check.mjs scripts/check-translation.mjs tests/translation-check.test.ts
git commit -m "Extract pure translation comparator for harness and Worker reuse"
```

---

### Task 4: Canonical translation prompt + builder

**Files:**
- Create: `server/prompts/translate-en.md`
- Create: `src/lib/translate-prompt.ts`
- Test: `tests/translate-prompt.test.ts`

**Interfaces:**
- Consumes: the en style guide exists at `content/style-guide.en.md` (Task 2); the comparator's rules (Task 3) define the output contract.
- Produces: the single committed prompt template with `{{STYLE_GUIDE}}` and `{{SOURCE_JSON}}` placeholders; `buildTranslatePrompt({ styleGuide, sourceJson }): string` from `@/lib/translate-prompt`. Consumers: regression harness (Task 5), CI safety net (future), Track D Worker.

- [ ] **Step 1: Write the failing test**

```ts
// tests/translate-prompt.test.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTranslatePrompt } from "@/lib/translate-prompt";

describe("buildTranslatePrompt", () => {
  it("substitutes both placeholders and leaves none behind", async () => {
    const template = await readFile(
      join(process.cwd(), "server", "prompts", "translate-en.md"),
      "utf8",
    );
    const prompt = buildTranslatePrompt({
      template,
      styleGuide: "STYLE_MARKER",
      sourceJson: '{"slug":"SOURCE_MARKER"}',
    });
    expect(prompt).toContain("STYLE_MARKER");
    expect(prompt).toContain("SOURCE_MARKER");
    expect(prompt).not.toContain("{{STYLE_GUIDE}}");
    expect(prompt).not.toContain("{{SOURCE_JSON}}");
  });

  it("the committed template states the full output contract", async () => {
    const template = await readFile(
      join(process.cwd(), "server", "prompts", "translate-en.md"),
      "utf8",
    );
    for (const marker of [
      "{{STYLE_GUIDE}}",
      "{{SOURCE_JSON}}",
      "sourceHash",
      "details",
      "tag structure",
      "copied unchanged",
    ]) {
      expect(template).toContain(marker);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — FAIL: module/file not found.

- [ ] **Step 3: Implement the builder**

```ts
// src/lib/translate-prompt.ts
export function buildTranslatePrompt(input: {
  template: string;
  styleGuide: string;
  sourceJson: string;
}): string {
  return input.template
    .replaceAll("{{STYLE_GUIDE}}", input.styleGuide)
    .replaceAll("{{SOURCE_JSON}}", input.sourceJson);
}
```

- [ ] **Step 4: Author the prompt template**

`server/prompts/translate-en.md` — this is a judgment artifact; requirements it MUST meet (review-enforced):

1. Header comment: this is the single canonical translation prompt (loaded by the Worker, the CI safety net, and the regression harness); edit here only.
2. Role framing: translator for Marinda Kook, Afrikaans → English, voice per the style guide.
3. `{{STYLE_GUIDE}}` inclusion point (the en style guide is inserted verbatim).
4. Input: `{{SOURCE_JSON}}` — the full Afrikaans post JSON.
5. **Output contract, stated as hard rules that mirror `compareTranslation` exactly:** respond with ONLY a JSON object (no fences, no commentary) with keys `id`, `slug`, `sourceHash`, `title`, `excerpt`, `seo`, `html`, and `recipe` when the source has one; `id`/`slug` copied unchanged; `sourceHash` copied as the empty string `""` (the caller stamps it — never invent); translate text only inside `html` — every tag, attribute, and their order preserved (tag structure is validated mechanically); `recipe.details` and `recipe.image` copied byte-for-byte unchanged ("copied unchanged"); ingredient/direction group and item counts preserved exactly; `seo.title` non-empty (convention `<Title> - Marinda Kook`); `excerpt` non-empty when the source's is.
6. Terminology anchors: 8–12 fixed af→en term mappings mined from the corpus (e.g. bestanddele→ingredients, metode→method, eetlepel/teelepel abbreviations, oond→oven temperatures style) — pick real ones by inspecting a few translation pairs.
7. One complete worked micro-example: a 5-line af source fragment and its correct en output fragment (NOT a whole post — keep the template under ~150 lines excluding the style guide placeholder).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — PASS.

- [ ] **Step 6: Lint, type-check, commit**

```bash
npx eslint src/lib/translate-prompt.ts tests/translate-prompt.test.ts --fix && npx tsc --noEmit
git add server/prompts/translate-en.md src/lib/translate-prompt.ts tests/translate-prompt.test.ts
git commit -m "Add canonical translation prompt template and builder"
```

---

### Task 5: Translation regression harness

**Files:**
- Create: `scripts/translation-regression.mjs`
- Modify: `package.json` (script `regress:translations`)
- Test: `tests/translation-regression.test.ts` (offline parts only)

**Interfaces:**
- Consumes: `buildTranslatePrompt` (Task 4), `compareTranslation` (Task 3), `content/style-guide.en.md`, `server/prompts/translate-en.md`.
- Produces: `npm run regress:translations [-- --slugs a,b,c] [--model id]` — re-translates sample posts through the committed prompt via the Anthropic API and scores each with the structural comparator. Exported for testing: `parseModelJson(text)`, `scoreCandidate(af, candidate)`.

- [ ] **Step 1: Write the failing tests (offline logic only — no API calls in tests)**

```ts
// tests/translation-regression.test.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- untyped .mjs module (delete directive if unused)
import { parseModelJson, scoreCandidate } from "../scripts/translation-regression.mjs";

describe("translation regression harness (offline)", () => {
  it("parseModelJson tolerates code fences and leading prose", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Here is the JSON:\n{"a":1}')).toEqual({ a: 1 });
    expect(() => parseModelJson("no json here")).toThrow();
  });

  it("scoreCandidate passes the committed translation and fails a mutation", async () => {
    const CONTENT = join(process.cwd(), "content");
    const af = JSON.parse(
      await readFile(join(CONTENT, "posts", "lemoen-stroopkoek.json"), "utf8"),
    );
    const en = JSON.parse(
      await readFile(
        join(CONTENT, "translations", "en", "posts", "lemoen-stroopkoek.json"),
        "utf8",
      ),
    );
    expect(scoreCandidate(af, en).pass).toBe(true);
    const bad = structuredClone(en);
    bad.recipe.ingredientGroups[0].items.pop();
    const scored = scoreCandidate(af, bad);
    expect(scored.pass).toBe(false);
    expect(scored.issues.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npm test`, module not found.

- [ ] **Step 3: Implement the harness**

```js
// scripts/translation-regression.mjs
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { compareTranslation } from "../src/lib/translation-check.mjs";
import { buildTranslatePrompt } from "../src/lib/translate-prompt.ts";

const DEFAULT_SLUGS = [
  "lemoen-stroopkoek",
  "3-bestandele-piesangbrood-tog-te-lekker",
  "pampoenpoffertjies-wat-die-sous-opsuig",
  "spekko-dahl-kerrie-met-krispie-uie",
  "skons-net-3-bestandele",
];

export function parseModelJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

export function scoreCandidate(af, candidate) {
  const issues = compareTranslation(af, candidate);
  return { pass: issues.length === 0, issues };
}

async function translate(af, apiKey, model) {
  const [template, styleGuide] = await Promise.all([
    readFile(new URL("../server/prompts/translate-en.md", import.meta.url), "utf8"),
    readFile(new URL("../content/style-guide.en.md", import.meta.url), "utf8"),
  ]);
  const prompt = buildTranslatePrompt({
    template,
    styleGuide,
    sourceJson: JSON.stringify(af),
  });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 32000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseModelJson(data.content.map((b) => b.text ?? "").join(""));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { values } = parseArgs({
    options: {
      slugs: { type: "string" },
      model: { type: "string", default: "claude-sonnet-5" },
    },
  });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set. The harness makes real API calls; set the key and re-run.",
    );
    process.exit(2);
  }
  const slugs = values.slugs ? values.slugs.split(",") : DEFAULT_SLUGS;
  let failed = 0;
  for (const slug of slugs) {
    const af = JSON.parse(
      await readFile(new URL(`../content/posts/${slug}.json`, import.meta.url), "utf8"),
    );
    try {
      const candidate = await translate(af, apiKey, values.model);
      const { pass, issues } = scoreCandidate(af, candidate);
      if (pass) {
        console.log(`PASS ${slug}`);
      } else {
        failed++;
        console.log(`FAIL ${slug}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
      }
    } catch (err) {
      failed++;
      console.log(`ERROR ${slug}: ${err.message}`);
    }
  }
  console.log(`\n${slugs.length} sampled, ${slugs.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
```

Verify the five DEFAULT_SLUGS exist in `content/posts/` (`ls` them); replace any that don't with real recipe-post slugs.

- [ ] **Step 4: Wire the npm script**

```json
"regress:translations": "tsx scripts/translation-regression.mjs",
```

- [ ] **Step 5: Run tests + the no-key path**

Run: `npm test` — offline tests pass.
Run: `npm run regress:translations` (without a key) — prints the ANTHROPIC_API_KEY message, exit code 2. Do NOT run with a real key in this task.

- [ ] **Step 6: Lint, type-check, commit**

```bash
npx eslint scripts/translation-regression.mjs tests/translation-regression.test.ts --fix && npx tsc --noEmit
git add scripts/translation-regression.mjs tests/translation-regression.test.ts package.json
git commit -m "Add translation regression harness scored by the structural comparator"
```

---

### Task 6: Site-chrome English translation file

**Files:**
- Modify: `src/lib/content-schema.ts` (add `siteTranslationSchema`, `SiteStrings`)
- Modify: `src/lib/source-hash.ts` (add `siteChromeHashOf` — new contract, distinct function)
- Create: `content/translations/en/site.json` (seeded from today's `enSiteStrings`)
- Modify: `src/lib/i18n.ts` (delete `enSiteStrings`/`localizeSiteStrings`; parameterize the two localize helpers)
- Modify: `src/lib/content.ts` (add `getSiteStrings(locale)`)
- Modify: call sites: `src/components/chrome/SiteHeader.tsx`, `src/components/widgets/Sidebar.tsx`, `src/views/HomeView.tsx`, `src/lib/router.tsx`
- Modify: `scripts/check-all-translations.mjs` (site line), `scripts/validate-content.mjs` (structural check)
- Test: `tests/content-schema.test.ts`, `tests/source-hash.test.ts` additions

**Interfaces:**
- Consumes: Track A's schema module, `sourceHashOf`'s sha1 pattern.
- Produces: `siteTranslationSchema` + `type SiteStrings` (translation minus `sourceHash`) from `@/lib/content-schema`; `siteChromeHashOf(site): string` from `@/lib/source-hash`; `getSiteStrings(locale): Promise<SiteStrings | null>` from `@/lib/content`; `localizeNav(items, strings)` and `localizeWidgetTitle(title, strings)` now take `SiteStrings | null` instead of `Locale`. Track D's `update_site_config`/`generate_translation` will regenerate the file and restamp the hash.

- [ ] **Step 1: Write the failing tests**

Append to `tests/content-schema.test.ts`:

```ts
describe("site translation contract", () => {
  it("parses content/translations/en/site.json", async () => {
    const result = siteTranslationSchema.safeParse(
      await readJson("translations", "en", "site.json"),
    );
    expect(result.success, result.error?.message).toBe(true);
  });
});
```

Append to `tests/source-hash.test.ts`:

```ts
describe("siteChromeHashOf", () => {
  it("matches the seeded site translation's stored hash", async () => {
    const site = siteSchema.parse(await readJson("site.json"));
    const translation = await readJson("translations", "en", "site.json");
    expect(siteChromeHashOf(site)).toBe(translation.sourceHash);
  });
});
```

(Add `siteSchema` to the `@/lib/content-schema` import and `siteChromeHashOf` to the `@/lib/source-hash` import. Parsing with `siteSchema` matters: the parsed `Site` type satisfies `SiteChromeSource` structurally, whereas the raw `Record<string, unknown>` from the file's `readJson` helper cannot satisfy its nested shape — and `as` assertions are banned. Reading the translation with the existing helper is fine: `.sourceHash` resolves via the index signature.)

- [ ] **Step 2: Run tests to verify they fail** — missing exports/file.

- [ ] **Step 3: Implement the hash (new contract — exact basis)**

Append to `src/lib/source-hash.ts`:

```ts
// Chrome-translation staleness hash — a NEW contract separate from
// sourceHashOf. Basis = every site.json field the en chrome translation
// covers, in this fixed shape. Changing it invalidates the stored hash in
// content/translations/en/site.json (regenerate the seed if you must).
export interface SiteChromeSource {
  tagline: unknown;
  nav: unknown;
  bio: { about: unknown; button: { label: unknown } };
  sidebar: {
    tabs: { views: unknown; comments: unknown };
    featurePosts: { title: unknown };
    socialWidget: { title: unknown; description: unknown };
    categoriesWidget: { title: unknown };
  };
  home: { sectionTitle: unknown; readMore: unknown };
  newsletter: { heading: unknown; placeholder: unknown; button: unknown };
}

export function siteChromeHashOf(site: SiteChromeSource): string {
  const basis = JSON.stringify({
    tagline: site.tagline,
    nav: site.nav,
    bioAbout: site.bio.about,
    bioButton: site.bio.button.label,
    widgets: [
      site.sidebar.tabs.views,
      site.sidebar.tabs.comments,
      site.sidebar.featurePosts.title,
      site.sidebar.socialWidget.title,
      site.sidebar.socialWidget.description,
      site.sidebar.categoriesWidget.title,
      site.home.sectionTitle,
      site.home.readMore,
    ],
    newsletter: {
      heading: site.newsletter.heading,
      placeholder: site.newsletter.placeholder,
      button: site.newsletter.button,
    },
  });
  return createHash("sha1").update(basis).digest("hex");
}
```

- [ ] **Step 4: Add the schema**

Append to `src/lib/content-schema.ts`:

```ts
export const siteTranslationSchema = z.strictObject({
  sourceHash: z.string(),
  tagline: z.string(),
  nav: z.record(z.string(), z.string()),
  widgets: z.record(z.string(), z.string()),
  bioAbout: z.string(),
  socialDescription: z.string(),
  newsletter: z.strictObject({
    heading: z.string(),
    placeholder: z.string(),
    button: z.string(),
  }),
});

export type SiteTranslation = z.infer<typeof siteTranslationSchema>;
export type SiteStrings = Omit<SiteTranslation, "sourceHash">;
```

- [ ] **Step 5: Seed the translation file**

One-off script (values copied EXACTLY from the current `enSiteStrings` in `src/lib/i18n.ts` — nav map, widgets map, bioAbout, socialDescription, newsletter, tagline) with the computed hash, written with the repo convention:

```bash
npx tsx -e '
import { readFileSync, writeFileSync } from "node:fs";
import { siteChromeHashOf } from "./src/lib/source-hash.ts";
const site = JSON.parse(readFileSync("content/site.json", "utf8"));
const seed = {
  sourceHash: siteChromeHashOf(site),
  tagline: "Easy South African Recipes",
  nav: { /* copy the full nav map from i18n.ts verbatim */ },
  widgets: { /* copy the full widgets map from i18n.ts verbatim */ },
  bioAbout: /* copy verbatim */,
  socialDescription: /* copy verbatim */,
  newsletter: { heading: "Newsletter", placeholder: "Email address", button: "Sign Up" },
};
writeFileSync("content/translations/en/site.json", JSON.stringify(seed, null, 1));
'
```

(Write the actual literal values into the script — read `src/lib/i18n.ts:88-125` first; the placeholders above are for plan brevity only, the executed script must contain the real strings.)

- [ ] **Step 6: Refactor i18n + loaders + call sites**

`src/lib/i18n.ts`: delete `enSiteStrings` and `localizeSiteStrings`; change:

```ts
import type { Locale, NavItem, SiteStrings, Term } from "./content-schema";

export function localizeNav(items: NavItem[], strings: SiteStrings | null): NavItem[] {
  if (!strings) return items;
  return items.map((item) => ({ ...item, label: strings.nav[item.path] ?? item.label }));
}

export function localizeWidgetTitle(title: string, strings: SiteStrings | null): string {
  if (!strings) return title;
  return strings.widgets[title.trim()] ?? title;
}
```

`src/lib/content.ts`: add (import `siteTranslationSchema`, `SiteStrings` type, and `siteChromeHashOf`):

```ts
export const getSiteStrings = cache(async (locale: Locale): Promise<SiteStrings | null> => {
  if (locale === "af") return null;
  let raw: unknown;
  try {
    raw = await readJson("translations", "en", "site.json");
  } catch {
    return null;
  }
  const { sourceHash, ...strings } = siteTranslationSchema.parse(raw);
  // Stale chrome translation falls back to Afrikaans, same policy as posts.
  if (sourceHash !== siteChromeHashOf(await getSite())) return null;
  return strings;
});
```

Call sites — each currently computes `const en = localizeSiteStrings(locale)` and/or passes `locale` to the two helpers. Update all four files (`SiteHeader.tsx`, `Sidebar.tsx`, `HomeView.tsx`, `router.tsx`): fetch `const strings = await getSiteStrings(locale)` alongside their existing parallel loads, replace `en` with `strings` (same field names: `bioAbout`, `socialDescription`, `newsletter`, `tagline`), and pass `strings` instead of `locale` to `localizeNav`/`localizeWidgetTitle`. Preserve every existing fallback (`?? site.…`) exactly.

- [ ] **Step 7: Extend the checkers**

`scripts/check-all-translations.mjs` — before the refs loop, add:

```js
import { siteChromeHashOf } from "../src/lib/source-hash.ts";

const site = JSON.parse(
  await readFile(new URL("../content/site.json", import.meta.url), "utf8"),
);
let siteStatus = "ok";
try {
  const t = JSON.parse(
    await readFile(new URL("../content/translations/en/site.json", import.meta.url), "utf8"),
  );
  if (t.sourceHash !== siteChromeHashOf(site)) siteStatus = "stale";
} catch {
  siteStatus = "missing";
}
if (siteStatus !== "ok") console.log(`${siteStatus.toUpperCase()} site chrome`);
```

Include it in the summary line and exit code (`site chrome: ok|stale|missing`; non-ok sets `process.exitCode = 1`). Add `readFile` to the imports.

`scripts/validate-content.mjs` — after the site.json parse, add a structural check of `translations/en/site.json` when present (parse with `siteTranslationSchema`, push zod issues; absence is NOT an issue — staleness/missing is `check:translations`' domain).

- [ ] **Step 8: Full verification**

```bash
npm test && npm run check:translations && npm run validate:content && npm run build
find out -name index.html | wc -l
grep -c "Most Popular" out/en/index.html
grep -c "Easy South African Recipes" out/en/index.html
grep -c "Gewildste" out/index.html
```

Expected: tests green; checker reports `399 ok` + `site chrome: ok`; 1692 pages; each grep ≥1 (en chrome still English via the new file, af chrome untouched).

- [ ] **Step 9: Lint, type-check, commit**

```bash
npx eslint src scripts/check-all-translations.mjs scripts/validate-content.mjs --fix && npx tsc --noEmit
git add -A -- src scripts tests content/translations/en/site.json
git commit -m "Move site chrome English strings into a sourceHash-tracked translation file"
```
