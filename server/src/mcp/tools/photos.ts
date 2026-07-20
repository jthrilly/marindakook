import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail } from "../result";
import type { ToolContext } from "../server";

// The upload-page manifest shape is owned by the upload page (Task 7); read it
// leniently so a count can be surfaced without coupling to the full record.
const uploadManifestSchema = z.object({
  files: z.array(z.object({ filename: z.string().optional() })).optional(),
});

export function registerPhotoTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "request_photo_upload",
    {
      title: "Vra vir 'n foto-oplaai-skakel",
      description:
        "Gee 'n veilige skakel na die oplaai-bladsy vir hierdie konsep. Foto's kan nie deur die gesprek gestuur word nie, so Marinda laai hulle daar.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID waarvoor foto's gelaai word."),
      },
    },
    async (args) => {
      if (ctx.buildUploadLink === undefined) {
        return fail("Die oplaai-skakel is nie opgestel nie. Kontak Joshua.");
      }
      const stored = await ctx.store.get(args.draftId);
      if (stored === null) {
        return fail(
          `Ek kon nie 'n konsep met ID «${args.draftId}» kry nie. Begin met begin_draft of kyk na list_drafts.`,
        );
      }

      const url = await ctx.buildUploadLink(args.draftId);
      return ok(
        `Stuur vir Marinda hierdie skakel om haar foto's te laai:\n${url}\n\nWanneer sy klaar is, sê "klaar" en ek sal die foto's gaan haal.`,
        { draftId: args.draftId, url },
      );
    },
  );

  server.registerTool(
    "check_uploads",
    {
      title: "Kyk of foto's gelaai is",
      description: "Kyk watter foto's Marinda op die oplaai-bladsy vir hierdie konsep gestoor het.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID om na te gaan."),
      },
    },
    async (args) => {
      const manifest = await ctx.store.getUploadManifest(args.draftId);
      if (manifest === null) {
        return ok(
          "Daar is nog geen gelaaide foto's nie. Stuur eers die oplaai-skakel vir Marinda met request_photo_upload.",
          { draftId: args.draftId, uploads: null },
        );
      }

      const parsed = uploadManifestSchema.safeParse(manifest);
      const files = parsed.success ? (parsed.data.files ?? []) : [];
      const names = files
        .map((file) => file.filename)
        .filter((name): name is string => typeof name === "string");

      const lines = [`Daar is ${files.length} foto('s) gelaai:`];
      for (const name of names) {
        lines.push(`- ${name}`);
      }
      if (names.length === 0) {
        lines.push("(die name is nie in die manifes nie)");
      }
      lines.push("Vra vir Marinda watter een die held-foto is, en stoor dit met save_draft.");

      return ok(lines.join("\n"), { draftId: args.draftId, manifest });
    },
  );
}
