// ponytail: build-time icon rasterizer. Runs once per package; idempotent on
// SVG mtime. No native deps (resvg-js = WASM, png-to-ico = pure JS).
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve('src/renderer/public/icon.svg');
const OUT_DIR = path.resolve('buildResources');
const OUT = path.join(OUT_DIR, 'icon.ico');
// 7 sizes — 16 (taskbar) / 24 (HiDPI taskbar) / 32 (Explorer list) /
// 48 (Explorer tile) / 64 (HiDPI Explorer) / 128 (Start tile) /
// 256 (electron-builder requires 256x256 for the .exe). PNG-encoded so
// the 256 entry is ~5-15 KB; total ICO stays well under 100 KB.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Custom PNG-in-ICO encoder. png-to-ico wraps each entry as a 32-bit BMP
// (no compression) — fine for 16/32/48 but 128×128×4 alone is 65 KB and the
// 256 entry balloons to 262 KB. Windows Vista+ accepts raw PNG bytes in
// each ICONDIRENTRY; we encode the headers ourselves so the file stays
// under 100 KB.
async function pngsToIco(pngBuffers, widths) {
  const count = pngBuffers.length;
  const headerLen = 6 + count * 16;
  let dataOffset = headerLen;
  const entries = pngBuffers.map((buf, i) => {
    const w = widths[i] >= 256 ? 0 : widths[i];
    const e = Buffer.alloc(16);
    e.writeUInt8(w, 0);                  // width (0 = 256)
    e.writeUInt8(w, 1);                  // height (0 = 256)
    e.writeUInt8(0, 2);                  // color count (0 = >256)
    e.writeUInt8(0, 3);                  // reserved
    e.writeUInt16LE(1, 4);               // color planes
    e.writeUInt16LE(32, 6);              // bits per pixel
    e.writeUInt32LE(buf.length, 8);      // image data size
    e.writeUInt32LE(dataOffset, 12);     // offset to image data
    dataOffset += buf.length;
    return e;
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type = ICO
  header.writeUInt16LE(count, 4);
  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

async function main() {
  try {
    const srcStat = await fs.stat(SRC);
    let upToDate = false;
    try {
      const outStat = await fs.stat(OUT);
      upToDate = outStat.mtimeMs >= srcStat.mtimeMs;
    } catch {
      // OUT doesn't exist yet — first build
    }
    if (upToDate) {
      console.log('Up to date');
      return;
    }

    const svg = await fs.readFile(SRC);
    const pngBuffers = SIZES.map((size) => {
      // @resvg/resvg-js@2.x: fitTo is { mode: 'width'|'height', value }.
      // The { width, height } shape silently no-ops when the source SVG
      // declares an explicit width/height, leaving every raster at 48×48.
      const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
      return resvg.render().asPng();
    });
    // ponytail: keep the png-to-ico dep for the documented CLI fallback
    // (someone might want to regenerate a one-off BMP ICO); the actual
    // packaging build uses the PNG encoder above to stay under 100 KB.
    void pngToIco;
    const ico = await pngsToIco(pngBuffers, SIZES);

    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT, ico);
    console.log(`Wrote ${OUT} (${(ico.length / 1024).toFixed(1)} KB, ${SIZES.length} sizes)`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();