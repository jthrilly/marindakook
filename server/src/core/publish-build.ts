import type { Comment, FeaturedImage, NavItem, Recipe, Site } from "@site/lib/content-schema";
import type { ChromeDraft, DraftPost } from "./draft-schema";

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
  // The resolved hero imagery: freshly built from a newly-staged hero, or the
  // existing post's imagery carried through an edit that added no new photo.
  featured: FeaturedImage | null;
  recipeImage: Recipe["image"];
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
    categories: draft.categories ?? [],
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
