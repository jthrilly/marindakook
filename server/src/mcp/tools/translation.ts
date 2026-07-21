import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildTranslatePrompt } from "@site/lib/translate-prompt";
import { buildTranslationSource, validateAndStoreTranslation } from "../../core/translation-job";
import { coerceJsonStrings } from "../coerce";
import { ok, fail } from "../result";
import type { ToolContext } from "../server";

// The translation is produced by the chat model in-conversation (on Marinda's own
// subscription), so the Worker makes NO LLM API call. `request_translation` hands
// the model everything it needs to translate; `submit_translation` validates the
// model's result structurally and stores a passing record for preview/publish. The
// correction loop lives in the conversation: on issues, the model fixes and
// resubmits.

// Accepted at runtime (the inputSchema uses z.unknown() so the SDK's JSON-schema
// generation stays simple — mirrors chrome.ts's `site`); a non-object submission
// is rejected with an Afrikaans hint.
const translationObjectSchema = z.record(z.string(), z.json());

export function registerTranslationTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "request_translation",
    {
      title: "Kry alles om die Engelse vertaling self te maak",
      description:
        "Gee die Afrikaanse bron, die volledige vertaal-instruksies en die Engelse stylgids terug sodat jy self die Engelse vertaling kan maak en met submit_translation kan instuur.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID om te vertaal."),
      },
    },
    async (args) => {
      const stored = await ctx.store.get(args.draftId);
      if (stored === null) {
        return fail(
          `Ek kon nie 'n konsep met ID «${args.draftId}» kry nie. Begin met begin_draft of kyk na list_drafts.`,
        );
      }
      if (stored.draft.kind !== "post") {
        return fail(`Konsep «${args.draftId}» is nie 'n resep-konsep nie — daar is niks om te vertaal nie.`);
      }

      const source = buildTranslationSource(stored.draft);
      // buildTranslatePrompt embeds the EN style guide and the Afrikaans source
      // into the canonical translate prompt — the same text the old server-side
      // job sent, now served to the chat model in full.
      const instructions = buildTranslatePrompt({
        template: ctx.translatePrompt,
        styleGuide: ctx.styleGuides.en,
        sourceJson: JSON.stringify(source, null, 2),
      });

      const message = [
        "Jy maak nou SELF die Engelse vertaling — daar is geen aparte vertaaldiens nie.",
        "Volg die instruksies hieronder presies, maak die Engelse vertaling as 'n enkele JSON-objek volgens die uitvoer-kontrak, en roep dan submit_translation met daardie JSON as die «translation»-argument.",
        "As submit_translation probleme terugstuur, maak net dié reg en stuur weer — herhaal tot dit «Vertaling ontvang en gekontroleer ✓» terugstuur.",
        "",
        "────────────────────────────────────────",
        "",
        instructions,
      ].join("\n");

      return ok(message, { draftId: args.draftId });
    },
  );

  server.registerTool(
    "submit_translation",
    {
      title: "Stuur die Engelse vertaling in vir kontrole",
      description:
        "Stuur jou Engelse vertaling (as 'n JSON-objek) in. Die Worker kontroleer die struktuur en stoor dit as dit slaag; andersins kry jy die probleme terug om reg te maak en weer te stuur.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID wat vertaal is."),
        translation: z
          .unknown()
          .describe("Die volledige Engelse vertaling as 'n JSON-objek, volgens request_translation se uitvoer-kontrak."),
      },
    },
    async (args) => {
      const stored = await ctx.store.get(args.draftId);
      if (stored === null) {
        return fail(
          `Ek kon nie 'n konsep met ID «${args.draftId}» kry nie. Begin met begin_draft of kyk na list_drafts.`,
        );
      }
      if (stored.draft.kind !== "post") {
        return fail(`Konsep «${args.draftId}» is nie 'n resep-konsep nie — daar is niks om te vertaal nie.`);
      }

      // A real MCP client sends the structured `translation` object as a JSON
      // string; coerce it back before validation (an already-object value and a
      // non-JSON string both pass through, the latter rejected below in Afrikaans).
      const translation = coerceJsonStrings(args, ["translation"]).translation;
      const parsed = translationObjectSchema.safeParse(translation);
      if (!parsed.success) {
        return fail(
          "Die vertaling moet 'n JSON-objek wees (soos request_translation se uitvoer-kontrak beskryf). Roep request_translation as jy die formaat nodig het.",
        );
      }

      const result = await validateAndStoreTranslation(
        { store: ctx.store, now: ctx.now },
        stored.draft,
        parsed.data,
      );

      if (!result.ok) {
        const list = result.issues.map((issue) => `- ${issue}`).join("\n");
        return ok(
          `Die Engelse vertaling het nog probleme — maak reg en stuur weer met submit_translation:\n${list}`,
          { draftId: args.draftId, status: "failing", issues: result.issues },
        );
      }

      return ok("Vertaling ontvang en gekontroleer ✓", { draftId: args.draftId, status: "passing" });
    },
  );
}
