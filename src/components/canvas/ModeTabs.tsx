"use client";

import { useRouter } from "next/navigation";
import { useEditor } from "@/store/editor";
import type { Mode } from "@/engine/types";
import { ToolIcon, type IconName } from "./icons";

const MODES: { id: Mode; label: string; icon: IconName; tone: string; ring: string }[] = [
  { id: "sketch", label: "스케치", icon: "pencil", tone: "bg-sun-soft", ring: "ring-sun" },
  { id: "watercolor", label: "수채화", icon: "watercolor", tone: "bg-sky-soft", ring: "ring-sky" },
  { id: "oil", label: "유화", icon: "palette", tone: "bg-coral-soft", ring: "ring-coral" },
  { id: "coloring", label: "색칠하기", icon: "coloring", tone: "bg-leaf-soft", ring: "ring-leaf" },
];

/*
 * 모드 탭(헤더 중앙). 색칠하기는 도안이 있어야 의미가 있으므로,
 * 도안 없이 누르면 도안 고르기(/coloring)로 데려간다.
 */
export function ModeTabs({ hasLineart = false }: { hasLineart?: boolean }) {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const router = useRouter();

  return (
    <div
      role="tablist"
      aria-label="그리기 모드"
      className="flex shrink-0 gap-1 rounded-panel bg-surface-2 p-1"
    >
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            aria-label={m.label}
            onClick={() => {
              if (m.id === "coloring" && !hasLineart) {
                router.push("/coloring"); // 도안 먼저 고르기
                return;
              }
              setMode(m.id);
            }}
            title={m.id === "coloring" && !hasLineart ? "도안을 골라 색칠해요" : m.label}
            className={`pressable touch-target flex min-h-12 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-semibold transition-colors ${
              active ? "bg-coral-soft text-coral-deep ring-2 ring-coral/60 ring-inset" : "text-ink-soft hover:bg-surface-2"
            }`}
          >
            <ToolIcon name={m.icon} className="h-6 w-6" />
            {/* 라벨 on/off는 헤더가 실측으로 정한다(Editor의 useAutoHeaderLabels).
                뷰포트 폭으로 못 정한다 — 학급/협동 여부에 따라 헤더 항목 수가 달라진다. */}
            <span className="hdr-label">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
