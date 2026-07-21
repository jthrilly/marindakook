import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { draftPostSchema, type DraftPost } from "../../core/draft-schema";
import type { StoredDraft } from "../../core/store";
import { findNearDuplicatePosts, isNearDuplicateTitle } from "../similarity";
import { coerceJsonStrings, STRUCTURED_DRAFT_FIELDS } from "../coerce";
import { describeZodIssue } from "../issues";
import { ok, fail } from "../result";
import type { ToolContext } from "../server";

// The interview's required-fields checklist, as state keys the tools track.
// `begin_draft` seeds `pending` with all of them; `save_draft` moves a key to
// `settled` the moment the corresponding content arrives. The Afrikaans prose
// for each lives in the interview protocol (prompts/interview-af.md).
const REQUIRED_STATE = ["title", "categories", "recipe", "story", "featured", "photo"];

// Friendly Afrikaans labels for the internal checklist keys. The human-facing
// reply text uses these so nothing machine-shaped ("recipe", "featured") ever
// reaches Marinda; structuredContent keeps the raw keys for the model/tests.
const STATE_LABELS: Record<string, string> = {
  title: "titel",
  categories: "kategorieë",
  recipe: "resep",
  story: "storie",
  featured: "voorblad-keuse",
  photo: "foto",
};

function labelState(keys: string[]): string {
  return keys.map((key) => STATE_LABELS[key] ?? key).join(", ");
}

const SEPARATOR = "———";

type Interview = NonNullable<DraftPost["interview"]>;

function defaultInterview(): Interview {
  return { settled: [], pending: [...REQUIRED_STATE], featured: false };
}

function draftTitle(draft: DraftPost): string {
  return typeof draft.title === "string" && draft.title.length > 0 ? draft.title : "(sonder titel)";
}

// The category list is appended to begin_draft/resume_draft text so the model
// always has the valid ids without a separate tool call — claude.ai surfaces a
// large connector's tools via search, which can hide list_categories, so the
// protocol points here instead.
function categoriesBlock(ctx: ToolContext): string[] {
  const cats = ctx.offeredCategories;
  if (cats.length === 0) {
    return ["", "Beskikbare kategorieë: (geen is gekonfigureer nie)"];
  }
  const lines = ["", "Beskikbare kategorieë (kies die id's):"];
  for (const cat of cats) {
    lines.push(`- ${cat.name} (id ${cat.id})`);
  }
  return lines;
}

interface DraftSummary {
  draftId: string;
  kind: "post" | "chrome";
  title: string;
  updatedAt: string;
  settled?: string[];
  pending?: string[];
}

function summarize(entry: StoredDraft): DraftSummary {
  const draft = entry.draft;
  if (draft.kind === "post") {
    const interview = draft.interview ?? defaultInterview();
    return {
      draftId: draft.draftId,
      kind: "post",
      title: draftTitle(draft),
      updatedAt: draft.updatedAt,
      settled: interview.settled,
      pending: interview.pending,
    };
  }
  return { draftId: draft.draftId, kind: "chrome", title: "Webwerf-teks", updatedAt: draft.updatedAt };
}

// Which content field settles which checklist item. `null` = a field that is
// saved but is not itself a required checklist item (slug, seo).
const CONTENT_SETTLE: Record<string, string | null> = {
  title: "title",
  slug: null,
  excerpt: "story",
  categories: "categories",
  tags: "categories",
  html: "story",
  seo: null,
  recipe: "recipe",
};

export function registerDraftTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "begin_draft",
    {
      title: "Begin 'n nuwe resep",
      description:
        "Begin 'n nuwe resep-konsep en gee die volledige onderhoud-protokol terug. Wys eers naby-duplikaat poste en oop konsepte.",
      inputSchema: {
        title: z.string().optional().describe("Die werktitel van die resep (om duplikate te vind)."),
        force: z
          .boolean()
          .optional()
          .describe("Maak 'n nuwe konsep selfs al bestaan 'n soortgelyke oop konsep."),
      },
    },
    async (args) => {
      const title = args.title;
      const index = await ctx.loadPostIndex();
      const openDrafts = await ctx.store.list();

      const nearDuplicatePosts = title ? findNearDuplicatePosts(index, title, 3) : [];
      const nearDuplicateDrafts = title
        ? openDrafts.filter(
            (entry) =>
              entry.draft.kind === "post" &&
              typeof entry.draft.title === "string" &&
              isNearDuplicateTitle(title, entry.draft.title),
          )
        : [];

      const duplicatePosts = nearDuplicatePosts.map((post) => ({
        id: post.id,
        slug: post.slug,
        title: post.title,
      }));

      if (nearDuplicateDrafts.length > 0 && args.force !== true) {
        const lines = [ctx.interviewProtocol, "", SEPARATOR, "Jy het reeds oop konsep(te) met 'n soortgelyke titel:"];
        for (const entry of nearDuplicateDrafts) {
          if (entry.draft.kind === "post") {
            lines.push(`- «${entry.draft.draftId}» — ${draftTitle(entry.draft)}`);
          }
        }
        lines.push(
          "Sê 'gaan voort met daardie konsep' om aan te sluit, of 'begin 'n splinternuwe resep' om in elk geval 'n nuwe een te begin.",
        );
        lines.push(...categoriesBlock(ctx));
        return ok(lines.join("\n"), {
          created: false,
          protocol: ctx.interviewProtocol,
          duplicatePosts,
          openDrafts: nearDuplicateDrafts.map((entry) => summarize(entry)),
          categories: ctx.offeredCategories,
        });
      }

      const nowIso = ctx.now().toISOString();
      const draftId = ctx.createDraftId();
      const draft: DraftPost = {
        draftId,
        kind: "post",
        createdAt: nowIso,
        updatedAt: nowIso,
        interview: defaultInterview(),
      };
      await ctx.store.put(draft);

      const lines = [ctx.interviewProtocol, "", SEPARATOR, `Nuwe konsep begin: «${draftId}».`];
      if (nearDuplicatePosts.length > 0) {
        lines.push("");
        lines.push(
          "Let op — daar is reeds pos(te) met 'n soortgelyke titel. Wil jy dit eerder wysig, of 'n nuwe weergawe maak?",
        );
        for (const post of nearDuplicatePosts) {
          lines.push(`- ${post.title} (/${post.slug})`);
        }
      }
      lines.push(...categoriesBlock(ctx));

      return ok(lines.join("\n"), {
        created: true,
        draftId,
        protocol: ctx.interviewProtocol,
        duplicatePosts,
        openDrafts: [],
        categories: ctx.offeredCategories,
      });
    },
  );

  server.registerTool(
    "list_drafts",
    {
      title: "Wys my konsepte",
      description: "Lys alle oop konsepte (resepte en webwerf-teks) met hul stand.",
    },
    async () => {
      const drafts = await ctx.store.list();
      if (drafts.length === 0) {
        return ok("Daar is tans geen oop konsepte nie.", { drafts: [] });
      }
      const summaries = drafts.map((entry) => summarize(entry));
      const lines = ["Oop konsepte:"];
      for (const summary of summaries) {
        lines.push(`- «${summary.draftId}» — ${summary.title}`);
      }
      return ok(lines.join("\n"), { drafts: summaries });
    },
  );

  server.registerTool(
    "resume_draft",
    {
      title: "Gaan voort met 'n konsep",
      description:
        "Gaan voort met 'n bestaande konsep: gee die onderhoud-protokol terug plus wat reeds gestel is en wat nog uitstaan.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID (van begin_draft of list_drafts)."),
      },
    },
    async (args) => {
      const stored = await ctx.store.get(args.draftId);
      if (stored === null) {
        return fail(
          `Ek kon nie 'n konsep met ID «${args.draftId}» kry nie. Roep list_drafts om te sien watter konsepte oop is.`,
        );
      }

      const lines = [ctx.interviewProtocol, "", SEPARATOR];
      if (stored.draft.kind === "post") {
        const interview = stored.draft.interview ?? defaultInterview();
        lines.push(`Ons gaan voort met «${draftTitle(stored.draft)}».`);
        lines.push(`Reeds klaar: ${labelState(interview.settled) || "niks"}.`);
        lines.push(`Nog oor: ${labelState(interview.pending) || "niks"}.`);
        lines.push(...categoriesBlock(ctx));
        return ok(lines.join("\n"), {
          draftId: stored.draft.draftId,
          kind: "post",
          title: stored.draft.title ?? null,
          settled: interview.settled,
          pending: interview.pending,
          protocol: ctx.interviewProtocol,
        });
      }

      lines.push(`Konsep «${stored.draft.draftId}» — webwerf-teks.`);
      return ok(lines.join("\n"), {
        draftId: stored.draft.draftId,
        kind: "chrome",
        protocol: ctx.interviewProtocol,
      });
    },
  );

  server.registerTool(
    "discard_draft",
    {
      title: "Gooi 'n konsep weg",
      description: "Vee 'n konsep en al sy gestoorde foto's uit.",
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID om weg te gooi."),
      },
    },
    async (args) => {
      const stored = await ctx.store.get(args.draftId);
      const photos = await ctx.store.listPhotos(args.draftId);
      for (const photo of photos) {
        await ctx.store.deletePhoto(args.draftId, photo.filename);
      }
      await ctx.store.delete(args.draftId);

      const noun = stored === null ? "konsep (dit was reeds weg)" : "konsep en enige gestoorde foto's";
      return ok(`Ek het die ${noun} vir «${args.draftId}» uitgevee.`, {
        draftId: args.draftId,
        discarded: true,
        photosRemoved: photos.length,
      });
    },
  );

  server.registerTool(
    "save_draft",
    {
      title: "Stoor die konsep",
      description:
        "Werk 'n konsep by (gedeeltelike konsepte is geldig — stoor ná elke antwoord). Foutboodskappe noem die veld en is in Afrikaans.",
      // The content values are intentionally advertised as permissive so the
      // handler — not the SDK's generic English validator — owns validation and
      // can answer in Afrikaans, naming the exact field that is wrong.
      inputSchema: {
        draftId: z.string().describe("Die konsep-ID wat begin_draft teruggegee het."),
        title: z.unknown().optional().describe("Die resep se Afrikaanse titel."),
        slug: z.unknown().optional().describe("Die URL-segment (word normaalweg outomaties afgelei)."),
        excerpt: z.unknown().optional().describe("Kort opsomming (mag skryfhulp wees)."),
        categories: z.unknown().optional().describe("Kategorie-IDs (lys van getalle)."),
        tags: z.unknown().optional().describe("Etiket-IDs (lys van getalle)."),
        html: z.unknown().optional().describe("Die volledige pos-inhoud as HTML."),
        seo: z.unknown().optional().describe("SEO-titel en -beskrywing."),
        recipe: z.unknown().optional().describe("Die resep-struktuur (bestanddele, metode, ens.)."),
        featured: z.unknown().optional().describe("Moet dit op die voorblad wys? (waar/onwaar)"),
        heroPhoto: z.unknown().optional().describe("Die held-foto se lêernaam."),
        prose: z.unknown().optional().describe("Die jongste skryfhulp-prosa."),
      },
    },
    async (args) => {
      const { draftId, ...rest } = args;
      // A real MCP client sends structured fields (categories, recipe, …) as JSON
      // strings; coerce them back before validation so the loose draft schema
      // accepts them (genuine strings and already-parsed values pass through).
      const patch = coerceJsonStrings(rest, STRUCTURED_DRAFT_FIELDS);

      const stored = await ctx.store.get(draftId);
      if (stored === null) {
        return fail(
          `Ek kon nie 'n konsep met ID «${draftId}» kry nie. Begin met begin_draft of kyk na list_drafts.`,
        );
      }
      if (stored.draft.kind !== "post") {
        return fail(`Konsep «${draftId}» is nie 'n resep-konsep nie — gebruik die webwerf-teks-gereedskap.`);
      }

      const previous = stored.draft;
      const priorInterview = previous.interview ?? defaultInterview();
      const settled = new Set<string>(priorInterview.settled);
      let pending = [...priorInterview.pending];
      const settle = (stateKey: string): void => {
        settled.add(stateKey);
        pending = pending.filter((item) => item !== stateKey);
      };

      const candidate: Record<string, unknown> = { ...previous };
      candidate.updatedAt = ctx.now().toISOString();

      for (const [field, stateKey] of Object.entries(CONTENT_SETTLE)) {
        if (field in patch) {
          candidate[field] = patch[field];
          if (stateKey !== null) {
            settle(stateKey);
          }
        }
      }

      const nextInterview: Record<string, unknown> = { featured: priorInterview.featured };
      if (priorInterview.latestProse !== undefined) {
        nextInterview.latestProse = priorInterview.latestProse;
      }
      if (priorInterview.heroPhoto !== undefined) {
        nextInterview.heroPhoto = priorInterview.heroPhoto;
      }
      if ("featured" in patch) {
        nextInterview.featured = patch.featured;
        settle("featured");
      }
      if ("prose" in patch) {
        nextInterview.latestProse = patch.prose;
        settle("story");
      }
      if ("heroPhoto" in patch) {
        nextInterview.heroPhoto = patch.heroPhoto;
        settle("photo");
      }
      nextInterview.settled = [...settled];
      nextInterview.pending = pending;
      candidate.interview = nextInterview;

      const parsed = draftPostSchema.safeParse(candidate);
      if (!parsed.success) {
        return fail(describeZodIssue(parsed.error.issues[0]));
      }

      await ctx.store.put(parsed.data);
      const settledList = [...settled];
      return ok(
        `Gestoor ✓ Reeds klaar: ${labelState(settledList) || "niks"}. Nog oor: ${labelState(pending) || "niks"}.`,
        { draftId, settled: settledList, pending },
      );
    },
  );
}
