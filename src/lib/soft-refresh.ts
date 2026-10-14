/*
 * 안전 새로고침 — 그림을 저장한 뒤 페이지를 새로 불러오고, 그림·붓·색·굵기를 그대로 되살린다.
 *
 * 2026-10-14 사용자: «웨일북에서 한 시간쯤 쓰다 보니 렉 걸리고 느려진다, 나갔다 들어오면 괜찮아진다 —
 * 가능하면 15분에 한 번씩 작업 그대로 리프레싱하든지». 헤드리스 소크(long-session-cycles 25바퀴)로는
 * 쌓이는 것이 재현되지 않았다(JS 힙·리스너·캔버스·GL 컨텍스트·렌더러/GPU 메모리 평평). 실기기의 GPU·
 * 메모리 압박은 탭을 새로 여는 것만 확실히 비운다 → «나갔다 들어오기»를 자동으로, 작업은 그대로.
 *
 * 언제: 탭을 연 지 15분이 지났고, 아이가 4초 넘게 손을 뗐고(긋는 중엔 절대 안 함), 창·팔레트가 닫혀 있고,
 * 화면이 보일 때. 저장이 끝난 걸 확인한 뒤에만 새로고침한다(실패하면 2분 뒤 다시 본다).
 */
import type { BrushId, RGB, SymmetryMode } from "@/engine/types";

export const SOFT_REFRESH_KEY = "arton:soft-refresh";
export const SOFT_REFRESH_INTERVAL_MS = 15 * 60_000;
export const SOFT_REFRESH_IDLE_MS = 4_000;
/** 새로고침 뒤 이 시간 안에만 표식을 믿는다(남은 표식이 다음 날 엉뚱한 그림을 되살리지 않게) */
const MARKER_TTL_MS = 2 * 60_000;

export interface SoftRefreshUi {
  brush: BrushId;
  color: RGB;
  size: number;
  opacity: number;
  water: number;
  stabilize: number;
  symmetry: SymmetryMode;
}
export interface SoftRefreshMarker {
  at: number;
  href: string;
  draftId: string;
  ui: SoftRefreshUi;
}

/** 시험·QA용: ?softRefreshMs=3000 이면 그 간격으로(실사용 기본 15분) */
export function softRefreshInterval(search: string): number {
  const v = Number(new URLSearchParams(search).get("softRefreshMs"));
  return Number.isFinite(v) && v >= 1000 ? v : SOFT_REFRESH_INTERVAL_MS;
}

export function shouldSoftRefresh(s: {
  sinceLoadMs: number;
  idleMs: number;
  pointerDown: boolean;
  visible: boolean;
  busy: boolean;
  intervalMs: number;
}): boolean {
  return s.sinceLoadMs >= s.intervalMs && s.idleMs >= SOFT_REFRESH_IDLE_MS && !s.pointerDown && s.visible && !s.busy;
}

export function writeMarker(m: SoftRefreshMarker): boolean {
  try {
    sessionStorage.setItem(SOFT_REFRESH_KEY, JSON.stringify(m));
    return true;
  } catch {
    return false; // 표식을 못 남기면 되살릴 수 없다 → 새로고침하지 않는다
  }
}

/** 새로고침 직후 1회 — 같은 주소·2분 안의 표식만 꺼내고 지운다 */
export function takeMarker(href: string, now = Date.now()): SoftRefreshMarker | null {
  try {
    const raw = sessionStorage.getItem(SOFT_REFRESH_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SOFT_REFRESH_KEY);
    const m = JSON.parse(raw) as SoftRefreshMarker;
    if (m.href !== href || now - m.at > MARKER_TTL_MS || now < m.at) return null;
    return m;
  } catch {
    return null;
  }
}
