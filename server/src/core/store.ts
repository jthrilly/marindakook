import { z } from "zod";
import { chromeDraftSchema, draftPostSchema, type ChromeDraft, type DraftPost } from "./draft-schema";

// The draft/photo store persists everything the MCP tools (later tasks) need
// across chat turns: drafts themselves, staged photo bytes, translation-job
// progress, preview-approval flags, and the upload-page<->chat handoff
// manifest. Two implementations share this file and a single contract test
// (test/store.test.ts): `KvR2Store` (KV for JSON state, R2 for photo bytes —
// the production backend) and `InMemoryStore` (fast unit tests, no runtime
// bindings required).
//
// Revision / approval design: a draft's `revision` is a hash over its
// CONTENT fields only (title, html, recipe, interview, site, ...) —
// deliberately excluding the envelope (`draftId`, `kind`, `createdAt`,
// `updatedAt`). That means re-saving identical content (which bumps
// `updatedAt` on every autosave per the checkpointing mandate) does not
// spuriously invalidate an approval; an actual content edit does. `put()`
// computes and returns the revision alongside the stored draft.
// `setApproval(draftId, {revision, approvedAt})` stores an approval stamped
// with the revision it was granted for. `getApproval(draftId)` re-derives
// validity on every read by comparing the stored approval's revision against
// the draft's CURRENT revision — no separate invalidation step is needed on
// `put()`, and a stale approval is simply invisible once content changes
// (this is the "cleaner API" the task brief invites picking between: no
// `currentRevision` parameter, no cache to keep in sync, one place the
// comparison happens).

export type Draft = DraftPost | ChromeDraft;

const draftUnionSchema = z.discriminatedUnion("kind", [draftPostSchema, chromeDraftSchema]);

export interface StoredDraft {
  draft: Draft;
  revision: string;
}

const storedDraftSchema = z.strictObject({
  draft: draftUnionSchema,
  revision: z.string(),
});

export interface PhotoMeta {
  contentType: string;
  uploadedAt: string;
}

export interface PhotoInfo extends PhotoMeta {
  draftId: string;
  filename: string;
  size: number;
}

export interface StoredPhoto extends PhotoInfo {
  bytes: Uint8Array;
}

const approvalSchema = z.strictObject({
  revision: z.string(),
  approvedAt: z.string(),
});

export type Approval = z.infer<typeof approvalSchema>;

// Job state (Task 5) and the upload manifest (Task 7) are owned by later
// tasks; the store persists whatever JSON-serializable shape they hand it.
const jsonValueSchema = z.json();

export type JsonValue = z.infer<typeof jsonValueSchema>;

export interface DraftStore {
  get(draftId: string): Promise<StoredDraft | null>;
  put(draft: Draft): Promise<StoredDraft>;
  list(): Promise<StoredDraft[]>;
  delete(draftId: string): Promise<void>;

  putPhoto(draftId: string, filename: string, bytes: Uint8Array, meta: PhotoMeta): Promise<PhotoInfo>;
  listPhotos(draftId: string): Promise<PhotoInfo[]>;
  getPhoto(draftId: string, filename: string): Promise<StoredPhoto | null>;
  deletePhoto(draftId: string, filename: string): Promise<void>;

  setApproval(draftId: string, approval: Approval): Promise<void>;
  getApproval(draftId: string): Promise<Approval | null>;

  setJob(draftId: string, job: JsonValue): Promise<void>;
  getJob(draftId: string): Promise<JsonValue | null>;

  setUploadManifest(draftId: string, manifest: JsonValue): Promise<void>;
  getUploadManifest(draftId: string): Promise<JsonValue | null>;
}

const DRAFT_PREFIX = "draft:";
const APPROVAL_PREFIX = "approval:";
const JOB_PREFIX = "job:";
const UPLOADS_PREFIX = "uploads:";
const PHOTO_ROOT = "staged";

function draftKey(draftId: string): string {
  return `${DRAFT_PREFIX}${draftId}`;
}

function approvalKey(draftId: string): string {
  return `${APPROVAL_PREFIX}${draftId}`;
}

function jobKey(draftId: string): string {
  return `${JOB_PREFIX}${draftId}`;
}

function uploadsKey(draftId: string): string {
  return `${UPLOADS_PREFIX}${draftId}`;
}

function photoPrefix(draftId: string): string {
  return `${PHOTO_ROOT}/${draftId}/`;
}

function photoKey(draftId: string, filename: string): string {
  return `${photoPrefix(draftId)}${filename}`;
}

// The field picks are a deliberate contract (mirrors source-hash.ts's
// sourceHashOf): exactly the authored content, never the envelope. `site` is
// the entirety of a chrome draft's editable state, so it stands alone.
function contentBasisOf(draft: Draft): unknown {
  if (draft.kind === "post") {
    return {
      title: draft.title,
      slug: draft.slug,
      excerpt: draft.excerpt,
      categories: draft.categories,
      tags: draft.tags,
      html: draft.html,
      seo: draft.seo,
      recipe: draft.recipe,
      interview: draft.interview,
    };
  }
  return { site: draft.site };
}

async function revisionOf(draft: Draft): Promise<string> {
  const basis = new TextEncoder().encode(stableStringify(contentBasisOf(draft)));
  const digest = await crypto.subtle.digest("SHA-256", basis);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// `JSON.stringify` is sensitive to object key insertion order, which is not
// part of the content contract — two drafts with identical field values but
// differently-ordered nested objects (e.g. `seo`) must hash the same. Sorting
// keys recursively (arrays keep their order; only object keys are sorted)
// makes the hash canonical.
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, sortKeysDeep(entryValue)]));
  }
  return value;
}

// Two clone helpers rather than one generic: `Draft` is a narrower type than
// `JsonValue` (zod knows its exact shape), so re-parsing it through
// `draftUnionSchema` recovers `Draft` precisely, whereas `jsonValueSchema`
// can only ever hand back the wide `JsonValue` union — a single generic
// `<T extends JsonValue>(value: T): T` cannot be satisfied by either parse
// without an unsound cast.
function cloneDraft(draft: Draft): Draft {
  return draftUnionSchema.parse(JSON.parse(JSON.stringify(draft)));
}

function cloneJsonValue(value: JsonValue): JsonValue {
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

export class InMemoryStore implements DraftStore {
  private readonly drafts = new Map<string, StoredDraft>();
  private readonly photos = new Map<string, StoredPhoto>();
  private readonly approvals = new Map<string, Approval>();
  private readonly jobs = new Map<string, JsonValue>();
  private readonly manifests = new Map<string, JsonValue>();

  async get(draftId: string): Promise<StoredDraft | null> {
    const stored = this.drafts.get(draftId);
    return stored ? cloneStoredDraft(stored) : null;
  }

  async put(draft: Draft): Promise<StoredDraft> {
    const revision = await revisionOf(draft);
    const stored: StoredDraft = { draft: cloneDraft(draft), revision };
    this.drafts.set(draft.draftId, stored);
    return cloneStoredDraft(stored);
  }

  async list(): Promise<StoredDraft[]> {
    return Array.from(this.drafts.values(), cloneStoredDraft);
  }

  async delete(draftId: string): Promise<void> {
    this.drafts.delete(draftId);
    this.approvals.delete(draftId);
    this.jobs.delete(draftId);
    this.manifests.delete(draftId);
  }

  async putPhoto(draftId: string, filename: string, bytes: Uint8Array, meta: PhotoMeta): Promise<PhotoInfo> {
    const stored: StoredPhoto = {
      draftId,
      filename,
      contentType: meta.contentType,
      uploadedAt: meta.uploadedAt,
      size: bytes.byteLength,
      bytes: Uint8Array.from(bytes),
    };
    this.photos.set(photoKey(draftId, filename), stored);
    return photoInfoOf(stored);
  }

  async listPhotos(draftId: string): Promise<PhotoInfo[]> {
    const prefix = photoPrefix(draftId);
    return Array.from(this.photos.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, stored]) => photoInfoOf(stored));
  }

  async getPhoto(draftId: string, filename: string): Promise<StoredPhoto | null> {
    const stored = this.photos.get(photoKey(draftId, filename));
    return stored ? { ...stored, bytes: Uint8Array.from(stored.bytes) } : null;
  }

  async deletePhoto(draftId: string, filename: string): Promise<void> {
    this.photos.delete(photoKey(draftId, filename));
  }

  async setApproval(draftId: string, approval: Approval): Promise<void> {
    this.approvals.set(draftId, { ...approval });
  }

  async getApproval(draftId: string): Promise<Approval | null> {
    const stored = this.approvals.get(draftId);
    if (!stored) {
      return null;
    }
    const current = this.drafts.get(draftId);
    if (!current || current.revision !== stored.revision) {
      return null;
    }
    return { ...stored };
  }

  async setJob(draftId: string, job: JsonValue): Promise<void> {
    this.jobs.set(draftId, cloneJsonValue(job));
  }

  async getJob(draftId: string): Promise<JsonValue | null> {
    const stored = this.jobs.get(draftId);
    return stored === undefined ? null : cloneJsonValue(stored);
  }

  async setUploadManifest(draftId: string, manifest: JsonValue): Promise<void> {
    this.manifests.set(draftId, cloneJsonValue(manifest));
  }

  async getUploadManifest(draftId: string): Promise<JsonValue | null> {
    const stored = this.manifests.get(draftId);
    return stored === undefined ? null : cloneJsonValue(stored);
  }
}

function cloneStoredDraft(stored: StoredDraft): StoredDraft {
  return { draft: cloneDraft(stored.draft), revision: stored.revision };
}

function photoInfoOf(stored: StoredPhoto): PhotoInfo {
  return {
    draftId: stored.draftId,
    filename: stored.filename,
    contentType: stored.contentType,
    uploadedAt: stored.uploadedAt,
    size: stored.size,
  };
}

export class KvR2Store implements DraftStore {
  private readonly kv: KVNamespace;
  private readonly r2: R2Bucket;

  constructor(deps: { kv: KVNamespace; r2: R2Bucket }) {
    this.kv = deps.kv;
    this.r2 = deps.r2;
  }

  async get(draftId: string): Promise<StoredDraft | null> {
    const raw = await this.kv.get(draftKey(draftId));
    return raw === null ? null : storedDraftSchema.parse(JSON.parse(raw));
  }

  async put(draft: Draft): Promise<StoredDraft> {
    const revision = await revisionOf(draft);
    const stored: StoredDraft = { draft: cloneDraft(draft), revision };
    await this.kv.put(draftKey(draft.draftId), JSON.stringify(stored));
    return stored;
  }

  async list(): Promise<StoredDraft[]> {
    const results: StoredDraft[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: DRAFT_PREFIX, cursor });
      for (const key of page.keys) {
        const raw = await this.kv.get(key.name);
        if (raw !== null) {
          results.push(storedDraftSchema.parse(JSON.parse(raw)));
        }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor !== undefined);
    return results;
  }

  async delete(draftId: string): Promise<void> {
    await Promise.all([
      this.kv.delete(draftKey(draftId)),
      this.kv.delete(approvalKey(draftId)),
      this.kv.delete(jobKey(draftId)),
      this.kv.delete(uploadsKey(draftId)),
    ]);
  }

  async putPhoto(draftId: string, filename: string, bytes: Uint8Array, meta: PhotoMeta): Promise<PhotoInfo> {
    await this.r2.put(photoKey(draftId, filename), bytes, {
      httpMetadata: { contentType: meta.contentType },
      customMetadata: { uploadedAt: meta.uploadedAt },
    });
    return { draftId, filename, contentType: meta.contentType, uploadedAt: meta.uploadedAt, size: bytes.byteLength };
  }

  async listPhotos(draftId: string): Promise<PhotoInfo[]> {
    const prefix = photoPrefix(draftId);
    const results: PhotoInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.r2.list({ prefix, cursor, include: ["httpMetadata", "customMetadata"] });
      for (const object of page.objects) {
        results.push({
          draftId,
          filename: object.key.slice(prefix.length),
          contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
          uploadedAt: object.customMetadata?.uploadedAt ?? object.uploaded.toISOString(),
          size: object.size,
        });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
    return results;
  }

  async getPhoto(draftId: string, filename: string): Promise<StoredPhoto | null> {
    const object = await this.r2.get(photoKey(draftId, filename));
    if (object === null) {
      return null;
    }
    const bytes = await object.bytes();
    return {
      draftId,
      filename,
      contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      uploadedAt: object.customMetadata?.uploadedAt ?? object.uploaded.toISOString(),
      size: object.size,
      bytes,
    };
  }

  async deletePhoto(draftId: string, filename: string): Promise<void> {
    await this.r2.delete(photoKey(draftId, filename));
  }

  async setApproval(draftId: string, approval: Approval): Promise<void> {
    await this.kv.put(approvalKey(draftId), JSON.stringify(approval));
  }

  async getApproval(draftId: string): Promise<Approval | null> {
    const raw = await this.kv.get(approvalKey(draftId));
    if (raw === null) {
      return null;
    }
    const stored = approvalSchema.parse(JSON.parse(raw));
    const current = await this.get(draftId);
    if (!current || current.revision !== stored.revision) {
      return null;
    }
    return stored;
  }

  async setJob(draftId: string, job: JsonValue): Promise<void> {
    await this.kv.put(jobKey(draftId), JSON.stringify(job));
  }

  async getJob(draftId: string): Promise<JsonValue | null> {
    const raw = await this.kv.get(jobKey(draftId));
    return raw === null ? null : jsonValueSchema.parse(JSON.parse(raw));
  }

  async setUploadManifest(draftId: string, manifest: JsonValue): Promise<void> {
    await this.kv.put(uploadsKey(draftId), JSON.stringify(manifest));
  }

  async getUploadManifest(draftId: string): Promise<JsonValue | null> {
    const raw = await this.kv.get(uploadsKey(draftId));
    return raw === null ? null : jsonValueSchema.parse(JSON.parse(raw));
  }
}
