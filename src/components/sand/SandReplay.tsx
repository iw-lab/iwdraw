"use client";

/*
 * 갤러리 «그리는 과정 보기» — 올라온 샌드아트 기록(.sand)을 받아 무비로 다시 그린다(2026-11-10).
 * 영상 파일이 아니라 기록이라 수십 KB만 받는다. 모래판 엔진은 이 단추를 누를 때만 내려받는다(갤러리 번들 가볍게).
 */
import { useState } from "react";
import { SandMovie } from "./SandMovie";
import { decodeRecord, engineFromRecord } from "@/sand/sandRecord";
import type { SandEngine } from "@/sand/SandEngine";

export function SandReplay({ load }: { load: () => Promise<Blob | null> }) {
  const [eng, setEng] = useState<SandEngine | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "bad">("idle");
  const open = async () => {
    setState("loading");
    const blob = await load().catch(() => null);
    const rec = blob ? await decodeRecord(blob) : null;
    let e: SandEngine | null = null;
    try {
      e = rec ? engineFromRecord(rec) : null;
    } catch {
      e = null;
    }
    setEng(e);
    setState(e ? "idle" : "bad");
  };
  return (
    <>
      <button
        onClick={() => void open()}
        disabled={state === "loading"}
        className="pressable touch-target shrink-0 rounded-card bg-coral px-4 py-2 font-display text-white disabled:opacity-60"
        data-testid="sand-replay"
      >
        {state === "loading" ? "불러오는 중…" : state === "bad" ? "과정을 못 불러왔어요" : "▶ 그리는 과정"}
      </button>
      {eng && <SandMovie engine={eng} onClose={() => setEng(null)} />}
    </>
  );
}
