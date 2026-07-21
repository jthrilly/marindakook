import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { rankSimilarPosts } from "../similarity";
import { ok } from "../result";
import type { ToolContext } from "../server";

export function registerVoiceTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_style_guide",
    {
      title: "Kry die stylgids",
      description:
        "Gee Marinda se stylgids terug (Afrikaans of Engels) sodat prosa in haar stem geskryf word.",
      inputSchema: {
        locale: z
          .enum(["af", "en"])
          .optional()
          .describe("Watter gids: 'af' (verstek) of 'en'."),
      },
    },
    async (args) => {
      const locale = args.locale ?? "af";
      const text = locale === "en" ? ctx.styleGuides.en : ctx.styleGuides.af;
      return ok(text, { locale });
    },
  );

  server.registerTool(
    "list_categories",
    {
      title: "Wys beskikbare kategorieë",
      description:
        "Gee die beskikbare resep-kategorieë (id en Afrikaanse naam) terug sodat jy die regte kategorie-ID's kan kies voor jy kategorieë bevestig. Die interne terme (Featured, Uncategorised, Eenhede) word uitgelaat.",
    },
    async () => {
      const categories = ctx.offeredCategories.map((category) => ({
        id: category.id,
        name: category.name,
      }));
      if (categories.length === 0) {
        return ok("Daar is tans geen kategorieë beskikbaar nie.", { categories: [] });
      }
      const lines = ["Beskikbare kategorieë:"];
      for (const category of categories) {
        lines.push(`- ${category.name} (id ${category.id})`);
      }
      return ok(lines.join("\n"), { categories });
    },
  );

  server.registerTool(
    "get_similar_posts",
    {
      title: "Kry soortgelyke poste",
      description:
        "Vind bestaande poste wat naby aan hierdie resep is (gedeelde kategorie/etiket en titel-woorde) as voorbeelde vir Marinda se stem.",
      inputSchema: {
        title: z.string().optional().describe("Die werktitel van die nuwe resep."),
        categories: z
          .array(z.number().int())
          .optional()
          .describe("Kategorie-IDs wat reeds gekies is."),
        tags: z.array(z.number().int()).optional().describe("Etiket-IDs wat reeds gekies is."),
        limit: z.number().int().positive().max(20).optional().describe("Hoeveel voorbeelde (verstek 5)."),
      },
    },
    async (args) => {
      const index = await ctx.loadPostIndex();
      const limit = args.limit ?? 5;
      const ranked = rankSimilarPosts(
        index,
        { title: args.title, categories: args.categories, tags: args.tags },
        limit,
      );

      if (ranked.length === 0) {
        return ok("Ek kon geen soortgelyke poste kry nie.", { posts: [] });
      }

      const posts = ranked.map((entry) => ({
        id: entry.post.id,
        slug: entry.post.slug,
        title: entry.post.title,
        score: entry.score,
        sharedTerms: entry.sharedTerms,
        sharedKeywords: entry.sharedKeywords,
      }));

      const lines = ["Soortgelyke poste (as voorbeelde vir Marinda se stem):"];
      for (const post of posts) {
        lines.push(`- ${post.title} (/${post.slug})`);
      }

      return ok(lines.join("\n"), { posts });
    },
  );
}
