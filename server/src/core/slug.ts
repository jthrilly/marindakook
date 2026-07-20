// Slug rules mirror the legacy WordPress export convention visible in
// content/posts/ filenames: lowercase, diacritics stripped, non-alphanumeric
// runs collapsed to single hyphens, collisions suffixed -2, -3, ...
// (e.g. boontjiebredie-2). Pure — the caller supplies the set of taken slugs
// (published posts + page slugs + reserved segments + open drafts).

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
