import { beforeEach, describe, expect, it, vi } from "vitest";
import { sourceHashOf } from "@site/lib/source-hash";
import type { DraftPost } from "../src/core/draft-schema";
import { InMemoryStore } from "../src/core/store";
import {
  buildTranslationSource,
  MAX_TRANSLATION_RETRIES,
  runTranslationJob,
  type TranslationJobDeps,
} from "../src/core/translation-job";

const NOW = "2026-07-20T09:00:00.000Z";

function draft(overrides: Partial<DraftPost> = {}): DraftPost {
  return {
    draftId: "d-1",
    kind: "post",
    createdAt: NOW,
    updatedAt: NOW,
    title: "Lemoenkoek",
    slug: "lemoenkoek",
    excerpt: "Lekker koek",
    html: "<p>Meng alles</p>",
    seo: { title: "Lemoenkoek - Marinda Kook", description: null },
    recipe: {
      title: "Lemoenkoek",
      summaryHtml: "<p>Sag</p>",
      details: [{ label: "Voorbereiding", pairs: [{ value: "10", unit: "min" }] }],
      ingredientGroups: [{ title: null, items: ["2 eiers"] }],
      directionGroups: [{ title: null, steps: ["Meng deeglik"] }],
      notes: ["Geniet dit"],
    },
    ...overrides,
  };
}

// A structurally-valid English translation of the draft above: same tag
// signatures, same recipe counts, id/slug copied, details unchanged. It passes
// compareTranslation. `sourceHash: ""` is what the prompt asks the model for;
// the job stamps the real hash.
function goodCandidate(source: ReturnType<typeof buildTranslationSource>): Record<string, unknown> {
  return {
    id: source.id,
    slug: source.slug,
    sourceHash: "",
    title: "Orange cake",
    excerpt: "Delicious cake",
    seo: { title: "Orange cake - Marinda Kook", description: null },
    html: "<p>Mix everything</p>",
    recipe: {
      title: "Orange cake",
      summaryHtml: "<p>Soft</p>",
      details: [{ label: "Voorbereiding", pairs: [{ value: "10", unit: "min" }] }],
      ingredientGroups: [{ title: null, items: ["2 eggs"] }],
      directionGroups: [{ title: null, steps: ["Mix thoroughly"] }],
      notes: ["Enjoy it"],
    },
  };
}

function anthropicResponse(candidate: unknown): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: JSON.stringify(candidate) }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function makeDeps(store: InMemoryStore, fetchImpl: typeof fetch): TranslationJobDeps {
  return {
    store,
    promptTemplate: "STYLE:{{STYLE_GUIDE}}\nSOURCE:{{SOURCE_JSON}}",
    styleGuide: "English style guide",
    apiKey: "test-key",
    model: "claude-test",
    fetchImpl,
    now: () => new Date(NOW),
  };
}

function jobRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a job record object, got ${JSON.stringify(value)}`);
  }
  return { ...value };
}

describe("runTranslationJob", () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
    await store.put(draft());
  });

  it("stores a passing result whose sourceHash === sourceHashOf(af) on a good translation", async () => {
    const source = buildTranslationSource(draft());
    const fetchMock = vi.fn<typeof fetch>(async () => anthropicResponse(goodCandidate(source)));

    await runTranslationJob(makeDeps(store, fetchMock), "d-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const record = jobRecord(await store.getJob("d-1"));
    expect(record.status).toBe("passing");
    expect(record.sourceHash).toBe(sourceHashOf(source));
    const translation = jobRecord(record.translation);
    expect(translation.sourceHash).toBe(sourceHashOf(source));
  });

  it("posts to the Anthropic Messages API with the prompt and key from deps", async () => {
    const source = buildTranslationSource(draft());
    const fetchMock = vi.fn<typeof fetch>(async () => anthropicResponse(goodCandidate(source)));

    await runTranslationJob(makeDeps(store, fetchMock), "d-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("claude-test");
    expect(body.messages[0].content).toContain("STYLE:English style guide");
    expect(body.messages[0].content).toContain("Lemoenkoek");
  });

  it("retries with validator feedback then records a failing result after exhaustion", async () => {
    // A candidate that always fails: empty title + id mismatch.
    const badCandidate = { id: "wrong", slug: "lemoenkoek", sourceHash: "", title: "", seo: { title: "" }, html: "<p>x</p>" };
    const fetchMock = vi.fn<typeof fetch>(async () => anthropicResponse(badCandidate));

    await runTranslationJob(makeDeps(store, fetchMock), "d-1");

    // 1 initial attempt + MAX_TRANSLATION_RETRIES feedback retries.
    expect(fetchMock).toHaveBeenCalledTimes(MAX_TRANSLATION_RETRIES + 1);

    // The retries after the first carry the validator issues as correction guidance.
    const secondPrompt = String(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).messages[0].content);
    expect(secondPrompt.toLowerCase()).toContain("id mismatch");

    const record = jobRecord(await store.getJob("d-1"));
    expect(record.status).toBe("failing");
    const issues = record.issues;
    expect(Array.isArray(issues)).toBe(true);
    if (Array.isArray(issues)) {
      expect(issues.length).toBeGreaterThan(0);
    }
  });

  it("is idempotent per draft+sourceHash: a repeat call reuses the stored result with no new API call", async () => {
    const source = buildTranslationSource(draft());
    const fetchMock = vi.fn<typeof fetch>(async () => anthropicResponse(goodCandidate(source)));
    const deps = makeDeps(store, fetchMock);

    await runTranslationJob(deps, "d-1");
    await runTranslationJob(deps, "d-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jobRecord(await store.getJob("d-1")).status).toBe("passing");
  });

  it("re-runs when the draft content changed (sourceHash differs)", async () => {
    const source1 = buildTranslationSource(draft());
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const current = await store.get("d-1");
      const src = current && current.draft.kind === "post" ? buildTranslationSource(current.draft) : source1;
      return anthropicResponse(goodCandidate(src));
    });
    const deps = makeDeps(store, fetchMock);

    await runTranslationJob(deps, "d-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Edit the draft content -> new sourceHash -> job must run again.
    await store.put(draft({ title: "Lemoen-en-amandelkoek" }));
    await runTranslationJob(deps, "d-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
