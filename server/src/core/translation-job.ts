import { z } from "zod";
import { sourceHashOf } from "@site/lib/source-hash";
import { compareTranslation } from "@site/lib/translation-check.mjs";
import type { DraftPost } from "./draft-schema";
import type { DraftStore, JsonValue } from "./store";

// Translation is produced IN-CONVERSATION by the chat model on Marinda's own
// subscription (the MCP `request_translation`/`submit_translation` tools), not by
// a server-side LLM call — so the Worker needs no LLM API key. This module holds
// the pieces shared across that flow, preview, and publish:
//   - buildTranslationSource: the Afrikaans "source" the model translates and
//     compareTranslation validates against;
//   - the stored job-record schema + parseJobRecord (read by preview + publish);
//   - validateAndStoreTranslation: the synchronous validate-and-store the
//     `submit_translation` tool runs — reuses compareTranslation + sourceHashOf,
//     and writes the SAME passing/failing record shape the old async job stored,
//     so preview + publish + reconcileTranslation + sourceHash stamping are all
//     unaffected.

// The Afrikaans "source" the model translates and compareTranslation validates
// against. A draft has no numeric id or final slug yet (publish assigns those),
// so the draftId anchors both here — the model copies them unchanged and the
// validator's id/slug equality checks pass. sourceHashOf deliberately excludes
// id/slug, so the hash (the idempotency + staleness key) survives publish
// restamping the real values.
export interface DraftTranslationSource {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  html: string;
  seo: { title?: string; description?: string | null };
  recipe?: unknown;
}

export function buildTranslationSource(draft: DraftPost): DraftTranslationSource {
  const source: DraftTranslationSource = {
    id: draft.draftId,
    slug: draft.slug ?? draft.draftId,
    title: draft.title ?? "",
    html: draft.html ?? "",
    seo: draft.seo ?? { title: draft.title ?? "" },
    recipe: draft.recipe,
  };
  if (typeof draft.excerpt === "string") {
    source.excerpt = draft.excerpt;
  }
  return source;
}

const jsonValueSchema = z.json();

// The stored translation record. `pending` is retained so a leftover record from
// the previous (async) design still parses gracefully — no code writes it now.
// `passing`/`failing` are what `submit_translation` writes, in the exact shape
// preview + publish already read.
const jobRecordSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), sourceHash: z.string(), startedAt: z.string(), attempts: z.number() }),
  z.object({
    status: z.literal("passing"),
    sourceHash: z.string(),
    attempts: z.number(),
    completedAt: z.string(),
    translation: jsonValueSchema,
  }),
  z.object({
    status: z.literal("failing"),
    sourceHash: z.string(),
    attempts: z.number(),
    completedAt: z.string(),
    issues: z.array(z.string()),
    translation: jsonValueSchema.nullable(),
  }),
]);

export type TranslationJobRecord = z.infer<typeof jobRecordSchema>;

export function parseJobRecord(value: JsonValue | null): TranslationJobRecord | null {
  if (value === null) {
    return null;
  }
  const parsed = jobRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface StoreTranslationDeps {
  store: DraftStore;
  now?: () => Date;
}

export type StoreTranslationResult = { ok: true } | { ok: false; issues: string[] };

// Validate the model's English translation structurally (compareTranslation) and
// persist the outcome as the store's job record. Clean → a PASSING record with
// the real sourceHash stamped into the translation (the prompt has the model emit
// "" for it), exactly as the old async job stored on success. With issues → a
// FAILING record carrying the candidate + issues, so publish can still degrade to
// Afrikaans-only + a review PR when the model ultimately can't produce a passing
// translation. The retry itself happens in the conversation (the model resubmits).
export async function validateAndStoreTranslation(
  deps: StoreTranslationDeps,
  draft: DraftPost,
  translation: Record<string, JsonValue>,
): Promise<StoreTranslationResult> {
  const source = buildTranslationSource(draft);
  const sourceHash = sourceHashOf(source);
  const completedAt = (deps.now ?? (() => new Date()))().toISOString();

  const issues = compareTranslation(source, translation);
  if (issues.length > 0) {
    const failing: JsonValue = {
      status: "failing",
      sourceHash,
      attempts: 1,
      completedAt,
      issues,
      translation,
    };
    await deps.store.setJob(draft.draftId, failing);
    return { ok: false, issues };
  }

  const stamped: JsonValue = { ...translation, sourceHash };
  const passing: JsonValue = {
    status: "passing",
    sourceHash,
    attempts: 1,
    completedAt,
    translation: stamped,
  };
  await deps.store.setJob(draft.draftId, passing);
  return { ok: true };
}
