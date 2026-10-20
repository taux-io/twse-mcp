#!/usr/bin/env node
/**
 * make-icons.mjs
 * --------------
 * 產生網站圖示，輸出成 `src/icons.ts`（常數）。
 *   用法： npm run make-icons
 *
 * 圖樣與 `FAVICON_SVG` 同一張：港灣藍圓角方塊上三條白色橫線（32×32 的座標系）。
 * SVG 給現代瀏覽器；`/favicon.ico` 給不讀 <link> 就直接來要的爬蟲與舊瀏覽器；
 * `/apple-touch-icon.png` 給 iOS 加到主畫面。
 *
 * 和 make-og.mjs 同樣的做法：不引影像相依，PNG 是手寫的編碼器（node:zlib），
 * 邊緣用 4×4 超取樣抗鋸齒。ICO 的每個影像直接放 PNG（Vista 以後都支援）。
 * 配色是 src/site.ts 的 --accent；不用紅綠（見 DESIGN.md 的 No Red-Green Rule）。
 */
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "icons.ts");
const BLUE = [0x2f, 0x5d, 0x8a];
const WHITE = [0xff, 0xff, 0xff];

export const SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#2f5d8a'/>" +
  "<path d='M9 11h14M9 16h14M9 21h9' stroke='#fff' stroke-width='2.5' stroke-linecap='round'/></svg>";

// 三條線：起點、終點（32 座標系），線寬 2.5、圓頭。
const LINES = [
  [9, 11, 23, 11],
  [9, 16, 23, 16],
  [9, 21, 18, 21],
];

function inRoundRect(x, y, r) {
  // 32×32、圓角 r 的方塊
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inLine(x, y, [x0, y0, x1, y1], hw) {
  const dx = x1 - x0,
    dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return (x - (x0 + t * dx)) ** 2 + (y - (y0 + t * dy)) ** 2 <= hw * hw;
}

/** 渲染 size×size 的 RGBA。squircle=false：圓角方塊＋透明角；apple 版不留透明（iOS 自己裁圓角）。 */
function render(size, { opaque = false } = {}) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cover = 0,
        white = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) * 32) / size;
          const y = ((py + (sy + 0.5) / SS) * 32) / size;
          if (opaque || inRoundRect(x, y, 7)) {
            cover++;
            if (LINES.some((l) => inLine(x, y, l, 1.25))) white++;
          }
        }
      }
      const n = SS * SS;
      const a = cover / n;
      const w = cover ? white / cover : 0;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) buf[o + c] = Math.round(BLUE[c] * (1 - w) + WHITE[c] * w);
      buf[o + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b) {
  let c = 0xffffffff;
  for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([head, ...dir, ...images.map((i) => i.data)]);
}

const apple = png(180, render(180, { opaque: true }));
const icoBuf = ico([16, 32, 48].map((size) => ({ size, data: png(size, render(size)) })));

await writeFile(
  OUT,
  `/**
 * icons.ts — 由 \`npm run make-icons\` 產生，請勿手改。
 *
 * 網站圖示：SVG（現代瀏覽器）、ICO（直接來要 /favicon.ico 的爬蟲與舊瀏覽器）、
 * apple-touch-icon（iOS 加到主畫面）。圖樣與產生方式見 scripts/make-icons.mjs。
 */
export const FAVICON_SVG =
  ${JSON.stringify(SVG)};
export const FAVICON_ICO_BASE64 =
  "${icoBuf.toString("base64")}";
export const APPLE_ICON_BASE64 =
  "${apple.toString("base64")}";
`,
);
console.log(`icons.ts：svg ${SVG.length} B、ico ${icoBuf.length} B、apple ${apple.length} B`);
