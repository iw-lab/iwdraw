import { describe, it, expect } from "vitest";
import { sidoFromCf, guessSido } from "../../worker/lib/sido-guess";

describe("전시관 시·도 미리 고르기", () => {
  it("Cloudflare 시·도 코드 → 줄임말(옛·새 번호 둘 다)", () => {
    expect(sidoFromCf({ country: "KR", regionCode: "45" })).toBe("전북");
    expect(sidoFromCf({ country: "KR", regionCode: "52" })).toBe("전북");
    expect(sidoFromCf({ country: "KR", regionCode: "11" })).toBe("서울");
    expect(sidoFromCf({ country: "KR", regionCode: "51" })).toBe("강원");
  });
  it("코드가 없으면 영문 이름으로", () => {
    expect(sidoFromCf({ country: "KR", region: "Jeollabuk-do" })).toBe("전북");
    expect(sidoFromCf({ country: "KR", region: "South Jeolla" })).toBe("전남");
    expect(sidoFromCf({ country: "KR", region: "Gyeonggi-do" })).toBe("경기");
  });
  it("한국 밖·모름이면 비운다", () => {
    expect(sidoFromCf({ country: "JP", regionCode: "13" })).toBe("");
    expect(sidoFromCf({ country: "KR", regionCode: "99" })).toBe("");
    expect(sidoFromCf(undefined)).toBe("");
  });
  it("선생님이 전에 고른 값이 접속 위치보다 먼저 · 이상한 값은 무시", () => {
    expect(guessSido("전북", { country: "KR", regionCode: "11" })).toEqual({ sido: "전북", from: "last" });
    expect(guessSido("김제중앙초", { country: "KR", regionCode: "11" })).toEqual({ sido: "서울", from: "net" });
    expect(guessSido(null, null)).toEqual({ sido: "", from: "" });
  });
});
