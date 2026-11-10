/*
 * 샌드아트 «그린 과정 기록» — 학급 갤러리에 영상 대신 올린다(2026-11-10 사용자 «샌드아트는 영상을 공유해야 큰 의미»).
 *
 * 왜 영상이 아닌가: 무비 webm 은 24초 × 4Mbps ≈ 12MB(업로드 상한 8MB 초과) · 한 반 25명이면 와이파이로 300MB.
 * 모래판은 결정적(SandSim 머리 주석)이라 base + ops 만 있으면 갤러리에서 같은 무비를 다시 그린다.
 * 형식 = JSON → gzip(CompressionStream). 첫 두 바이트 1f 8b 를 서버가 확인한다.
 */
import { SAND_DIMS, SandEngine, isSandSaved, validOp, type SandSaved } from "./SandEngine";
import { clampBright, type SandLook } from "./SandRender";
import { validRGB, type SandOp } from "./SandSim";

export const RECORD_MIME = "application/x-arton-sand";
/** 기록 상한(압축 뒤) — 넘으면 기록 없이 그림만 낸다(서버도 같은 값으로 거른다) */
export const RECORD_MAX = 4 * 1024 * 1024;

interface RecordJson {
  k: "arton-sand";
  v: 1;
  w: number;
  h: number;
  look: SandLook;
  def: [number, number, number];
  base: string | null;
  baseC: string | null;
  ops: SandOp[];
}

const toB64 = (u: Uint16Array) => {
  const b = new Uint8Array(u.buffer, u.byteOffset, u.byteLength);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string, n: number): Uint16Array | null => {
  try {
    const bin = atob(s);
    if (bin.length !== n * 2) return null;
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return new Uint16Array(b.buffer);
  } catch {
    return null;
  }
};

async function pipe(data: Blob, ts: CompressionStream | DecompressionStream): Promise<Blob> {
  return await new Response(data.stream().pipeThrough(ts as unknown as TransformStream<Uint8Array, Uint8Array>)).blob();
}

/** 지금 그림의 기록 → 압축 Blob. 너무 크면 null(그림만 낸다) */
export async function encodeRecord(eng: SandEngine, look: SandLook): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined" || eng.empty) return null;
  const s = eng.snapshot("rec");
  const j: RecordJson = {
    k: "arton-sand",
    v: 1,
    w: s.w,
    h: s.h,
    look: { light: look.light, light2: look.light2, sand: look.sand, bright: clampBright(look.bright) },
    def: s.defColor ?? [34, 26, 20],
    base: s.base ? toB64(s.base) : null,
    baseC: s.baseC ? toB64(s.baseC) : null,
    ops: s.ops,
  };
  const gz = await pipe(new Blob([JSON.stringify(j)]), new CompressionStream("gzip"));
  if (gz.size > RECORD_MAX) return null;
  return new Blob([gz], { type: RECORD_MIME });
}

/** 풀린 기록 상한 — 기록 상한(LOG_MAX_NUMS 60만 숫자 ≈ JSON 6MB + 판 두 장 b64 2.3MB)의 넉넉한 몇 배 */
export const UNZIP_MAX = 48 * 1024 * 1024;

/** 압축 폭탄 막기: 풀면서 세다가 상한을 넘으면 멈춘다(.text() 로 통째로 풀면 4MB 가 수 GB 로 부풀어 탭이 죽는다) */
async function gunzipCapped(blob: Blob, max: number): Promise<string | null> {
  const rd = blob.stream().pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await rd.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return await new Blob(parts as BlobPart[]).text();
}

export interface SandRecord {
  w: number;
  h: number;
  look: SandLook;
  saved: SandSaved;
}

/** 압축 기록 → 다시 그릴 준비. 손상·조작된 기록은 null */
export async function decodeRecord(blob: Blob): Promise<SandRecord | null> {
  try {
    if (typeof DecompressionStream === "undefined" || blob.size > RECORD_MAX) return null;
    const text = await gunzipCapped(blob, UNZIP_MAX);
    if (text === null) return null;
    const j = JSON.parse(text) as RecordJson;
    if (!j || j.k !== "arton-sand" || j.v !== 1 || !Array.isArray(j.ops)) return null;
    // 크기부터 — 조작된 w·h(32768²)로 배열을 먼저 만들면 2GB 를 잡는다(교차검증 codex)
    if (!SAND_DIMS.some(([w, h]) => j.w === w && j.h === h)) return null;
    const n = j.w * j.h;
    const base = j.base ? fromB64(j.base, n) : null;
    const baseC = j.baseC ? fromB64(j.baseC, n) : null;
    const lk = j.look ?? ({} as SandLook);
    const look: SandLook = {
      light: validRGB(lk.light) ? lk.light : [255, 214, 140],
      light2: validRGB(lk.light2) ? lk.light2 : undefined,
      sand: validRGB(lk.sand) ? lk.sand : [34, 26, 20],
      bright: clampBright(lk.bright),
    };
    const saved: SandSaved = {
      v: 1,
      w: j.w,
      h: j.h,
      cur: new Uint16Array(n),
      base,
      baseC,
      curC: undefined,
      defColor: validRGB(j.def) ? j.def : look.sand,
      ops: j.ops.filter(validOp),
      draftId: "rec",
      savedAt: 0,
    };
    if (!isSandSaved(saved)) return null;
    return { w: j.w, h: j.h, look, saved };
  } catch {
    return null;
  }
}

/** 기록을 다시 그릴 엔진(화면에 붙이지 않음) — 무비 컴포넌트가 이걸로 처음부터 다시 그린다 */
export function engineFromRecord(r: SandRecord): SandEngine {
  const e = new SandEngine(r.w, r.h, { ...r.look, sand: r.saved.defColor ?? r.look.sand });
  e.restore(r.saved);
  // 끝 장면 = base + ops (무비 끝과 같다)
  const sim = e.replaySim();
  for (const op of e.ops) sim.apply(op);
  e.sim.H.set(sim.H);
  e.sim.C.set(sim.C);
  return e;
}
