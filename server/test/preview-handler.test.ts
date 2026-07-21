import { describe, expect, it } from "vitest";
import { sourceHashOf } from "@site/lib/source-hash";
import type { DraftPost, ChromeDraft } from "../src/core/draft-schema";
import { InMemoryStore } from "../src/core/store";
import type { DraftStore, JsonValue } from "../src/core/store";
import { buildTranslationSource } from "../src/core/translation-job";
import { handleApprove, renderPreviewPage } from "../src/pages/preview";
import type { PreviewDeps } from "../src/pages/preview";

const GOOD_TOKEN = "good-token";
const DRAFT_ID = "d-9";
const NOW = "2026-07-20T09:00:00.000Z";

function makeDeps(store: DraftStore, overrides: Partial<PreviewDeps> = {}): PreviewDeps {
  return {
    store,
    verifyLink: (token) => (token === GOOD_TOKEN ? { draftId: DRAFT_ID } : null),
    now: () => new Date(NOW),
    ...overrides,
  };
}

function postDraft(overrides: Partial<DraftPost> = {}): DraftPost {
  return {
    draftId: DRAFT_ID,
    kind: "post",
    createdAt: NOW,
    updatedAt: NOW,
    title: "Lemoenkoek",
    slug: "lemoenkoek",
    excerpt: "Lekker koek",
    html: "<p>Meng alles saam.</p>",
    seo: { title: "Lemoenkoek - Marinda Kook", description: null },
    recipe: {
      title: "Lemoenkoek",
      summaryHtml: "<p>Sag en lekker.</p>",
      details: [{ label: "Voorbereiding", pairs: [{ value: "10", unit: "min" }] }],
      ingredientsTitle: "Bestanddele",
      ingredientGroups: [{ title: null, items: ["2 eiers", "1 koppie suiker"] }],
      directionsTitle: "Metode",
      directionGroups: [{ title: null, steps: ["Meng deeglik.", "Bak vir 40 minute."] }],
      notesTitle: "Notas",
      notes: ["Geniet dit saam met tee."],
    },
    ...overrides,
  };
}

// A structurally-matching English translation candidate for postDraft() above
// (same shape `submit_translation` stores on a passing validation).
function englishCandidate(draft: DraftPost): Record<string, JsonValue> {
  const source = buildTranslationSource(draft);
  return {
    id: source.id,
    slug: source.slug,
    sourceHash: sourceHashOf(source),
    title: "Orange Cake",
    excerpt: "Delicious cake",
    seo: { title: "Orange Cake - Marinda Kook", description: null },
    html: "<p>Mix everything together.</p>",
    recipe: {
      title: "Orange Cake",
      summaryHtml: "<p>Soft and delicious.</p>",
      details: [{ label: "Voorbereiding", pairs: [{ value: "10", unit: "min" }] }],
      ingredientsTitle: "Ingredients",
      ingredientGroups: [{ title: null, items: ["2 eggs", "1 cup sugar"] }],
      directionsTitle: "Method",
      directionGroups: [{ title: null, steps: ["Mix thoroughly.", "Bake for 40 minutes."] }],
      notesTitle: "Notes",
      notes: ["Enjoy it with tea."],
    },
  };
}

async function passingJobFor(store: DraftStore, draft: DraftPost): Promise<void> {
  const source = buildTranslationSource(draft);
  await store.setJob(draft.draftId, {
    status: "passing",
    sourceHash: sourceHashOf(source),
    attempts: 1,
    completedAt: NOW,
    translation: englishCandidate(draft),
  });
}

function chromeDraft(overrides: Partial<ChromeDraft> = {}): ChromeDraft {
  return {
    draftId: DRAFT_ID,
    kind: "chrome",
    updatedAt: NOW,
    site: {
      tagline: "Lekker resepte, eenvoudig gemaak.",
      bio: { about: "Ek is Marinda.", button: { label: "Lees meer" } },
      newsletter: { heading: "Bly op hoogte", placeholder: "jou@epos.co.za", button: "Teken in" },
    },
    ...overrides,
  };
}

function approveRequest(token: string): Request {
  return new Request(`https://cms.example/preview?draft=${DRAFT_ID}&sig=${token}`, { method: "POST" });
}

describe("renderPreviewPage", () => {
  it("renders a post draft's title and recipe in both locales when a passing translation exists", async () => {
    const store = new InMemoryStore();
    const draft = postDraft();
    await store.put(draft);
    await passingJobFor(store, draft);

    const res = await renderPreviewPage(DRAFT_ID, makeDeps(store));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();

    expect(html).toContain('lang="af"');
    expect(html).toContain('name="viewport"');

    // Afrikaans side
    expect(html).toContain("Lemoenkoek");
    expect(html).toContain("Bestanddele");
    expect(html).toContain("2 eiers");
    expect(html).toContain("Metode");
    expect(html).toContain("Meng deeglik.");
    expect(html).toContain("Notas");
    expect(html).toContain("Geniet dit saam met tee.");
    expect(html).toContain("Voorbereiding");

    // English side
    expect(html).toContain("Orange Cake");
    expect(html).toContain("Ingredients");
    expect(html).toContain("2 eggs");
    expect(html).toContain("Method");
    expect(html).toContain("Mix thoroughly.");
    expect(html).toContain("Notes");
    expect(html).toContain("Enjoy it with tea.");

    // Approve control
    expect(html).toContain("Lyk reg");
  });

  it("renders af content plus an Afrikaans notice when there is no English translation yet", async () => {
    const store = new InMemoryStore();
    const draft = postDraft();
    await store.put(draft);
    // No job at all.

    const html = await (await renderPreviewPage(DRAFT_ID, makeDeps(store))).text();
    expect(html).toContain("Lemoenkoek");
    expect(html).toContain("Bestanddele");
    // Afrikaans notice about the missing English side.
    expect(html.toLowerCase()).toContain("engels");
    expect(html).not.toContain("Orange Cake");
  });

  it("shows the Afrikaans notice while the translation job is still pending", async () => {
    const store = new InMemoryStore();
    const draft = postDraft();
    await store.put(draft);
    await store.setJob(DRAFT_ID, {
      status: "pending",
      sourceHash: sourceHashOf(buildTranslationSource(draft)),
      startedAt: NOW,
      attempts: 0,
    });

    const html = await (await renderPreviewPage(DRAFT_ID, makeDeps(store))).text();
    expect(html).toContain("Lemoenkoek");
    expect(html.toLowerCase()).toContain("engels");
    expect(html).not.toContain("Orange Cake");
  });

  it("shows the Afrikaans notice when the translation job failed validation", async () => {
    const store = new InMemoryStore();
    const draft = postDraft();
    await store.put(draft);
    await store.setJob(DRAFT_ID, {
      status: "failing",
      sourceHash: sourceHashOf(buildTranslationSource(draft)),
      attempts: 4,
      completedAt: NOW,
      issues: ["mismatched tag count"],
      translation: null,
    });

    const html = await (await renderPreviewPage(DRAFT_ID, makeDeps(store))).text();
    expect(html).toContain("Lemoenkoek");
    expect(html.toLowerCase()).toContain("engels");
    expect(html).not.toContain("Orange Cake");
  });

  it("treats a passing translation as not-ready when it is stale for the current content", async () => {
    const store = new InMemoryStore();
    const draft = postDraft();
    await store.put(draft);
    await passingJobFor(store, draft);

    // Edit the draft's content after translation ran: the stored job's
    // sourceHash no longer matches the current content.
    await store.put({ ...draft, title: "Suurlemoenkoek" });

    const html = await (await renderPreviewPage(DRAFT_ID, makeDeps(store))).text();
    expect(html).toContain("Suurlemoenkoek");
    expect(html.toLowerCase()).toContain("engels");
    expect(html).not.toContain("Orange Cake");
  });

  it("renders the affected chrome (header/nav, bio, footer/newsletter) instead of a recipe card for a chrome draft", async () => {
    const store = new InMemoryStore();
    await store.put(chromeDraft());

    const html = await (await renderPreviewPage(DRAFT_ID, makeDeps(store))).text();
    expect(html).toContain("Lekker resepte, eenvoudig gemaak.");
    expect(html).toContain("Ek is Marinda.");
    expect(html).toContain("Bly op hoogte");
    expect(html).not.toContain("recipe-card");
    expect(html).not.toContain("Bestanddele");
  });

  it("renders the Afrikaans expired-link page (HTTP 200, not 403/404) for a draft that no longer exists", async () => {
    const store = new InMemoryStore();
    const res = await renderPreviewPage("gone-forever", makeDeps(store));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("verval");
    expect(html.toLowerCase()).toContain("nuwe skakel");
  });

  it("renders the already-published page (not the preview/approve form) for a draft published and unchanged since", async () => {
    const store = new InMemoryStore();
    const stored = await store.put(postDraft());
    await store.setApproval(DRAFT_ID, { revision: stored.revision, approvedAt: "2026-07-15T09:00:00.000Z" });
    await store.setPublish(DRAFT_ID, { sha: "abc123" });

    const res = await renderPreviewPage(DRAFT_ID, makeDeps(store));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("reeds gepubliseer");
    expect(html.toLowerCase()).toContain("nuwe skakel");
    expect(html).not.toContain("Lyk reg");
  });

  it("renders the normal preview + approve form for a draft that was published but edited since", async () => {
    const store = new InMemoryStore();
    const stored = await store.put(postDraft());
    await store.setApproval(DRAFT_ID, { revision: stored.revision, approvedAt: "2026-07-15T09:00:00.000Z" });
    await store.setPublish(DRAFT_ID, { sha: "abc123" });

    // A later edit bumps the revision, clearing the approval it was stamped with.
    await store.put(postDraft({ title: "Nuwe titel" }));
    expect(await store.getApproval(DRAFT_ID)).toBeNull();

    const html = await (await renderPreviewPage(DRAFT_ID, makeDeps(store))).text();
    expect(html).toContain("Nuwe titel");
    expect(html).toContain("Lyk reg");
    expect(html.toLowerCase()).not.toContain("reeds gepubliseer");
  });
});

describe("handleApprove", () => {
  it("sets the approval flag for the draft's current revision and tells her to return to chat", async () => {
    const store = new InMemoryStore();
    await store.put(postDraft());

    expect(await store.getApproval(DRAFT_ID)).toBeNull();

    const res = await handleApprove(approveRequest(GOOD_TOKEN), makeDeps(store));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Gaan terug na jou gesprek");

    const approval = await store.getApproval(DRAFT_ID);
    expect(approval).not.toBeNull();

    const stored = await store.get(DRAFT_ID);
    expect(approval?.revision).toBe(stored?.revision);
  });

  it("invalidates a prior approval once the draft's content changes", async () => {
    const store = new InMemoryStore();
    await store.put(postDraft());
    await handleApprove(approveRequest(GOOD_TOKEN), makeDeps(store));
    expect(await store.getApproval(DRAFT_ID)).not.toBeNull();

    await store.put(postDraft({ title: "Nuwe titel" }));

    expect(await store.getApproval(DRAFT_ID)).toBeNull();
  });

  it("renders the Afrikaans expired-link page (HTTP 200, not 403) for an invalid or tampered link", async () => {
    const store = new InMemoryStore();
    await store.put(postDraft());

    const res = await handleApprove(approveRequest("tampered"), makeDeps(store));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("verval");
    expect(await store.getApproval(DRAFT_ID)).toBeNull();
  });

  it("renders the Afrikaans expired-link page for a valid signature on a draft that was published/discarded", async () => {
    const store = new InMemoryStore();
    // No draft stored at all under DRAFT_ID.

    const res = await handleApprove(approveRequest(GOOD_TOKEN), makeDeps(store));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("verval");
  });

  it("returns the already-published page without touching approval state for a draft published and unchanged since", async () => {
    const store = new InMemoryStore();
    const stored = await store.put(postDraft());
    const originalApprovedAt = "2026-07-15T09:00:00.000Z";
    await store.setApproval(DRAFT_ID, { revision: stored.revision, approvedAt: originalApprovedAt });
    await store.setPublish(DRAFT_ID, { sha: "abc123" });

    const res = await handleApprove(approveRequest(GOOD_TOKEN), makeDeps(store));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("reeds gepubliseer");

    // Idempotent: the approval record is untouched (same approvedAt), not re-stamped.
    const approvalAfter = await store.getApproval(DRAFT_ID);
    expect(approvalAfter?.approvedAt).toBe(originalApprovedAt);
  });

  it("sets a fresh approval for a draft that was published but edited since", async () => {
    const store = new InMemoryStore();
    const stored = await store.put(postDraft());
    await store.setApproval(DRAFT_ID, { revision: stored.revision, approvedAt: "2026-07-15T09:00:00.000Z" });
    await store.setPublish(DRAFT_ID, { sha: "abc123" });

    // A later edit bumps the revision, clearing the approval it was stamped with.
    await store.put(postDraft({ title: "Nuwe titel" }));
    expect(await store.getApproval(DRAFT_ID)).toBeNull();

    const res = await handleApprove(approveRequest(GOOD_TOKEN), makeDeps(store));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Gaan terug na jou gesprek");

    const approvalAfter = await store.getApproval(DRAFT_ID);
    expect(approvalAfter).not.toBeNull();
    const newStored = await store.get(DRAFT_ID);
    expect(approvalAfter?.revision).toBe(newStored?.revision);
  });
});
