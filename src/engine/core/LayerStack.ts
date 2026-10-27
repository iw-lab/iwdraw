import { nanoid } from "nanoid";
import { blendToComposite } from "./backend";
import type { BlendMode, LayerInfo } from "../types";

/*
 * LayerStack: 최대 8 레이어(+ 색칠 모드 라인아트 잠금 레이어). 각 레이어는 자체 2D 캔버스.
 * composite()가 blend 모드로 표시 캔버스에 합성한다.
 */
export const MAX_LAYERS = 8;

export interface Layer extends LayerInfo {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** 화면·내보내기용 사본(도안 선 굵기·진하기) — 있으면 canvas 대신 합성한다 */
  view?: HTMLCanvasElement | null;
}

export class LayerStack {
  private layers: Layer[] = [];
  activeId = "";

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.addLayer("레이어 1");
  }

  /** 레이어 2D 컨텍스트를 잃었다가 되찾았을 때(저사양 기기 메모리 압박) 알림 —
   * 되찾은 캔버스는 비어 있으므로 엔진이 마지막 저장본으로 다시 채워야 한다. */
  private restoredCb: (() => void) | null = null;
  onContextRestored(cb: () => void): void {
    this.restoredCb = cb;
  }

  private newCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    /* 크롬은 메모리가 부족하면 2D 캔버스의 컨텍스트도 뺏는다. 기본 동작대로 두면 컨텍스트가
     * 영영 안 돌아와 "그려도 아무것도 안 나오는" 상태가 된다(웨일북 실사용 2026-07-14).
     * preventDefault()로 복구를 요청하고, 복구되면 마지막 저장본으로 다시 채운다. */
    c.addEventListener("contextlost", (e) => e.preventDefault());
    c.addEventListener("contextrestored", () => this.restoredCb?.());
    return c;
  }

  get list(): Layer[] {
    return this.layers;
  }

  get info(): LayerInfo[] {
    return this.layers.map(({ id, name, visible, opacity, blend, isLineart, isBase, lineWeight, lineDark }) => ({
      id,
      name,
      visible,
      opacity,
      blend,
      isLineart,
      isBase,
      ...(isLineart ? { lineWeight: lineWeight ?? 0, lineDark: lineDark ?? 1 } : {}),
    }));
  }

  get active(): Layer {
    return (
      this.layers.find((l) => l.id === this.activeId) ??
      this.layers.find((l) => !this.isLocked(l)) ??
      this.layers[0]
    );
  }

  /** 색칠 모드용 라인아트 레이어(잠금·최상단·multiply) */
  get lineart(): Layer | undefined {
    return this.layers.find((l) => l.isLineart);
  }

  /** 그대로 이어 그리기 원본 레이어(잠금·최하단) — 지우개가 원본을 못 지우게 분리 */
  get base(): Layer | undefined {
    return this.layers.find((l) => l.isBase);
  }

  private isLocked(l: Layer): boolean {
    return l.isLineart || l.isBase;
  }

  addLayer(name?: string, isLineart = false): Layer | null {
    const drawable = this.layers.filter((l) => !this.isLocked(l)).length;
    if (!isLineart && drawable >= MAX_LAYERS) return null;
    const canvas = this.newCanvas();
    const layer: Layer = {
      id: nanoid(8),
      name: name ?? `레이어 ${drawable + 1}`,
      visible: true,
      opacity: 1,
      blend: isLineart ? "multiply" : "normal",
      isLineart,
      isBase: false,
      canvas,
      ctx: canvas.getContext("2d")!,
    };
    if (isLineart) this.layers.push(layer); // 라인아트는 항상 맨 위
    else {
      // 라인아트 아래에 삽입
      const lineIdx = this.layers.findIndex((l) => l.isLineart);
      if (lineIdx === -1) this.layers.push(layer);
      else this.layers.splice(lineIdx, 0, layer);
    }
    this.activeId = isLineart ? this.activeId || layer.id : layer.id;
    if (!this.activeId) this.activeId = layer.id;
    return layer;
  }

  /** 원본 레이어 생성(없으면) — 항상 맨 아래, 활성 레이어는 바뀌지 않는다 */
  addBase(name = "원본"): Layer {
    const existing = this.base;
    if (existing) return existing;
    const canvas = this.newCanvas();
    const layer: Layer = {
      id: nanoid(8),
      name,
      visible: true,
      opacity: 1,
      blend: "normal",
      isLineart: false,
      isBase: true,
      canvas,
      ctx: canvas.getContext("2d")!,
    };
    this.layers.unshift(layer);
    return layer;
  }

  removeLayer(id: string): boolean {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    if (this.isLocked(this.layers[idx])) return false; // 라인아트·원본은 직접 삭제 불가
    if (this.layers.filter((l) => !this.isLocked(l)).length <= 1) return false; // 최소 1장
    this.layers.splice(idx, 1);
    if (this.activeId === id) this.activeId = this.layers.find((l) => !this.isLocked(l))!.id;
    return true;
  }

  indexOf(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }

  get(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  /** 삭제한 레이어를 원래 자리·원래 픽셀 그대로 되돌린다(되돌리기 전용).
   * 캔버스 객체를 그대로 다시 꽂으므로 그림이 손실되지 않는다. */
  insertAt(layer: Layer, index: number): void {
    if (this.layers.some((l) => l.id === layer.id)) return;
    this.layers.splice(Math.max(0, Math.min(this.layers.length, index)), 0, layer);
  }

  setActive(id: string): void {
    const l = this.layers.find((x) => x.id === id);
    if (l && !this.isLocked(l)) this.activeId = id;
  }

  setVisible(id: string, v: boolean): void {
    const l = this.layers.find((x) => x.id === id);
    if (l) l.visible = v;
  }

  setOpacity(id: string, o: number): void {
    const l = this.layers.find((x) => x.id === id);
    if (l) l.opacity = Math.max(0, Math.min(1, o));
  }

  setBlend(id: string, b: BlendMode): void {
    const l = this.layers.find((x) => x.id === id);
    if (l && !this.isLocked(l)) l.blend = b;
  }

  reorder(id: string, toIndex: number): void {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx === -1 || this.isLocked(this.layers[idx])) return;
    const [l] = this.layers.splice(idx, 1);
    const lineIdx = this.layers.findIndex((x) => x.isLineart);
    const max = lineIdx === -1 ? this.layers.length : lineIdx;
    const min = this.layers.length > 0 && this.layers[0].isBase ? 1 : 0; // 원본 아래로는 못 내림
    this.layers.splice(Math.max(min, Math.min(max, toIndex)), 0, l);
  }

  clearActive(): void {
    const l = this.active;
    l.ctx.clearRect(0, 0, this.width, this.height);
  }

  clearAll(): void {
    for (const l of this.layers) if (!this.isLocked(l)) l.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * 모든 레이어를 표시 캔버스에 합성.
   * liveStroke: 활성 레이어를 "레이어+진행 중 스트로크" 합성본으로 대체해 그리는 훅.
   * 레이어 자체의 opacity/blend가 적용된 상태에서 호출되므로 프리뷰가 최종 결과와 일치하고,
   * 지우개(destination-out) 프리뷰도 활성 레이어만 뚫는다.
   */
  composite(
    target: CanvasRenderingContext2D,
    liveStroke?: (ctx: CanvasRenderingContext2D, layer: Layer) => void,
  ): void {
    target.clearRect(0, 0, this.width, this.height);
    for (const l of this.layers) {
      if (!l.visible || l.opacity === 0) continue;
      target.save();
      target.globalAlpha = l.opacity;
      target.globalCompositeOperation = blendToComposite(l.blend);
      if (liveStroke && l.id === this.activeId) liveStroke(target, l);
      else target.drawImage(l.view ?? l.canvas, 0, 0);
      target.restore();
    }
  }

  destroy(): void {
    this.layers = [];
  }
}
