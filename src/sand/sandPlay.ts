/*
 * 샌드아트 «그리는 과정» 한 번 재생 — 기록(base + ops)을 빈 판에 다시 넣어 캔버스에 그린다.
 * 학급 갤러리 무비(SandMovie)와 선행쌤 전시관 반복 재생(/showcase/play)이 같은 고리를 쓴다(2026-11-17).
 * 모래판은 결정적이라(SandSim 머리 주석) 마지막 장면 = 완성 그림.
 */
import { SandRender } from "./SandRender";
import type { SandEngine } from "./SandEngine";

export interface PlayHandle {
  /** 끝까지 그렸으면 true, 중간에 멈추면 false */
  done: Promise<boolean>;
  stop: () => void;
}

/** 처음부터 끝까지 한 번. targetSec 안에 끝나게 프레임마다 점을 몰아 찍는다 */
export function playOnce(
  canvas: HTMLCanvasElement,
  engine: SandEngine,
  { targetSec, speedMul = 1, onProgress }: { targetSec: number; speedMul?: number; onProgress?: (p: number) => void },
): PlayHandle {
  let stop = () => {};
  const done = new Promise<boolean>((resolve) => {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return resolve(false);
    const sim = engine.replaySim();
    const r = new SandRender(sim, engine.grain, engine.render.look);
    const ops = engine.ops.slice();
    const total = ops.reduce((a, o) => a + (o.k === "stroke" ? Math.max(1, o.d.length / 3) : 30), 0);
    const perFrame = Math.max(1, Math.ceil((total / (targetSec * 60)) * speedMul));
    let oi = 0;
    let di = 0;
    let n = 0;
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
          n += 30;
          oi++;
          continue;
        }
        if (di === 0) sim.beginOp(op);
        const len = op.d.length;
        while (budget > 0 && di < len) {
          sim.dab(op.d[di], op.d[di + 1], op.d[di + 2]);
          di += 3;
          budget--;
          n++;
        }
        if (di >= len) {
          sim.end();
          di = 0;
          oi++;
        }
      }
      paint();
      onProgress?.(Math.min(1, n / Math.max(1, total)));
      if (oi >= ops.length) {
        stop = () => {};
        return resolve(true);
      }
      raf = requestAnimationFrame(step);
    };
    stop = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      resolve(false);
    };
    raf = requestAnimationFrame(step);
  });
  return { done, stop: () => stop() };
}
