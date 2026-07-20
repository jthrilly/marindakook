import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { REENCODE_SCRIPT } from "../../src/pages/upload";

// Ground truth for the spec's non-negotiable guarantee: the client re-encode
// bakes EXIF orientation into the pixels and emits a JPEG carrying ZERO
// EXIF/GPS. We run the EXACT shipped `reencodeImage` (imported from the page
// module) inside real Chromium against a fixture that genuinely carries
// Orientation=6 + a GPS IFD, then parse the OUTPUT bytes to prove the strip.

const fixturePath = fileURLToPath(new URL("../fixtures/oriented-gps.jpg", import.meta.url));
const fixture = readFileSync(fixturePath);

// ---- dependency-free byte-level Exif reader (walks JPEG + TIFF/IFD0) ----
function findExifSegment(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null; // SOS / EOI
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1) {
      const s = offset + 4;
      const isExif =
        bytes[s] === 0x45 &&
        bytes[s + 1] === 0x78 &&
        bytes[s + 2] === 0x69 &&
        bytes[s + 3] === 0x66 &&
        bytes[s + 4] === 0x00 &&
        bytes[s + 5] === 0x00;
      if (isExif) return bytes.subarray(s + 6, offset + 2 + segLen);
    }
    offset += 2 + segLen;
  }
  return null;
}

function parseExif(tiff: Uint8Array): { orientation: number | null; hasGps: boolean } {
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const u16 = (o: number): number =>
    little ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1];
  const u32 = (o: number): number =>
    little
      ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0
      : ((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0;
  const ifd0 = u32(4);
  const count = u16(ifd0);
  let orientation: number | null = null;
  let hasGps = false;
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    const tag = u16(entry);
    if (tag === 0x0112) orientation = u16(entry + 8);
    if (tag === 0x8825) hasGps = true;
  }
  return { orientation, hasGps };
}

function hasExifMarker(bytes: Uint8Array): boolean {
  return findExifSegment(bytes) !== null;
}

interface Reencoded {
  bytes: number[];
  width: number;
  height: number;
  type: string;
}

test("the fixture genuinely carries EXIF orientation 6 and GPS (so the strip is meaningful)", () => {
  const seg = findExifSegment(fixture);
  expect(seg).not.toBeNull();
  if (seg === null) return;
  const parsed = parseExif(seg);
  expect(parsed.orientation).toBe(6);
  expect(parsed.hasGps).toBe(true);
});

test("re-encoding the rotated GPS fixture outputs an oriented JPEG with zero EXIF/GPS", async ({
  page,
}) => {
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ content: REENCODE_SCRIPT });

  const out = await page.evaluate<Reencoded, number[]>(async (byteArray) => {
    const blob = new Blob([new Uint8Array(byteArray)], { type: "image/jpeg" });
    const result = await window.reencodeImage(blob);
    const bmp = await createImageBitmap(result);
    const buf = new Uint8Array(await result.arrayBuffer());
    return { bytes: Array.from(buf), width: bmp.width, height: bmp.height, type: result.type };
  }, Array.from(fixture));

  const bytes = new Uint8Array(out.bytes);

  // JPEG.
  expect(out.type).toBe("image/jpeg");
  expect(bytes[0]).toBe(0xff);
  expect(bytes[1]).toBe(0xd8);
  expect(bytes[2]).toBe(0xff);

  // Orientation baked into pixels: a 120x80 landscape frame tagged orientation
  // 6 must come out as an 80x120 portrait (dimensions swapped).
  expect(out.width).toBe(80);
  expect(out.height).toBe(120);

  // Long edge within the cap.
  expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2000);

  // The whole point: no EXIF/GPS survives. The input had an Exif APP1 with a
  // GPS IFD; the output must have no Exif APP1 segment at all.
  expect(hasExifMarker(fixture)).toBe(true);
  expect(hasExifMarker(bytes)).toBe(false);
});

test("re-encoding downscales an over-large image to a 2000px long edge, still stripped JPEG", async ({
  page,
}) => {
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ content: REENCODE_SCRIPT });

  const out = await page.evaluate<Reencoded>(async () => {
    const source = document.createElement("canvas");
    source.width = 3000;
    source.height = 1500;
    const sctx = source.getContext("2d");
    if (!sctx) throw new Error("no ctx");
    sctx.fillStyle = "#2266aa";
    sctx.fillRect(0, 0, 3000, 1500);
    const png: Blob = await new Promise((resolve, reject) => {
      source.toBlob((b) => { if (b) { resolve(b); } else { reject(new Error("no blob")); } }, "image/png");
    });
    const result = await window.reencodeImage(png);
    const bmp = await createImageBitmap(result);
    const buf = new Uint8Array(await result.arrayBuffer());
    return { bytes: Array.from(buf), width: bmp.width, height: bmp.height, type: result.type };
  });

  expect(out.type).toBe("image/jpeg");
  expect(Math.max(out.width, out.height)).toBe(2000);
  expect(out.width).toBe(2000);
  expect(out.height).toBe(1000);
  expect(hasExifMarker(new Uint8Array(out.bytes))).toBe(false);
});
