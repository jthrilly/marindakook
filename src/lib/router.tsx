import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPage,
  getPageSlugs,
  getPost,
  getPostIndex,
  getSite,
  getTerms,
  paginate,
} from "@/lib/content";
import { localizeSiteStrings } from "@/lib/i18n";
import { absoluteUrl, asset, categoryPath, homePath, localePath, postPath, tagPath, SITE_URL } from "@/lib/paths";
import type { Locale, Term } from "@/lib/types";
import { HomeView } from "@/views/HomeView";
import { ArchiveView } from "@/views/ArchiveView";
import { PostView } from "@/views/PostView";
import { PageView } from "@/views/PageView";
import { SearchView } from "@/views/SearchView";
import { Shell } from "@/components/Shell";
import { getDict } from "@/lib/i18n";

type Route =
  | { kind: "home"; page: number }
  | { kind: "archive"; taxonomy: "category" | "tag"; term: Term; page: number }
  | { kind: "post"; slug: string }
  | { kind: "page"; slug: string }
  | { kind: "search" };

function parsePagination(segments: string[]): { rest: string[]; page: number } | null {
  if (segments.length >= 2 && segments[segments.length - 2] === "page") {
    const page = Number(segments[segments.length - 1]);
    if (!Number.isInteger(page) || page < 2) return null;
    return { rest: segments.slice(0, -2), page };
  }
  return { rest: segments, page: 1 };
}

async function resolveRoute(segments: string[]): Promise<Route | null> {
  const parsed = parsePagination(segments);
  if (!parsed) return null;
  const { rest, page } = parsed;

  if (rest.length === 0) return { kind: "home", page };

  if (rest[0] === "category" || rest[0] === "tag") {
    if (rest.length !== 2) return null;
    const taxonomy = rest[0];
    const terms = await getTerms();
    const pool = taxonomy === "category" ? terms.categories : terms.tags;
    const term = pool.find((t) => t.slug === rest[1]);
    return term ? { kind: "archive", taxonomy, term, page } : null;
  }

  if (rest.length === 1 && page === 1) {
    if (rest[0] === "search") return { kind: "search" };
    const index = await getPostIndex();
    if (index.some((p) => p.slug === rest[0])) return { kind: "post", slug: rest[0] };
    const pages = await getPageSlugs();
    if (pages.includes(rest[0])) return { kind: "page", slug: rest[0] };
  }

  return null;
}

export async function renderRoute(locale: Locale, segments: string[]) {
  const route = await resolveRoute(segments);
  if (!route) notFound();
  const site = await getSite();
  const dict = getDict(locale);
  const currentPath = localePath(locale, `/${segments.join("/")}${segments.length ? "/" : ""}`);

  let body: React.ReactNode;
  switch (route.kind) {
    case "home":
      body = <HomeView locale={locale} page={route.page} />;
      break;
    case "archive":
      body = <ArchiveView locale={locale} kind={route.taxonomy} term={route.term} page={route.page} />;
      break;
    case "post":
      body = <PostView locale={locale} post={await getPost(route.slug, locale)} />;
      break;
    case "page":
      body = <PageView locale={locale} page={await getPage(route.slug, locale)} />;
      break;
    case "search":
      body = <SearchView locale={locale} />;
      break;
  }

  return (
    <Shell site={site} locale={locale} dict={dict} currentPath={currentPath}>
      {body}
    </Shell>
  );
}

function alternatesFor(locale: Locale, path: string): Metadata["alternates"] {
  return {
    canonical: absoluteUrl(asset(localePath(locale, path))),
    languages: {
      af: absoluteUrl(asset(path)),
      en: absoluteUrl(asset(`/en${path === "/" ? "/" : path}`)),
      "x-default": absoluteUrl(asset(path)),
    },
  };
}

export async function routeMetadata(locale: Locale, segments: string[]): Promise<Metadata> {
  const route = await resolveRoute(segments);
  const site = await getSite();
  const en = localizeSiteStrings(locale);
  const tagline = en ? en.tagline : site.tagline;
  const base: Metadata = { metadataBase: new URL(SITE_URL) };
  if (!route) return base;

  const plainPath = `/${segments.join("/")}${segments.length ? "/" : ""}`;
  const dict = getDict(locale);

  switch (route.kind) {
    case "home": {
      const title =
        route.page > 1
          ? `${site.name} - ${tagline} - ${dict.pageSuffix(route.page)}`
          : `${site.name} - ${tagline}`;
      return {
        ...base,
        title,
        description: tagline,
        alternates: alternatesFor(locale, plainPath),
        openGraph: { title: site.name, description: tagline, type: "website", siteName: site.name },
      };
    }
    case "archive": {
      const suffix = route.page > 1 ? ` - ${dict.pageSuffix(route.page)}` : "";
      return {
        ...base,
        title: `${route.term.name}${suffix} - ${site.name}`,
        description: route.term.description || `${route.term.name} - ${site.name}`,
        alternates: alternatesFor(locale, plainPath),
      };
    }
    case "post": {
      const post = await getPost(route.slug, locale);
      const ogImage = post.featured?.card ? [absoluteUrl(asset(post.featured.card.src))] : undefined;
      return {
        ...base,
        title: post.seo.title,
        description: post.seo.description ?? post.excerpt,
        alternates: alternatesFor(locale, plainPath),
        openGraph: {
          title: post.title,
          description: post.seo.description ?? post.excerpt,
          type: "article",
          publishedTime: post.date,
          modifiedTime: post.modified,
          images: ogImage,
          siteName: site.name,
        },
      };
    }
    case "page": {
      const page = await getPage(route.slug, locale);
      return {
        ...base,
        title: page.seo.title,
        description: page.seo.description,
        alternates: alternatesFor(locale, plainPath),
      };
    }
    case "search":
      return { ...base, title: `${dict.searchTitle} - ${site.name}`, robots: { index: false } };
  }
}

export async function allRoutePaths(): Promise<string[][]> {
  const [site, index, terms, pageSlugs] = await Promise.all([
    getSite(),
    getPostIndex(),
    getTerms(),
    getPageSlugs(),
  ]);
  const perPage = site.postsPerPage;
  const paths: string[][] = [];

  paths.push([]);
  const homePages = paginate(index, 1, perPage).totalPages;
  for (let p = 2; p <= homePages; p++) paths.push(["page", String(p)]);

  for (const slug of pageSlugs) paths.push([slug]);
  for (const post of index) paths.push([post.slug]);

  for (const taxonomy of ["category", "tag"] as const) {
    const pool = taxonomy === "category" ? terms.categories : terms.tags;
    for (const term of pool) {
      const count = index.filter((p) =>
        (taxonomy === "category" ? p.categories : p.tags).includes(term.id),
      ).length;
      if (count === 0) continue;
      paths.push([taxonomy, term.slug]);
      const totalPages = Math.ceil(count / perPage);
      for (let p = 2; p <= totalPages; p++) paths.push([taxonomy, term.slug, "page", String(p)]);
    }
  }

  paths.push(["search"]);
  return paths;
}

export { categoryPath, homePath, postPath, tagPath };
