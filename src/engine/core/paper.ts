/*
 * 종이/캔버스 결 텍스처 — 프로시저럴 타일러블(256px), 종이 종류별.
 * i-scream류 상용앱처럼 모드가 캔버스를 결정한다:
 *   linen(유화)  = 씨실·날실 위브가 뚜렷한 캔버스천
 *   cotton(수채) = 위브 없는 셀룰로스 요철 수채용지
 *   smooth(스케치·색칠) = 매끈한 도화지(아주 은은)
 *   hanji(붓펜)  = 화선지 — 흡수성 얼룩 + 닥나무 긴 섬유 가닥
 * 1) grainTile: 알파맵 — 결의 골짜기(안료가 덜 앉는 곳). dab 셰이더/endStroke에서
 *    스트로크에 "물감이 종이 결 위에 앉은" 질감을 만든다.
 * 2) tintTile: 표시용 종이 결 — compositeNow에서 흰 종이 위에 깔린다(내보내기엔 미포함).
 */

import { packField, sealPaperPack } from "./paperPack";

const TILE = 256;

/** 시드 고정 난수(mulberry32) — 예전엔 Math.random 이라 새로고침마다 결이 바뀌었다
 * (무비 재생·협동에서 원본과 결이 달라짐). 종이마다 고정 시드. */
function seededRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PaperKind = "linen" | "cotton" | "smooth" | "hanji";

/** 타일 경계에서 이어지는(wrap) 밸류 노이즈 */
function latticeNoise(size: number, cells: number, rand: () => number): Float32Array {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size);
  const k = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * k;
    const y0 = Math.floor(fy) % cells;
    const y1 = (y0 + 1) % cells;
    const ty = fy - Math.floor(fy);
    for (let x = 0; x < size; x++) {
      const fx = x * k;
      const x0 = Math.floor(fx) % cells;
      const x1 = (x0 + 1) % cells;
      const tx = fx - Math.floor(fx);
      const a = lat[y0 * cells + x0];
      const b = lat[y0 * cells + x1];
      const c = lat[y1 * cells + x0];
      const d = lat[y1 * cells + x1];
      out[y * size + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

/** 가로/세로 씨실·날실 스트라이프(린넨 위브) — wrap 스무딩.
 * spread<1이면 올 굵기 편차를 0.5 중심으로 압축 — 진한 올 뭉침(얼룩) 억제(표시 틴트용) */
function weaveLine(size: number, rand: () => number, spread = 1): Float32Array {
  const raw = new Float32Array(size);
  for (let i = 0; i < size; i++) raw[i] = 0.5 + (rand() - 0.5) * spread;
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = (raw[(i - 1 + size) % size] + raw[i] * 2 + raw[(i + 1) % size]) / 4;
  }
  return out;
}

interface PaperRecipe {
  /** 필드 배합 — 고주파 위주(저주파가 크면 "얼룩"처럼 보인다, 2026-07-03 실측) */
  make(): Float32Array;
  /** 침식 알파 곡선 */
  grainLo: number;
  grainHi: number;
  /** 표시 틴트 곡선·최대 알파 */
  tintLo: number;
  tintHi: number;
  tintAlpha: number;
  /** 틴트 감마(<1 = 중간값을 끌어올려 고른 결) — 높은 알파+랜덤 강도는 진한 자국이
   * 뭉쳐 "얼룩"으로 읽힌다(2026-07-07 사용자 실측) → 옅고 균일하게 넓게 깔기 */
  tintGamma: number;
  /** 표시 틴트 전용 필드(없으면 침식 필드 공유) — 침식은 강약 대비가 필요하지만
   * 표시는 균일해야 한다: 같은 필드를 쓰면 대비 클러스터가 얼룩으로 보인다(2026-07-07) */
  makeTint?(): Float32Array;
  /** 표시 틴트 타일 크기(기본 TILE) — 균일 직조는 특징 줄이 적어 256 반복이 격자로
   * 읽힌다(린넨 실측) → 512로 반복 주기 완화 */
  tintSize?: number;
}

const RECIPES: Record<PaperKind, PaperRecipe> = {
  linen: {
    make() {
      const rand = seededRand(11);
      const n2 = latticeNoise(TILE, 96, rand);
      const rows = weaveLine(TILE, rand);
      const cols = weaveLine(TILE, rand);
      const f = new Float32Array(TILE * TILE);
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const i = y * TILE + x;
          // 씨실·날실이 지배하는 균일 직조 — 저주파 덩어리 노이즈(28cell)는 틴트를
          // 키우면 얼룩으로 읽힌다(사용자 실측 2회) → 제거, 고주파만 소량 섞는다
          f[i] = 0.14 * n2[i] + 0.43 * rows[y] + 0.43 * cols[x];
        }
      return f;
    },
    grainLo: 0.55,
    grainHi: 0.85,
    // 위브는 "고르게 옅게" — 압축 필드(0.5±0.15)에서 임계가 평균보다 높으면(0.56~)
    // 드문 교차점만 남아 패치 클러스터(얼룩 재발). 평균을 가로지르는 완만한 곡선이 정답
    tintLo: 0.48,
    tintHi: 0.68,
    // 32: 실물 평직 팩은 고른 결이라 진하게 깔아도 «얼룩»이 안 생긴다(그 지적은 옛 프로시저럴 노이즈의
    // 덩어리 탓) — 아트봉봉처럼 빈 캔버스에서 천 결이 보이게(2026-10-07)
    tintAlpha: 32,
    tintGamma: 0.85,
    // 표시 전용: 올 굵기 편차 압축(spread 0.4) — 실제 캔버스천처럼 균일한 직조
    tintSize: 512,
    makeTint() {
      const rand = seededRand(12);
      const S = 512;
      const n2 = latticeNoise(S, 256, rand);
      const rows = weaveLine(S, rand, 0.4);
      const cols = weaveLine(S, rand, 0.4);
      const f = new Float32Array(S * S);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const i = y * S + x;
          // 노이즈는 양념(0.12) — 크면 올 사이가 뿌옇게 번진 얼룩으로 보인다(2026-07-07)
          f[i] = 0.12 * n2[i] + 0.44 * rows[y] + 0.44 * cols[x];
        }
      return f;
    },
  },
  cotton: {
    make() {
      const rand = seededRand(13);
      // 위브 없는 셀룰로스 요철 — 초고주파 미세 입자만. 60cell(4px급) 성분은 깊은 골이
      // 뭉쳐 획 안에 "점 클러스터"로 찍힌다(2026-07-07 사용자 실측 → 제거).
      const n2 = latticeNoise(TILE, 130, rand);
      const n3 = latticeNoise(TILE, 170, rand);
      const f = new Float32Array(TILE * TILE);
      for (let i = 0; i < f.length; i++) f[i] = 0.8 * n2[i] + 0.2 * n3[i];
      return f;
    },
    // 임계 상향 = 가장 깊은 골에만 침식 → 드문드문한 잔입자(granulation)
    grainLo: 0.62,
    grainHi: 0.9,
    // 요철은 보이되 균일하게 — 알파 32는 입자 뭉침이 때 탄 종이로 읽힘(2026-07-07 실측)
    tintLo: 0.58,
    tintHi: 0.94,
    tintAlpha: 15,
    tintGamma: 0.75,
    // 표시 전용: 초고주파만 — 중간 크기(60cell) 성분은 옅은 반점 클러스터를 만든다
    makeTint() {
      const rand = seededRand(14);
      const n2 = latticeNoise(TILE, 130, rand);
      const n3 = latticeNoise(TILE, 190, rand);
      const f = new Float32Array(TILE * TILE);
      for (let i = 0; i < f.length; i++) f[i] = 0.65 * n2[i] + 0.35 * n3[i];
      return f;
    },
  },
  hanji: {
    make() {
      // 흡수성 얼룩 — 먹이 스미는 자리의 부드러운 요철 + 미세 입자.
      // 침식(붓펜 paperGrain)이 이 필드를 쓰므로 cotton보다 살짝 큰 결로 스밈을 만든다.
      const rand = seededRand(15);
      const n1 = latticeNoise(TILE, 80, rand);
      const n2 = latticeNoise(TILE, 150, rand);
      const f = new Float32Array(TILE * TILE);
      for (let i = 0; i < f.length; i++) f[i] = 0.55 * n1[i] + 0.45 * n2[i];
      return f;
    },
    grainLo: 0.58,
    grainHi: 0.88,
    tintLo: 0.55,
    tintHi: 0.9,
    tintAlpha: 13,
    tintGamma: 0.8,
    tintSize: 512,
    makeTint() {
      // 화선지의 인상은 "긴 섬유"가 만든다 — 옅은 셀룰로스 바탕 위에
      // 닥나무 섬유 가닥(임의 각도로 완만히 휘는 1px 궤적, 타일 wrap)을 얹는다.
      // ⚠️ 절제 필수: 곡률·개수·강도가 크면 종이가 "곱슬 낙서로 더럽혀진" 것으로
      // 읽힌다(2026-07-10 실측 — 90가닥·곡률 0.06·강도 0.7은 낙서장).
      // ⚠️⚠️ 2026-07-13 재실측(사용자, 웨일북): 빈 캔버스를 최대로 확대하면 가닥이
      // "쓸데없는 선"으로 읽힌다 — 줌 배율만큼 궤적도 확대되기 때문. 섬유 자체는
      // 화선지의 정체성이라 유지하되(사용자 판단), 강도를 절반으로(0.14~0.24) 낮춰
      // 100% 배율에선 결로, 확대해도 낙서선으로 읽히지 않게 한다.
      const rand = seededRand(16);
      const S = 512;
      const n = latticeNoise(S, 220, rand);
      const f = new Float32Array(S * S);
      for (let i = 0; i < f.length; i++) f[i] = 0.42 + (n[i] - 0.5) * 0.5;
      for (let k = 0; k < 34; k++) {
        let x = rand() * S;
        let y = rand() * S;
        let a = rand() * Math.PI * 2;
        const len = 30 + rand() * 80;
        const curve = (rand() - 0.5) * 0.025;
        const str = 0.14 + rand() * 0.1;
        for (let t = 0; t < len; t++) {
          const xi = (Math.round(x) % S + S) % S;
          const yi = (Math.round(y) % S + S) % S;
          f[yi * S + xi] = Math.min(1, f[yi * S + xi] + str);
          x += Math.cos(a);
          y += Math.sin(a);
          a += curve + (rand() - 0.5) * 0.02;
        }
      }
      return f;
    },
  },
  smooth: {
    make() {
      const rand = seededRand(17);
      const n1 = latticeNoise(TILE, 40, rand);
      const n2 = latticeNoise(TILE, 120, rand);
      const f = new Float32Array(TILE * TILE);
      for (let i = 0; i < f.length; i++) f[i] = 0.35 * n1[i] + 0.65 * n2[i];
      return f;
    },
    grainLo: 0.62,
    grainHi: 0.9,
    tintLo: 0.6,
    tintHi: 0.96,
    tintAlpha: 9,
    tintGamma: 1,
  },
};

const fields = new Map<PaperKind, Float32Array>();
const tintFields = new Map<PaperKind, Float32Array>();
const grainTiles = new Map<PaperKind, HTMLCanvasElement>();
const tintTiles = new Map<PaperKind, HTMLCanvasElement>();
const tintPatterns = new Map<PaperKind, CanvasPattern>();

function field(kind: PaperKind): Float32Array {
  let f = fields.get(kind);
  if (!f) {
    sealPaperPack();
    f = RECIPES[kind].make();
    // 실물 결 팩이 있으면 공간 구조만 갈아 끼운다(값 분포 = 프로시저럴 그대로 → 곡선·상수 유효)
    f = packField(kind, "grain", f, TILE) ?? f;
    fields.set(kind, f);
  }
  return f;
}

function tintField(kind: PaperKind): Float32Array {
  let f = tintFields.get(kind);
  if (!f) {
    const r = RECIPES[kind];
    sealPaperPack();
    f = r.makeTint ? r.makeTint() : RECIPES[kind].make();
    f = packField(kind, "tint", f) ?? (r.makeTint ? f : field(kind));
    tintFields.set(kind, f);
  }
  return f;
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** 안료 침식용 알파 타일(흰색, alpha=골짜기 깊이) */
export function paperGrainTile(kind: PaperKind = "linen"): HTMLCanvasElement {
  let tile = grainTiles.get(kind);
  if (tile) return tile;
  const r = RECIPES[kind];
  const f = field(kind);
  tile = document.createElement("canvas");
  tile.width = tile.height = TILE;
  const ctx = tile.getContext("2d")!;
  const img = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < f.length; i++) {
    const a = smoothstep(r.grainLo, r.grainHi, f[i]);
    const p = i * 4;
    img.data[p] = 255;
    img.data[p + 1] = 255;
    img.data[p + 2] = 255;
    img.data[p + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  grainTiles.set(kind, tile);
  return tile;
}

/** 표시용 종이 결 타일(어두운 섬유, 옅게) */
export function paperTintTile(kind: PaperKind = "linen"): HTMLCanvasElement {
  let tile = tintTiles.get(kind);
  if (tile) return tile;
  const r = RECIPES[kind];
  const f = tintField(kind);
  // 크기는 필드에서 — 팩 tint(256)가 레시피 tintSize(512)를 대신할 수 있다
  const size = Math.round(Math.sqrt(f.length));
  tile = document.createElement("canvas");
  tile.width = tile.height = size;
  const ctx = tile.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < f.length; i++) {
    const d = Math.pow(smoothstep(r.tintLo, r.tintHi, f[i]), r.tintGamma);
    const p = i * 4;
    img.data[p] = 92;
    img.data[p + 1] = 84;
    img.data[p + 2] = 72;
    img.data[p + 3] = Math.round(d * r.tintAlpha);
  }
  ctx.putImageData(img, 0, 0);
  tintTiles.set(kind, tile);
  return tile;
}

/**
 * 스트로크 버퍼에 종이 결 침식 적용(destination-out).
 * strength 0~1 — 결 골짜기에서 안료가 빠져 "종이에 앉은" 질감.
 * (WebGL 경로는 dab 셰이더에서 실시간 처리 — 이 함수는 Canvas2D 폴백용)
 */
export function applyPaperGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
  kind: PaperKind = "linen",
): void {
  const pat = ctx.createPattern(paperGrainTile(kind), "repeat");
  if (!pat) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = Math.min(1, strength);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * 종이 결 "백화" 적용(불투명 매체용) — 알파는 유지하고 획 안에 흰 캔버스 이랑이 배어난다.
 * 알파 침식(applyPaperGrain)이면 겹친 획이 진해져 반투명 마커로 읽힌다(i-scream 비교 실측).
 * dk(0~1, 검을수록 1)로 어두운 색 백색 혼입을 캡 — GL 셰이더의 lift 캡과 체감 정합.
 */
export function applyPaperGrainLift(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
  kind: PaperKind,
  dk: number,
): void {
  const pat = ctx.createPattern(paperGrainTile(kind), "repeat");
  if (!pat) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-atop"; // 획 실루엣 안에서만 백화
  ctx.globalAlpha = Math.min(1, strength * 0.42 * (dk > 0.6 ? 0.4 : 1));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** 표시 캔버스에 종이 결 깔기(내보내기 비포함, compositeNow 전용 — 매 프레임 호출이라 패턴 캐시) */
export function drawPaperTint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  kind: PaperKind = "linen",
): void {
  let pat = tintPatterns.get(kind);
  if (!pat) {
    const p = ctx.createPattern(paperTintTile(kind), "repeat");
    if (!p) return;
    tintPatterns.set(kind, p);
    pat = p;
  }
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, width, height);
}

/* wet edge 작업용 스크래치 캔버스(스트로크마다 재할당 방지).
 * ⚠️ 모듈 싱글턴 — "페이지당 활성 엔진 1개" 가정(CanvasStage 단일 마운트).
 * 멀티 캔버스 동시 렌더가 생기면 백엔드 인스턴스 필드로 옮길 것. */
let wetTmp: CanvasRenderingContext2D | null = null;
let wetBand: CanvasRenderingContext2D | null = null;
let glzSnap: CanvasRenderingContext2D | null = null;
let glzFloor: CanvasRenderingContext2D | null = null;
let glzFlat: CanvasRenderingContext2D | null = null;
let glzWork: CanvasRenderingContext2D | null = null;

function scratch(
  ref: CanvasRenderingContext2D | null,
  width: number,
  height: number,
): CanvasRenderingContext2D {
  if (!ref || ref.canvas.width !== width || ref.canvas.height !== height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    ref = c.getContext("2d")!;
  }
  return ref;
}

/**
 * 수채 wet edge: 획이 마르며 안료가 실루엣 가장자리에 몰리는 효과.
 * 밴드 = 경화(hardened) 스트로크 − blur(경화 스트로크): 실루엣 안쪽 경계에서만 남는다.
 * ⚠️ 경화(자기 자신을 4회 겹쳐 알파 ≈1로) 필수 — buildup 수채는 획 내부 알파가
 * 0.7~0.9로 요동해, 원본 알파로 밴드를 만들면 내부 전체에 ~0.16 밴드가 깔리고
 * 종이결 패턴 마스크가 그걸 3~8px 어두운 반점으로 찍는다(2026-07-10 실측 — 곰팡이/때).
 * 밴드를 source-atop으로 다시 얹어 가장자리 알파(=진하기)를 올린다 —
 * dab 단위 rim 베이크와 달리 획 전체 실루엣 기준이라 겹침 고리가 없다.
 */
export function applyWetEdge(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
  kind: PaperKind = "cotton",
): void {
  wetTmp = scratch(wetTmp, width, height);
  wetBand = scratch(wetBand, width, height);

  // 경화 스트로크(색 유지, 알파만 1로 수렴)
  wetBand.clearRect(0, 0, width, height);
  wetBand.drawImage(ctx.canvas, 0, 0);
  wetBand.drawImage(ctx.canvas, 0, 0);
  wetBand.drawImage(ctx.canvas, 0, 0);
  wetBand.drawImage(ctx.canvas, 0, 0);

  wetTmp.clearRect(0, 0, width, height);
  wetTmp.filter = "blur(7px)";
  wetTmp.drawImage(wetBand.canvas, 0, 0);
  wetTmp.filter = "none";

  wetBand.globalCompositeOperation = "destination-out";
  wetBand.drawImage(wetTmp.canvas, 0, 0);
  wetBand.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalCompositeOperation = "source-atop"; // 실루엣 밖으로 번지지 않게
  // ① 은은한 균일 링(베이스) — 링을 전부 균일하게 진하게 하면 "외곽선"으로 읽힌다
  //    (2026-07-10 codex 교차진단): 실제 수채는 안료가 몰리는 곳이 군데군데다.
  ctx.globalAlpha = Math.min(1, strength) * 0.55;
  ctx.drawImage(wetBand.canvas, 0, 0);
  // ② 종이 결 노이즈로 변조한 링 — 캔버스 고정 패턴이라 결정론(같은 자리는 항상 같은 몰림)
  wetTmp.clearRect(0, 0, width, height);
  wetTmp.drawImage(wetBand.canvas, 0, 0);
  wetTmp.globalCompositeOperation = "destination-in";
  wetTmp.save();
  wetTmp.setTransform(1, 0, 0, 1, 0, 0);
  wetTmp.scale(6, 6); // 결 특징 ~6px → 36px 덩어리로 확대(링을 따라 몰림/빠짐 반복)
  const pat = wetTmp.createPattern(paperGrainTile(kind), "repeat");
  if (pat) {
    wetTmp.fillStyle = pat;
    wetTmp.fillRect(0, 0, Math.ceil(width / 6), Math.ceil(height / 6));
  }
  wetTmp.restore();
  wetTmp.globalCompositeOperation = "source-over";
  ctx.globalAlpha = Math.min(1, strength);
  ctx.drawImage(wetTmp.canvas, 0, 0);
  ctx.drawImage(wetTmp.canvas, 0, 0);
  ctx.restore();
}


/**
 * 유화 임파스토 릴리프: 물감이 도톰하게 올라온 입체감(2026-07-10, 유화 전문가 관점
 * 교차진단 1순위). 광원 좌상단 관례로 획 실루엣의 좌상단 안쪽에 하이라이트,
 * 우하단 안쪽에 그림자를 얇게 얹는다.
 * 밴드 = 경화(4겹)+blur 실루엣 S의 대각 오프셋 차분(S − shift(S)) — 획 내부(자기
 * 교차 포함)는 균일 알파라 차분 0 = 불변, 바깥으로도 안 새어나간다(source-atop).
 * 프리뷰(presentStroke)와 최종(endStroke) 양쪽에서 호출된다(프리뷰=최종 —
 * 손 뗄 때 명암 팝인은 버그로 읽힘, 2026-07-10 사용자 실측).
 */
export function applyImpastoRelief(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
): void {
  const soft = (wetTmp = scratch(wetTmp, width, height));
  const bandCtx = (wetBand = scratch(wetBand, width, height));

  // 부드러운 경화 실루엣 — blur가 릴리프 램프의 폭(부드러움)을 만든다
  bandCtx.clearRect(0, 0, width, height);
  bandCtx.drawImage(ctx.canvas, 0, 0);
  bandCtx.drawImage(ctx.canvas, 0, 0);
  bandCtx.drawImage(ctx.canvas, 0, 0);
  bandCtx.drawImage(ctx.canvas, 0, 0);
  soft.clearRect(0, 0, width, height);
  soft.filter = "blur(2px)";
  soft.drawImage(bandCtx.canvas, 0, 0);
  soft.filter = "none";

  const d = 2.2; // 물감 두께감의 스케일(px) — 굵기 비례가 아니라 물리적 고정
  const band = (dx: number, dy: number, color: string, alpha: number) => {
    bandCtx.clearRect(0, 0, width, height);
    bandCtx.drawImage(soft.canvas, 0, 0);
    bandCtx.globalCompositeOperation = "destination-out";
    bandCtx.drawImage(soft.canvas, dx, dy);
    bandCtx.globalCompositeOperation = "source-in"; // 밴드 알파 유지, 색만 교체
    bandCtx.fillStyle = color;
    bandCtx.fillRect(0, 0, width, height);
    bandCtx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = Math.min(1, strength * alpha);
    ctx.drawImage(bandCtx.canvas, 0, 0);
    ctx.restore();
  };
  // shift(+d,+d)와의 차분 = 좌상단 림, shift(−d,−d)와의 차분 = 우하단 림.
  // 그림자를 하이라이트보다 살짝 약하게 — 아이 그림에서 어두운 테는 금방 "때"로 읽힌다.
  band(d, d, "#ffffff", 0.22);
  band(-d, -d, "#1a1208", 0.15);
}

/**
 * 수채 글레이징 합성: result = min(기존, max(기존 × 획, max(획³, 획 × 0.6))).
 * · 마른 워시 위에 새 워시가 겹치면 multiply로 진해진다(겹침이 보인다 — darken(min)
 *   수렴은 겹침 효과 0 = 플랫 마커, 2026-07-10 사용자 실측).
 * · 바닥 1 = 획³: 옅은 워시(한 획 15~25% 농도)가 3겹까지 점진 누적 후 포화 —
 *   i-scream 원본 전수검수(겹침 스텝 2~3회 뚜렷, 시각 포화 50%대).
 * · 바닥 2 = 획×0.6: 진한 색에서 획³은 사실상 무제한 multiply — 진한 획이 밝은 밑칠
 *   경계를 지날 때 줄무늬가 되는 것을 차단(진한 물감일수록 불투명한 실제 수채 성질).
 * · 기존보다 밝아지지도 않는다(darken 클램프) — 어두운 밑색을 지우지 않는다.
 *
 * ⚠️ 모든 중간 연산은 "흰 종이에 플래튼한 불투명" 공간에서 한다. 반투명 이미지에
 * Canvas2D 블렌드 모드(multiply/lighten/darken)를 직접 쓰면 교차항 αs(1−αb)·Cs가
 * 가장자리 폴오프(0<α<1) 픽셀에 어두운 획³ 색을 주입 + 알파를 부풀려 획 실루엣
 * 전체에 "검은 테두리"가 생긴다(2026-07-10 격리 실측: 폴오프 밴드 명도 215→179).
 * 불투명 연산이면 교차항이 0이라 순수 채널별 min/max/×가 된다.
 * 프리뷰(presentStroke)와 최종(endStroke)이 같은 함수를 써야 한다(프리뷰=최종).
 */
export function compositeGlaze(
  target: CanvasRenderingContext2D,
  src: CanvasImageSource,
  width: number,
  height: number,
): void {
  glzSnap = scratch(glzSnap, width, height); // flatDst: 기존 over 백지
  glzFlat = scratch(glzFlat, width, height); // flatSrc: 획 over 백지(얇은 가장자리 = 옅은 물감)
  glzFloor = scratch(glzFloor, width, height); // 포화 바닥
  glzWork = scratch(glzWork, width, height); // 결과 작업 버퍼

  // ① 플래튼 — 이후 모든 블렌드가 불투명 대 불투명이 된다
  glzSnap.globalCompositeOperation = "source-over";
  glzSnap.fillStyle = "#fff";
  glzSnap.fillRect(0, 0, width, height);
  glzSnap.drawImage(target.canvas, 0, 0);
  glzFlat.globalCompositeOperation = "source-over";
  glzFlat.fillStyle = "#fff";
  glzFlat.fillRect(0, 0, width, height);
  glzFlat.drawImage(src, 0, 0);

  // ② 바닥 = max(획³, 획×0.6) — 획³: 옅은 워시가 3겹까지 점진 누적 후 포화
  // (획⁴는 p5가 81까지 떨어져 원본(166)보다 훨씬 어두워짐, 실측)
  glzFloor.globalCompositeOperation = "source-over";
  glzFloor.drawImage(glzFlat.canvas, 0, 0);
  glzFloor.globalCompositeOperation = "multiply";
  glzFloor.drawImage(glzFlat.canvas, 0, 0); // 획²
  glzFloor.drawImage(glzFlat.canvas, 0, 0); // 획³
  glzWork.globalCompositeOperation = "source-over";
  glzWork.drawImage(glzFlat.canvas, 0, 0);
  glzWork.globalCompositeOperation = "multiply";
  glzWork.fillStyle = "rgb(153,153,153)"; // 획×0.6
  glzWork.fillRect(0, 0, width, height);
  glzFloor.globalCompositeOperation = "lighten";
  glzFloor.drawImage(glzWork.canvas, 0, 0);

  // ③ 결과 = min(flatDst, max(flatDst×flatSrc, 바닥)) — 전부 불투명 채널 연산
  glzWork.globalCompositeOperation = "source-over";
  glzWork.drawImage(glzSnap.canvas, 0, 0);
  glzWork.globalCompositeOperation = "multiply";
  glzWork.drawImage(glzFlat.canvas, 0, 0);
  glzWork.globalCompositeOperation = "lighten";
  glzWork.drawImage(glzFloor.canvas, 0, 0);
  glzWork.globalCompositeOperation = "darken";
  glzWork.drawImage(glzSnap.canvas, 0, 0);

  // ④ 레이어 반영 — 알파는 src와의 유니언(source-over), 색은 src 알파 가중으로
  // 플래튼 결과 톤으로 치환(마스크 + source-atop). src 알파가 낮은 픽셀(기존 획의
  // 가장자리 스침)은 기존 색이 거의 유지돼 반복 겹침에도 백화·침식이 없다.
  glzWork.globalCompositeOperation = "destination-in";
  glzWork.drawImage(src, 0, 0);
  glzWork.globalCompositeOperation = "source-over";

  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalCompositeOperation = "source-over";
  target.drawImage(src, 0, 0);
  target.globalCompositeOperation = "source-atop";
  target.drawImage(glzWork.canvas, 0, 0);
  target.restore();
}
