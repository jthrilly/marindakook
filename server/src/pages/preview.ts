import { z } from "zod";
import { sourceHashOf } from "@site/lib/source-hash";
import type { ChromeDraft, DraftPost, DraftRecipe } from "../core/draft-schema";
import { draftRecipeSchema } from "../core/draft-schema";
import type { DraftStore } from "../core/store";
import { buildTranslationSource, parseJobRecord, type TranslationJobRecord } from "../core/translation-job";

// The preview/approval page Marinda opens from a draft-scoped `get_preview_link`.
// It renders her draft's Afrikaans content and (when a validator-passing
// translation exists for the CURRENT content) the English side next to it —
// stacked on a phone, side by side from tablet width via a single CSS media
// query, no JS tabs needed. The Worker cannot run the Next/Tailwind build, so
// this is a hand-maintained, trimmed-down approximation of the site's visual
// language (colors/typography lifted from src/app/globals.css, layout lifted
// from RecipeCard.tsx/the chrome components) rather than the real compiled
// stylesheet — a close approximation, per spec, with fidelity checked
// manually in the pilot.
//
// The signed-link verifier is injected (D9 wires the real HMAC one); tests
// pass a stub, matching the upload page's pattern.

export interface PreviewLinkClaims {
  draftId: string;
}

export interface PreviewDeps {
  store: DraftStore;
  verifyLink: (token: string) => PreviewLinkClaims | null | Promise<PreviewLinkClaims | null>;
  now?: () => Date;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function tokenFrom(req: Request): string {
  return new URL(req.url).searchParams.get("sig") ?? "";
}

// A trimmed, hand-copied approximation of src/app/globals.css: the theme
// color tokens plus the small subset of `.entry-content`-style rules and a
// RecipeCard-like layout needed here, translated from Tailwind's `@apply`
// utilities to plain CSS since the Worker can't run the Tailwind build.
const PREVIEW_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.6;
  padding: 1.25rem;
  max-width: 60rem;
  margin-inline: auto;
  color: #222222;
  background: #ffffff;
}
h1 { font-size: 1.6rem; margin: 0 0 1.25rem; }
h1, h2, h3, h4 { color: #222222; }
.paneel-etiket {
  display: inline-block;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6d767f;
  border-bottom: 2px solid #f34d47;
  padding-bottom: 0.25rem;
  margin: 0 0 0.5rem;
}
.paneel-titel { font-size: 1.4rem; font-weight: 500; margin: 0.25rem 0 0.75rem; }
.paneele { display: block; }
.paneel {
  border: 1px solid #fdddcd;
  border-radius: 0.75rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  background: #ffffff;
}
.inhoud { color: #69574f; font-size: 0.95rem; }
.inhoud a { color: #f34d47; }
.resep-afdeling { border-top: 1px solid #f9ece6; padding-top: 0.75rem; margin-top: 0.75rem; }
.resep-afdeling h3 { font-size: 1.05rem; font-weight: 500; margin: 0 0 0.5rem; }
.resep-afdeling h4 { font-size: 0.95rem; font-weight: 500; margin: 0.75rem 0 0.25rem; }
.resep-afdeling ul, .resep-afdeling ol { padding-left: 1.25rem; margin: 0.5rem 0; }
.resep-afdeling li { margin-bottom: 0.4rem; }
.resep-notas { background: #f9ece6; padding: 0.75rem 1rem; border-radius: 0.5rem; }
.besonderhede {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  padding: 0.5rem 0;
  border-top: 1px solid #f9ece6;
  border-bottom: 1px solid #f9ece6;
  margin: 0.75rem 0;
}
.besonderheid { display: flex; flex-direction: column; }
.besonderheid-etiket { font-size: 0.7rem; text-transform: uppercase; color: #6d767f; }
.besonderheid-waarde { font-size: 1rem; }
.kennisgewing {
  background: rgba(185, 138, 46, 0.12);
  border: 1px solid #b98a2e;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  font-weight: 600;
}
.chrome-voorskou .chrome-afdeling {
  border: 1px solid #fdddcd;
  border-radius: 0.75rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}
.chrome-afdeling h3 { font-size: 1.05rem; font-weight: 500; margin: 0 0 0.5rem; }
.chrome-afdeling p { margin: 0.35rem 0; }
.keuring { margin-top: 2rem; text-align: center; }
#keur-goed {
  padding: 0.9rem 1.6rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: #ffffff;
  background: #f34d47;
  border: none;
  border-radius: 0.75rem;
  cursor: pointer;
}
@media (min-width: 48rem) {
  .paneele { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; align-items: start; }
}
`;

function pageShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="af">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PREVIEW_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// Exported so the Worker router can render it when a GET /upload or /preview
// arrives with a bad signature — the spec's "never a bare 403" rule applies to
// both pages, and this is the single friendly Afrikaans page they share.
export function renderExpiredLinkPage(): Response {
  return htmlResponse(
    pageShell(
      "Skakel het verval",
      `<h1>Skakel het verval</h1>
<p>Hierdie skakel het verval — vra in jou gesprek vir 'n nuwe skakel.</p>`,
    ),
  );
}

function renderApprovedPage(): Response {
  return htmlResponse(
    pageShell(
      "Lyk reg",
      `<h1>Lyk reg &#10003;</h1>
<p>Jou voorskou is goedgekeur. Gaan terug na jou gesprek&#8230;</p>`,
    ),
  );
}

function renderAlreadyPublishedPage(): Response {
  return htmlResponse(
    pageShell(
      "Reeds gepubliseer",
      `<h1>Reeds gepubliseer</h1>
<p>Hierdie resep is reeds gepubliseer. Vra in jou gesprek vir 'n nuwe skakel as jy dit wil wysig.</p>`,
    ),
  );
}

// A draft id is reused across a post's whole edit lifecycle, so once it has
// been published we can't tell "already published, nothing to review" apart
// from "published, then edited again" just from `store.get()` returning
// non-null. `getApproval` re-derives validity against the draft's CURRENT
// revision (see store.ts) and a successful publish requires approval, so a
// still-valid approval on a published draft means nothing has changed since
// that publish; a cleared one means a later edit bumped the revision and
// genuinely needs fresh review.
async function isPublishedAndUnchanged(deps: PreviewDeps, draftId: string): Promise<boolean> {
  const publishRecord = await deps.store.getPublish(draftId);
  if (publishRecord === null) {
    return false;
  }
  const approval = await deps.store.getApproval(draftId);
  return approval !== null;
}

function strOrEmpty(value: string | null | undefined): string {
  return value ?? "";
}

function renderDetails(details: DraftRecipe["details"]): string {
  const list = details ?? [];
  if (list.length === 0) {
    return "";
  }
  const chips = list
    .map((detail) => {
      const label = escapeHtml(strOrEmpty(detail.label));
      const value = (detail.pairs ?? [])
        .map((pair) => `${escapeHtml(strOrEmpty(pair.value))} ${escapeHtml(strOrEmpty(pair.unit))}`.trim())
        .filter((entry) => entry.length > 0)
        .join(", ");
      return `<div class="besonderheid"><span class="besonderheid-etiket">${label}</span><span class="besonderheid-waarde">${value}</span></div>`;
    })
    .join("");
  return `<div class="besonderhede">${chips}</div>`;
}

// Ingredient/step/note strings are authored HTML fragments, same as on the
// live site's RecipeCard component — inserted here as-is, not escaped,
// since this is Marinda's own authored content (from her chat interview),
// not third-party input.
function renderIngredients(recipe: DraftRecipe): string {
  const groups = recipe.ingredientGroups ?? [];
  if (groups.length === 0) {
    return "";
  }
  const body = groups
    .map((group) => {
      const heading = group.title ? `<h4>${escapeHtml(group.title)}</h4>` : "";
      const items = (group.items ?? []).map((item) => `<li>${item}</li>`).join("");
      return `${heading}<ul>${items}</ul>`;
    })
    .join("");
  return `<section class="resep-afdeling"><h3>${escapeHtml(strOrEmpty(recipe.ingredientsTitle))}</h3>${body}</section>`;
}

function renderDirections(recipe: DraftRecipe): string {
  const groups = recipe.directionGroups ?? [];
  if (groups.length === 0) {
    return "";
  }
  const body = groups
    .map((group) => {
      const heading = group.title ? `<h4>${escapeHtml(group.title)}</h4>` : "";
      const steps = (group.steps ?? []).map((step) => `<li>${step}</li>`).join("");
      return `${heading}<ol>${steps}</ol>`;
    })
    .join("");
  return `<section class="resep-afdeling"><h3>${escapeHtml(strOrEmpty(recipe.directionsTitle))}</h3>${body}</section>`;
}

function renderNotes(recipe: DraftRecipe): string {
  const notes = recipe.notes ?? [];
  if (notes.length === 0) {
    return "";
  }
  const items = notes.map((note) => `<li>${note}</li>`).join("");
  return `<section class="resep-afdeling resep-notas"><h3>${escapeHtml(strOrEmpty(recipe.notesTitle))}</h3><ul>${items}</ul></section>`;
}

function renderRecipe(recipe: DraftRecipe | undefined): string {
  if (!recipe) {
    return "";
  }
  return renderDetails(recipe.details) + renderIngredients(recipe) + renderDirections(recipe) + renderNotes(recipe);
}

function renderPostPanel(
  locale: "af" | "en",
  label: string,
  title: string | undefined,
  html: string | undefined,
  recipe: DraftRecipe | undefined,
): string {
  const titleHtml = `<h2 class="paneel-titel">${escapeHtml(strOrEmpty(title))}</h2>`;
  const introHtml = html ? `<div class="inhoud">${html}</div>` : "";
  return `<section class="paneel" data-locale="${locale}"><p class="paneel-etiket">${escapeHtml(label)}</p>${titleHtml}${introHtml}${renderRecipe(recipe)}</section>`;
}

const NOTICE_NOT_READY =
  "Die Engelse vertaling is nog nie gereed nie — vra die model in jou gesprek om dit te genereer.";
const NOTICE_PENDING = "Engelse vertaling nog nie gereed nie — dit word tans gemaak, kyk binnekort weer.";
const NOTICE_FAILING = "Engels volg later.";
const NOTICE_STALE = "Die Engelse vertaling is verouderd vir hierdie inhoud — genereer dit weer voor jy publiseer.";

type EnglishView =
  | { available: true; title: string | undefined; html: string | undefined; recipe: DraftRecipe | undefined }
  | { available: false; notice: string };

const translationContentSchema = z.object({
  title: z.string().optional(),
  html: z.string().optional(),
  recipe: draftRecipeSchema.optional(),
});

async function loadEnglishView(deps: PreviewDeps, draftId: string, draft: DraftPost): Promise<EnglishView> {
  const job: TranslationJobRecord | null = parseJobRecord(await deps.store.getJob(draftId));
  if (job === null) {
    return { available: false, notice: NOTICE_NOT_READY };
  }
  if (job.status === "pending") {
    return { available: false, notice: NOTICE_PENDING };
  }
  if (job.status === "failing") {
    return { available: false, notice: NOTICE_FAILING };
  }

  const currentHash = sourceHashOf(buildTranslationSource(draft));
  if (job.sourceHash !== currentHash) {
    return { available: false, notice: NOTICE_STALE };
  }

  const parsed = translationContentSchema.safeParse(job.translation);
  if (!parsed.success) {
    return { available: false, notice: NOTICE_NOT_READY };
  }
  return { available: true, title: parsed.data.title, html: parsed.data.html, recipe: parsed.data.recipe };
}

async function renderPostBody(deps: PreviewDeps, draftId: string, draft: DraftPost): Promise<string> {
  const afPanel = renderPostPanel("af", "Afrikaans", draft.title, draft.html, draft.recipe);
  const en = await loadEnglishView(deps, draftId, draft);
  const secondPanel = en.available
    ? renderPostPanel("en", "English", en.title, en.html, en.recipe)
    : `<p class="kennisgewing" role="status">${escapeHtml(en.notice)}</p>`;
  return `<h1>Resepvoorskou</h1><div class="paneele">${afPanel}${secondPanel}</div>`;
}

function chromeRow(label: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function chromeSection(title: string, bodyHtml: string): string {
  if (bodyHtml.trim().length === 0) {
    return "";
  }
  return `<section class="chrome-afdeling"><h3>${escapeHtml(title)}</h3>${bodyHtml}</section>`;
}

function renderChromeBody(draft: ChromeDraft): string {
  const site = draft.site;

  const headerRows = [
    chromeRow("Slagspreuk", site.tagline),
    ...(site.nav?.top ?? []).map((item) => chromeRow("Nav (bo)", item.label)),
    ...(site.nav?.main ?? []).map((item) => chromeRow("Nav (hoof)", item.label)),
  ].join("");

  const bioRows = [
    site.bio?.about ? `<p>${escapeHtml(site.bio.about)}</p>` : "",
    chromeRow("Knoppie", site.bio?.button?.label),
  ].join("");

  const sidebarRows = [
    chromeRow("Oortjie: uitsigte", site.sidebar?.tabs?.views),
    chromeRow("Oortjie: kommentaar", site.sidebar?.tabs?.comments),
    chromeRow("Uitgesoekte plasings", site.sidebar?.featurePosts?.title),
    chromeRow("Sosiale titel", site.sidebar?.socialWidget?.title),
    chromeRow("Sosiale beskrywing", site.sidebar?.socialWidget?.description),
    chromeRow("Kategorieë-titel", site.sidebar?.categoriesWidget?.title),
    chromeRow("Tuisblad-afdelingtitel", site.home?.sectionTitle),
    chromeRow("Lees-meer-teks", site.home?.readMore),
  ].join("");

  const footerRows = [
    chromeRow("Nuusbrief-opskrif", site.newsletter?.heading),
    chromeRow("Nuusbrief-plekhouer", site.newsletter?.placeholder),
    chromeRow("Nuusbrief-knoppie", site.newsletter?.button),
  ].join("");

  const sections = [
    chromeSection("Kopstuk / Navigasie", headerRows),
    chromeSection("Oor my", bioRows),
    chromeSection("Kantstrook", sidebarRows),
    chromeSection("Voetstuk / Nuusbrief", footerRows),
  ].join("");

  return `<h1>Webwerf-teks-voorskou</h1><div class="chrome-voorskou">${sections}</div>`;
}

// No `action` attribute: per the HTML form-submission algorithm, an omitted
// action resolves to the document's own URL INCLUDING its query string, so
// this plain POST carries the exact `sig` the page was loaded with — no
// client JS needed to thread the signed link through to handleApprove.
const approveControl = `<form class="keuring" method="post">
  <button id="keur-goed" type="submit">Lyk reg &#10003;</button>
</form>`;

export async function renderPreviewPage(draftId: string, deps: PreviewDeps): Promise<Response> {
  const stored = await deps.store.get(draftId);
  if (stored === null) {
    return renderExpiredLinkPage();
  }

  if (await isPublishedAndUnchanged(deps, draftId)) {
    return renderAlreadyPublishedPage();
  }

  const body =
    stored.draft.kind === "post"
      ? await renderPostBody(deps, draftId, stored.draft)
      : renderChromeBody(stored.draft);

  const title = stored.draft.kind === "post" ? "Resepvoorskou" : "Webwerf-teks-voorskou";
  return htmlResponse(pageShell(title, `${body}${approveControl}`));
}

export async function handleApprove(req: Request, deps: PreviewDeps): Promise<Response> {
  const claims = await deps.verifyLink(tokenFrom(req));
  if (claims === null) {
    return renderExpiredLinkPage();
  }

  const stored = await deps.store.get(claims.draftId);
  if (stored === null) {
    return renderExpiredLinkPage();
  }

  if (await isPublishedAndUnchanged(deps, claims.draftId)) {
    return renderAlreadyPublishedPage();
  }

  const approvedAt = (deps.now ?? (() => new Date()))().toISOString();
  await deps.store.setApproval(claims.draftId, { revision: stored.revision, approvedAt });
  return renderApprovedPage();
}
