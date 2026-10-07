"use client";

import { useEditor } from "@/store/editor";
import { BRUSH_META } from "@/engine/brushes";
import type { BrushId } from "@/engine/types";
import { ToolIcon, type IconName } from "./icons";

/* 도구 → 아이콘 명시 매핑: BrushId와 IconName 유니언이 별개라 캐스트 대신 컴파일 안전하게 */
const BRUSH_ICON: Partial<Record<BrushId, IconName>> = {
  pencil: "pencil",
  colorpencil: "colorpencil",
  crayon: "crayon",
  signpen: "signpen",
  acrylic: "acrylic",
  marker: "marker",
  watercolor: "watercolor",
  oil: "oil",
  inkbrush: "inkbrush",
  airbrush: "airbrush",
  oilpastel: "oilpastel",
  charcoal: "charcoal",
  pastel: "pastel",
  glow: "glow",
  rainbow: "rainbow",
  glitter: "glitter",
  smudge: "smudge",
  eraser: "eraser",
  fill: "fill",
  eyedropper: "picker",
  pointer: "pointer",
};

/*
 * 도구 레일 — 데스크톱은 좌측 세로 2열(스크롤 없이 한눈에), 모바일은 하단 가로 스크롤.
 * (도구가 많아 1열은 세로 스크롤이 생겨 2열로 — 캔버스 폭은 여유가 있어 감당 가능)
 */
export function BrushBar() {
  const brush = useEditor((s) => s.brush);
  const setBrush = useEditor((s) => s.setBrush);
  const junior = useEditor((s) => s.juniorMode);

  const tools: { id: BrushId; label: string }[] = [
    // 클릭(포인터): 그려지지 않는 도구 — 다 그린 뒤 제안·버튼을 눌러도 오작화가 없다
    { id: "pointer", label: "클릭" },
    ...BRUSH_META.filter((b) => (junior ? b.junior : true)).map((b) => ({
      id: b.id,
      label: b.label,
    })),
    { id: "fill", label: "페인트통" },
    { id: "eyedropper", label: "스포이트" },
  ];

  return (
    <div
      // compact(가로 폰) = 좁은 2열 아이콘 그리드. 라벨은 남긴다 — 아이콘만으로는
      // 초등 저학년이 도구를 못 고른다(라벨 제거는 접근성 후퇴). 대신 글자를 줄인다.
      className="flex min-w-0 gap-1 overflow-x-auto rounded-panel border border-ink/6 bg-paper p-1.5 compact:grid compact:w-[92px] compact:shrink-0 compact:grid-cols-2 compact:content-start compact:gap-1 compact:p-1 compact:overflow-x-hidden compact:overflow-y-auto rail:grid rail:w-[150px] rail:shrink-0 rail:grid-cols-2 rail:content-start rail:gap-1.5 rail:overflow-x-hidden rail:overflow-y-auto"
      role="toolbar"
      aria-label="그리기 도구"
      aria-orientation="vertical"
    >
      {tools.map((t) => {
        const active = brush === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setBrush(t.id)}
            aria-pressed={active}
            aria-label={t.label}
            title={t.label}
            className={`pressable touch-target aspect-square flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-control py-1.5 min-w-[60px] compact:min-w-0 compact:gap-0 compact:rounded-xl compact:py-0.5 rail:min-w-0 ${
              active
                ? "bg-coral-soft text-coral-deep ring-2 ring-coral/60 ring-inset"
                : "hover:bg-surface-2"
            }`}
          >
            <ToolIcon
              name={BRUSH_ICON[t.id] ?? "pencil"}
              className={`${junior ? "h-9 w-9" : "h-8 w-8"} compact:h-6 compact:w-6`}
            />
            <span
              className={`text-[10px] font-semibold leading-tight compact:text-[10px] ${
                active ? "text-coral-deep" : "text-ink-soft"
              }`}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
