"use client";

import { useState } from "react";
import { useEditor } from "@/store/editor";
import { rgbToCss } from "@/engine/types";
import { brushStrokePx } from "@/engine/brushes";

const SIZE_MIN = 1;
const SIZE_MAX = 128;

/*
 * 굵기 슬라이더는 선형이 아니다.
 * 실사용 굵기는 1~30에 몰려 있는데 1~128을 선형으로 깔면 그 구간이 트랙의 23%뿐이라
 * 3과 8을 손가락으로 갈라내기 어렵다(2026-07-25 조작 실측). 제곱 매핑으로 트랙 절반이
 * 1~33을 담당하게 한다 — 굵은 쪽은 어차피 1~2px 차이를 구분할 일이 없다.
 *   pos 0 → 1 · 250 → 9 · 500 → 33 · 750 → 72 · 1000 → 128
 * ⚠️ 접근성·테스트 진입점은 "브러시 굵기"(숫자 입력)다 — 슬라이더 값은 위치라서
 *    fill("16")이 굵기 16을 뜻하지 않는다. 라벨을 바꾸지 말 것.
 */
const POS_MAX = 1000;
const posOfSize = (size: number): number =>
  Math.round(POS_MAX * Math.sqrt((size - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)));
const sizeOfPos = (pos: number): number => {
  const t = pos / POS_MAX;
  return Math.round(SIZE_MIN + (SIZE_MAX - SIZE_MIN) * t * t);
};

/* 브러시 크기(큰 슬라이더+숫자 입력+실시간 미리보기 원) + 모드별 물양/보정 슬라이더 */
export function BrushControls() {
  const size = useEditor((s) => s.size);
  const setSize = useEditor((s) => s.setSize);
  const opacity = useEditor((s) => s.opacity);
  const setOpacity = useEditor((s) => s.setOpacity);
  const water = useEditor((s) => s.water);
  const setWater = useEditor((s) => s.setWater);
  const stabilize = useEditor((s) => s.stabilize);
  const setStabilize = useEditor((s) => s.setStabilize);
  const color = useEditor((s) => s.color);
  const mode = useEditor((s) => s.mode);
  const brush = useEditor((s) => s.brush);
  const pressureOn = useEditor((s) => s.pressureOn);
  const togglePressure = useEditor((s) => s.togglePressure);

  // 실제 획 폭 기준 — 브러시마다 최소 선 폭이 달라(붓펜 2.2 vs 마커 2.9) 굵기 1에서도
  // 미리보기 원이 서로 달라야 "이 펜이 더 가늘다"가 UI에서 먼저 보인다.
  const preview = Math.max(4, Math.min(60, brushStrokePx(brush, size)));

  // 숫자 입력은 타이핑 중 빈 값/미완성 값을 허용해야 해서 로컬 텍스트로 들고,
  // 유효한 값일 때만 즉시 반영. 슬라이더 등 외부 변경은 동기화.
  const [sizeText, setSizeText] = useState(String(Math.round(size)));
  /* 외부에서 굵기가 바뀌면(도구 전환의 굵기 기억, 슬라이더, ± 버튼) 표시를 즉시 맞춘다.
   * useEffect로 미루면 한 프레임 동안 옛 값이 남는다 — 도구를 바꾼 직후 굵기 칸이
   * 이전 붓의 숫자를 보여주다 뒤늦게 바뀐다(2026-07-25 실측: 지우개 전환 직후 12→34).
   * React 공식 "렌더 중 파생 상태 조정" 패턴. */
  const [shownSize, setShownSize] = useState(size);
  if (size !== shownSize) {
    setShownSize(size);
    setSizeText(String(Math.round(size)));
  }
  const commitSize = (raw: string) => {
    if (raw.trim() === "") return; // 지우고 다시 입력하는 중 — Number("")===0이라 1로 튀는 사고 방지
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    setSize(Math.max(SIZE_MIN, Math.min(SIZE_MAX, n)));
  };
  const nudgeSize = (d: number) => {
    const next = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(size) + d));
    setSize(next);
    setSizeText(String(next)); // effect 동기화는 한 프레임 늦어 연타 시 표시가 밀린다
  };

  return (
    <div className="brush-controls rounded-panel border border-ink/6 bg-paper p-3">
      <div className="flex items-center gap-3">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-control bg-surface-2"
          aria-hidden="true"
        >
          <span
            className="rounded-full"
            style={{
              width: preview,
              height: preview,
              background: brush === "eraser" ? "#d9d2c6" : rgbToCss(color),
            }}
          />
        </div>
        <div className="flex-1 text-sm text-ink-soft">
          <div className="flex items-center gap-1">
            {/* 좁은 카드(세로형 태블릿 스택 레이아웃)에서 "굵 / 기"로 접히던 것 방지 */}
            <span className="whitespace-nowrap text-xs font-semibold tracking-wide text-ink-faint">굵기</span>
            <button
              onClick={() => nudgeSize(-1)}
              aria-label="굵기 1 줄이기"
              className="pressable ml-auto grid h-7 w-7 place-items-center rounded-control bg-surface-2 text-base font-bold text-ink"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={SIZE_MIN}
              max={SIZE_MAX}
              value={sizeText}
              onChange={(e) => {
                setSizeText(e.target.value);
                commitSize(e.target.value);
              }}
              onBlur={() => setSizeText(String(Math.round(size)))}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="브러시 굵기"
              className="h-7 w-14 rounded-control border border-line bg-paper text-center font-semibold text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              onClick={() => nudgeSize(1)}
              aria-label="굵기 1 늘리기"
              className="pressable grid h-7 w-7 place-items-center rounded-control bg-surface-2 text-base font-bold text-ink"
            >
              +
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={POS_MAX}
            value={posOfSize(size)}
            onChange={(e) => setSize(sizeOfPos(+e.target.value))}
            // 화살표 키는 위치 1칸 = 얇은 쪽에서 굵기 변화 0이라 굵기 1칸으로 바꾼다
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              nudgeSize(d);
            }}
            aria-label="브러시 굵기 슬라이더"
            aria-valuetext={`${Math.round(size)}`}
            className="brush-range mt-1 h-4 w-full cursor-pointer appearance-none rounded-control bg-cream-deep accent-coral"
          />
        </div>
      </div>

      <label className="mt-3 block text-xs font-semibold tracking-wide text-ink-faint">
        진하기 <span className="font-semibold text-ink">{Math.round(opacity * 100)}%</span>
        <input
          type="range"
          min={5}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(+e.target.value / 100)}
          aria-label="진하기"
          className="brush-range mt-1 h-4 w-full cursor-pointer appearance-none rounded-control bg-cream-deep accent-sky"
        />
      </label>

      {mode === "watercolor" && (
        <label className="mt-3 block text-xs font-semibold tracking-wide text-ink-faint">
          💧 물 양 <span className="font-semibold text-ink">{Math.round(water * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(water * 100)}
            onChange={(e) => setWater(+e.target.value / 100)}
            aria-label="물 양"
            className="mt-1 h-4 w-full cursor-pointer appearance-none rounded-full bg-sky-soft accent-sky"
          />
        </label>
      )}

      <label className="mt-3 block text-xs font-semibold tracking-wide text-ink-faint">
        ✋ 손떨림 보정 <span className="font-semibold text-ink">{stabilize}</span>
        <input
          type="range"
          min={0}
          max={10}
          value={stabilize}
          onChange={(e) => setStabilize(+e.target.value)}
          aria-label="손떨림 보정 강도"
          className="brush-range mt-1 h-4 w-full cursor-pointer appearance-none rounded-control bg-cream-deep accent-leaf"
        />
      </label>

      {/* 필압: 펜 실필압 + 마우스/손가락 속도 시뮬. 필압이 안 오는 기기(웨일북 등)는 끄면 균일 획 */}
      <div className="mt-3 flex items-center justify-between text-sm text-ink-soft">
        <span>✍️ 필압 (누르는 세기·속도 반영)</span>
        <button
          onClick={togglePressure}
          role="switch"
          aria-checked={pressureOn}
          aria-label="필압 켜기/끄기"
          className={`pressable relative h-6 w-11 rounded-full transition-colors ${
            pressureOn ? "bg-leaf" : "bg-cream-deep"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              pressureOn ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
