import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chromeDraftSchema, type ChromeDraft } from "../../core/draft-schema";
import { describeZodIssue } from "../issues";
import { ok, fail } from "../result";
import type { ToolContext } from "../server";

async function findChromeDraft(ctx: ToolContext): Promise<ChromeDraft | null> {
  const drafts = await ctx.store.list();
  for (const entry of drafts) {
    if (entry.draft.kind === "chrome") {
      return entry.draft;
    }
  }
  return null;
}

export function registerChromeTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_site_config",
    {
      title: "Wys die webwerf-teks",
      description:
        "Wys die redigeerbare webwerf-teks (slagspreuk, oor-my, nuusbrief) en enige oop webwerf-teks-konsep.",
    },
    async () => {
      if (ctx.content === undefined) {
        return fail("Die inhoud-bron is nie opgestel nie. Kontak Joshua.");
      }
      const site = await ctx.content.loadSite();
      const draft = await findChromeDraft(ctx);
      const current = {
        tagline: site.tagline,
        bioAbout: site.bio.about,
        newsletter: site.newsletter,
      };
      const lines = [
        "Huidige webwerf-teks:",
        `- Slagspreuk: ${site.tagline}`,
        `- Oor my: ${site.bio.about}`,
        `- Nuusbrief-opskrif: ${site.newsletter.heading}`,
      ];
      if (draft !== null) {
        lines.push("", `Daar is 'n oop webwerf-teks-konsep («${draft.draftId}») met wysigings.`);
      } else {
        lines.push("", "Sê wat jy wil verander en ek stoor dit met update_site_config.");
      }
      return ok(lines.join("\n"), {
        current,
        draftId: draft?.draftId ?? null,
        pending: draft?.site ?? null,
      });
    },
  );

  server.registerTool(
    "update_site_config",
    {
      title: "Wysig die webwerf-teks",
      description:
        "Werk die webwerf-teks by as 'n konsep (slagspreuk, oor-my, nuusbrief …). Publiseer dit later met publish deur dieselfde voorskou-hek.",
      // A partial site-chrome patch; merged shallowly onto the open draft and
      // validated so an unknown key answers in Afrikaans, naming the field.
      inputSchema: {
        site: z.unknown().describe("Die webwerf-teks-velde om te verander (bv. { tagline, bio, newsletter })."),
      },
    },
    async (args) => {
      const existing = await findChromeDraft(ctx);
      const nowIso = ctx.now().toISOString();

      const patch = args.site;
      if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
        return fail("Die veld «site» moet 'n voorwerp met webwerf-teks-velde wees.");
      }

      const draftId = existing?.draftId ?? ctx.createDraftId();
      const mergedSite = { ...(existing?.site ?? {}), ...patch };
      const candidate: unknown = { draftId, kind: "chrome", site: mergedSite, updatedAt: nowIso };

      const parsed = chromeDraftSchema.safeParse(candidate);
      if (!parsed.success) {
        return fail(describeZodIssue(parsed.error.issues[0]));
      }
      await ctx.store.put(parsed.data);

      return ok(
        `Ek het die webwerf-teks-konsep «${draftId}» gestoor. Maak 'n voorskou en keur dit goed, dan publiseer ek dit met publish.`,
        { draftId, kind: "chrome", pending: parsed.data.site },
      );
    },
  );
}
