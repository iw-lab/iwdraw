/* 전시관 시·도 미리 고르기(2026-11-03 사용자 «다른 학교는 시·도를 모르나? 자동으로 됨?»).
 * 아트온은 학교를 모른다(받지 않는다). 그래서 ① 그 선생님이 전에 고른 시·도 → ② 지금 접속한 곳(Cloudflare 가 주는 시·도 코드)
 * 순으로 «미리 골라만» 두고, 선생님이 걸기 창에서 확인·바꾼다. IP·위치는 저장하지 않는다. */
export const SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

// ISO 3166-2:KR (강원 42→51 2023 · 전북 45→52 2024 — 옛·새 번호 둘 다)
const CODE: Record<string, string> = {
  "11": "서울", "26": "부산", "27": "대구", "28": "인천", "29": "광주", "30": "대전", "31": "울산", "50": "세종",
  "41": "경기", "42": "강원", "51": "강원", "43": "충북", "44": "충남", "45": "전북", "52": "전북", "46": "전남",
  "47": "경북", "48": "경남", "49": "제주",
};
// 코드가 없을 때 영문 이름(앞쪽이 더 구체적인 것부터)
const NAME: [RegExp, string][] = [
  [/seoul/i, "서울"], [/busan/i, "부산"], [/daegu/i, "대구"], [/incheon/i, "인천"], [/gwangju/i, "광주"],
  [/daejeon/i, "대전"], [/ulsan/i, "울산"], [/sejong/i, "세종"], [/gyeonggi/i, "경기"], [/gangwon/i, "강원"],
  [/chungcheongbuk|north chungcheong|chungbuk/i, "충북"], [/chungcheongnam|south chungcheong|chungnam/i, "충남"],
  [/jeollabuk|north jeolla|jeonbuk/i, "전북"], [/jeollanam|south jeolla|jeonnam/i, "전남"],
  [/gyeongsangbuk|north gyeongsang|gyeongbuk/i, "경북"], [/gyeongsangnam|south gyeongsang|gyeongnam/i, "경남"], [/jeju/i, "제주"],
];

/** Cloudflare request.cf → 시·도(한국 밖·모름이면 "") */
export function sidoFromCf(cf: { country?: unknown; regionCode?: unknown; region?: unknown } | null | undefined): string {
  if (!cf || cf.country !== "KR") return "";
  const code = String(cf.regionCode ?? "").replace(/^KR-/i, "");
  if (CODE[code]) return CODE[code];
  const name = String(cf.region ?? "");
  for (const [re, s] of NAME) if (re.test(name)) return s;
  return "";
}

/** 미리 고를 값 — 전에 고른 값이 먼저(같은 선생님은 보통 같은 지역), 없으면 접속 위치 */
export function guessSido(last: unknown, cf: Parameters<typeof sidoFromCf>[0]): { sido: string; from: "last" | "net" | "" } {
  if (typeof last === "string" && SIDO.includes(last)) return { sido: last, from: "last" };
  const n = sidoFromCf(cf);
  return n ? { sido: n, from: "net" } : { sido: "", from: "" };
}
