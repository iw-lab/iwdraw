import type { RecordedStroke, RGB, SymmetryMode } from "../types";

/*
 * 스포이트 판정(순수 로직) — «찍은 색으로 칠하면 원래와 똑같이 보여야 한다».
 *
 * 2026-10-14 사용자 «스포이트 색이 약간 원본보다 어둡게 나옴.. 똑같이 나오도록». 예전 스포이트는
 * 레이어를 흰 종이에 합성한 «1픽셀»을 읽었다. 실측(eyedropper-roundtrip.spec):
 *  · 크레용·색연필·연필·사인펜은 알갱이 사이 흰 틈이 섞여 칠한 색과 다른 값이 나오고, 진한 알갱이를
 *    찍으면 주변보다 어둡게 보였다(크레용 1픽셀 105,161,209 · 주변 116,168,214 · 칠한 색 70,140,200).
 *  · 유화·납작붓은 붓이 색을 바꿔 칠해서(밑색 섞임·붓결 그늘) 찍은 색으로 다시 칠하면 4~6 어두워졌다.
 *  · 명화 도안은 붓 자국의 진한 점 하나를 찍어 주변 평균보다 최대 17 어두웠다.
 * 처방: ① 칠한 곳은 «가장 잘 보이는 레이어»의 물감 색을 불투명도 가중 평균(흰 틈 무시)으로 —
 * 크레용·색연필·연필·사인펜·마커·아크릴이 칠한 색 그대로 돌아온다. ② 그 자리를 마지막으로 칠한
 * 획의 색(무비 기록)이 실제 픽셀과 같은 계열이면 그 색을 그대로 돌려준다 — 유화·수채처럼 색을 바꿔
 * 칠하는 붓도 왕복이 같아진다. ③ 칠이 없는 곳(도안·명화·불러온 그림)은 화면 합성색의 작은 범위 평균.
 */

/** 물감 판정 창 반지름(캔버스 px) — 크레용 알갱이를 평균낼 만큼 넓고, 옆 획이 섞이지 않을 만큼 좁게 */
export const PAINT_RADIUS = 6;
/** 칠이 없는 곳(도안·명화) 평균 창 반지름 */
export const BASE_RADIUS = 3;
/** 이 이하의 덮임(평균 불투명도)은 «칠 없음»으로 본다 */
export const MIN_COVERAGE = 0.05;

/** 레이어 픽셀(비곱셈 RGBA) 창 → 불투명도 가중 평균색과 덮임(평균 알파 0~1) */
export function paintColor(data: Uint8ClampedArray): { color: RGB; coverage: number } {
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < data.length; i += 4) {
    const w = data[i + 3] / 255;
    r += data[i] * w;
    g += data[i + 1] * w;
    b += data[i + 2] * w;
    a += w;
  }
  const n = data.length / 4;
  if (a <= 0) return { color: { r: 255, g: 255, b: 255 }, coverage: 0 };
  return { color: { r: Math.round(r / a), g: Math.round(g / a), b: Math.round(b / a) }, coverage: n ? a / n : 0 };
}

/**
 * 창 안에서 «가장 잘 보이는» 그리기 레이어와 그 물감 색 — 레이어는 위에서 아래 순서로 준다.
 * 보이는 몫은 픽셀마다 (알파 × 레이어 불투명도 × 위 레이어들이 비춰 주는 몫) 이다. 평균 덮임끼리 곱하면
 * 위·아래 칠이 창 안에서 겹치지 않을 때 아래 레이어 몫을 깎아 더 적게 보이는 위 레이어를 고른다(교차검증 지적).
 * 색은 그 레이어에서 실제로 보이는 픽셀의 몫으로 가중 평균한다.
 */
export function visiblePaint(layers: { data: Uint8ClampedArray; opacity: number }[]): { index: number; color: RGB; share: number } | null {
  if (!layers.length) return null;
  const n = layers[0].data.length / 4;
  const through = new Float32Array(n).fill(1);
  let best: { index: number; color: RGB; share: number } | null = null;
  layers.forEach(({ data, opacity }, index) => {
    let r = 0, g = 0, b = 0, sum = 0;
    for (let p = 0; p < n; p++) {
      const a = (data[p * 4 + 3] / 255) * opacity;
      const w = a * through[p];
      r += data[p * 4] * w;
      g += data[p * 4 + 1] * w;
      b += data[p * 4 + 2] * w;
      sum += w;
      through[p] *= 1 - a;
    }
    const share = n ? sum / n : 0;
    if (sum > 0 && (!best || share > best.share))
      best = { index, color: { r: Math.round(r / sum), g: Math.round(g / sum), b: Math.round(b / sum) }, share };
  });
  return best;
}

/** 합성 픽셀(불투명) 창 평균 */
export function meanColor(data: Uint8ClampedArray): RGB {
  let r = 0, g = 0, b = 0;
  const n = data.length / 4 || 1;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/** 지우기·문지르기가 그 자리를 마지막으로 건드렸으면 기록 색을 믿지 않는다(색이 달라졌다) */
const ERASES = new Set(["eraser", "smudge"]);
/** 범위를 기록하지 않는 동작 — 채우기는 색이 맞으면 그 색, 도장·글씨는 판정에서 뺀다(그림 색이 따로 있다) */
const AREA = new Set(["fill", "stamp", "text"]);

/** 점 (qx,qy) 와 선분 a→b 의 거리² — 빠른 획은 기록 점 사이가 굵기보다 멀어 «점»만 보면 틈을 놓친다 */
function segDist2(qx: number, qy: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / len2)) : 0;
  const ex = ax + t * dx - qx;
  const ey = ay + t * dy - qy;
  return ex * ex + ey * ey;
}

function mirrors(x: number, y: number, mode: SymmetryMode, w: number, h: number): [number, number][] {
  // 대칭축은 옮길 수 있는데 기록엔 모드만 남는다 — 기본 축(가운데)으로 본다. 축을 옮긴 거울 쪽은 힌트 없이 픽셀 색으로 간다
  const out: [number, number][] = [[x, y]];
  if (mode === "vertical" || mode === "quad") out.push([w - x, y]);
  if (mode === "horizontal" || mode === "quad") out.push([x, h - y]);
  if (mode === "quad") out.push([w - x, h - y]);
  return out;
}

function covers(s: RecordedStroke, x: number, y: number, w: number, h: number): boolean {
  const reach = Math.max(2, s.settings.size / 2) + 1;
  const r2 = reach * reach;
  const pts = s.points;
  for (const [qx, qy] of mirrors(x, y, s.symmetry, w, h)) {
    if (pts.length === 1) {
      if (segDist2(qx, qy, pts[0].x, pts[0].y, pts[0].x, pts[0].y) <= r2) return true;
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      if (segDist2(qx, qy, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= r2) return true;
    }
  }
  return false;
}

const near = (a: RGB, b: RGB, tol: number) => Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;

/**
 * (x,y)를 마지막으로 덮은 동작(같은 레이어)의 붓·색. 기록은 오래된 것부터 쌓이므로 뒤에서부터 본다.
 *  · 지우개·번짐이 마지막이면 null(색이 달라졌다)
 *  · 채우기는 범위를 모른다 — 지금 물감 색(seen)이 그 채우기 색과 같으면 그 색, 다르면 여기를 안 덮은 것으로 보고 더 옛 기록으로
 *  · 도장·글씨는 판정에서 뺀다(자기 그림 색이 따로 있다 — 덮였다면 hintMatches 가 걸러낸다)
 */
export function strokeHint(
  log: readonly RecordedStroke[],
  layerId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  seen?: RGB,
): { brush: string; color: RGB } | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const s = log[i];
    if (s.layerId !== layerId || !s.points.length) continue;
    if (AREA.has(s.brush)) {
      if (s.brush === "fill" && seen && near(seen, s.settings.color, 3)) return { brush: "fill", color: s.settings.color };
      continue;
    }
    if (!covers(s, x, y, w, h)) continue;
    if (ERASES.has(s.brush)) return null;
    return { brush: s.brush, color: s.settings.color };
  }
  return null;
}

function hue(c: RGB): { h: number; chroma: number } {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  if (d === 0) return { h: 0, chroma: 0 };
  let h: number;
  if (max === c.r) h = ((c.g - c.b) / d) % 6;
  else if (max === c.g) h = (c.b - c.r) / d + 2;
  else h = (c.r - c.g) / d + 4;
  return { h: (h * 60 + 360) % 360, chroma: d };
}
const lum = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * 기록된 획 색이 지금 그 자리 물감과 «같은 계열»인가 — 언두·덧칠·물감 섞임으로 기록과 픽셀이
 * 달라졌으면 기록을 버리고 픽셀 색을 쓴다. 붓이 색을 바꿔 칠하는 폭(유화 압축·수채 묽힘)만 허용한다.
 */
export function hintMatches(brush: string, hint: RGB, seen: RGB): boolean {
  const dl = lum(seen) - lum(hint);
  // 수채는 물에 묽어져 훨씬 밝게 남는다(실측 +45~+110) · 유화 계열은 밑색 섞임·그늘로 ±25 안팎
  const lumOk =
    brush === "watercolor" ? dl >= -12 && dl <= 130 : brush === "oil" || brush === "oilribbon" || brush === "oilpastel" ? Math.abs(dl) <= 40 : Math.abs(dl) <= 24;
  if (!lumOk) return false;
  const a = hue(hint);
  const b = hue(seen);
  if (a.chroma < 24 || b.chroma < 12) return a.chroma < 40 && b.chroma < 40; // 무채색끼리만
  const dh = Math.abs(a.h - b.h);
  return Math.min(dh, 360 - dh) <= 28;
}
