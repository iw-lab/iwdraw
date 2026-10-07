"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { PALETTE_24, PALETTE_CVD, hsvToRgb, rgbToHsv, rgbEq } from "@/lib/palette";
import { rgbToCss, type RGB } from "@/engine/types";
import { Icon } from "./icons";

/* 색상: 지금 색 크게 + 24색 동그라미 + HSV 피커 + 최근 8색 + 색각 보조 팔레트 토글 */
export function ColorPalette() {
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const recent = useEditor((s) => s.recentColors);
  const [cvd, setCvd] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const palette = cvd ? PALETTE_CVD : PALETTE_24;

  return (
    <div className="color-palette rounded-panel border border-ink/6 bg-paper p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            role="img"
            className="h-7 w-7 rounded-full ring-2 ring-cream-deep"
            style={{ background: rgbToCss(color) }}
            aria-label="지금 고른 색"
          />
          <span className="text-xs font-semibold tracking-wide text-ink-faint">색</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCvd((v) => !v)}
            aria-pressed={cvd}
            className={`pressable flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold ${
              cvd ? "bg-sky-soft text-sky-deep" : "text-ink-soft hover:bg-surface-2"
            }`}
            title="색각 보조 팔레트(구분하기 쉬운 색)"
          >
            <Icon name="glasses" className="h-4 w-4" />
            색각 보조
          </button>
          <button
            onClick={() => setShowPicker((v) => !v)}
            aria-pressed={showPicker}
            className={`pressable flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold ${
              showPicker ? "bg-coral-soft text-coral-deep" : "text-ink-soft hover:bg-surface-2"
            }`}
            title="원하는 색 직접 만들기"
          >
            <Icon name="picker" className="h-4 w-4" />
            직접
          </button>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {palette.map((c, i) => {
          const active = rgbEq(c, color);
          return (
            <button
              key={i}
              onClick={() => setColor(c)}
              aria-label={`색 ${i + 1}`}
              aria-pressed={active}
              className={`pressable aspect-square rounded-full transition-transform active:scale-90 ${
                active
                  ? "scale-110 ring-[2.5px] ring-ink ring-offset-2 ring-offset-paper"
                  : "ring-1 ring-black/10 hover:scale-105"
              }`}
              style={{ background: rgbToCss(c) }}
            />
          );
        })}
      </div>

      {showPicker && <HsvPicker value={color} onChange={setColor} />}

      {recent.length > 0 && (
        <div className="mt-3">
          <span className="text-xs font-semibold tracking-wide text-ink-faint">최근 쓴 색</span>
          <div className="mt-1 flex gap-1.5">
            {recent.map((c, i) => (
              <button
                key={i}
                onClick={() => setColor(c)}
                aria-label={`최근 색 ${i + 1}`}
                className="h-6 w-6 rounded-full ring-1 ring-black/10 transition-transform active:scale-90 hover:scale-105"
                style={{ background: rgbToCss(c) }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const WHEEL_PX = 220; // 내부 래스터 해상도(표시 크기는 CSS)

/** 원형 컬러휠(각도=색상, 반지름=쨍하기) + 밝기 슬라이더 — i-scream류 직관 피커 */
function HsvPicker({ value, onChange }: { value: RGB; onChange: (c: RGB) => void }) {
  const { h, s, v } = rgbToHsv(value);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 휠 래스터는 1회만 그린다(v=1 고정 — 밝기는 아래 슬라이더 담당)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    const img = ctx.createImageData(WHEEL_PX, WHEEL_PX);
    const r = WHEEL_PX / 2;
    for (let y = 0; y < WHEEL_PX; y++) {
      for (let x = 0; x < WHEEL_PX; x++) {
        const dx = x - r + 0.5;
        const dy = y - r + 0.5;
        const dist = Math.hypot(dx, dy) / r;
        const i = (y * WHEEL_PX + x) * 4;
        if (dist > 1) continue; // 밖은 투명
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const c = hsvToRgb(hue, Math.min(1, dist), 1);
        img.data[i] = c.r;
        img.data[i + 1] = c.g;
        img.data[i + 2] = c.b;
        // 가장자리 안티앨리어싱
        img.data[i + 3] = dist > 0.985 ? Math.round(255 * (1 - (dist - 0.985) / 0.015)) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const dist = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    onChange(hsvToRgb(hue, dist, 1)); // 휠에서 색 고르면 밝기 최대로 시작(이후 슬라이더로 낮춤)
  };

  // 현재 색 표시점 위치(%)
  const hRad = (h * Math.PI) / 180;
  const dotX = 50 + Math.cos(hRad) * s * 48;
  const dotY = 50 + Math.sin(hRad) * s * 48;

  return (
    <div className="mt-2 space-y-2 rounded-control bg-surface-2 p-3">
      <div className="relative mx-auto h-44 w-44 touch-none">
        <canvas
          ref={canvasRef}
          width={WHEEL_PX}
          height={WHEEL_PX}
          className="h-full w-full cursor-crosshair rounded-full"
          // 포인터로 값을 고르는 위젯이다 — 입력 계층이 "조작 요소"로 알아보게 role을 준다
          // (없으면 그리는 도중 다른 손으로 색을 고를 때 그리던 획이 제스처로 오인돼 취소된다)
          role="slider"
          aria-label="컬러휠 — 돌려서 색깔, 바깥쪽일수록 쨍하게"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons > 0) pick(e);
          }}
        />
        <span
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[2.5px] ring-white drop-shadow"
          style={{ left: `${dotX}%`, top: `${dotY}%`, background: rgbToCss(hsvToRgb(h, s, 1)) }}
        />
      </div>
      <label className="block text-xs font-semibold text-ink-soft">
        밝기
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(v * 100)}
          onChange={(e) => onChange(hsvToRgb(h, s, +e.target.value / 100))}
          className="mt-1 h-3.5 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background: `linear-gradient(to right, #000, ${rgbToCss(hsvToRgb(h, s, 1))})`,
            accentColor: rgbToCss(value), // 슬라이더 손잡이(버튼)를 지금 고른 색으로
          }}
        />
      </label>
    </div>
  );
}
