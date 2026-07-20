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
