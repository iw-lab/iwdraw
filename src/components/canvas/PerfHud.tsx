"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor";

/*
 * 성능 계측 오버레이 — 주소에 `?perf=1` 을 붙였을 때만 뜬다(평상시 코드 경로 0).
 *
 * 왜 필요한가: 웨일북(저사양 크롬북)의 렉은 개발 머신에서 재현되지 않는다. 2026-09-01
 * 조사에서 합성 비용·자동저장 인코딩·부분 합성 가설을 전부 실측으로 세워 봤지만, 이 맥에서는
 * 셋 다 병목이 아니었고(오히려 "최적화"가 더 느렸다) 결국 **그 기기에서 잰 수치**가 없으면
 * 다음 한 걸음을 정할 수 없다. 그래서 기기에서 직접 읽을 수 있는 눈금을 남긴다.
 *
 * 읽는 법(획을 그으면서 봐야 한다 — 가만히 있을 때는 늘 좋게 나온다):
 *  · 프레임: 획 중 프레임 간격 중앙값/p90. 16~33ms면 정상, 100ms↑면 체감 렉.
 *  · 백킹: 표시 캔버스 실제 픽셀. 화면(물리) 값보다 지나치게 크면 낭비, 작으면 흐려진다.
 *  · 백엔드: GL이 아니면 소프트웨어 렌더러로 판정돼 Canvas2D로 내려온 것이다.
 */
export function PerfHud() {
  const usingWebGL2 = useEditor((s) => s.usingWebGL2);
  const layerCount = useEditor((s) => s.layers.length); // 배열이 아니라 개수만 구독(HUD 리렌더 최소화)
  const [m, setM] = useState({ med: 0, p90: 0, max: 0, heap: 0, bw: 0, bh: 0, cw: 0, ch: 0 });
  const gaps = useRef<number[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastPush = last;
    const tick = () => {
      const now = performance.now();
      gaps.current.push(now - last);
      last = now;
      if (gaps.current.length > 120) gaps.current.shift();
      // 표시 갱신은 0.5초에 한 번 — HUD 자신이 리렌더로 프레임을 먹으면 안 된다
      if (now - lastPush > 500) {
        lastPush = now;
        const s = gaps.current.slice().sort((a, b) => a - b);
        const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0);
        const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement | null;
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        setM({
          med: q(0.5),
          p90: q(0.9),
          max: Math.round(s[s.length - 1] ?? 0),
          heap: mem ? Math.round(mem.usedJSHeapSize / 1e6) : 0,
          bw: el?.width ?? 0,
          bh: el?.height ?? 0,
          cw: Math.round((el?.clientWidth ?? 0) * (window.devicePixelRatio || 1)),
          ch: Math.round((el?.clientHeight ?? 0) * (window.devicePixelRatio || 1)),
        });
      }
      raf = requestAnimationFrame(tick); // gb-juice-ok 성능 계측 오버레이 틱(플레이어 행동 아님)
    };
    raf = requestAnimationFrame(tick); // gb-juice-ok 성능 계측 오버레이 틱(플레이어 행동 아님)
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-50 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-tight text-white">
      <div>
        프레임 {m.med}/{m.p90}/{m.max}ms
      </div>
      <div>
        백킹 {m.bw}×{m.bh} · 화면 {m.cw}×{m.ch}
      </div>
      <div>
        {usingWebGL2 ? "GL" : "2D"} · 레이어 {layerCount} · dpr {window.devicePixelRatio || 1}
        {m.heap ? ` · 힙 ${m.heap}MB` : ""}
      </div>
    </div>
  );
}
