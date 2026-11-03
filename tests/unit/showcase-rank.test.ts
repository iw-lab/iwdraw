// 🔒 2026-11-03 «처음 온 친구들은 하트가 없어서 뒤로 밀리면 영원히 전시관에 못 올라오는 거 아님?»
import { describe, expect, it } from "vitest";
import { rankShowcase, FRESH_EVERY } from "../../worker/lib/showcase-rank";

const H = 3600e3, now = 1_000_000 * H;
const old = (i: number, wk: number, likes = wk) => ({ id: `old${i}`, at: now - 10 * 24 * H - i, likes, wk });
describe("전시관 순위", () => {
  it("이번 주 하트 순 — 누적이 많아도 이번 주가 적으면 뒤", () => {
    const out = rankShowcase([old(1, 0, 99), old(2, 5, 5), old(3, 2, 2)], now, 50);
    expect(out.map((w) => w.id)).toEqual(["old2", "old3", "old1"]);
  });
  it("하트 0 새 작품도 3칸 안에 — 오래된 인기작 100점 사이에서도", () => {
    const list = [...Array.from({ length: 100 }, (_, i) => old(i, 50 - (i % 50))), { id: "new1", at: now - 2 * H, likes: 0, wk: 0 }];
    const out = rankShowcase(list, now, 50);
    const at = out.findIndex((w) => w.id === "new1");
    expect(at).toBeGreaterThanOrEqual(0); expect(at).toBeLessThan(FRESH_EVERY);
    expect(out[at].fresh).toBe(true); expect(out.length).toBe(50);
  });
  it("새 작품이 여럿이면 3칸마다 하나씩 · 중복 없음 · 50위까지", () => {
    const list = [...Array.from({ length: 60 }, (_, i) => old(i, 10)), ...Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, at: now - i * H, likes: 0, wk: 0 }))];
    const out = rankShowcase(list, now, 50);
    expect(new Set(out.map((w) => w.id)).size).toBe(out.length);
    expect(out.filter((w, i) => (i + 1) % FRESH_EVERY === 0).slice(0, 8).every((w) => w.fresh)).toBe(true);   /* 새 작품 8점이 3·6·…·24번째 자리 */
    expect(out.filter((w) => w.fresh).length).toBe(8);
    expect(out.length).toBe(50);
  });
});
