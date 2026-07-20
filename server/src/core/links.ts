// Draft-scoped signed links for the upload and preview pages. Marinda opens
// these from her chat, so they carry no login — the HMAC signature IS the
// authorization. A link stays valid for the draft's whole lifetime (no TTL):
// the spec wants Marinda to reopen the same upload/preview link across a long
// authoring session without it silently expiring. The `kind` binds a token to
// one page, so an upload token can never open the preview page or vice versa.

export type LinkKind = "upload" | "preview";

export interface LinkPayload {
  draftId: string;
  kind: LinkKind;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payloadBytes: Uint8Array, secret: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return new Uint8Array(signature);
}

// Length-independent equality: XOR every byte and OR the differences so the
// loop runs the same number of steps regardless of where a mismatch is. A
// differing length is only ever a malformed token (the HMAC digest is a fixed
// 32 bytes), so returning early on it leaks nothing about the secret.
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

export async function signLink(payload: LinkPayload, secret: string): Promise<string> {
  const payloadBytes = encoder.encode(JSON.stringify({ draftId: payload.draftId, kind: payload.kind }));
  const signature = await sign(payloadBytes, secret);
  return `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(signature)}`;
}

function parsePayload(bytes: Uint8Array): LinkPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record: Record<string, unknown> = { ...value };
  const draftId = record.draftId;
  const kind = record.kind;
  if (typeof draftId !== "string" || draftId.length === 0) {
    return null;
  }
  if (kind !== "upload" && kind !== "preview") {
    return null;
  }
  return { draftId, kind };
}

export async function verifyLink(token: string, secret: string): Promise<LinkPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return null;
  }
  const payloadBytes = base64UrlToBytes(token.slice(0, dot));
  const providedSignature = base64UrlToBytes(token.slice(dot + 1));
  if (payloadBytes === null || providedSignature === null) {
    return null;
  }
  const expectedSignature = await sign(payloadBytes, secret);
  if (!constantTimeEqual(expectedSignature, providedSignature)) {
    return null;
  }
  return parsePayload(payloadBytes);
}
