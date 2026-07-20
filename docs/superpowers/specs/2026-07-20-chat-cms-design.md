# Chat-driven CMS — design

**Date:** 2026-07-20
**Status:** Approved design, pending implementation plans (one per track — see Phasing)
**Replaces:** WordPress as the authoring system for marindakook.co.za

## Goal

Marinda struggles with the WordPress admin. Replace it with a chat-driven
authoring flow: she talks to Claude in Afrikaans, the assistant interviews her
about the recipe, collects photos, drafts prose in her voice, produces a
reviewed English translation, and publishes — a git commit that triggers the
existing static deploy. WordPress is then shut down entirely; the git repo
becomes the single source of truth for all content and media.

## Decisions already made

| Question | Decision |
| --- | --- |
| Hosting | GitHub Pages stays. Site fits: ~780 MB deployed vs 1 GB cap, ~60 MB/yr growth, WebP conversion available as future headroom. No VPS. |
| Shop / newsletter after WP shutdown | Drop shop remnants (see decommission — there is no shop nav item; the work is link hygiene). Keep the newsletter by posting directly to Marinda's Mailchimp list (the WP plugin was only a wrapper). |
| Chat scope | Full CMS: new recipe posts, editing existing posts and the two pages, non-recipe posts, and site chrome (bio, nav, newsletter copy, sidebar lists). |
| LLM account | **Claude Pro is the supported client**: custom connectors are configured once on claude.ai and sync to the iOS/Android/Desktop apps — right for a phone-first author. ChatGPT is a documented degraded fallback only (custom write-capable MCP connectors require beta Developer Mode, are web-only, and demand per-call write confirmations that would wreck the interview flow). |
| Approach | **A with separable core**: a remote MCP connector — no bespoke chat UI. The Worker's core (draft store, validation, publish) is kept separable so a bespoke chat app could be added later without rework. |

## Architecture

```
Marinda ──chat──▶ Claude app (her Pro subscription, Afrikaans, voice)
                        │ MCP tools
                        ▼
              CMS Worker (Cloudflare, free tier)
              ├─ MCP server: interview / edit / publish tools
              ├─ Upload + preview pages (photos, af/en review, "Lyk reg ✓")
              ├─ OAuth login (two accounts: Marinda, Joshua)
              ├─ KV: drafts + page↔chat handoff state   R2: staged photos
              │ GitHub App token (contents:write, actions:read, PRs:write)
              ▼
        jthrilly/marindakook  (self-contained: content + media in git)
              │ push to main
              ▼
        CI: validate schemas → optimize images + renditions → translation
            safety net → derive indexes → build → GitHub Pages
```

- **Worker, not VPS.** The only server-side needs are tool handling, a login
  page, small file staging, and GitHub API calls. Cloudflare Worker + KV +
  R2 free tiers cover this traffic with zero maintenance cost.
- **Repo layout.** Worker code lives in this repo under `server/`, deployed by
  a GitHub Action (Wrangler) on changes to that directory.
- **Publishing is a git commit.** The `publish` tool commits the post JSON,
  the English translation, and photos under
  `public/media/uploads/<year>/<month>/…` (the WordPress path convention is
  preserved so URLs stay stable) to `main` via the GitHub API. The push
  triggers the existing deploy (~3 min).
- **Derived state is never committed by publish.** Today
  `content/posts-index.json` is the load-bearing derived file — the router
  resolves and generates every post/archive/home route from it, and the feed,
  sitemap, sidebar, and search index all read it — and its only writer is the
  WordPress sync script this design deletes. It, and the term counts in
  `terms.json`, become **build-time derivations**: a prebuild step regenerates
  the post index from `content/posts/*.json` (sorted date-descending;
  `hasRecipe` from recipe presence, `commentCount` from comments) and term
  counts from post category/tag assignments. The committed `posts-index.json`
  is deleted; `terms.json` stays authoritative for names/slugs/hierarchy only.
  This keeps `publish` single-writer-simple and makes hand edits self-healing.
- **Credentials.** A GitHub App installed on this repo only:
  `contents:write`, `actions:read` (for `check_publish_status`), and
  `pull_requests:write` (pilot mode + translation-net PRs). The Worker mints
  short-lived installation tokens (note: GitHub delivers the App key as
  PKCS#1 PEM; convert once to PKCS#8 — `openssl pkcs8 -topk8 … -nocrypt` —
  before `wrangler secret put`, since Workers WebCrypto can't import PKCS#1).
  No PATs.

## Phasing

Four tracks, each its own implementation plan:

- **Track A — typed contract**: `src/lib/content-schema.ts` (zod), loader
  refactor, `validate-content` CI job, migration-proof fixtures, build-time
  derivation of the post index and term counts. No dependencies.
- **Track B — voice**: style guides (af/en), the committed translation prompt,
  translation regression harness. Depends only on A's schema shapes.
- **Track C — WordPress decommission**: final sync/freeze, mirror
  verification, media into git, link hygiene, Mailchimp rewire, workflow
  cleanup. Independent of A/B; **C must complete before any real publish**
  (media is currently gitignored).
- **Track D — CMS Worker**: OAuth, MCP tools, KV/R2, upload/preview pages,
  publish, pilot mode. Depends on A (validation, generated tool schemas) and
  C (media in git).

Go-live = C complete + D running in pilot mode.

## WordPress decommission (Track C)

1. Final content sync from WordPress, then freeze (delete `sync.yml`).
2. **Mirror verification gate:** run `node scripts/download-media.mjs` against
   the freshly written manifest and require a clean exit (0 failed; origin
   404s tolerated) — after step 6 the WordPress origin is gone forever, so
   this is the completeness proof.
3. Commit `public/media` (~393 MB, 4,782 files) **and
   `content/media-optimized.json`** (the optimizer state must survive without
   the Actions cache) and un-gitignore both. Remove the deploy workflow's
   download/seed/cache steps and the `media-seed` release. Delete
   `scripts/download-media.mjs`, `content/media-manifest.json`, and
   `content/sync-report.json` — sync artifacts with no post-WP readers (the
   manifest's URLs point at the dead host).
4. **Newsletter:** change the form component to POST directly to the Mailchimp
   hosted subscribe endpoint for her list (list URL from her Mailchimp
   account). No API key needed for hosted-form subscribes.
5. **Link hygiene** (after the final sync, which regenerates comment HTML):
   rewrite the three absolute `https://marindakook.co.za/<slug>/` cross-post
   links (all in `comments[].html` of three Afrikaans posts) to relative
   paths; grep-verify the `KEEP_ON_WP` link classes (`/shop`, `/product`,
   `/cart`, `/checkout`, `/my-account`, print) are absent from `content/**`.
   There is no shop nav item to remove. **Do not touch external retailer
   links** (takealot.com, loot.co.za, exclusivebooks.co.za on the optredes
   page) — they are legitimate.
6. Cancel WordPress hosting. Keep the **domain registration** alive
   regardless — it is separate from hosting and preserves the cutover option.
7. *Domain cutover (recommended, ordering matters):* point
   `marindakook.co.za` DNS at GitHub Pages **before or simultaneously with**
   step 6 (`SITE_URL=https://marindakook.co.za`, empty `BASE_PATH`). Done in
   this order, old inbound links (search results, Pinterest) keep working. If
   cutover is skipped, accept explicitly that all inbound links to
   marindakook.co.za break at step 6.

Vestigial fields are dropped during the contract migration: `site.wpUrl`
(read nowhere) and committed term counts. The sidebar "Gewildste" /
"Kommentaar" lists lose their WordPress data source (a popularity plugin) and
become **hand-curated lists** in the Site schema, seeded from the final sync
and editable via `update_site_config` — the static site has no analytics and
comments are frozen, so curation is the only honest source.

## Typed content contract (zod, single source of truth — Track A)

`src/lib/content-schema.ts` defines zod schemas for every authored content
file:

- `Post` — including the full `Recipe` shape (details as value/unit pairs,
  ingredient groups, direction groups, notes), comments, seo. **For new
  (chat-authored) posts the featured-image shape is required, not nullable**
  — legacy posts may carry nulls, but the contract must not let a new post
  silently ship imageless (all consumers null-check, so nothing else would
  catch it).
- `Page`, `Translation` (with `sourceHash`), `Site` (nav, bio, newsletter,
  curated sidebar lists), `Terms` (names/slugs/hierarchy; counts are derived,
  not authored).
- **Site chrome gets a real English translation file**:
  `content/translations/en/site.json` with its own `sourceHash`, replacing
  the hard-coded `enSiteStrings` lookup in `i18n.ts` (which silently breaks
  the moment Marinda edits any Afrikaans chrome string it keys on). Chrome
  edits flow through the same translate-review-publish path as posts, and
  `check:translations` covers it.

Consumers, one definition: site loaders parse with the schemas (inferred
types replace hand-written interfaces); the Worker validates every save and
generates its MCP tool input schemas from the same source (zod v4 JSON-Schema
export); CI's `validate-content` job validates every authored file on every
push. Non-authored files are explicitly out of contract:
`media-optimized.json` is optimizer state; the post index is a build artifact.

The **`sourceHash` computation joins the contract**: a pure `sourceHashOf()`
in the shared core module, computed over the zod-normalized object exactly as
committed; `scripts/source-hash.mjs` and `check-translation.mjs` become thin
wrappers. A round-trip test asserts a Worker-stamped hash equals what the CI
checker expects — otherwise every chat-published post would trip the safety
net. Scripts share the TypeScript schemas via `tsx`.

## MCP server: tools and interview (Track D)

All tool responses, validation errors, and both web pages are in Afrikaans —
errors are instructions the model can act on (which field, why, what to do).

| Tool | Purpose |
| --- | --- |
| `begin_draft` / `list_drafts` / `resume_draft` | Start or resume; **returns the full interview protocol** (see below); `begin_draft` surfaces near-duplicate posts and open drafts first ("Jy het reeds 'n konsep vir Piesangbrood — wil jy daaraan voortgaan?") |
| `discard_draft` | Deletes the KV draft and its staged R2 photos |
| `get_style_guide` / `get_similar_posts` | Voice material; similar posts matched by shared category/tag + title-keyword scoring over the post index |
| `save_draft` | Upsert (partial drafts valid — see checkpointing); zod errors as actionable Afrikaans |
| `request_photo_upload` | Returns the signed upload-page link, nothing more |
| `check_uploads` | Returns the staged file list the upload page wrote to KV |
| `generate_translation` | **Starts** the async translation job, returns immediately |
| `check_translation_status` | Job progress / result summary for chat review |
| `get_preview_link` | Signed link to the review page ("Lyk reg ✓") |
| `find_posts` / `get_post` / `update_post` | Edit flow, `type: post \| page`; edits mark the translation stale and bump `modified` |
| `get_site_config` / `update_site_config` | Chrome edits as a first-class draft type (listable, resumable, discardable); publishes via the same `publish` gate |
| `delete_post` | Destructive — chat confirmation + always routed through a PR, even outside pilot mode |
| `publish` | Final validation → one commit → honest outcome message |
| `check_publish_status` | Real deploy status, including "superseded" and pilot-mode states |

**Interview protocol lives in the Worker, not the client.** The authoritative
copy (versioned in the repo beside the style guides) is returned in full by
`begin_draft` and `resume_draft`: Afrikaans only; one question at a time;
offer skryfhulp on note-form input; never invent quantities; confirm
categories against the term list **with internal terms (featured,
uncategorised, eenhede) filtered out**; ask explicitly "Moet hierdie resep op
die voorblad wys?" (assigning the featured term under the hood — the homepage
grid shows the 3 newest featured posts, so featuring is curation, and the
tool surfaces which post drops out). The Claude Project on her account is a
thin pointer ("praat Afrikaans, begin met begin_draft en volg sy
instruksies") so the two copies cannot drift. An integration test asserts the
protocol text is present in those tool responses.

**Checkpointing mandate.** `save_draft` is called after every substantive
answer or accepted skryfhulp iteration — not at the end. The draft schema is
a partial variant of `Post` plus lightweight interview state (settled fields,
pending fields, latest prose), so `resume_draft` in a fresh chat continues
mid-interview without re-asking. Chat transcripts are not the draft; KV is.

**Skryfhulp.** Note-form input → the model drafts the full post (intro story,
flowing method, **plus excerpt and seo title/description** — schema-required
fields Marinda shouldn't be asked to compose; default seo title
`<Titel> - Marinda Kook`) and reads it back for iteration. Voice comes from
`content/style-guide.af.md` / `.en.md` — generated once by a scripted
analysis of the 397 posts and 399 translations, thereafter manually curated
(owner: Joshua); regeneration is a deliberate act — plus `get_similar_posts`
few-shot examples.

**Slugs, ids, and collision safety.** The Worker generates the slug from the
Afrikaans title at first save (lowercase, diacritics stripped, hyphenated —
the existing convention) and checks it against existing posts, the page
slugs, reserved route segments (`category`, `tag`, `page`, `search`, `en`),
and open drafts; collisions get an Afrikaans prompt distinguishing "edit the
existing post" from "new variant" (auto-suffix). `publish` of a new post is
**create-only** — it asserts the path is absent from the base tree and fails
loudly otherwise; only `update_post` may write an existing slug, and it
passes the file's current SHA so concurrent edits fail loudly. The Worker
allocates numeric ids (max existing + 1; ids are load-bearing in translation
linkage and React keys). New posts default `date` = publish time (`modified`
bumped on every update), `commentStatus: closed`, `comments: []`. Tags are
assignable from the existing term list; new tags may be created with
confirmation (Worker allocates the term id). Page creation is out of scope —
the two legacy pages are editable, not creatable.

**Photos.** Chat attachments are not forwarded to connector tools, so photos
go through the upload page (draft-scoped signed link):

- **Mobile-first**: the primary control is a file input opening the iOS photo
  picker (which usually delivers JPEG already); drag-and-drop is a desktop
  enhancement. All copy Afrikaans. Per-photo delete/replace buttons live on
  this page (chat can't carry image bytes, so corrections happen here).
- **Unconditional client-side re-encode** before staging in R2: decode, apply
  EXIF orientation to pixels, strip all metadata **including GPS**, downscale
  to ≤2000 px JPEG. This runs even when no downscale is needed — publish
  commits to a public repo, and CI is too late to strip location data from
  git history. A rotated-fixture test asserts orientation and metadata.
- **Renditions**: the site requires card 760×760, portrait 760×990, and thumb
  150×150 renditions (cards, homepage grid, OG image, search thumbs) that
  WordPress used to generate. The Worker writes deterministic
  `-WxH`-suffixed paths into the post JSON (hero also populates
  `recipe.image` and `featured`, with real dimensions and interview-collected
  alt text); the **CI optimize step materializes any missing rendition files
  with sharp** (already a dependency) before the build in the same run.
- The upload page writes the staged-file manifest to KV; the model learns of
  it via `check_uploads` (the page ends with "Klaar! Gaan terug na jou
  gesprek en sê 'klaar'."). The model asks which photo is the hero;
  `save_draft` records it.

**Translation review (draft-time, async).** `generate_translation` returns
immediately ("vertaling word gemaak — kyk oor 'n minuut") and runs the job
under `ctx.waitUntil` with progress in KV: chat clients hard-cap tool calls
(≈60 s–4 min) while a long post plus validator retries can exceed them. The
job is one Claude API call using the committed prompt artifact
`server/prompts/translate-en.md` (authored during implementation — the
existing 399 translations came from ephemeral sessions; this single copy is
loaded by the Worker, the CI safety net, and the regression test), checked by
the existing `check-translation` validator with up to 3 feedback retries,
idempotent per draft+sourceHash. **`publish` requires a current,
validator-passing translation**; the sole exception is validator exhaustion,
where publish proceeds Afrikaans-only ("Engels volg later"), `/en/` falls
back as today, and the Worker opens a PR carrying the best failing draft for
human review, assigned to Joshua.

**Preview and approval.** `get_preview_link` serves the review page: af/en
**stacked or tabbed on phones**, side-by-side from tablet width; chrome
drafts render the affected chrome (header/bio/sidebar/footer) instead of a
recipe card. The Worker can't run the Next build, so previews use shared
lightweight templates + the site's compiled CSS — close approximation,
fidelity checked manually during the pilot. Tapping "Lyk reg ✓" writes an
`approved_at` flag to KV for the current draft revision (invalidated by any
subsequent content change, like translation staleness); **`publish` refuses
until it is set** ("die voorskou is nog nie goedgekeur nie") and the page
tells her to return to chat. Signed links stay valid for the draft's
lifetime; an invalid/expired link renders a friendly Afrikaans page ("Hierdie
skakel het verval — vra in jou gesprek vir 'n nuwe skakel."), never a bare
403.

**Auth, onboarding, and account operations.** The Worker implements a
minimal OAuth provider (Cloudflare `workers-oauth-provider`) with one
Afrikaans login page and two password accounts (Marinda, Joshua); token/
refresh TTLs configured for maximum session life. One-time setup is
Joshua's job, done with her: add the connector on claude.ai, create the
Claude Project, first login, and a pinned Afrikaans cheat card of starter
phrases ("begin 'n nuwe resep", "wys my konsepte"). The eventual
"reconnect" prompt (English client UI, outside our control) is rehearsed as
part of onboarding. Password reset = Joshua updates the stored credential —
a supported operation, not an incident.

## Publish pipeline (CI)

`deploy.yml` after WordPress (build job gains `contents: write` for the
commit-backs below):

1. **`validate-content`** — zod contract over all authored files; fails fast.
2. **Derive indexes** — regenerate the post index and term counts from
   `content/posts/*.json` (prebuild, feeding the existing search-index step).
3. **Optimize images + renditions** — new/changed files re-encoded to the
   site standard and missing `-WxH` renditions materialized (sharp);
   results plus the updated `media-optimized.json` state committed back with
   `[skip ci]`. The build in this run uses the optimized files — no double
   deploy. The commit-back tolerates a concurrent Worker publish: rebase and
   retry once, then skip without failing (the next run re-optimizes; the
   race is benign and must not surface to Marinda as a failure).
4. **Translation safety net** — if content edited outside the chat flow goes
   stale, CI generates a translation and opens a **PR** for review (never a
   blind commit). `/en/` falls back to Afrikaans meanwhile.
5. Build → Pages. Push-to-live stays ~3 minutes.

## Error handling

Guiding rule: *Marinda's draft is never lost, and she always gets an honest
answer in Afrikaans.*

- **Transient vs terminal.** Transient faults (network, 5xx) retry internally
  with backoff and only then say "probeer oor 'n minuut weer". Terminal
  faults (upstream 401/403, credit exhaustion, repeated failures) say
  honestly "Iets is stukkend aan my kant — sê asseblief vir Joshua" with a
  short error code, and **the Worker alerts Joshua directly** (in-Worker
  email/webhook on any terminal error or unhandled exception) — the Actions
  failure email only covers CI, which never starts when publish fails
  Worker-side. If translation auth fails, Marinda is told publish can
  proceed Afrikaans-only rather than silently degrading every later post.
- **Idempotent publish, git as authority.** Before any commit — including
  internal retries after a GitHub timeout, the likeliest trigger — the Worker
  checks whether HEAD already contains this draft's publish (draft-id trailer
  in the commit touching that path). Media paths derive deterministically
  from the draft so a retried commit is byte-identical; the KV commit-SHA
  record is a fast path only; staged R2 photos are deleted only after the
  git-state check confirms success.
- **Status semantics.** `check_publish_status` resolves the draft's commit to
  its deploy run. A run cancelled by the `pages` concurrency group is
  reported as **"superseded — jou pos gaan saam met die volgende deploy
  uit"**, following the newest run whose head contains the draft's commit;
  failure is reported only if that covering run fails (cancelled runs send
  no Actions email, so this covering-run check is also Joshua's real signal).
- **Pilot mode is honest.** With the flag on, `publish` opens a PR and says
  "gestuur vir Joshua se goedkeuring — jy hoef niks verder te doen nie" (no
  live-URL promise), and `check_publish_status` walks the PR lifecycle:
  awaiting review → merged, deploying → live with the URL. Joshua is
  notified via standard PR email. Marinda's *interview, draft, photo, and
  preview* flow is unchanged; only publish messaging differs.
- Drafts and staged photos persist until published or explicitly discarded.

## Testing

- **Vitest** on schemas and the core module. Migration proof as permanent
  fixtures: **every authored file** — 397 posts, 399 translations, both
  pages, site.json, terms.json — must parse under the contract.
- **MCP integration tests** (SDK in-memory client): scripted interviews —
  begin (asserts the protocol text is returned) → partial saves → invalid
  save (asserts Afrikaans error shape) → upload-page KV state →
  `check_uploads` → async translation → preview approval flag → publish
  refused before "Lyk reg ✓" / succeeds after — against a mocked GitHub.
- **Publish-retry idempotency**: mocked GitHub commit succeeds but the
  response is dropped; retry must not create a second commit or duplicate
  photos.
- **Upload page**: Playwright test with a real rotated iPhone HEIC fixture —
  staged object must be JPEG ≤2000 px, correctly oriented, zero EXIF/GPS.
- **Translation round-trip**: Worker-stamped `sourceHash` equals the CI
  checker's expectation for a published fixture; prompt regression re-runs
  sampled af/en pairs through the committed prompt, scored by the validator.
- **Optimize commit-back**: unit test that the commit message carries
  `[skip ci]`; one-time pilot verification that the push doesn't retrigger.
- **Pilot mode**: publishes land as PRs needing Joshua's one-click approval
  for the first weeks; preview fidelity is checked manually on real posts.
  Flip to direct-to-main once trust is earned.

## Costs

Worker/KV/R2: free tier. Translation: a few cents per post (Worker API key).
Interview usage: Marinda's Claude Pro subscription. GitHub: free.

## Out of scope (explicitly deferred)

- Bespoke chat UI (Approach B) — the Worker core stays separable so it can be
  added later if the connector flow proves too hard for Marinda.
- New public comments; WebP media conversion — future options, not blockers.
- Page creation via chat (the two legacy pages are editable only).
