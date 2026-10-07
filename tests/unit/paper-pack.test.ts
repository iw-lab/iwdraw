import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetPaperPackForTest,
  __setPackRanksForTest,
  packField,
  sealPaperPack,
} from "../../src/engine/core/paperPack";

function sortedCopy(a: Float32Array): number[] {
  return Array.from(a).sort((x, y) => x - y);
}

describe("종이 결 팩 — 히스토그램 매칭", () => {
  beforeEach(() => __resetPaperPackForTest());

  it("값 분포는 기준(프로시저럴) 그대로, 순서만 팩을 따른다", () => {
    const n = 64 * 64;
    const ref = new Float32Array(n).map((_, i) => 0.3 + 0.4 * ((i * 7919) % n) / n);
    const r = new Uint8Array(n).map((_, i) => (i * 37) % 256);
    __setPackRanksForTest("smooth", "grain", r);
    const out = packField("smooth", "grain", ref)!;
    expect(out).not.toBeNull();
    // 분위수 표본이 기준 분포 안에 있다(새 값 발명 없음) + 범위 보존
    const s = sortedCopy(ref);
    for (const v of out) expect(s.includes(v)).toBe(true);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(s[0]);
    expect(Math.max(...out)).toBeLessThanOrEqual(s[n - 1]);
    // 순서 보존: 순위가 큰 픽셀이 더 큰(같거나) 값
    for (let i = 1; i < n; i++) {
      if (r[i] > r[i - 1]) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
    }
    // 평균이 기준과 거의 같다(곡선·상수 유효의 근거) — 256 단계 양자화 오차만
    const mean = (a: ArrayLike<number>) => Array.from(a).reduce((x, y) => x + y, 0) / a.length;
    expect(Math.abs(mean(out) - mean(ref))).toBeLessThan(0.01);
  });

  it("요구 크기와 다른 팩 파일은 쓰지 않는다(프로시저럴 폴백)", () => {
    __setPackRanksForTest("linen", "grain", new Uint8Array(128 * 128));
    expect(packField("linen", "grain", new Float32Array(256 * 256), 256)).toBeNull();
    __setPackRanksForTest("linen", "grain", new Uint8Array(100)); // 정사각 아님
    expect(packField("linen", "grain", new Float32Array(256 * 256))).toBeNull();
  });

  it("tint 는 기준과 길이가 달라도 분포만 빌린다(512 레시피 ← 256 팩)", () => {
    __setPackRanksForTest("linen", "tint", new Uint8Array(256 * 256).map((_, i) => i % 256));
    const ref = new Float32Array(512 * 512).map((_, i) => (i % 1000) / 1000);
    const out = packField("linen", "tint", ref)!;
    expect(out.length).toBe(256 * 256);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...out)).toBeLessThan(1);
  });

  it("팩이 없는 종이는 null", () => {
    expect(packField("hanji", "tint", new Float32Array(16))).toBeNull();
  });

  it("봉인 함수는 여러 번 불러도 안전", () => {
    sealPaperPack();
    sealPaperPack();
    expect(packField("smooth", "grain", new Float32Array(4))).toBeNull();
  });
});
