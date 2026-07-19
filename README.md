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
| `npm run dev` | Dev server |
| `npm run build` | Static build into `out/` (runs the search-index generator first) |

## Deployment

Two GitHub Actions workflows:

- **`deploy.yml`** — on every push to `main` (and manually): restores the media mirror
  from the Actions cache, downloads anything new, optimizes, builds and publishes to
  GitHub Pages. Configuration via repository variables (Settings → Secrets and
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
  posts-index.json     ordered post summaries (cards, archives)
  posts/<slug>.json    full post: html, recipe, comments, seo
  pages/<slug>.json    the two static pages (Oor My, Besprekings en Kookboeke)
  translations/en/     English content (sourceHash-tracked)
  media-manifest.json  every image the site needs (url → local path)
```
