"use client";

/*
 * 선행쌤 전시관 «그리는 과정» 반복 재생(2026-11-17 사용자 «샌드아트 보내면 그리는 과정이 전시관에서 계속 반복»).
 * 선행쌤 화면이 이 쪽을 iframe 으로 띄운다(_headers 가 이 경로만 선행쌤 출처에 프레임을 연다).
 * 기록은 교사가 «과정도 걸기»를 확인한 작품만 서버가 내준다(/api/showcase/:id/replay) — 가린 곳이 있는 그림은 안 나온다.
 * 그리기 → 완성 장면 잠깐 → 처음부터, 끝없이. 탭이 숨으면 멈춘다(학교 기기 배터리·CPU).
 */
import { useEffect, useRef, useState } from "react";
import { decodeRecord, engineFromRecord } from "@/sand/sandRecord";
import { playOnce, type PlayHandle } from "@/sand/sandPlay";

const TARGET_SEC = 20;
const HOLD_MS = 2500;
/** 부모(선행쌤)에 알린다 — 못 그리면 부모가 그림 한 장으로 돌아간다. 담는 건 됐다/안 됐다뿐이라 받는 쪽을 가리지 않는다 */
const tell = (ok: boolean) => {
  try {
    window.parent?.postMessage({ t: "arton-replay", ok }, "*");
  } catch {}
};

export function ShowcasePlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<[number, number] | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get("id") || "";
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
      setBad(true);
      tell(false);
      return;
    }
    let alive = true;
    let cur: PlayHandle | null = null;
    /** 지금 기다리는 것(완성 장면 붙잡기·숨은 탭)을 바로 푼다 — 정리할 때도 불러 고리가 남지 않게 */
    let wake: (() => void) | null = null;
    const wait = (ms?: number) =>
      new Promise<void>((r) => {
        const t = ms == null ? 0 : window.setTimeout(() => wake?.(), ms);
        wake = () => {
          window.clearTimeout(t);
          wake = null;
          r();
        };
      });
    // 탭이 숨으면 그리던 것도 멈추고, 다시 보이면 처음부터 그린다
    const onVis = () => {
      if (document.hidden) cur?.stop();
      else wake?.();
    };
    document.addEventListener("visibilitychange", onVis);
    (async () => {
      const blob = await fetch(`/api/showcase/${id}/replay`)
        .then((r) => (r.ok ? r.blob() : null))
        .catch(() => null);
      const rec = blob ? await decodeRecord(blob) : null;
      let eng = null;
      try {
        eng = rec ? engineFromRecord(rec) : null;
      } catch {
        eng = null;
      }
      if (!alive) return;
      const canvas = canvasRef.current;
      if (!eng || !canvas) {
        setBad(true);
        tell(false);
        return;
      }
      canvas.width = eng.w;
      canvas.height = eng.h;
      setDims([eng.w, eng.h]);
      tell(true);
      while (alive) {
        if (document.hidden) {
          await wait();
          continue;
        }
        cur = playOnce(canvas, eng, { targetSec: TARGET_SEC });
        const finished = await cur.done;
        if (!alive) return;
        if (finished) await wait(HOLD_MS);
      }
    })();
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      cur?.stop();
      wake?.();
    };
  }, []);

  return (
    <main className="fixed inset-0 grid place-items-center bg-[#2b2118]" data-testid="showcase-play" data-state={bad ? "bad" : dims ? "playing" : "loading"}>
      <canvas
        ref={canvasRef}
        aria-label="그리는 과정"
        className="block max-h-full max-w-full"
        style={dims ? { aspectRatio: `${dims[0]} / ${dims[1]}`, width: "100%", height: "100%", objectFit: "contain" } : { display: "none" }}
      />
    </main>
  );
}
