/*
 * 샌드아트 엔진 — 모래판(SandSim) + 화면(SandRender) + 입력 + 되돌리기 + 기록(무비) + 자동저장 거리.
 *
 * 불변식(무비·되돌리기가 기대는 것):
 *   base(시작 판, 없으면 빈 판) 에 ops 를 차례로 apply 하면 지금 판과 같다.
 *   되돌리기 칸 하나 = ops 끝의 연산 하나(undo 는 ops 를 하나 빼고 그 직전 판으로).
 *   ops 가 너무 길어지면 오래된 것을 base 로 접는다 — 단 되돌리기 칸(UNDO_MAX) 안의 것은 접지 않는다.
 */
import { SandSim, makeGrain, type SandOp, type SandTool } from "./SandSim";
import { SandRender, type SandLook } from "./SandRender";

export const UNDO_MAX = 20;
export const PEN_PALM_MS = 1500;
/** 기록 상한(점 수 ×3 숫자) — 넘으면 오래된 연산을 base 로 접는다(약 2.4MB) */
export const LOG_MAX_NUMS = 600_000;
const Q = 65535 / 8; // 두께 0~8 → Uint16

export function quantize(H: Float32Array): Uint16Array {
  const out = new Uint16Array(H.length);
  for (let i = 0; i < H.length; i++) {
    const v = H[i] * Q;
    out[i] = v <= 0 ? 0 : v >= 65535 ? 65535 : (v + 0.5) | 0;
  }
  return out;
}
export function dequantize(q: Uint16Array, into: Float32Array): void {
  for (let i = 0; i < q.length; i++) into[i] = q[i] / Q;
}

export interface SandSaved {
  v: 1;
  w: number;
  h: number;
  cur: Uint16Array;
  base: Uint16Array | null;
  ops: SandOp[];
  draftId: string;
  savedAt: number;
}

type Listener = () => void;

export class SandEngine {
  readonly sim: SandSim;
  readonly render: SandRender;
  readonly grain: Uint8Array;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private listeners = new Set<Listener>();

  tool: SandTool = "pour";
  sizes: Record<SandTool, number> = { pour: 22, finger: 12, palm: 34 };

  base: Uint16Array | null = null;
  ops: SandOp[] = [];
  private logNums = 0;
  private undoSnaps: Uint16Array[] = [];
  private redoSnaps: Uint16Array[] = [];
  private redoOps: SandOp[] = [];
  /** 기록이 바뀔 때마다 오른다 — 자동저장이 «바뀐 게 있나»를 본다 */
  version = 0;
  /** 진행 중 붓질에 점이 찍힐 때마다 오른다 — 손을 안 떼고 오래 그려도 저장할 거리 */
  liveRev = 0;
  get drawing() {
    return !!this.cur;
  }

  // 진행 중 붓질
  private cur: { id: number; tool: SandTool; size: number; seed: number; d: number[]; t: number; x: number; y: number; moved: number } | null = null;
  /** 마지막 펜 신호 시각 — 펜을 쓰는 동안(그리고 막 뗀 1.5초)만 손바닥 터치를 무시한다.
   * 한 번 펜을 쓰면 영영 터치를 막던 것 = 샌드아트는 손가락 놀이인데 손가락이 안 먹었다(8way meta) */
  private lastPen = -1e9;
  private seedCounter = 1;
  /** 소리·화면 반응에 쓰는 마지막 움직임 속도(칸/ms) */
  speed = 0;
  onActivity?: (tool: SandTool | null, speed: number) => void;

  constructor(w: number, h: number, look: SandLook) {
    this.sim = new SandSim(w, h);
    this.grain = makeGrain(w, h);
    this.render = new SandRender(this.sim, this.grain, look);
  }

  get w() {
    return this.sim.w;
  }
  get h() {
    return this.sim.h;
  }
  get size() {
    return this.sizes[this.tool];
  }
  get canUndo() {
    return this.undoSnaps.length > 0;
  }
  get canRedo() {
    return this.redoOps.length > 0;
  }
  get empty() {
    return this.ops.length === 0 && !this.base;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /* ── 화면 ── */
  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.width = this.w;
    canvas.height = this.h;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.sim.markAll();
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("lostpointercapture", this.onUp);
    this.raf = requestAnimationFrame(this.tick);
  }

  detach(): void {
    const c = this.canvas;
    if (c) {
      c.removeEventListener("pointerdown", this.onDown);
      c.removeEventListener("pointermove", this.onMove);
      c.removeEventListener("pointerup", this.onUp);
      c.removeEventListener("pointercancel", this.onCancel);
      c.removeEventListener("lostpointercapture", this.onUp);
    }
    cancelAnimationFrame(this.raf);
    this.canvas = null;
    this.ctx = null;
  }

  setLook(look: SandLook): void {
    this.render.look = look;
    this.sim.markAll();
  }

  setTool(t: SandTool): void {
    this.tool = t;
  }
  setSize(n: number): void {
    this.sizes[this.tool] = Math.max(3, Math.min(80, Math.round(n)));
  }

  /** 화면 칠하기 — 바뀐 곳만 */
  flush(): void {
    const r = this.sim.takeDirty();
    if (!r || !this.ctx) return;
    this.render.paint(r.x0, r.y0, r.x1, r.y1);
    this.ctx.putImageData(this.render.img, 0, 0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const c = this.cur;
    // 붓기는 손을 멈추고 있어도 모래가 계속 흘러내린다
    if (c && c.tool === "pour" && now - c.t > 14) this.addDab(c.x, c.y, now);
    if (c && now - c.t > 120) {
      this.speed = 0;
      this.onActivity?.(c.tool, 0);
    }
    this.flush();
  };

  /* ── 입력 ── */
  private toGrid(e: PointerEvent): [number, number] {
    const r = this.canvas!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.w, ((e.clientY - r.top) / r.height) * this.h];
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === "pen") this.lastPen = performance.now();
    // 펜으로 그리는 중·막 뗀 직후의 손바닥(터치)은 무시한다 · 두 번째 손가락도 무시
    if (this.cur || (e.pointerType === "touch" && performance.now() - this.lastPen < PEN_PALM_MS)) return;
    if (e.button > 0) return;
    e.preventDefault();
    try {
      this.canvas!.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트 등 */
    }
    const [x, y] = this.toGrid(e);
    const seed = (Date.now() ^ Math.imul(this.seedCounter++, 2654435761)) >>> 0;
    const size = this.size;
    // 붓질 전 판 — 되돌리기 칸
    this.pushUndo();
    this.cur = { id: e.pointerId, tool: this.tool, size, seed, d: [], t: performance.now(), x, y, moved: 0 };
    this.sim.begin(this.tool, size, seed);
    this.addDab(x, y, this.cur.t, 0);
    this.onActivity?.(this.tool, 0);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "pen") this.lastPen = performance.now();
    const c = this.cur;
    if (!c || e.pointerId !== c.id) return;
    const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const list = evs.length ? evs : [e];
    const now = performance.now();
    for (const ev of list) {
      const [x, y] = this.toGrid(ev);
      this.addDab(x, y, now);
    }
  };

  private addDab(x: number, y: number, now: number, dtOverride?: number): void {
    const c = this.cur!;
    const dt = dtOverride ?? Math.min(100, now - c.t);
    const dist = Math.hypot(x - c.x, y - c.y);
    // 정밀도 = 0.01칸·0.1ms(저장 크기) — 기록한 값 그대로 판에 넣어야 무비와 같은 판이 된다
    const rx = Math.round(x * 100) / 100;
    const ry = Math.round(y * 100) / 100;
    const rdt = Math.round(dt * 10) / 10;
    c.d.push(rx, ry, rdt);
    this.liveRev++;
    this.sim.dab(rx, ry, rdt);
    if (dt > 0) this.speed = this.speed * 0.6 + (dist / dt) * 0.4;
    c.moved += dist;
    c.t = now;
    c.x = x;
    c.y = y;
    this.onActivity?.(c.tool, this.speed);
  }

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === "pen") this.lastPen = performance.now();
    const c = this.cur;
    if (!c || e.pointerId !== c.id) return;
    this.cur = null;
    this.sim.end();
    this.speed = 0;
    this.onActivity?.(null, 0);
    this.commit({ k: "stroke", tool: c.tool, size: c.size, seed: c.seed, d: c.d });
  };

  /** 취소(제스처 가로채임) — 붓질 전 판으로 되돌리고 기록하지 않는다 */
  private onCancel = (e: PointerEvent) => {
    const c = this.cur;
    if (!c || e.pointerId !== c.id) return;
    this.cur = null;
    this.sim.end();
    this.onActivity?.(null, 0);
    const snap = this.undoSnaps.pop();
    if (snap) {
      dequantize(snap, this.sim.H);
      this.sim.markAll();
    }
  };

  /* ── 기록·되돌리기 ── */
  private pushUndo(): void {
    this.undoSnaps.push(quantize(this.sim.H));
    if (this.undoSnaps.length > UNDO_MAX) this.undoSnaps.shift();
  }

  private commit(op: SandOp): void {
    this.ops.push(op);
    this.logNums += op.k === "stroke" ? op.d.length : 1;
    this.redoOps = [];
    this.redoSnaps = [];
    this.foldIfLong();
    this.emit();
  }

  /** 판 전체 연산(쏟기·쓸기) — 되돌리기 가능 */
  fill(): void {
    if (this.cur) return;
    this.pushUndo();
    const seed = (Date.now() ^ Math.imul(this.seedCounter++, 2246822519)) >>> 0;
    const op: SandOp = { k: "fill", seed };
    this.sim.apply(op);
    this.commit(op);
  }
  clear(): void {
    if (this.cur) return;
    this.pushUndo();
    const op: SandOp = { k: "clear" };
    this.sim.apply(op);
    this.commit(op);
  }

  undo(): boolean {
    if (this.cur) return false;
    const snap = this.undoSnaps.pop();
    const op = this.ops.pop();
    if (!snap || !op) {
      if (snap) this.undoSnaps.push(snap);
      if (op) this.ops.push(op);
      return false;
    }
    this.logNums -= op.k === "stroke" ? op.d.length : 1;
    this.redoSnaps.push(quantize(this.sim.H));
    this.redoOps.push(op);
    dequantize(snap, this.sim.H);
    this.sim.markAll();
    this.emit();
    return true;
  }

  redo(): boolean {
    if (this.cur) return false;
    const op = this.redoOps.pop();
    const snap = this.redoSnaps.pop();
    if (!op || !snap) return false;
    this.undoSnaps.push(quantize(this.sim.H));
    if (this.undoSnaps.length > UNDO_MAX) this.undoSnaps.shift();
    dequantize(snap, this.sim.H);
    this.ops.push(op);
    this.logNums += op.k === "stroke" ? op.d.length : 1;
    this.sim.markAll();
    this.emit();
    return true;
  }

  /** 오래된 연산을 base 로 접는다 — 되돌리기 칸 안(끝 UNDO_MAX 개)은 남긴다 */
  private foldIfLong(): void {
    if (this.logNums <= LOG_MAX_NUMS) return;
    const keep = Math.max(UNDO_MAX, 1);
    let n = 0;
    let nums = this.logNums;
    while (n < this.ops.length - keep && nums > LOG_MAX_NUMS * 0.7) {
      const op = this.ops[n];
      nums -= op.k === "stroke" ? op.d.length : 1;
      n++;
    }
    if (n === 0) return;
    const tmp = new SandSim(this.w, this.h);
    if (this.base) dequantize(this.base, tmp.H);
    for (let i = 0; i < n; i++) tmp.apply(this.ops[i]);
    this.base = quantize(tmp.H);
    this.ops = this.ops.slice(n);
    this.logNums = nums;
  }

  /** 새 그림 — 판·기록·되돌리기 전부 비운다 */
  reset(): void {
    this.cur = null;
    this.sim.clear();
    this.base = null;
    this.ops = [];
    this.logNums = 0;
    this.undoSnaps = [];
    this.redoSnaps = [];
    this.redoOps = [];
    this.emit();
  }

  /* ── 저장·복원 ── */
  /** 진행 중 붓질도 연산 하나로 넣어 저장한다 — 판(cur)엔 이미 들어간 모래가 기록(ops)에 없으면
   * 복원 뒤 base+ops ≠ 판(무비 끝 장면이 달라짐)이고, 손을 떼기 전에 탭이 죽으면 그 붓질을 잃는다(8way grokweb) */
  snapshot(draftId: string): SandSaved {
    const c = this.cur;
    const ops: SandOp[] = c ? [...this.ops, { k: "stroke", tool: c.tool, size: c.size, seed: c.seed, d: c.d.slice() }] : this.ops;
    return {
      v: 1,
      w: this.w,
      h: this.h,
      cur: quantize(this.sim.H),
      base: this.base,
      ops,
      draftId,
      savedAt: Date.now(),
    };
  }

  restore(s: SandSaved): boolean {
    if (s.v !== 1 || s.w !== this.w || s.h !== this.h || s.cur.length !== this.w * this.h) return false;
    dequantize(s.cur, this.sim.H);
    this.base = s.base && s.base.length === this.w * this.h ? s.base : null;
    this.ops = Array.isArray(s.ops) ? s.ops.filter(validOp) : [];
    this.logNums = this.ops.reduce((a, o) => a + (o.k === "stroke" ? o.d.length : 1), 0);
    this.undoSnaps = [];
    this.redoSnaps = [];
    this.redoOps = [];
    this.sim.markAll();
    this.emit();
    return true;
  }

  /** 지금 판을 캔버스로(저장·내보내기). scale 배로 부드럽게 키운다 */
  toCanvas(scale = 2): HTMLCanvasElement {
    this.render.paintAll();
    const src = document.createElement("canvas");
    src.width = this.w;
    src.height = this.h;
    src.getContext("2d")!.putImageData(this.render.img, 0, 0);
    this.sim.markAll(); // 화면 쪽 img 를 통째로 다시 칠했으니 다음 flush 가 화면에도 반영
    if (scale === 1) return src;
    const out = document.createElement("canvas");
    out.width = Math.round(this.w * scale);
    out.height = Math.round(this.h * scale);
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }
}

export function validOp(o: unknown): o is SandOp {
  if (!o || typeof o !== "object") return false;
  const op = o as SandOp;
  if (op.k === "clear") return true;
  if (op.k === "fill") return Number.isFinite(op.seed);
  if (op.k === "stroke")
    return (
      (op.tool === "pour" || op.tool === "finger" || op.tool === "palm") &&
      Number.isFinite(op.size) &&
      Number.isFinite(op.seed) &&
      Array.isArray(op.d) &&
      op.d.length % 3 === 0
    );
  return false;
}
