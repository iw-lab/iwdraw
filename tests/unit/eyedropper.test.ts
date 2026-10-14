import { describe, it, expect } from "vitest";
import { hintMatches, meanColor, paintColor, strokeHint, visiblePaint } from "../../src/engine/core/eyedropper";
import type { RecordedStroke } from "../../src/engine/types";

/* 스포이트 판정 — 근거·실측은 src/engine/core/eyedropper.ts 머리말 */

function px(list: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(list.flat());
}
const stroke = (brush: string, color: { r: number; g: number; b: number }, pts: [number, number][], size = 20, layerId = "L1"): RecordedStroke =>
  ({
    brush,
    settings: { size, opacity: 1, color, waterAmount: 0.5, stabilize: 0 },
    layerId,
    points: pts.map(([x, y]) => ({ x, y, pressure: 0.5, t: 0 })),
    symmetry: "none",
  }) as unknown as RecordedStroke;

describe("paintColor — 알갱이 사이 흰 틈은 무시하고 물감 색을 낸다", () => {
  it("크레용처럼 반투명 알갱이여도 칠한 색 그대로", () => {
    const c = paintColor(px([[70, 140, 200, 255], [70, 140, 200, 90], [0, 0, 0, 0], [70, 140, 200, 30]]));
    expect(c.color).toEqual({ r: 70, g: 140, b: 200 });
    expect(c.coverage).toBeCloseTo((255 + 90 + 30) / 255 / 4, 5);
  });
  it("칠이 없으면 덮임 0", () => {
    expect(paintColor(px([[0, 0, 0, 0], [0, 0, 0, 0]])).coverage).toBe(0);
  });
  it("두 색이 섞였으면 불투명도 비율대로", () => {
    expect(paintColor(px([[200, 0, 0, 255], [0, 0, 200, 255]])).color).toEqual({ r: 100, g: 0, b: 100 });
  });
});

describe("meanColor — 도안·명화는 한 점이 아니라 주변 평균", () => {
  it("붓 자국의 진한 점 하나가 끌어내리지 않는다", () => {
    expect(meanColor(px([[100, 120, 160, 255], [100, 120, 160, 255], [100, 120, 160, 255], [20, 30, 60, 255]]))).toEqual({ r: 80, g: 98, b: 135 });
  });
});

describe("strokeHint — 그 자리를 마지막으로 칠한 획의 색", () => {
  const blue = { r: 70, g: 140, b: 200 };
  const red = { r: 220, g: 40, b: 40 };
  it("가장 최근에 덮은 획", () => {
    const log = [stroke("oil", blue, [[100, 100]]), stroke("oil", red, [[100, 100]])];
    expect(strokeHint(log, "L1", 105, 100, 1000, 1000)).toEqual({ brush: "oil", color: red });
  });
  it("닿지 않은 획·다른 레이어는 건너뛴다", () => {
    const log = [stroke("oil", blue, [[100, 100]]), stroke("oil", red, [[500, 500]]), stroke("crayon", red, [[100, 100]], 20, "L2")];
    expect(strokeHint(log, "L1", 100, 100, 1000, 1000)?.color).toEqual(blue);
  });
  it("지우개·번짐이 마지막이면 기록을 믿지 않는다", () => {
    expect(strokeHint([stroke("oil", blue, [[100, 100]]), stroke("smudge", blue, [[100, 100]])], "L1", 100, 100, 1000, 1000)).toBeNull();
    expect(strokeHint([stroke("oil", blue, [[100, 100]]), stroke("eraser", blue, [[100, 100]])], "L1", 100, 100, 1000, 1000)).toBeNull();
  });
  it("대칭 획의 거울 쪽도 찾는다", () => {
    const s = { ...stroke("crayon", blue, [[100, 100]]), symmetry: "vertical" } as RecordedStroke;
    expect(strokeHint([s], "L1", 900, 100, 1000, 1000)?.color).toEqual(blue);
  });
});

describe("교차검증 지적 회귀(2026-10-14)", () => {
  it("위·아래 칠이 창 안에서 안 겹치면 실제로 더 많이 보이는 아래 레이어를 고른다(codex)", () => {
    const top = new Uint8ClampedArray(169 * 4);
    const bottom = new Uint8ClampedArray(169 * 4);
    for (let p = 0; p < 169; p++) {
      if (p < 70) top.set([255, 0, 0, 255], p * 4); // 빨강 70픽셀
      else bottom.set([0, 0, 255, 255], p * 4); // 파랑 99픽셀(겹치지 않음)
    }
    expect(visiblePaint([{ data: top, opacity: 1 }, { data: bottom, opacity: 1 }])).toMatchObject({ index: 1, color: { r: 0, g: 0, b: 255 } });
  });
  it("위 레이어가 완전히 가리면 아래는 안 보인다", () => {
    const full = (c: number[]) => new Uint8ClampedArray(Array.from({ length: 16 }, () => c).flat());
    expect(visiblePaint([{ data: full([255, 0, 0, 255]), opacity: 1 }, { data: full([0, 0, 255, 255]), opacity: 1 }])?.index).toBe(0);
  });
  const red = { r: 255, g: 0, b: 0 };
  const darkRed = { r: 230, g: 0, b: 0 };
  it("획 위를 채우기로 덮었으면 옛 획 색이 아니라 채우기 색(codex·grok)", () => {
    const log = [stroke("crayon", red, [[100, 100]]), stroke("fill", darkRed, [[400, 400]])];
    expect(strokeHint(log, "L1", 100, 100, 1000, 1000, darkRed)).toEqual({ brush: "fill", color: darkRed });
  });
  it("채우기 색과 지금 색이 다르면 여기는 안 덮였다 — 더 옛 획으로", () => {
    const log = [stroke("crayon", red, [[100, 100]]), stroke("fill", { r: 0, g: 200, b: 0 }, [[400, 400]])];
    expect(strokeHint(log, "L1", 100, 100, 1000, 1000, red)?.color).toEqual(red);
  });
  it("빠른 획의 기록 점 사이(선분 위)도 그 획으로 찾는다(gemini)", () => {
    const log = [stroke("pencil", red, [[100, 100], [300, 100]], 4)];
    expect(strokeHint(log, "L1", 200, 101, 1000, 1000)?.color).toEqual(red);
  });
});

describe("hintMatches — 붓이 바꿔 칠한 폭만 허용", () => {
  it("유화가 압축한 색(실측 70,140,200 → 79,132,183)은 같은 계열", () => {
    expect(hintMatches("oil", { r: 70, g: 140, b: 200 }, { r: 79, g: 132, b: 183 })).toBe(true);
    expect(hintMatches("oil", { r: 240, g: 200, b: 60 }, { r: 217, g: 184, b: 69 })).toBe(true);
  });
  it("수채가 묽힌 색(실측 70,140,200 → 147,181,217)도 같은 계열", () => {
    expect(hintMatches("watercolor", { r: 70, g: 140, b: 200 }, { r: 147, g: 181, b: 217 })).toBe(true);
  });
  it("언두·덧칠로 색이 달라졌으면 기록을 버린다", () => {
    expect(hintMatches("oil", { r: 220, g: 40, b: 40 }, { r: 70, g: 140, b: 200 })).toBe(false);
    expect(hintMatches("crayon", { r: 20, g: 40, b: 120 }, { r: 120, g: 160, b: 230 })).toBe(false);
  });
  it("무채색끼리는 밝기만 본다", () => {
    expect(hintMatches("marker", { r: 40, g: 40, b: 40 }, { r: 44, g: 44, b: 44 })).toBe(true);
    expect(hintMatches("marker", { r: 40, g: 40, b: 40 }, { r: 70, g: 140, b: 200 })).toBe(false);
  });
});
