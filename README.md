# Marinda Kook — static site

Static Next.js port of [marindakook.co.za](https://marindakook.co.za), a South African
recipe blog. WordPress stays in place as the CMS; this repo snapshots its content and
statically renders the whole site with Next.js 16 + Tailwind CSS 4, deployed to GitHub
Pages by GitHub Actions.

## How the hybrid setup works

```
WordPress (CMS)  ──sync──▶  content/*.json + public/media  ──build──▶  out/  ──deploy──▶  GitHub Pages
```

- **`scripts/sync-content.mjs`** pulls everything from the public WordPress REST API
  (no credentials needed): 397 posts, 2 pages, categories, tags, approved comments, and
  widget state parsed from the rendered homepage (popular-post lists, newsletter copy).
  Recipe cards (WPZOOM Recipe Card Blocks) are parsed from the rendered markup into
  structured JSON (`recipe` field: details, ingredient groups, direction groups, notes).
  Internal links are rewritten to relative paths and media URLs to `/media/...`.
  Content JSON is committed to git; images are not (see below).
- **`scripts/download-media.mjs`** mirrors every referenced image (from
  `content/media-manifest.json`) into `public/media/`, incrementally.
- **`scripts/optimize-media.mjs`** recompresses the mirror (max 1600px wide, JPEG q72)
  so the deployed site stays within GitHub Pages' size limits.
- **`next build`** statically generates every route (~1,700 pages: posts, paginated
  home, category/tag archives, pages, search, both locales) plus `sitemap.xml`,
  `robots.txt` and `feed.xml`.

## Localisation

- Afrikaans is the default locale at the root (URLs identical to the WordPress site).
- English lives under `/en/…` (same slugs). `hreflang` alternates are emitted on every
  page, and the header has a language switcher.
- English content lives in `content/translations/en/{posts,pages}/<slug>.json`. Every
  translation stores a `sourceHash` of the Afrikaans source, so staleness is
  detectable: `npm run check:translations` reports missing/outdated files. Missing or
  stale translations fall back to Afrikaans at build time — the site never breaks.
- UI strings live in `src/lib/i18n.ts`. The `af` dictionary intentionally replicates
  the live site (which mixes Afrikaans content with English theme chrome).

## Commands

| Command | What it does |
| --- | --- |
| `npm run sync` | Full content + media sync from WordPress |
| `npm run sync:content` | Content JSON only (what CI's sync workflow runs) |
| `npm run sync:media` | Download missing images from the manifest |
| `npm run check:translations` | Verify all English translations exist and match sources |
| `npm run validate:content` | Validate all content JSON against the zod contract (CI runs this on every push) |
| `npm test` | Contract + derivation test suite |
| `npm run dev` | Dev server |
| `npm run build` | Static build into `out/` (runs the search-index generator first) |

## Common tasks

### Publish or edit a post

Write and publish in WordPress as always. The static site picks it up on the next
content sync — automatically every Monday 04:00 UTC, or immediately via
**GitHub → Actions → "Sync content from WordPress" → Run workflow**. The sync
commits the new content and triggers a deploy by itself (~3 minutes). New posts
appear in Afrikaans right away; English needs a translation (next task).

To make a post appear in the big featured row on the homepage, give it the
**Featured** category in WordPress (the row shows the three newest featured posts).

### Translate new content to English

```bash
npm run check:translations        # lists MISSING and stale translations
```

For each missing item, create `content/translations/en/posts/<slug>.json` with the
same shape as the Afrikaans source in `content/posts/<slug>.json`: copy `id` and
`slug`, translate `title`, `excerpt`, `seo`, `html` (translate text only — keep every
tag and attribute), and the recipe text fields if present. Set `sourceHash` to the
output of `npx tsx scripts/source-hash.mjs posts/<slug>`, then validate:

```bash
npx tsx scripts/check-translation.mjs posts/<slug>   # must print OK
```

Commit and push. Untranslated posts simply show Afrikaans under `/en/` in the
meantime. (Asking Claude Code to "translate the missing content" runs this whole
flow, including validation.)

### Preview locally

```bash
npm install
npm run sync:media   # first time only — mirrors images into public/media
npm run dev          # http://localhost:3000  (English at /en/)
```

On a fresh machine you can skip the slow origin download by seeding from the
release instead: download `media-mirror.tar.gz` from the **media-seed** release and
`tar xzf` it in the repo root before `npm run dev`.

### Deploy manually

Push to `main`, or **Actions → "Deploy to GitHub Pages" → Run workflow**. Content
comes from what's committed in `content/` — run the sync workflow first if you
want fresh WordPress content included.

### Change site text, styling, or layout

- UI strings and English chrome labels: `src/lib/i18n.ts`
- English category display names: `src/lib/en-category-names.json`
- Colors, fonts, post-content typography: `src/app/globals.css`
- Header/nav/footer: `src/components/chrome/`; sidebar widgets:
  `src/components/widgets/`; recipe card: `src/components/post/RecipeCard.tsx`
- Nav menus, bio text, newsletter copy shown on the Afrikaans site come from
  WordPress via `content/site.json` — edit them in WordPress and re-sync.

### Fix or refresh images

- A handful of images 404 on the WordPress site itself; the sync logs them as
  "gone at origin" and they're skipped. Re-upload them in WordPress and re-sync
  to heal them here.
- If images changed in WordPress at the same URL, force a re-mirror locally with
  `FORCE_MEDIA_REFRESH=1 npm run sync:media`, then `npm run optimize:media` and
  refresh the seed (next task).

### Refresh the media seed release

After large media changes, update the seed CI uses on cold caches:

```bash
tar czf media-mirror.tar.gz public/media content/media-optimized.json
gh release upload media-seed media-mirror.tar.gz --clobber
```

## Deployment

Two GitHub Actions workflows:

- **`deploy.yml`** — on every push to `main` (and manually): restores the media mirror
  from the Actions cache (cold caches are seeded from the `media-seed` GitHub release
  because the WordPress host rate-limits bulk downloads — refresh it occasionally with
  `tar czf media-mirror.tar.gz public/media content/media-optimized.json &&
  gh release upload media-seed media-mirror.tar.gz --clobber`), downloads anything
  new, optimizes, builds and publishes to GitHub Pages. Configuration via repository variables (Settings → Secrets and
  variables → Actions → Variables): `SITE_URL` (origin only, no path — currently
  `https://morsontologica.com`) and `BASE_PATH` (default `/marindakook`).
  For a dedicated custom domain later: set `SITE_URL=https://marindakook.co.za`,
  `BASE_PATH=` (empty), and add the domain in Pages settings.
- **`sync.yml`** — weekly (Mon 04:00 UTC) and manually: re-syncs content from
  WordPress, commits changes, and triggers a deploy. New WordPress posts appear in
  Afrikaans automatically; run the translation flow for new English content and commit
  it.

## What intentionally still points at WordPress

- **Shop/WooCommerce** (`/shop`, `/product/...`) — checkout can't be static; links go
  to the live WordPress shop.
- **Newsletter signups** — the form posts to the WordPress Mailchimp-for-WP endpoint.
- **New comments** — not possible on a static site. Existing comments (2,000+) are
  rendered read-only; posts show "Comments are closed."
- **Print recipe** uses the browser's print dialog with a print stylesheet instead of
  the WordPress print page.

## Content layout

```
content/
  site.json            site chrome: nav, widgets, bio, newsletter, sidebar lists
  terms.json           categories + tags
  posts/<slug>.json    full post: html, recipe, comments, seo
  pages/<slug>.json    the two static pages (Oor My, Besprekings en Kookboeke)
  translations/en/     English content (sourceHash-tracked)
  media-manifest.json  every image the site needs (url → local path)
```

## Chat CMS (`server/`)

A Cloudflare Worker under `server/` lets Marinda write and publish recipes by
chatting with Claude instead of using the WordPress admin: an MCP connector runs an
Afrikaans interview, a mobile upload page collects photos, drafts translate to
English automatically, and a preview/approval page gates publishing — which commits
straight to this repo. It is **built and tested** (182 server tests + the root
suite above, all green against mocked GitHub/Anthropic and local KV/R2/OAuth) but
**not yet deployed or live**: going live needs both real-infrastructure provisioning
(Cloudflare/GitHub App/Anthropic accounts and secrets) and the WordPress
decommission (site media committed into git). See `server/README.md` for the full
provisioning runbook and go-live checklist, and
`docs/superpowers/specs/2026-07-20-chat-cms-design.md` for the design spec.
