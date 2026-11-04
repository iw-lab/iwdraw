"use client";

/*
 * 샌드아트 무비 — 기록(base + ops)을 빈 판에 다시 넣어 «그려지는 과정»을 보여 준다.
 * 모래판은 결정적이라(SandSim 머리 주석) 마지막 장면 = 지금 그림.
 * 영상 저장 = 같은 재생을 canvas.captureStream 으로 webm 에 담는다.
 */
import { useEffect, useRef, useState } from "react";
import { SandSim } from "@/sand/SandSim";
import { SandRender } from "@/sand/SandRender";
import { dequantize, type SandEngine } from "@/sand/SandEngine";

/** 재생 길이 목표(초) — 점 수가 많아도 이 안에 끝난다(빠르게 = 절반) */
const TARGET_SEC = 24;

export function SandMovie({ engine, onClose }: { engine: SandEngine; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [fast, setFast] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  const canRecord = typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;

  /** 처음부터 끝까지 한 번 재생. 끝나면 resolve */
  const run = (speedMul: number): Promise<void> =>
    new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) return resolve();
      const ctx = canvas.getContext("2d", { alpha: false })!;
      const sim = new SandSim(engine.w, engine.h);
      if (engine.base) dequantize(engine.base, sim.H);
      const r = new SandRender(sim, engine.grain, engine.render.look);
      const ops = engine.ops.slice();
      const total = ops.reduce((a, o) => a + (o.k === "stroke" ? Math.max(1, o.d.length / 3) : 30), 0);
      const perFrame = Math.max(1, Math.ceil((total / (TARGET_SEC * 60)) * speedMul));
      let oi = 0;
      let di = 0;
      let done = 0;
      let raf = 0;
      let stopped = false;
      const paint = () => {
        const d = sim.takeDirty();
        if (!d) return;
        r.paint(d.x0, d.y0, d.x1, d.y1);
        ctx.putImageData(r.img, 0, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      };
      sim.markAll();
      paint();
      const step = () => {
        if (stopped) return;
        let budget = perFrame;
        while (budget > 0 && oi < ops.length) {
          const op = ops[oi];
          if (op.k !== "stroke") {
            sim.apply(op);
            budget -= 30;
            done += 30;
            oi++;
            continue;
          }
          if (di === 0) sim.begin(op.tool, op.size, op.seed, op.pv ?? 1);
          const n = op.d.length;
          while (budget > 0 && di < n) {
            sim.dab(op.d[di], op.d[di + 1], op.d[di + 2]);
            di += 3;
            budget--;
            done++;
          }
          if (di >= n) {
            sim.end();
            di = 0;
            oi++;
          }
        }
        paint();
        setProgress(Math.min(1, done / Math.max(1, total)));
        if (oi >= ops.length) {
          stopRef.current = () => {};
          return resolve();
        }
        raf = requestAnimationFrame(step);
      };
      stopRef.current = () => {
        stopped = true;
        cancelAnimationFrame(raf);
        resolve();
      };
      raf = requestAnimationFrame(step);
    });

  const play = async () => {
    stopRef.current();
    setPlaying(true);
    await run(fast ? 2 : 1);
    setPlaying(false);
  };

  const record = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !canRecord) return;
    stopRef.current();
    setRecording(true);
    try {
      const stream = canvas.captureStream(30);
      const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 4_000_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stoppedP = new Promise<void>((res) => (rec.onstop = () => res()));
      rec.start(250);
      await run(fast ? 2 : 1);
      // 마지막 장면을 1.5초 붙잡아 둔다(영상이 완성 그림에서 끝나게)
      await new Promise((r) => setTimeout(r, 1500));
      rec.stop();
      await stoppedP;
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arton-sand-movie-${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setRecording(false);
    }
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (c) {
      c.width = engine.w;
      c.height = engine.h;
    }
    void play();
    return () => stopRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const portrait = engine.h > engine.w;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4" role="dialog" aria-modal="true" aria-label="샌드아트 무비" data-testid="sand-movie">
      <div className={`w-full rounded-bubble bg-paper p-5 shadow-lift ${portrait ? "max-w-md" : "max-w-3xl"}`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl text-ink">모래 그림 무비</h2>
          <button onClick={onClose} className="pressable touch-target grid place-items-center text-xl" aria-label="닫기">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <canvas ref={canvasRef} className="w-full rounded-[10px] bg-[#2b2118]" style={{ aspectRatio: `${engine.w} / ${engine.h}`, maxHeight: "65vh", objectFit: "contain" }} data-testid="sand-movie-canvas" />
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-coral transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} data-testid="sand-movie-progress" data-progress={progress.toFixed(3)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => void play()} disabled={recording} className="pressable touch-target flex-1 rounded-card bg-coral px-4 py-3 font-display text-white disabled:opacity-50" data-testid="sand-movie-play">
            {playing ? "처음부터 다시" : "다시 보기"}
          </button>
          <button onClick={() => setFast((f) => !f)} aria-pressed={fast} className="pressable touch-target rounded-card bg-surface-2 px-4 py-3 font-semibold text-ink">
            {fast ? "빠르게" : "보통 빠르기"}
          </button>
          {canRecord && (
            <button onClick={() => void record()} disabled={recording} className="pressable touch-target rounded-card bg-surface-2 px-4 py-3 font-semibold text-ink disabled:opacity-50" data-testid="sand-movie-record">
              {recording ? "영상 만드는 중…" : "영상으로 저장"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
