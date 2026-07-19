import { getPostIndex, getSite } from "@/lib/content";
import { absoluteUrl, asset } from "@/lib/paths";

export const dynamic = "force-static";

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function GET() {
  const [site, index] = await Promise.all([getSite(), getPostIndex()]);
  const items = index
    .slice(0, 20)
    .map((post) => {
      const url = absoluteUrl(asset(`/${post.slug}/`));
      return `  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${url}</link>
    <guid isPermaLink="true">${url}</guid>
    <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    <description>${escapeXml(post.excerpt)}</description>
  </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeXml(site.name)}</title>
  <link>${absoluteUrl(asset("/"))}</link>
  <description>${escapeXml(site.tagline)}</description>
  <language>af</language>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
