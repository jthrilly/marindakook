import { z } from "zod";
import type { DraftStore } from "../core/store";

// The mobile-first photo upload page Marinda opens from a draft-scoped signed
// link. Chat connectors cannot forward image bytes, so photos are picked here
// on her phone, re-encoded in the browser (EXIF orientation baked into the
// pixels, ALL metadata — GPS included — dropped by the canvas re-encode,
// downscaled to a ≤2000px JPEG) and POSTed to the Worker, which stages them in
// R2 and appends to the KV manifest that `check_uploads` reads.
//
// The signed-link verifier is injected (D9 wires the real HMAC one); tests
// pass a stub. The re-encode is the client's job and runs UNCONDITIONALLY —
// even when no downscale is needed — because publish commits to a PUBLIC repo
// and CI is far too late to scrub GPS from git history. The server handler
// still validates defensively (JPEG magic + a size cap) but does not — cannot —
// re-strip metadata; that guarantee lives in the canvas re-encode.

export const MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.85;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

export interface UploadLinkClaims {
  draftId: string;
}

export interface UploadDeps {
  store: DraftStore;
  // Returns the draft the token authorizes, or null when it is missing,
  // tampered, or for another draft. D9 supplies the real HMAC verifier.
  verifyLink: (token: string) => UploadLinkClaims | null | Promise<UploadLinkClaims | null>;
  now?: () => Date;
  maxBytes?: number;
}

// The upload manifest is stored as JSON the store hands back untyped. Parse it
// leniently (older/partial entries tolerated) and always REWRITE it with fully
// populated, required fields so the value stays plain JSON (no `undefined`
// leaking into the JsonValue the store persists).
const manifestFileSchema = z.object({
  filename: z.string(),
  size: z.number().default(0),
  uploadedAt: z.string().default(""),
});

const manifestSchema = z.object({
  files: z.array(manifestFileSchema).default([]),
  updatedAt: z.string().optional(),
});

// A `type` alias (not an interface): TypeScript grants object-literal type
// aliases an implicit index signature, so a fully-populated record is
// assignable to the store's `JsonValue` — an interface would not be, and we
// avoid an `as` cast to bridge the gap.
type ManifestFileRecord = {
  filename: string;
  size: number;
  uploadedAt: string;
};

async function readManifestFiles(store: DraftStore, draftId: string): Promise<ManifestFileRecord[]> {
  const raw = await store.getUploadManifest(draftId);
  const parsed = manifestSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data.files : [];
}

async function writeManifest(
  store: DraftStore,
  draftId: string,
  files: ManifestFileRecord[],
  updatedAt: string,
): Promise<void> {
  await store.setUploadManifest(draftId, { files, updatedAt });
}

function nextFilename(existing: ManifestFileRecord[]): string {
  let max = 0;
  for (const file of existing) {
    const match = /^foto-(\d+)\.jpg$/.exec(file.filename);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `foto-${max + 1}.jpg`;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function tokenFrom(req: Request): string {
  return new URL(req.url).searchParams.get("sig") ?? "";
}

async function authorize(req: Request, deps: UploadDeps): Promise<UploadLinkClaims | null> {
  return deps.verifyLink(tokenFrom(req));
}

export async function handleUploadPost(req: Request, deps: UploadDeps): Promise<Response> {
  const claims = await authorize(req, deps);
  if (claims === null) {
    return json({ error: "Hierdie oplaai-skakel is nie geldig nie." }, 403);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (file === null || typeof file === "string") {
    return json({ error: "Geen foto ontvang nie." }, 400);
  }

  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  if (file.size > maxBytes) {
    return json({ error: "Hierdie foto is te groot." }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) {
    return json({ error: "Net JPEG-foto's word aanvaar." }, 415);
  }

  const uploadedAt = (deps.now ?? (() => new Date()))().toISOString();
  const existing = await readManifestFiles(deps.store, claims.draftId);
  const filename = nextFilename(existing);

  await deps.store.putPhoto(claims.draftId, filename, bytes, {
    contentType: "image/jpeg",
    uploadedAt,
  });
  await writeManifest(
    deps.store,
    claims.draftId,
    [...existing, { filename, size: bytes.byteLength, uploadedAt }],
    uploadedAt,
  );

  return json({ filename, size: bytes.byteLength });
}

export async function handleUploadDelete(req: Request, deps: UploadDeps): Promise<Response> {
  const claims = await authorize(req, deps);
  if (claims === null) {
    return json({ error: "Hierdie oplaai-skakel is nie geldig nie." }, 403);
  }

  const filename = new URL(req.url).searchParams.get("file") ?? "";
  if (filename === "") {
    return json({ error: "Geen foto aangedui om te verwyder nie." }, 400);
  }

  await deps.store.deletePhoto(claims.draftId, filename);
  const existing = await readManifestFiles(deps.store, claims.draftId);
  const remaining = existing.filter((file) => file.filename !== filename);
  await writeManifest(
    deps.store,
    claims.draftId,
    remaining,
    (deps.now ?? (() => new Date()))().toISOString(),
  );

  return json({ ok: true, filename });
}

// The pure browser re-encode, exported as a script string so the Playwright
// e2e test injects the EXACT shipped code into real Chromium (no drift between
// what is tested and what runs on Marinda's phone). It attaches
// `window.reencodeImage(blob) -> Promise<Blob>` and references no page DOM, so
// it is safe to load standalone. `imageOrientation: "from-image"` bakes EXIF
// orientation into the decoded pixels; drawing to a canvas and exporting via
// toBlob emits a JPEG that carries no EXIF/GPS at all.
export const REENCODE_SCRIPT = `
(() => {
  const MAX_EDGE = ${MAX_EDGE};
  const JPEG_QUALITY = ${JPEG_QUALITY};
  async function reencodeImage(blob) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    let width = bitmap.width;
    let height = bitmap.height;
    const longEdge = Math.max(width, height);
    if (longEdge > MAX_EDGE) {
      const scale = MAX_EDGE / longEdge;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("geen 2d-konteks nie");
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === "function") bitmap.close();
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (out) => { if (out) { resolve(out); } else { reject(new Error("kon nie die foto herkodeer nie")); } },
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  }
  window.reencodeImage = reencodeImage;
})();
`;

// DOM wiring: file picker (primary) + drag-drop (desktop enhancement) ->
// re-encode -> POST -> thumbnail with a delete button. Guards on the page's
// own elements so it is inert if injected elsewhere.
const UI_SCRIPT = `
(() => {
  const input = document.getElementById("foto-input");
  const dropzone = document.getElementById("dropzone");
  const gallery = document.getElementById("gallery");
  const status = document.getElementById("status");
  if (!input || !gallery) return;

  function endpoint(extra) {
    const search = window.location.search || "";
    if (!extra) return window.location.pathname + search;
    return window.location.pathname + search + (search ? "&" : "?") + extra;
  }

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function makeCard() {
    const card = document.createElement("figure");
    card.className = "kaart";
    const img = document.createElement("img");
    img.alt = "";
    const bar = document.createElement("figcaption");
    bar.textContent = "Besig om te verwerk\\u2026";
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Verwyder";
    del.hidden = true;
    card.append(img, bar, del);
    gallery.append(card);
    return { card, img, bar, del };
  }

  async function stageOne(file) {
    const parts = makeCard();
    try {
      const blob = await window.reencodeImage(file);
      parts.img.src = URL.createObjectURL(blob);
      const body = new FormData();
      body.append("file", blob, "foto.jpg");
      const res = await fetch(endpoint(), { method: "POST", body: body });
      if (!res.ok) throw new Error("bediener");
      const data = await res.json();
      parts.bar.textContent = "Gestoor";
      parts.del.hidden = false;
      parts.del.addEventListener("click", async () => {
        parts.del.disabled = true;
        const gone = await fetch(endpoint("file=" + encodeURIComponent(data.filename)), { method: "DELETE" });
        if (gone.ok) {
          parts.card.remove();
        } else {
          parts.del.disabled = false;
          setStatus("Kon nie die foto verwyder nie. Probeer weer.");
        }
      });
    } catch (err) {
      parts.bar.textContent = "Kon nie hierdie foto laai nie.";
      parts.card.classList.add("fout");
    }
  }

  async function stageAll(fileList) {
    const files = Array.from(fileList).filter((file) => file.type.indexOf("image/") === 0);
    if (files.length === 0) return;
    setStatus("Besig om jou foto's te verwerk\\u2026");
    for (const file of files) {
      await stageOne(file);
    }
    setStatus("");
  }

  input.addEventListener("change", () => {
    if (input.files) stageAll(input.files);
    input.value = "";
  });

  if (dropzone) {
    const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
    ["dragenter", "dragover", "dragleave", "drop"].forEach((name) => {
      dropzone.addEventListener(name, stop);
    });
    ["dragenter", "dragover"].forEach((name) => {
      dropzone.addEventListener(name, () => dropzone.classList.add("aktief"));
    });
    ["dragleave", "drop"].forEach((name) => {
      dropzone.addEventListener(name, () => dropzone.classList.remove("aktief"));
    });
    dropzone.addEventListener("drop", (event) => {
      if (event.dataTransfer) stageAll(event.dataTransfer.files);
    });
  }
})();
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderUploadPage(draftId: string): Response {
  const safeDraftId = escapeHtml(draftId);
  const html = `<!doctype html>
<html lang="af">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laai jou foto's</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; padding: 1.25rem; max-width: 40rem; margin-inline: auto; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  p.intro { margin: 0 0 1.25rem; color: #555; }
  #dropzone { border: 2px dashed #b98a2e; border-radius: 1rem; padding: 1.5rem 1rem; text-align: center; }
  #dropzone.aktief { background: rgba(185, 138, 46, 0.12); }
  .kies { display: inline-block; margin-top: 0.75rem; padding: 0.9rem 1.4rem; font-size: 1.1rem; font-weight: 600; color: #fff; background: #b98a2e; border-radius: 0.75rem; cursor: pointer; }
  #foto-input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
  #status { min-height: 1.5rem; margin: 1rem 0 0; color: #555; }
  #gallery { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.75rem; padding: 0; margin: 1rem 0 0; }
  figure.kaart { margin: 0; border: 1px solid #ddd; border-radius: 0.75rem; overflow: hidden; display: flex; flex-direction: column; }
  figure.kaart.fout { border-color: #c0392b; }
  figure.kaart img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: #f0f0f0; }
  figure.kaart figcaption { font-size: 0.8rem; padding: 0.4rem 0.5rem; color: #555; }
  figure.kaart button { margin: 0 0.5rem 0.5rem; padding: 0.4rem; border: 1px solid #c0392b; color: #c0392b; background: transparent; border-radius: 0.5rem; cursor: pointer; }
  .klaar { margin-top: 2rem; padding: 1rem; border-radius: 0.75rem; background: rgba(185, 138, 46, 0.12); font-weight: 600; }
</style>
</head>
<body data-draft-id="${safeDraftId}">
<h1>Laai jou foto's</h1>
<p class="intro">Kies die foto's van jou resep. Hulle word outomaties reggedraai, verklein en skoongemaak voordat hulle gestoor word — jou ligging word nooit saam gestoor nie.</p>
<div id="dropzone">
  <p>Sleep foto's hierheen, of kies hulle van jou foon af.</p>
  <label class="kies" for="foto-input">Kies foto's</label>
  <input id="foto-input" type="file" accept="image/*" multiple>
</div>
<p id="status" role="status" aria-live="polite"></p>
<div id="gallery" aria-label="Gelaaide foto's"></div>
<p class="klaar">Klaar! Gaan terug na jou gesprek en sê 'klaar'.</p>
<script>${REENCODE_SCRIPT}</script>
<script>${UI_SCRIPT}</script>
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
