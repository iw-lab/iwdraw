/*
 * 저사양 렉 계측 받기(/api/perf) — 기술 수치만 받아 정해진 칸으로 깎는다(클라 신뢰 금지).
 * 별명·학급·IP 는 받지도 저장하지도 않는다. 하루 상한 PERF_DAY_MAX 행, 30일 뒤 cron 이 지운다.
 */
export const PERF_DAY_MAX = 300;
export const PERF_KEEP_MS = 30 * 24 * 3600 * 1000;

const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v * 100) / 100) : 0);
const word = (v: unknown, allow: RegExp) => (typeof v === "string" && v.length <= 20 && allow.test(v) ? v : "");

export function sanitizePerf(b: unknown): Record<string, string | number> | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const page = word(o.page, /^(draw|sand)$/);
  if (!page) return null;
  return {
    page,
    n: num(o.n, 10_000),
    med: num(o.med, 60_000),
    p75: num(o.p75, 60_000),
    p90: num(o.p90, 60_000),
    max: num(o.max, 600_000),
    backend: word(o.backend, /^[a-z0-9]+$/),
    brush: word(o.brush, /^[a-z0-9_-]+$/),
    layers: num(o.layers, 100),
    bw: num(o.bw, 20_000),
    bh: num(o.bh, 20_000),
    cw: num(o.cw, 20_000),
    ch: num(o.ch, 20_000),
    dpr: num(o.dpr, 10),
    cores: num(o.cores, 256),
    mem: num(o.mem, 1024),
    os: word(o.os, /^[a-z]+$/),
  };
}
