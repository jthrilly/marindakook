import { mkdir, writeFile } from "node:fs/promises";
import { parse } from "node-html-parser";
import { WP_URL, getJson, getAllPaged, getHtml } from "./lib/wp.mjs";
import { mediaUrls, rewriteHtml, rewriteUrl, rewriteSrcset, uploadUrlToLocal } from "./lib/rewrite.mjs";
import { parseRecipeCard } from "./lib/recipe.mjs";

const CONTENT_DIR = new URL("../content/", import.meta.url);
const warnings = [];

function slugFromLink(link) {
  const path = rewriteUrl(link);
  return path.replace(/^\/|\/$/g, "");
}

function cleanExcerpt(html) {
  const root = parse(html);
  return root.textContent.replace(/\[&hellip;\]|\[…\]/g, "…").replace(/\s+/g, " ").trim();
}

function pickSize(sizes, names, sourceUrl) {
  for (const name of names) {
    const s = sizes?.[name];
    if (s?.source_url ?? s?.url) {
      const url = s.source_url ?? s.url;
      return { url, width: s.width, height: s.height };
    }
  }
  return sourceUrl ? { url: sourceUrl, width: null, height: null } : null;
}

function localImage(picked) {
  if (!picked) return null;
  mediaUrls.add(picked.url.split("?")[0]);
  return { src: uploadUrlToLocal(picked.url) ?? picked.url, width: picked.width, height: picked.height };
}

function processContent(html) {
  const root = parse(html);
  const recipe = parseRecipeCard(root, warnings);
  rewriteHtml(root);
  for (const el of root.querySelectorAll("script")) el.remove();
  return { html: root.innerHTML.trim(), recipe };
}

async function writeJson(rel, data) {
  const url = new URL(rel, CONTENT_DIR);
  await mkdir(new URL(".", url), { recursive: true });
  await writeFile(url, JSON.stringify(data, null, 1));
}

console.log("Fetching taxonomy…");
const [categories, tags] = await Promise.all([
  getAllPaged("/wp/v2/categories?_fields=id,name,slug,description,parent,count"),
  getAllPaged("/wp/v2/tags?_fields=id,name,slug,description,count"),
]);
await writeJson("terms.json", { categories, tags });

console.log("Fetching posts…");
const rawPosts = await getAllPaged(
  "/wp/v2/posts?_fields=id,slug,link,date,modified,title,content,excerpt,categories,tags,featured_media,comment_status,yoast_head_json",
  { onPage: (p, n) => console.log(`  page ${p} (${n} posts)`) },
);

console.log("Fetching pages…");
const rawPages = await getAllPaged(
  "/wp/v2/pages?_fields=id,slug,link,date,modified,title,content,excerpt,yoast_head_json",
);

console.log("Fetching comments…");
const rawComments = await getAllPaged(
  "/wp/v2/comments?_fields=id,post,parent,author_name,author_avatar_urls,date,content",
  { onPage: (p, n) => console.log(`  page ${p} (${n} comments)`) },
);
const COMMENT_TAGS = new Set(["p", "br", "em", "strong", "b", "i", "a", "blockquote", "ul", "ol", "li", "code"]);
function sanitizeCommentHtml(html) {
  const root = parse(html);
  function scrub(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== 1) continue;
      const tag = child.rawTagName?.toLowerCase();
      if (!tag || !COMMENT_TAGS.has(tag)) {
        child.replaceWith(...child.childNodes);
        scrub(node);
        continue;
      }
      const href = child.getAttribute("href");
      child.rawAttrs = "";
      if (tag === "a" && href && /^https?:\/\//i.test(href)) {
        child.setAttribute("href", href);
        child.setAttribute("rel", "nofollow noopener");
      }
      scrub(child);
    }
  }
  scrub(root);
  return root.innerHTML.trim();
}

const commentsByPost = new Map();
for (const c of rawComments) {
  if (!commentsByPost.has(c.post)) commentsByPost.set(c.post, []);
  commentsByPost.get(c.post).push({
    id: c.id,
    parent: c.parent,
    author: c.author_name,
    avatar: c.author_avatar_urls?.["96"] ?? null,
    date: c.date,
    html: sanitizeCommentHtml(c.content.rendered),
  });
}

console.log("Fetching featured media…");
const featuredIds = [...new Set(rawPosts.map((p) => p.featured_media).filter(Boolean))];
const mediaById = new Map();
for (let i = 0; i < featuredIds.length; i += 100) {
  const batch = featuredIds.slice(i, i + 100);
  const items = await getJson(
    `/wp/v2/media?include=${batch.join(",")}&per_page=100&_fields=id,alt_text,source_url,media_details`,
  );
  for (const m of items) mediaById.set(m.id, m);
  console.log(`  ${mediaById.size}/${featuredIds.length}`);
}

console.log("Processing posts…");
const postIndex = [];
for (const p of rawPosts) {
  const slug = decodeURIComponent(p.slug);
  const { html, recipe } = processContent(p.content.rendered);
  const media = mediaById.get(p.featured_media);
  const sizes = media?.media_details?.sizes;
  const featured = media
    ? {
        alt: media.alt_text || parse(p.title.rendered).textContent,
        card: localImage(pickSize(sizes, ["loop@2x", "loop", "large", "medium_large"], media.source_url)),
        portrait: localImage(pickSize(sizes, ["loop-portrait@2x", "loop@2x", "large"], media.source_url)),
        thumb: localImage(pickSize(sizes, ["thumbnail", "medium"], media.source_url)),
      }
    : null;
  const title = parse(p.title.rendered).textContent.trim();
  const comments = commentsByPost.get(p.id) ?? [];
  postIndex.push({
    id: p.id,
    slug,
    title,
    date: p.date,
    excerpt: cleanExcerpt(p.excerpt.rendered),
    categories: p.categories,
    tags: p.tags,
    featured,
    hasRecipe: Boolean(recipe),
    commentCount: comments.length,
  });
  await writeJson(`posts/${slug}.json`, {
    id: p.id,
    slug,
    title,
    date: p.date,
    modified: p.modified,
    excerpt: cleanExcerpt(p.excerpt.rendered),
    categories: p.categories,
    tags: p.tags,
    featured,
    commentStatus: p.comment_status,
    seo: {
      title: p.yoast_head_json?.title ?? title,
      description: p.yoast_head_json?.description ?? null,
    },
    html,
    recipe,
    comments,
  });
}
postIndex.sort((a, b) => (a.date < b.date ? 1 : -1));
await writeJson("posts-index.json", postIndex);

console.log("Processing pages…");
for (const p of rawPages) {
  const slug = decodeURIComponent(p.slug);
  const { html } = processContent(p.content.rendered);
  await writeJson(`pages/${slug}.json`, {
    id: p.id,
    slug,
    title: parse(p.title.rendered).textContent.trim(),
    date: p.date,
    modified: p.modified,
    seo: {
      title: p.yoast_head_json?.title ?? parse(p.title.rendered).textContent.trim(),
      description: p.yoast_head_json?.description ?? null,
    },
    html,
  });
}

console.log("Parsing homepage for widget state…");
const home = parse(await getHtml("/"));
function sidebarList(containerSelector) {
  const items = [];
  for (const a of home.querySelectorAll(`${containerSelector} a`)) {
    const href = a.getAttribute("href") ?? "";
    if (!href.includes(WP_URL)) continue;
    const t = a.textContent.replace(/\s+/g, " ").trim();
    if (t) items.push({ title: t, slug: slugFromLink(href) });
  }
  return [...new Map(items.map((i) => [i.slug, i])).values()];
}
const popularViews = sidebarList('[id^="wpzoom-popular-recipes-views"]');
const popularComments = sidebarList('[id^="wpzoom-popular-recipes-comments"]');
const tabTitles = home
  .querySelectorAll(".tabber .tabbertab > h2.widgettitle")
  .map((el) => el.textContent.trim());
const sectionTitle = home.querySelector("section.content-area > h2.section-title")?.textContent.trim();
const newsletterHeading = home.querySelector(".newsletter-form h3")?.textContent.trim();
const newsletterInput = home.querySelector('.mc4wp-form input[type="email"]');
const newsletterButton = home.querySelector('.mc4wp-form input[type="submit"], .mc4wp-form button');
const bioImg = home.querySelector('[id^="wpzoom-bio"] img');
const readMore = home.querySelector(".readmore_button a")?.textContent.trim();

const logoImg = home.querySelector(".navbar-brand-wpz img, .site-logo img, a.custom-logo-link img");

const site = {
  wpUrl: WP_URL,
  name: "Marinda Kook",
  tagline: "Maklike Suid-Afrikaanse Resepte",
  logo: logoImg
    ? {
        src: rewriteUrl(logoImg.getAttribute("src")),
        srcset: rewriteSrcset(logoImg.getAttribute("srcset")),
        width: Number(logoImg.getAttribute("width")) || null,
        height: Number(logoImg.getAttribute("height")) || null,
      }
    : null,
  nav: {
    top: [
      { label: "Oor My", path: "/oor-my/" },
      { label: "Besprekings en Kookboeke", path: "/optredes/" },
    ],
    main: [
      { label: "Tuis", path: "/" },
      { label: "Voorgereg", path: "/category/voorgereg/" },
      { label: "Hoofgereg", path: "/category/hoofgereg/" },
      { label: "Nagereg", path: "/category/nagereg/" },
      { label: "Bykosse", path: "/category/bykosse/" },
      { label: "Gebak", path: "/category/gebak/" },
    ],
  },
  social: [
    { network: "facebook", url: "https://www.facebook.com/marindakook", color: "#1877F2" },
    { network: "instagram", url: "https://www.instagram.com/marindakook/", color: "#e4405f" },
    { network: "youtube", url: "https://www.youtube.com/channel/UCsH25DP7xkAJsN89Zs7TDCw", color: "#e02a20" },
  ],
  bio: {
    name: "Marinda Engelbrecht",
    about:
      "Hierdie is geen fênsie kookblog nie.  Dis sommer net ‘n eenvoudige webwerf sodat my kinders en hulle vriende en hulle vriende se vriende kan leer kook. Sodat hulle my nie so baie hoef te bel om te hoor: hoe maak mens… nie.",
    photo: bioImg ? rewriteUrl(bioImg.getAttribute("src")) : null,
    button: { label: "Lees Meer", path: "/oor-my/" },
  },
  sidebar: {
    tabs: { views: tabTitles[0] ?? "Gewildste", comments: tabTitles[1] ?? "Kommentaar" },
    popularViews,
    popularComments,
    featurePosts: { title: "Nuwe Resepte", count: 3 },
    socialWidget: {
      title: "Gesels saam",
      description: "Volg al Marinda se mannewales op sosiale media. Kom gesels saam!",
    },
    categoriesWidget: { title: "Kategoriëe" },
  },
  home: {
    sectionTitle: sectionTitle ?? "Nuutste Resepte",
    featuredCategory: "featured",
    readMore: readMore ?? "Read More",
  },
  newsletter: {
    heading: newsletterHeading ?? "Sluit aan by ons nuusbrief",
    placeholder: newsletterInput?.getAttribute("placeholder") ?? "Your email address",
    button: newsletterButton?.getAttribute("value") ?? newsletterButton?.textContent.trim() ?? "Sign up",
    action: `${WP_URL}/`,
  },
  postsPerPage: 10,
};
console.log("Writing media manifest…");
const manifestByPath = new Map();
for (const u of [...mediaUrls].filter((x) => x.includes("/wp-content/uploads/")).sort()) {
  const path = `public${uploadUrlToLocal(u)}`;
  if (!manifestByPath.has(path)) {
    manifestByPath.set(path, { url: u.startsWith("http") ? u : `${WP_URL}${u}`, path });
  }
}
const manifest = [...manifestByPath.values()];
if (site.bio.photo?.startsWith("http")) {
  manifest.push({ url: site.bio.photo, path: "public/media/bio-photo.jpg" });
  site.bio.photo = "/media/bio-photo.jpg";
}
await writeJson("site.json", site);
await writeJson("media-manifest.json", manifest);

await writeJson("sync-report.json", {
  syncedAt: null,
  posts: rawPosts.length,
  pages: rawPages.length,
  recipes: postIndex.filter((p) => p.hasRecipe).length,
  comments: rawComments.length,
  categories: categories.length,
  tags: tags.length,
  mediaFiles: manifest.length,
  warnings,
});
console.log(`Done: ${rawPosts.length} posts, ${postIndex.filter((p) => p.hasRecipe).length} recipes, ${manifest.length} media files.`);
if (warnings.length) {
  console.log(`Warnings (${warnings.length}):`);
  for (const w of [...new Set(warnings)].slice(0, 30)) console.log(`  - ${w}`);
}
