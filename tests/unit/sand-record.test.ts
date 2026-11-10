// @vitest-environment node
// 샌드아트 «그린 과정 기록» — 갤러리에 영상 대신 올리는 압축 기록(2026-11-10)
import { describe, expect, it } from "vitest";
import { SandEngine } from "@/sand/SandEngine";
import { LIGHTS, SANDS } from "@/sand/SandRender";
import { decodeRecord, encodeRecord, engineFromRecord, RECORD_MAX } from "@/sand/sandRecord";
import type { SandOp } from "@/sand/SandSim";

const look = { light: LIGHTS[8].rgb, light2: LIGHTS[8].rgb2, sand: SANDS[0].rgb, bright: 0.8 };

/** 아이가 3분 남짓 그린 그림 — 붓질 60개 × 점 150개(60Hz 2.5초), 색 셋 */
function drawLikeAKid(e: SandEngine) {
  e.fill();
  const colors = [SANDS[0].rgb, SANDS[3].rgb, SANDS[5].rgb];
  for (let s = 0; s < 60; s++) {
    const tool = (["pour", "finger", "palm"] as const)[s % 3];
    const d: number[] = [];
    for (let i = 0; i < 150; i++) d.push(Math.round((100 + i * 4 + Math.sin(i / 7 + s) * 30) * 100) / 100, Math.round((80 + (s % 20) * 20 + Math.cos(i / 9) * 25) * 100) / 100, i ? 16.7 : 0);
    const op: SandOp = { k: "stroke", tool, size: 12 + (s % 5) * 6, seed: 1000 + s, d, pv: 4, ...(tool === "pour" ? { c: colors[s % 3] } : {}) };
    e.sim.apply(op);
    (e as unknown as { commit(o: SandOp): void }).commit(op);
  }
}

describe("그린 과정 기록", { timeout: 90_000 }, () => {
  it("올렸다 받아 다시 그리면 같은 그림(두께·색) · 빛 색·밝기도 따라온다", async () => {
    const e = new SandEngine(800, 533, look);
    drawLikeAKid(e);
    const blob = (await encodeRecord(e, look))!;
    expect(blob).not.toBeNull();
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect([head[0], head[1]], "gzip 머리(서버가 확인)").toEqual([0x1f, 0x8b]);
    const r = (await decodeRecord(blob))!;
    expect(r).not.toBeNull();
    expect(r.look.bright).toBeCloseTo(0.8);
    expect(r.look.light2).toEqual(LIGHTS[8].rgb2);
    const back = engineFromRecord(r);
    let dh = 0, dc = 0;
    for (let i = 0; i < e.sim.H.length; i++) dh = Math.max(dh, Math.abs(back.sim.H[i] - e.sim.H[i]));
    for (let i = 0; i < e.sim.C.length; i++) dc = Math.max(dc, Math.abs(back.sim.C[i] - e.sim.C[i]));
    expect(dh).toBeLessThan(1e-4);
    expect(dc).toBeLessThan(1e-2);
    console.log(`SAND_RECORD bytes=${blob.size} ops=${e.ops.length}`);
    // 영상(≈12MB)의 1/20 아래
    expect(blob.size).toBeLessThan(600_000);
  });

  it("접힌 기록(base 있음)도 같은 그림", async () => {
    const e = new SandEngine(800, 533, look);
    drawLikeAKid(e);
    e.ops = e.ops.slice(1); // 쏟기는 판 전체를 덮어 base 색을 지운다 — base 가 보이게 뺀다
    e.base = new Uint16Array(800 * 533).fill(3000);
    e.baseC = new Uint16Array(800 * 533).fill(0xf800);
    const sim = e.replaySim();
    for (const op of e.ops) sim.apply(op);
    const r = (await decodeRecord((await encodeRecord(e, look))!))!;
    const back = engineFromRecord(r);
    let dh = 0;
    for (let i = 0; i < sim.H.length; i++) dh = Math.max(dh, Math.abs(back.sim.H[i] - sim.H[i]));
    expect(dh).toBeLessThan(1e-4);
    expect(back.sim.C[0]).toBeGreaterThan(200); // base 색(빨강)이 살아 있다
  });

  it("손상·조작된 기록은 null(죽지 않는다)", async () => {
    expect(await decodeRecord(new Blob(["not gzip"]))).toBeNull();
    const gz = async (s: string) => new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>)).blob();
    expect(await decodeRecord(await gz('{"k":"arton-sand","v":1,"w":99999,"h":99999,"ops":[]}'))).toBeNull();
    expect(await decodeRecord(await gz('{"k":"other"}'))).toBeNull();
    // 조작된 큰 판(32768²) — 배열을 만들기 전에 거른다(2GB 할당 금지 · 교차검증 codex)
    const t0 = performance.now();
    expect(await decodeRecord(await gz('{"k":"arton-sand","v":1,"w":32768,"h":32768,"ops":[]}'))).toBeNull();
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(await decodeRecord(new Blob([new Uint8Array(RECORD_MAX + 1)]))).toBeNull();
    // 압축 폭탄: 0 으로 가득 찬 64MB → 수십 KB gzip. 풀다가 멈춰야 한다
    const bomb = await new Response(new Blob([new Uint8Array(64 * 1024 * 1024)]).stream().pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>)).blob();
    expect(bomb.size).toBeLessThan(RECORD_MAX);
    expect(await decodeRecord(bomb)).toBeNull();
  });
});

describe("서버: 기록 받기 관문(worker/lib/sand-record)", () => {
  it("진짜 기록은 받고 · gzip 아닌 것·빈 것·너무 큰 것은 버린다", async () => {
    const { isSandRecord, SAND_RECORD_MAX } = await import("../../worker/lib/sand-record");
    const e = new SandEngine(800, 533, look);
    e.fill();
    const blob = (await encodeRecord(e, look))!;
    expect(isSandRecord(await blob.arrayBuffer())).toBe(true);
    expect(isSandRecord(new TextEncoder().encode("<script>alert(1)</script>-----").buffer)).toBe(false);
    expect(isSandRecord(new ArrayBuffer(0))).toBe(false);
    const big = new Uint8Array(SAND_RECORD_MAX + 1);
    big.set([0x1f, 0x8b, 0x08]);
    expect(isSandRecord(big.buffer)).toBe(false);
    expect(RECORD_MAX).toBe(SAND_RECORD_MAX);
  });
});
