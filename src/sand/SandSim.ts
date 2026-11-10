/*
 * 샌드아트 모래판 — 칸마다 «모래 두께» 하나만 기억하는 높이 격자(렌더·DOM import 0).
 *
 * 왜 낱알이 아니라 두께인가: 낱알 수십만 개를 매 프레임 움직이면 웨일북에서 못 버틴다.
 * 라이트박스 위 모래 그림에서 눈에 보이는 건 «빛이 얼마나 새어 나오나» = 두께뿐이다.
 *
 * 결정성(무비·되돌리기의 바탕): 같은 연산(SandOp)을 같은 순서로 다시 넣으면 같은 판이 나온다.
 *   - 난수는 연산마다 저장한 seed 로 만든 mulberry32 뿐(Math.random 0)
 *   - 붓질 하나 = 프레임마다 찍힌 점 [x, y, dt] 목록 — 붓기 양이 시간(dt)에 비례하므로 dt 까지 적는다
 */

export type SandTool = "pour" | "finger" | "palm";
export type RGB = [number, number, number];

/** 기록 단위. d = 평평한 [x, y, dtMs, x, y, dtMs, …](격자 좌표)
 * c = 붓는 모래 색(2026-11-10 사용자 «모래 쏟기 하고 다른 색으로 뿌리기») — 없으면 옛 기록 = 판 기본 색(defColor) */
export type SandOp =
  | { k: "stroke"; tool: SandTool; size: number; seed: number; d: number[]; pv?: number; c?: RGB }
  | { k: "fill"; seed: number; c?: RGB }
  | { k: "clear" };

/** 겉 색이 바뀌는 깊이 — 이만큼 새 모래가 얹히면 겉이 거의 새 색이 된다(모래알은 불투명 · 덮인 칸 문턱 0.6 의 절반) */
export const SKIN = 0.3;

/** RGB565 한 칸(저장·되돌리기 — 색 칸이 두께 칸과 같은 2바이트) */
export const pack565 = (r: number, g: number, b: number): number =>
  ((Math.max(0, Math.min(255, r)) >> 3) << 11) | ((Math.max(0, Math.min(255, g)) >> 2) << 5) | (Math.max(0, Math.min(255, b)) >> 3);
export function quantizeColor(C: Float32Array): Uint16Array {
  const n = C.length / 3;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = pack565(C[i * 3] + 4, C[i * 3 + 1] + 2, C[i * 3 + 2] + 4);
  return out;
}
export function dequantizeColor(q: Uint16Array, into: Float32Array): void {
  for (let i = 0; i < q.length; i++) {
    const v = q[i];
    into[i * 3] = ((v >> 11) & 31) * (255 / 31);
    into[i * 3 + 1] = ((v >> 5) & 63) * (255 / 63);
    into[i * 3 + 2] = (v & 31) * (255 / 31);
  }
}
export const validRGB = (c: unknown): c is RGB =>
  Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 255);

/** 두께 상한 — 붓기를 오래 눌러도 칸 하나가 끝없이 쌓이지 않게 */
export const SAND_MAX = 6;
/** 모래 쏟기 두께(빛이 거의 안 새는 두께) */
export const FILL_LEVEL = 1.5;
/** 붓기 공식 판 — 2: 움직인 거리만큼도 흘린다(한 번 그으면 진한 선). 옛 기록(pv 없음 = 1)은 옛 공식으로 다시 그려
 * 오늘 그린 그림의 무비가 바뀌지 않는다(결정성 불변식) */
export const POUR_V = 4;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 고정 시드 낱알 결(0~255) — 얇은 모래 가장자리가 매끈한 그러데이션이 아니라 «모래알»로 보이게 */
export function makeGrain(w: number, h: number, seed = 20261104): Uint8Array {
  const g = new Uint8Array(w * h);
  const rnd = mulberry32(seed);
  // 칸마다 값 + 4칸 간격 덩이 — 칸마다만 다르면 얇은 곳이 고운 분무처럼 보인다(모래는 뭉쳐 떨어진다)
  const P = 4;
  const cw = Math.ceil(w / P) + 2;
  const coarse = new Float32Array(cw * (Math.ceil(h / P) + 2));
  for (let i = 0; i < coarse.length; i++) coarse[i] = rnd();
  for (let y = 0; y < h; y++) {
    const fy = y / P, cy = fy | 0, ty = fy - cy;
    for (let x = 0; x < w; x++) {
      const fx = x / P, cx = fx | 0, tx = fx - cx;
      const a = coarse[cy * cw + cx], b = coarse[cy * cw + cx + 1];
      const c = coarse[(cy + 1) * cw + cx], d = coarse[(cy + 1) * cw + cx + 1];
      const lump = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      const v = 0.6 * rnd() + 0.4 * lump;
      g[y * w + x] = Math.min(255, v * 256) | 0;
    }
  }
  return g;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class SandSim {
  readonly w: number;
  readonly h: number;
  H: Float32Array;
  /** 칸마다 «겉에 보이는» 모래 색(r,g,b 0~255) — 두께(H)와 따로. 새로 얹힌 모래가 위에 보인다 */
  C: Float32Array;
  /** 색 없는 옛 기록·빈 판의 색 */
  defColor: RGB = [34, 26, 20];
  /** 마지막 flush 이후 바뀐 칸의 사각형(렌더가 이만큼만 다시 그린다). x1·y1 은 포함 안 함 */
  dx0 = 0;
  dy0 = 0;
  dx1 = 0;
  dy1 = 0;
  private tmp: Float32Array;
  private tmpC: Float32Array | null = null;
  /** 진행 중 붓질의 모래 색 */
  private col: RGB = [34, 26, 20];

  // 진행 중 붓질 상태
  private tool: SandTool = "pour";
  private size = 20;
  private rnd: () => number = mulberry32(1);
  private lx = 0;
  private ly = 0;
  private started = false;
  /** 손가락 자국 간격을 맞추려고 남은 거리를 다음 점으로 넘긴다 */
  private carry = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.H = new Float32Array(w * h);
    this.tmp = new Float32Array(w * h);
    this.C = new Float32Array(w * h * 3);
    this.paintColor(this.defColor);
    this.markAll();
  }

  markAll(): void {
    this.dx0 = 0;
    this.dy0 = 0;
    this.dx1 = this.w;
    this.dy1 = this.h;
  }
  private mark(x0: number, y0: number, x1: number, y1: number): void {
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(this.w, Math.ceil(x1));
    y1 = Math.min(this.h, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    if (this.dx1 <= this.dx0) {
      this.dx0 = x0;
      this.dy0 = y0;
      this.dx1 = x1;
      this.dy1 = y1;
      return;
    }
    this.dx0 = Math.min(this.dx0, x0);
    this.dy0 = Math.min(this.dy0, y0);
    this.dx1 = Math.max(this.dx1, x1);
    this.dy1 = Math.max(this.dy1, y1);
  }
  /** 바뀐 사각형을 넘기고 비운다 — null = 바뀐 곳 없음 */
  takeDirty(): { x0: number; y0: number; x1: number; y1: number } | null {
    if (this.dx1 <= this.dx0 || this.dy1 <= this.dy0) return null;
    const r = { x0: this.dx0, y0: this.dy0, x1: this.dx1, y1: this.dy1 };
    this.dx0 = this.dy0 = this.dx1 = this.dy1 = 0;
    return r;
  }

  /** 판 전체 색 칠하기(빈 판·옛 저장본) */
  paintColor(c: RGB): void {
    const C = this.C;
    for (let i = 0; i < C.length; i += 3) {
      C[i] = c[0];
      C[i + 1] = c[1];
      C[i + 2] = c[2];
    }
  }
  /** 칸 i 에 색 (r,g,b) 모래 a 가 «위에» 얹혔다 — 아래가 얇으면(옛 두께 hb) 거의 새 색 */
  private tint(i: number, a: number, hb: number, r: number, g: number, b: number): void {
    if (a <= 0) return;
    const t = a / (a + (hb < SKIN ? (hb > 0 ? hb : 0) : SKIN));
    const C = this.C;
    const k = i * 3;
    C[k] += (r - C[k]) * t;
    C[k + 1] += (g - C[k + 1]) * t;
    C[k + 2] += (b - C[k + 2]) * t;
  }
  /** 붓기 한 칸: 두께 계산은 옛 식 그대로(무비 결정성) + «부은» 만큼 색.
   * 늘어난 만큼이 아니다 — 상한(SAND_MAX)까지 쌓인 더미 위에 아무리 부어도 색이 안 바뀌었다(2026-11-10 사용자).
   * 더 못 쌓여도 새 낱알은 겉을 덮고 굴러 내린다 */
  private addAt(i: number, v: number): void {
    const H = this.H;
    const h0 = H[i];
    H[i] = v > SAND_MAX ? SAND_MAX : v;
    if (v > h0) this.tint(i, v - h0, h0, this.col[0], this.col[1], this.col[2]);
  }

  /* ── 판 전체 연산 ── */
  fill(seed: number, c: RGB = this.defColor): void {
    const rnd = mulberry32(seed);
    const H = this.H;
    for (let i = 0; i < H.length; i++) H[i] = FILL_LEVEL + (rnd() - 0.5) * 0.35;
    this.paintColor(c);
    this.markAll();
  }
  clear(): void {
    this.H.fill(0);
    this.markAll();
  }

  /* ── 붓질(스트리밍) — 화면은 begin → dab… → end, 무비는 같은 순서로 다시 넣는다 ── */
  private pv = POUR_V;
  /* 4판 줄기의 떨림(손으로 붓는 줄기는 곧지도 고르지도 않다) — 붓질마다 0 에서 시작해 씨앗 난수로만 움직인다(무비 결정성) */
  private wx = 0;
  private wy = 0;
  private wWidth = 0;
  private wFlow = 0;
  begin(tool: SandTool, size: number, seed: number, pv: number = POUR_V, c: RGB = this.defColor): void {
    this.pv = pv;
    this.col = c;
    this.wx = this.wy = this.wWidth = this.wFlow = 0;
    this.tool = tool;
    this.size = Math.max(2, Math.min(120, size));
    this.rnd = mulberry32(seed);
    this.started = false;
    this.carry = 0;
  }

  dab(x: number, y: number, dt: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const dtc = Math.max(0, Math.min(100, Number.isFinite(dt) ? dt : 0));
    if (!this.started) {
      this.started = true;
      this.lx = x;
      this.ly = y;
      if (this.tool === "finger") this.fingerStamp(x, y, 1, 0);
      else if (this.tool === "pour") this.pourAt(x, y, dtc);
      return;
    }
    if (this.tool === "pour") this.pourSeg(x, y, dtc);
    else if (this.tool === "finger") this.fingerSeg(x, y);
    else this.palmSeg(x, y);
    this.lx = x;
    this.ly = y;
  }

  end(): void {
    this.started = false;
  }

  /** 기록된 연산 하나를 통째로 적용(무비·복원·되돌리기 재생) */
  apply(op: SandOp): void {
    if (op.k === "clear") return this.clear();
    if (op.k === "fill") return this.fill(op.seed, op.c ?? this.defColor);
    this.beginOp(op);
    const d = op.d;
    for (let i = 0; i + 2 < d.length; i += 3) this.dab(d[i], d[i + 1], d[i + 2]);
    this.end();
  }

  /** 기록된 붓질 시작(무비가 점을 나눠 넣을 때도 같은 길) */
  beginOp(op: Extract<SandOp, { k: "stroke" }>): void {
    this.begin(op.tool, op.size, op.seed, op.pv ?? 1, op.c ?? this.defColor);
  }

  /* ── 붓기: 손끝에서 모래가 흘러내려 쌓인다. 양은 «누르고 있는 시간»에 비례 ── */
  private pourSeg(x: number, y: number, dt: number): void {
    const sig = this.pourSig();
    const dist = Math.hypot(x - this.lx, y - this.ly);
    const n = Math.max(1, Math.min(48, Math.ceil(dist / Math.max(1, sig * 0.5))));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      this.pourAt(this.lx + (x - this.lx) * t, this.ly + (y - this.ly) * t, dt / n, dist / n);
    }
  }

  /** 모래 줄기 폭 — 2판은 더 가늘게(손에서 흘러내린 줄기는 또렷하다. 1판 0.32 = 굵기 79 에서 뿌옇게 번졌다) */
  private pourSig(): number {
    return Math.max(1, this.size * (this.pv >= 2 ? 0.22 : 0.32));
  }

  private pourAt(cx: number, cy: number, dt: number, dist = 0): void {
    if (this.pv >= 4) return this.pourAt4(cx, cy, dt, dist);
    const sig = this.pourSig();
    // 1초 누르면 가운데가 약 2.4 두께(빛이 거의 막힘) — 더미.
    // 2판: + 움직인 거리 몫 — 한 번 지나간 줄 가운데가 약 1.3 두께(빛이 거의 안 샘)가 되게 a_d·√(2π)σ ≈ 1.3.
    //   (1판은 시간만 셌다 → 아이 손 빠르기(1칸/ms)·굵기 79 에서 줄 가운데 0.15 = 연한 안개)
    // 3판(2026-11-04 사용자 «처음엔 약간 스프레이 같다»): 한 번 지난 줄 가운데 1.3 → 1.7, 낱알 흔들림을 줄 가운데에선 줄인다
    const amp = dt * 0.0024 + (this.pv >= 3 ? dist * (0.68 / sig) : this.pv >= 2 ? dist * (0.52 / sig) : 0);
    const v3 = this.pv >= 3;
    if (amp <= 0) return;
    const R = Math.ceil(sig * 2.4);
    const inv = 1 / (2 * sig * sig);
    const H = this.H;
    const w = this.w;
    const rnd = this.rnd;
    const x0 = Math.max(0, Math.floor(cx - R));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + R));
    for (let yy = y0; yy <= y1; yy++) {
      const ddy = yy - cy;
      for (let xx = x0; xx <= x1; xx++) {
        const ddx = xx - cx;
        const g = Math.exp(-(ddx * ddx + ddy * ddy) * inv);
        if (g < 0.01) continue;
        // 낱알이 떨어지는 자리는 고르지 않다 — 칸마다 0.2~1.8배(1·2판). 3판: 줄기 가운데(g≈1)는 0.75~1.25배로 고르게,
        // 가장자리(g 작음)로 갈수록 0.2~1.8배로 흩어져 «모래알 가장자리 + 꽉 찬 줄기»(가운데까지 흩뿌리면 에어브러시 스프레이)
        const i = yy * w + xx;
        const spread = v3 ? 1.6 - 1.1 * g : 1.6;
        this.addAt(i, H[i] + amp * g * (1 - spread / 2 + spread * rnd()));
      }
    }
    this.relax(x0 - 1, y0 - 1, x1 + 2, y1 + 2, 0.45);
    this.mark(x0 - 2, y0 - 2, x1 + 3, y1 + 3);
  }

  /**
   * 4판(2026-11-05 사용자 «빈 판에 뿌리면 스프레이처럼 보인다»). 스프레이처럼 보인 까닭 셋을 고친다.
   *  ① 종 모양 양 분포 = 뿌연 후광 → 윗면이 평평하고 가장자리에서 빨리 떨어지는 분포
   *  ② 폭·방향이 자로 잰 듯 일정 → 줄기가 조금씩 흔들리고 굵어졌다 가늘어진다
   *  ③ 낱알이 줄기 안에만 있다 → 줄기 밖으로 튄 낱알이 흩어진다(relax 범위 밖이라 무너지지 않는다)
   */
  private pourAt4(cx: number, cy: number, dt: number, dist: number): void {
    const sig = this.pourSig();
    const rnd = this.rnd;
    const walk = dist > 0 ? Math.min(1, dist / sig) : 0.1;
    this.wx = (this.wx + (rnd() - 0.5) * 0.5 * sig * walk) * (1 - 0.1 * walk);
    this.wy = (this.wy + (rnd() - 0.5) * 0.5 * sig * walk) * (1 - 0.1 * walk);
    this.wWidth = (this.wWidth + (rnd() - 0.5) * 0.28 * walk) * (1 - 0.08 * walk);
    this.wFlow = (this.wFlow + (rnd() - 0.5) * 0.3 * walk) * (1 - 0.12 * walk);
    const sigW = sig * Math.max(0.68, Math.min(1.32, 1 + this.wWidth));
    const flow = Math.max(0.6, Math.min(1.4, 1 + this.wFlow));
    const amp = (dt * 0.0024 + dist * (0.68 / sig)) * flow;
    if (amp <= 0) return;
    const px = cx + this.wx;
    const py = cy + this.wy;
    const R = Math.ceil(sigW * 2);
    const inv = 1 / (2 * sigW * sigW);
    const H = this.H;
    const w = this.w;
    const x0 = Math.max(0, Math.floor(px - R));
    const x1 = Math.min(this.w - 1, Math.ceil(px + R));
    const y0 = Math.max(0, Math.floor(py - R));
    const y1 = Math.min(this.h - 1, Math.ceil(py + R));
    for (let yy = y0; yy <= y1; yy++) {
      const ddy = yy - py;
      for (let xx = x0; xx <= x1; xx++) {
        const ddx = xx - px;
        const q = (ddx * ddx + ddy * ddy) * inv;
        const g = Math.exp(-q * q * 0.9);
        if (g < 0.01) continue;
        const i = yy * w + xx;
        const spread = 1.5 - 1.05 * g;
        this.addAt(i, H[i] + amp * g * (1 - spread / 2 + spread * rnd()));
      }
    }
    this.relax(x0 - 1, y0 - 1, x1 + 2, y1 + 2, 0.45);
    // 튄 낱알 — 흘린 양에 비례(한 자리에 오래 눌러도 조금씩 튄다). 한두 칸짜리 알갱이
    const want = amp * sig * 0.9;
    let n = want | 0;
    if (rnd() < want - n) n++;
    const far = sigW * 3.8;
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const u = rnd();
      const d = sigW * (2.1 + 1.7 * u * u);
      const gx = Math.round(px + Math.cos(a) * d);
      const gy = Math.round(py + Math.sin(a) * d);
      // 네모로 안 보이게: 한 칸 + 가끔 옆 칸 하나에 덜 얹는다
      const amt = 0.8 + 0.6 * rnd();
      const put = (xx: number, yy: number, v: number) => {
        if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) return;
        const i = yy * w + xx;
        const h0 = H[i];
        H[i] = Math.min(SAND_MAX, h0 + v);
        this.tint(i, v, h0, this.col[0], this.col[1], this.col[2]);
      };
      put(gx, gy, amt);
      if (rnd() < 0.25) {
        const s = rnd() * 4 | 0;
        put(gx + (s === 0 ? 1 : s === 1 ? -1 : 0), gy + (s === 2 ? 1 : s === 3 ? -1 : 0), amt * 0.5);
      }
    }
    this.mark(Math.floor(px - far) - 2, Math.floor(py - far) - 2, Math.ceil(px + far) + 4, Math.ceil(py + far) + 4);
  }

  /* ── 손가락: 모래를 밀어내 빛나는 선이 생기고, 밀린 모래는 양옆에 둑으로 쌓인다 ── */
  private fingerSeg(x: number, y: number): void {
    const step = Math.max(0.8, this.size * 0.18);
    const dxm = x - this.lx;
    const dym = y - this.ly;
    const dist = Math.hypot(dxm, dym);
    if (dist < 1e-6) return;
    const ux = dxm / dist;
    const uy = dym / dist;
    let s = step - this.carry;
    while (s <= dist) {
      this.fingerStamp(this.lx + ux * s, this.ly + uy * s, ux, uy);
      s += step;
    }
    this.carry = dist - (s - step);
  }

  private fingerStamp(cx: number, cy: number, ux: number, uy: number): void {
    const R = Math.max(1.2, this.size * 0.5);
    const Rc = Math.ceil(R + 1);
    const H = this.H;
    const w = this.w;
    const rnd = this.rnd;
    const x0 = Math.max(0, Math.floor(cx - Rc));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + Rc));
    const y0 = Math.max(0, Math.floor(cy - Rc));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + Rc));
    const side = rnd() < 0.5 ? 1 : -1;
    const C = this.C;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const ddx = xx - cx;
        const ddy = yy - cy;
        const d = Math.hypot(ddx, ddy);
        if (d >= R) continue;
        const i = yy * w + xx;
        const h0 = H[i];
        if (h0 <= 1e-4) continue;
        const wgt = 1 - smooth(R * 0.55, R, d);
        const take = h0 * Math.min(1, 0.94 * wgt);
        if (take <= 0) continue;
        H[i] = h0 - take;
        const cr = C[i * 3], cg = C[i * 3 + 1], cb = C[i * 3 + 2];
        // 가운데에서 바깥으로 — 바로 가운데 칸은 진행 방향의 옆으로 민다
        let nx: number, ny: number;
        if (d < 0.5) {
          nx = -uy * side;
          ny = ux * side;
        } else {
          nx = ddx / d;
          ny = ddy / d;
        }
        const t = R + 0.6 + rnd() * R * 0.35;
        this.splat(cx + nx * t, cy + ny * t, take, cr, cg, cb);
      }
    }
    // 둑은 가운데에서 최대 R×1.35+0.6(+네 칸 나눔 1) 떨어진 곳에 쌓인다 — 안식각·칠하기 범위가 그 둑까지 덮어야 한다
    const reach = Math.ceil(R * 1.35 + 3);
    this.relax(cx - reach, cy - reach, cx + reach + 1, cy + reach + 1, 0.9);
    this.mark(cx - reach - 2, cy - reach - 2, cx + reach + 3, cy + reach + 3);
  }

  /* ── 손바닥: 넓게 쓸면 모래가 손을 따라 끌려가 장면이 바뀐다 ── */
  private palmSeg(x: number, y: number): void {
    const R = Math.max(4, this.size * 1.1);
    const dxm = x - this.lx;
    const dym = y - this.ly;
    const dist = Math.hypot(dxm, dym);
    if (dist < 0.3) return;
    const stepLen = Math.max(1, R * 0.22);
    const n = Math.max(1, Math.min(40, Math.ceil(dist / stepLen)));
    const sx = dxm / n;
    const sy = dym / n;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      this.palmStamp(this.lx + dxm * t - sx, this.ly + dym * t - sy, sx, sy, R);
    }
  }

  private palmStamp(cx: number, cy: number, sx: number, sy: number, R: number): void {
    const H = this.H;
    const T = this.tmp;
    const C = this.C;
    const TC = (this.tmpC ??= new Float32Array(this.w * this.h * 3));
    const w = this.w;
    const rnd = this.rnd;
    const x0 = Math.max(0, Math.floor(cx - R));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + R));
    // 1) 떼어 내기(임시 칸에) — 같은 자국 안에서 옮긴 모래를 또 옮기지 않게 두 단계로 나눈다
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx - cx, yy - cy);
        const i = yy * w + xx;
        if (d >= R) {
          T[i] = 0;
          continue;
        }
        const f = 0.8 * (1 - smooth(R * 0.45, R, d));
        const mv = H[i] * f;
        H[i] -= mv;
        T[i] = mv;
        TC[i * 3] = C[i * 3];
        TC[i * 3 + 1] = C[i * 3 + 1];
        TC[i * 3 + 2] = C[i * 3 + 2];
      }
    }
    // 2) 손이 간 만큼 옮겨 놓기 + 옆으로 살짝 흩기(손바닥 결)
    const len = Math.hypot(sx, sy) || 1;
    const px = -sy / len;
    const py = sx / len;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const i = yy * w + xx;
        const mv = T[i];
        if (mv <= 0) continue;
        T[i] = 0;
        const j = (rnd() - 0.5) * 1.2;
        this.splat(xx + sx * 1.05 + px * j, yy + sy * 1.05 + py * j, mv, TC[i * 3], TC[i * 3 + 1], TC[i * 3 + 2]);
      }
    }
    const Rc = Math.ceil(R + len + 2);
    this.relax(cx - Rc, cy - Rc, cx + Rc, cy + Rc, 0.9);
    this.mark(cx - Rc - 2, cy - Rc - 2, cx + Rc + 3, cy + Rc + 3);
  }

  /** 양 v 를 실수 좌표 둘레 네 칸에 나눠 놓는다(판 밖으로 나간 모래는 판 끝에 쌓인다) */
  private splat(fx: number, fy: number, v: number, r: number, g: number, b: number): void {
    const w = this.w;
    const h = this.h;
    fx = Math.min(w - 1.001, Math.max(0, fx));
    fy = Math.min(h - 1.001, Math.max(0, fy));
    const ix = fx | 0;
    const iy = fy | 0;
    const ax = fx - ix;
    const ay = fy - iy;
    const H = this.H;
    const i = iy * w + ix;
    const a0 = v * (1 - ax) * (1 - ay), a1 = v * ax * (1 - ay), a2 = v * (1 - ax) * ay, a3 = v * ax * ay;
    this.tint(i, a0, H[i], r, g, b);
    this.tint(i + 1, a1, H[i + 1], r, g, b);
    this.tint(i + w, a2, H[i + w], r, g, b);
    this.tint(i + w + 1, a3, H[i + w + 1], r, g, b);
    H[i] += a0;
    H[i + 1] += a1;
    H[i + w] += a2;
    H[i + w + 1] += a3;
  }

  /** 안식각 — 이웃보다 thr 넘게 높은 칸은 넘친 만큼을 나눠 흘려보낸다(뾰족한 탑·한 칸 가시를 없앤다) */
  private relax(x0: number, y0: number, x1: number, y1: number, thr: number): void {
    const w = this.w;
    const H = this.H;
    x0 = Math.max(1, Math.floor(x0));
    y0 = Math.max(1, Math.floor(y0));
    x1 = Math.min(this.w - 1, Math.ceil(x1));
    y1 = Math.min(this.h - 1, Math.ceil(y1));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = yy * w + xx;
        let hc = H[i];
        if (hc <= thr) continue;
        // 네 이웃 각각에 넘친 양의 1/5 (전부 보내면 진동한다)
        // 흘러내린 모래는 제 색을 이웃 위에 얹는다
        const n0 = i - 1, n1 = i + 1, n2 = i - w, n3 = i + w;
        const C = this.C, cr = C[i * 3], cg = C[i * 3 + 1], cb = C[i * 3 + 2];
        let d = hc - H[n0] - thr;
        if (d > 0) { d *= 0.2; this.tint(n0, d, H[n0], cr, cg, cb); H[n0] += d; hc -= d; }
        d = hc - H[n1] - thr;
        if (d > 0) { d *= 0.2; this.tint(n1, d, H[n1], cr, cg, cb); H[n1] += d; hc -= d; }
        d = hc - H[n2] - thr;
        if (d > 0) { d *= 0.2; this.tint(n2, d, H[n2], cr, cg, cb); H[n2] += d; hc -= d; }
        d = hc - H[n3] - thr;
        if (d > 0) { d *= 0.2; this.tint(n3, d, H[n3], cr, cg, cb); H[n3] += d; hc -= d; }
        H[i] = hc;
      }
    }
  }

  /** 모래 총량(시험·디버그용 — 손가락·손바닥은 모래를 옮기기만 해야 한다) */
  total(): number {
    let s = 0;
    const H = this.H;
    for (let i = 0; i < H.length; i++) s += H[i];
    return s;
  }
}
