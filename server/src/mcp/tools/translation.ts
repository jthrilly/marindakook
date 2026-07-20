import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sourceHashOf } from "@site/lib/source-hash";
import {
  buildTranslationSource,
  parseJobRecord,
  runTranslationJob,
  type TranslationJobDeps,
} from "../../core/translation-job";
import { ok, fail } from "../result";
import type { ToolContext } from "../server";

export function registerTranslationTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "generate_translation",
    {
      title: "Maak die Engelse vertaling",
      description:
        "Begin die Engelse vertaling van hierdie resep. Dit loop op die agtergrond — kom kyk oor 'n minuut met check_translation_status.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID om te vertaal."),
      },
    },
    async (args) => {
      if (ctx.translation === undefined) {
        return fail("Vertaling is nie opgestel nie. Kontak Joshua.");
      }
      const stored = await ctx.store.get(args.draftId);
      if (stored === null) {
        return fail(
          `Ek kon nie 'n konsep met ID «${args.draftId}» kry nie. Begin met begin_draft of kyk na list_drafts.`,
        );
      }
      if (stored.draft.kind !== "post") {
        return fail(`Konsep «${args.draftId}» is nie 'n resep-konsep nie — daar is niks om te vertaal nie.`);
      }

      const jobDeps: TranslationJobDeps = {
        store: ctx.store,
        promptTemplate: ctx.translation.promptTemplate,
        styleGuide: ctx.styleGuides.en,
        apiKey: ctx.translation.apiKey,
        model: ctx.translation.model,
        fetchImpl: ctx.translation.fetch,
        now: ctx.now,
      };

      // Return immediately; the job outlives this tool call via waitUntil. Chat
      // clients hard-cap tool duration, but a long post plus validator retries
      // can exceed that — so we never await the job here.
      ctx.waitUntil(runTranslationJob(jobDeps, args.draftId));

      return ok("Die Engelse vertaling word gemaak — kyk oor 'n minuut met check_translation_status.", {
        draftId: args.draftId,
        status: "started",
      });
    },
  );

  server.registerTool(
    "check_translation_status",
    {
      title: "Kyk hoe ver is die vertaling",
      description: "Gee die stand van die Engelse vertaling terug (nog besig, geslaag, of misluk).",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID om na te gaan."),
      },
    },
    async (args) => {
      const record = parseJobRecord(await ctx.store.getJob(args.draftId));
      if (record === null) {
        return ok("Daar is nog geen vertaling vir hierdie konsep aangevra nie. Gebruik generate_translation.", {
          draftId: args.draftId,
          status: "none",
        });
      }

      if (record.status === "pending") {
        return ok("Die Engelse vertaling is nog besig — kyk oor 'n oomblik weer.", {
          draftId: args.draftId,
          status: "pending",
        });
      }

      if (record.status === "failing") {
        return ok(
          `Die vertaling kon nie die keuring ná ${record.attempts} pogings slaag nie. Joshua sal dit met die hand nagaan wanneer jy publiseer; die pos kan intussen net in Afrikaans verskyn.`,
          { draftId: args.draftId, status: "failing", issues: record.issues },
        );
      }

      // Passing: flag it as stale if the draft's content moved on since.
      const stored = await ctx.store.get(args.draftId);
      if (stored !== null && stored.draft.kind === "post") {
        const currentHash = sourceHashOf(buildTranslationSource(stored.draft));
        if (currentHash !== record.sourceHash) {
          return ok(
            "Die vorige vertaling is verouderd — die resep se inhoud het sedertdien verander. Vra 'n nuwe vertaling aan met generate_translation.",
            { draftId: args.draftId, status: "stale" },
          );
        }
      }

      return ok("Die Engelse vertaling is klaar en het die keuring geslaag.", {
        draftId: args.draftId,
        status: "passing",
      });
    },
  );
}
