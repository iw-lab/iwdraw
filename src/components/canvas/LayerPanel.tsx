"use client";

import { useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import type { BlendMode } from "@/engine/types";
import { Icon } from "./icons";
import { CollapsibleSection } from "./CollapsibleSection";

const BLENDS: { id: BlendMode; label: string }[] = [
  { id: "normal", label: "보통" },
  { id: "multiply", label: "곱하기" },
  { id: "screen", label: "스크린" },
  { id: "overlay", label: "오버레이" },
];

/* 우측 접이식 레이어 패널 — 손잡이(⠿)를 잡고 위아래로 끌면 순서가 바뀐다(마우스·터치 공통) */
export function LayerPanel() {
  const layers = useEditor((s) => s.layers);
  const activeId = useEditor((s) => s.activeLayerId);
  const addLayer = useEditor((s) => s.addLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const reorderLayer = useEditor((s) => s.reorderLayer);
  const setActive = useEditor((s) => s.setActiveLayer);
  const setVisible = useEditor((s) => s.setLayerVisible);
  const setOpacity = useEditor((s) => s.setLayerOpacity);
  const setBlend = useEditor((s) => s.setLayerBlend);
  const [dragId, setDragId] = useState<string | null>(null);
  /* ⚠️ 드래그 중인 id를 state로만 들고 있으면, 포인터가 빠르게 움직일 때 리렌더 전에 도착한
   * pointermove가 옛 클로저(dragId=null)를 보고 무시한다(실측: 천천히 끌면 되고 빨리 끌면 안 됨).
   * 판정은 ref로, 화면 표시(반투명)는 state로 나눈다. */
  const dragRef = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const overRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const startDrag = (id: string) => {
    dragRef.current = id;
    setDragId(id);
  };
  const endDrag = () => {
    dragRef.current = null;
    overRef.current = null;
    setDragId(null);
    setOverId(null);
  };

  const drawable = layers.filter((l) => !l.isLineart && !l.isBase);

  /*
   * 드래그 중에는 "어느 줄 위에 있는지"만 표시하고, 놓는 순간 한 번만 옮긴다.
   * 움직일 때마다 즉시 옮기면(라이브 재정렬) 줄이 서로 자리를 바꾸면서 포인터가 경계에서
   * 왔다 갔다 → 짝수 번 스왑되어 제자리로 돌아온다(실측 2026-07-14).
   * HTML5 드래그앤드롭은 터치에서 안 먹어 Pointer 이벤트로 직접 처리한다(웨일북·태블릿).
   */
  const rowUnder = (clientY: number): string | null => {
    const list = listRef.current;
    if (!list) return null;
    for (const r of list.querySelectorAll<HTMLElement>("[data-layer-id]")) {
      const b = r.getBoundingClientRect();
      if (clientY >= b.top && clientY <= b.bottom) return r.dataset.layerId ?? null;
    }
    return null;
  };
  const dragOver = (clientY: number) => {
    if (!dragRef.current) return;
    const id = rowUnder(clientY);
    overRef.current = id;
    setOverId(id);
  };
  const drop = () => {
    const id = dragRef.current;
    const targetId = overRef.current;
    endDrag();
    if (!id || !targetId || targetId === id) return;
    const t = layers.find((l) => l.id === targetId);
    if (!t || t.isLineart || t.isBase) return; // 잠금 레이어(도안·원본) 자리로는 못 간다
    const toIndex = layers.findIndex((l) => l.id === targetId);
    if (toIndex >= 0) reorderLayer(id, toIndex);
  };

  return (
    <CollapsibleSection collapsibleOnRail title={
      <>
        <Icon name="layers" className="h-6 w-6" />
        <span>레이어</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-soft">
          {drawable.length}
        </span>
      </>
    }>
      <div
        ref={listRef}
        className="space-y-3"
        onPointerMove={(e) => dragOver(e.clientY)}
        onPointerUp={drop}
        onPointerCancel={endDrag}
      >
        {[...layers].reverse().map((l) => {
          const active = l.id === activeId;
          const locked = l.isLineart || l.isBase;
          const dragging = dragId === l.id;
          return (
            <div
              key={l.id}
              data-layer-id={l.id}
              className={`rounded-control border p-2 ${
                active ? "border-transparent bg-coral-soft text-coral-deep ring-2 ring-coral/60 ring-inset" : "border-line bg-surface-2"
              } ${locked ? "opacity-90" : ""} ${dragging ? "opacity-60" : ""} ${
                dragId && overId === l.id && overId !== dragId && !locked
                  ? "ring-2 ring-sky"
                  : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                {!locked && drawable.length > 1 && (
                  <button
                    onPointerDown={(e) => {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                      startDrag(l.id);
                    }}
                    onPointerMove={(e) => dragOver(e.clientY)}
                    onPointerUp={drop}
                    onPointerCancel={endDrag}
                    aria-label={`${l.name} 순서 바꾸기`}
                    title="끌어서 순서를 바꿔요"
                    className="pressable touch-target cursor-grab touch-none rounded-lg px-1 py-1 text-ink-faint"
                  >
                    ⠿
                  </button>
                )}
                <button
                  onClick={() => setVisible(l.id, !l.visible)}
                  aria-label={l.visible ? "숨기기" : "보이기"}
                  className="pressable touch-target rounded-lg p-1"
                >
                  <Icon name={l.visible ? "eye" : "eyeOff"} className="h-5 w-5" />
                </button>
                <button
                  onClick={() => !locked && setActive(l.id)}
                  className="flex-1 truncate text-left text-sm font-semibold text-ink"
                  disabled={locked}
                >
                  {l.name}
                  {l.isLineart && <span className="ml-1 text-xs text-ink-faint">(도안·잠금)</span>}
                  {l.isBase && <span className="ml-1 text-xs text-ink-faint">(원본·잠금)</span>}
                </button>
                {!locked && drawable.length > 1 && (
                  <button
                    onClick={() => removeLayer(l.id)}
                    aria-label="레이어 삭제"
                    className="pressable touch-target rounded-lg p-1"
                  >
                    <Icon name="trash" className="h-5 w-5" />
                  </button>
                )}
              </div>
              {!locked && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(l.opacity * 100)}
                    onChange={(e) => setOpacity(l.id, +e.target.value / 100)}
                    aria-label={`${l.name} 투명도`}
                    className="h-3 flex-1 cursor-pointer appearance-none rounded-full bg-cream-deep accent-sky"
                  />
                  <select
                    value={l.blend}
                    onChange={(e) => setBlend(l.id, e.target.value as BlendMode)}
                    aria-label={`${l.name} 블렌드 모드`}
                    className="rounded-lg border border-line bg-paper px-1.5 py-1 text-xs"
                  >
                    {BLENDS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
        {drawable.length > 1 && (
          <p className="text-center text-[11px] text-ink-faint">⠿ 를 끌어서 순서를 바꿔요</p>
        )}
        <button
          onClick={addLayer}
          disabled={drawable.length >= 8}
          className="pressable touch-target flex w-full items-center justify-center gap-1 rounded-control border-2 border-dashed border-ink-faint py-2 text-sm font-semibold text-ink-soft disabled:opacity-40"
        >
          <Icon name="plus" className="h-4 w-4 text-ink-soft" />새 레이어
        </button>
      </div>
    </CollapsibleSection>
  );
}
