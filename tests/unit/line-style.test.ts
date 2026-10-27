import { describe, it, expect, beforeAll } from "vitest";

/* 도안 선 굵기·진하기 사본(2026-10-27) — 원본은 그대로, 굵기는 양옆으로 1px 씩, 진하기는 회색을 검정 쪽으로 · 흰 바탕은 그대로 */
beforeAll(() => {
  if (typeof globalThis.ImageData === "undefined") {
    (globalThis as unknown as { ImageData: unknown }).ImageData = class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    };
  }
});

function img(w: number, h: number, ink: (x: number, y: number) => number) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = (y * w + x) * 4, v = 255 - ink(x, y);
      d[q] = d[q + 1] = d[q + 2] = v;
      d[q + 3] = 255;
    }
  return new ImageData(d, w, h);
}
const darkCount = (im: ImageData) => {
  let n = 0;
  for (let q = 0; q < im.data.length; q += 4) if (im.data[q] < 128) n++;
  return n;
};

describe("styleLineart", async () => {
  const { styleLineart } = await import("@/engine/core/lineStyle");
  const line = () => img(20, 20, (x) => (x === 10 ? 255 : 0)); // 세로 1px 검은 선, 흰 바탕

  it("굵기 0·진하기 1 = 그대로 · 원본은 안 바뀐다", () => {
    const src = line();
    const before = src.data.slice();
    const out = styleLineart(src, 0, 1);
    expect(Array.from(out.data)).toEqual(Array.from(before));
    styleLineart(src, 3, 3);
    expect(Array.from(src.data)).toEqual(Array.from(before));
  });

  it("굵기 n = 양옆으로 n px 씩", () => {
    for (const wgt of [1, 2, 3]) expect(darkCount(styleLineart(line(), wgt, 1))).toBe(20 * (1 + 2 * wgt));
  });

  it("진하기 > 1 = 회색이 진해지고 흰 바탕은 그대로", () => {
    const gray = img(4, 1, (x) => [0, 64, 128, 200][x]);
    const out = styleLineart(gray, 0, 3);
    expect(out.data[0]).toBe(255); // 흰 바탕
    expect(out.data[4]).toBeLessThan(255 - 64);
    expect(out.data[8]).toBeLessThan(255 - 128 - 40);
    expect(out.data[12]).toBeLessThan(255 - 200);
  });

  it("최대 진하기(300% = 감마 8) = 연한 회색 선(밝기 69%)도 거의 검정", async () => {
    const { LINE_DARK_MAX } = await import("@/engine/core/lineStyle");
    expect(LINE_DARK_MAX).toBeGreaterThanOrEqual(8);
    const out = styleLineart(img(2, 1, (x) => [0, 80][x]), 0, LINE_DARK_MAX);
    expect(out.data[0]).toBe(255);
    expect(out.data[4]).toBeLessThan(25);
  });
});
