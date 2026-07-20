import type { Comment, FeaturedImage, NavItem, Post, Recipe, Site } from "@site/lib/content-schema";
import { sourceHashOf } from "@site/lib/source-hash";
import type { ChromeDraft, DraftPost } from "./draft-schema";
import type { JsonValue } from "./store";

// Pure builders that turn a loose DraftPost into the COMPLETE, server-managed
// shape publish then runs through postSchema/pageSchema.parse. The gate lives in
// publish.ts (parse + name-the-field on failure); here we only fill the fields
// Marinda never authors: ids, dates, comment state, and the deterministic
// `-WxH` rendition paths derived from the hero photo (materialized by CI).

// Route segments the site owns; a new slug may never collide with one.
export const RESERVED_SLUGS = ["category", "tag", "page", "search", "en"];

const MEDIA_COMMIT_ROOT = "public/media/uploads";
const MEDIA_URL_ROOT = "/media/uploads";

// The three renditions WordPress used to generate; the hero original is the
// only file the Worker commits, CI crops the rest from these deterministic paths.
const RENDITIONS = {
  card: { w: 760, h: 760 },
  portrait: { w: 760, h: 990 },
  thumb: { w: 150, h: 150 },
};

export function serializeContent(data: unknown): string {
  // The repo convention: 1-space indent, NO trailing newline, so chat-authored
  // and hand-edited files diff cleanly and reproduce byte-for-byte under the CI
  // sourceHash safety net.
  return JSON.stringify(data, null, 1);
}

export function mediaSubfolder(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

export function mediaUrl(subfolder: string, filename: string): string {
  return `${MEDIA_URL_ROOT}/${subfolder}/${filename}`;
}

export function mediaCommitPath(subfolder: string, filename: string): string {
  return `${MEDIA_COMMIT_ROOT}/${subfolder}/${filename}`;
}

// hero.jpg -> hero-760x760.jpg (suffix inserted before the extension).
export function renditionUrl(src: string, width: number, height: number): string {
  const dot = src.lastIndexOf(".");
  const suffix = `-${width}x${height}`;
  return dot === -1 ? `${src}${suffix}` : `${src.slice(0, dot)}${suffix}${src.slice(dot)}`;
}

export function buildFeatured(heroUrl: string, alt: string): FeaturedImage {
  return {
    alt,
    card: {
      src: renditionUrl(heroUrl, RENDITIONS.card.w, RENDITIONS.card.h),
      width: RENDITIONS.card.w,
      height: RENDITIONS.card.h,
    },
    portrait: {
      src: renditionUrl(heroUrl, RENDITIONS.portrait.w, RENDITIONS.portrait.h),
      width: RENDITIONS.portrait.w,
      height: RENDITIONS.portrait.h,
    },
    thumb: {
      src: renditionUrl(heroUrl, RENDITIONS.thumb.w, RENDITIONS.thumb.h),
      width: RENDITIONS.thumb.w,
      height: RENDITIONS.thumb.h,
    },
  };
}

export function buildRecipeImage(heroUrl: string, alt: string): NonNullable<Recipe["image"]> {
  return {
    src: renditionUrl(heroUrl, RENDITIONS.card.w, RENDITIONS.card.h),
    srcset: null,
    width: RENDITIONS.card.w,
    height: RENDITIONS.card.h,
    alt,
  };
}

type DraftRecipe = NonNullable<DraftPost["recipe"]>;

export function buildRecipe(draftRecipe: DraftRecipe, image: Recipe["image"], fallbackTitle: string): Recipe {
  return {
    style: draftRecipe.style ?? "default",
    title: draftRecipe.title ?? fallbackTitle,
    author: draftRecipe.author ?? null,
    image,
    courses: draftRecipe.courses ?? [],
    cuisines: draftRecipe.cuisines ?? [],
    difficulties: draftRecipe.difficulties ?? [],
    summaryHtml: draftRecipe.summaryHtml ?? null,
    details: (draftRecipe.details ?? []).map((detail) => ({
      icon: detail.icon ?? null,
      label: detail.label ?? "",
      pairs: (detail.pairs ?? []).map((pair) => ({ value: pair.value ?? "", unit: pair.unit ?? "" })),
    })),
    ingredientsTitle: draftRecipe.ingredientsTitle ?? null,
    ingredientGroups: (draftRecipe.ingredientGroups ?? []).map((group) => ({
      title: group.title ?? null,
      items: group.items ?? [],
    })),
    directionsTitle: draftRecipe.directionsTitle ?? null,
    directionGroups: (draftRecipe.directionGroups ?? []).map((group) => ({
      title: group.title ?? null,
      steps: group.steps ?? [],
    })),
    notesTitle: draftRecipe.notesTitle ?? null,
    notes: draftRecipe.notes ?? [],
    videoHtml: draftRecipe.videoHtml ?? null,
  };
}

function buildSeo(draftSeo: DraftPost["seo"], title: string | undefined): Record<string, unknown> {
  const fallback = title === undefined ? undefined : `${title} - Marinda Kook`;
  return { title: draftSeo?.title ?? fallback, description: draftSeo?.description ?? null };
}

export interface PostServerFields {
  id: number;
  date: string;
  modified: string;
  commentStatus: string;
  comments: Comment[];
  // The resolved category ids: the draft's chosen categories with the "featured"
  // bookkeeping term added/removed to match the interview's voorblad answer
  // (see applyFeaturedTerm). Server-managed, not authored verbatim.
  categories: number[];
  // The resolved hero imagery: freshly built from a newly-staged hero, or the
  // existing post's imagery carried through an edit that added no new photo.
  featured: FeaturedImage | null;
  recipeImage: Recipe["image"];
}

// Reconcile the "featured" bookkeeping term against the interview's voorblad
// answer: present exactly once when featured, absent otherwise. Order of the
// other categories is preserved and the result is idempotent, so a retried
// publish commits byte-identical categories. A null id (no "featured" term in
// the injected taxonomy) leaves the categories untouched.
export function applyFeaturedTerm(
  categories: number[],
  featured: boolean,
  featuredTermId: number | null,
): number[] {
  if (featuredTermId === null) {
    return categories;
  }
  const without = categories.filter((id) => id !== featuredTermId);
  return featured ? [...without, featuredTermId] : without;
}

// Assemble the candidate Post. Content fields are copied as-is (a missing title
// or html stays `undefined`) so postSchema.parse surfaces exactly which required
// field the draft still lacks — the completeness gate, not a silent default.
export function buildPostCandidate(
  draft: DraftPost,
  slug: string,
  server: PostServerFields,
): Record<string, unknown> {
  return {
    id: server.id,
    slug,
    title: draft.title,
    date: server.date,
    modified: server.modified,
    excerpt: draft.excerpt ?? "",
    categories: server.categories,
    tags: draft.tags ?? [],
    featured: server.featured,
    commentStatus: server.commentStatus,
    seo: buildSeo(draft.seo, draft.title),
    html: draft.html,
    recipe:
      draft.recipe === undefined
        ? null
        : buildRecipe(draft.recipe, server.recipeImage, draft.title ?? ""),
    comments: server.comments,
  };
}

// ── Committed translation reconciliation ─────────────────────────────────────
// The translation job stores the model's PASSING candidate: draft-shaped, loose,
// and validated (compareTranslation) only against the Afrikaans DRAFT source —
// which carries no recipe image and a sparse recipe. Committing that candidate
// verbatim (the old translationFileFrom) breaks all three of the committed
// translation's consumers: translationSchema (strict, full recipe), the sync's
// compareTranslation against the built POST (image/details must equal the post's),
// and the CI sourceHash net (hashed over the POST, not the draft).
//
// reconcileTranslation rebuilds the committed file from the built, parsed Post as
// the skeleton and overlays only the candidate's translated TEXT. The result
// satisfies translationSchema.parse, makes compareTranslation(post, result) === [],
// and stamps sourceHashOf(post) — the same basis CI recomputes.

function jsonRecord(value: JsonValue): { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonArray(value: JsonValue): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

// The candidate's translated string when it is a non-blank string, else the
// Afrikaans fallback. The fallback is only ever reached for a field the model
// left untranslated: it keeps the field non-empty and — for text copied from the
// Post — byte-identical, so compareTranslation still passes.
function translatedText(candidate: JsonValue, fallback: string): string {
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : fallback;
}

function translatedNullable(candidate: JsonValue, fallback: string | null): string | null {
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : fallback;
}

// compareTranslation flags an HTML field "present in one language only", so a
// field the Post left null MUST stay null; otherwise take the model's translated
// HTML (its tag structure already matched the source) or fall back to the Post.
function translatedHtml(candidate: JsonValue, fallback: string | null): string | null {
  if (fallback === null) {
    return null;
  }
  return typeof candidate === "string" ? candidate : fallback;
}

// Translated taxonomy labels: free text with no equality or count check, so use
// the model's list when it is a clean string array, else copy the Post's.
function translatedStrings(candidate: JsonValue, fallback: string[]): string[] {
  if (!Array.isArray(candidate)) {
    return fallback;
  }
  const out: string[] = [];
  for (const item of candidate) {
    if (typeof item !== "string") {
      return fallback;
    }
    out.push(item);
  }
  return out;
}

// Rebuild the committed recipe: the Post supplies every structural / copied-
// unchanged field (image, details, counts, and the group scaffold), the candidate
// supplies translated text at each matching position. Mapping over the Post's
// groups/items guarantees the ingredient/step COUNTS equal the Post's.
function reconcileRecipe(candidate: JsonValue, postRecipe: Recipe): Record<string, unknown> {
  const c = jsonRecord(candidate);
  const cIngredientGroups = jsonArray(c.ingredientGroups);
  const cDirectionGroups = jsonArray(c.directionGroups);
  const cNotes = jsonArray(c.notes);
  return {
    style: postRecipe.style,
    title: translatedText(c.title, postRecipe.title),
    author: postRecipe.author,
    image: postRecipe.image,
    courses: translatedStrings(c.courses, postRecipe.courses),
    cuisines: translatedStrings(c.cuisines, postRecipe.cuisines),
    difficulties: translatedStrings(c.difficulties, postRecipe.difficulties),
    summaryHtml: translatedHtml(c.summaryHtml, postRecipe.summaryHtml),
    details: postRecipe.details,
    ingredientsTitle: translatedNullable(c.ingredientsTitle, postRecipe.ingredientsTitle),
    ingredientGroups: postRecipe.ingredientGroups.map((group, gi) => {
      const cg = jsonRecord(cIngredientGroups[gi]);
      const cItems = jsonArray(cg.items);
      return {
        title: translatedNullable(cg.title, group.title),
        items: group.items.map((item, ii) => translatedText(cItems[ii], item)),
      };
    }),
    directionsTitle: translatedNullable(c.directionsTitle, postRecipe.directionsTitle),
    directionGroups: postRecipe.directionGroups.map((group, gi) => {
      const cg = jsonRecord(cDirectionGroups[gi]);
      const cSteps = jsonArray(cg.steps);
      return {
        title: translatedNullable(cg.title, group.title),
        steps: group.steps.map((step, si) => translatedText(cSteps[si], step)),
      };
    }),
    notesTitle: translatedNullable(c.notesTitle, postRecipe.notesTitle),
    notes: postRecipe.notes.map((note, ni) => translatedText(cNotes[ni], note)),
    videoHtml: postRecipe.videoHtml,
  };
}

function reconcileSeo(candidate: JsonValue, postSeo: Post["seo"]): Record<string, unknown> {
  const c = jsonRecord(candidate);
  return {
    title: translatedText(c.title, postSeo.title),
    description:
      c.description === null || typeof c.description === "string" ? c.description : postSeo.description,
  };
}

// Build the committed English translation from the model's passing candidate and
// the built, parsed Post. Returns null when the stored candidate is not an object
// (a corrupt job record). The returned object is a plain-JSON candidate the caller
// runs through translationSchema.parse before committing.
export function reconcileTranslation(candidate: JsonValue, post: Post): Record<string, unknown> | null {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  return {
    id: post.id,
    slug: post.slug,
    sourceHash: sourceHashOf(post),
    title: translatedText(candidate.title, post.title),
    excerpt: translatedText(candidate.excerpt, post.excerpt),
    seo: reconcileSeo(candidate.seo, post.seo),
    html: typeof candidate.html === "string" ? candidate.html : post.html,
    recipe: post.recipe === null ? null : reconcileRecipe(candidate.recipe, post.recipe),
  };
}

export interface PageServerFields {
  id: number;
  date: string;
  modified: string;
}

export function buildPageCandidate(
  draft: DraftPost,
  slug: string,
  server: PageServerFields,
): Record<string, unknown> {
  return {
    id: server.id,
    slug,
    title: draft.title,
    date: server.date,
    modified: server.modified,
    seo: buildSeo(draft.seo, draft.title),
    html: draft.html,
  };
}

function mergeNav(current: NavItem[], patch: NonNullable<ChromeDraft["site"]["nav"]>["top"]): NavItem[] {
  if (patch === undefined) {
    return current;
  }
  return patch.map((item, index) => ({
    label: item.label ?? current[index]?.label ?? "",
    path: item.path ?? current[index]?.path ?? "",
  }));
}

// Layer a chrome draft's sparse edits onto the full live Site. Only the fields
// the chrome draft schema (and the en chrome translation) cover are editable;
// everything else is carried through untouched, so siteSchema.parse still holds.
export function applySiteChrome(site: Site, patch: ChromeDraft["site"]): Site {
  return {
    ...site,
    tagline: patch.tagline ?? site.tagline,
    nav: {
      top: mergeNav(site.nav.top, patch.nav?.top),
      main: mergeNav(site.nav.main, patch.nav?.main),
    },
    bio: {
      ...site.bio,
      about: patch.bio?.about ?? site.bio.about,
      button: { ...site.bio.button, label: patch.bio?.button?.label ?? site.bio.button.label },
    },
    sidebar: {
      ...site.sidebar,
      tabs: {
        views: patch.sidebar?.tabs?.views ?? site.sidebar.tabs.views,
        comments: patch.sidebar?.tabs?.comments ?? site.sidebar.tabs.comments,
      },
      featurePosts: {
        ...site.sidebar.featurePosts,
        title: patch.sidebar?.featurePosts?.title ?? site.sidebar.featurePosts.title,
      },
      socialWidget: {
        title: patch.sidebar?.socialWidget?.title ?? site.sidebar.socialWidget.title,
        description: patch.sidebar?.socialWidget?.description ?? site.sidebar.socialWidget.description,
      },
      categoriesWidget: {
        title: patch.sidebar?.categoriesWidget?.title ?? site.sidebar.categoriesWidget.title,
      },
    },
    home: {
      ...site.home,
      sectionTitle: patch.home?.sectionTitle ?? site.home.sectionTitle,
      readMore: patch.home?.readMore ?? site.home.readMore,
    },
    newsletter: {
      ...site.newsletter,
      heading: patch.newsletter?.heading ?? site.newsletter.heading,
      placeholder: patch.newsletter?.placeholder ?? site.newsletter.placeholder,
      button: patch.newsletter?.button ?? site.newsletter.button,
    },
  };
}
