# Marinda Kook — Chat CMS (Cloudflare Worker)

## What this is

A single Cloudflare Worker (`server/`) that lets Marinda write and publish recipes
by chatting with Claude instead of using the WordPress admin. Claude connects to the
Worker as an MCP connector; the tools run an Afrikaans interview (title, categories,
ingredients, method, story, photos, featured), collect photos through a mobile-first
upload page, translate the result to English, show a preview/approval page in both
languages, and — once approved — publish by committing directly to this GitHub repo
(or opening a PR in pilot mode). Everything model-facing (tool text, validation
errors, both web pages) is in Afrikaans.

The Worker is **built and tested — 182 server tests (19 files) plus the root repo's
29 tests all green, run against mocked GitHub/Anthropic and miniflare KV/R2/OAuth
bindings — but it is not deployed and not live.** Two gates stand between this state
and a real publish, and both are outside the scope of the code in `server/`:

1. **Provisioning** (this document) — creating the Cloudflare/GitHub/Anthropic
   accounts and secrets only the repo owner can create.
2. **Track C** (WordPress decommission, tracked separately) — committing site media
   into git. `public/media/` is currently entirely gitignored; a real `publish` would
   write a post whose renditions the deploy build can only materialize from an
   original that's actually in git. **Track C must land before the Worker is used for
   a real publish.**

---

## Provisioning steps

Run these once, in order. They require a Cloudflare account, a GitHub account with
admin rights on this repo, and an Anthropic API key.

### 1. Cloudflare account + Worker

1. Create (or reuse) a Cloudflare account, then `npm install --prefix server` if you
   haven't already (installs `wrangler`).
2. `npx wrangler login` (inside `server/`) to authenticate the CLI. This obtains the
   `account_id` implicitly — `server/wrangler.toml` deliberately has **no**
   `account_id` committed (that's per-user, filled in locally or via
   `CLOUDFLARE_ACCOUNT_ID`/`wrangler.toml` overrides you keep out of git).

### 2. KV namespaces + R2 bucket

The Worker needs **two** KV namespaces and **one** R2 bucket:

- `DRAFTS` — draft posts, translation-job state, approval flags, upload manifests
  (`server/src/core/store.ts`).
- `OAUTH_KV` — required by `@cloudflare/workers-oauth-provider` itself (it stores
  token/grant state; see the library's README, "requires ... a Workers KV namespace
  binding called `OAUTH_KV`"). **Note:** `server/wrangler.toml` currently only has a
  commented-out stub for `DRAFTS`; there is no stub for `OAUTH_KV` yet, so add it
  yourself as a second `[[kv_namespaces]]` block, or it will be missing at deploy
  time.
- `PHOTOS` (R2) — staged photo uploads awaiting publish (`server/src/pages/upload.ts`,
  `server/src/core/store.ts`).

```bash
cd server
npx wrangler kv namespace create DRAFTS
npx wrangler kv namespace create OAUTH_KV
npx wrangler r2 bucket create marindakook-cms-photos
```

Each `kv namespace create` prints an `id`. Add both namespaces plus the bucket to
`server/wrangler.toml` (uncommenting/extending the existing stubs):

```toml
[[kv_namespaces]]
binding = "DRAFTS"
id = "<id from the DRAFTS create command>"

[[kv_namespaces]]
binding = "OAUTH_KV"
id = "<id from the OAUTH_KV create command>"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "marindakook-cms-photos"
```

### 3. The `?raw` text-import rule (needed for `wrangler deploy`)

`server/src/index.ts` bundles several text/JSON files at build time with Vite's
`?raw` import suffix (the interview protocol, both style guides, the translate
prompt, `terms.json`, `site.json`, the two page JSONs, and the generated post-index
snapshot) — see the comment at the top of `index.ts`. `?raw` is a Vite feature that
works under `vitest` (via `@cloudflare/vitest-pool-workers`) but a plain
`wrangler deploy` bundles with esbuild, which does not understand `?raw` out of the
box. Before deploying, either:

- add a [Wrangler build rule](https://developers.cloudflare.com/workers/wrangler/configuration/#build)
  in `wrangler.toml` that treats `.md` and the specific `?raw`-imported `.json` files
  as `Text` modules, or
- deploy via the Cloudflare Vite plugin/build (`@cloudflare/vite-plugin`) instead of
  raw `wrangler deploy`, so the same Vite pipeline the tests use also produces the
  deploy bundle.

This was flagged during D9 (OAuth/routing task) and not yet exercised against a real
`wrangler deploy` — verify whichever approach you pick actually resolves all nine
`?raw` imports before trusting a deploy.

### 4. The GitHub App

Create a GitHub App (GitHub → Settings → Developer settings → GitHub Apps → New
GitHub App), then **install it on this repository only** (not org-wide). Permissions
(repository permissions, per the design spec):

- **Contents: Read and write** (`contents:write`) — commits/PRs for publish.
- **Actions: Read-only** (`actions:read`) — `check_publish_status` reads workflow
  run status via the Actions API.
- **Pull requests: Read and write** (`pull_requests:write`) — pilot-mode publish PRs,
  `delete_post`'s PR-only flow, and the translation safety-net PR.

No other permissions and no PATs — the Worker (`server/src/core/github.ts`) mints
short-lived installation tokens from the App's own key.

After creating the App, GitHub gives you an **App ID** and an **Installation ID**
(visible on the installed-app's settings page URL), and lets you generate a
**private key** — downloaded as a PEM in **PKCS#1** format. Workers' WebCrypto
(`crypto.subtle.importKey("pkcs8", ...)`, used in `github.ts`) can only import
**PKCS#8**, so convert it once:

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out key-pkcs8.pem
```

Then set it as a secret (never commit the key or the converted file):

```bash
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < key-pkcs8.pem
```

### 5. Every other secret and var

`server/src/env.d.ts` is the authoritative list of everything the Worker reads from
its environment. Set the secrets with `wrangler secret put <NAME>` (prompts for the
value; never appears in `wrangler.toml`) and the plain vars either the same way or as
`[vars]` in `wrangler.toml` (non-secret, fine to commit — e.g. `GITHUB_OWNER`/
`GITHUB_REPO`, which the wrangler.toml comment already anticipates).

| Name | Kind | Description |
| --- | --- | --- |
| `LINK_SECRET` | secret | HMAC key signing the upload/preview links (`core/links.ts`). Any long random string. |
| `OAUTH_MARINDA_USERNAME` | secret | Marinda's login username for the Worker's own OAuth login page. |
| `OAUTH_MARINDA_PASSWORD` | secret | Marinda's login password. Password reset = re-run `wrangler secret put` with a new value — not an incident. |
| `OAUTH_JOSHUA_USERNAME` | secret | Joshua's login username (same login page, second account). |
| `OAUTH_JOSHUA_PASSWORD` | secret | Joshua's login password. |
| `GITHUB_APP_ID` | secret | The GitHub App's App ID. |
| `GITHUB_INSTALLATION_ID` | secret | The installation ID from installing the App on this repo. |
| `GITHUB_APP_PRIVATE_KEY` | secret | The App's private key, **converted to PKCS#8** (step 4 above). |
| `GITHUB_OWNER` | secret or var | The repo owner/org (e.g. the GitHub username hosting this repo). |
| `GITHUB_REPO` | secret or var | The repo name (e.g. `marindakook`). |
| `ANTHROPIC_API_KEY` | secret | Anthropic API key used by the async translation job (`core/translation-job.ts`) to call the Messages API. |
| `ANTHROPIC_MODEL` | var (optional) | Model id for translation; defaults to `claude-sonnet-4-5` in code (`index.ts`) if unset. |
| `ALERT_WEBHOOK` | secret (optional) | Webhook URL the Worker POSTs to on a terminal error, to alert Joshua directly (`core/errors.ts`). If unset, terminal errors still return the honest Afrikaans message to Marinda, just without the ping. |
| `SITE_BASE_URL` | var (optional) | Base URL used to build the "live" link shown after a direct (non-pilot) publish. If unset, it's derived as `https://<GITHUB_OWNER>.github.io/<GITHUB_REPO>`. |
| `PILOT_MODE` | var | `"true"`/unset = pilot mode ON (publish opens a PR); set literally to `"false"` to publish direct to `main`. Pilot ON is the safe default — see the go-live checklist below. |
| `REVIEWER` | var (optional) | Name surfaced in pilot-mode PR titles/bodies; defaults to `"Joshua"` if unset. |

`DRAFTS`, `OAUTH_KV`, and `PHOTOS` are bindings, not secrets/vars — set in
`wrangler.toml` per step 2, not with `wrangler secret put`.

### 6. Deploy

```bash
cd server
npx wrangler deploy
```

Confirm all nine `?raw` imports resolved (step 3) and that all three bindings
(`DRAFTS`, `OAUTH_KV`, `PHOTOS`) show up in the deploy summary.

---

## Connect the client

1. On [claude.ai](https://claude.ai), add a **custom connector** pointing at the
   deployed Worker's `/mcp` endpoint (the Free plan supports exactly one custom
   connector, which is all this needs). Completing the connector's OAuth flow will
   hit `/oauth/authorize`, which renders the Worker's own Afrikaans login page
   (`server/src/pages/auth.ts`) — log in with Marinda's account.
2. Create a Claude **Project** on Marinda's account with a thin-pointer system
   prompt, e.g.:

   > "Praat Afrikaans. Begin met die marindakook connector se `begin_draft` en volg
   > sy instruksies."

   Keep it thin deliberately — the actual interview protocol lives entirely in
   `server/prompts/interview-af.md` and is returned verbatim by `begin_draft`/
   `resume_draft`, so the Project instructions and the protocol text can never drift
   apart (that file's own header says as much: "Redigeer die protokol HIER, nêrens
   anders nie").
3. Give Marinda a pinned Afrikaans cheat card of starter phrases, e.g.:
   - "begin 'n nuwe resep"
   - "wys my konsepte"

---

## Go-live checklist

Work through these in order — each gate is explicit, not implied:

1. **Track C must land first.** Site media (`public/media/`) is currently entirely
   gitignored; a chat-published post's hero photo is committed directly via the
   GitHub App (bypassing the ignore rule for that one file), but the deploy build's
   rendition step (`scripts/materialize-renditions.mjs`, added in
   `.github/workflows/deploy.yml`) needs the *rest* of the media tree — the
   WordPress-sourced originals — to actually be in git for this to be reliable
   long-term. Track C (WordPress decommission, tracked separately) is what commits
   media into git; do not attempt a real publish before it lands.
2. **Verify the deploy.yml rendition step + commit-back with real photos.** The
   "Materialize renditions" / "Commit materialized renditions" steps in
   `.github/workflows/deploy.yml` were written and unit-tested (D10) but their
   push-rebase-retry race path has never run against a real chat-published photo in
   CI. Once Track C lands and the Worker is deployed, publish one real recipe with a
   real hero photo and confirm: the rendition files actually materialize, the
   commit-back lands (or safely no-ops on a race), and the deployed post renders with
   working card/portrait/thumb images. `.github/workflows/deploy.yml` has an inline
   "TRACK C COUPLING" comment flagging that Track C is expected to rewrite this
   workflow (removing the download/seed/cache steps) and must reconcile the
   rendition + `media-optimized.json` commit-backs when it does — don't lose that
   reconciliation when Track C's PR lands.
3. **Start in pilot mode.** `PILOT_MODE` unset (or any value other than `"false"`)
   means every `publish` opens a PR instead of committing to `main` directly, and
   tells Marinda honestly "gestuur vir Joshua se goedkeuring" rather than promising a
   live URL. Leave it in this state for the first weeks: review each PR's diff and
   rendered preview, merge (triggering the normal deploy), and use that period to
   build confidence in the interview → translate → publish pipeline against a real
   author before removing the review step.
4. **Flip pilot mode off once trusted.** Set `PILOT_MODE=false` (`wrangler secret put`
   or a `[vars]` entry) once you're comfortable with direct-to-`main` publishes.
   `delete_post` always goes through a PR regardless of this flag — that one stays
   reviewed forever.
5. **Rehearse the reconnect prompt.** claude.ai's own "reconnect this connector" UI
   (English, outside this codebase's control) will eventually surface — e.g. after
   the 30-day access-token TTL expires with no matching refresh (the OAuth provider
   is configured with `accessTokenTTL: 60 * 60 * 24 * 30` and
   `refreshTokenTTL: undefined`/never-expiring in `server/src/index.ts`, so this
   should be rare, but plan for it). Walk Marinda through what that prompt looks like
   and what to tap during onboarding, so it isn't a surprise mid-authoring.
6. **Password reset is a supported operation, not an incident.** If Marinda (or
   Joshua) forgets a password, Joshua updates the corresponding
   `OAUTH_MARINDA_PASSWORD`/`OAUTH_JOSHUA_PASSWORD` secret with
   `wrangler secret put` and tells her the new one — there is no self-service reset
   flow, and none is needed for a two-account login page.

---

## What the local tests cover vs. NOT

```bash
npm test --prefix server       # 182 tests, 19 files
npm run test:e2e --prefix server   # Playwright, real Chromium
```

`npm test --prefix server` runs inside `workerd` via
`@cloudflare/vitest-pool-workers`, with **miniflare-backed KV/R2** bindings
(`DRAFTS`, `OAUTH_KV`, `PHOTOS` — see `server/vitest.config.ts`) and mocked
GitHub (`GitHubApp`'s injected `fetch`) and mocked Anthropic (the translation job's
injected `fetch`). It covers: every MCP tool (interview/draft, voice, photos,
translation, edit/chrome, publish/status/delete), publish create-only + idempotency
(a dropped commit response on retry must not double-commit), the GitHub App's JWT
minting + bounded transient-fault retry, signed-link round-trip/tamper handling, the
error taxonomy (transient vs. terminal + the Joshua alert webhook), OAuth
login-page/credential-check logic, and Worker routing (`/mcp` 401s without a token,
bad-signature `/upload`/`/preview` render the Afrikaans expired-link page at 200).

`npm run test:e2e --prefix server` drives the real upload page in real Chromium
(Playwright): loads a rotated fixture image with GPS EXIF, uploads it, and asserts
the re-encoded output is JPEG, ≤2000px on its long edge, correctly oriented, and
carries zero EXIF/GPS metadata.

What neither suite exercises — **verify these with `wrangler dev` during
provisioning**, before trusting a production deploy:

- **The authenticated MCP round-trip.** The stateless `/mcp` transport wiring
  compiles and unit-tests confirm it 401s without a token, but an actual
  `initialize` → OAuth-gated tool call from a real MCP client (claude.ai) has never
  run against a live Worker.
- **The full OAuth authorize → token dance.** `completeAuthorization`, the token
  endpoint, and dynamic client registration are `@cloudflare/workers-oauth-provider`'s
  own machinery; only the login page and credential check are unit-tested here. The
  never-expiring refresh token / 30-day access token semantics need a live provider
  to confirm.
- **A real `wrangler deploy` bundle.** The nine `?raw` text imports build fine under
  Vite (the test pool); a raw esbuild-based `wrangler deploy` needs the build-rule or
  Cloudflare-Vite-plugin workaround in step 3 above — untested until someone actually
  runs it.
- **The deploy.yml rendition commit-back's push/rebase race**, per go-live-checklist
  item 2 above.
- **Duplicate-detection freshness.** `begin_draft`'s near-duplicate check runs over
  a bundled point-in-time snapshot (`server/src/generated/posts-index.json`, ~397
  posts at the time it was generated) — there is currently no script that
  regenerates this file, so posts chat-published after the snapshot was taken won't
  be considered for duplicate detection until someone manually regenerates and
  redeploys it. Non-critical (the check is a UX nicety, not a correctness gate), but
  worth knowing.

---

## Operations

**Running the local suites:**

```bash
npm test --prefix server           # vitest, inside workerd via miniflare
npm run test:e2e --prefix server   # Playwright, real Chromium
npm run typecheck --prefix server  # tsc --noEmit
```

The root repo's own suite (`npm test`, 29 tests / 8 files) is unaffected by anything
in `server/` and should stay green independently — the Worker imports the repo's
pure modules (`src/lib/source-hash.ts`, `translation-check.mjs`, `translate-prompt.ts`,
`content-schema.ts`, `content-derive.ts`) but never forks them.

**Where the human-curated material lives** (edit these directly; nothing generates
them):

- `server/prompts/interview-af.md` — the sole authoritative interview protocol.
  Returned verbatim by `begin_draft`/`resume_draft`; the Claude Project's own
  instructions are a thin pointer specifically so this file is the only place the
  protocol can be edited.
- `content/style-guide.af.md` / `content/style-guide.en.md` — voice guides
  `get_style_guide` returns, and the reference material for the async translation
  job's prompt.
- `server/prompts/translate-en.md` — the committed translation prompt template.

**Pilot flag:** `PILOT_MODE` (see the go-live checklist above) — the single control
for whether `publish` commits direct to `main` or opens a review PR.

**Monitoring:**

- `ALERT_WEBHOOK` — the Worker POSTs directly to this URL whenever a *terminal*
  error occurs (auth failure, exhausted GitHub retries, any unhandled exception) —
  see `server/src/core/errors.ts`. This is Joshua's real-time signal, separate from
  CI: a Worker-side failure never triggers a GitHub Actions run, so the normal
  Actions failure email never fires for it.
- Standard GitHub PR/Actions emails — pilot-mode publishes and `delete_post` land as
  PRs (normal PR notification emails apply), and the deploy workflow's own
  success/failure emails cover the CI side (rendition materialization, translation
  safety-net PRs, the build/deploy itself).

**Track C reconcile note:** `.github/workflows/deploy.yml`'s rendition-materialization
step (added in D10) is additive — it does not touch the existing media
download/seed/cache steps. When Track C rewrites this workflow to move media into
git, it must reconcile: (a) where the "Materialize renditions" / "Commit materialized
renditions" steps belong relative to the new media-in-git flow, and (b) the
interaction between this step's commit-back and the `media-optimized.json` state
commit-back the design's publish-pipeline section describes for optimized images —
both are `[skip ci]` commit-backs against the same working tree and need a single
coherent ordering, not two independent races.
