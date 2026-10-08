import { getStroke } from "perfect-freehand";
import {
  clamp,
  hexToRgb,
  type BrushId,
  type BrushSettings,
  type EngineEventName,
  type EngineEvents,
  type EngineListener,
  type LayerInfo,
  type Mode,
  type QuickShapeKind,
  type RecordedStroke,
  type RGB,
  type StrokePoint,
  type SymmetryMode,
} from "./types";
import { CanvasManager } from "./core/CanvasManager";
import { LayerStack } from "./core/LayerStack";
import { History } from "./core/History";
import { StrokeRecorder } from "./core/StrokeRecorder";
import { AutoSave, type SavedState } from "./core/AutoSave";
import { smearSegment } from "./tools/SmudgeTool";
import { drawPaperRelief, drawPaperTint, onPaperReliefLoad, type PaperKind } from "./core/paper";

/** 캔버스 요철 soft-light 세기(0~1) — 아트봉봉 화면과 나란히 보고 맞춘 값(2026-10-08) */
const PAPER_RELIEF_STRENGTH = 0.8; // 0.6 → 0.42: 2026-10-08 사용자 «캔버스 굴곡을 줄여보자»
import { tilesForRect, copyTiles, readTiles, TileSnapshotCommand, type TileRect } from "./core/tiles";
import type { Layer } from "./core/LayerStack";
import { BrushBase, createBrush, MIN_DAB_PX, STROKE_BRUSHES } from "./brushes";
import { buildBarrierFromLineart, floodFill } from "./brushes/FillTool";
import { PointerHandler } from "./input/PointerHandler";
import { Gestures } from "./input/Gestures";
import { Stabilizer, strengthToStreamline } from "./input/Stabilizer";
import { mirrorPoint } from "./tools/Symmetry";
import { detectShape, QUICKSHAPE_HOLD_MS } from "./tools/QuickShape";
import {
  shapeInsertPoints,
  densifyShape,
  isShapeDragTooSmall,
  type ShapeInsertKind,
} from "./tools/ShapeInsert";
import {
  hitPending,
  movePending,
  resizePending,
  commitRegion,
  pendingHalf,
} from "./tools/pendingStampMath";
import { drawStampOnCtx, getStamp } from "./tools/StampTool";
import { drawTextOnCtx, ensureFontReady, textAspect, type TextItem } from "./tools/TextInsert";
import { recognizeSketch } from "./recognizer/SketchMatch";
import type { StrokeContext } from "./core/backend";
import { blendToComposite } from "./core/backend";
import type { TipKind } from "./brushes/BrushBase";
import { loadTipOverrides } from "./core/tipLoader";

/*
 * ArtEngine: 브라우저 캔버스 위에서 모든 조각을 조율하는 중심.
 * React 비의존 — on/emit 이벤트로 Zustand 스토어가 구독한다(DESIGN-REVIEW B: 엔진↔React 브리지).
 */

export interface EngineOptions {
  width: number;
  height: number;
  display: HTMLCanvasElement;
  /** 캔버스를 감싸는 작업대(여백 포함). 두 손가락 중 하나가 종이 밖에 닿아도 핀치가
   * 성립하도록 포인터 이벤트를 여기서 받는다 — 생략하면 캔버스 자신 */
  surface?: HTMLElement;
  forceCanvas2D?: boolean;
  /** QA용 백엔드 강제(?backend=2d|gl) — gl은 소프트웨어 렌더러도 허용 */
  backendOverride?: "2d" | "gl";
  /** 무비 재현성용 시드 */
  seed?: number;
}

const DEFAULT_SETTINGS: BrushSettings = {
  size: 18,
  opacity: 1,
  color: { r: 45, g: 42, b: 38 },
  waterAmount: 0.6,
  stabilize: 3,
};

export class ArtEngine {
  readonly width: number;
  readonly height: number;
  private cm: CanvasManager;
  private layers: LayerStack;
  private history: History;
  private recorder: StrokeRecorder;
  private autosave: AutoSave;
  private pointer: PointerHandler;
  private gestures: Gestures;
  private stabilizer = new Stabilizer();

  private listeners = new Map<EngineEventName, Set<(p: unknown) => void>>();

  mode: Mode = "sketch";
  brushId: BrushId = "pencil";
  settings: BrushSettings = { ...DEFAULT_SETTINGS };
  symmetry: SymmetryMode = "none";
  /** 대칭축 위치(캔버스 좌표) — 기본은 정중앙, 사용자가 드래그로 옮긴다(2026-07-13 요청).
   * 표시 전용 상태라 undo/저장 대상이 아니다(획은 이미 반영된 좌표로 굳는다). */
  private symAxis: { x: number; y: number } | null = null;
  /** 축 드래그 중: 어느 축을 잡았는지(x=세로선, y=가로선, 둘 다=교차 핸들) */
  private axisDrag: { x: boolean; y: boolean } | null = null;
  quickShapeEnabled = false;
  /** 뚝딱그림(스케치 인식 → 스탬프 제안) — 색칠 모드에선 자동 비활성 */
  sketchSuggestEnabled = true;
  /** 도형 삽입 모드 — 켜져 있으면 드래그가 그리기 대신 도형 배치가 된다 */
  shapeInsertKind: ShapeInsertKind | null = null;
  private shapeDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;

  /* ── 떠 있는(아직 안 굳은) 스탬프 배치 ──
   * 뚝딱그림 제안 수락 또는 팔레트 선택 시, 바로 굳히지 않고 "떠 있는" 프리뷰로 띄운다.
   * 드래그 = 이동, 모서리 핸들 = 중심 기준 크기조절. 확인(commit) 시 실제 레이어에 굳히고,
   * 취소(cancel) 시 레이어를 건드리지 않아 원래 스케치가 그대로 남는다.
   * replaceCount = 커밋 시 지울 스케치 획 수(제안 수락=k, 팔레트=0).
   * originBBox = 대체할 스케치 원래 bbox(스탬프를 멀리 옮겨도 원본을 지우도록 tile 영역에 합집합). */
  private pending: {
    /** 스탬프(그림 도장) 또는 글씨 — 배치·확정 파이프라인은 동일 */
    kind: "stamp" | "text";
    stampId: string;
    /** kind==="text"일 때 넣을 글과 글꼴 */
    text?: TextItem;
    /** 상자 가로/세로 비율 — 스탬프는 1, 글씨는 글자 폭에서 계산 */
    aspect: number;
    cx: number;
    cy: number;
    size: number;
    replaceCount: number;
    layerId: string;
    originBBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  } | null = null;
  private pendingDrag: {
    mode: "move" | "resize";
    px: number;
    py: number;
    cx0: number;
    cy0: number;
    size0: number;
  } | null = null;

  private brush: BrushBase | null = null;
  private curPoints: StrokePoint[] = [];
  private strokeStartTs = 0;
  private firstDabLatency = -1;
  private strokeBBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  /** 스트로크 시작 전 활성 레이어 픽셀 스냅샷(undo용 before 소스) */
  private beforeFull: Uint8ClampedArray | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  // 뷰 변환(줌/팬)
  view = { scale: 1, ox: 0, oy: 0 };
  private rafId = 0;
  private needsComposite = false;
  private lastTick = 0;
  private replaying = false;

  constructor(opts: EngineOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.dprCap = initialDpr();
    this.cm = new CanvasManager(
      opts.width,
      opts.height,
      opts.display,
      opts.forceCanvas2D || opts.backendOverride === "2d",
      opts.backendOverride === "gl",
      this.dprCap,
    );
    this.layers = new LayerStack(opts.width, opts.height);
    this.history = new History(50);
    this.recorder = new StrokeRecorder();
    this.offRelief = onPaperReliefLoad(() => this.requestComposite()); // 요철 타일이 늦게 오면 다시 그림
    this.autosave = new AutoSave(5000);
    this.stabilizer.setStrength(this.settings.stabilize);
    loadTipOverrides(); // AI 팁 알파맵 비동기 로드(실패 시 프로시저럴 폴백)

    this.cm.onDowngradeToCanvas2D(() => this.requestComposite());
    this.fitDisplayDpr();
    /* 표시 요소가 실제로 차지하는 물리 픽셀이 바뀌면(회전·창 크기·패널 접기) 백킹을 다시 맞춘다 */
    if (typeof ResizeObserver !== "undefined") {
      this.displayRo = new ResizeObserver(() => this.fitDisplayDpr());
      this.displayRo.observe(opts.display);
    }
    this.watchDpr();
    /* 레이어 캔버스의 2D 컨텍스트가 복구되면 내용은 비어 있다 — 마지막 자동저장으로 되살린다.
     * 안 그러면 그림이 사라지고 새 획도 안 보이는 상태가 된다(저사양 기기 메모리 압박). */
    this.layers.onContextRestored(() => {
      console.warn("[ArtEngine] 캔버스 컨텍스트 복구 — 마지막 저장본으로 되살립니다");
      void this.restore();
    });

    this.gestures = new Gestures({
      onTransform: ({ scale, dx, dy, cx, cy }) => this.applyTransform(scale, dx, dy, cx, cy),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
    });

    this.pointer = new PointerHandler(
      opts.display,
      (clientX, clientY) => this.toCanvas(clientX, clientY, opts.display),
      {
        /* 입력 처리 중 예외가 새어나가면 그 획이 통째로 죽고(브러시 상태가 반쯤 열린 채로 남아)
         * 그 뒤로 아무것도 안 그려진다 — "어느 순간부터 선이 안 나옴"(웨일북 실사용 2026-07-14).
         * 예외는 여기서 삼키고 획 상태를 정리해 다음 획은 정상 동작하게 한다. */
        onDown: (p) => this.guard("strokeBegin", () => this.strokeBegin(p)),
        onMove: (pts) => this.guard("strokeMove", () => this.strokeMove(pts)),
        onUp: (p) => this.guard("strokeEnd", () => this.strokeEnd(p)),
        onCancel: () => this.guard("strokeCancel", () => this.strokeCancel()),
        onGesture: (active, _e, phase) =>
          this.gestures.update(
            active.map((a) => ({ clientX: a.clientX, clientY: a.clientY })),
            phase,
            performance.now(),
          ),
      },
      opts.surface,
    );

    // 탭 숨김/닫힘 시 디바운스 대기 중인 자동저장 즉시 플러시 — 마지막 획 후 5초 안에
    // 닫으면 최근 획이 유실되던 구멍(2026-07-07). pagehide는 모바일 사파리 포함 최후 보루
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.flushAutoSave);
      window.addEventListener("pagehide", this.flushAutoSave);
    }

    this.startLoop();
    this.emitLayers();
    this.emitHistory();
  }

  private flushAutoSave = (): void => {
    if (document.visibilityState === "hidden") void this.autosave.flush();
  };

  /* ── 이벤트 브리지 ── */
  on<K extends EngineEventName>(name: K, fn: EngineListener<K>): () => void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    const set = this.listeners.get(name)!;
    set.add(fn as (p: unknown) => void);
    return () => set.delete(fn as (p: unknown) => void);
  }
  private emit<K extends EngineEventName>(name: K, payload: EngineEvents[K]): void {
    this.listeners.get(name)?.forEach((fn) => fn(payload));
  }
  private emitLayers(): void {
    this.emit("layersChange", { layers: this.layers.info, activeId: this.layers.activeId });
  }
  private emitHistory(): void {
    this.emit("historyChange", { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }
  /** UI 초기 동기화용 — 스토어는 constructor의 emitHistory를 놓친다(구독이 뒤에 붙음) */
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /* ── 좌표 변환 ── */
  private toCanvas(clientX: number, clientY: number, el: HTMLElement): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    // 화면 요소 크기 → 캔버스 내부 해상도, 이후 뷰 변환 역적용
    const nx = ((clientX - rect.left) / rect.width) * this.width;
    const ny = ((clientY - rect.top) / rect.height) * this.height;
    return {
      x: (nx - this.view.ox) / this.view.scale,
      y: (ny - this.view.oy) / this.view.scale,
    };
  }

  private applyTransform(scale: number, dx: number, dy: number, cx: number, cy: number): void {
    const rect = this.cm.display.getBoundingClientRect();
    const px = ((cx - rect.left) / rect.width) * this.width;
    const py = ((cy - rect.top) / rect.height) * this.height;
    // 최소 1배(화면 맞춤): 1 미만이면 캔버스 밖 흰 영역이 생기는데, 사용자는 그걸
    // 종이로 알고 칠한다 — "축소하면 화면 밖은 색칠이 안 됨" 리포트(2026-07-07 웨일북)
    const newScale = clamp(this.view.scale * scale, 1, 8);
    // 핀치 중심 고정
    this.view.ox = px - ((px - this.view.ox) * newScale) / this.view.scale + dx;
    this.view.oy = py - ((py - this.view.oy) * newScale) / this.view.scale + dy;
    this.view.scale = newScale;
    // 팬 클램프: 캔버스 가장자리가 뷰포트 안으로 들어오지 못하게(빈 흰 영역 방지)
    this.view.ox = clamp(this.view.ox, this.width * (1 - newScale), 0);
    this.view.oy = clamp(this.view.oy, this.height * (1 - newScale), 0);
    this.emit("viewChange", { scale: newScale });
    this.requestComposite();
  }

  /** 마우스휠/트랙패드 줌(데스크톱) — 브라우저 페이지 줌 대신 앱 뷰 줌으로.
   * factor>1=확대. cx,cy=화면(clientX/Y) 기준 줌 중심. 앱 뷰라 새로고침 시 리셋된다. */
  zoomBy(factor: number, cx: number, cy: number): void {
    this.applyTransform(factor, 0, 0, cx, cy);
  }

  resetView(): void {
    this.view = { scale: 1, ox: 0, oy: 0 };
    this.emit("viewChange", { scale: 1 });
    this.requestComposite();
  }

  /* ── 브러시/모드 설정 ── */
  setMode(mode: Mode): void {
    this.resetSuggest();
    this.mode = mode;
    // 모드별 기본 브러시
    const def: Record<Mode, BrushId> = {
      sketch: "pencil",
      watercolor: "watercolor",
      oil: "oil",
      coloring: "crayon",
    };
    this.setBrush(def[mode]);
    this.requestComposite(); // 모드=종이(캔버스) 변경 — 즉시 다시 그려야 탭 클릭에 바로 반응
  }
  setBrush(id: BrushId): void {
    this.cancelPendingStamp(); // 붓/도구 전환 = 떠 있던 배치 취소
    this.brushId = id;
    // 종이는 "마지막 비지우개 브러시" 기준 — 지우개로 바꿔도 화선지가 유지된다
    const wasHanji = this.paperBrushId === "inkbrush";
    if (id !== "eraser") this.paperBrushId = id;
    if (wasHanji !== (this.paperBrushId === "inkbrush")) this.requestComposite(); // 종이(틴트) 즉시 갱신
  }
  private paperBrushId: BrushId = "pencil";
  setColor(rgb: RGB | string): void {
    this.settings.color = typeof rgb === "string" ? hexToRgb(rgb) : rgb;
  }
  setSize(size: number): void {
    this.settings.size = clamp(size, 1, 128);
  }
  setOpacity(o: number): void {
    this.settings.opacity = clamp(o, 0, 1);
  }
  setWater(w: number): void {
    this.settings.waterAmount = clamp(w, 0, 1);
  }
  setStabilize(s: number): void {
    this.settings.stabilize = clamp(s, 0, 10);
    this.stabilizer.setStrength(this.settings.stabilize);
  }
  setSymmetry(m: SymmetryMode): void {
    this.cancelPendingStamp();
    this.symmetry = m;
    this.requestComposite(); // 가이드선 즉시 표시/제거
  }

  /** 대칭축 좌표(미설정이면 캔버스 중앙) */
  private axis(): { x: number; y: number } {
    return this.symAxis ?? { x: this.width / 2, y: this.height / 2 };
  }

  /** 대칭축을 중앙으로 되돌린다(UI: 축 리셋) */
  resetSymmetryAxis(): void {
    this.symAxis = null;
    this.requestComposite();
    this.emit("symmetryAxis", { ...this.axis() });
  }

  /** 포인터가 축(또는 교차 핸들)을 잡았는지 — 잡았으면 그리기 대신 축 이동 */
  private axisHitTest(p: { x: number; y: number }): { x: boolean; y: boolean } | null {
    if (this.symmetry === "none") return null;
    const a = this.axis();
    const tol = 14 / this.view.scale; // 화면상 약 14px(줌 무관)
    const nearX =
      (this.symmetry === "vertical" || this.symmetry === "quad") && Math.abs(p.x - a.x) <= tol;
    const nearY =
      (this.symmetry === "horizontal" || this.symmetry === "quad") && Math.abs(p.y - a.y) <= tol;
    // quad에서 교차점 핸들을 잡으면 두 축을 함께 옮긴다
    if (nearX && nearY) return { x: true, y: true };
    if (nearX) return { x: true, y: false };
    if (nearY) return { x: false, y: true };
    return null;
  }

  private axisDragMove(p: { x: number; y: number }): void {
    if (!this.axisDrag) return;
    const a = this.axis();
    // 축이 캔버스 밖으로 나가면 대칭이 화면 밖에서만 일어난다 — 안쪽으로 클램프
    const m = 8;
    this.symAxis = {
      x: this.axisDrag.x ? clamp(p.x, m, this.width - m) : a.x,
      y: this.axisDrag.y ? clamp(p.y, m, this.height - m) : a.y,
    };
    this.requestComposite();
  }
  setSketchSuggest(on: boolean): void {
    this.sketchSuggestEnabled = on;
    if (!on) this.resetSuggest();
  }
  /** 협동 세션 억제 — 수락(undo×k+스탬프)이 원격에 전파될 수 없어 캔버스가 갈라진다.
   * 스트로크 프로토콜에 치환 명령이 생기기 전까지 협동 방에서는 기능 자체를 잠근다. */
  setSuggestSuppressed(on: boolean): void {
    this.suggestSuppressed = on;
    if (on) this.resetSuggest();
  }
  private suggestSuppressed = false;
  setShapeInsert(kind: ShapeInsertKind | null): void {
    this.cancelPendingStamp();
    this.shapeInsertKind = kind;
    this.shapeDrag = null;
    this.requestComposite(); // 진행 중이던 미리보기 정리
  }
  setQuickShape(on: boolean): void {
    this.quickShapeEnabled = on;
  }
  setPressureEnabled(on: boolean): void {
    this.pointer.setPressureEnabled(on);
  }

  /* ── 스트로크 파이프라인 ── */
  /** 모드가 캔버스(종이)를 결정 — 유화=린넨천, 수채=수채용지, 그 외=매끈한 도화지.
   * 예외: 붓펜은 모드와 무관하게 화선지(먹이 스미는 종이). */
  private paperKindForMode(): PaperKind {
    if (this.paperBrushId === "inkbrush") return "hanji";
    return this.mode === "oil" ? "linen" : this.mode === "watercolor" ? "cotton" : "smooth";
  }

  /** 표시용 종이 틴트는 별도 — 수채는 일반과 같은 백지(i-scream 원본과 동일, 2026-07-10
   * 사용자 판정). 실제 수채화지도 빈 종이의 결은 거의 안 보이고 칠한 곳에서 드러난다 —
   * 획 내부 질감(paperGrain·edgeNoise·washCloud)은 cotton 필드를 그대로 쓴다(위 함수). */
  private paperTintKindForMode(): PaperKind {
    const k = this.paperKindForMode();
    return k === "cotton" ? "smooth" : k;
  }

  private brushContext(): StrokeContext {
    const brush = this.brush!;
    const wash = brush.cfg.strokeBlend === "wash";
    // 작은 유화 획은 bold 붓결 LOD — fine 맵의 미세 골은 dab 축소 시 서브픽셀로 사라진다
    // ⚠️ 원(raw) 크기가 아니라 "실제로 그려지는 폭" 기준 — 브러시별 최소 선 폭(하한 압축)
    // 때문에 raw 2px가 화면에선 4px로 나가는 구간이 있다. raw로 재면 4px 크레용 획에
    // 종이 결이 0.06밖에 안 실려(=민무늬) 굵기만 굵고 질감은 없는 획이 된다.
    const pxSize = brush.strokePx(this.settings.size);
    const tip: TipKind =
      brush.cfg.tip === "bristle" && pxSize < 40 ? "bristle-bold" : brush.cfg.tip;
    // 얇은 획 보호(2026-07-13 사용자 실측: 붓펜 굵기 1이 점선처럼 끊긴다) —
    // 종이 결 침식·wet edge는 획 폭에 비례하는 "질감"인데, 획이 1~3px이면 골 하나가
    // 획 전체를 관통해 알파를 0으로 만든다(= 끊김). 8px 미만은 강도를 폭에 비례 감쇠.
    const thin = Math.min(1, pxSize / 8);
    /* ⚠️ 백화 모드(grainLift: 유화·오일파스텔)만 감쇠에서 빼 보았으나 **효과 0**이었다
     * (2026-07-29 A/B: 굵기 3 유화붓 내부 결 0.034 → 0.034, 오일파스텔 0.219 → 0.221).
     * 이유 = 백화 기여분이 셰이더의 합산 캡(어두운 색 lift ≤0.2, 밝은 색 ≤0.34)에 이미
     * 눌려 있어 결 강도를 올려도 화면에 안 나온다. 되살리려면 캡 구조부터 손대야 하는데
     * 그 캡은 "검정이 회색빛으로 바래는" 회귀를 막으려고 넣은 것이다 — 건드리지 말 것. */
    return {
      layerCanvas: this.layers.active.canvas,
      tip,
      composite: brush.cfg.composite,
      color: this.settings.color,
      paperGrain: brush.cfg.paperGrain * thin,
      wash,
      // opacityAsDilution(수채): 진하기는 브러시가 색 희석으로 소비 — 알파는 1 유지(겹침 수렴)
      strokeOpacity: wash
        ? clamp(brush.cfg.washOpacity * (brush.cfg.opacityAsDilution ? 1 : this.settings.opacity), 0, 1)
        : 1,
      wetEdge: brush.cfg.wetEdge * thin,
      impasto: brush.cfg.impasto,
      impastoShadow: brush.cfg.impastoShadow,
      washOver: brush.cfg.washOver,
      grainLift: brush.cfg.grainLift,
      streaks: brush.cfg.streaks,
      washCloud: brush.cfg.washCloud,
      edgeNoise: brush.cfg.edgeNoise * thin,
      paperKind: this.paperKindForMode(),
    };
  }

  private strokeBegin(p: StrokePoint): void {
    if (this.replaying) return;
    // 떠 있는 스탬프 배치 중: 그리기 대신 이동/크기조절 드래그만(그리기 완전 차단)
    if (this.pending) {
      this.pendingPointerDown(p);
      return;
    }
    // 데칼코마니 축을 잡았으면 그리지 않고 축을 옮긴다(2026-07-13 요청)
    const grab = this.axisHitTest(p);
    if (grab) {
      this.axisDrag = grab;
      this.axisDragMove(p);
      return;
    }
    // 도형 삽입: 드래그 = 도형 배치(미리보기), 커밋은 strokeEnd에서
    if (this.shapeInsertKind) {
      // 스트로크형 브러시로만 그린다(포인터·페인트통 등이면 UI가 브러시를 바꿔줌)
      if (STROKE_BRUSHES.includes(this.brushId)) {
        this.shapeDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        this.requestComposite();
      }
      return;
    }
    // 포인터(클릭 펜): 캔버스를 눌러도 아무것도 안 그린다 — 제안·버튼 클릭 중 오작화 방지
    if (this.brushId === "pointer") return;
    // 페인트통(fill)은 클릭 1회 처리
    if (this.brushId === "fill") {
      this.doFill(p);
      return;
    }
    // 번짐(스머지)은 dab 파이프라인이 아니라 레이어 직접 편집
    if (this.brushId === "smudge") {
      this.smudgeBegin(p);
      return;
    }
    // 스포이트: 탭 지점의 화면 색을 찍어 알린다(그리지 않음)
    if (this.brushId === "eyedropper") {
      this.emit("colorPicked", { color: this.pickColor(p.x, p.y) });
      return;
    }
    this.brush = createBrush(this.brushId);
    // wet mixing(유화): 획 시작 시점의 활성 레이어 미러에서 밑색을 샘플하는 콜백 주입.
    // 미러는 1/4 축소 + willReadFrequently 캔버스 1회 리드백 — 획 도중 getImageData 0회
    // (레이어 원본 반복 리드백은 GPU 동기화 히치, 7MB 원본 스냅샷은 과거 제거된 히치)
    this.brush.baseSampler = this.brush.cfg.wetMix > 0 ? this.makeWetMixSampler() : null;
    this.quickShapeApplied = false;
    this.curPoints = [this.stabilizer.begin(p)];
    this.strokeStartTs = performance.now();
    this.firstDabLatency = -1;
    this.strokeBBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    // undo용 before 스냅샷 — destination-out(지우개류)만 여기서(레이어에 직접 그리는 백엔드가 있음).
    // 다른 브러시는 endStroke 합성 직전까지 레이어가 안 변하므로 그때 캡처
    // (스트로크 시작 시 7MB getImageData 동기 readback 히치 제거).
    // 지우개(destination-out)는 레이어를 직접 지운다 → 닿는 타일만 copy-on-write로 보존
    this.cow = this.brush.cfg.composite === "destination-out" ? new Map() : null;

    this.cm.backend.beginStroke(this.brushContext());
    const dabs = this.brush.begin(this.curPoints[0], this.settings);
    this.paintDabs(dabs, this.curPoints[0]);
    this.armQuickShapeHold();
  }

  private strokeMove(points: StrokePoint[]): void {
    if (this.axisDrag) {
      this.axisDragMove(points[points.length - 1]);
      return;
    }
    if (this.pending) {
      if (this.pendingDrag) this.pendingPointerMove(points[points.length - 1]);
      return;
    }
    if (this.shapeDrag) {
      const last = points[points.length - 1];
      this.shapeDrag.x1 = last.x;
      this.shapeDrag.y1 = last.y;
      this.requestComposite(); // 미리보기 갱신(compositeNow가 그림)
      return;
    }
    if (this.smudging) {
      this.smudgeMove(points);
      return;
    }
    if (!this.brush || this.replaying) return;
    let lastSp: StrokePoint | null = null;
    for (const raw of points) {
      const sp = this.stabilizer.push(raw);
      this.curPoints.push(sp);
      const dabs = this.brush.move(sp);
      this.paintDabs(dabs, sp);
      if (dabs.length) this.armQuickShapeHold();
      lastSp = sp;
    }
    // 손 뗄 때 끝 모양이 정해지는 브러시(납작붓) — 붙잡아 둔 꼬리를 표시만 해 펜에 붙어 오게
    const tail = lastSp ? this.brush.preview() : null;
    if (tail && lastSp) this.cm.backend.setPreviewDabs(this.expandDabs(tail, lastSp));
    if (lastSp) this.emit("pointerMoved", { x: lastSp.x, y: lastSp.y });
    this.requestComposite();
  }

  private strokeEnd(p: StrokePoint): void {
    if (this.axisDrag) {
      this.axisDragMove(p);
      this.axisDrag = null;
      this.emit("symmetryAxis", { ...this.axis() });
      return;
    }
    if (this.pending) {
      this.pendingDrag = null; // 드래그만 끝남 — 배치는 확인/취소 버튼으로
      return;
    }
    if (this.shapeDrag) {
      const d = this.shapeDrag;
      this.shapeDrag = null;
      d.x1 = p.x;
      d.y1 = p.y;
      this.commitShapeInsert(d);
      return;
    }
    if (this.smudging) {
      this.smudgeEnd(p);
      return;
    }
    if (!this.brush || this.replaying) return;
    this.clearHold();
    const sp = this.stabilizer.push(p);
    this.curPoints.push(sp);
    this.paintDabs(this.brush.move(sp), sp);
    this.paintDabs(this.brush.end(), sp); // 탭 시 보류된 첫 dab(점 찍기)

    // QuickShape: 홀드 없이 뗐어도 도형성 강하면 스냅(옵션 시, 홀드로 이미 스냅됐으면 재감지 안 함)
    if (this.quickShapeEnabled && !this.quickShapeApplied) {
      const shape = detectShape(this.curPoints);
      if (shape) this.applyQuickShape(shape.kind, shape.points);
    }

    // 합성 직전 스냅샷(레이어는 아직 미변경 상태) — 더티 타일만 읽는다.
    // 전체 캔버스 getImageData(6.4MB)를 획마다 하면 저사양 기기에서 GC 스파이크(실측).
    if (!this.beforeFull) this.captureBeforeTiles();
    if (this.quickShapeApplied) {
      // 도형이 프리핸드를 "대체"한다 — 프리핸드 스트로크 버퍼를 합성하면
      // 원본 쪽만 이중으로 진해진다(데칼코마니 실측 버그). 버퍼는 폐기.
      this.cm.backend.cancelStroke();
    } else {
      this.cm.backend.endStroke();
    }
    this.finalizeStroke(this.quickShapeApplied);
  }

  /** 진행 중 획 폐기(핀치 진입 등) — 레이어·히스토리·레코더에 아무것도 남기지 않는다.
   * ⚠️ Canvas2D 폴백의 지우개(레이어 직접)는 취소 불가 — 그 경우 이미 지운 만큼은 남는다 */
  private strokeCancel(): void {
    if (this.replaying) return;
    if (this.axisDrag) {
      this.axisDrag = null;
      this.emit("symmetryAxis", { ...this.axis() });
      return;
    }
    if (this.shapeDrag) {
      this.shapeDrag = null;
      this.requestComposite(); // 미리보기 지우기
    }
    if (!this.brush && !this.smudging) return;
    this.clearHold();
    // 레이어를 직접 고치는 도구(번짐, 지우개)는 보존해 둔 픽셀로 원복
    const cowSnap = this.cowSnapshot();
    if (cowSnap) {
      const ctx = this.layers.active.ctx;
      cowSnap.tiles.forEach((t, i) => {
        ctx.putImageData(new ImageData(cowSnap.data[i].slice(), t.w, t.h), t.x, t.y);
      });
    } else if (this.beforeFull && this.smudging) {
      this.layers.active.ctx.putImageData(
        new ImageData(this.beforeFull.slice(), this.width, this.height),
        0,
        0,
      );
    }
    this.cow = null;
    this.cm.backend.cancelStroke();
    this.brush = null;
    this.smudging = false;
    this.smudgeLasts = null;
    this.curPoints = [];
    this.beforeFull = null;
    this.beforeTiles = null;
    this.quickShapeApplied = false;
    this.quickShapePts = null;
    this.requestComposite(); // 라이브 프리뷰에 떠 있던 획 지우기
  }

  /* ── 번짐(스머지) — 레이어 픽셀을 문질러 끌고 간다(SmudgeTool 공용 헬퍼) ── */
  private smudging = false;
  /* 대칭 가지별 직전 지점 — 번짐은 dab 파이프라인(paintDabs)이 아니라 레이어를 직접
   * 문지르므로 대칭 복제를 여기서 직접 해야 한다. 하지 않으면 데칼코마니에서 번짐만
   * 한쪽에만 먹는다(2026-07-13 사용자 실측 "번지기 붓이 데칼코마니에서 작동 안 함"). */
  private smudgeLasts: { x: number; y: number }[] | null = null;

  /** 대칭 축 기준 복제점(대칭 없으면 자기 자신 1개) — 순서는 가지 인덱스로 고정 */
  private mirrors(p: StrokePoint): { x: number; y: number }[] {
    if (this.symmetry === "none") return [{ x: p.x, y: p.y }];
    return mirrorPoint(p, this.symmetry, this.axis().x, this.axis().y).map((m) => ({
      x: m.x,
      y: m.y,
    }));
  }

  private smudgeSize(): number {
    return this.settings.size * 1.6; // 문지름 폭은 넉넉하게(손가락 체감)
  }

  private smudgeBegin(p: StrokePoint): void {
    this.smudging = true;
    this.smudgeLasts = this.mirrors(p);
    this.curPoints = [p];
    this.cow = new Map(); // 직접 편집 — 문지르기 직전에 닿는 타일만 보존(COW)
    this.strokeBBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }

  private smudgeMove(points: StrokePoint[]): void {
    const lasts = this.smudgeLasts;
    if (!lasts) return;
    const ctx = this.layers.active.ctx;
    for (const p of points) {
      this.curPoints.push(p);
      const ms = this.mirrors(p); // 가지 수·순서는 begin과 동일(대칭 모드는 획 중 안 바뀐다)
      const r = this.smudgeSize() / 2 + 2;
      for (let i = 0; i < lasts.length && i < ms.length; i++) {
        // ⚠️ 문지르기 전에 원본 타일 확보(뒤에 하면 이미 뭉개진 픽셀이 undo 대상이 된다)
        this.cowTouch(
          Math.min(lasts[i].x, ms[i].x) - r,
          Math.min(lasts[i].y, ms[i].y) - r,
          Math.max(lasts[i].x, ms[i].x) + r,
          Math.max(lasts[i].y, ms[i].y) + r,
        );
        lasts[i] = smearSegment(
          ctx,
          lasts[i],
          ms[i],
          this.smudgeSize(),
          this.settings.opacity,
          (x, y, d) => this.trackDirty(x, y, d),
        );
      }
    }
    this.requestComposite();
  }

  private smudgeEnd(p: StrokePoint): void {
    this.resetSuggest(); // smudge도 히스토리 push — 그룹 불변식 유지
    this.smudgeMove([p]);
    this.smudging = false;
    this.smudgeLasts = null;
    const bb = this.strokeBBox;
    const cowSnap = this.cowSnapshot();
    this.cow = null;
    if (isFinite(bb.minX) && cowSnap) {
      const layer = this.layers.active;
      const tiles = cowSnap.tiles;
      const after = readTiles(layer.ctx, tiles);
      const before = cowSnap.data;
      this.pushTileCommand(layer, tiles, before, after);
      // 무비 재생용 기록(재생도 같은 smearSegment 사용). 협동 브로드캐스트는 안 함 —
      // 원격 레이어 분리 구조에서 남의 픽셀을 문지를 수 없다(의도).
      this.recorder.record({
        brush: this.brushId,
        settings: { ...this.settings },
        layerId: layer.id,
        points: this.curPoints,
        symmetry: this.symmetry,
      });
    }
    this.beforeFull = null;
    this.curPoints = [];
    this.scheduleAutoSave();
  }

  /** 스포이트 — 보이는 레이어들을 흰 종이 위에 합성한 색(종이 결 틴트는 제외: 그리기 색 기준) */
  private pickCtx: CanvasRenderingContext2D | null = null;

  private pickColor(x: number, y: number): RGB {
    if (!this.pickCtx) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      this.pickCtx = c.getContext("2d", { willReadFrequently: true })!;
    }
    const ctx = this.pickCtx;
    const sx = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const sy = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
    for (const layer of this.layers.list) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = blendToComposite(layer.blend);
      ctx.drawImage(layer.canvas, sx, sy, 1, 1, 0, 0, 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  }

  /** 획 시작 전 상태 — 더티 타일만 */
  private beforeTiles: { tiles: TileRect[]; data: Uint8ClampedArray[] } | null = null;

  /*
   * 지우개·번짐은 레이어를 실시간으로 고치므로 "고치기 전" 픽셀을 미리 갖고 있어야 한다.
   * 예전엔 획 시작 때 전체 캔버스(6.4MB)를 스냅샷했다 — 저사양 기기에서 지우개 획마다
   * 리드백 + 6.4MB 가비지 → 렉(2026-07-14 실측: 지우개 세션의 멈춤 총합이 크레용의 3~8배).
   * 지금은 copy-on-write: dab이 닿는 타일만, 닿기 직전에 1회 복사한다.
   */
  private cow: Map<number, { rect: TileRect; data: Uint8ClampedArray }> | null = null;

  /** 이 사각형이 덮는 타일 중 아직 복사 안 한 것을 지금 복사해 둔다 */
  private cowTouch(minX: number, minY: number, maxX: number, maxY: number): void {
    const cow = this.cow;
    if (!cow) return;
    const x = Math.max(0, Math.floor(minX));
    const y = Math.max(0, Math.floor(minY));
    const w = Math.min(this.width - x, Math.ceil(maxX - x));
    const h = Math.min(this.height - y, Math.ceil(maxY - y));
    if (w <= 0 || h <= 0) return;
    const ctx = this.layers.active.ctx;
    for (const t of tilesForRect(x, y, w, h, this.width, this.height)) {
      const key = t.ty * 4096 + t.tx;
      if (cow.has(key)) continue;
      cow.set(key, { rect: t, data: new Uint8ClampedArray(ctx.getImageData(t.x, t.y, t.w, t.h).data) });
    }
  }

  /** COW로 모아 둔 "고치기 전" 타일 — 히스토리 커맨드용(순서 고정) */
  private cowSnapshot(): { tiles: TileRect[]; data: Uint8ClampedArray[] } | null {
    if (!this.cow || this.cow.size === 0) return null;
    const entries = [...this.cow.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    return { tiles: entries.map((e) => e.rect), data: entries.map((e) => e.data) };
  }

  /** 지금까지의 더티 bbox에 해당하는 타일들을 레이어에서 읽어 둔다(합성 직전 호출) */
  private captureBeforeTiles(): void {
    const bb = this.strokeBBox;
    if (!isFinite(bb.minX)) {
      this.beforeTiles = null;
      return;
    }
    const x = Math.max(0, Math.floor(bb.minX));
    const y = Math.max(0, Math.floor(bb.minY));
    const w = Math.min(this.width - x, Math.ceil(bb.maxX - x));
    const h = Math.min(this.height - y, Math.ceil(bb.maxY - y));
    const tiles = tilesForRect(x, y, w, h, this.width, this.height);
    this.beforeTiles = { tiles, data: readTiles(this.layers.active.ctx, tiles) };
  }

  private snapshotActiveLayer(): Uint8ClampedArray {
    return new Uint8ClampedArray(
      this.layers.active.ctx.getImageData(0, 0, this.width, this.height).data,
    );
  }

  /** wet mixing 밑색 샘플러(재사용 미러 캔버스, 지연 생성) */
  private mixCtx: CanvasRenderingContext2D | null = null;

  /** 활성 레이어의 1/4 미러를 1회 캡처해 배열 샘플 클로저를 만든다(획 시작마다 호출).
   * 반환 샘플러: 반경 r 원 근방 평균 RGB(알파 가중), 칠해진 면적이 적으면 null(빈 종이). */
  private makeWetMixSampler(): (x: number, y: number, r: number) => RGB | null {
    const DS = 4;
    const w = Math.ceil(this.width / DS);
    const h = Math.ceil(this.height / DS);
    if (!this.mixCtx) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      this.mixCtx = c.getContext("2d", { willReadFrequently: true })!;
    }
    this.mixCtx.clearRect(0, 0, w, h);
    this.mixCtx.drawImage(this.layers.active.canvas, 0, 0, w, h);
    const d = this.mixCtx.getImageData(0, 0, w, h).data;
    return (x, y, r) => {
      const cx = Math.round(x / DS);
      const cy = Math.round(y / DS);
      const R = Math.max(1, Math.round(r / DS));
      let rs = 0, gs = 0, bs = 0, as = 0, n = 0;
      for (let yy = Math.max(0, cy - R); yy <= Math.min(h - 1, cy + R); yy++) {
        for (let xx = Math.max(0, cx - R); xx <= Math.min(w - 1, cx + R); xx++) {
          const i = (yy * w + xx) * 4;
          const a = d[i + 3];
          n++;
          if (a > 40) {
            rs += d[i] * a;
            gs += d[i + 1] * a;
            bs += d[i + 2] * a;
            as += a;
          }
        }
      }
      // 칠해진 면적 12% 미만은 빈 종이 취급 — 종이(흰 배경)와는 섞지 않는다(i-scream 동일)
      if (!n || as < n * 255 * 0.12) return null;
      return { r: rs / as, g: gs / as, b: bs / as };
    };
  }

  /** 라이브 프리뷰용 스크래치 캔버스(지연 생성, 스트로크 중에만 사용) */
  private scratch: CanvasRenderingContext2D | null = null;
  private previewScratchCtx(): CanvasRenderingContext2D {
    if (!this.scratch) {
      const c = document.createElement("canvas");
      c.width = this.width;
      c.height = this.height;
      this.scratch = c.getContext("2d")!;
    }
    return this.scratch;
  }

  /** 크기 하한 + 대칭 복제 — 확정 dab·표시 전용 꼬리 공용 */
  private expandDabs(dabs: ReturnType<BrushBase["begin"]>, center: StrokePoint): ReturnType<BrushBase["begin"]> {
    const floor = this.brush?.minDabPx ?? MIN_DAB_PX;
    for (const d of dabs) if (d.size < floor) d.size = floor;
    return this.symmetry === "none"
      ? dabs
      : dabs.flatMap((d) =>
          mirrorPoint(
            { x: d.x, y: d.y, pressure: 1, t: center.t },
            this.symmetry,
            this.axis().x,
            this.axis().y,
          ).map((m) => ({ ...d, x: m.x, y: m.y })),
        );
  }

  private paintDabs(dabs: ReturnType<BrushBase["begin"]>, center: StrokePoint): void {
    if (!dabs.length) return;
    // 최종 안전망 — makeDab 이후 크기를 곱하는 브러시(수채 벌지·로브, 유화 등)가 다시
    // 서브픽셀로 내려가면 획이 끊기고 계단이 진다(2026-07-13 실측). 여기서 한 번 더 하한.
    // 하한은 브러시별(minDabPxFor) — 도구마다 그을 수 있는 최소 선 폭이 다르다.
    // 공통 하한 하나로 누르면 굵기 1~4에서 전 브러시가 같은 헤어라인이 된다(2026-07-25).
    if (this.firstDabLatency < 0) {
      this.firstDabLatency = performance.now() - this.strokeStartTs;
      this.emit("strokeLatency", { ms: this.firstDabLatency });
    }
    const all = this.expandDabs(dabs, center);
    if (this.cow) {
      // ⚠️ 반드시 그리기 전에 — 지운 뒤 복사하면 "지워진 상태"가 undo 대상이 된다
      for (const d of all) {
        const r = d.size / 2 + 2;
        this.cowTouch(d.x - r, d.y - r, d.x + r, d.y + r);
      }
    }
    this.cm.backend.drawDabs(all);
    for (const d of all) this.trackDirty(d.x, d.y, d.size);
    this.requestComposite();
  }

  private trackDirty(x: number, y: number, size: number): void {
    const r = size / 2 + 2;
    this.strokeBBox.minX = Math.min(this.strokeBBox.minX, x - r);
    this.strokeBBox.minY = Math.min(this.strokeBBox.minY, y - r);
    this.strokeBBox.maxX = Math.max(this.strokeBBox.maxX, x + r);
    this.strokeBBox.maxY = Math.max(this.strokeBBox.maxY, y + r);
  }

  /** 스트로크 종료 후 더티 타일 before/after를 커맨드로 기록 */
  private finalizeStroke(alreadyRecorded: boolean): void {
    const bb = this.strokeBBox;
    const layer = this.layers.active;
    const cowSnap = this.cowSnapshot();
    this.cow = null;
    if (!isFinite(bb.minX) || (!this.beforeFull && !this.beforeTiles && !cowSnap)) {
      this.beforeFull = null;
      this.beforeTiles = null;
      this.brush = null;
      this.quickShapePts = null; // push 없이 종료 — 로그도 안 남긴다(1:1)
      return;
    }
    const x = Math.max(0, Math.floor(bb.minX));
    const y = Math.max(0, Math.floor(bb.minY));
    const w = Math.min(this.width - x, Math.ceil(bb.maxX - x));
    const h = Math.min(this.height - y, Math.ceil(bb.maxY - y));
    // 지우개 = COW 타일, 일반 브러시 = 합성 직전에 읽은 더티 타일
    const snap = cowSnap ?? this.beforeTiles;
    const tiles = snap?.tiles ?? tilesForRect(x, y, w, h, this.width, this.height);
    const before = snap?.data ?? copyTiles(this.beforeFull!, this.width, tiles);
    const after = readTiles(layer.ctx, tiles);
    this.beforeFull = null;
    this.beforeTiles = null;
    this.pushTileCommand(layer, tiles, before, after);

    if (!alreadyRecorded) {
      this.recorder.record({
        brush: this.brushId,
        settings: { ...this.settings },
        layerId: layer.id,
        points: this.curPoints,
        symmetry: this.symmetry,
      });
    } else if (this.quickShapePts) {
      // QuickShape: 프리핸드 대신 스냅 폴리라인을 기록 — 안 하면 히스토리 push만 남아
      // 무비에서 도형이 빠지고, 언두 커서가 한 칸 밀려 무관한 획이 사라진다(교차검증 CRITICAL)
      this.recorder.record({
        brush: this.brushId,
        settings: { ...this.settings },
        layerId: layer.id,
        points: this.quickShapePts,
        symmetry: this.symmetry,
        extra: { shape: true },
      });
    }
    this.quickShapePts = null;
    // 협동 전송용 방출(로컬 스트로크만)
    this.emit("strokeCommitted", {
      brush: this.brushId,
      color: this.settings.color,
      size: this.settings.size,
      opacity: this.settings.opacity,
      water: this.settings.waterAmount,
      symmetry: this.symmetry,
      points: this.curPoints,
    });
    if (this.brushId !== "eraser") this.emit("colorUsed", { color: this.settings.color });
    // 뚝딱그림 그룹 추적 — brush/curPoints 소거 전에, 이 획의 더티 bbox와 함께
    this.trackSuggest(alreadyRecorded, { minX: x, minY: y, maxX: x + w, maxY: y + h });
    this.brush = null;
    this.curPoints = [];
    this.scheduleAutoSave();
  }

  /**
   * 원격 스트로크를 친구 공용 레이어에 렌더(협동). History/Recorder에 안 쌓임 → 내 undo가
   * 남의 스트로크를 지우지 않음(DESIGN-REVIEW: 협동 undo = 자기 스트로크만).
   */
  applyRemoteStroke(
    meta: { brush: BrushId; color: RGB; size: number; opacity: number; water: number; symmetry: SymmetryMode },
    points: StrokePoint[],
    _userId: string,
  ): void {
    if (points.length === 0) return;
    const layer = this.remoteLayer();
    const brush = createBrush(meta.brush);
    // 원격 payload는 신뢰 불가 — 범위를 로컬 UI와 동일하게 클램프(음수 알파/거대 dab 방어)
    const settings: BrushSettings = {
      size: clamp(meta.size, 1, 128),
      opacity: clamp(meta.opacity, 0, 1),
      color: meta.color,
      waterAmount: clamp(meta.water, 0, 1),
      stabilize: 0,
    };
    const remoteWash = brush.cfg.strokeBlend === "wash";
    const remotePx = settings.size * brush.cfg.sizeScale;
    const ctx: StrokeContext = {
      layerCanvas: layer.canvas,
      tip: brush.cfg.tip === "bristle" && remotePx < 40 ? "bristle-bold" : brush.cfg.tip,
      composite: brush.cfg.composite,
      color: meta.color,
      paperGrain: brush.cfg.paperGrain,
      wash: remoteWash,
      strokeOpacity: remoteWash
        ? clamp(brush.cfg.washOpacity * (brush.cfg.opacityAsDilution ? 1 : meta.opacity), 0, 1)
        : 1,
      wetEdge: brush.cfg.wetEdge,
      impasto: brush.cfg.impasto,
      impastoShadow: brush.cfg.impastoShadow,
      washOver: brush.cfg.washOver,
      grainLift: brush.cfg.grainLift,
      streaks: brush.cfg.streaks,
      washCloud: brush.cfg.washCloud,
      edgeNoise: brush.cfg.edgeNoise,
      paperKind: this.paperKindForMode(),
    };
    this.cm.backend.beginStroke(ctx);
    let dabs = brush.begin(points[0], settings);
    for (let i = 1; i < points.length; i++) dabs = dabs.concat(brush.move(points[i]));
    dabs = dabs.concat(brush.end()); // rotationFollows 브러시의 보류 dab 회수
    this.cm.backend.drawDabs(dabs);
    this.cm.backend.endStroke();
    this.requestComposite();
    /* 친구 획도 캔버스의 일부다 — 예약하지 않으면 자동저장에 안 들어가서, 새로고침 후
     * [이어그리기]로 돌아오면 친구들 그림만 통째로 사라진다(2026-09-01 코드 점검). */
    this.scheduleAutoSave();
  }

  /*
   * 원격 스트로크는 **친구 전원이 한 레이어를 같이 쓴다**(예전엔 사람마다 한 장).
   *  · 성능: 합성은 보이는 레이어마다 전체 캔버스를 한 번씩 그린다 — 사람 수만큼 레이어가
   *    늘면 매 프레임 비용이 그대로 선형 증가했다(웨일북 협동 렉, 2026-08-25).
   *  · 정합: 레이어 상한(MAX_LAYERS=8)에 걸리면 addLayer가 null을 돌려주고 원격 획이
   *    **내 활성 레이어**로 떨어졌다 — 그러면 내 되돌리기가 친구 그림을 지운다.
   *    한 장만 쓰면 상한에 걸릴 일이 사실상 없다.
   * 사람별 분리가 필요 없는 이유: 원격 획은 History/Recorder에 안 쌓여 어차피 개별
   * 되돌리기 대상이 아니다(applyRemoteStroke 주석 참고).
   */
  private remoteLayerRef: Layer | null = null;
  private remoteLayer(): Layer {
    const cur = this.remoteLayerRef;
    // 사용자가 그 레이어를 지웠을 수도 있다 — 스택에 남아 있을 때만 재사용(고아 캔버스 방지)
    if (cur && this.layers.list.includes(cur)) return cur;
    const l = this.layers.addLayer("친구들 그림") ?? this.layers.active;
    this.remoteLayerRef = l;
    this.emitLayers();
    return l;
  }

  /** 더티 타일을 특정 레이어 캔버스에 되쓰는 커맨드 생성 */
  private pushTileCommand(
    layer: Layer,
    tiles: TileRect[],
    before: Uint8ClampedArray[],
    after: Uint8ClampedArray[],
  ): void {
    const blit = (ts: TileRect[], snaps: Uint8ClampedArray[]) => {
      ts.forEach((t, i) => {
        const img = new ImageData(snaps[i].slice(), t.w, t.h);
        layer.ctx.putImageData(img, t.x, t.y);
      });
      this.requestComposite();
      this.emitHistory();
    };
    this.history.push(new TileSnapshotCommand(tiles, before, after, blit));
    this.emitHistory();
  }

  /* ── 뚝딱그림(스케치 인식 → 스탬프 제안) ──
   * 연속된 그리기 스트로크를 공간 근접으로 묶고, 700ms 쉬면 $P 인식 후 후보를 emit.
   * 수락 = before 스냅샷 → 그룹 스트로크 k개 history.undo(스케치 픽셀 원복) → 스탬프
   * 그리기 → 커맨드 1개 push. push가 redo 스택(undo된 k개)을 폐기하므로 되돌리기
   * 1번에 "스탬프 ↔ 스케치"가 원자적으로 오간다.
   * 그룹 불변식: suggestStrokes는 항상 히스토리 스택 최상단 k개 커맨드와 1:1 —
   * 다른 종류의 push(fill·smudge·clear·QuickShape)나 undo/redo/레이어·모드 변경은 전부 리셋. */
  private suggestStrokes: { x: number; y: number }[][] = [];
  private suggestBBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  private suggestLayerId: string | null = null;
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;
  /** 그룹 상한 — 이보다 길면 채색/낙서로 보고 제안 중단 */
  private static readonly SUGGEST_MAX_STROKES = 12;
  private static readonly SUGGEST_DEBOUNCE_MS = 700;
  /** 그룹 합류 판정 여유(px) — 획끼리 이만큼 떨어져도 같은 그림으로 취급 */
  private static readonly SUGGEST_JOIN_PAD = 60;

  private resetSuggest(): void {
    if (this.suggestTimer) {
      clearTimeout(this.suggestTimer);
      this.suggestTimer = null;
    }
    if (this.suggestStrokes.length || this.suggestLayerId) {
      this.emit("suggestReady", { candidates: [] });
    }
    this.suggestStrokes = [];
    this.suggestLayerId = null;
    this.suggestBBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }

  /** finalizeStroke에서 호출(curPoints 소거 전) — bb = 이 획의 더티 bbox */
  private trackSuggest(
    quickShaped: boolean,
    bb: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const drawing =
      this.brushId !== "eraser" && this.brush?.cfg.composite !== "destination-out";
    if (
      !this.sketchSuggestEnabled ||
      this.suggestSuppressed || // 협동 방 — 치환이 원격에 전파 안 됨
      this.mode === "coloring" || // 색칠 중 제안은 소음
      this.symmetry !== "none" || // 데칼코마니: 미러 획까지 bbox에 잡혀 교체가 어긋난다
      quickShaped || // 이미 도형으로 스냅됨
      !drawing ||
      this.replaying
    ) {
      this.resetSuggest();
      return;
    }
    const layerId = this.layers.active.id;
    const joined =
      this.suggestStrokes.length > 0 &&
      this.suggestLayerId === layerId &&
      bb.minX - ArtEngine.SUGGEST_JOIN_PAD < this.suggestBBox.maxX &&
      bb.maxX + ArtEngine.SUGGEST_JOIN_PAD > this.suggestBBox.minX &&
      bb.minY - ArtEngine.SUGGEST_JOIN_PAD < this.suggestBBox.maxY &&
      bb.maxY + ArtEngine.SUGGEST_JOIN_PAD > this.suggestBBox.minY;
    if (!joined) this.resetSuggest();
    // 멀리서 새 획 = 새 그림의 시작(리셋 후 곧바로 새 그룹)
    const step = Math.max(1, Math.ceil(this.curPoints.length / 128));
    this.suggestStrokes.push(
      this.curPoints.filter((_, i) => i % step === 0).map((p) => ({ x: p.x, y: p.y })),
    );
    this.suggestLayerId = layerId;
    this.suggestBBox.minX = Math.min(this.suggestBBox.minX, bb.minX);
    this.suggestBBox.minY = Math.min(this.suggestBBox.minY, bb.minY);
    this.suggestBBox.maxX = Math.max(this.suggestBBox.maxX, bb.maxX);
    this.suggestBBox.maxY = Math.max(this.suggestBBox.maxY, bb.maxY);
    if (this.suggestStrokes.length > ArtEngine.SUGGEST_MAX_STROKES) {
      this.resetSuggest();
      return;
    }
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    this.suggestTimer = setTimeout(() => {
      this.suggestTimer = null;
      const candidates = recognizeSketch(this.suggestStrokes);
      this.emit("suggestReady", { candidates });
    }, ArtEngine.SUGGEST_DEBOUNCE_MS);
  }

  /** 제안 수락 — 스케치 자리에 스탬프를 "떠 있는" 상태로 띄운다(이동/크기조절 후 확인 시 굳힘) */
  acceptSuggestion(stampId: string): void {
    if (this.brush || this.smudging || this.replaying) return; // 획 진행 중 금지
    const k = this.suggestStrokes.length;
    const def = getStamp(stampId);
    if (!k || !def || this.layers.active.id !== this.suggestLayerId) {
      this.resetSuggest();
      return;
    }
    const bb = this.suggestBBox;
    const cx = clamp((bb.minX + bb.maxX) / 2, 0, this.width);
    const cy = clamp((bb.minY + bb.maxY) / 2, 0, this.height);
    const size = clamp(
      (bb.maxX - bb.minX + (bb.maxY - bb.minY)) / 2,
      ArtEngine.PENDING_MIN_SIZE,
      Math.min(this.width, this.height),
    );
    const origin = { ...bb };
    const layerId = this.layers.active.id;
    this.resetSuggest(); // 제안 바 닫기(커밋은 history 최상단 k개를 지우므로 tracking 불필요)
    this.beginPendingStamp(stampId, cx, cy, size, { replaceCount: k, layerId, originBBox: origin });
  }

  dismissSuggestion(): void {
    this.resetSuggest();
  }

  /* ── 떠 있는 스탬프 배치 ── */
  private static readonly PENDING_MIN_SIZE = 40;
  /** 모서리 핸들 히트 반경(화면 px — view.scale로 나눠 캔버스 좌표로) */
  private static readonly PENDING_HANDLE_HIT = 24;

  /** 스탬프를 떠 있는 상태로 띄운다(제안 수락·팔레트 공통). 색칠 잠금 레이어면 무시. */
  beginPendingStamp(
    stampId: string,
    cx: number,
    cy: number,
    size: number,
    opts?: {
      replaceCount?: number;
      layerId?: string;
      originBBox?: { minX: number; minY: number; maxX: number; maxY: number } | null;
    },
  ): void {
    const def = getStamp(stampId);
    if (!def || this.replaying) return;
    const active = this.layers.active;
    const layerId = opts?.layerId ?? active.id;
    this.pending = {
      kind: "stamp",
      stampId,
      aspect: 1,
      cx: clamp(cx, 0, this.width),
      cy: clamp(cy, 0, this.height),
      size: clamp(size, ArtEngine.PENDING_MIN_SIZE, Math.min(this.width, this.height)),
      replaceCount: opts?.replaceCount ?? 0,
      layerId,
      originBBox: opts?.originBBox ?? null,
    };
    this.pendingDrag = null;
    this.emit("pendingChange", { pending: { stampId, label: def.label } });
    this.requestComposite();
  }

  /*
   * 글씨 넣기 — 스탬프와 같은 "떠 있는 배치"로 띄운다(끌어서 옮기고 모서리로 크기 조절 → ✓).
   * 색은 현재 팔레트 색, 글꼴은 UI가 준 실제 패밀리명. 글꼴이 로드된 뒤 폭을 재야
   * 상자 비율이 맞는다(폴백 글꼴로 재면 커밋 때 글자가 상자를 벗어난다).
   */
  async insertText(value: string, family: string, outline?: TextItem["outline"]): Promise<void> {
    const text = value.trim();
    if (!text || this.replaying) return;
    const item: TextItem = { value: text, family, outline: outline ?? null };
    const size = Math.round(this.height * 0.14);
    await ensureFontReady(item, size);
    const ctx = this.previewScratchCtx();
    const aspect = textAspect(ctx, item, size);
    // 캔버스보다 넓으면(긴 문장) 폭에 맞춰 줄인다
    const maxSize = Math.min(this.height * 0.6, (this.width * 0.92) / Math.max(aspect, 0.01));
    const fit = clamp(size, ArtEngine.PENDING_MIN_SIZE, Math.max(ArtEngine.PENDING_MIN_SIZE, maxSize));
    this.pending = {
      kind: "text",
      stampId: "text",
      text: item,
      aspect,
      cx: this.width / 2,
      cy: this.height / 2,
      size: fit,
      replaceCount: 0,
      layerId: this.layers.active.id,
      originBBox: null,
    };
    this.pendingDrag = null;
    this.emit("pendingChange", { pending: { stampId: "text", label: "글씨" } });
    this.requestComposite();
  }

  /** 떠 있는 스탬프 존재 여부 */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** 팔레트에서 스탬프 선택 — 캔버스 중앙에 기본 크기로 띄운다(이동/크기조절 후 확인) */
  insertStamp(stampId: string): void {
    const size = Math.round(Math.min(this.width, this.height) * 0.28);
    this.beginPendingStamp(stampId, this.width / 2, this.height / 2, size);
  }

  private pendingPointerDown(p: StrokePoint): void {
    const pd = this.pending;
    if (!pd) return;
    const mode = hitPending(p.x, p.y, pd, this.view.scale, ArtEngine.PENDING_HANDLE_HIT);
    if (!mode) return; // 바깥 탭은 무시(실수 배치·취소 방지)
    this.pendingDrag = { mode, px: p.x, py: p.y, cx0: pd.cx, cy0: pd.cy, size0: pd.size };
  }

  private pendingPointerMove(p: StrokePoint): void {
    const pd = this.pending;
    const dr = this.pendingDrag;
    if (!pd || !dr) return;
    if (dr.mode === "move") {
      const m = movePending(dr.cx0, dr.cy0, dr.px, dr.py, p.x, p.y, this.width, this.height);
      pd.cx = m.cx;
      pd.cy = m.cy;
    } else {
      // 글씨는 가로로 길다 — 세로 크기(size)를 키우되 가로 드래그도 비율로 환산해 반영
      const maxSize =
        pd.kind === "text"
          ? Math.min(this.height, this.width / Math.max(pd.aspect, 0.01))
          : Math.min(this.width, this.height);
      pd.size = resizePending(
        pd.cx,
        pd.cy,
        p.x,
        p.y,
        ArtEngine.PENDING_MIN_SIZE,
        maxSize,
        pd.aspect,
      );
    }
    this.requestComposite();
  }

  /** 확인 — 떠 있는 스탬프를 실제 레이어에 굳힘(되돌리기 1번에 복귀). 제안 수락이면 스케치도 교체. */
  commitPendingStamp(): void {
    const pd = this.pending;
    if (!pd) return;
    const def = pd.kind === "stamp" ? getStamp(pd.stampId) : null;
    const layer =
      this.layers.list.find((l) => l.id === pd.layerId && !l.isLineart && !l.isBase) ??
      (!this.layers.active.isLineart && !this.layers.active.isBase ? this.layers.active : null);
    if ((pd.kind === "stamp" && !def) || !layer) {
      this.cancelPendingStamp();
      return;
    }
    const { cx, cy, size } = pd;
    // tile 영역 = (옮겨진)스탬프·글씨 bbox ∪ 원래 스케치 bbox + 외곽선 여유
    const { x, y, w, h } = commitRegion(
      cx,
      cy,
      size,
      pd.originBBox,
      this.width,
      this.height,
      12,
      pd.aspect,
    );
    if (w <= 0 || h <= 0) {
      this.cancelPendingStamp();
      return;
    }
    const tiles = tilesForRect(x, y, w, h, this.width, this.height);
    const before = copyTiles(
      layer.ctx.getImageData(0, 0, this.width, this.height).data,
      this.width,
      tiles,
    );
    // 제안 수락이면 스케치 획 k개를 되돌려 지운다(그룹 불변식: 최상단 k개 = 이 스케치).
    // 실제 성공 횟수를 세서 로그도 같은 수만 지운다 — 히스토리가 자체 축출(50개/메모리
    // 예산)로 조기 소진되면 replaceCount 고정 삭제가 무관한 이전 획까지 지운다(교차검증).
    let undone = 0;
    for (let i = 0; i < pd.replaceCount; i++) {
      if (!this.history.undo()) break;
      undone++;
    }
    if (pd.kind === "text" && pd.text) drawTextOnCtx(layer.ctx, pd.text, cx, cy, size, this.settings.color);
    else if (def) drawStampOnCtx(layer.ctx, def, cx, cy, size, this.settings.color);
    const after = copyTiles(
      layer.ctx.getImageData(0, 0, this.width, this.height).data,
      this.width,
      tiles,
    );
    this.pushTileCommand(layer, tiles, before, after);
    // 무비 재생 정합 — 교체된 스케치 획은 로그에서도 제거.
    // ⚠️ 잠복 한계(수용): 이 커밋을 undo하면 캔버스엔 스케치가 복귀하지만 로그에선
    // 이미 지워져 무비에 안 나온다 — 정확 수정은 히스토리-로그 완전 연동이 필요해 보류.
    this.recorder.dropLast(undone);
    this.recorder.record({
      brush: pd.kind === "text" ? "text" : "stamp",
      settings: { ...this.settings },
      layerId: layer.id,
      points: [{ x: cx, y: cy, pressure: 1, t: performance.now() }],
      symmetry: "none",
      extra:
        pd.kind === "text" && pd.text
          ? {
              text: {
                value: pd.text.value,
                family: pd.text.family,
                outline: pd.text.outline ?? null,
                cx,
                cy,
                size,
              },
            }
          : { stamp: { id: pd.stampId, cx, cy, size } },
    });
    this.pending = null;
    this.pendingDrag = null;
    this.emit("pendingChange", { pending: null });
    this.requestComposite();
    this.scheduleAutoSave();
  }

  /** 취소 — 레이어를 건드리지 않아 원래 스케치가 그대로 남는다 */
  cancelPendingStamp(): void {
    if (!this.pending) return;
    this.pending = null;
    this.pendingDrag = null;
    this.emit("pendingChange", { pending: null });
    this.requestComposite();
  }

  /* ── 도형 삽입 커밋 — 드래그 영역의 도형을 "합성 스트로크"로 그린다 ──
   * 실제 브러시 파이프라인(begin/move/end → finalizeStroke)을 그대로 타므로
   * undo·무비 기록·협동 전송·대칭(paintDabs가 미러)·자동저장이 일반 획과 동일. */
  private commitShapeInsert(d: { x0: number; y0: number; x1: number; y1: number }): void {
    const kind = this.shapeInsertKind;
    if (
      !kind ||
      this.brush ||
      this.smudging ||
      // 톡 친 것 — 판정은 화면 px 기준(확대 상태의 작은 도형이 무시되던 버그, ShapeInsert 참조)
      isShapeDragTooSmall(d.x1 - d.x0, d.y1 - d.y0, this.view.scale)
    ) {
      this.requestComposite();
      return;
    }
    const path = densifyShape(shapeInsertPoints(kind, d.x0, d.y0, d.x1, d.y1), 3);
    if (path.length < 2) return;
    const t0 = performance.now();
    const pts: StrokePoint[] = path.map((q, i) => ({
      x: q.x,
      y: q.y,
      pressure: 0.85,
      t: t0 + i * 3,
    }));
    this.brush = createBrush(this.brushId);
    this.quickShapeApplied = false;
    this.curPoints = [pts[0]];
    this.strokeStartTs = t0;
    this.firstDabLatency = -1;
    this.strokeBBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    // strokeBegin과 동일한 undo before 규칙(지우개류는 레이어 직접 편집이라 선캡처)
    // 지우개(destination-out)는 레이어를 직접 지운다 → 닿는 타일만 copy-on-write로 보존
    this.cow = this.brush.cfg.composite === "destination-out" ? new Map() : null;
    this.cm.backend.beginStroke(this.brushContext());
    this.paintDabs(this.brush.begin(pts[0], this.settings), pts[0]);
    for (let i = 1; i < pts.length; i++) {
      this.curPoints.push(pts[i]);
      this.paintDabs(this.brush.move(pts[i]), pts[i]);
    }
    this.paintDabs(this.brush.end(), pts[pts.length - 1]);
    if (!this.beforeFull) this.beforeFull = this.snapshotActiveLayer();
    this.cm.backend.endStroke();
    this.finalizeStroke(false);
    // 반듯한 도형은 뚝딱그림 대상이 아니다 — finalize의 trackSuggest 그룹을 즉시 해제
    this.resetSuggest();
  }

  /* ── QuickShape 홀드 ── */
  private armQuickShapeHold(): void {
    if (!this.quickShapeEnabled) return;
    this.clearHold();
    this.holdTimer = setTimeout(() => {
      const shape = detectShape(this.curPoints);
      if (shape && this.brush) {
        this.applyQuickShape(shape.kind, shape.points);
      }
    }, QUICKSHAPE_HOLD_MS);
  }
  private clearHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private quickShapeApplied = false;
  /** QuickShape 스냅 폴리라인 — finalizeStroke에서 무비 로그로 소비 */
  private quickShapePts: StrokePoint[] | null = null;

  private applyQuickShape(kind: QuickShapeKind, points: { x: number; y: number }[]): void {
    // 지우개(destination-out)는 레이어에 직접 그려 프리핸드 취소가 불가 + 색선 도형이
    // 나가면 안 됨 — QuickShape 미적용
    if (this.brush?.cfg.composite === "destination-out") return;
    // 레이어에 직접 그리기 전에 undo용 before 확보(홀드 타이머로 스트로크 중간에도 옴)
    if (!this.beforeFull) this.beforeFull = this.snapshotActiveLayer();
    // 도형이 프리핸드를 대체 — 진행 중이던 스트로크 버퍼는 폐기(합성 금지)
    this.cm.backend.cancelStroke();
    const ctx = this.layers.active.ctx;
    // 대칭(데칼코마니) 복제: 프리핸드 dab처럼 도형 폴리라인도 축마다 그린다
    const variants =
      this.symmetry === "none"
        ? [points]
        : (() => {
            const per = points.map((p) =>
              mirrorPoint({ x: p.x, y: p.y, pressure: 1, t: 0 }, this.symmetry, this.axis().x, this.axis().y),
            );
            return per[0].map((_, k) => per.map((mp) => mp[k]));
          })();
    ctx.save();
    ctx.strokeStyle = `rgb(${this.settings.color.r},${this.settings.color.g},${this.settings.color.b})`;
    ctx.globalAlpha = this.settings.opacity;
    ctx.lineWidth = this.settings.size;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const poly of variants) {
      ctx.beginPath();
      poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      for (const p of poly) this.trackDirty(p.x, p.y, this.settings.size);
    }
    ctx.restore();
    this.quickShapeApplied = true;
    // 무비 로그용 스냅 폴리라인 보관 — 기록 자체는 finalizeStroke(히스토리 push와 같은
    // 지점)에서 한다. 여기서 기록하면 핀치 취소(strokeCancel: push 없음) 시 1:1이 깨진다.
    const qt0 = performance.now();
    this.quickShapePts = points.map((q, i) => ({ x: q.x, y: q.y, pressure: 1, t: qt0 + i }));
    this.clearHold();
    this.emit("quickShapeApplied", { kind });
    this.requestComposite();
  }

  /* ── 페인트통 ── */
  private doFill(p: StrokePoint): void {
    const layer = this.layers.active;
    const img = layer.ctx.getImageData(0, 0, this.width, this.height);
    let barrier: Uint8Array | null = null;
    const lineart = this.layers.lineart;
    // 도안이 있으면 모드와 무관하게 선을 벽으로 — 색칠 도안을 열고 스케치/유화 탭으로
    // 전환해도 페인트통이 선을 넘으면 안 된다(mode==="coloring" 조건이던 실측 버그)
    if (lineart) {
      const la = lineart.ctx.getImageData(0, 0, this.width, this.height);
      barrier = buildBarrierFromLineart(la.data, this.width, this.height);
    }
    // before 스냅샷(전체 → 타일)
    const beforeFull = new Uint8ClampedArray(img.data);
    const res = floodFill(img.data, this.width, this.height, p.x, p.y, this.settings.color, {
      tolerance: 32,
      barrier,
    });
    if (!res.changed || !res.dirty) return; // 픽셀 무변경 — 제안 그룹도 건드리지 않는다
    this.resetSuggest(); // fill이 히스토리에 push되기 전 — 그룹 불변식 유지
    layer.ctx.putImageData(img, 0, 0);

    const tiles = tilesForRect(res.dirty.x, res.dirty.y, res.dirty.w, res.dirty.h, this.width, this.height);
    const after = copyTiles(img.data, this.width, tiles);
    const before = copyTiles(beforeFull, this.width, tiles);
    this.pushTileCommand(layer, tiles, before, after);
    this.emit("colorUsed", { color: this.settings.color });
    this.recorder.record({
      brush: "fill",
      settings: { ...this.settings },
      layerId: layer.id,
      points: [p],
      symmetry: "none",
      extra: { fill: true },
    });
    this.requestComposite();
    this.scheduleAutoSave();
  }

  /* ── 히스토리 ── */
  undo(): void {
    if (this.pending) {
      this.cancelPendingStamp(); // 배치 중 되돌리기 = 배치 취소(레이어 무변경)
      return;
    }
    this.resetSuggest(); // 그룹↔히스토리 최상단 k개 대응이 깨진다
    if (this.history.undo()) {
      this.recorder.undo(); // 무비 로그 정합 — 되돌린 획은 재생에서도 제외
      this.requestComposite();
      /* 되돌리기도 그림이 바뀐 것이다 — 예약하지 않으면 자동저장은 **되돌리기 전** 상태에
       * 머문다. 획 하나 긋고 되돌린 뒤 탭을 닫으면(또는 화면이 꺼지면) 돌아왔을 때
       * [이어그리기]가 지운 획을 되살려 준다(2026-09-01 코드 점검에서 발견).
       * ⚠️ emitHistory(UI 알림)보다 **먼저** 예약한다 — 구독자 예외가 저장 예약을 삼키면
       * 같은 결함이 조용히 돌아온다(교차검증 지적). */
      this.scheduleAutoSave();
      this.emitHistory();
    }
  }
  redo(): void {
    if (this.pending) return; // 배치 중엔 redo 무시
    this.resetSuggest();
    if (this.history.redo()) {
      this.recorder.redo();
      this.requestComposite();
      this.scheduleAutoSave(); // undo와 같은 이유(알림보다 먼저)
      this.emitHistory();
    }
  }

  clearActiveLayer(): void {
    this.cancelPendingStamp();
    this.resetSuggest(); // clear도 히스토리 push — 그룹 불변식 유지
    const layer = this.layers.active;
    const beforeFull = new Uint8ClampedArray(
      layer.ctx.getImageData(0, 0, this.width, this.height).data,
    );
    const tiles = tilesForRect(0, 0, this.width, this.height, this.width, this.height);
    const before = copyTiles(beforeFull, this.width, tiles);
    this.layers.clearActive();
    const after = copyTiles(
      layer.ctx.getImageData(0, 0, this.width, this.height).data,
      this.width,
      tiles,
    );
    this.pushTileCommand(layer, tiles, before, after);
    // 무비 로그 정합 — clear도 히스토리 1커맨드 = 로그 1항목(언두 커서 1:1 불변식)
    this.recorder.record({
      brush: "fill",
      settings: { ...this.settings },
      layerId: layer.id,
      points: [{ x: 0, y: 0, pressure: 1, t: performance.now() }],
      symmetry: "none",
      extra: { clear: true },
    });
    this.requestComposite();
    this.scheduleAutoSave(); // 지운 상태도 저장돼야 한다(undo와 같은 이유)
  }

  /** 새 그림: 그리기 레이어를 1장으로 줄여 비우고 히스토리·기록·자동저장 초기화(도안·원본은 유지) */
  newDrawing(): void {
    this.resetSuggest();
    const drawables = this.layers.info.filter((l) => !l.isLineart && !l.isBase);
    for (const l of drawables.slice(1)) this.layers.removeLayer(l.id);
    const first = this.layers.info.find((l) => !l.isLineart && !l.isBase);
    if (first) {
      this.layers.setActive(first.id);
      this.layers.setVisible(first.id, true);
      this.layers.setOpacity(first.id, 1);
      this.layers.clearActive();
    }
    this.history.clear();
    this.recorder.clear();
    this.autosave.cancel(); // 예약을 먼저 버린다 — purge 뒤에 발화하면 지운 상태가 되살아난다
    void this.autosave.purge();
    this.emitLayers();
    this.emitHistory();
    this.requestComposite();
  }

  /* ── 레이어 API(UI가 호출) ── */
  addLayer(): void {
    if (this.layers.addLayer()) {
      this.resetSuggest(); // 활성 레이어가 새 레이어로 바뀐다 — 명시적 리셋
      this.emitLayers();
    }
  }
  /**
   * 레이어 삭제 — 되돌리기 가능.
   * 예전엔 히스토리에 안 남겨서 ① 그림이 영영 사라지고 ② 그 레이어에 그렸던 획들의
   * 커맨드가 화면에 없는 캔버스를 되돌리느라 "되돌리기를 눌러도 아무 일이 없다가
   * 남의 레이어 획이 사라지는" 상태가 됐다(2026-07-25 실측). 삭제한 레이어 객체를
   * 커맨드가 붙들고 있다가 원래 자리에 그대로 꽂는다.
   */
  removeLayer(id: string): void {
    const idx = this.layers.indexOf(id);
    const layer = this.layers.get(id);
    if (idx < 0 || !layer) return;
    const prevActive = this.layers.activeId;
    if (!this.layers.removeLayer(id)) return;
    const nextActive = this.layers.activeId;
    this.resetSuggest();

    let removed = true;
    const sync = () => {
      this.emitLayers();
      this.requestComposite();
      this.emitHistory();
    };
    this.history.push({
      cost: this.width * this.height * 4,
      apply: () => {
        this.layers.removeLayer(id);
        this.layers.setActive(nextActive);
        removed = true;
        sync();
      },
      revert: () => {
        this.layers.insertAt(layer, idx);
        this.layers.setActive(prevActive);
        removed = false;
        sync();
      },
      // 히스토리 예산에서 밀려날 때만 픽셀을 놓는다. 되돌려서 살아 있는 레이어라면
      // 절대 건드리면 안 된다(redo 스택 폐기 시에도 dispose가 불린다).
      dispose: () => {
        if (!removed) return;
        layer.canvas.width = 0;
        layer.canvas.height = 0;
      },
    });
    // 무비 로그 정합 — 히스토리 1커맨드 = 로그 1항목(언두 커서 1:1 불변식).
    // 재생 캔버스는 레이어가 없는 단일 합성이라 그리는 건 없다.
    this.recorder.record({
      brush: "fill",
      settings: { ...this.settings },
      layerId: id,
      points: [{ x: 0, y: 0, pressure: 1, t: performance.now() }],
      symmetry: "none",
      extra: { layerDelete: true },
    });
    sync();
    this.scheduleAutoSave();
  }
  /** 레이어 순서 바꾸기 — toIndex는 아래(0)부터 센 위치. 잠금 레이어(도안·원본)는 못 움직인다 */
  reorderLayer(id: string, toIndex: number): void {
    this.layers.reorder(id, toIndex);
    this.emitLayers();
    this.requestComposite();
    this.scheduleAutoSave();
  }
  setActiveLayer(id: string): void {
    this.resetSuggest(); // 그룹은 단일 레이어 전제
    this.layers.setActive(id);
    this.emitLayers();
  }
  setLayerVisible(id: string, v: boolean): void {
    this.layers.setVisible(id, v);
    this.emitLayers();
    this.requestComposite();
  }
  setLayerOpacity(id: string, o: number): void {
    this.layers.setOpacity(id, o);
    this.emitLayers(); // 스토어 미러 갱신 — 컨트롤드 슬라이더가 따라오도록
    this.requestComposite();
  }
  setLayerBlend(id: string, b: LayerInfo["blend"]): void {
    this.layers.setBlend(id, b);
    this.emitLayers();
    this.requestComposite();
  }

  /** 색칠 모드: 라인아트 이미지를 잠금 레이어로 로드 */
  async loadLineart(src: string): Promise<void> {
    const img = await loadImage(src);
    let la = this.layers.lineart;
    if (!la) la = this.layers.addLayer("도안", true)!;
    la.ctx.clearRect(0, 0, this.width, this.height);
    // 비율 유지 중앙 배치
    const scale = Math.min(this.width / img.width, this.height / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    la.ctx.drawImage(img, (this.width - dw) / 2, (this.height - dh) / 2, dw, dh);
    this.emitLayers();
    this.requestComposite();
  }

  /**
   * 이미지를 잠금 원본 레이어(최하단)에 깔기 — "그대로 이어 그리기"(내 작업 이어서).
   * 그리기 레이어에 깔면 지우개가 원본(도안 포함)까지 뚫어버린다(실사용 보고 2026-07-07)
   * — 원본은 별도 잠금 레이어, 이번 세션 획만 그리기 레이어에.
   */
  async loadBaseImage(src: string): Promise<void> {
    const img = await loadImage(src);
    const layer = this.layers.addBase();
    layer.ctx.clearRect(0, 0, this.width, this.height);
    const scale = Math.min(this.width / img.width, this.height / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    layer.ctx.drawImage(img, (this.width - dw) / 2, (this.height - dh) / 2, dw, dh);
    this.emitLayers();
    this.requestComposite();
    // 여기서 scheduleAutoSave 금지 — 재진입 직후 초기 로드가 이전 저장본(복구 배너 대상)을
    // 원본만 있는 상태로 덮어쓴다. 저장은 사용자의 실제 획(endStroke 등)부터.
  }

  /* ── 렌더 루프 ── */
  private requestComposite(): void {
    this.needsComposite = true;
  }
  /* 그리기 경로의 예외 방화벽 — 한 번의 실패가 엔진을 영구히 죽이지 않게 한다.
   * 실패하면 진행 중이던 획만 버리고(반쯤 열린 브러시 상태 정리) 계속 살아 있는다. */
  private guard(where: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[ArtEngine] ${where} 실패 — 획을 버리고 계속합니다`, err);
      try {
        this.brush = null;
        this.smudging = false;
        this.curPoints = [];
        this.cow = null;
        this.beforeTiles = null;
        this.cm.backend.endStroke();
      } catch {
        /* 정리 중 오류는 무시 */
      }
      this.requestComposite();
    }
  }

  private startLoop(): void {
    const loop = (ts: number) => {
      /* ⚠️ rAF 재예약은 무슨 일이 있어도 실행돼야 한다. 예전엔 합성 중 예외가 나면 이 줄에
       * 도달하지 못해 렌더 루프가 영영 멈췄다 = 화면이 굳고 선이 안 나온다(브라우저를 껐다
       * 켜야 회복 — 웨일북 실사용 증상과 일치). 이제 예외를 삼키고 다음 프레임을 예약한다. */
      try {
        /* ⚠️ dt는 rAF 인자(ts)가 아니라 performance.now()로 잰다 — 렉으로 밀린 프레임을
         * 브라우저가 따라잡을 때 rAF 타임스탬프는 몇 ms 간격으로 촘촘히 찍혀(실측 3~5ms),
         * 벽시계 500ms 렉이 dt에 전혀 나타나지 않는다. 수채 마름 시뮬(tick)도 실제 경과
         * 시간을 받는 쪽이 정확하다. */
        void ts;
        const nowMs = performance.now();
        const dt = this.lastTick ? nowMs - this.lastTick : 16;
        this.lastTick = nowMs;
        /* 렉 감지는 "합성에 걸린 JS 시간"이 아니라 "획 중 rAF 간격"으로 —
         * Canvas2D 명령은 비동기 큐잉이라 JS 측 합성 시간이 실제 래스터 비용을 반영하지
         * 못하고(에어브러시 렉 471ms인데 측정 4ms — 2026-07-23 실측), 렉 gap은 합성을
         * 건너뛴 프레임에 흡수되는 런도 있어 합성 프레임의 dt만 봐서도 놓친다.
         * 획 진행 중(this.brush)의 rAF는 매끄러워야 정상이므로 120ms+ gap 자체가 부하 신호.
         * ⚠️ gap은 EMA가 아니라 "1.2초 창 3회" 패스트패스에만 태운다 — EMA에 넣으면 획 중
         * 탭 전환·기기 슬립 복귀의 단발 gap 하나(×0.15=수십 ms)로도 임계(10ms)를 넘어
         * 정상 기기가 오강등된다(교차검증 발견). 진짜 렉은 gap이 연달아 오므로 창 안 3회로
         * 충분히 빠르게(~1.5초) 잡힌다. */
        if (this.brush && dt > 120) this.trackLagGap(dt);
        // 수채/유화 시간 진행 시뮬
        const changed = this.cm.backend.tick(dt);
        if (changed) this.needsComposite = true;
        if (this.needsComposite) {
          const t0 = performance.now();
          this.compositeNow();
          this.needsComposite = false;
          // JS 측 합성 시간(grain 등 동기화 지점이 있는 브러시에서 유효한 신호).
          // 큐잉으로 이 값이 안 잡히는 브러시는 위의 rAF gap 신호가 렉을 잡는다.
          this.trackCompositeCost(performance.now() - t0);
        }
      } catch (err) {
        this.loopErrors++;
        if (this.loopErrors <= 3) console.error("[ArtEngine] 렌더 루프 오류(계속 진행)", err);
        this.needsComposite = false; // 같은 프레임을 무한 재시도하지 않는다
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
  private loopErrors = 0;

  /* 합성 비용 감시 — 느린 기기(웨일북)에서 표시 백킹을 자동으로 낮춰 렉을 끊는다.
   * 기기 사양 감지(deviceMemory·코어)가 빗나가도(예: 8GB인데 GPU가 약함) 여기서 잡힌다. */
  private compositeEma = 0;
  private compositeSamples = 0;
  private trackCompositeCost(ms: number): void {
    this.compositeEma += (ms - this.compositeEma) * 0.15;
    if (++this.compositeSamples < 20) return; // 워밍업(첫 합성·셰이더·폰트) 제외
    if (this.compositeEma > 10) this.downgradeDpr();
  }

  /** 명백한 렉 패스트패스: 획 중 120ms+ rAF gap이 슬라이딩 창(1.2초 또는 gap×4 중 큰 쪽) 안에 3개면 즉시 강등.
   * EMA 경로는 471ms급 렉에서도 워밍업 20샘플 = 강등까지 ~9초가 걸려 획 첫 9초가
   * 초당 2프레임인 채로 남는다(2026-07-23 실측 p90 484ms). "연속 3회" 대신 시간 창인
   * 이유 = 렉 gap과 정상 JS 샘플이 교대로 들어오면 연속 카운트가 영영 안 쌓인다(실측).
   * 창은 인접-샘플 체인이 아니라 진짜 슬라이딩(첫·셋째 gap 간격 기준) — 체인 방식은
   * 1.1초 간격 gap이 획 여러 개에 걸쳐 이어져도 발동해 획 시작 1회성 스파이크(레이어
   * 미러 캡처 등)가 3획 연속이면 오강등된다(교차검증 발견). 탭 전환·슬립 복귀의 단발
   * gap, 셰이더 컴파일 스파이크는 창 안 3개를 못 채운다. */
  private trackLagGap(dt: number): void {
    const now = performance.now();
    this.lagGaps.push({ t: now, dt });
    if (this.lagGaps.length > 3) this.lagGaps.shift();
    if (this.lagGaps.length < 3) return;
    /* ⚠️ 창은 gap 크기에 비례해야 한다. 고정 1.2초로 두면 gap이 600ms를 넘는 순간
     * 세 개가 창 안에 들어올 수가 없어(첫↔셋째 간격 ≥ 2×gap) **느릴수록 강등이 안 되는**
     * 사각지대가 생긴다 — 2026-07-25 실측: 프레임 간격 중앙값 778ms인데 백킹이 3072인 채
     * 획 3개가 끝났다(웨일북 실증상 471ms는 942ms라 아슬아슬하게 발동했던 것뿐).
     * 반대로 gap이 작을 때(130ms → 창 520ms)는 기존보다 엄격해져 단발 gap 오강등도 준다. */
    const maxDt = Math.max(this.lagGaps[0].dt, this.lagGaps[1].dt, this.lagGaps[2].dt);
    if (now - this.lagGaps[0].t < Math.max(1200, maxDt * 4)) this.downgradeDpr();
  }

  private downgradeDpr(): void {
    if (this.dprCap <= 1) return;
    this.dprCap = 1;
    this.fitDisplayDpr();
    // 카운터는 백킹이 실제로 바뀌었는지와 무관하게 리셋 — 안 그러면 EMA가 임계 위에 머문 채
    // 매 프레임 강등을 재시도한다(교차검증 지적)
    this.compositeEma = 0;
    this.compositeSamples = 0;
    this.lagGaps.length = 0;
  }

  /**
   * devicePixelRatio 변화 감시 — 브라우저 확대/축소(Ctrl +/-)나 다른 배율의 모니터로 창을
   * 옮기면 **CSS 크기는 그대로인데** 물리 픽셀만 바뀐다. ResizeObserver는 CSS 크기만 보므로
   * 이 경우를 놓친다(2026-07-29 교차검증에서 두 계열이 같이 지적).
   * matchMedia는 "현재 배율"에만 매칭되므로 발화할 때마다 새 배율로 다시 건다.
   * ⚠️ 렉으로 강등된 뒤(dprCap 1)에는 배율이 올라가도 복구하지 않는다 — 강등은 단방향이다.
   */
  private dprMql: MediaQueryList | null = null;
  private watchDpr(): void {
    if (typeof window === "undefined" || !window.matchMedia) return;
    this.dprMql?.removeEventListener?.("change", this.onDprChange);
    this.dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprMql.addEventListener?.("change", this.onDprChange);
  }
  private onDprChange = (): void => {
    this.fitDisplayDpr();
    this.watchDpr();
  };

  /** 표시 백킹 배율 상한(기기 사양 기준) — 렉이 감지되면 1로 내린다.
   * CanvasManager에 넘긴 초기값과 같은 출처를 쓴다(생성자에서 대입) */
  private dprCap = 1;
  private displayRo: ResizeObserver | null = null;
  /**
   * 표시 캔버스 백킹을 **화면이 실제로 가진 물리 픽셀**에 맞춘다.
   *
   * 예전엔 논리 캔버스 크기 × initialDpr(최대 2)를 그대로 백킹으로 썼다. 폰에서는
   * 캔버스 요소가 CSS 387px(물리 1160px)인데 백킹이 3072px이었다(2026-07-29 실측) —
   * ① 합성 비용은 백킹 **면적**에 비례하므로 필요량의 7배를 매 프레임 clear+blit+
   *    흰 배경 fill+종이결 multiply 했다(폰 렉의 큰 몫), ② 화면에 못 보여주는 해상도라
   *    선명도 이득은 0인데 브라우저가 2.65배로 되축소하면서 얇은 획을 갉아먹는다.
   * 물리 픽셀에 맞추면 둘 다 사라진다. 하한 1(논리 해상도 미만으로는 내리지 않는다 —
   * 그 아래는 그림 자체가 화면보다 커서 축소 표시되는 정상 상황이고, 백킹을 더 줄이면
   * 우리 쪽 축소 필터가 한 번 더 들어가 손해다).
   * 0.25 단위로 양자화 — 레이아웃이 1px 흔들릴 때마다 캔버스를 재할당하지 않게.
   *
   * ⚠️ 무한 리사이즈 루프가 안 나는 이유(백킹을 바꾸면 요소의 고유 크기가 바뀌므로
   * 보통은 위험하다): 표시 캔버스의 CSS 상한이 **논리 크기** 기준으로 고정돼 있고
   * (CanvasStage의 `max-width: min(100%, ${logicalW}px)`), 백킹은 논리 크기 미만으로
   * 내려가지 않으므로 레이아웃 폭은 언제나 min(컨테이너, 논리폭) — 백킹과 무관하다.
   * 즉 setDpr가 clientWidth를 바꾸지 못해 ResizeObserver가 자기 자신을 다시 부르지 않는다.
   */
  private fitDisplayDpr(): boolean {
    if (typeof window === "undefined") return false;
    const el = this.cm.display;
    const cssW = el.clientWidth || el.getBoundingClientRect().width;
    if (!cssW) return false;
    const want = clamp(
      Math.round(((cssW * (window.devicePixelRatio || 1)) / this.width) * 4) / 4,
      1,
      this.dprCap,
    );
    if (!this.cm.setDpr(want)) return false;
    this.requestComposite();
    return true;
  }
  /** 최근 120ms+ rAF gap의 시각·크기(최대 3개) — 슬라이딩 창 판정용 */
  private lagGaps: { t: number; dt: number }[] = [];

  private compositeNow(): void {
    const ctx = this.cm.displayCtx;
    const dpr = this.cm.dpr; // 표시 백킹 배율 — 이후 모든 그리기는 논리 좌표 그대로
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cm.display.width, this.cm.display.height);
    ctx.imageSmoothingQuality = "high"; // 줌 업스케일 보간 품질(계단 완화)
    ctx.setTransform(
      this.view.scale * dpr,
      0,
      0,
      this.view.scale * dpr,
      this.view.ox * dpr,
      this.view.oy * dpr,
    );
    // 진행 중 스트로크는 활성 레이어와 스크래치에서 먼저 합성해 정확히 프리뷰 —
    // 지우개가 아래 레이어를 뚫어 보이지 않고, 레이어 opacity/blend도 그대로 반영
    this.layers.composite(ctx, (c, layer) => {
      if (!this.brush) {
        c.drawImage(layer.canvas, 0, 0);
        return;
      }
      const s = this.previewScratchCtx();
      s.clearRect(0, 0, this.width, this.height);
      s.drawImage(layer.canvas, 0, 0);
      this.cm.backend.presentStroke(s);
      c.drawImage(s.canvas, 0, 0);
    });
    // 흰 종이는 맨 뒤(destination-over), 종이 결은 맨 위 multiply(표시 전용, 내보내기 미포함).
    // 결을 위에 곱해야 ① 도안(불투명 흰 배경)이 결을 덮지 않고 ② 물감 위로도
    // 캔버스 요철이 비쳐 "종이에 앉은" 질감이 난다(i-scream 방식).
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.width, this.height);
    const tintKind = this.paperTintKindForMode();
    if (!drawPaperRelief(ctx, this.width, this.height, tintKind, PAPER_RELIEF_STRENGTH)) {
      ctx.globalCompositeOperation = "multiply";
      drawPaperTint(ctx, this.width, this.height, tintKind);
    }
    ctx.globalCompositeOperation = "source-over";
    // 데칼코마니 가이드(표시 전용 — 내보내기·저장엔 미포함): 대칭축을 연한 점선으로.
    // 어느 선을 기준으로 접히는지 보여야 아이가 대칭을 이해하고 그린다(2026-07-09 요청).
    if (this.symmetry !== "none") {
      const a = this.axis();
      const k = 1 / this.view.scale; // 줌과 무관한 화면 px 환산
      const dragging = !!this.axisDrag;
      ctx.save();
      ctx.strokeStyle = dragging ? "rgba(91,184,245,0.9)" : "rgba(91,184,245,0.45)"; // sky 톤
      ctx.lineWidth = (dragging ? 3 : 2) * k;
      ctx.setLineDash([10 * k, 8 * k]);
      ctx.beginPath();
      const vert = this.symmetry === "vertical" || this.symmetry === "quad";
      const horz = this.symmetry === "horizontal" || this.symmetry === "quad";
      if (vert) {
        ctx.moveTo(a.x, 0);
        ctx.lineTo(a.x, this.height);
      }
      if (horz) {
        ctx.moveTo(0, a.y);
        ctx.lineTo(this.width, a.y);
      }
      ctx.stroke();
      // 드래그 핸들 — 축을 손가락으로 잡아 옮길 수 있다는 걸 보여준다(2026-07-13 요청).
      // 세로축만이면 선 중앙, 가로축만이면 선 중앙, 4방이면 교차점.
      ctx.setLineDash([]);
      const hx = vert ? a.x : this.width / 2;
      const hy = horz ? a.y : this.height / 2;
      ctx.beginPath();
      ctx.arc(hx, hy, (dragging ? 11 : 9) * k, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = "rgba(91,184,245,0.95)";
      ctx.stroke();
      // 핸들 안 이동 화살표(십자/좌우/상하)
      ctx.beginPath();
      const r = 4 * k;
      if (vert) {
        ctx.moveTo(hx - r, hy);
        ctx.lineTo(hx + r, hy);
      }
      if (horz) {
        ctx.moveTo(hx, hy - r);
        ctx.lineTo(hx, hy + r);
      }
      ctx.lineWidth = 1.6 * k;
      ctx.stroke();
      ctx.restore();
    }
    // 도형 삽입 미리보기(표시 전용) — 실제 커밋될 색·비슷한 굵기로, 대칭 복제 포함
    if (this.shapeDrag && this.shapeInsertKind) {
      const d = this.shapeDrag;
      const pts = shapeInsertPoints(this.shapeInsertKind, d.x0, d.y0, d.x1, d.y1);
      const variants =
        this.symmetry === "none"
          ? [pts]
          : (() => {
              const per = pts.map((p) =>
                mirrorPoint({ x: p.x, y: p.y, pressure: 1, t: 0 }, this.symmetry, this.axis().x, this.axis().y),
              );
              return per[0].map((_, k) => per.map((mp) => mp[k]));
            })();
      ctx.save();
      const c = this.settings.color;
      ctx.strokeStyle = `rgb(${c.r},${c.g},${c.b})`;
      ctx.globalAlpha = Math.min(1, this.settings.opacity) * 0.75;
      ctx.lineWidth = Math.max(2, this.settings.size);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const poly of variants) {
        ctx.beginPath();
        poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      }
      ctx.restore();
    }
    // 떠 있는 스탬프 프리뷰 + 선택 프레임 + 모서리 핸들(표시 전용 — 확인 시 굳힘).
    // 스탬프 자체는 drawStampOnCtx가 커밋과 동일하게 그리므로 프리뷰==최종.
    if (this.pending) {
      const pd = this.pending;
      const def = pd.kind === "stamp" ? getStamp(pd.stampId) : null;
      const drawable = pd.kind === "text" ? !!pd.text : !!def;
      if (drawable) {
        if (pd.kind === "text" && pd.text)
          drawTextOnCtx(ctx, pd.text, pd.cx, pd.cy, pd.size, this.settings.color);
        else if (def) drawStampOnCtx(ctx, def, pd.cx, pd.cy, pd.size, this.settings.color);
        const { hw, hh } = pendingHalf(pd);
        const s = this.view.scale;
        ctx.save();
        ctx.strokeStyle = "rgba(91,184,245,0.95)"; // sky
        ctx.lineWidth = 2 / s;
        ctx.setLineDash([6 / s, 5 / s]);
        ctx.strokeRect(pd.cx - hw, pd.cy - hh, hw * 2, hh * 2);
        ctx.setLineDash([]);
        const hr = 7 / s; // 화면상 ~7px 핸들
        for (const [hx, hy] of [
          [pd.cx - hw, pd.cy - hh],
          [pd.cx + hw, pd.cy - hh],
          [pd.cx + hw, pd.cy + hh],
          [pd.cx - hw, pd.cy + hh],
        ]) {
          ctx.beginPath();
          ctx.arc(hx, hy, hr, 0, Math.PI * 2);
          ctx.fillStyle = "#5BB8F5";
          ctx.fill();
          ctx.lineWidth = 2 / s;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.emit("dirty", {});
  }

  /* ── AutoSave ── */
  private scheduleAutoSave(): void {
    this.autosave.schedule(() => this.snapshotState());
  }
  /*
   * ⚠️ toDataURL(동기 PNG 인코딩 + base64 문자열)로 전 레이어를 굽던 것을 toBlob으로 교체.
   * 저사양 기기(웨일북)에서 레이어당 수백 ms 메인스레드 정지 → 5~15초마다 렉(2026-07-14
   * 사용자 보고). toBlob은 인코딩이 메인스레드를 막지 않고 base64 왕복(수 MB 문자열
   * 생성 → atob → Uint8Array)도 사라진다.
   */
  private async snapshotState(): Promise<SavedState> {
    const pngs = await Promise.all(this.layers.list.map((l) => canvasToPng(l.canvas)));
    return {
      savedAt: Date.now(),
      width: this.width,
      height: this.height,
      mode: this.mode,
      layers: this.layers.list.map((l, i) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        blend: l.blend,
        isLineart: l.isLineart,
        isBase: l.isBase,
        png: pngs[i],
      })),
      recorder: this.recorder.serialize(),
    };
  }
  async checkRestore(): Promise<number | null> {
    const state = await this.autosave.restore();
    if (state && Date.now() - state.savedAt < 1000 * 60 * 60 * 24) {
      this.emit("restoreAvailable", { savedAt: state.savedAt });
      return state.savedAt;
    }
    return null;
  }
  async restore(): Promise<boolean> {
    this.resetSuggest(); // 히스토리 없는 픽셀 대체 — 그룹 무효
    const state = await this.autosave.restore();
    if (!state) return false;
    // 구버전 저장분(width/height 없음) 폴백 — 픽셀 경로와 같은 소스(저장 PNG 실크기)
    let imgW = 0;
    let imgH = 0;
    for (const saved of state.layers) {
      // 역할(도안/원본)로 먼저 매칭 — 재마운트로 id가 바뀌어도 잠금 레이어가
      // 일반 레이어로 둔갑해 지우개에 뚫리는 사고 방지
      const layer = saved.isLineart
        ? (this.layers.lineart ?? this.layers.addLayer(saved.name, true))
        : saved.isBase
          ? this.layers.addBase(saved.name)
          : (this.layers.list.find((l) => l.id === saved.id && !l.isLineart && !l.isBase) ??
            this.layers.addLayer(saved.name));
      if (!layer) continue;
      const img = await blobToImage(saved.png);
      if (!imgW) {
        imgW = img.width;
        imgH = img.height;
      }
      layer.ctx.clearRect(0, 0, this.width, this.height);
      /*
       * 저장 당시 캔버스 크기 ≠ 지금 캔버스 크기일 수 있다 — 선따기는 원본 사진 비율로
       * 캔버스를 잡는데, 새로 들어오면(도안 파라미터 없음) 기본 비율로 마운트된다.
       * 1:1로 그리면 큰 그림의 좌상단만 보여 "확대된 상태"가 된다(2026-07-14 사용자 실측).
       * → 비율 유지 축소(contain) + 중앙 정렬. 크기가 같으면 리샘플 없이 그대로.
       */
      const sw = state.width || img.width;
      const sh = state.height || img.height;
      if (sw === this.width && sh === this.height) {
        layer.ctx.drawImage(img, 0, 0);
      } else {
        const k = Math.min(this.width / sw, this.height / sh);
        const dw = sw * k;
        const dh = sh * k;
        layer.ctx.drawImage(img, (this.width - dw) / 2, (this.height - dh) / 2, dw, dh);
      }
      this.layers.setVisible(layer.id, saved.visible);
      this.layers.setOpacity(layer.id, saved.opacity);
      this.layers.setBlend(layer.id, saved.blend as LayerInfo["blend"]);
    }
    // 복원 = 상태 통째 교체 — 복원 전 세션의 undo 커맨드가 남으면 undo 시 옛 타일이
    // 복원된 그림 위에 블릿돼 픽셀이 오염되고, 무비 언두 커서와도 어긋난다
    this.history.clear();
    this.emitHistory();
    this.recorder.load(state.recorder);
    // 저장 당시 크기 ≠ 지금 크기면 픽셀과 동일한 contain 배율·중앙 오프셋을 로그 좌표에도
    // 적용 — 안 하면 무비 획이 원좌표로 재생돼 엉뚱한 위치/화면 밖에 그려진다
    const rsw = state.width || imgW || this.width;
    const rsh = state.height || imgH || this.height;
    if (rsw > 0 && rsh > 0 && (rsw !== this.width || rsh !== this.height)) {
      const rk = Math.min(this.width / rsw, this.height / rsh);
      this.recorder.rescale(rk, (this.width - rsw * rk) / 2, (this.height - rsh * rk) / 2);
    }
    this.emitLayers();
    this.requestComposite();
    return true;
  }
  async discardRestore(): Promise<void> {
    await this.autosave.purge();
  }

  /* ── 무비/내보내기 ── */
  getRecorder(): StrokeRecorder {
    return this.recorder;
  }
  getLayers(): LayerStack {
    return this.layers;
  }
  /**
   * 잃을 그림이 있는가. 도안(라인아트)만 제외한다 — 도안은 다시 열면 되지만
   * "그대로 이어 그리기" 원본(isBase)은 아이가 가져온 그림이라 잃으면 끝이다.
   * "되돌릴 수 없이 그림을 지우는" 버튼(가로/세로 전환)이 확인을 물을지 판단하는 데 쓴다.
   * 히스토리 유무로 대신할 수 없다 — 자동저장 복원본은 그림은 있고 히스토리는 비어 있다.
   */
  hasArtwork(): boolean {
    for (const l of this.layers.list) {
      if (l.isLineart) continue;
      const d = l.ctx.getImageData(0, 0, this.width, this.height).data;
      // 전 픽셀 주사(작은 점 하나도 놓치지 않게) — 버튼 클릭 1회짜리라 비용은 무시할 수준
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
    }
    return false;
  }
  get usingWebGL2(): boolean {
    return this.cm.usingWebGL2;
  }

  private offRelief: () => void;

  destroy(): void {
    this.offRelief();
    cancelAnimationFrame(this.rafId);
    this.displayRo?.disconnect();
    this.displayRo = null;
    this.dprMql?.removeEventListener?.("change", this.onDprChange);
    this.dprMql = null;
    this.clearHold();
    if (this.suggestTimer) {
      clearTimeout(this.suggestTimer);
      this.suggestTimer = null;
    }
    this.pointer.destroy();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.flushAutoSave);
      window.removeEventListener("pagehide", this.flushAutoSave);
    }
    void this.autosave.flush(); // 재마운트(가로/세로 전환 등) 시점의 대기분도 보존
    this.autosave.destroy();
    this.cm.destroy();
    this.layers.destroy();
    this.history.clear();
    this.listeners.clear();
  }
}

/* ── 헬퍼 ── */

/*
 * 표시 캔버스 백킹 배율. 선명하지만 합성 비용은 dpr²에 비례한다 —
 * 매 프레임 백킹 해상도에서 clear + 레이어 blit + 흰 배경 fill + 종이결 multiply를 한다.
 * 저사양 기기(웨일북: 4GB RAM·4코어급)에서 DPR2면 프레임당 수백 ms까지 치솟아
 * "그리는 중 엄청난 렉"이 된다(2026-07-14 실측: 중앙값 471ms → dpr 1로 회복).
 * → 저사양은 처음부터 1, 나머지는 2를 상한으로 쓰되 느리면 런타임에 강등한다.
 */
function initialDpr(): number {
  if (typeof window === "undefined") return 1;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowEnd = (nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4;
  if (lowEnd) return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}
function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("blob 이미지 로드 실패"));
    };
    img.src = url;
  });
}
/** 레이어 → PNG Blob(비동기 인코딩). toBlob 미지원 환경은 toDataURL로 폴백 */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(dataURLToBlobSync(canvas.toDataURL("image/png")));
      return;
    }
    canvas.toBlob((b) => {
      resolve(b ?? dataURLToBlobSync(canvas.toDataURL("image/png")));
    }, "image/png");
  });
}

function dataURLToBlobSync(dataURL: string): Blob {
  const [head, body] = dataURL.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] ?? "image/png";
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** perfect-freehand 외곽선 → Path2D 문자열(대체 렌더용, 벡터 미리보기) */
export function strokeToPath(points: StrokePoint[], size: number, stabilize: number): string {
  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.pressure]),
    {
      size,
      thinning: 0.6,
      smoothing: 0.5,
      streamline: strengthToStreamline(stabilize),
      simulatePressure: false,
      last: true,
    },
  );
  if (!outline.length) return "";
  const d = outline.reduce(
    (acc, [x, y], i) => acc + (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`),
    "",
  );
  return d + " Z";
}
