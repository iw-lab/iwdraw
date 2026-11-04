// 샌드아트 모래판 — 붓기·손가락·손바닥의 물리 약속 + 무비·되돌리기의 결정성
import { describe, expect, it } from "vitest";
import { SandSim, FILL_LEVEL, makeGrain, type SandOp } from "@/sand/SandSim";
import { SandEngine, LOG_MAX_NUMS, UNDO_MAX, quantize, dequantize, isSandSaved } from "@/sand/SandEngine";
import { SandRender, LIGHTS, SANDS } from "@/sand/SandRender";

const W = 200, H = 140;
const look = { light: LIGHTS[0].rgb, sand: SANDS[0].rgb };
const stroke = (tool: "pour" | "finger" | "palm", size: number, pts: [number, number, number][], seed = 7): SandOp => ({
  k: "stroke", tool, size, seed, d: pts.flat(),
});
const line = (x0: number, y0: number, x1: number, y1: number, n: number, dt = 16): [number, number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, i === 0 ? 0 : dt]);
const at = (s: SandSim, x: number, y: number) => s.H[y * s.w + x];

describe("모래판", () => {
  it("붓기: 오래 누를수록 많이 쌓이고, 가운데가 가장 두껍다", () => {
    const a = new SandSim(W, H), b = new SandSim(W, H);
    a.apply(stroke("pour", 20, [[100, 70, 0], ...Array.from({ length: 30 }, () => [100, 70, 16] as [number, number, number])]));
    b.apply(stroke("pour", 20, [[100, 70, 0], ...Array.from({ length: 90 }, () => [100, 70, 16] as [number, number, number])]));
    expect(b.total()).toBeGreaterThan(a.total() * 2.5);
    expect(at(b, 100, 70)).toBeGreaterThan(at(b, 112, 70));
    expect(at(b, 100, 70)).toBeGreaterThan(1.2); // 1.4초면 빛이 거의 막힐 만큼
  });

  /* 2026-11-04 사용자 폰 «모래 뿌리기인데 이렇게 연하게 나오나?» — 1판은 시간만 세서 아이 손 빠르기(≈1칸/ms)에 줄 가운데 0.15(안개) */
  it("붓기 2판: 보통 빠르기로 한 번 그어도 진한 줄(빛이 거의 막힘) · 옛 기록(pv 없음)은 옛 공식 그대로", () => {
    const pts = line(30, 70, 170, 70, 140, 1); // 140칸을 140ms 에 = 1칸/ms
    const v2 = new SandSim(W, H);
    v2.apply({ ...(stroke("pour", 79, pts) as Extract<SandOp, { k: "stroke" }>), pv: 2 });
    const v1 = new SandSim(W, H);
    v1.apply(stroke("pour", 79, pts)); // pv 없음 = 오늘 앞서 그린 그림
    expect(at(v2, 100, 70), "2판 줄 가운데").toBeGreaterThan(1.0);
    expect(at(v1, 100, 70), "1판(옛 기록) 줄 가운데 — 옛 그대로라 무비가 안 바뀐다").toBeLessThan(0.4);
    // 줄 폭: 가운데에서 굵기 0.5배 떨어지면 확 옅다(뿌옇게 번지지 않는다)
    expect(at(v2, 100, 70 + 40)).toBeLessThan(at(v2, 100, 70) * 0.2);
  });

  /* 2026-11-04 사용자 «처음에 약간 스프레이 같은데 계속 뿌리면 쌓이긴 하네» — 2판은 줄 가운데까지 칸마다 0.2~1.8배로 흩어져 점박이 */
  it("붓기 3판: 한 번 그은 줄 가운데가 꽉 차고(얼룩 적음) · 2판 기록은 2판 그대로", () => {
    const pts = line(30, 70, 170, 70, 140, 1);
    const v3 = new SandSim(W, H), v2 = new SandSim(W, H);
    v3.apply({ ...(stroke("pour", 40, pts) as Extract<SandOp, { k: "stroke" }>), pv: 3 });
    v2.apply({ ...(stroke("pour", 40, pts) as Extract<SandOp, { k: "stroke" }>), pv: 2 });
    const core = (s: SandSim) => { const a: number[] = []; for (let x = 60; x < 140; x++) for (let y = 68; y <= 72; y++) a.push(at(s, x, y)); return a; };
    const stat = (a: number[]) => { const m = a.reduce((p, c) => p + c, 0) / a.length; const sd = Math.sqrt(a.reduce((p, c) => p + (c - m) ** 2, 0) / a.length); return { m, cv: sd / m }; };
    const s3 = stat(core(v3)), s2 = stat(core(v2));
    expect(s3.m, "3판 줄 가운데 두께").toBeGreaterThan(1.5);
    expect(s3.cv, "3판 줄 가운데 얼룩(변동계수)").toBeLessThan(s2.cv * 0.75);
    expect(s2.m).toBeLessThan(1.5); // 2판 기록은 옛 공식 그대로(무비 불변)
  });

  it("손가락: 모래를 없애지 않고 옆으로 민다 — 가운데는 빛이 나고 양옆에 둑이 생긴다", () => {
    const s = new SandSim(W, H);
    s.fill(3);
    const before = s.total();
    s.apply(stroke("finger", 10, line(40, 70, 160, 70, 60)));
    expect(Math.abs(s.total() - before) / before).toBeLessThan(1e-4); // 질량 보존
    expect(at(s, 100, 70)).toBeLessThan(0.25); // 손 지나간 자리 = 얇다(빛이 샌다)
    const rim = Math.max(at(s, 100, 76), at(s, 100, 77), at(s, 100, 75));
    expect(rim).toBeGreaterThan(FILL_LEVEL * 1.15); // 둑
  });

  it("손가락 톡: 움직이지 않고 눌렀다 떼도 동그란 구멍이 난다", () => {
    const s = new SandSim(W, H);
    s.fill(4);
    s.apply(stroke("finger", 12, [[100, 70, 0]]));
    expect(at(s, 100, 70)).toBeLessThan(0.3);
  });

  it("손바닥: 쓴 방향으로 모래가 끌려간다(질량 보존)", () => {
    const s = new SandSim(W, H);
    s.fill(5);
    const before = s.total();
    s.apply(stroke("palm", 30, line(40, 70, 120, 70, 40)));
    expect(Math.abs(s.total() - before) / before).toBeLessThan(1e-4);
    let left = 0, right = 0;
    for (let y = 55; y < 85; y++) {
      for (let x = 45; x < 100; x++) left += at(s, x, y);
      for (let x = 120; x < 160; x++) right += at(s, x, y);
    }
    expect(right / 40).toBeGreaterThan((left / 55) * 1.3);
  });

  it("결정성: 같은 연산을 다시 넣으면 같은 판(무비 = 지금 그림)", () => {
    const ops: SandOp[] = [
      { k: "fill", seed: 11 },
      stroke("finger", 9, line(20, 20, 180, 120, 80), 3),
      stroke("pour", 16, line(30, 100, 160, 30, 50), 4),
      stroke("palm", 28, line(150, 20, 60, 30, 30), 5),
    ];
    const a = new SandSim(W, H), b = new SandSim(W, H);
    for (const o of ops) a.apply(o);
    for (const o of ops) b.apply(o);
    expect(Array.from(a.H)).toEqual(Array.from(b.H));
  });

  it("이상한 값(NaN·∞·거대한 dt)이 와도 판이 깨지지 않는다", () => {
    const s = new SandSim(W, H);
    s.apply(stroke("pour", 999, [[NaN, 3, 16], [50, Infinity, 16], [50, 50, 1e9], [-500, -500, 16], [9999, 9999, 16]]));
    for (const v of s.H) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("화면", () => {
  it("빈 판 = 빛 색, 쏟은 판 = 거의 모래색, 손가락 자국 = 다시 빛", () => {
    const s = new SandSim(W, H);
    const r = new SandRender(s, new Uint8Array(W * H).fill(128), look);
    const px = (x: number, y: number) => { r.paintAll(); const j = (y * W + x) * 4; return [r.img.data[j], r.img.data[j + 1], r.img.data[j + 2]]; };
    const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const empty = lum(px(100, 70));
    s.fill(1);
    const full = lum(px(100, 70));
    s.apply(stroke("finger", 12, line(40, 70, 160, 70, 60)));
    const carved = lum(px(100, 70));
    expect(empty).toBeGreaterThan(200);
    expect(full).toBeLessThan(60);
    expect(carved).toBeGreaterThan(full + 100);
  });
});

describe("위아래 빛", () => {
  it("노을 하늘: 빈 판 위쪽과 아래쪽 색이 다르다 · 한 색 빛은 위아래가 같다", async () => {
    const { lookOf } = await import("@/sand/SandRender");
    const s = new SandSim(W, H);
    const g = new Uint8Array(W * H).fill(128);
    const px = (r: SandRender, y: number) => { r.paintAll(); const j = (y * W + W / 2) * 4; return [r.img.data[j], r.img.data[j + 1], r.img.data[j + 2]]; };
    const sun = new SandRender(s, g, lookOf("sunset", "dark"));
    const top = px(sun, 2), bot = px(sun, H - 3);
    expect(Math.abs(top[1] - bot[1]), "초록 채널 차").toBeGreaterThan(40);
    const flat = new SandRender(s, g, lookOf("white", "dark"));
    const t2 = px(flat, 2), b2 = px(flat, H - 3);
    expect(Math.abs(t2[1] - b2[1])).toBeLessThan(3);
  });
});

describe("되돌리기·기록", () => {
  it("되돌리기 → 다시하기 → 같은 판, 기록(ops) 1:1", () => {
    const e = new SandEngine(W, H, look);
    e.fill();
    const afterFill = quantize(e.sim.H);
    e.clear();
    expect(e.ops.length).toBe(2);
    expect(e.undo()).toBe(true);
    expect(e.ops.length).toBe(1);
    expect(Array.from(quantize(e.sim.H))).toEqual(Array.from(afterFill));
    expect(e.redo()).toBe(true);
    expect(e.ops.length).toBe(2);
    expect(e.sim.total()).toBe(0);
    expect(e.redo()).toBe(false);
  });

  it(`되돌리기는 ${UNDO_MAX}칸까지 · 그 너머는 멈춘다`, () => {
    const e = new SandEngine(W, H, look);
    for (let i = 0; i < UNDO_MAX + 5; i++) e.fill();
    let n = 0;
    while (e.undo()) n++;
    expect(n).toBe(UNDO_MAX);
    expect(e.ops.length).toBe(5);
  });

  it("기록이 길어지면 오래된 것을 시작 판(base)으로 접는다 — base+ops = 지금 판", () => {
    const e = new SandEngine(W, H, look);
    // 엔진 기록에 직접 긴 붓질을 넣는다(입력 이벤트 없이 commit 경로를 탄다)
    // 점 수만 크고 계산은 싼 붓질: 붓기에서 dt=0 점은 모래를 안 붓는다(앞 60점만 진짜로 붓는다)
    const long = line(10, 10, 190, 130, Math.ceil(LOG_MAX_NUMS / 3 / 18)).map(
      (p, j) => [p[0], p[1], j < 60 ? 16 : 0] as [number, number, number],
    );
    const real = line(20, 120, 180, 20, 40);
    for (let i = 0; i < UNDO_MAX + 6; i++) {
      const op = i % 3 === 2 ? stroke("finger", 10, real, 100 + i) : stroke("pour", 10, long, 100 + i);
      (e as unknown as { pushUndo(): void }).pushUndo();
      e.sim.apply(op);
      (e as unknown as { commit(o: SandOp): void }).commit(op);
    }
    expect(e.base).not.toBeNull();
    expect(e.ops.length).toBeGreaterThanOrEqual(UNDO_MAX); // 되돌리기 칸은 접지 않는다
    const re = new SandSim(W, H);
    dequantize(e.base!, re.H);
    for (const o of e.ops) re.apply(o);
    // base 는 Uint16 으로 접혀 미세 오차가 붓질 문턱(안식각)에서 조금 커진다 — 두께 0.05 = 화면 밝기 1단계 안
    let maxd = 0, sum = 0;
    for (let i = 0; i < re.H.length; i++) { const d = Math.abs(re.H[i] - e.sim.H[i]); maxd = Math.max(maxd, d); sum += d; }
    expect(maxd).toBeLessThan(0.05);
    expect(sum / re.H.length).toBeLessThan(0.001);
  });

  /* 8way(gptweb): 손상된 저장본(cur 없음·타입 다름·거대한 크기)이면 restore 가 TypeError 로 죽어 화면이 «깔고 있어요»에 멈췄다 */
  it("손상된 저장본은 거부하고 죽지 않는다", () => {
    const e = new SandEngine(800, 533, look);
    const good = e.snapshot("d1");
    expect(isSandSaved(good)).toBe(true);
    const bad: unknown[] = [
      null, 3, "x", {}, { ...good, cur: undefined }, { ...good, cur: null }, { ...good, cur: [1, 2] },
      { ...good, w: 100000, h: 100000 }, { ...good, cur: new Uint16Array(10) }, { ...good, base: "zz" }, { ...good, v: 2 },
    ];
    for (const b of bad) {
      expect(isSandSaved(b)).toBe(false);
      expect(() => e.restore(b as never)).not.toThrow();
      expect(e.restore(b as never)).toBe(false);
    }
    expect(e.restore(good)).toBe(true);
  });

  it("저장본의 기록은 엔진 기록과 따로 논다(저장을 기다리는 사이 획이 더해져도 저장본이 안 바뀐다)", () => {
    const e = new SandEngine(W, H, look);
    e.fill();
    const snap = e.snapshot("d");
    e.clear();
    expect(snap.ops.length).toBe(1);
  });
});

describe("붓기 4판 — 스프레이처럼 보이지 않게(2026-11-05 사용자)", () => {
  const W2 = 400, H2 = 200, Y0 = 100;
  const pts = line(30, Y0, 370, Y0, 90, 16);
  const draw = (pv: number) => { const s = new SandSim(W2, H2); s.apply({ ...(stroke("pour", 40, pts) as Extract<SandOp, { k: "stroke" }>), pv }); return s; };
  /** 줄 양쪽을 평균 낸 가로 단면 */
  const profile = (s: SandSim) => { const out: number[] = []; for (let y = 0; y < H2; y++) { let a = 0; for (let x = 80; x < 320; x++) a += s.H[y * W2 + x]; out.push(a / 240); } return out; };
  /** 세로줄마다 잰 «가장 진한 곳의 90%→10%» 폭의 가운데값(칸) = 가장자리가 얼마나 뿌연가. 줄이 흔들린 만큼은 안 섞이게 세로줄마다 잰다 */
  const edge = (s: SandSim) => { const es: number[] = []; for (let x = 80; x < 320; x += 4) { const col: number[] = []; for (let y = 0; y < H2; y++) { let a = 0; for (let k = -2; k <= 2; k++) a += s.H[y * W2 + x + k]; col.push(a / 5); } const c = Math.max(...col), m = col.indexOf(c); let hi = m, lo = m; while (hi > 0 && col[hi] >= c * 0.9) hi--; lo = hi; while (lo > 0 && col[lo] >= c * 0.1) lo--; es.push(hi - lo); } es.sort((a, b) => a - b); return es[es.length >> 1]; };
  /** 세로줄마다 잰 줄 폭의 들쭉날쭉함(표준편차) */
  const wobble = (s: SandSim) => { const ws: number[] = []; for (let x = 80; x < 320; x += 4) { let n = 0; for (let y = 0; y < H2; y++) if (s.H[y * W2 + x] > 0.5) n++; ws.push(n); } const m = ws.reduce((a, b) => a + b, 0) / ws.length; return Math.sqrt(ws.reduce((a, b) => a + (b - m) ** 2, 0) / ws.length); };
  /** 줄기 밖(가운데에서 2σ 넘게)에 떨어진 낱알 수 */
  const strays = (s: SandSim) => { let n = 0; const sig = 40 * 0.22; for (let y = 0; y < H2; y++) { if (Math.abs(y - Y0) < sig * 2.4) continue; for (let x = 0; x < W2; x++) if (s.H[y * W2 + x] > 0.5) n++; } return n; };

  it("가장자리가 또렷하고 · 폭이 손으로 부은 듯 들쭉날쭉하고 · 줄기 밖에 낱알이 튄다", () => {
    const v3 = draw(3), v4 = draw(4);
    expect(edge(v4)).toBeLessThan(edge(v3) * 0.8);
    expect(wobble(v4)).toBeGreaterThan(wobble(v3) * 1.5);
    expect(strays(v4)).toBeGreaterThan(strays(v3) + 30);
    const c = profile(v4)[Y0];
    expect(c).toBeGreaterThan(1.2); // 한 번 그어도 진한 줄은 그대로
  });

  it("같은 씨앗이면 같은 판(무비) · 3판 기록은 3판 그대로", () => {
    expect(Array.from(draw(4).H)).toEqual(Array.from(draw(4).H));
    expect(Array.from(draw(3).H)).toEqual(Array.from(draw(3).H));
    expect(Array.from(draw(4).H)).not.toEqual(Array.from(draw(3).H));
  });

  it("얇은 모래는 반투명 막이 아니라 낱알 — 얇은 곳 화면에 어중간한 색이 적다", () => {
    const s = new SandSim(W, H);
    s.H.fill(0.25);
    const g = makeGrain(W, H);
    const r = new SandRender(s, g, look);
    r.paintAll();
    let mid = 0, dark = 0, n = 0;
    for (let i = 0; i < W * H; i++) { const j = i * 4; const l = 0.3 * r.img.data[j] + 0.59 * r.img.data[j + 1] + 0.11 * r.img.data[j + 2]; n++; if (l < 70) dark++; else if (l < 150) mid++; }
    expect(dark / n).toBeGreaterThan(0.15); // 낱알이 진하게 보인다
    expect(mid / n).toBeLessThan(0.3);      // 뿌연 중간색이 많으면 스프레이
  });

  it("빛: 켜진 유리판처럼 — 가운데는 환하고 둘레로 갈수록 색이 짙다", () => {
    const s = new SandSim(W, H);
    const r = new SandRender(s, new Uint8Array(W * H).fill(128), look);
    r.paintAll();
    const lum = (x: number, y: number) => { const j = (y * W + x) * 4; return 0.3 * r.img.data[j] + 0.59 * r.img.data[j + 1] + 0.11 * r.img.data[j + 2]; };
    expect(lum(W >> 1, H >> 1)).toBeGreaterThan(238);   // 가운데는 거의 흰빛
    expect(lum(0, 0)).toBeGreaterThan(165);             // 가장자리도 어둑하지 않게
    expect(lum(W >> 1, H >> 1) - lum(0, 0)).toBeGreaterThan(30); // 고른 한 색이면 «색 도화지»로 보인다
  });
});
