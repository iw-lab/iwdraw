/* ArtON 브러시 엔진 공용 타입 — 프레임워크(React) 비의존 */

export type Mode = "sketch" | "watercolor" | "oil" | "coloring";

export type BlendMode = "normal" | "multiply" | "screen" | "overlay";

export type BrushId =
  | "pencil"
  | "colorpencil"
  | "crayon"
  | "signpen"
  | "acrylic"
  | "marker"
  | "watercolor"
  | "oil"
  | "oilribbon"
  | "inkbrush"
  | "airbrush"
  | "oilpastel"
  | "charcoal"
  | "pastel"
  | "glow"
  | "rainbow"
  | "glitter"
  | "smudge"
  | "eyedropper"
  | "pointer"
  | "eraser"
  | "fill"
  | "stamp"
  | "text";

export interface RGB {
  r: number; // 0~255
  g: number;
  b: number;
}

/** 입력 1점 — PointerHandler가 생성, Stabilizer를 거쳐 브러시로 */
export interface StrokePoint {
  x: number;
  y: number;
  /** 0~1. 마우스/터치는 simulate된 값 */
  pressure: number;
  /** performance.now() 기준 ms */
  t: number;
  tiltX?: number;
  tiltY?: number;
}

/**
 * Dab = 브러시가 뱉는 백엔드 독립 스탬프 1개.
 * 브러시(순수 로직)가 Dab 스트림을 만들고, 렌더 백엔드가 래스터화한다.
 */
export interface Dab {
  x: number;
  y: number;
  /** 스탬프 지름(px) */
  size: number;
  /** 0~1 — 이 dab 하나의 알파 */
  alpha: number;
  /** 라디안 — 결 방향(연필 기울기, 유화 bristle 등) */
  rotation: number;
  /** 색 오버라이드(무지개 브러시 등). 없으면 브러시 색 */
  color?: RGB;
  /** 팁 오버라이드(글리터 별 글린트 등). 없으면 스트로크 팁 */
  tip?: import("./brushes/BrushBase").TipKind;
  /**
   * 띠 조각(리본 붓) — 팁 텍스처의 가로 구간 u0~u1(0~1)만 잘라, 획 방향 길이 len(px) × 폭 size(px)
   * 사각형으로 그린다. 붓자국 그림 한 장을 획 경로를 따라 이어 붙이는 용도(OilRibbon).
   * 없으면 지금까지처럼 팁 전체를 size×size 정사각형으로.
   */
  slice?: {
    u0: number;
    u1: number;
    len: number;
    /**
     * 이음 띠 — 있으면 사각 조각 대신 «앞 조각 중심(seg) → 이 dab 중심» 사다리꼴로 그린다(u0 → u1).
     * 꺾이는 곳 바깥에 조각 모서리가 톱니처럼 삐져나오던 것을 없앤다(2026-10-08 사용자 «물레방아»).
     */
    seg?: { x: number; y: number; rot: number; size: number };
  };
}

export interface BrushSettings {
  size: number; // px 1~128
  opacity: number; // 0~1
  color: RGB;
  /** 수채: 물 양 0~1 (슬라이더) */
  waterAmount: number;
  /** 손떨림 보정 강도 0~10 */
  stabilize: number;
}

/** 렌더 백엔드가 스스로 보고하는 능력 — UI 분기 없이 자연스러운 다운그레이드 */
export interface BackendCaps {
  webgl2: boolean;
}

export interface LayerInfo {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0~1
  blend: BlendMode;
  /** 색칠 모드 라인아트 레이어 — 잠금(그리기 불가), 항상 최상단 multiply */
  isLineart: boolean;
  /** 그대로 이어 그리기 원본 레이어 — 잠금(그리기·지우기 불가), 항상 최하단 */
  isBase: boolean;
}

/** StrokeRecorder 로그의 한 항목(무비 모드/타임랩스 재생용) */
export interface RecordedStroke {
  brush: BrushId;
  settings: BrushSettings;
  layerId: string;
  points: StrokePoint[];
  /** 대칭 설정 스냅샷 */
  symmetry: SymmetryMode;
  /** fill/stamp/text 등 비-스트로크 액션의 파라미터 */
  extra?: Record<string, unknown>;
}

export type SymmetryMode = "none" | "vertical" | "horizontal" | "quad";

export type QuickShapeKind =
  | "line"
  | "circle"
  | "rect"
  | "triangle"
  | "star"
  | "heart";

/** 로컬 스트로크가 커밋될 때 협동 전송용으로 방출되는 페이로드 */
export interface StrokeCommitted {
  brush: BrushId;
  color: RGB;
  size: number;
  opacity: number;
  water: number;
  symmetry: SymmetryMode;
  points: StrokePoint[];
}

/** 뚝딱그림 후보 1개 — 스탬프 도안 제안 */
export interface SketchSuggestion {
  stampId: string;
  label: string;
  /** 0~1 — 클수록 유사 */
  score: number;
}

/** 엔진 → UI 이벤트 (Zustand 스토어가 구독) */
export interface EngineEvents {
  historyChange: { canUndo: boolean; canRedo: boolean };
  layersChange: { layers: LayerInfo[]; activeId: string };
  strokeLatency: { ms: number };
  dirty: Record<string, never>;
  quickShapeApplied: { kind: QuickShapeKind };
  restoreAvailable: { savedAt: number };
  strokeCommitted: StrokeCommitted;
  pointerMoved: { x: number; y: number };
  /** 색이 실제로 캔버스에 쓰임(획 커밋·페인트통) — 최근 색 기록용.
   * setColor 시점에 기록하면 밝기 슬라이더 드래그가 최근 색을 도배한다(2026-07-07 실측) */
  colorUsed: { color: RGB };
  /** 스포이트로 캔버스에서 색을 찍음 — UI가 색 반영 후 이전 붓으로 복귀 */
  colorPicked: { color: RGB };
  /** 뷰(핀치 줌/팬) 변경 — UI가 "화면 맞춤" 탈출 버튼 표시에 사용 */
  viewChange: { scale: number };
  /** 뚝딱그림 — 스케치 인식 후보(빈 배열 = 제안 바 닫기) */
  suggestReady: { candidates: SketchSuggestion[] };
  /** 떠 있는 스탬프(배치 중) 변경 — null = 배치 종료(확인/취소). UI가 확인·취소 바 표시 */
  pendingChange: { pending: { stampId: string; label: string } | null };
  /** 데칼코마니 대칭축 이동(드래그·리셋) — UI가 "가운데로" 버튼 노출에 사용 */
  symmetryAxis: { x: number; y: number };
}

export type EngineEventName = keyof EngineEvents;

export type EngineListener<K extends EngineEventName> = (payload: EngineEvents[K]) => void;

/* ── 유틸 ── */

export function rgbToCss({ r, g, b }: RGB, a = 1): string {
  return `rgba(${r},${g},${b},${a})`;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 시드 가능한 결정적 난수 (테스트/타임랩스 재현성) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
