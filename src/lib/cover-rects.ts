// 전시관용 «이름 가리기»(2026-11-03) — 교사가 그린 네모 안을 바깥 둘레 색으로 메운다(주변 색이 안쪽으로 번지듯).
//   순수 부분(fillRect)은 픽셀 배열만 다룬다 — 시험 tests/unit/cover-rects.test.ts
export interface Rect { x: number; y: number; w: number; h: number } // 0~1 비율

/** RGBA 배열의 네모(px)를 둘레에서 안쪽으로 이웃 평균을 번져 메운다 — 글씨 획이 남지 않는다 */
export function fillRect(d: Uint8ClampedArray, W: number, H: number, x0: number, y0: number, x1: number, y1: number) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  if (x1 <= x0 || y1 <= y0) return;
  const known = new Uint8Array(W * H).fill(1);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) known[y * W + x] = 0;
  let left = (x1 - x0) * (y1 - y0);
  for (let pass = 0; pass < 2000 && left > 0; pass++) {
    const fill: [number, number, number, number][] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x; if (known[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx; if (!known[j]) continue; r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
      }
      if (n) fill.push([i, r / n, g / n, b / n]);
    }
    if (!fill.length) break;
    for (const [i, r, g, b] of fill) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; known[i] = 1; left--; }
  }
}

/** 그림(같은 출처 img)을 원래 크기 캔버스에 그리고 네모들을 메워 webp 로 */
export async function coverRects(img: HTMLImageElement, rects: Rect[]): Promise<Blob | null> {
  const W = img.naturalWidth, H = img.naturalHeight; if (!W || !H) return null;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); if (!g) return null;
  g.drawImage(img, 0, 0);
  const im = g.getImageData(0, 0, W, H);
  for (const r of rects) fillRect(im.data, W, H, r.x * W - 1, r.y * H - 1, (r.x + r.w) * W + 1, (r.y + r.h) * H + 1);
  g.putImageData(im, 0, 0);
  return new Promise((res) => cv.toBlob((b) => res(b), "image/webp", 0.9));
}
