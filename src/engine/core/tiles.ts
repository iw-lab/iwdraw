/*
 * 더티 타일 스냅샷 유틸 — History의 메모리 예산을 지키는 핵심.
 * 스트로크가 닿은 256px 타일만 before/after 비트맵으로 떠서 커맨드에 담는다.
 */
import type { Command } from "./History";

export const TILE = 256;

export interface TileRect {
  tx: number; // 타일 좌표
  ty: number;
  x: number; // 픽셀 좌표
  y: number;
  w: number;
  h: number;
}

/** 픽셀 영역(x,y,w,h)을 덮는 타일 목록 */
export function tilesForRect(
  x: number,
  y: number,
  w: number,
  h: number,
  canvasW: number,
  canvasH: number,
): TileRect[] {
  const x0 = Math.max(0, Math.floor(x / TILE));
  const y0 = Math.max(0, Math.floor(y / TILE));
  const x1 = Math.min(Math.ceil(canvasW / TILE) - 1, Math.floor((x + w - 1) / TILE));
  const y1 = Math.min(Math.ceil(canvasH / TILE) - 1, Math.floor((y + h - 1) / TILE));
  const rects: TileRect[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const px = tx * TILE;
      const py = ty * TILE;
      rects.push({
        tx,
        ty,
        x: px,
        y: py,
        w: Math.min(TILE, canvasW - px),
        h: Math.min(TILE, canvasH - py),
      });
    }
  }
  return rects;
}

/** 타일 스냅샷을 레이어에 되쓰는 함수(엔진이 주입 — putImageData) */
export type TileBlitter = (tiles: TileRect[], snaps: Uint8ClampedArray[]) => void;

/**
 * 레이어 픽셀 버퍼에 대한 더티-타일 커맨드.
 * before/after는 타일 단위 Uint8ClampedArray 스냅샷. revert/apply가 해당 타일만 복원.
 */
export class TileSnapshotCommand implements Command {
  cost: number;
  private after: Uint8ClampedArray[] | null;
  /**
   * after 는 배열이거나 «지금 레이어에서 읽기» 함수(2026-11-17 저사양 렉 — 획이 끝날 때마다 GPU 레이어를 읽어 오던 멈칫).
   * 되돌리기는 맨 위부터 한 칸씩이라, 이 칸을 되돌리는 순간의 레이어 = 이 획 바로 뒤 모습이다 → 그때 읽어도 같은 픽셀.
   * 다시 하기(apply)는 언제나 되돌린 뒤라 그때는 이미 읽혀 있다.
   */
  private before: Uint8ClampedArray[] | null;
  private readBefore: (() => Uint8ClampedArray[]) | null;
  constructor(
    private readonly tiles: TileRect[],
    before: Uint8ClampedArray[] | (() => Uint8ClampedArray[]),
    after: Uint8ClampedArray[] | (() => Uint8ClampedArray[]),
    private readonly blit: TileBlitter,
  ) {
    // before 도 함수일 수 있다 — 획 끝에 GPU 사본(캔버스)으로 떠 두고 픽셀 배열은 쉬는 틈에(materialize)
    this.before = typeof before === "function" ? null : before;
    this.readBefore = typeof before === "function" ? before : null;
    const b = tiles.reduce((a, t) => a + t.w * t.h * 4, 0);
    this.after = typeof after === "function" ? null : after;
    this.readAfter = typeof after === "function" ? after : null;
    // 아직 안 읽은 after 도 같은 크기로 센다(되돌리기 기록 상한 계산이 달라지지 않게)
    this.cost = b + (this.after ? this.after.reduce((a, x) => a + x.byteLength, 0) : b);
  }
  private readAfter: (() => Uint8ClampedArray[]) | null;

  apply(): void {
    if (!this.after) this.after = this.readAfter!();
    this.blit(this.tiles, this.after);
  }
  revert(): void {
    if (!this.after && this.readAfter) {
      this.after = this.readAfter();
      this.readAfter = null;
    }
    this.materialize();
    this.blit(this.tiles, this.before!);
  }
  /** GPU 사본으로 떠 둔 before 를 픽셀 배열로(쉬는 틈 · 되돌리기 직전) — 그 뒤 사본은 버린다 */
  materialize(): void {
    if (this.before || !this.readBefore) return;
    this.before = this.readBefore();
    this.readBefore = null;
  }
}

/** 버퍼에서 타일 픽셀을 떠낸다 */
export function copyTiles(
  data: Uint8ClampedArray,
  width: number,
  tiles: TileRect[],
): Uint8ClampedArray[] {
  return tiles.map((t) => {
    const out = new Uint8ClampedArray(t.w * t.h * 4);
    for (let row = 0; row < t.h; row++) {
      const src = ((t.y + row) * width + t.x) * 4;
      out.set(data.subarray(src, src + t.w * 4), row * t.w * 4);
    }
    return out;
  });
}

/**
 * 레이어에서 해당 타일만 직접 읽어온다 — 전체 캔버스 getImageData(1600×1000 = 6.4MB)를
 * 획마다 두 번(before/after) 하던 것을 더티 타일(보통 수백 KB)로 줄인다.
 * 저사양 기기(웨일북)에서 이 리드백과 그 가비지가 획마다 GC 스파이크를 만들었다(2026-07-14).
 */
export function readTiles(
  ctx: CanvasRenderingContext2D,
  tiles: TileRect[],
): Uint8ClampedArray[] {
  return tiles.map((t) => new Uint8ClampedArray(ctx.getImageData(t.x, t.y, t.w, t.h).data));
}
