import { beforeEach, describe, expect, it } from "vitest";
import { sourceHashOf } from "@site/lib/source-hash";
import type { DraftPost } from "../src/core/draft-schema";
import { InMemoryStore, type JsonValue } from "../src/core/store";
import {
  buildTranslationSource,
  parseJobRecord,
  validateAndStoreTranslation,
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
// validateAndStoreTranslation stamps the real hash.
function goodTranslation(source: ReturnType<typeof buildTranslationSource>): Record<string, JsonValue> {
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

function jobRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a job record object, got ${JSON.stringify(value)}`);
  }
  return { ...value };
}

describe("validateAndStoreTranslation", () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
    await store.put(draft());
  });

  it("stores a passing record (sourceHash === sourceHashOf(source), stamped into translation) on a good translation", async () => {
    const source = buildTranslationSource(draft());
    const result = await validateAndStoreTranslation({ store, now: () => new Date(NOW) }, draft(), goodTranslation(source));

    expect(result).toEqual({ ok: true });
    const record = jobRecord(await store.getJob("d-1"));
    expect(record.status).toBe("passing");
    expect(record.sourceHash).toBe(sourceHashOf(source));
    expect(record.attempts).toBe(1);
    expect(record.completedAt).toBe(NOW);
    const translation = jobRecord(record.translation);
    expect(translation.sourceHash).toBe(sourceHashOf(source));
    // The stored passing record parses back through the shared schema unchanged.
    expect(parseJobRecord(await store.getJob("d-1"))?.status).toBe("passing");
  });

  it("returns the structural issues and stores a FAILING record (never passing) on a bad translation", async () => {
    // Wrong id + empty title: compareTranslation flags both.
    const bad: Record<string, JsonValue> = {
      id: "wrong",
      slug: "lemoenkoek",
      sourceHash: "",
      title: "",
      seo: { title: "" },
      html: "<p>x</p>",
    };
    const result = await validateAndStoreTranslation({ store, now: () => new Date(NOW) }, draft(), bad);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.join(" ").toLowerCase()).toContain("id mismatch");
    }
    const record = jobRecord(await store.getJob("d-1"));
    expect(record.status).toBe("failing");
    expect(record.status).not.toBe("passing");
    // The candidate is retained so publish can degrade to Afrikaans-only + a PR.
    expect(record.translation).not.toBeNull();
  });

  it("overwrites a prior failing record with a passing one once a good translation is submitted", async () => {
    const source = buildTranslationSource(draft());
    const bad: Record<string, JsonValue> = { id: "wrong", slug: "lemoenkoek", sourceHash: "", title: "", seo: { title: "" }, html: "<p>x</p>" };

    await validateAndStoreTranslation({ store }, draft(), bad);
    expect(jobRecord(await store.getJob("d-1")).status).toBe("failing");

    await validateAndStoreTranslation({ store }, draft(), goodTranslation(source));
    expect(jobRecord(await store.getJob("d-1")).status).toBe("passing");
  });
});
