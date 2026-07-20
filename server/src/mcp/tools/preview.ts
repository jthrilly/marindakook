import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail } from "../result";
import type { ToolContext } from "../server";

// Hands Marinda the signed preview/approval link for a draft — the counterpart
// to request_photo_upload. The preview page is where she checks the af/en
// rendering and taps "Lyk reg", which sets the approval flag publish requires.
export function registerPreviewLinkTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_preview_link",
    {
      title: "Vra vir 'n voorskou-skakel",
      description:
        "Gee 'n veilige skakel na die voorskou-bladsy vir hierdie konsep, waar Marinda die resep in Afrikaans en Engels sien en dit kan goedkeur voor publikasie.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID om 'n voorskou van te maak."),
      },
    },
    async (args) => {
      if (ctx.buildPreviewLink === undefined) {
        return fail("Die voorskou-skakel is nie opgestel nie. Kontak Joshua.");
      }
      const stored = await ctx.store.get(args.draftId);
      if (stored === null) {
        return fail(
          `Ek kon nie 'n konsep met ID «${args.draftId}» kry nie. Begin met begin_draft of kyk na list_drafts.`,
        );
      }

      const url = await ctx.buildPreviewLink(args.draftId);
      return ok(
        `Stuur vir Marinda hierdie skakel om die voorskou te sien en goed te keur:\n${url}\n\nSodra sy "Lyk reg" gedruk het, kan ek publiseer.`,
        { draftId: args.draftId, url },
      );
    },
  );
}
