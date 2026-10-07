"use client";

import { useState, type ReactNode } from "react";
import { useEditor } from "@/store/editor";
import type { SymmetryMode } from "@/engine/types";
import type { ShapeInsertKind } from "@/engine/tools/ShapeInsert";
import { Icon, type IconName } from "./icons";
import { CollapsibleSection } from "./CollapsibleSection";

const SYMS: { id: SymmetryMode; label: string; icon: IconName }[] = [
  { id: "none", label: "없음", icon: "symNone" },
  { id: "vertical", label: "좌우", icon: "symVertical" },
  { id: "horizontal", label: "상하", icon: "symHorizontal" },
  { id: "quad", label: "4방", icon: "symQuad" },
];

/* 도형 삽입: 버튼을 고르고 캔버스를 드래그하면 그 자리·그 크기로 그려진다
 * (예전 "그리면 자동으로 도형 스냅"은 오인식이 잦아 폐기 — 2026-07-09) */
const SHAPES: { id: ShapeInsertKind; label: string; icon: ReactNode }[] = [
  { id: "line", label: "직선", icon: <path d="M4 20L20 4" /> },
  { id: "rect", label: "네모", icon: <rect x="4" y="5.5" width="16" height="13" rx="1" /> },
  { id: "ellipse", label: "동그라미", icon: <circle cx="12" cy="12" r="8" /> },
  { id: "triangle", label: "세모", icon: <path d="M12 4.5l8.5 15h-17z" /> },
  {
    id: "star",
    label: "별",
    icon: <path d="M12 3.5l2.3 5 5.5.6-4.1 3.7 1.1 5.4-4.8-2.7-4.8 2.7 1.1-5.4-4.1-3.7 5.5-.6z" />,
  },
  {
    id: "heart",
    label: "하트",
    icon: (
      <path d="M12 20s-6.5-4.2-8.6-8.2C2.2 9 3.5 6 6.4 6c1.8 0 3 1 3.9 2.3.9-1.3 2.1-2.3 3.9-2.3 2.9 0 4.2 3 3 5.8C15.5 15.8 12 20 12 20z" />
    ),
  },
];

/** 받침 유무에 맞는 "가/이" 조사 — 저학년이 읽는 문구 */
function withGa(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}가`;
  return (last - 0xac00) % 28 === 0 ? `${word}가` : `${word}이`;
}

/*
 * 보조 도구 패널(우측): 도형 그리기 · 대칭 · 전체 지우기.
 * (되돌리기/다시는 캔버스 위 플로팅 버튼, 저장은 헤더로 이동)
 */
export function ActionRail() {
  const clearActive = useEditor((s) => s.clearActive);
  const symmetry = useEditor((s) => s.symmetry);
  const setSymmetry = useEditor((s) => s.setSymmetry);
  const shapeInsert = useEditor((s) => s.shapeInsert);
  const setShapeInsert = useEditor((s) => s.setShapeInsert);
  const sketchSuggest = useEditor((s) => s.sketchSuggest);
  const toggleSketchSuggest = useEditor((s) => s.toggleSketchSuggest);
  const suggestSuppressed = useEditor((s) => s.suggestSuppressed);
  const setStampPaletteOpen = useEditor((s) => s.setStampPaletteOpen);
  const setTextPaletteOpen = useEditor((s) => s.setTextPaletteOpen);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <CollapsibleSection title="마법 도구">
        {/* 뚝딱그림 */}
        <button
          onClick={toggleSketchSuggest}
          disabled={suggestSuppressed}
          aria-pressed={sketchSuggest && !suggestSuppressed}
          title={
            suggestSuppressed
              ? "함께 그리는 방에서는 쓸 수 없어요"
              : "대충 그려도 비슷한 그림을 찾아서 바꿔줘요"
          }
          className={`pressable touch-target mt-2 flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold disabled:opacity-40 ${
            sketchSuggest && !suggestSuppressed
              ? "bg-coral-soft text-coral-deep ring-2 ring-coral/60 ring-inset"
              : "bg-transparent text-ink-soft hover:bg-surface-2"
          }`}
        >
          <Icon name="glow" className="h-6 w-6" />
          뚝딱그림
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${
              sketchSuggest && !suggestSuppressed ? "bg-berry text-white" : "bg-cream-deep text-ink-faint"
            }`}
          >
            {suggestSuppressed ? "잠금" : sketchSuggest ? "켬" : "끔"}
          </span>
        </button>

        {/* 그림 도장(스탬프 팔레트) — 264종을 직접 골라 넣고 크기·위치 조절 */}
        <button
          onClick={() => setStampPaletteOpen(true)}
          title="여러 그림을 골라서 도장처럼 찍어요 (크기·위치 바꿀 수 있어요)"
          className="pressable touch-target mt-2 flex w-full items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2"
        >
          <span className="text-xl leading-none">🧸</span>
          그림 도장
          <span className="ml-auto rounded-full bg-cream-deep px-2 py-0.5 text-[11px] font-bold text-ink-faint">
            고르기
          </span>
        </button>

        {/* 글씨 넣기 — 글을 치고 글꼴을 고르면 캔버스에 떠서 들어온다(위치·크기 조절 후 확인) */}
        <button
          onClick={() => setTextPaletteOpen(true)}
          title="글씨를 써서 그림에 넣어요 (크기·위치 바꿀 수 있어요)"
          className="pressable touch-target mt-2 flex w-full items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2"
        >
          <span className="text-xl leading-none">✏️</span>
          글씨 넣기
          <span className="ml-auto rounded-full bg-cream-deep px-2 py-0.5 text-[11px] font-bold text-ink-faint">
            쓰기
          </span>
        </button>
      </CollapsibleSection>

      {/* 도형 그리기 — 고르고 캔버스를 드래그하면 그 크기로 그려져요 */}
      <CollapsibleSection title="도형 그리기">
        <div className="mt-1 grid grid-cols-3 gap-1">
          {SHAPES.map((sh) => {
            const active = shapeInsert === sh.id;
            return (
              <button
                key={sh.id}
                onClick={() => setShapeInsert(active ? null : sh.id)}
                aria-pressed={active}
                title={active ? "도형 그리기 끄기" : `캔버스를 드래그하면 ${withGa(sh.label)} 그려져요`}
                className={`pressable touch-target flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-semibold ${
                  active ? "bg-coral-soft text-coral-deep ring-2 ring-coral/60 ring-inset" : "bg-transparent text-ink-soft hover:bg-surface-2"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  aria-hidden
                >
                  {sh.icon}
                </svg>
                {sh.label}
              </button>
            );
          })}
        </div>
        {shapeInsert && (
          <p className="mt-1 text-[11px] leading-snug text-sky-deep">
            캔버스를 드래그하면 그 자리에 그 크기로 그려져요!
          </p>
        )}
      </CollapsibleSection>

      {/* 대칭 */}
      <CollapsibleSection title="데칼코마니(대칭)">
        <div className="mt-1 grid grid-cols-4 gap-1">
          {SYMS.map((s) => {
            const active = symmetry === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSymmetry(s.id)}
                aria-pressed={active}
                title={`${s.label} 대칭`}
                className={`pressable touch-target flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-semibold ${
                  active ? "bg-coral-soft text-coral-deep ring-2 ring-coral/60 ring-inset" : "bg-transparent text-ink-soft hover:bg-surface-2"
                }`}
              >
                <Icon name={s.icon} className="h-5 w-5" />
                {s.label}
              </button>
            );
          })}
        </div>
        {symmetry !== "none" && (
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className="text-[10px] leading-tight text-ink-faint">
              파란 점을 끌어 접는 선을 옮겨요
            </span>
            <button
              onClick={() => useEditor.getState().engine?.resetSymmetryAxis()}
              className="pressable touch-target shrink-0 rounded-lg bg-cream px-2 py-1 text-[10px] font-semibold text-ink-soft hover:bg-cream-deep"
            >
              가운데로
            </button>
          </div>
        )}
      </CollapsibleSection>

      {/* 전체 지우기 */}
      <div className="rounded-panel border border-ink/6 bg-paper p-3">
        {confirmClear ? (
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                clearActive();
                setConfirmClear(false);
              }}
              className="pressable touch-target flex-1 rounded-xl bg-danger py-2 text-sm font-bold text-white"
            >
              정말 지울래요
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="pressable touch-target flex-1 rounded-xl bg-cream py-2 text-sm font-semibold text-ink-soft"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            aria-label="전체 지우기"
            className="pressable touch-target flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold text-danger hover:bg-danger-soft"
          >
            <Icon name="trash" className="h-5 w-5" />
            전체 지우기
          </button>
        )}
      </div>
    </div>
  );
}
