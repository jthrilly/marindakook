import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ChromeDraft, DraftPost } from "../src/core/draft-schema";
import { InMemoryStore, KvR2Store } from "../src/core/store";
import type { DraftStore } from "../src/core/store";

// The same contract must hold for both backends: the fast in-memory fake
// used by every other task's unit tests, and the real KV/R2 bindings the
// workerd pool provides (see vitest.config.ts's `miniflare.kvNamespaces` /
// `r2Buckets`) — no Cloudflare account, but real binding semantics
// (serialization, R2 metadata, pagination shapes).
const implementations: { name: string; makeStore: () => DraftStore }[] = [
  { name: "InMemoryStore", makeStore: () => new InMemoryStore() },
  { name: "KvR2Store", makeStore: () => new KvR2Store({ kv: env.DRAFTS, r2: env.PHOTOS }) },
];

function samplePost(overrides: Partial<DraftPost> = {}): DraftPost {
  return {
    draftId: "d-1",
    kind: "post",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
    title: "Piesangbrood",
    ...overrides,
  };
}

function sampleChrome(overrides: Partial<ChromeDraft> = {}): ChromeDraft {
  return {
    draftId: "d-chrome-1",
    kind: "chrome",
    site: { tagline: "Tuisgemaakte resepte" },
    updatedAt: "2026-07-20T09:00:00.000Z",
    ...overrides,
  };
}

describe.each(implementations)("DraftStore contract ($name)", ({ makeStore }) => {
  describe("drafts", () => {
    it("returns null for a draft that was never saved", async () => {
      const store = makeStore();
      expect(await store.get("never-saved")).toBeNull();
    });

    it("round-trips put/get for a post draft, stamping a revision", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-roundtrip-post" });

      const stored = await store.put(draft);
      expect(stored.draft).toEqual(draft);
      expect(typeof stored.revision).toBe("string");
      expect(stored.revision.length).toBeGreaterThan(0);

      expect(await store.get(draft.draftId)).toEqual(stored);
    });

    it("round-trips put/get for a chrome draft", async () => {
      const store = makeStore();
      const draft = sampleChrome({ draftId: "d-roundtrip-chrome" });

      const stored = await store.put(draft);
      expect(stored.draft).toEqual(draft);

      expect(await store.get(draft.draftId)).toEqual(stored);
    });

    it("lists both post and chrome drafts", async () => {
      const store = makeStore();
      await store.put(samplePost({ draftId: "d-list-post" }));
      await store.put(sampleChrome({ draftId: "d-list-chrome" }));

      const ids = (await store.list()).map((entry) => entry.draft.draftId);
      expect(ids).toContain("d-list-post");
      expect(ids).toContain("d-list-chrome");
    });

    it("deletes a draft", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-delete" });
      await store.put(draft);

      await store.delete(draft.draftId);

      expect(await store.get(draft.draftId)).toBeNull();
      const ids = (await store.list()).map((entry) => entry.draft.draftId);
      expect(ids).not.toContain(draft.draftId);
    });

    it("clears approval, job, and upload manifest state when a draft is deleted", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-delete-cascades" });
      const stored = await store.put(draft);
      await store.setApproval(draft.draftId, { revision: stored.revision, approvedAt: "t" });
      await store.setJob(draft.draftId, { status: "running" });
      await store.setUploadManifest(draft.draftId, { files: [] });

      await store.delete(draft.draftId);

      expect(await store.getApproval(draft.draftId)).toBeNull();
      expect(await store.getJob(draft.draftId)).toBeNull();
      expect(await store.getUploadManifest(draft.draftId)).toBeNull();
    });

    it("does not let mutating the object returned from put() affect a subsequent get() or the caller's original draft", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-put-return-aliasing" });

      const stored = await store.put(draft);
      if (stored.draft.kind !== "post") throw new Error("expected a post draft");
      stored.draft.title = "MUTATED AFTER PUT";

      expect(draft.title).toBe("Piesangbrood");
      const fetched = await store.get(draft.draftId);
      if (!fetched || fetched.draft.kind !== "post") throw new Error("expected a post draft");
      expect(fetched.draft.title).toBe("Piesangbrood");
    });

    it("produces the same revision for content-identical drafts with different key insertion order", async () => {
      const store = makeStore();
      const draftA = samplePost({
        draftId: "d-key-order-a",
        seo: { title: "Piesangbrood resep", description: null },
      });
      const draftB = samplePost({
        draftId: "d-key-order-b",
        // Same `seo` content as draftA, but the object is built with the
        // keys in reverse insertion order.
        seo: { description: null, title: "Piesangbrood resep" },
      });

      const storedA = await store.put(draftA);
      const storedB = await store.put(draftB);

      expect(storedB.revision).toBe(storedA.revision);

      // ...and a prior approval granted under one key order stays valid when
      // re-derived from a differently-ordered but content-identical draft.
      await store.setApproval(draftA.draftId, {
        revision: storedA.revision,
        approvedAt: "2026-07-20T09:30:00.000Z",
      });
      await store.put({ ...draftA, seo: draftB.seo });
      expect(await store.getApproval(draftA.draftId)).toEqual({
        revision: storedA.revision,
        approvedAt: "2026-07-20T09:30:00.000Z",
      });
    });

    it("keeps the revision stable when only envelope metadata (updatedAt) changes", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-revision-stable" });
      const first = await store.put(draft);

      const resaved = await store.put({ ...draft, updatedAt: "2026-07-20T10:00:00.000Z" });

      expect(resaved.revision).toBe(first.revision);
    });

    it("bumps the revision when post content changes", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-revision-bump-post" });
      const first = await store.put(draft);

      const changed = await store.put({ ...draft, title: "Ander Piesangbrood" });

      expect(changed.revision).not.toBe(first.revision);
    });

    it("bumps the revision when chrome content changes", async () => {
      const store = makeStore();
      const draft = sampleChrome({ draftId: "d-revision-bump-chrome" });
      const first = await store.put(draft);

      const changed = await store.put({
        ...draft,
        site: { ...draft.site, tagline: "Nuwe slagspreuk" },
      });

      expect(changed.revision).not.toBe(first.revision);
    });
  });

  describe("photos", () => {
    it("round-trips photo bytes and metadata", async () => {
      const store = makeStore();
      const draftId = "d-photo-roundtrip";
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 250]);

      const info = await store.putPhoto(draftId, "hero.jpg", bytes, {
        contentType: "image/jpeg",
        uploadedAt: "2026-07-20T09:00:00.000Z",
      });
      expect(info).toEqual({
        draftId,
        filename: "hero.jpg",
        contentType: "image/jpeg",
        uploadedAt: "2026-07-20T09:00:00.000Z",
        size: bytes.byteLength,
      });

      const fetched = await store.getPhoto(draftId, "hero.jpg");
      if (fetched === null) throw new Error("expected the staged photo to round-trip");
      expect(Array.from(fetched.bytes)).toEqual(Array.from(bytes));
      expect({ ...fetched, bytes: undefined }).toEqual({ ...info, bytes: undefined });
    });

    it("returns null for a photo that was never staged", async () => {
      const store = makeStore();
      expect(await store.getPhoto("d-photo-missing", "nope.jpg")).toBeNull();
    });

    it("lists only the photos staged for the given draft", async () => {
      const store = makeStore();
      await store.putPhoto("d-photo-list-a", "one.jpg", new Uint8Array([1]), {
        contentType: "image/jpeg",
        uploadedAt: "t1",
      });
      await store.putPhoto("d-photo-list-a", "two.jpg", new Uint8Array([2, 2]), {
        contentType: "image/jpeg",
        uploadedAt: "t2",
      });
      await store.putPhoto("d-photo-list-b", "other.jpg", new Uint8Array([3]), {
        contentType: "image/jpeg",
        uploadedAt: "t3",
      });

      const listed = await store.listPhotos("d-photo-list-a");
      expect(listed.map((photo) => photo.filename).sort()).toEqual(["one.jpg", "two.jpg"]);
    });

    it("deletes a staged photo", async () => {
      const store = makeStore();
      const draftId = "d-photo-delete";
      await store.putPhoto(draftId, "gone.jpg", new Uint8Array([9]), {
        contentType: "image/jpeg",
        uploadedAt: "t",
      });

      await store.deletePhoto(draftId, "gone.jpg");

      expect(await store.getPhoto(draftId, "gone.jpg")).toBeNull();
      expect(await store.listPhotos(draftId)).toEqual([]);
    });
  });

  describe("approval", () => {
    it("returns null when nothing has been approved", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-approval-none" });
      await store.put(draft);

      expect(await store.getApproval(draft.draftId)).toBeNull();
    });

    it("returns the approval when it matches the draft's current revision", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-approval-match" });
      const stored = await store.put(draft);

      await store.setApproval(draft.draftId, {
        revision: stored.revision,
        approvedAt: "2026-07-20T09:30:00.000Z",
      });

      expect(await store.getApproval(draft.draftId)).toEqual({
        revision: stored.revision,
        approvedAt: "2026-07-20T09:30:00.000Z",
      });
    });

    it("invalidates a stale approval once the draft's content changes", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-approval-stale" });
      const stored = await store.put(draft);
      await store.setApproval(draft.draftId, {
        revision: stored.revision,
        approvedAt: "2026-07-20T09:30:00.000Z",
      });

      await store.put({ ...draft, title: "'n Splinternuwe titel" });

      expect(await store.getApproval(draft.draftId)).toBeNull();
    });

    it("does not invalidate approval when a resave leaves content unchanged", async () => {
      const store = makeStore();
      const draft = samplePost({ draftId: "d-approval-resave" });
      const stored = await store.put(draft);
      await store.setApproval(draft.draftId, {
        revision: stored.revision,
        approvedAt: "2026-07-20T09:30:00.000Z",
      });

      await store.put({ ...draft, updatedAt: "2026-07-20T11:00:00.000Z" });

      expect(await store.getApproval(draft.draftId)).toEqual({
        revision: stored.revision,
        approvedAt: "2026-07-20T09:30:00.000Z",
      });
    });
  });

  describe("translation job state", () => {
    it("round-trips job state", async () => {
      const store = makeStore();
      const draftId = "d-job-roundtrip";
      const job = { status: "running", attempts: 1, sourceHash: "abc123" };

      await store.setJob(draftId, job);

      expect(await store.getJob(draftId)).toEqual(job);
    });

    it("returns null for a draft with no job recorded", async () => {
      const store = makeStore();
      expect(await store.getJob("d-job-none")).toBeNull();
    });

    it("overwrites prior job state on a subsequent setJob", async () => {
      const store = makeStore();
      const draftId = "d-job-overwrite";
      await store.setJob(draftId, { status: "running", attempts: 1 });

      await store.setJob(draftId, { status: "succeeded", attempts: 2, sourceHash: "final" });

      expect(await store.getJob(draftId)).toEqual({
        status: "succeeded",
        attempts: 2,
        sourceHash: "final",
      });
    });
  });

  describe("upload manifest", () => {
    it("round-trips the upload manifest", async () => {
      const store = makeStore();
      const draftId = "d-upload-roundtrip";
      const manifest = { files: ["a.jpg", "b.jpg"], completedAt: "2026-07-20T09:45:00.000Z" };

      await store.setUploadManifest(draftId, manifest);

      expect(await store.getUploadManifest(draftId)).toEqual(manifest);
    });

    it("returns null when no manifest has been written", async () => {
      const store = makeStore();
      expect(await store.getUploadManifest("d-upload-none")).toBeNull();
    });
  });
});

describe("KvR2Store KV key namespacing", () => {
  it("stores drafts, approvals, jobs, and upload manifests under the documented prefixes", async () => {
    const store = new KvR2Store({ kv: env.DRAFTS, r2: env.PHOTOS });
    const draft = samplePost({ draftId: "d-namespacing" });
    const stored = await store.put(draft);
    await store.setApproval(draft.draftId, { revision: stored.revision, approvedAt: "t" });
    await store.setJob(draft.draftId, { status: "running" });
    await store.setUploadManifest(draft.draftId, { files: [] });

    expect(await env.DRAFTS.get("draft:d-namespacing")).not.toBeNull();
    expect(await env.DRAFTS.get("approval:d-namespacing")).not.toBeNull();
    expect(await env.DRAFTS.get("job:d-namespacing")).not.toBeNull();
    expect(await env.DRAFTS.get("uploads:d-namespacing")).not.toBeNull();
  });
});

describe("KvR2Store R2 photo path", () => {
  it("stages photos under staged/<draftId>/<filename>", async () => {
    const store = new KvR2Store({ kv: env.DRAFTS, r2: env.PHOTOS });
    await store.putPhoto("d-r2-path", "hero.jpg", new Uint8Array([1, 2, 3]), {
      contentType: "image/jpeg",
      uploadedAt: "t",
    });

    expect(await env.PHOTOS.get("staged/d-r2-path/hero.jpg")).not.toBeNull();
  });
});
