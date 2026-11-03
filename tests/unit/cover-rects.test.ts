// 🔒 2026-11-03 그림 속 실명 — 교사가 그린 네모 안 글씨가 남지 않고 둘레 색으로 메워진다
import { describe, expect, it } from "vitest";
import { fillRect } from "../../src/lib/cover-rects";

describe("이름 가리기", () => {
  it("노란 바탕 위 검은 글씨 → 네모 안이 노랑으로 · 바깥은 그대로", () => {
    const W = 40, H = 20, d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) d.set([250, 220, 90, 255], i * 4);
    for (let y = 8; y < 13; y++) for (let x = 15; x < 26; x++) d.set([20, 20, 20, 255], (y * W + x) * 4);   /* «글씨» */
    const out = d.slice(0, 4 * W);
    fillRect(d, W, H, 14, 7, 27, 14);
    let dark = 0; for (let i = 0; i < W * H; i++) if (d[i * 4] < 120) dark++;
    expect(dark).toBe(0);
    expect([...d.slice(0, 4 * W)]).toEqual([...out]);
  });
  it("그림 끝에 걸친 네모도 안전(밖은 자르고 채운다)", () => {
    const W = 10, H = 10, d = new Uint8ClampedArray(W * H * 4).fill(200);
    d.set([0, 0, 0, 255], (9 * W + 9) * 4);
    fillRect(d, W, H, 7, 7, 15, 15);
    expect(d[(9 * W + 9) * 4]).toBeGreaterThan(150);
  });
});
