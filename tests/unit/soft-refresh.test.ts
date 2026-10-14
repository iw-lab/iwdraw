import { describe, it, expect, beforeEach } from "vitest";
import { shouldSoftRefresh, softRefreshInterval, takeMarker, writeMarker, SOFT_REFRESH_INTERVAL_MS } from "../../src/lib/soft-refresh";

/* 안전 새로고침 판정 — 근거 = src/lib/soft-refresh.ts 머리말(웨일북 한 시간 렉) */
const base = { sinceLoadMs: 16 * 60_000, idleMs: 5_000, pointerDown: false, visible: true, busy: false, intervalMs: SOFT_REFRESH_INTERVAL_MS };

describe("shouldSoftRefresh", () => {
  it("15분이 지났고 손을 뗀 지 4초면 새로고침", () => expect(shouldSoftRefresh(base)).toBe(true));
  it("15분 전에는 안 한다", () => expect(shouldSoftRefresh({ ...base, sinceLoadMs: 14 * 60_000 })).toBe(false));
  it("긋는 중(포인터 누름)에는 절대 안 한다", () => expect(shouldSoftRefresh({ ...base, pointerDown: true })).toBe(false));
  it("방금 그렸으면(4초 안) 기다린다", () => expect(shouldSoftRefresh({ ...base, idleMs: 1_000 })).toBe(false));
  it("창·팔레트·떠 있는 도장이 있으면 안 한다", () => expect(shouldSoftRefresh({ ...base, busy: true })).toBe(false));
  it("화면이 숨어 있으면 안 한다", () => expect(shouldSoftRefresh({ ...base, visible: false })).toBe(false));
  it("기본 간격은 15분, ?softRefreshMs 로만 줄인다", () => {
    expect(softRefreshInterval("")).toBe(15 * 60_000);
    expect(softRefreshInterval("?softRefreshMs=3000")).toBe(3000);
    expect(softRefreshInterval("?softRefreshMs=5")).toBe(15 * 60_000);
  });
});

describe("표식 — 같은 주소·2분 안에만 한 번", () => {
  const ui = { brush: "crayon", color: { r: 1, g: 2, b: 3 }, size: 18, opacity: 1, water: 0.5, stabilize: 3, symmetry: "none" } as const;
  beforeEach(() => sessionStorage.clear());
  it("새로고침 직후 한 번 꺼내고 지운다", () => {
    writeMarker({ at: 1000, href: "https://a/draw?x=1", draftId: "d1", ui });
    expect(takeMarker("https://a/draw?x=1", 2000)?.draftId).toBe("d1");
    expect(takeMarker("https://a/draw?x=1", 2000)).toBeNull();
  });
  it("다른 그림 주소·오래된 표식은 무시", () => {
    writeMarker({ at: 1000, href: "https://a/draw?x=1", draftId: "d1", ui });
    expect(takeMarker("https://a/draw?x=2", 2000)).toBeNull();
    writeMarker({ at: 1000, href: "https://a/draw?x=1", draftId: "d1", ui });
    expect(takeMarker("https://a/draw?x=1", 1000 + 3 * 60_000)).toBeNull();
  });
});
