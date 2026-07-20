import type { Locale } from "./content-schema";

// Origin only — basePath is applied separately via asset(), so a path-bearing
// SITE_URL would double the base path in every absolute URL.
export const SITE_URL = (process.env.SITE_URL ?? "https://jthrilly.github.io").replace(/\/$/, "");
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function localePath(locale: Locale, path: string): string {
  const normalized = path.endsWith("/") || path.includes("?") || path.includes("#") ? path : `${path}/`;
  return locale === "af" ? normalized : `/en${normalized}`;
}

export function postPath(locale: Locale, slug: string): string {
  return localePath(locale, `/${slug}/`);
}

export function categoryPath(locale: Locale, slug: string, page = 1): string {
  return localePath(locale, page > 1 ? `/category/${slug}/page/${page}/` : `/category/${slug}/`);
}

export function tagPath(locale: Locale, slug: string, page = 1): string {
  return localePath(locale, page > 1 ? `/tag/${slug}/page/${page}/` : `/tag/${slug}/`);
}

export function homePath(locale: Locale, page = 1): string {
  return localePath(locale, page > 1 ? `/page/${page}/` : "/");
}

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

// For plain <img>/<a> attributes, which Next does not basePath-prefix.
export function asset(path: string): string {
  return path.startsWith("/") ? `${BASE_PATH}${path}` : path;
}

// Content HTML stores site-relative URLs (/media/..., /some-post/); the
// basePath only exists at build time, so it is injected here.
export function withBasePath(html: string): string {
  if (!BASE_PATH) return html;
  return html
    .replaceAll('src="/media/', `src="${BASE_PATH}/media/`)
    .replaceAll(/srcset="([^"]*)"/g, (_, set: string) =>
      `srcset="${set.replaceAll("/media/", `${BASE_PATH}/media/`)}"`,
    )
    .replaceAll(/href="\/(?!\/)/g, `href="${BASE_PATH}/`);
}
