"use client";

import { useEffect, useState } from "react";

/* 선행쌤 «학생 작품» 전시관 안내(2026-11-03 사용자 «아트온 선생님 계정에서 안내문 잘 해줘»).
 * 대시보드·학급 갤러리 두 곳이 같은 안내를 쓴다. 처음엔 펼쳐 두고, 접으면 이 기기에서 기억한다. */
const KEY = "arton.showcaseGuideClosed";
export const SHOWCASE_PAGE = "https://ssamzip.com/tools";

export function ShowcaseGuide({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  useEffect(() => {
    try { if (localStorage.getItem(KEY) === "1") setOpen(false); } catch {}
  }, []);
  const toggle = (o: boolean) => {
    setOpen(o);
    try { localStorage.setItem(KEY, o ? "0" : "1"); } catch {}
  };
  return (
    <details
      open={open}
      onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)}
      data-showcase-guide
      className="mb-6 rounded-card border-2 border-sun bg-sun-soft px-4 py-3 text-sm text-ink shadow-soft"
    >
      <summary className="cursor-pointer select-none font-display text-base">
        🏛️ 선행쌤 «학생 작품» 전시관 — 우리 반 그림을 전국 친구들에게 보여 주세요
      </summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section>
          <h3 className="font-semibold">어디에, 무엇이 나가나요</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
            <li>
              선행쌤 <a href={SHOWCASE_PAGE} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline">수업 보조 도구</a> 맨 위와 첫 화면 «학생 작품» 칸에 걸려요.
            </li>
            <li><b className="text-ink">그림 한 장</b>과, 고르면 <b className="text-ink">시·도</b>(예: 전북)만 나가요.</li>
            <li>별명·이름·제목·학교·반은 <b className="text-ink">절대 나가지 않아요</b>.</li>
          </ul>
        </section>
        <section>
          <h3 className="font-semibold">거는 법</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-soft">
            <li>학급 <b className="text-ink">🖼️ 갤러리</b> → 작품 아래 <b className="text-ink">«🏛️ 선행쌤 전시관에 걸기»</b></li>
            <li>그림이 크게 떠요. <b className="text-ink">이름·학교·반·얼굴 사진</b>이 보이면 그 자리를 손가락(마우스)으로 <b className="text-ink">네모 그려 가려요</b> — 가린 그림만 나가고 원본은 그대로예요.</li>
            <li>그림 옆 지역(시·도)은 <b className="text-ink">미리 골라 드려요</b>(전에 고른 곳, 처음이면 접속한 곳) — 맞는지만 보고 «없어요(가렸어요)»를 체크한 뒤 걸어요.</li>
          </ol>
        </section>
        <section>
          <h3 className="font-semibold">순위와 하트</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
            <li><b className="text-ink">이번 주 하트</b> 순으로 50위까지 보여요. 지난주 인기 그림이 계속 자리를 차지하지 않아요.</li>
            <li>새로 건 그림은 <b className="text-ink">3일 동안 3칸마다 «NEW» 자리</b>가 보장돼요 — 하트가 0개여도 앞쪽에 보여요.</li>
            <li>하트는 보는 사람 누구나 한 번씩 누를 수 있어요(아이 정보 없이). 걸린 지 두 달이 지나면 저절로 빠져요.</li>
          </ul>
        </section>
        <section>
          <h3 className="font-semibold">안전 장치</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
            <li>보는 사람이 «이름·학교가 보여요 · 숨겨 주세요»를 누르면 <b className="text-ink">바로 내려가고</b>, 갤러리에 «신고로 내려짐»이 떠요. 가린 뒤 다시 걸 수 있어요.</li>
            <li>언제든 «전시 중 · 내리기»로 내릴 수 있어요.</li>
            <li>학생·보호자에게 «잘 그린 그림은 선생님이 선행쌤 전시관에 걸 수 있어요(이름 없이)»라고 미리 알려 주세요.</li>
          </ul>
        </section>
      </div>
    </details>
  );
}
