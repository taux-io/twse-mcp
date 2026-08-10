#!/usr/bin/env node
/**
 * make-og.mjs
 * -----------
 * 產生社群分享卡片用的 og:image，輸出成 `src/og-image.ts`（base64 常數）。
 *   用法： npm run make-og
 *
 * ## 為什麼是程式產生而不是放一張圖檔
 *
 * Worker 沒有靜態資產綁定（見 src/site.ts 的說明），而 og:image **必須是 URL**，
 * 不能用 data: URI，所以圖必須由 Worker 自己服務。把 PNG 的位元組以 base64 存成
 * 一個 TypeScript 常數，是不動建置設定就能做到的方式。
 *
 * ## 為什麼圖上沒有文字
 *
 * 畫文字需要字型光柵化（而且標題含中文，需要一套 CJK 字型），那會拉進一個相當大的
 * 相依，跟本專案「整頁零外部資源」的取捨衝突。社群卡片的標題與描述本來就由 og:title
 * 與 og:description 提供，圖只需要是可辨識的視覺標記。所以這裡畫的是抽象的行情柱狀，
 * **刻意不用紅綠**——台股的紅是漲、綠是跌，拿它們當品牌色會讓卡片被讀成行情訊號。
 *
 * ## PNG 是手寫的編碼器
 *
 * 只用 node:zlib，不引任何影像相依。構圖是幾個實心矩形，deflate 後極小。
 */
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "og-image.ts");

/** Open Graph 建議的尺寸；1.91:1。 */
const W = 1200;
const H = 630;

// 與 src/site.ts 的深色配色同一組值。改配色時兩邊要一起改——
// test/server.test.ts 只驗得到圖的尺寸與格式，驗不到色票是否一致。
const BG = [0x12, 0x14, 0x16];
const BAR = [0x8a, 0xb6, 0xe2];
const BAR_DIM = [0x2f, 0x5d, 0x8a];
const RULE = [0x28, 0x2c, 0x31];

const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) px.set(BG, i * 3);

function rect(x, y, w, h, rgb) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) px.set(rgb, (yy * W + xx) * 3);
  }
}

// 基線。留 130px 底部留白、頂部約 80px，讓柱體在 1.91:1 的框裡置中而不是沉在下緣。
rect(0, H - 130, W, 2, RULE);

/**
 * 一組上升的柱體。高度是寫死的序列而不是亂數——建置產物必須可重現，
 * 不然每次執行都會產生一份不同的 diff。
 */
const HEIGHTS = [0.18, 0.26, 0.22, 0.34, 0.3, 0.44, 0.4, 0.55, 0.5, 0.66, 0.62, 0.8];
const COUNT = HEIGHTS.length;
const GAP = 26;
const LEFT = 140;
const RIGHT = 140;
const BAR_W = (W - LEFT - RIGHT - GAP * (COUNT - 1)) / COUNT;
const MAX_H = 420;
const BASE = H - 130;

HEIGHTS.forEach((f, i) => {
  const h = MAX_H * f;
  const x = LEFT + i * (BAR_W + GAP);
  // 後段用亮色、前段用暗色，讓「往上走」這件事在縮圖尺寸下仍讀得出來
  rect(x, BASE - h, BAR_W, h, i >= COUNT - 4 ? BAR : BAR_DIM);
});

// 沒有落款色塊：孤立的一小條在縮圖裡看起來像瑕疵而不是設計。

/** PNG：每列前面加一個 filter type 0（None）。 */
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let TABLE;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type 2 = truecolour RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const b64 = png.toString("base64");
const ts = `/**
 * og-image.ts — 由 \`npm run make-og\` 產生，請勿手改。
 *
 * 社群分享卡片的圖，${W}×${H} PNG，以 base64 內嵌。og:image 必須是 URL 而不能是
 * data: URI，所以由 Worker 在 /og.png 服務。構圖與「為什麼圖上沒有文字」的理由見
 * scripts/make-og.mjs。
 */
export const OG_IMAGE_WIDTH = ${W};
export const OG_IMAGE_HEIGHT = ${H};
export const OG_IMAGE_BASE64 =
  "${b64}";
`;
await writeFile(OUT, ts, "utf-8");
process.stderr.write(`wrote ${png.length} bytes PNG (${b64.length} b64) -> ${OUT}\n`);
