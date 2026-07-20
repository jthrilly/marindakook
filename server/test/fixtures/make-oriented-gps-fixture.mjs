// Reproducible generator for `oriented-gps.jpg` — the committed test fixture.
//
// Run from the REPO ROOT (sharp lives in the root package, not server/):
//   node server/test/fixtures/make-oriented-gps-fixture.mjs
//
// The fixture must genuinely carry BOTH an EXIF Orientation of 6 (rotate 90°
// CW, so a 120x80 landscape frame displays as 80x120 portrait) AND a GPS IFD,
// so the upload page's client re-encode has real location metadata to strip.
// sharp writes the orientation happily but silently drops the GPS IFD, so the
// EXIF/TIFF APP1 block is assembled by hand and spliced into a sharp-encoded
// JPEG. The bytes are checked back with the same parser the Playwright test
// uses (test/e2e/upload.spec.ts) before being written.
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAW_W = 120;
const RAW_H = 80;

// Big-endian ("MM") TIFF: IFD0 { Orientation=6, GPS-pointer } + a GPS IFD
// carrying latitude/longitude rationals.
function buildExifApp1() {
  const tiff = Buffer.alloc(152);
  tiff.write("MM", 0);
  tiff.writeUInt16BE(0x002a, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 at offset 8

  // IFD0: 2 entries.
  tiff.writeUInt16BE(2, 8);
  // Orientation (0x0112) SHORT = 6.
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(6, 18);
  // GPS IFD pointer (0x8825) LONG = offset 38.
  tiff.writeUInt16BE(0x8825, 22);
  tiff.writeUInt16BE(4, 24);
  tiff.writeUInt32BE(1, 26);
  tiff.writeUInt32BE(38, 30);
  tiff.writeUInt32BE(0, 34); // next IFD

  // GPS IFD (offset 38): 5 entries.
  tiff.writeUInt16BE(5, 38);
  const gps = (idx, tag, type, count, write) => {
    const o = 40 + idx * 12;
    tiff.writeUInt16BE(tag, o);
    tiff.writeUInt16BE(type, o + 2);
    tiff.writeUInt32BE(count, o + 4);
    write(o + 8);
  };
  gps(0, 0x0000, 1, 4, (o) => { tiff[o] = 2; tiff[o + 1] = 3; }); // GPSVersionID 2.3.0.0
  gps(1, 0x0001, 2, 2, (o) => { tiff.write("S\0", o); }); // GPSLatitudeRef
  gps(2, 0x0002, 5, 3, (o) => { tiff.writeUInt32BE(104, o); }); // GPSLatitude -> external
  gps(3, 0x0003, 2, 2, (o) => { tiff.write("E\0", o); }); // GPSLongitudeRef
  gps(4, 0x0004, 5, 3, (o) => { tiff.writeUInt32BE(128, o); }); // GPSLongitude -> external
  tiff.writeUInt32BE(0, 100); // GPS IFD next

  const rational = (o, num, den) => { tiff.writeUInt32BE(num, o); tiff.writeUInt32BE(den, o + 4); };
  rational(104, 33, 1); rational(112, 55, 1); rational(120, 5500, 100); // 33°55'55.00"
  rational(128, 18, 1); rational(136, 25, 1); rational(144, 3000, 100); // 18°25'30.00"

  const header = Buffer.alloc(10);
  header[0] = 0xff;
  header[1] = 0xe1;
  header.writeUInt16BE(2 + 6 + tiff.length, 2);
  header.write("Exif\0\0", 4, "binary");
  return Buffer.concat([header, tiff]);
}

const raw = Buffer.alloc(RAW_W * RAW_H * 3);
for (let y = 0; y < RAW_H; y++) {
  for (let x = 0; x < RAW_W; x++) {
    const i = (y * RAW_W + x) * 3;
    if (x < RAW_W / 2) { raw[i] = 220; raw[i + 1] = 30; raw[i + 2] = 30; } // left red
    else { raw[i] = 30; raw[i + 1] = 30; raw[i + 2] = 220; } // right blue
  }
}

const base = await sharp(raw, { raw: { width: RAW_W, height: RAW_H, channels: 3 } })
  .jpeg({ quality: 88 })
  .toBuffer();
const jpeg = Buffer.concat([base.subarray(0, 2), buildExifApp1(), base.subarray(2)]);

const meta = await sharp(jpeg).metadata();
if (meta.orientation !== 6) throw new Error(`expected orientation 6, got ${meta.orientation}`);

const target = fileURLToPath(new URL("./oriented-gps.jpg", import.meta.url));
writeFileSync(target, jpeg);
console.log(`wrote ${jpeg.length} bytes -> ${target} (orientation=${meta.orientation}, ${meta.width}x${meta.height} raw)`);
