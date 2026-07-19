import type { MetadataRoute } from "next";
import { getPostIndex } from "@/lib/content";
import { allRoutePaths } from "@/lib/router";
import { absoluteUrl, asset } from "@/lib/paths";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [paths, index] = await Promise.all([allRoutePaths(), getPostIndex()]);
  const lastModByPath = new Map<string, string>();
  for (const post of index) lastModByPath.set(`/${post.slug}/`, post.date);

  const entries: MetadataRoute.Sitemap = [];
  for (const segments of paths) {
    if (segments[0] === "search") continue;
    const path = segments.length ? `/${segments.join("/")}/` : "/";
    for (const localized of [path, `/en${path}`]) {
      entries.push({
        url: absoluteUrl(asset(localized)),
        lastModified: lastModByPath.get(path),
        alternates: {
          languages: {
            af: absoluteUrl(asset(path)),
            en: absoluteUrl(asset(`/en${path}`)),
          },
        },
      });
    }
  }
  return entries;
}
