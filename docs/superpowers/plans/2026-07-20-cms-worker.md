# CMS Worker (Track D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the Cloudflare Worker that lets Marinda author recipes by chatting with Claude — an MCP connector exposing interview/edit/publish tools, an upload page, a preview/approval page, OAuth login, and a git-commit publish pipeline — fully tested against local infrastructure and ready to deploy once provisioned.

**Architecture:** A single Worker under `server/`. A pure **core** (draft store, slug/id allocation, GitHub commit builder, translation job, error taxonomy) that imports the repo's existing pure modules (`src/lib/source-hash.ts`, `translation-check.mjs`, `translate-prompt.ts`, `content-schema.ts`, `content-derive.ts`). An **MCP layer** (tool registry, protocol text) over the core. Two **HTML pages** (upload, preview) served by the Worker. **OAuth** via `@cloudflare/workers-oauth-provider`. State in **KV** (drafts, job progress, approval flags, page↔chat handoff) and **R2** (staged photos). Publishing builds a commit via the **GitHub App** REST API.

**Tech Stack:** Cloudflare Workers (`wrangler`), `@modelcontextprotocol/sdk`, `@cloudflare/workers-oauth-provider`, `zod` v4 (+ `zod-to-json-schema` path or zod v4 native `toJSONSchema`), `@cloudflare/vitest-pool-workers` (runs tests inside workerd with real KV/R2 bindings — **no Cloudflare account needed**), Playwright (upload page). Node/tsx for the CI rendition script.

**Spec:** Track D of `docs/superpowers/specs/2026-07-20-chat-cms-design.md` (MCP tools, interview, photos, translation, preview, auth, publish pipeline, error handling, testing sections).

## Global Constraints

- **Two go-live gates (out of this plan's scope, documented in D11):** provisioning (Cloudflare/GitHub App/Anthropic/OAuth secrets — the user does this) and Track C (media in git — required before a real publish). This plan builds and tests the Worker; it does NOT deploy it or wire it to the live `main` for real publishes.
- **Reuse, don't reimplement:** the Worker imports `sourceHashOf`, `siteChromeHashOf` (`src/lib/source-hash.ts`), `compareTranslation` (`src/lib/translation-check.mjs`), `buildTranslatePrompt` (`src/lib/translate-prompt.ts`), the zod schemas (`src/lib/content-schema.ts`), and `derivePostIndex` (`src/lib/content-derive.ts`). Never fork these. The published post JSON must satisfy `postSchema` and reproduce under `sourceHashOf` exactly (the CI safety net checks it).
- **All model-facing text — tool responses, validation errors, both web pages — is Afrikaans.** Error messages are actionable (which field, why, what to do).
- Content the Worker commits uses `JSON.stringify(data, null, 1)` with **no trailing newline** (the repo convention) so chat-authored and hand-edited files diff cleanly.
- Slugs, ids, dates, media paths per spec: server-generated slug (lowercase, diacritics-stripped, hyphenated) checked against posts + page slugs + reserved segments (`category`, `tag`, `page`, `search`, `en`) + open drafts; numeric id = max existing + 1; `date` = publish time, `modified` bumped on update; `commentStatus: "closed"`, `comments: []`; media under `public/media/uploads/<year>/<month>/` with deterministic `-WxH` rendition paths (card 760×760, portrait 760×990, thumb 150×150).
- **Publish is create-only** for new posts (assert path absent from base tree, fail loudly otherwise); only `update_post` writes an existing slug and must pass the file's current blob SHA. **Idempotent:** before committing, check whether HEAD already contains this draft's publish via a `Draft-Id: <id>` commit trailer; media paths derive deterministically so a retried commit is byte-identical; delete staged R2 photos only after the git-state check confirms success.
- No `as` assertions; TypeScript strict; no barrel files; comments only where genuinely unusual. Worker code is TypeScript (`.ts`), ES modules, `export default { fetch }`.
- Each task: `npm test` (or the worker-scoped test command) green before commit; the repo root `npm test`, `npm run build`, `npm run check:translations`, `npm run validate:content` must all stay green (the Worker lives in `server/` and must not break the site build).
- Secrets are read from the Worker `env` binding; tests use fakes. Never hardcode a secret, never attempt to provision or deploy.
- Do NOT push during task work; the controller pushes after the whole-branch review.

## File Structure

```
server/
  wrangler.toml            # config only (bindings, no account id committed)
  package.json             # worker deps + test script
  tsconfig.json
  vitest.config.ts         # @cloudflare/vitest-pool-workers
  prompts/
    translate-en.md        # (exists — Track B)
    interview-af.md         # NEW: the authoritative interview protocol text
  src/
    index.ts               # Worker entry: OAuth + MCP + pages routing
    env.d.ts               # Env bindings type
    core/
      draft-schema.ts      # zod: DraftPost (partial Post + interview state), ChromeDraft
      slug.ts              # slugify + collision resolution
      ids.ts               # id/term-id allocation
      github.ts            # GitHub App JWT/token + tree/commit/publish/idempotency
      translation-job.ts   # async translate + validate + retry + PR fallback
      errors.ts            # transient/terminal taxonomy + Joshua alert
      store.ts             # DraftStore interface + KV/R2 impl + InMemory impl
    mcp/
      server.ts            # tool registry, protocol text wiring
      tools/*.ts           # one file per tool group
    pages/
      upload.ts            # upload page HTML + POST handler
      preview.ts           # preview/approval page HTML
      auth.ts              # login page
  test/
    *.test.ts              # workerd-pool tests
    e2e/upload.spec.ts     # Playwright
scripts/
  materialize-renditions.mjs  # NEW (CI): sharp crops from -WxH paths in post JSON
```

---

### Task 1: Worker scaffold + draft schema + slug/id core

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/wrangler.toml`, `server/vitest.config.ts`, `server/src/env.d.ts`
- Create: `server/src/core/draft-schema.ts`, `server/src/core/slug.ts`, `server/src/core/ids.ts`
- Test: `server/test/slug.test.ts`, `server/test/ids.test.ts`, `server/test/draft-schema.test.ts`

**Interfaces:**
- Produces: `draftPostSchema`, `chromeDraftSchema`, types `DraftPost`, `ChromeDraft` from `core/draft-schema`; `slugify(title: string): string` and `resolveSlug(base: string, taken: Set<string>): string` from `core/slug`; `nextPostId(existing: number[]): number`, `nextTermId(existing: number[]): number` from `core/ids`. All pure. Consumed by every later task.

- [ ] **Step 1: Scaffold the Worker package** (do NOT run `wrangler deploy`; config only)

`server/package.json` — `"type": "module"`, deps: `@modelcontextprotocol/sdk`, `@cloudflare/workers-oauth-provider`, `zod` (match the root's zod version), devDeps: `wrangler`, `@cloudflare/vitest-pool-workers`, `vitest`, `typescript`, `@playwright/test`. Scripts: `"test": "vitest run"`, `"test:e2e": "playwright test"`, `"typecheck": "tsc --noEmit"`. Install with `npm install --prefix server`.

`server/wrangler.toml` — `name = "marindakook-cms"`, `main = "src/index.ts"`, `compatibility_date` (recent), `compatibility_flags = ["nodejs_compat"]`, and commented-out binding stubs for `[[kv_namespaces]]` (DRAFTS), `[[r2_buckets]]` (PHOTOS), and `[vars]`/secrets documented in D11. NO `account_id` (that's per-user provisioning).

`server/vitest.config.ts` — use `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`, pointing at `wrangler.toml`, with miniflare KV+R2 bindings for tests.

`server/tsconfig.json` — strict, `"types": ["@cloudflare/workers-types"]`, module `esnext`, moduleResolution `bundler`, path alias `@site/*` → `../src/*` so the Worker can import the repo's pure modules.

- [ ] **Step 2: Write failing slug tests**

```ts
// server/test/slug.test.ts
import { describe, expect, it } from "vitest";
import { slugify, resolveSlug } from "../src/core/slug";

describe("slugify", () => {
  it("lowercases, strips diacritics, hyphenates (matches the WP convention)", () => {
    expect(slugify("Lemoen Stroopkoek")).toBe("lemoen-stroopkoek");
    expect(slugify("Kategorieë & Poffertjies!")).toBe("kategoriee-poffertjies");
    expect(slugify("  3 Bestanddele  ")).toBe("3-bestanddele");
  });
});

describe("resolveSlug", () => {
  it("returns the base when free", () => {
    expect(resolveSlug("piesangbrood", new Set())).toBe("piesangbrood");
  });
  it("suffixes -2, -3 on collision (matches legacy boontjiebredie-2 pattern)", () => {
    expect(resolveSlug("piesangbrood", new Set(["piesangbrood"]))).toBe("piesangbrood-2");
    expect(resolveSlug("piesangbrood", new Set(["piesangbrood", "piesangbrood-2"]))).toBe(
      "piesangbrood-3",
    );
  });
  it("treats reserved segments as taken", () => {
    expect(resolveSlug("category", new Set(["category"]))).toBe("category-2");
  });
});
```

- [ ] **Step 3: Run, confirm failure** (`npm test --prefix server` → module not found).

- [ ] **Step 4: Implement `slug.ts`** — `slugify` uses `String.prototype.normalize("NFKD")` + strip combining marks + lowercase + non-alphanumeric→hyphen + collapse/trim hyphens. `resolveSlug` appends `-2`, `-3`… until free.

- [ ] **Step 5: Write + implement `ids.ts`** — test that `nextPostId([7621, 5236, 1])` is `7622`, `nextPostId([])` is `1`; `nextTermId` identical logic. Implement as `Math.max(0, ...existing) + 1`.

- [ ] **Step 6: Write + implement `draft-schema.ts`** — `draftPostSchema` = a **partial** `postSchema` shape (every field optional except an internal `draftId: string`, `kind: "post"`, `createdAt`/`updatedAt` strings) PLUS an `interview` object `{ settled: string[]; pending: string[]; latestProse?: string; heroPhoto?: string; featured: boolean }`. `chromeDraftSchema` = `{ draftId, kind: "chrome", site: <partial site chrome fields>, updatedAt }`. Test: a minimal partial draft (just title) parses; a draft with an unknown top-level key fails (strict). Do NOT import `postSchema` and `.partial()` blindly — author the draft shape explicitly so a half-finished interview is valid but publish-time completeness is enforced later (Task 6), and document that split in a comment.

- [ ] **Step 7: Verify + lint + typecheck + commit**

```bash
npm test --prefix server && npm run typecheck --prefix server
git add server/package.json server/package-lock.json server/tsconfig.json server/wrangler.toml server/vitest.config.ts server/src/env.d.ts server/src/core/draft-schema.ts server/src/core/slug.ts server/src/core/ids.ts server/test/
git commit -m "Scaffold CMS Worker: draft schema, slug and id allocation"
```

---

### Task 2: GitHub App client (JWT, tokens, commit builder, idempotency)

**Files:**
- Create: `server/src/core/github.ts`
- Test: `server/test/github.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure over `fetch` + WebCrypto).
- Produces: `class GitHubApp` with `constructor(cfg: { appId, installationId, privateKeyPkcs8Pem, owner, repo, fetch })`; methods `installationToken(): Promise<string>`, `getBaseTree(ref): Promise<{ treeSha, commitSha }>`, `pathExists(path, ref): Promise<{ exists: boolean; sha?: string }>`, `commitFiles(input): Promise<{ commitSha, superseded: boolean }>` where input carries `{ files: {path, content}[], message, draftId, requireAbsent?: string[], expectShas?: Record<path,sha> }` and embeds a `Draft-Id: <draftId>` trailer, `findDraftCommit(draftId, ref): Promise<string | null>` (scans recent commits touching content for the trailer — the idempotency check), `openPullRequest(input): Promise<{ number, url }>`, `latestRunForSha(sha): Promise<{ status, conclusion, url } | null>` (Actions API). All HTTP via the injected `fetch` so tests mock it.

- [ ] **Step 1: Write failing tests with a mocked fetch**

Cover: (a) `installationToken` posts a signed JWT (assert the Authorization header is `Bearer <jwt>` with three base64url segments and the request hits `/app/installations/<id>/access_tokens`); mock returns `{token, expires_at}`; (b) `commitFiles` create-only path calls the blob/tree/commit/ref-update sequence and includes the `Draft-Id:` trailer in the commit message body; (c) `commitFiles` with a `requireAbsent` path that the mocked tree already contains throws a create-collision error; (d) `findDraftCommit` returns the SHA when a recent commit's message contains the trailer, else null. Use a fake RSA PKCS#8 key generated in-test via `crypto.subtle.generateKey` + export to PKCS#8 PEM, so signing runs for real in workerd.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Implement `github.ts`.** JWT: import the PKCS#8 PEM via `crypto.subtle.importKey("pkcs8", …, {name:"RSASSA-PKCS1-v1_5", hash:"SHA-256"}, false, ["sign"])`, sign `header.payload` (base64url), `iss = appId`, `iat/exp` from a caller-passed `now` (do NOT call `Date.now()` inside pure-ish signing paths without allowing injection — accept a `now` param defaulting to `Date.now()` so tests are deterministic). Installation token: POST with the JWT. Commit: standard blobs→tree(base_tree)→commit(parents:[headSha], message+trailer)→PATCH ref. Create-only: fetch base tree, assert each `requireAbsent` path missing. Idempotency: `findDraftCommit` lists commits on the ref and greps messages. PR: POST `/pulls`. Actions: GET `/actions/runs?head_sha=`.

- [ ] **Step 4: Verify + commit** (`git commit -m "Add GitHub App client: token minting, commit builder, idempotency"`).

---

### Task 3: Draft store + R2/KV abstractions

**Files:**
- Create: `server/src/core/store.ts`
- Test: `server/test/store.test.ts`

**Interfaces:**
- Consumes: `DraftPost`, `ChromeDraft` (Task 1).
- Produces: `interface DraftStore` with `get/put/list/delete` for drafts, `putPhoto/listPhotos/deletePhoto` (R2), `setApproval/getApproval` (approved_at per draft revision), `setJob/getJob` (translation job state), `setUploadManifest/getUploadManifest` (page↔chat handoff). `class KvR2Store implements DraftStore` (constructor takes `{ kv: KVNamespace, r2: R2Bucket }`) and `class InMemoryStore implements DraftStore` for tests. A draft's `revision` (content hash) invalidates approval + translation staleness together.

- [ ] **Step 1: Write failing tests** exercising the store contract against `InMemoryStore` AND against `KvR2Store` bound to the workerd-pool KV/R2 (both must pass the same suite — parametrize). Assert: put/get/list/delete round-trip; a content change bumps `revision` and clears a prior approval; photo bytes round-trip through R2.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement both stores.** KV keys namespaced (`draft:<id>`, `job:<id>`, `approval:<id>`, `uploads:<id>`); photos in R2 under `staged/<draftId>/<filename>`.

- [ ] **Step 4: Verify + commit** (`"Add draft/photo store with KV/R2 and in-memory implementations"`).

---

### Task 4: MCP server core + interview/draft tools

**Files:**
- Create: `server/prompts/interview-af.md`, `server/src/mcp/server.ts`, `server/src/mcp/tools/drafts.ts`, `server/src/mcp/tools/voice.ts`
- Test: `server/test/mcp-drafts.test.ts`

**Interfaces:**
- Consumes: store (Task 3), draft schema + slug/id (Task 1).
- Produces: `createMcpServer(deps): McpServer` wiring the tool registry; the draft tools `begin_draft`, `list_drafts`, `resume_draft`, `discard_draft`, `save_draft`; voice tools `get_style_guide`, `get_similar_posts`. Tool input schemas generated from zod. All responses Afrikaans.

- [ ] **Step 1: Author `interview-af.md`** — the authoritative protocol per spec §198-209: Afrikaans only; one question at a time; offer skryfhulp on note-form input; never invent quantities; confirm categories against the term list with `featured`/`uncategorised`/`eenhede` filtered out; ask "Moet hierdie resep op die voorblad wys?"; the required-fields checklist. Header: this is the authoritative copy; `begin_draft`/`resume_draft` return it verbatim.

- [ ] **Step 2: Write failing MCP integration test** using the SDK's in-memory transport (`InMemoryTransport.createLinkedPair()`), a client connected to `createMcpServer({ store: InMemoryStore, … })`. Assert: `begin_draft` response **contains the interview protocol text** (a distinctive sentence from `interview-af.md`); `save_draft` with a partial `{title}` succeeds and `list_drafts` then shows it; `save_draft` with an invalid field returns an Afrikaans error naming the field; `resume_draft` returns the protocol text + the settled state; `begin_draft` surfaces a near-duplicate existing post when the title matches one. Load `content/posts-index.json`-equivalent via `derivePostIndex` over a small fixture, or inject a fixture index.

- [ ] **Step 3: Run, confirm failure. Step 4: Implement.** `get_similar_posts` scores by shared category/tag + title-keyword overlap over the injected post index. `get_style_guide` returns the committed `content/style-guide.af.md`/`.en.md` (injected as deps so the Worker can bundle them). Tool input schemas: convert the zod schemas (zod v4 `z.toJSONSchema` or the SDK's zod support).

- [ ] **Step 5: Verify + commit** (`"Add MCP server core with interview and draft tools"`).

---

### Task 5: Photo + async translation tools

**Files:**
- Create: `server/src/core/translation-job.ts`, `server/src/mcp/tools/photos.ts`, `server/src/mcp/tools/translation.ts`
- Test: `server/test/translation-job.test.ts`, `server/test/mcp-translation.test.ts`

**Interfaces:**
- Consumes: store (Task 3), `buildTranslatePrompt` + `compareTranslation` + `sourceHashOf` (repo modules), the committed prompt + en style guide.
- Produces: `runTranslationJob(deps, draftId): Promise<void>` (idempotent per draft+sourceHash; writes progress/result to the store; ≤3 validator-feedback retries; on exhaustion records a "failing" result for the PR fallback); MCP tools `request_photo_upload` (returns a signed upload-page link), `check_uploads` (returns the staged manifest), `generate_translation` (starts the job via `ctx.waitUntil`, returns immediately), `check_translation_status`.

- [ ] **Step 1: Write failing tests.** `translation-job`: with a mocked Anthropic `fetch` returning a good translation, the job stores a passing result whose `sourceHash === sourceHashOf(af)`; with a mocked response that fails `compareTranslation`, it retries up to 3× (assert call count) then records a failing result; a second call with the same draft+sourceHash reuses the stored result (no new API call). MCP: `generate_translation` returns the "vertaling word gemaak" message immediately; `check_translation_status` reflects the stored job state; `request_photo_upload` returns a link containing the draft id/signature.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement.** Use `buildTranslatePrompt({template, styleGuide, sourceJson})`, call Anthropic Messages API, `parseModelJson`-style extraction, `compareTranslation(af, candidate)`, stamp `sourceHash = sourceHashOf(af)` on success. `ctx.waitUntil` keeps the job alive past the tool return.

- [ ] **Step 4: Verify + commit** (`"Add photo-upload and async translation tools"`).

---

### Task 6: Edit, chrome, publish, status, delete tools

**Files:**
- Create: `server/src/mcp/tools/edit.ts`, `server/src/mcp/tools/chrome.ts`, `server/src/mcp/tools/publish.ts`
- Modify: `server/src/mcp/server.ts` (register them)
- Test: `server/test/mcp-publish.test.ts`, `server/test/publish-idempotency.test.ts`

**Interfaces:**
- Consumes: everything prior + `GitHubApp` (Task 2), `postSchema`/`siteTranslationSchema`/`siteChromeHashOf` (repo).
- Produces: `find_posts`/`get_post`/`update_post` (`type: post|page`; stale-marks translation, bumps `modified`); `get_site_config`/`update_site_config` (chrome draft type → same publish gate); `publish` (completeness validation via `postSchema`; approval-flag required; create-only or SHA-checked update; pilot-mode PR vs direct commit; idempotency); `check_publish_status` (superseded/pilot semantics); `delete_post` (chat-confirmed, always via PR).

- [ ] **Step 1: Write failing tests (mocked GitHubApp).** `publish`: refuses with the Afrikaans "preview not approved" message until the approval flag is set for the current revision; refuses if `postSchema` completeness fails (naming the missing field); on success (pilot off) calls `commitFiles` create-only with the draft-id trailer and returns the live-URL message; pilot on → calls `openPullRequest` and returns the "gestuur vir Joshua" message. Idempotency: simulate `commitFiles` throwing after the commit lands (mock `findDraftCommit` to return a SHA on retry) → the retry does NOT create a second commit and reports success. `check_publish_status`: a cancelled run whose SHA is covered by a newer successful run reports "superseded", not failure.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement** per spec §226-240, §281-293, §340-358. Completeness: build the full `Post` from the draft (fill server-managed fields: id, slug, date/modified, commentStatus, comments, featured/renditions from the hero + `-WxH` paths) and `postSchema.parse` it; publish commits post JSON + translation + photos (moved from R2) in one commit.

- [ ] **Step 4: Verify + commit** (`"Add edit, chrome, publish, status and delete tools"`).

---

### Task 7: Upload page (canvas re-encode, EXIF strip, R2 staging)

**Files:**
- Create: `server/src/pages/upload.ts`
- Test: `server/test/e2e/upload.spec.ts` (Playwright), `server/test/upload-handler.test.ts`

**Interfaces:**
- Consumes: store (Task 3), signed-link verification (Task 9 provides the verifier; for this task, inject a stub verifier and wire the real one in Task 9).
- Produces: `renderUploadPage(draftId): Response` (mobile-first HTML+JS, Afrikaans) and `handleUploadPost(req, deps): Promise<Response>` (accepts re-encoded JPEGs, stores to R2, updates the KV manifest). Client JS: `<input accept="image/*">` primary, drag-drop enhancement; canvas decode → apply EXIF orientation to pixels → re-encode JPEG ≤2000px → **all metadata stripped incl. GPS** → upload; per-photo delete; ends with "Klaar! Gaan terug na jou gesprek en sê 'klaar'."

- [ ] **Step 1: Playwright test with a rotated HEIC/JPEG fixture** — load the page, upload the fixture, assert the staged object (read back from the test R2 or the handler's response) is JPEG, ≤2000px on its long edge, correctly oriented (pixel check or dimension check), and carries **zero EXIF/GPS** (parse the output bytes — no `Exif`/GPS markers). Include a small committed fixture image with known orientation+GPS under `server/test/fixtures/`.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement.** Unconditional re-encode (even when no downscale needed). Handler validates the signed link (stub now), stores to R2, updates the manifest.

- [ ] **Step 4: Verify + commit** (`"Add mobile-first photo upload page with EXIF-stripping re-encode"`).

---

### Task 8: Preview / approval page

**Files:**
- Create: `server/src/pages/preview.ts`
- Test: `server/test/preview-handler.test.ts`

**Interfaces:**
- Consumes: store, draft, translation result; the site's compiled CSS (bundled).
- Produces: `renderPreviewPage(draftId): Response` (af/en stacked-on-phone / side-by-side-on-tablet; chrome drafts render header/bio/sidebar/footer instead of a recipe card) and `handleApprovePost` (sets the approval flag for the current revision; page shows "Gaan terug na jou gesprek"). Expired/invalid link → friendly Afrikaans page, never a bare 403.

- [ ] **Step 1: Write failing handler tests** — preview renders the draft's title/recipe in both locales; tapping approve sets the approval flag for the current revision; a content change to the draft invalidates the prior approval; an invalid draft id renders the Afrikaans expired-link page (200, not 403).

- [ ] **Step 2: Run, confirm failure. Step 3: Implement** shared lightweight render templates + bundled CSS (import the built `globals.css` or a trimmed copy). Responsive af/en layout.

- [ ] **Step 4: Verify + commit** (`"Add responsive preview and approval page"`).

---

### Task 9: OAuth, signed links, error taxonomy, Worker entry wiring

**Files:**
- Create: `server/src/pages/auth.ts`, `server/src/core/errors.ts`, `server/src/core/links.ts`
- Modify: `server/src/index.ts`, and the upload/preview handlers to use the real link verifier
- Test: `server/test/auth.test.ts`, `server/test/errors.test.ts`, `server/test/links.test.ts`, `server/test/routing.test.ts`

**Interfaces:**
- Produces: `signLink(draftId, kind, secret): string` + `verifyLink(token, secret): {draftId, kind} | null` (HMAC via WebCrypto; valid for the draft's lifetime — no short TTL); `errors.ts` — `transient(code)`/`terminal(code, alertDeps)` returning Afrikaans messages and firing a Joshua alert (in-Worker `fetch` webhook/email) on terminal; the OAuth provider config (two password accounts, long-lived sessions) + Afrikaans login page; `index.ts` default export routing `/mcp` (auth-gated MCP), `/upload`, `/preview`, `/approve`, `/oauth/*`, `/login`.

- [ ] **Step 1: Write failing tests** — `signLink`/`verifyLink` round-trip; a tampered token → null → the page renders the expired-link message; terminal error fires the alert `fetch` (mocked) and returns the "sê asseblief vir Joshua" message with a code; transient does not alert; routing dispatches each path (auth-gated `/mcp` returns 401 without a token). Use `@cloudflare/workers-oauth-provider`'s documented test seam or assert the provider is mounted and the login page renders in Afrikaans.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement.** Wire the upload/preview handlers to `verifyLink`. `index.ts` composes the OAuth provider (protecting `/mcp`) with the page routes.

- [ ] **Step 4: Verify + commit** (`"Add OAuth, signed links, error taxonomy and Worker routing"`).

---

### Task 10: CI rendition materialization + publish-pipeline changes

**Files:**
- Create: `scripts/materialize-renditions.mjs`
- Modify: `.github/workflows/deploy.yml`
- Test: `tests/materialize-renditions.test.ts`

**Interfaces:**
- Consumes: `postSchema` (to read committed post JSON), sharp (already a dep).
- Produces: a CI step that, for every committed post, materializes any missing `-WxH` rendition files (card 760×760, portrait 760×990, thumb 150×150 — center-crop) from the hero original referenced in the post JSON, then commits them `[skip ci]` (rebase-and-retry-once, skip-without-failing on persistent non-fast-forward). Adds `contents: write` to the build job.

**NOTE (Track C coupling):** this task edits `deploy.yml`, which Track C also rewrites (media into git). Implement the rendition step and the `contents: write` bump in a way that is additive to the current workflow; flag in the commit message that Track C must reconcile. Do NOT remove the existing media download/seed/cache steps (that's Track C).

- [ ] **Step 1: Write failing test** — given a post JSON referencing `foo-760x760.jpg`/`-760x990`/`-150x150` and only a `foo.jpg` original present in a temp dir, `materializeRenditions(dir)` creates the three crops at the right dimensions; an already-present rendition is left untouched (idempotent); a post with no featured image is skipped.

- [ ] **Step 2: Run, confirm failure. Step 3: Implement** the script (pure `materializeRenditions(root)` + CLI) and the deploy.yml step. Add a unit test asserting the commit-back message carries `[skip ci]`.

- [ ] **Step 4: Verify** the root build still passes; commit (`"Add CI rendition materialization step for chat-published photos"`).

---

### Task 11: Provisioning runbook, go-live checklist, whole-branch review

**Files:**
- Create: `server/README.md`
- Modify: root `README.md` (link to the Worker + note the chat-CMS is built, pending provisioning + Track C)

**Interfaces:** documentation only.

- [ ] **Step 1: Write `server/README.md`** — the complete provisioning runbook: create the Cloudflare account + Worker; create the GitHub App (permissions `contents:write`, `actions:read`, `pull_requests:write`, install on this repo only) and convert its key `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem` → `wrangler secret put GITHUB_APP_PRIVATE_KEY`; set `ANTHROPIC_API_KEY`, OAuth passwords, the alert webhook, and repo/app ids as secrets/vars; create the KV namespace + R2 bucket and fill `wrangler.toml`; `wrangler deploy`; add the connector on claude.ai + create the Claude Project (with the thin pointer instructions) + the Afrikaans starter-phrase cheat card. Then the **go-live checklist**: Track C must land first (media in git); start in **pilot mode** (publishes as PRs for Joshua); flip to direct-to-main once trusted. Include how to run the local test suites (`npm test --prefix server`, `npm run test:e2e --prefix server`) and what they do/don't cover (mocked infra vs real `wrangler dev`).

- [ ] **Step 2: Update root README** — a short "Chat CMS (server/)" section: what it is, that it's built and tested but not yet live, pointing at `server/README.md` and the spec.

- [ ] **Step 3: Commit** (`"Document CMS Worker provisioning and go-live checklist"`).

- [ ] **Step 4: Whole-branch review** — the controller dispatches the final review over the whole Track D range on the most capable model, with the provisioning/Track-C gates as explicit non-defects; fixes applied in one pass; then push.
