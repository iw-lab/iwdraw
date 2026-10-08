"use client";

import { create } from "zustand";
import type { ArtEngine } from "@/engine/ArtEngine";
import { BRUSH_META, STROKE_BRUSHES } from "@/engine/brushes";
import type { ShapeInsertKind } from "@/engine/tools/ShapeInsert";
import type {
  BlendMode,
  BrushId,
  LayerInfo,
  Mode,
  RGB,
  SketchSuggestion,
  SymmetryMode,
} from "@/engine/types";

/*
 * 에디터 스토어: ArtEngine(비-React)과 UI를 잇는 브리지.
 * 엔진 이벤트를 구독해 UI 상태를 미러링하고, UI 액션은 엔진 메서드를 호출한다.
 */

export interface EditorState {
  engine: ArtEngine | null;
  ready: boolean;

  mode: Mode;
  brush: BrushId;
  color: RGB;
  recentColors: RGB[];
  /** 필압 반영(펜 실필압+속도 시뮬) — 웨일북처럼 필압이 안 오는 기기는 끄면 균일 획 */
  pressureOn: boolean;
  /** 스포이트 진입 전 붓 — 색 찍으면 자동 복귀 */
  prevBrush: BrushId | null;
  size: number;
  /** 그림 도구들이 공유하는 굵기(연필·마커·붓…) */
  drawSize: number;
  /** 도구별 굵기를 따로 기억하는 도구 — 지우개·번짐(2026-07-14 요청: 매번 다시 맞추기 불편) */
  sizeByTool: Partial<Record<BrushId, number>>;
  opacity: number;
  water: number;
  stabilize: number;
  symmetry: SymmetryMode;
  /** 도형 삽입 모드(드래그로 크기·위치 배치) — null이면 꺼짐 */
  shapeInsert: ShapeInsertKind | null;
  /** 뚝딱그림: 스케치 인식 → 스탬프 제안 */
  sketchSuggest: boolean;
  /** 협동 방 억제 — 치환이 원격에 전파 안 돼 캔버스가 갈라진다(토글보다 우선) */
  suggestSuppressed: boolean;
  /** 현재 떠 있는 제안 후보(빈 배열 = 바 숨김) */
  suggestions: SketchSuggestion[];
  /** 떠 있는(배치 중) 스탬프 — null이면 없음. 있으면 확인/취소 바 표시 */
  pending: { stampId: string; label: string } | null;
  /** 스탬프 팔레트 열림 여부 */
  stampPaletteOpen: boolean;
  /** 글씨 넣기 창 열림 여부 */
  textPaletteOpen: boolean;
  juniorMode: boolean;

  canUndo: boolean;
  canRedo: boolean;
  layers: LayerInfo[];
  activeLayerId: string;

  latencyMs: number;
  usingWebGL2: boolean;
  restoreAvailable: number | null;
  /** 핀치 줌 배율(1=원본) — 1 초과면 "화면 맞춤" 탈출 버튼 표시 */
  viewScale: number;

  // ── 바인딩 ──
  attach: (engine: ArtEngine) => void;
  detach: () => void;

  // ── 액션 ──
  setMode: (m: Mode) => void;
  setBrush: (b: BrushId) => void;
  setColor: (c: RGB) => void;
  togglePressure: () => void;
  setSize: (n: number) => void;
  setOpacity: (n: number) => void;
  setWater: (n: number) => void;
  setStabilize: (n: number) => void;
  setSymmetry: (m: SymmetryMode) => void;
  setShapeInsert: (k: ShapeInsertKind | null) => void;
  toggleSketchSuggest: () => void;
  setSuggestSuppressed: (on: boolean) => void;
  acceptSuggestion: (stampId: string) => void;
  dismissSuggestion: () => void;
  /** 떠 있는 스탬프 굳히기(확인) / 취소 */
  commitPending: () => void;
  cancelPending: () => void;
  /** 팔레트에서 스탬프 선택 → 떠 있는 상태로 삽입 */
  insertStamp: (stampId: string) => void;
  setStampPaletteOpen: (open: boolean) => void;
  /** 글씨를 캔버스 가운데에 떠 있는 상태로 넣는다(끌어서 옮기고 크기 조절 후 확인) */
  insertText: (value: string, fontFamily: string, outline?: { color: RGB; ratio: number } | null) => void;
  setTextPaletteOpen: (open: boolean) => void;
  toggleJunior: () => void;
  undo: () => void;
  redo: () => void;
  clearActive: () => void;
  newDrawing: () => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  /** 레이어 순서 바꾸기(아래=0) */
  reorderLayer: (id: string, toIndex: number) => void;
  setActiveLayer: (id: string) => void;
  setLayerVisible: (id: string, v: boolean) => void;
  setLayerOpacity: (id: string, o: number) => void;
  setLayerBlend: (id: string, b: BlendMode) => void;
  dismissRestore: () => void;
  resetView: () => void;
}

let unsub: Array<() => void> = [];

const DEFAULT_PALETTE_INK: RGB = { r: 45, g: 42, b: 38 };

/* 굵기를 따로 기억하는 도구 — 지우개·번짐은 보통 그림 붓보다 굵게 쓴다.
 * 공용 굵기 하나만 두면 지우려고 키운 값이 그림 붓에도 그대로 남아 매번 다시 맞춰야 했다
 * (2026-07-14 사용자: "불편하네"). */
const SEPARATE_SIZE_TOOLS: BrushId[] = ["eraser", "smudge"];
const DEFAULT_TOOL_SIZE = 34;

export const useEditor = create<EditorState>((set, get) => ({
  engine: null,
  ready: false,
  mode: "sketch",
  brush: "pencil",
  color: DEFAULT_PALETTE_INK,
  recentColors: [],
  pressureOn: true,
  prevBrush: null,
  size: 18,
  drawSize: 18,
  sizeByTool: { eraser: 34, smudge: 34 },
  opacity: 1,
  water: 0.6,
  stabilize: 3,
  symmetry: "none",
  shapeInsert: null,
  // 뚝딱그림은 기본 꺼짐 — 색칠 중 자동 제안이 끼어들면 방해(2026-07-10 사용자 지시).
  // 원할 때 마법 도구에서 켠다.
  sketchSuggest: false,
  suggestSuppressed: false,
  suggestions: [],
  pending: null,
  stampPaletteOpen: false,
  textPaletteOpen: false,
  juniorMode: false,
  canUndo: false,
  canRedo: false,
  layers: [],
  activeLayerId: "",
  latencyMs: 0,
  usingWebGL2: false,
  restoreAvailable: null,
  viewScale: 1,

  attach: (engine) => {
    unsub.forEach((u) => u());
    unsub = [
      engine.on("historyChange", ({ canUndo, canRedo }) => set({ canUndo, canRedo })),
      engine.on("viewChange", ({ scale }) => set({ viewScale: scale })),
      engine.on("layersChange", ({ layers, activeId }) =>
        set({ layers, activeLayerId: activeId }),
      ),
      engine.on("strokeLatency", ({ ms }) => set({ latencyMs: Math.round(ms) })),
      engine.on("restoreAvailable", ({ savedAt }) => set({ restoreAvailable: savedAt })),
      engine.on("suggestReady", ({ candidates }) => {
        // 빈→빈 갱신 스킵(리셋 경로마다 emit돼 불필요 리렌더 방지)
        if (candidates.length === 0 && get().suggestions.length === 0) return;
        set({ suggestions: candidates });
      }),
      engine.on("pendingChange", ({ pending }) => {
        // 배치 시작 = 제안 바 닫고 확인/취소 바 표시, 종료 = 되돌림
        set({ pending, suggestions: pending ? [] : get().suggestions });
      }),
      // 최근 색은 "실제로 그린 색"만 — setColor 시점 기록은 밝기 슬라이더 드래그가 도배(실측)
      engine.on("colorPicked", ({ color: c }) => {
        // 스포이트: 색 반영 후 이전 붓으로 자동 복귀
        get().engine?.setColor(c);
        const prev = get().prevBrush;
        if (prev) {
          get().engine?.setBrush(prev);
          set({ color: c, brush: prev, prevBrush: null });
        } else {
          set({ color: c });
        }
      }),
      engine.on("colorUsed", ({ color: c }) => {
        const key = (r: RGB) => `${r.r},${r.g},${r.b}`;
        set((s) => ({
          recentColors: [c, ...s.recentColors.filter((r) => key(r) !== key(c))].slice(0, 8),
        }));
      }),
    ];
    // 엔진 constructor가 이미 emit한 초기 상태를 직접 동기화(구독이 늦게 붙어 놓침)
    const stack = engine.getLayers();
    set({
      engine,
      ready: true,
      usingWebGL2: engine.usingWebGL2,
      layers: stack.info,
      activeLayerId: stack.activeId,
      viewScale: 1,
      // ⚠️ 이것까지 동기화하지 않으면 재마운트(가로/세로 전환·모드 이동·재입장) 후에도
      // 앞 엔진의 값이 남아 되돌리기/다시 버튼이 켜진 채로 아무 반응이 없다(2026-07-25 실측).
      canUndo: engine.canUndo,
      canRedo: engine.canRedo,
      /* 복구 배너도 엔진에 딸린 상태다 — 리셋하지 않으면 앞 엔진의 배너가 새 캔버스 위에
       * 옛 타임스탬프를 단 채 남아, [새 그림] 직후에도 "이어 그리기"를 권한다(교차검증 지적).
       * 아래 checkRestore()가 실제로 저장본이 있을 때만 다시 켠다. */
      restoreAvailable: null,
    });
    // UI(스토어)에 남아있는 설정을 새 엔진에 전부 푸시 — 페이지 이동 후 재마운트 시
    // 엔진이 기본값(검정 연필 18)으로 그리던 버그(UI 표시와 실제 그리기 불일치)
    const s = get();
    engine.setMode(s.mode);
    // 지우개는 복원하지 않는다 — 재입장 후 빈 캔버스에 지우개로 그으면 아무것도
    // 안 보여 "안 그려져요/색이 안 바뀌어요"가 된다(실사용 보고). 모드 기본 붓으로.
    const safeBrush = s.brush === "eraser" ? engine.brushId : s.brush;
    engine.setBrush(safeBrush); // setMode가 모드 기본 브러시로 바꾸므로 그 뒤에 복원
    if (safeBrush !== s.brush) set({ brush: safeBrush });
    engine.setColor(s.color);
    engine.setSize(s.size);
    engine.setOpacity(s.opacity);
    engine.setWater(s.water);
    engine.setStabilize(s.stabilize);
    engine.setSymmetry(s.symmetry);
    engine.setShapeInsert(s.shapeInsert);
    engine.setSketchSuggest(s.sketchSuggest);
    engine.setSuggestSuppressed(s.suggestSuppressed);
    engine.setPressureEnabled(s.pressureOn);
    void engine.checkRestore();
  },

  detach: () => {
    unsub.forEach((u) => u());
    unsub = [];
    set({
      engine: null,
      ready: false,
      canUndo: false,
      canRedo: false,
      layers: [],
      suggestions: [],
      pending: null,
      stampPaletteOpen: false,
      textPaletteOpen: false,
    });
  },

  setMode: (m) => {
    const eng = get().engine;
    const prev = get().brush;
    eng?.setMode(m);
    // 엔진 setMode 는 모드 기본 붓으로 바꾼다 — 쓰던 도구를 그대로 유지(2026-10-08 사용자 «캔버스를 바꾸면
    // 도구가 자동으로 바뀐다, 원래 쓰던 도구 그대로»). 도구 목록은 모드와 무관하게 같다.
    eng?.setBrush(prev);
    eng?.setShapeInsert(null); // 모드 전환 = 도형 모드 해제
    set({ mode: m, brush: prev, shapeInsert: null });
  },
  setBrush: (b) => {
    get().engine?.setBrush(b);
    get().engine?.setShapeInsert(null); // 붓을 고르면 도형 모드 해제(그리기로 복귀)
    // 지우개·번짐은 굵기를 따로 기억한다 — 지우려고 굵게 키운 값이 그림 붓까지 굵게 만들던 불편 해소
    const s0 = get();
    const next = SEPARATE_SIZE_TOOLS.includes(b)
      ? s0.sizeByTool[b] ?? DEFAULT_TOOL_SIZE
      : s0.drawSize;
    if (next !== s0.size) get().engine?.setSize(next);
    // 스포이트 진입 시 이전 붓 기억(색 찍으면 자동 복귀), 스포이트→스포이트는 유지
    set((s) => ({
      brush: b,
      size: next,
      shapeInsert: null,
      prevBrush: b === "eyedropper" ? (s.brush === "eyedropper" ? s.prevBrush : s.brush) : null,
    }));
  },
  setColor: (c) => {
    get().engine?.setColor(c);
    set({ color: c }); // 최근 색 기록은 colorUsed(실제로 그린 순간) 구독이 담당
  },
  togglePressure: () => {
    set((s) => {
      const on = !s.pressureOn;
      get().engine?.setPressureEnabled(on);
      return { pressureOn: on };
    });
  },
  setSize: (n) => {
    get().engine?.setSize(n);
    set((s) =>
      SEPARATE_SIZE_TOOLS.includes(s.brush)
        ? { size: n, sizeByTool: { ...s.sizeByTool, [s.brush]: n } }
        : { size: n, drawSize: n },
    );
  },
  setOpacity: (n) => {
    get().engine?.setOpacity(n);
    set({ opacity: n });
  },
  setWater: (n) => {
    get().engine?.setWater(n);
    set({ water: n });
  },
  setStabilize: (n) => {
    get().engine?.setStabilize(n);
    set({ stabilize: n });
  },
  setSymmetry: (m) => {
    get().engine?.setSymmetry(m);
    set({ symmetry: m });
  },
  setShapeInsert: (k) => {
    // 스트로크형 붓이어야 도형이 그려진다 — 포인터/페인트통/스포이트/번짐이면 연필로 전환
    if (k && !STROKE_BRUSHES.includes(get().brush)) get().setBrush("pencil");
    get().engine?.setShapeInsert(k);
    set({ shapeInsert: k });
  },
  toggleSketchSuggest: () => {
    const on = !get().sketchSuggest;
    get().engine?.setSketchSuggest(on); // 끄면 엔진이 suggestReady([])로 바를 닫는다
    set({ sketchSuggest: on });
  },
  setSuggestSuppressed: (on) => {
    get().engine?.setSuggestSuppressed(on);
    set({ suggestSuppressed: on });
  },
  acceptSuggestion: (stampId) => {
    get().engine?.acceptSuggestion(stampId);
    set({ suggestions: [] });
  },
  dismissSuggestion: () => {
    get().engine?.dismissSuggestion();
    set({ suggestions: [] });
  },
  commitPending: () => {
    get().engine?.commitPendingStamp(); // pendingChange(null) 구독이 상태 정리
  },
  cancelPending: () => {
    get().engine?.cancelPendingStamp();
  },
  insertStamp: (stampId) => {
    get().engine?.insertStamp(stampId);
    set({ stampPaletteOpen: false });
  },
  setStampPaletteOpen: (open) => set({ stampPaletteOpen: open }),
  insertText: (value, fontFamily, outline) => {
    void get().engine?.insertText(value, fontFamily, outline ?? null);
    set({ textPaletteOpen: false });
  },
  setTextPaletteOpen: (open) => set({ textPaletteOpen: open }),
  toggleJunior: () =>
    set((s) => {
      const junior = !s.juniorMode;
      // 저학년 모드로 들어갈 때 지금 든 도구가 목록에서 사라지면(유화붓·붓펜 등)
      // 버튼은 없는데 엔진은 계속 그 붓으로 그린다 = 선택된 도구가 하나도 없어 보이고
      // 아이는 무엇으로 그리는지 알 수 없다. 안 보이는 도구는 연필로 되돌린다.
      const hidden = junior && BRUSH_META.some((b) => b.id === s.brush && !b.junior);
      if (!hidden) return { juniorMode: junior };
      s.engine?.setBrush("pencil");
      return { juniorMode: junior, brush: "pencil" as const, prevBrush: null };
    }),
  undo: () => get().engine?.undo(),
  redo: () => get().engine?.redo(),
  clearActive: () => get().engine?.clearActiveLayer(),
  newDrawing: () => get().engine?.newDrawing(),
  addLayer: () => get().engine?.addLayer(),
  removeLayer: (id) => get().engine?.removeLayer(id),
  reorderLayer: (id, toIndex) => get().engine?.reorderLayer(id, toIndex),
  setActiveLayer: (id) => get().engine?.setActiveLayer(id),
  setLayerVisible: (id, v) => get().engine?.setLayerVisible(id, v),
  setLayerOpacity: (id, o) => get().engine?.setLayerOpacity(id, o),
  setLayerBlend: (id, b) => get().engine?.setLayerBlend(id, b),
  dismissRestore: () => {
    void get().engine?.discardRestore();
    set({ restoreAvailable: null });
  },
  resetView: () => get().engine?.resetView(),
}));
