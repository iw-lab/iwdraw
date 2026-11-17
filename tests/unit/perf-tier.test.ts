import { describe, expect, it } from "vitest";
import { docScale, learnTier, SLOW_MS, FAST_MS } from "@/lib/perf-tier";
import { fitAspectHelper } from "@/lib/aspect";

/* 🔒 2026-11-17 «렉 걸리는 저사양만 더 낮추고 고사양은 그대로 · 같은 웨일북이라도 잘 도는 기기는 그대로»
 * 판 크기는 기종이 아니라 «이 기기에서 잰 프레임 간격»으로만 움직인다. */
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("기기별 그림 판 단계", () => {
  it("처음 온 기기·잰 적 없는 기기 = 1(그대로)", () => {
    expect(docScale(mem())).toBe(1);
    expect(docScale(null)).toBe(1);
  });
  it("잘 도는 기기는 몇 번을 재도 1 — 웨일북이라도 렉이 없으면 안 내린다", () => {
    const s = mem();
    for (const p75 of [17, 18, 30, 39, 12]) expect(learnTier(p75, docScale(s), s)).toBe(1);
  });
  it("렉 기기는 한 단계씩 내린다 — 1 → 0.75 → 0.6, 더는 안 내린다", () => {
    const s = mem();
    expect(learnTier(64, docScale(s), s)).toBe(0.75);
    expect(learnTier(56, docScale(s), s)).toBe(0.6);
    expect(learnTier(140, docScale(s), s)).toBe(0.6);
    expect(docScale(s)).toBe(0.6);
  });
  it("낮춘 뒤 두 번 연달아 넉넉하면 한 단계 올린다(한 번은 출렁임이라 안 올린다)", () => {
    const s = mem();
    learnTier(SLOW_MS + 5, 1, s);
    expect(learnTier(FAST_MS - 4, 0.75, s)).toBe(0.75);
    expect(learnTier(FAST_MS - 4, 0.75, s)).toBe(1);
  });
  it("넉넉함 사이에 보통 판이 끼면 연속이 끊긴다", () => {
    const s = mem();
    learnTier(60, 1, s);
    learnTier(15, 0.75, s);
    learnTier(30, 0.75, s);
    expect(learnTier(15, 0.75, s)).toBe(0.75);
  });
  it("망가진 저장값·이상한 측정은 1 로", () => {
    const s = mem();
    s.setItem("arton.perf.tier", "{\"i\":99}");
    expect(docScale(s)).toBe(1);
    s.setItem("arton.perf.tier", "nope");
    expect(docScale(s)).toBe(1);
    expect(learnTier(Number.NaN, 1, s)).toBe(1);
  });
});

describe("판 크기", () => {
  it("배율 1 = 지금 그대로(1536×1152)", () => {
    expect(fitAspectHelper(1536 / 1152)).toEqual({ width: 1536, height: 1152 });
    expect(fitAspectHelper(1536 / 1152, 1)).toEqual({ width: 1536, height: 1152 });
  });
  it("0.75 = 1152×864(화소 56%) · 0.6 = 920×690(화소 36%) · 세로·정사각도 같은 비율", () => {
    expect(fitAspectHelper(1536 / 1152, 0.75)).toEqual({ width: 1152, height: 864 });
    expect(fitAspectHelper(1536 / 1152, 0.6)).toEqual({ width: 920, height: 690 });
    expect(fitAspectHelper(1152 / 1536, 0.75)).toEqual({ width: 864, height: 1152 });
    const sq1 = fitAspectHelper(1), sq = fitAspectHelper(1, 0.75);
    expect(Math.abs(sq.width / sq1.width - 0.75)).toBeLessThan(0.01);
  });
});
