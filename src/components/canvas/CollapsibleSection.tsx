"use client";

import { useEffect, useState, type ReactNode } from "react";

export function CollapsibleSection({
  title,
  children,
  defaultOpenOnPhone = false,
  collapsibleOnRail = false,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpenOnPhone?: boolean;
  collapsibleOnRail?: boolean;
}) {
  const [phone, setPhone] = useState(false);
  const [openOnPhone, setOpenOnPhone] = useState(defaultOpenOnPhone);

  useEffect(() => {
    // 서버와 첫 렌더를 같게 두어 하이드레이션 불일치를 막는다.
    // 폰 = 639px 이하(또는 가로로 눕힌 폰). 767 로 잡으면 교실 태블릿(갤럭시탭 S4 세로 712px)이
    // 폰으로 분류돼 저학년·도장 버튼이 더보기/접힘 안으로 숨었다(2026-10-07 e2e tablet). globals.css 와 같은 값.
    const media = window.matchMedia("(max-width: 639px), (max-height: 559px)");
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const open = (!phone && !collapsibleOnRail) || openOnPhone;
  return (
    <section className={`collapsible-section min-w-0 rounded-panel border border-ink/6 bg-paper p-3 ${collapsibleOnRail ? "collapsible-on-rail" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpenOnPhone((value) => !value)}
        className="collapsible-toggle pressable touch-target flex w-full items-center gap-2 rounded-control text-left text-xs font-semibold tracking-wide text-ink-faint hover:bg-surface-2"
      >
        {title}
        <span aria-hidden="true" className={`ml-auto ${collapsibleOnRail && open ? "rotate-180" : ""}`}>
          {collapsibleOnRail ? "▾" : open ? "▾" : "▸"}
        </span>
      </button>
      <div className="collapsible-label flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-faint">
        {title}
      </div>
      <div hidden={!open} className="collapsible-content mt-3">
        {children}
      </div>
    </section>
  );
}
