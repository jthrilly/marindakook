import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Page, Post } from "@site/lib/content-schema";
import { draftPostSchema, type DraftPost } from "../../core/draft-schema";
import { rankSimilarPosts } from "../similarity";
import { describeZodIssue } from "../issues";
import { ok, fail } from "../result";
import type { ToolContext } from "../server";

const contentTypeSchema = z.enum(["post", "page"]);

// A post's recipe carries a materialized `image` the draft schema forbids; drop
// it (publish rebuilds imagery from the hero or preserves the existing post's).
function recipeToDraft(recipe: Post["recipe"]): DraftPost["recipe"] {
  if (recipe === null) {
    return undefined;
  }
  const rest = { ...recipe };
  Reflect.deleteProperty(rest, "image");
  return rest;
}

function draftFromPost(
  post: Post,
  draftId: string,
  nowIso: string,
  featuredTermId: number | undefined,
): DraftPost {
  const settled = ["title", "categories", "recipe", "story", "featured", "photo"];
  // Seed featured from the loaded post's existing category membership so an
  // edit-then-republish preserves it (applyFeaturedTerm strips the term whenever
  // interview.featured !== true, which would silently un-feature the post).
  const featured = featuredTermId !== undefined && post.categories.includes(featuredTermId);
  return {
    draftId,
    kind: "post",
    createdAt: nowIso,
    updatedAt: nowIso,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    categories: post.categories,
    tags: post.tags,
    html: post.html,
    seo: post.seo,
    recipe: recipeToDraft(post.recipe),
    interview: { settled, pending: [], featured },
  };
}

function draftFromPage(page: Page, draftId: string, nowIso: string): DraftPost {
  return {
    draftId,
    kind: "post",
    createdAt: nowIso,
    updatedAt: nowIso,
    title: page.title,
    slug: page.slug,
    html: page.html,
    seo: page.seo,
    interview: { settled: ["title", "story"], pending: [], featured: false },
  };
}

const EDIT_FIELDS = ["title", "excerpt", "categories", "tags", "html", "seo", "recipe"] as const;

export function registerEditTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "find_posts",
    {
      title: "Soek bestaande poste",
      description:
        "Soek gepubliseerde poste (of die twee bladsye) op titel om een te wysig of te verwyder.",
      inputSchema: {
        query: z.string().describe("Woorde uit die titel om na te soek."),
        type: contentTypeSchema.optional().describe("«post» (verstek) of «page»."),
      },
    },
    async (args) => {
      if (ctx.content === undefined) {
        return fail("Die inhoud-bron is nie opgestel nie. Kontak Joshua.");
      }
      const type = args.type ?? "post";

      if (type === "page") {
        const needle = args.query.toLowerCase();
        const matches: { slug: string; title: string }[] = [];
        for (const slug of ctx.content.pageSlugs) {
          const page = await ctx.content.loadPage(slug);
          if (page && (needle.length === 0 || page.title.toLowerCase().includes(needle))) {
            matches.push({ slug: page.slug, title: page.title });
          }
        }
        if (matches.length === 0) {
          return ok("Ek kon geen bladsy met daardie titel kry nie.", { type, matches: [] });
        }
        const lines = ["Bladsye:", ...matches.map((m) => `- ${m.title} (/${m.slug})`)];
        return ok(lines.join("\n"), { type, matches });
      }

      const index = await ctx.loadPostIndex();
      const ranked = rankSimilarPosts(index, { title: args.query }, 8);
      if (ranked.length === 0) {
        return ok("Ek kon geen pos met daardie titel kry nie. Probeer ander woorde.", {
          type,
          matches: [],
        });
      }
      const matches = ranked.map((entry) => ({
        id: entry.post.id,
        slug: entry.post.slug,
        title: entry.post.title,
      }));
      const lines = ["Ek het hierdie poste gekry:", ...matches.map((m) => `- ${m.title} (/${m.slug})`)];
      lines.push("Sê 'wysig <slug>' om een oop te maak met get_post.");
      return ok(lines.join("\n"), { type, matches });
    },
  );

  server.registerTool(
    "get_post",
    {
      title: "Maak 'n pos oop om te wysig",
      description:
        "Laai 'n bestaande pos of bladsy in 'n nuwe konsep sodat jy dit kan wysig en weer publiseer.",
      inputSchema: {
        slug: z.string().describe("Die pos/bladsy se URL-segment (van find_posts)."),
        type: contentTypeSchema.optional().describe("«post» (verstek) of «page»."),
      },
    },
    async (args) => {
      if (ctx.content === undefined) {
        return fail("Die inhoud-bron is nie opgestel nie. Kontak Joshua.");
      }
      const type = args.type ?? "post";
      const nowIso = ctx.now().toISOString();
      const draftId = ctx.createDraftId();

      if (type === "page") {
        const page = await ctx.content.loadPage(args.slug);
        if (page === null) {
          return fail(`Ek kon geen bladsy met slug «${args.slug}» kry nie.`);
        }
        await ctx.store.put(draftFromPage(page, draftId, nowIso));
        return ok(
          `Ek het bladsy «${page.title}» in konsep «${draftId}» gelaai. Wysig dit met update_post en publiseer weer.`,
          { draftId, type, slug: page.slug, title: page.title },
        );
      }

      const post = await ctx.content.loadPost(args.slug);
      if (post === null) {
        return fail(`Ek kon geen pos met slug «${args.slug}» kry nie. Kyk met find_posts.`);
      }
      await ctx.store.put(draftFromPost(post, draftId, nowIso, ctx.featuredTermId));
      return ok(
        `Ek het pos «${post.title}» in konsep «${draftId}» gelaai. Wysig dit met update_post; onthou die Engelse vertaling moet weer gemaak word voordat jy publiseer.`,
        { draftId, type, slug: post.slug, title: post.title },
      );
    },
  );

  server.registerTool(
    "update_post",
    {
      title: "Wysig 'n oop pos-konsep",
      description:
        "Werk 'n oop pos-konsep by (uit get_post). Dit merk die Engelse vertaling as verouderd — vra 'n nuwe een aan voor jy publiseer.",
      // Content values are advertised as permissive so this handler answers in
      // Afrikaans and names the exact field that is wrong (like save_draft).
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID (van get_post)."),
        title: z.unknown().optional().describe("Die pos se Afrikaanse titel."),
        excerpt: z.unknown().optional().describe("Kort opsomming."),
        categories: z.unknown().optional().describe("Kategorie-IDs (lys van getalle)."),
        tags: z.unknown().optional().describe("Etiket-IDs (lys van getalle)."),
        html: z.unknown().optional().describe("Die volledige pos-inhoud as HTML."),
        seo: z.unknown().optional().describe("SEO-titel en -beskrywing."),
        recipe: z.unknown().optional().describe("Die resep-struktuur."),
        featured: z.unknown().optional().describe("Moet dit op die voorblad wys? (waar/onwaar)"),
      },
    },
    async (args) => {
      const stored = await ctx.store.get(args.draftId);
      if (stored === null) {
        return fail(`Ek kon nie 'n konsep met ID «${args.draftId}» kry nie. Gebruik get_post.`);
      }
      if (stored.draft.kind !== "post") {
        return fail(`Konsep «${args.draftId}» is nie 'n pos-konsep nie — gebruik die webwerf-teks-gereedskap.`);
      }

      const candidate: Record<string, unknown> = { ...stored.draft };
      candidate.updatedAt = ctx.now().toISOString();
      let changed = false;
      for (const field of EDIT_FIELDS) {
        if (field in args && args[field] !== undefined) {
          candidate[field] = args[field];
          changed = true;
        }
      }
      // `featured` lives nested under interview (mirroring save_draft), so it is
      // applied onto interview.featured — letting an edit feature/un-feature a
      // post. Value stays permissive; draftPostSchema below names a bad type.
      if (args.featured !== undefined) {
        const priorInterview = stored.draft.interview ?? { settled: [], pending: [] };
        candidate.interview = { ...priorInterview, featured: args.featured };
        changed = true;
      }
      if (!changed) {
        return fail("Jy het niks aangedui om te verander nie. Gee ten minste een veld.");
      }

      const parsed = draftPostSchema.safeParse(candidate);
      if (!parsed.success) {
        return fail(describeZodIssue(parsed.error.issues[0]));
      }
      await ctx.store.put(parsed.data);
      // Editing the content invalidates any prior translation; clear the job so
      // publish knows a fresh one is required.
      await ctx.store.setJob(args.draftId, null);

      return ok(
        `Ek het konsep «${args.draftId}» bygewerk. Die 'modified'-datum sal by publiseer opdateer, en die Engelse vertaling is nou verouderd — maak 'n nuwe een met request_translation en submit_translation.`,
        { draftId: args.draftId, translationStale: true },
      );
    },
  );
}
