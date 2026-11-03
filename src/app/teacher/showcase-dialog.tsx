"use client";

import { useEffect, useRef, useState } from "react";
import { coverRects, type Rect } from "@/lib/cover-rects";
import { guessShowcaseSido } from "@/lib/teacher-api";

/** 그림 옆에 붙는 시·도(학교·반은 절대 안 나간다) — 한 번 고르면 이 기기에서 기억 */
export const SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
const SIDO_KEY = "arton.showcaseSido";

/* 선행쌤 전시관에 걸기 전 확인(2026-11-03 그림 속 실명 «김서하»가 전시관에 그대로 나갔다).
 * 그림을 크게 보여 주고 — 이름·학교·반이 보이면 손가락으로 네모를 그려 가린다 — «없어요(가렸어요)»를 눌러야 걸린다.
 * 가린 그림은 전시관 전용 사본으로만 올라간다(학생 원본·학급 썸네일은 그대로). */
export function ShowcaseDialog({
  src,
  onCancel,
  onConfirm,
}: {
  src: string;
  onCancel: () => void;
  onConfirm: (cover: Blob | null, sido: string) => Promise<void>;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  const [drag, setDrag] = useState<Rect | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sido, setSido] = useState(() => { try { const v = localStorage.getItem(SIDO_KEY) || ""; return SIDO.includes(v) ? v : ""; } catch { return ""; } });
  const [guessed, setGuessed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  // 이 기기에서 고른 적이 없으면 — 전에 다른 기기에서 고른 값, 그것도 없으면 접속 위치로 미리 고른다(선생님이 확인·바꿈)
  useEffect(() => {
    if (sido) return;
    let live = true;
    guessShowcaseSido().then((g) => { if (live && g.sido && SIDO.includes(g.sido)) { setSido((v) => v || g.sido); setGuessed(g.from === "net"); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 창을 열 때 한 번
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);

  // 화면 좌표 → 그림 비율(0~1) — 기기 크기와 상관없이 같은 자리를 가린다
  const rel = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = rel(e);
    setDrag({ x: start.current.x, y: start.current.y, w: 0, h: 0 });
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = rel(e), s = start.current;
    setDrag({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const up = () => {
    if (drag && drag.w > 0.01 && drag.h > 0.01) setRects((r) => [...r, drag]);
    start.current = null;
    setDrag(null);
  };

  const confirm = async () => {
    setBusy(true);
    let blob: Blob | null = null;
    if (rects.length && imgRef.current) blob = await coverRects(imgRef.current, rects);
    try { localStorage.setItem(SIDO_KEY, sido); } catch {}
    await onConfirm(blob, sido);
    setBusy(false);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="선행쌤 전시관에 걸기 전 확인" data-showcase-dialog className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4" onClick={onCancel}>
      <div className="w-full max-w-xl rounded-card bg-paper p-4 shadow-soft" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg text-ink">🏛️ 선행쌤 전시관에 걸기 전에</h2>
        <p className="mt-1 text-sm text-ink-soft">
          그림 안에 <b className="text-ink">이름·학교·반·얼굴 사진</b>이 보이면 그 자리를 손가락으로 <b>네모 그려 가려</b> 주세요. 가린 그림만 전시관에 나가고, 학생 원본은 그대로예요.
        </p>
        <div
          ref={boxRef}
          className="relative mt-3 w-full touch-none select-none overflow-hidden rounded-lg bg-white"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          data-cover-box
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 같은 출처 썸네일(캔버스로 가리기) */}
          <img ref={imgRef} src={src} alt="걸 작품" draggable={false} className="block w-full" />
          {[...rects, ...(drag ? [drag] : [])].map((r, i) => (
            <span key={i} className="absolute rounded-sm bg-ink/85 ring-2 ring-sun" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-ink-soft">가린 곳 {rects.length}개</span>
          <span className="flex-1" />
          <button type="button" className="pressable rounded-lg bg-cream px-3 py-1.5 font-semibold text-ink-soft disabled:opacity-50" disabled={!rects.length} onClick={() => setRects((r) => r.slice(0, -1))}>
            하나 되돌리기
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <span className="shrink-0 font-semibold">그림 옆 지역</span>
          <select value={sido} onChange={(e) => { setSido(e.target.value); setGuessed(false); }} data-showcase-sido className="min-h-10 flex-1 rounded-lg border border-line bg-white px-2">
            <option value="">밝히지 않기</option>
            {SIDO.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <p className="mt-1 text-xs text-ink-faint">
          {guessed ? <b className="text-ink" data-sido-guessed>접속한 곳으로 미리 골랐어요 — 학교가 있는 시·도가 맞는지 확인해 주세요. </b> : null}
          시·도만 보여요(예: 전북). 학교·반·이름은 나가지 않아요.
        </p>
        <label className="mt-3 flex items-start gap-2 rounded-lg bg-cream px-3 py-2 text-sm text-ink">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-5 w-5" data-showcase-check />
          <span>그림 안에 이름·학교·반·얼굴 사진이 <b>없어요</b>(있던 곳은 가렸어요).</span>
        </label>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onCancel} className="pressable flex-1 rounded-lg bg-cream py-2 font-semibold text-ink-soft">
            취소
          </button>
          <button type="button" onClick={confirm} disabled={!checked || busy} data-showcase-confirm className="pressable flex-1 rounded-lg bg-sun py-2 font-semibold text-ink disabled:opacity-50">
            {busy ? "거는 중…" : rects.length ? "가린 그림으로 걸기" : "전시관에 걸기"}
          </button>
        </div>
      </div>
    </div>
  );
}
