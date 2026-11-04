"use client";

import { useState } from "react";

/* 저장 화면 공용 부품 — 그리기(Editor)와 샌드아트(SandEditor)가 같이 쓴다. */

/* 제목 묻기 — 저장(제출) 직전 1회. 아이 손에 맞춰 큼직한 입력 한 칸과 버튼 두 개만. */
export function TitleAsk({
  initial,
  onDone,
  onCancel,
}: {
  initial: string;
  onDone: (title: string) => void;
  /** 닫기 — 쓰던 제목을 초안으로 넘긴다(실수로 배경을 탭해도 다시 열면 그대로 있다) */
  onCancel: (draft: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="그림 제목 정하기"
      onClick={() => onCancel(v)}
    >
      <div
        className="w-[min(92vw,420px)] rounded-bubble bg-paper p-5 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl text-ink">그림에 제목을 지어 줄래요? ✏️</h2>
        <p className="mt-1 text-sm text-ink-soft">갤러리에서 친구들이 제목과 함께 봐요.</p>
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            /* ⚠️ isComposing 가드 — 한글 조합을 확정하는 Enter 가 그대로 제출로 새면
             * 마지막 음절이 빠진 제목("우리 강아")이 저장된다(교차검증 지적). */
            if (e.key === "Enter" && !e.nativeEvent.isComposing) onDone(v);
            if (e.key === "Escape") onCancel(v);
          }}
          maxLength={30} // ⚠️ worker/lib/title.ts 의 TITLE_MAX 와 같은 값이어야 한다
          placeholder="예) 우리 강아지"
          aria-label="그림 제목"
          className="mt-4 w-full rounded-card border border-cream-deep bg-white px-4 py-3 text-lg text-ink outline-none focus:border-sky"
        />
        <div className="mt-2 text-right text-xs text-ink-faint">{v.length}/30</div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onDone("")}
            className="pressable flex-1 rounded-card bg-cream-deep px-4 py-3 font-display text-ink-soft"
          >
            그냥 저장
          </button>
          <button
            onClick={() => onDone(v)}
            className="pressable flex-[2] rounded-card bg-coral px-4 py-3 font-display text-white shadow-soft"
          >
            이 제목으로 저장
          </button>
        </div>
      </div>
    </div>
  );
}

/* ⚠️ pointer-events-none 필수. 토스트는 캔버스 위(bottom-6 중앙)에 떠서, 그대로 두면
 * 떠 있는 동안 그 자리의 탭·획을 통째로 삼킨다 — 아이가 캔버스 아래쪽을 누르는데 아무 일도
 * 안 일어난다(2026-09-04 실측: 페인트통 스펙이 이걸로 깨졌다. 안내가 없던 시절에도 저장
 * 토스트가 같은 자리를 막고 있었다). 안내 안의 링크만 pointer-events-auto 로 되살린다. */
export function Toast({ children, tone = "ink" }: { children: React.ReactNode; tone?: "ink" | "leaf" }) {
  return (
    <div
      className={`pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full px-6 py-3 font-display text-white shadow-lift [&_a]:pointer-events-auto [&_button]:pointer-events-auto ${
        tone === "leaf" ? "bg-leaf" : "bg-ink"
      }`}
      role="status"
    >
      {children}
    </div>
  );
}
