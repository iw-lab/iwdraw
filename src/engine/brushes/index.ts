import type { BrushId } from "../types";
import { BrushBase, MIN_DAB_PX } from "./BrushBase";
import { Pencil } from "./Pencil";
import { ColorPencil } from "./ColorPencil";
import { SignPen } from "./SignPen";
import { AcrylicPen } from "./AcrylicPen";
import { Crayon } from "./Crayon";
import { Marker } from "./Marker";
import { WatercolorBrush } from "./WatercolorBrush";
import { OilBrush } from "./OilBrush";
import { OilRibbon } from "./OilRibbon";
import { InkBrush } from "./InkBrush";
import { Airbrush } from "./Airbrush";
import { OilPastel } from "./OilPastel";
import { Charcoal } from "./Charcoal";
import { SoftPastel } from "./SoftPastel";
import { GlowBrush } from "./GlowBrush";
import { RainbowBrush } from "./RainbowBrush";
import { GlitterBrush } from "./GlitterBrush";
import { Eraser } from "./Eraser";

/** 스트로크형 브러시 팩토리(fill/stamp/text는 도구라 별도) */
export function createBrush(id: BrushId, rng?: () => number): BrushBase {
  switch (id) {
    case "pencil":
      return new Pencil(rng);
    case "colorpencil":
      return new ColorPencil(rng);
    case "signpen":
      return new SignPen(rng);
    case "acrylic":
      return new AcrylicPen(rng);
    case "crayon":
      return new Crayon(rng);
    case "marker":
      return new Marker(rng);
    case "watercolor":
      return new WatercolorBrush(rng);
    case "oil":
      return new OilBrush(rng);
    case "oilribbon":
      return new OilRibbon(rng);
    case "inkbrush":
      return new InkBrush(rng);
    case "airbrush":
      return new Airbrush(rng);
    case "oilpastel":
      return new OilPastel(rng);
    case "charcoal":
      return new Charcoal(rng);
    case "pastel":
      return new SoftPastel(rng);
    case "glow":
      return new GlowBrush(rng);
    case "rainbow":
      return new RainbowBrush(rng);
    case "glitter":
      return new GlitterBrush(rng);
    case "eraser":
      return new Eraser(rng);
    default:
      return new Pencil(rng);
  }
}

export const STROKE_BRUSHES: BrushId[] = [
  "pencil",
  "colorpencil",
  "crayon",
  "signpen",
  "acrylic",
  "marker",
  "watercolor",
  "oil",
  "oilribbon",
  "inkbrush",
  "airbrush",
  "oilpastel",
  "charcoal",
  "pastel",
  "glow",
  "rainbow",
  "glitter",
  "eraser",
];

export interface BrushMeta {
  id: BrushId;
  label: string;
  /** 저학년 모드 기본 6종에 포함 */
  junior: boolean;
}

export const BRUSH_META: BrushMeta[] = [
  { id: "pencil", label: "연필", junior: true },
  { id: "colorpencil", label: "색연필", junior: true },
  { id: "crayon", label: "크레용", junior: true },
  { id: "signpen", label: "사인펜", junior: true },
  { id: "acrylic", label: "아크릴펜", junior: false },
  { id: "marker", label: "마커", junior: true },
  { id: "watercolor", label: "수채붓", junior: true },
  { id: "oil", label: "유화붓", junior: false },
  // 붓자국 그림(Firefly)을 획 경로에 입히는 유화 — 2026-10-07 아트봉봉 비교
  { id: "oilribbon", label: "납작붓", junior: false },
  { id: "inkbrush", label: "붓펜", junior: false },
  { id: "airbrush", label: "에어브러시", junior: false },
  { id: "oilpastel", label: "오일파스텔", junior: false },
  // 종이 요철을 가장 잘 타는 마른 매체 2종(2026-10-07 종이 결 팩과 함께)
  { id: "charcoal", label: "목탄", junior: false },
  { id: "pastel", label: "파스텔", junior: false },
  { id: "glow", label: "글로우", junior: false },
  { id: "rainbow", label: "무지개", junior: true },
  { id: "glitter", label: "반짝이", junior: true },
  // 번짐: dab 브러시가 아니라 레이어 직접 편집 도구(SmudgeTool) — createBrush 미등록 의도
  { id: "smudge", label: "번짐", junior: false },
  { id: "eraser", label: "지우개", junior: true },
];

/** 굵기 슬라이더 값 → 실제로 그려지는 획 폭(px). 브러시별 최소 선 폭(하한 압축)까지 반영.
 * ⚠️ UI는 sizeScale을 직접 곱하지 말 것 — 하한 구간에서 "미리보기는 계속 작아지는데 실제
 * 획은 그대로"가 된다(구 BRUSH_SIZE_SCALE 상수를 이 함수로 대체, 2026-07-25). */
const PREVIEW_BRUSHES = new Map(STROKE_BRUSHES.map((id) => [id, createBrush(id)]));
export function brushStrokePx(id: BrushId, size: number): number {
  return PREVIEW_BRUSHES.get(id)?.strokePx(size) ?? size;
}

export { BrushBase, MIN_DAB_PX };
