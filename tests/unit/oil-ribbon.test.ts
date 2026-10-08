import { describe, it, expect } from "vitest";
import { createBrush } from "@/engine/brushes";
import { mulberry32 } from "@/engine/types";
import { RIBBON, ribbonLen } from "@/engine/core/ribbon";
import type { BrushSettings, Dab, StrokePoint } from "@/engine/types";

const SETTINGS: BrushSettings = { size: 30, opacity: 1, color: { r: 40, g: 90, b: 200 }, waterAmount: 0.5, stabilize: 3 };

/** 직선 획 하나 — 이동마다 받은 조각과 손 뗄 때 받은 조각을 따로 돌려준다 */
function stroke(len: number, seed = 1) {
  const b = createBrush("oilribbon", mulberry32(seed));
  const live: Dab[] = [];
  live.push(...b.begin({ x: 0, y: 0, pressure: 0.6, t: 0 }, SETTINGS));
  for (let x = 10; x <= len; x += 10) live.push(...b.move({ x, y: 0, pressure: 0.6, t: x } as StrokePoint));
  const tail = b.end();
  return { b, live, tail, width: b.strokePx(SETTINGS.size) };
}

const u = (r: readonly [number, number]) => [r[0] / RIBBON.W, r[1] / RIBBON.W];

describe("납작붓(리본 유화)", () => {
  it("모든 조각이 띠 텍스처의 유효 구간을 가리킨다", () => {
    const { live, tail } = stroke(400);
    for (const d of [...live, ...tail]) {
      expect(d.slice).toBeDefined();
      expect(d.slice!.u0).toBeGreaterThanOrEqual(0);
      expect(d.slice!.u1).toBeLessThanOrEqual(1);
      expect(d.slice!.u1).toBeGreaterThan(d.slice!.u0);
      expect(d.slice!.len).toBeGreaterThan(0);
    }
  });

  it("그리는 중엔 끝 구간 길이만큼 뒤처져 내보내고, 그 구간은 손 뗄 때 끝 그림으로 채운다", () => {
    const { live, tail, width } = stroke(400);
    const le = ribbonLen(RIBBON.end, width);
    const lastLiveX = Math.max(...live.map((d) => d.x));
    // 마지막 이동 지점(400)보다 끝 구간 길이 가까이 뒤처져 있다
    expect(400 - lastLiveX).toBeGreaterThanOrEqual(le - 2);
    expect(tail.length).toBeGreaterThan(0);
    // 꼬리의 맨 끝 조각은 끝 구간 텍스처, 그리는 중 조각은 끝 구간을 쓰지 않는다
    const [e0, e1] = u(RIBBON.end);
    const last = tail[tail.length - 1];
    expect(last.slice!.u0).toBeGreaterThanOrEqual(e0 - 1e-9);
    expect(last.slice!.u1).toBeLessThanOrEqual(e1 + 1e-9);
    for (const d of live) expect(d.slice!.u1).toBeLessThanOrEqual(e0 + 1e-9);
  });

  it("시작은 시작 구간 텍스처에서 출발한다", () => {
    const { live } = stroke(400);
    const [s0, s1] = u(RIBBON.start);
    expect(live[0].slice!.u0).toBeGreaterThanOrEqual(s0);
    expect(live[0].slice!.u1).toBeLessThanOrEqual(s1 + 1e-9);
  });

  it("같은 점열이면 같은 조각(무비 재생·결정론)", () => {
    const a = stroke(300, 1);
    const b = stroke(300, 99);
    const sig = (r: typeof a) => [...r.live, ...r.tail].map((d) => [d.x.toFixed(2), d.slice!.u0.toFixed(5), d.slice!.len.toFixed(3)].join()).join("|");
    expect(sig(a)).toBe(sig(b));
  });

  it("콕 찍으면 시작+끝 구간으로 된 짧은 붓자국이 찍힌다", () => {
    const b = createBrush("oilribbon", mulberry32(3));
    b.begin({ x: 50, y: 50, pressure: 0.6, t: 0 }, SETTINGS);
    const out = b.end();
    expect(out.length).toBeGreaterThan(5);
    const [s0, s1] = u(RIBBON.start);
    const [e0, e1] = u(RIBBON.end);
    expect(out.some((d) => d.slice!.u0 >= s0 && d.slice!.u1 <= s1 + 1e-9)).toBe(true);
    expect(out.some((d) => d.slice!.u0 >= e0 - 1e-9 && d.slice!.u1 <= e1 + 1e-9)).toBe(true);
  });

  it("가는 획(폭 40px 미만)은 bold 띠, 굵은 획은 원본 띠", () => {
    const thin = createBrush("oilribbon", mulberry32(1));
    thin.begin({ x: 0, y: 0, pressure: 0.6, t: 0 }, { ...SETTINGS, size: 8 });
    const t = [...thin.move({ x: 200, y: 0, pressure: 0.6, t: 200 }), ...thin.end()];
    expect(t.every((d) => d.tip === "ribbon-bold")).toBe(true);
    const { live } = stroke(400); // size 30 × 1.5 = 45px
    expect(live.every((d) => d.tip === undefined)).toBe(true);
  });

  it("그리는 중 꼬리 미리보기 = 지금 떼면 그려질 꼬리(펜에 붙어 오고, 떼도 화면이 안 바뀐다)", () => {
    const b = createBrush("oilribbon", mulberry32(1));
    b.begin({ x: 0, y: 0, pressure: 0.6, t: 0 }, SETTINGS);
    for (let x = 10; x <= 400; x += 10) b.move({ x, y: 0, pressure: 0.6, t: x } as StrokePoint);
    const pv = b.preview()!;
    const sig = (ds: Dab[]) => ds.map((d) => [d.x.toFixed(2), d.slice!.u0.toFixed(5), d.slice!.u1.toFixed(5)].join()).join("|");
    expect(pv.length).toBeGreaterThan(0);
    // 미리보기 맨 앞 조각은 펜 위치(400) 근처까지 간다
    expect(400 - Math.max(...pv.map((d) => d.x))).toBeLessThan(4);
    const second = sig(b.preview()!); // 상태 불변 — 두 번 불러도 같다
    expect(sig(pv)).toBe(second);
    expect(sig(b.end())).toBe(second);
  });

  it("꺾이는 획도 조각이 앞 조각 단면에 그대로 이어 붙는다(바깥 톱니·틈 없음)", () => {
    // 2026-10-08 사용자 «획획 꺾을 때 물레방아처럼 끊긴다» — 사각 조각을 돌려 찍으면 바깥쪽에 모서리가 부채처럼 삐져나왔다
    const b = createBrush("oilribbon", mulberry32(1));
    const out: Dab[] = [...b.begin({ x: 200, y: 100, pressure: 0.6, t: 0 }, SETTINGS)];
    for (let k = 1; k <= 60; k++) {
      const a = (k / 60) * Math.PI * 2; // 반지름 50 = 획 폭(45)과 비슷한 급한 고리
      out.push(...b.move({ x: 150 + Math.cos(a) * 50, y: 100 + Math.sin(a) * 50, pressure: 0.6, t: k * 8 } as StrokePoint));
    }
    out.push(...b.end());
    const segs = out.filter((d) => d.slice?.seg);
    expect(segs.length).toBeGreaterThan(out.length - 3);
    for (let i = 1; i < out.length; i++) {
      const sg = out[i].slice!.seg;
      if (!sg) continue;
      const pv = out[i - 1];
      expect(Math.hypot(sg.x - pv.x, sg.y - pv.y)).toBeLessThan(1e-9);
      expect(sg.rot).toBeCloseTo(pv.rotation, 9);
      expect(sg.size).toBeCloseTo(pv.size, 9);
    }
    // 폭은 이웃끼리 급변하지 않는다(가장자리 계단)
    for (let i = 1; i < out.length; i++) expect(Math.abs(out[i].size - out[i - 1].size)).toBeLessThan(out[i].size * 0.06);
  });

  it("왔다 갔다 문지르면 붓이 반 바퀴 돌지 않는다(축 유지 — 부채꼴·너트 모양 없음)", () => {
    // 2026-10-08 사용자 «한곳에 여러 번 칠했더니 낙서 같다» — 되돌림마다 단면이 180° 돌며 부채꼴이 생겼다
    const b = createBrush("oilribbon", mulberry32(1));
    const out: Dab[] = [...b.begin({ x: 100, y: 100, pressure: 0.6, t: 0 }, SETTINGS)];
    let t = 0;
    for (let pass = 0; pass < 6; pass++)
      for (let k = 1; k <= 20; k++) {
        const x = pass % 2 === 0 ? 100 + k * 10 : 300 - k * 10;
        out.push(...b.move({ x, y: 100 + pass * 3, pressure: 0.6, t: (t += 8) } as StrokePoint));
      }
    out.push(...b.end());
    // 붓 축은 거의 수평 그대로 — 방향(rotation)이 0 또는 π 근처, 그 사이(세로)로 돌지 않는다
    for (const d of out) expect(Math.abs(Math.sin(d.rotation))).toBeLessThan(0.35);
    // 되돌림에서 마이터 보정이 붙지 않는다(폭 그대로)
    const w = Math.max(...out.map((d) => d.size));
    expect(w).toBeLessThan(b.strokePx(SETTINGS.size) * 1.25);
  });
});
