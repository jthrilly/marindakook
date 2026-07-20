import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InMemoryStore } from "../src/core/store";
import type { DraftStore } from "../src/core/store";
import { handleUploadDelete, handleUploadPost, renderUploadPage } from "../src/pages/upload";
import type { UploadDeps } from "../src/pages/upload";

const GOOD_TOKEN = "good-token";
const DRAFT_ID = "d-9";

function makeDeps(store: DraftStore, overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    store,
    verifyLink: (token) => (token === GOOD_TOKEN ? { draftId: DRAFT_ID } : null),
    now: () => new Date("2026-07-20T09:00:00.000Z"),
    ...overrides,
  };
}

function jpeg(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]); // SOI + APP0
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9; // EOI
  return bytes;
}

function postRequest(token: string, bytes: Uint8Array): Request {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), "camera.jpg");
  return new Request(`https://cms.example/upload?draft=${DRAFT_ID}&sig=${token}`, {
    method: "POST",
    body: form,
  });
}

const postBodySchema = z.object({ filename: z.string(), size: z.number() });
const manifestSchema = z.object({
  files: z.array(z.object({ filename: z.string(), size: z.number().optional() })).default([]),
});

async function readManifest(store: DraftStore): Promise<{ filename: string }[]> {
  const raw = await store.getUploadManifest(DRAFT_ID);
  const parsed = manifestSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data.files : [];
}

describe("renderUploadPage", () => {
  it("serves a mobile-first Afrikaans HTML page with the picker as the primary control", async () => {
    const res = renderUploadPage(DRAFT_ID);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('lang="af"');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain("multiple");
  });

  it("ends with the exact Afrikaans done instruction and ships the client re-encode", async () => {
    const html = await renderUploadPage(DRAFT_ID).text();
    expect(html).toContain("Klaar! Gaan terug na jou gesprek en sê 'klaar'.");
    expect(html).toContain("reencodeImage");
    expect(html).toContain('createImageBitmap');
    expect(html).toContain('"image/jpeg"');
  });
});

describe("handleUploadPost", () => {
  it("rejects an invalid signed link with 403 and stages nothing", async () => {
    const store = new InMemoryStore();
    const res = await handleUploadPost(postRequest("wrong", jpeg()), makeDeps(store));
    expect(res.status).toBe(403);
    expect(await store.listPhotos(DRAFT_ID)).toEqual([]);
    expect(await store.getUploadManifest(DRAFT_ID)).toBeNull();
  });

  it("stages a re-encoded JPEG to the store and appends it to the manifest check_uploads reads", async () => {
    const store = new InMemoryStore();
    const res = await handleUploadPost(postRequest(GOOD_TOKEN, jpeg(128)), makeDeps(store));
    expect(res.status).toBe(200);
    const body = postBodySchema.parse(await res.json());
    expect(body.filename).toMatch(/\.jpg$/);
    expect(body.size).toBe(128);

    const stored = await store.getPhoto(DRAFT_ID, body.filename);
    if (stored === null) throw new Error("expected the photo to be staged");
    expect(stored.contentType).toBe("image/jpeg");
    expect(stored.size).toBe(128);

    const files = await readManifest(store);
    expect(files.map((file) => file.filename)).toEqual([body.filename]);
  });

  it("assigns a distinct filename per upload and keeps every entry in the manifest", async () => {
    const store = new InMemoryStore();
    const first = postBodySchema.parse(
      await (await handleUploadPost(postRequest(GOOD_TOKEN, jpeg()), makeDeps(store))).json(),
    );
    const second = postBodySchema.parse(
      await (await handleUploadPost(postRequest(GOOD_TOKEN, jpeg()), makeDeps(store))).json(),
    );
    expect(first.filename).not.toBe(second.filename);
    const files = await readManifest(store);
    expect(files.map((file) => file.filename).sort()).toEqual(
      [first.filename, second.filename].sort(),
    );
  });

  it("defensively rejects a non-JPEG payload (the client must send stripped JPEG)", async () => {
    const store = new InMemoryStore();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await handleUploadPost(postRequest(GOOD_TOKEN, png), makeDeps(store));
    expect(res.status).toBe(415);
    expect(await store.listPhotos(DRAFT_ID)).toEqual([]);
  });

  it("rejects a payload larger than the cap", async () => {
    const store = new InMemoryStore();
    const res = await handleUploadPost(
      postRequest(GOOD_TOKEN, jpeg(2048)),
      makeDeps(store, { maxBytes: 1024 }),
    );
    expect(res.status).toBe(413);
    expect(await store.listPhotos(DRAFT_ID)).toEqual([]);
  });
});

describe("handleUploadDelete", () => {
  it("removes a staged photo and its manifest entry", async () => {
    const store = new InMemoryStore();
    const uploaded = postBodySchema.parse(
      await (await handleUploadPost(postRequest(GOOD_TOKEN, jpeg()), makeDeps(store))).json(),
    );

    const del = new Request(
      `https://cms.example/upload?draft=${DRAFT_ID}&sig=${GOOD_TOKEN}&file=${encodeURIComponent(uploaded.filename)}`,
      { method: "DELETE" },
    );
    const res = await handleUploadDelete(del, makeDeps(store));
    expect(res.status).toBe(200);

    expect(await store.getPhoto(DRAFT_ID, uploaded.filename)).toBeNull();
    expect(await readManifest(store)).toEqual([]);
  });

  it("refuses to delete when the signed link is invalid", async () => {
    const store = new InMemoryStore();
    const uploaded = postBodySchema.parse(
      await (await handleUploadPost(postRequest(GOOD_TOKEN, jpeg()), makeDeps(store))).json(),
    );
    const del = new Request(
      `https://cms.example/upload?draft=${DRAFT_ID}&sig=nope&file=${uploaded.filename}`,
      { method: "DELETE" },
    );
    const res = await handleUploadDelete(del, makeDeps(store));
    expect(res.status).toBe(403);
    expect(await store.getPhoto(DRAFT_ID, uploaded.filename)).not.toBeNull();
  });
});
