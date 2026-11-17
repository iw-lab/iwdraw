/*
 * 기기별 그림 판 크기 — «이 기기에서 실제로 잰 렉»으로 정한다(2026-11-17 사용자
 * «렉 걸리는 저사양 기기는 좀 더 낮추고 고사양은 그대로 · 웨일북이라고 다 내리면 안 돼 — 같은 웨일북인데 잘 도는 기기도 있다»).
 *
 * 왜 판 크기인가(운영 렉 표 perf_reports 2026-11-10~17 · 140건): 웨일북 2코어 기기는 화면 배율을 이미 1로 내렸는데도
 * 연필 하나에 프레임 35~147ms. 표시 쪽이 아니라 그림 판(1536×1152 ≈ 177만 화소)에 붓을 찍고·획마다 판을 읽고·합치는 비용이다.
 * 같은 «웨일 4GB» 라도 4코어 기기는 18ms 로 멀쩡하다 → 기종·사양으로 가르지 않고 그리는 동안 잰 프레임 간격(p75)만 본다.
 *
 * 단계: 1(1536) → 0.75(1152) → 0.6(920). 렉(p75 ≥ SLOW_MS)이면 다음 그림부터 한 단계 내리고,
 * 낮춘 단계에서 두 번 연달아 넉넉하면(p75 ≤ FAST_MS) 한 단계 올린다(그날 기기가 바빴던 것일 수 있다 — 오르내림 출렁임 방지로 두 번).
 * 고사양은 렉이 안 나니 늘 1 — 아무것도 바뀌지 않는다.
 */
export const TIERS = [1, 0.75, 0.6] as const;
export const SLOW_MS = 40;
export const FAST_MS = 22;
const KEY = "arton.perf.tier";

interface TierState {
  /** TIERS 의 칸 번호 */
  i: number;
  /** 낮춘 단계에서 넉넉했던 연속 횟수 */
  good: number;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function read(store: Store): TierState {
  try {
    const v = JSON.parse(store.getItem(KEY) || "null") as Partial<TierState> | null;
    const i = Number(v?.i);
    const good = Number(v?.good);
    return { i: Number.isInteger(i) && i >= 0 && i < TIERS.length ? i : 0, good: Number.isInteger(good) && good >= 0 ? good : 0 };
  } catch {
    return { i: 0, good: 0 };
  }
}

/** 새 그림 판에 쓸 배율(1·0.75·0.6) — 처음 온 기기·잰 적 없는 기기는 1 */
export function docScale(store: Store | null = safeStore()): number {
  return store ? TIERS[read(store).i] : 1;
}

/**
 * 그리는 동안 잰 p75(ms)로 다음 판 단계를 정한다. usedScale = 이번에 잰 판의 배율
 * (재는 사이 다른 탭이 단계를 바꿨으면 그 판 기준으로만 움직인다). 돌려주는 값 = 새 배율.
 */
export function learnTier(p75: number, usedScale: number, store: Store | null = safeStore()): number {
  if (!store || !Number.isFinite(p75) || p75 <= 0) return docScale(store);
  const s = read(store);
  const used = TIERS.findIndex((t) => Math.abs(t - usedScale) < 1e-6);
  const cur = used >= 0 ? used : s.i;
  let next: TierState;
  if (p75 >= SLOW_MS) next = { i: Math.min(TIERS.length - 1, cur + 1), good: 0 };
  else if (p75 <= FAST_MS && cur > 0) next = s.good + 1 >= 2 ? { i: cur - 1, good: 0 } : { i: cur, good: s.good + 1 };
  else next = { i: cur, good: 0 };
  try {
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장 못 하면 다음에도 1 — 그리기엔 영향 없음 */
  }
  return TIERS[next.i];
}

function safeStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
