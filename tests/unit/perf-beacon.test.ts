// 저사양 렉 자동 계측(2026-11-10) — 렉 기기는 늘 보내고, 서버는 기술 수치만 남긴다
import { describe, expect, it } from "vitest";
import { LAG_MS, BASE_RATE, shouldSend, summarize } from "@/lib/perf-beacon";
import { sanitizePerf } from "../../worker/lib/perf";

describe("렉 계측", () => {
  it("p75 가 문턱 이상이면 늘 보내고, 정상이면 표본만", () => {
    expect(shouldSend(LAG_MS, 0.99)).toBe(true);
    expect(shouldSend(17, 0.99)).toBe(false);
    expect(shouldSend(17, BASE_RATE / 2)).toBe(true);
  });
  it("요약 = 그리는 프레임 간격의 중앙값·p75·p90", () => {
    const s = summarize([...Array(75).fill(16), ...Array(25).fill(120)]);
    expect(s).toMatchObject({ n: 100, med: 16, p75: 120, max: 120 });
  });
  it("서버는 정한 칸만 · 글자는 짧은 영문만 · 개인정보 칸은 버린다", () => {
    const r = sanitizePerf({ page: "draw", p75: 88.123, backend: "gl", brush: "pencil", os: "cros", nickname: "철수", ip: "1.2.3.4", cores: 4, mem: 4 })!;
    expect(r.p75).toBe(88.12);
    expect(r).not.toHaveProperty("nickname");
    expect(r).not.toHaveProperty("ip");
    expect(sanitizePerf({ page: "draw", brush: "<script>" })!.brush).toBe("");
    expect(sanitizePerf({ page: "admin" })).toBeNull();
    expect(sanitizePerf(null)).toBeNull();
    expect(sanitizePerf({ page: "sand", p75: -5, cores: 1e9 })).toMatchObject({ p75: 0, cores: 256 });
  });
});
