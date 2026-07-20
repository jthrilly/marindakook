import { z } from "zod";
import { buildTranslatePrompt } from "@site/lib/translate-prompt";
import { sourceHashOf } from "@site/lib/source-hash";
import { compareTranslation } from "@site/lib/translation-check.mjs";
import type { DraftPost } from "./draft-schema";
import { type AlertConfig, terminal } from "./errors";
import type { DraftStore, JsonValue } from "./store";

// Feedback retries AFTER the first attempt (spec D5: "up to 3 feedback
// retries"). One initial call + this many correction rounds = 4 API calls max.
export const MAX_TRANSLATION_RETRIES = 3;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 32000;

export interface TranslationJobDeps {
  store: DraftStore;
  promptTemplate: string;
  styleGuide: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  // Where a TERMINAL Anthropic fault (revoked key, exhausted credit/rate, or
  // every attempt failing outright) escalates to Joshua. This job runs in the
  // background past the tool's return, OUTSIDE guardToolThrows, so without this
  // a broken ANTHROPIC_API_KEY would silently break Marinda's translations.
  alert?: AlertConfig;
}

// An Anthropic API fault carrying the HTTP status so the terminal classifier can
// tell a broken key / exhausted credit (→ alert Joshua) from a transient blip.
class AnthropicError extends Error {
  readonly status?: number;
  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "AnthropicError";
    this.status = options?.status;
  }
}

// A terminal infra fault means Marinda's translations silently never work and
// the graceful Afrikaans-only degradation hides it: a revoked/absent key
// (401/403) or exhausted credit/rate limit (402/429) escalates directly to
// Joshua. A 5xx or transport error is only terminal when EVERY attempt failed
// with no candidate — handled separately via the `best === null` check.
function anthropicFault(status: number | undefined): { terminal: boolean; code: string } {
  if (status === 401 || status === 403) {
    return { terminal: true, code: "AI-AUTH" };
  }
  if (status === 402 || status === 429) {
    return { terminal: true, code: "AI-KREDIET" };
  }
  if (status !== undefined && status >= 500) {
    return { terminal: false, code: "AI-5XX" };
  }
  if (status !== undefined) {
    return { terminal: false, code: `AI-${status}` };
  }
  return { terminal: false, code: "AI-NET" };
}

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
const candidateSchema = z.record(z.string(), jsonValueSchema);

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

const anthropicMessageSchema = z.object({
  content: z.array(z.object({ text: z.string().optional() })),
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractResponseText(data: unknown): string {
  return anthropicMessageSchema
    .parse(data)
    .content.map((block) => block.text ?? "")
    .join("");
}

function parseCandidate(text: string): Record<string, JsonValue> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no JSON object in model output");
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  return candidateSchema.parse(parsed);
}

async function callAnthropic(deps: TranslationJobDeps, prompt: string): Promise<Record<string, JsonValue>> {
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": deps.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: deps.model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new AnthropicError(`Anthropic API ${response.status}: ${await response.text()}`, {
      status: response.status,
    });
  }
  return parseCandidate(extractResponseText(await response.json()));
}

function withCorrections(prompt: string, issues: string[]): string {
  const list = issues.map((issue) => `- ${issue}`).join("\n");
  return `${prompt}\n\n# Correction required\nYour previous attempt failed these mechanical checks. Fix ONLY these and reply with the corrected JSON object again:\n${list}`;
}

// Translate a draft's Afrikaans content to English, validate structurally, and
// persist the outcome to the store as the job record.
//
// Idempotent per draft+sourceHash: a stored terminal result (passing or
// failing) for the CURRENT sourceHash is reused with no API call. Content edits
// change the hash and force a fresh run. On success the real sourceHash is
// stamped into the translation (the prompt has the model emit "" for it).
export async function runTranslationJob(deps: TranslationJobDeps, draftId: string): Promise<void> {
  const stored = await deps.store.get(draftId);
  if (stored === null || stored.draft.kind !== "post") {
    return;
  }

  const source = buildTranslationSource(stored.draft);
  const sourceHash = sourceHashOf(source);

  const existing = parseJobRecord(await deps.store.getJob(draftId));
  if (
    existing !== null &&
    existing.sourceHash === sourceHash &&
    (existing.status === "passing" || existing.status === "failing")
  ) {
    return;
  }

  const nowIso = (): string => (deps.now ?? (() => new Date()))().toISOString();

  const pending: JsonValue = { status: "pending", sourceHash, startedAt: nowIso(), attempts: 0 };
  await deps.store.setJob(draftId, pending);

  const basePrompt = buildTranslatePrompt({
    template: deps.promptTemplate,
    styleGuide: deps.styleGuide,
    sourceJson: JSON.stringify(source),
  });

  const totalAttempts = MAX_TRANSLATION_RETRIES + 1;
  let best: { candidate: Record<string, JsonValue>; issues: string[] } | null = null;
  let corrections: string[] | null = null;
  let lastError: string | null = null;
  // Terminal API fault seen on any attempt (auth/credit/rate); and the code of
  // the last thrown fault (for the "every attempt failed, no candidate" case).
  let terminalCode: string | null = null;
  let lastFaultCode: string | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const prompt = corrections === null ? basePrompt : withCorrections(basePrompt, corrections);
    let candidate: Record<string, JsonValue>;
    try {
      candidate = await callAnthropic(deps, prompt);
    } catch (err) {
      lastError = errorMessage(err);
      const fault = anthropicFault(err instanceof AnthropicError ? err.status : undefined);
      lastFaultCode = fault.code;
      if (fault.terminal) {
        terminalCode = fault.code;
      }
      corrections = [lastError];
      continue;
    }

    const issues = compareTranslation(source, candidate);
    if (issues.length === 0) {
      const translation: JsonValue = { ...candidate, sourceHash };
      const result: JsonValue = {
        status: "passing",
        sourceHash,
        attempts: attempt,
        completedAt: nowIso(),
        translation,
      };
      await deps.store.setJob(draftId, result);
      return;
    }

    if (best === null || issues.length < best.issues.length) {
      best = { candidate, issues };
    }
    corrections = issues;
  }

  // Terminal infra fault: a definite auth/credit/rate failure at any attempt, or
  // every attempt failing outright with no candidate to fall back on. The Actions
  // failure email only ever covers CI, which never runs when the Worker's own
  // background job breaks — so escalate to Joshua directly. This is ADDITIONAL to
  // the graceful Afrikaans-only degradation below: the 'failing' record still
  // persists so publish can proceed Afrikaans-only.
  if (deps.alert !== undefined && (terminalCode !== null || best === null)) {
    await terminal(terminalCode ?? lastFaultCode ?? "AI-NET", deps.alert);
  }

  const failingIssues = best?.issues ?? (lastError === null ? ["geen geldige vertaling ontvang nie"] : [lastError]);
  const result: JsonValue = {
    status: "failing",
    sourceHash,
    attempts: totalAttempts,
    completedAt: nowIso(),
    issues: failingIssues,
    translation: best?.candidate ?? null,
  };
  await deps.store.setJob(draftId, result);
}
