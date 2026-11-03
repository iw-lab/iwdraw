// 선행쌤 전시관 순위(2026-11-03 사용자 «처음 온 친구들은 하트가 없어서 뒤로 밀리면 영원히 못 올라오는 거 아님?»)
//   순위 = 이번 주(7일) 하트 순 → 같으면 누적 하트 → 같으면 최근에 건 순
//   새 작품(걸린 지 FRESH_H 시간 안) = 3칸마다 한 자리씩 끼운다 — 하트 0이어도 앞쪽에 보인다
export interface RankIn { id: string; at: number; likes: number; wk: number }
export interface RankOut { id: string; at: number; likes: number; wk: number; fresh: boolean }
export const FRESH_H = 72;
export const FRESH_EVERY = 3;

export function rankShowcase(list: RankIn[], now: number, max: number): RankOut[] {
  const isFresh = (w: RankIn) => now - w.at < FRESH_H * 3600e3;
  const ranked = [...list].sort((a, b) => b.wk - a.wk || b.likes - a.likes || b.at - a.at);
  const fresh = list.filter(isFresh).sort((a, b) => b.at - a.at);
  const out: RankOut[] = [];
  const used = new Set<string>();
  const push = (w: RankIn) => { if (used.has(w.id) || out.length >= max) return; used.add(w.id); out.push({ ...w, fresh: isFresh(w) }); };
  let r = 0, f = 0;
  while (out.length < max && (r < ranked.length || f < fresh.length)) {
    if ((out.length + 1) % FRESH_EVERY === 0 && f < fresh.length) { push(fresh[f++]); continue; }
    if (r < ranked.length) push(ranked[r++]); else push(fresh[f++]);
  }
  return out;
}
