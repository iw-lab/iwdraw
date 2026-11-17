/* 캔버스 크기 산출(순수 로직, 테스트 가능) — CanvasStage/엔진 공용 */
export const CANVAS_MAX_LONG = 1536;
export const CANVAS_MAX_AREA = 1536 * 1152; // ≈ 1.77M px

/** scale = 기기별 판 배율(lib/perf-tier — 렉을 잰 기기만 1 미만). 긴 변·넓이 상한을 같은 배율로 줄인다 */
export function fitAspectHelper(aspect: number, scale = 1): { width: number; height: number } {
  const long = Math.round(CANVAS_MAX_LONG * scale);
  const maxArea = CANVAS_MAX_AREA * scale * scale;
  let w: number, h: number;
  if (aspect >= 1) {
    w = long;
    h = Math.round(long / aspect);
  } else {
    h = long;
    w = Math.round(long * aspect);
  }
  const area = w * h;
  if (area > maxArea) {
    const k = Math.sqrt(maxArea / area);
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  return { width: w - (w % 2), height: h - (h % 2) };
}
