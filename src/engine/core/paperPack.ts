/*
 * 종이 결 팩 — 실물 재질 텍스처(public/textures/paper-*.png)를 종이 필드로 쓴다.
 *
 * 파일 = 8비트 그레이 «순위» 타일(scripts/process-texture.py 가 만든다). 값 자체가 아니라
 * 픽셀의 순서만 담는다 → 런타임에 기존 프로시저럴 필드의 값 분포를 그 순서대로 입힌다
 * (히스토그램 매칭). 그래서 paper.ts 의 grainLo/Hi·tint 곡선과 브러시 상수는 그대로 유효하고,
 * 바뀌는 건 결의 «공간 구조»뿐이다.
 *
 * ⚠️ 세션 중 교체 금지: 결은 획에 구워진다. 그림 도중 결이 바뀌면 앞뒤 획의 질감이 갈린다.
 * → 엔진 만들기 전에 loadPaperPack() 을 기다리고(시간 제한), 첫 필드가 만들어지는 순간
 *   봉인(seal)한다. 봉인 뒤 늦게 도착한 파일은 버린다 — 그 세션은 끝까지 프로시저럴.
 * 끄기: NEXT_PUBLIC_TEXTURE_PACK=0 (빌드) 또는 ?paper=proc (QA·A/B).
 */
import type { PaperKind } from "./paper";

export type PackLayer = "grain" | "tint";

/** 파일 목록의 단일 진실원 = public/textures/pack.json(scripts/process-texture.py 가 쓴다).
 * {"files": {"smooth": {"grain": "/textures/paper-smooth-grain.png", ...}, ...}} */
const PACK_INDEX = "/textures/pack.json";
type PackIndex = { files?: Partial<Record<PaperKind, Partial<Record<PackLayer, string>>>> };

const ranks = new Map<string, Uint8Array>();
/** 실제로 팩이 쓰인 필드(kind:layer) — 진단·e2e 용(세션 고정 판정은 «도착»이 아니라 «쓰임»으로 해야 한다) */
const used = new Set<string>();
let sealed = false;

if (typeof window !== "undefined") {
  (window as unknown as { __artonPaper?: () => unknown }).__artonPaper = () => ({
    sealed,
    loaded: [...ranks.keys()],
    used: [...used],
  });
}
let loading: Promise<void> | null = null;

export function packEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_TEXTURE_PACK === "0") return false;
  if (typeof window !== "undefined") {
    try {
      if (new URLSearchParams(window.location.search).get("paper") === "proc") return false;
    } catch {
      /* 검색 파라미터를 못 읽어도 기본값(켜짐) */
    }
  }
  return true;
}

function decodeRanks(img: HTMLImageElement): Uint8Array {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4];
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

async function loadAll(): Promise<void> {
  const res = await fetch(PACK_INDEX);
  if (!res.ok) return;
  const files = ((await res.json()) as PackIndex).files ?? {};
  const jobs: Promise<void>[] = [];
  for (const [kind, layers] of Object.entries(files)) {
    // cotton(수채지) 제외 — 수채 구름·가장자리 노이즈가 이 필드를 수십 배 늘려 쓴다(셰이더
    // v_px/9800 등). 7차까지 다듬은 수채 룩을 지키려고 팩이 있어도 쓰지 않는다.
    if (kind === "cotton") continue;
    for (const [layer, url] of Object.entries(layers ?? {})) {
      if (!url) continue;
      jobs.push(
        loadImage(url).then(
          (img) => {
            if (sealed) return; // 늦게 온 파일 — 이 세션은 이미 프로시저럴로 시작했다
            ranks.set(`${kind}:${layer}`, decodeRanks(img));
          },
          () => undefined, // 한 장 실패 = 그 종이만 프로시저럴
        ),
      );
    }
  }
  await Promise.all(jobs);
}

/** 앱 수명당 1회. 시간 제한 안에 못 받으면 그냥 진행(프로시저럴) — 아이를 기다리게 하지 않는다. */
export function loadPaperPack(timeoutMs = 1500): Promise<void> {
  if (typeof document === "undefined" || !packEnabled()) return Promise.resolve();
  if (!loading) loading = loadAll().catch(() => undefined);
  return Promise.race([loading, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

/** paper.ts 가 첫 필드를 만들 때 부른다 — 이후 도착분은 무시(세션 고정) */
export function sealPaperPack(): void {
  sealed = true;
}

/**
 * 순위 타일을 기준 필드의 «값 분포»로 다시 칠한다(길이는 달라도 된다 — 분포만 빌린다).
 * size 를 주면 그 크기(정사각) 타일만 받는다 — 침식 결은 셰이더가 256 주기로 읽어서 고정.
 * 맞지 않으면 null → 프로시저럴. 같은 순위값(8비트 동점)끼리는 같은 분위수를 받는다.
 */
export function packField(
  kind: PaperKind,
  layer: PackLayer,
  reference: Float32Array,
  size?: number,
): Float32Array | null {
  const r = ranks.get(`${kind}:${layer}`);
  if (!r) return null;
  const side = Math.round(Math.sqrt(r.length));
  if (side * side !== r.length || side < 64 || (size !== undefined && side !== size)) return null;
  used.add(`${kind}:${layer}`);
  const sorted = Float32Array.from(reference).sort();
  const n = sorted.length;
  const out = new Float32Array(r.length);
  for (let i = 0; i < r.length; i++) {
    const q = (r[i] + 0.5) / 256;
    out[i] = sorted[Math.min(n - 1, Math.floor(q * n))];
  }
  return out;
}

/** 시험용 — 모듈 상태 초기화 */
export function __resetPaperPackForTest(): void {
  ranks.clear();
  used.clear();
  sealed = false;
  loading = null;
}

/** 시험용 — 순위 타일 직접 주입 */
export function __setPackRanksForTest(kind: PaperKind, layer: PackLayer, r: Uint8Array): void {
  ranks.set(`${kind}:${layer}`, r);
}
