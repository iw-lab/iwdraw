import { test, expect, type Page } from "@playwright/test";

// serviceWorkers: block — 프로덕션 빌드에선 SW 가 텍스처를 프리캐시에서 내줘서 page.route(404·지연 주입)가
// 닿지 않는다(2026-10-07 out/ 실측: 404 주입이 무시돼 팩이 그대로 적용). 여기서 재는 건 «네트워크로 받을 때의
// 폴백·세션 고정 논리»라 SW 를 막는다. 프리캐시 포함 여부는 빌드된 sw.js 에서 따로 확인한다.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] }, serviceWorkers: "block" });

/*
 * 종이 결 팩(public/textures — 실물 재질 순위 타일) 회귀.
 * 시드 고정 프로시저럴이라 «팩 없음»은 픽셀 단위로 재현된다 → 폴백·세션 고정을 정확히 판정할 수 있다.
 *  ① 팩이 오면 빈 종이의 결이 프로시저럴과 달라진다(배선이 살아 있다)
 *  ② 팩 파일이 404 면 ?paper=proc 와 픽셀 단위로 같다(폴백 + 결정론)
 *  ③ 팩이 시간 제한(1.5s)보다 늦게 오면 그 세션은 끝까지 프로시저럴 — 그림 도중 결이 바뀌지 않는다
 *  ④ 획 안 질감 세기는 프로시저럴의 ±25% (결의 성격만 바뀌고 세기는 유지 — 2026-10-07 실측 −20~+20%)
 */

async function open(page: Page, query: string) {
  await page.goto(`/draw?mode=oil&backend=gl${query}`);
  const canvas = page.getByLabel("그림 캔버스");
  await canvas.waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  await page.waitForTimeout(500);
  return canvas;
}

/** 빈 종이 영역(우하단)의 회색값 — 표시 캔버스 */
async function paperPixels(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
    const ctx = el.getContext("2d")!;
    const d = ctx.getImageData(Math.round(el.width * 0.6), Math.round(el.height * 0.7), 120, 60).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push(d[i] + d[i + 1] + d[i + 2]);
    return out;
  });
}

const paperState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __artonPaper: () => { sealed: boolean; loaded: string[]; used: string[] } }).__artonPaper());

const diff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

async function strokeTexture(page: Page): Promise<number> {
  const canvas = page.getByLabel("그림 캔버스");
  await page.getByRole("button", { name: "유화붓", exact: true }).click();
  await page.getByRole("button", { name: "색 8", exact: true }).click();
  await page.getByLabel("브러시 굵기", { exact: true }).fill("70");
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height * 0.3;
  await page.mouse.move(box.x + box.width * 0.1, y);
  await page.mouse.down();
  for (let k = 1; k <= 30; k++) await page.mouse.move(box.x + box.width * (0.1 + 0.6 * (k / 30)), y);
  await page.mouse.up();
  await page.waitForTimeout(500);
  // 획 안 고역 질감 — 등방(2D) 고역: 3×3 평균을 뺀 잔차의 표준편차.
  // ⚠️ 가로 이웃 차분만 재면 «세로선» 세기만 잰다 — 기존 결은 세로 격자선, 실물 캔버스는 가로 실 줄이
  //    주라 같은 질감 세기가 0.55배로 나온다(2026-10-07 실측, 방향 편향). 붓결은 두 조건이 같은 획이라 상쇄.
  return page.evaluate(() => {
    const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
    const ctx = el.getContext("2d")!;
    const w = Math.round(el.width * 0.3);
    const h = 14;
    const d = ctx.getImageData(Math.round(el.width * 0.25), Math.round(el.height * 0.3) - 7, w, h).data;
    const L = (x: number, y: number) => { const i = (y * w + x) * 4; return d[i] + d[i + 1] + d[i + 2]; };
    const v: number[] = [];
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += L(x + dx, y + dy);
        v.push(L(x, y) - s / 9);
      }
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  });
}

test("종이 결 팩: 배선 · 404 폴백 · 늦은 도착 세션 고정 · 획 질감 세기", async ({ page }) => {
  test.setTimeout(120_000);
  // 이 시험은 multiply tint 경로(팩·폴백·세션 고정)를 잰다 — 캔버스 요철(relief)이 오면 그 위를 덮어
  // 빈 종이가 팩/프로시저럴과 무관하게 같아진다(2026-10-08 도입). 요철은 아래 별도 시험에서.
  await page.route("**/textures/paper-linen-relief.png", (r) => r.abort());
  await open(page, "&paper=proc");
  const proc = await paperPixels(page);
  const procTex = await strokeTexture(page);

  // ① 팩 적용
  const reqs: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/textures/")) reqs.push(r.url()); });
  await open(page, "");
  const pack = await paperPixels(page);
  const packTex = await strokeTexture(page);
  expect(reqs.some((u) => u.endsWith("/textures/pack.json"))).toBe(true);
  const st = await paperState(page);
  console.log("팩 상태", JSON.stringify(st));
  expect(st.used).toEqual(expect.arrayContaining(["linen:grain", "linen:tint"]));
  const dPack = diff(proc, pack);
  console.log("빈 종이 차이(팩 vs 프로시저럴)", dPack.toFixed(2), "· 획 질감", procTex.toFixed(2), "→", packTex.toFixed(2));
  expect(dPack).toBeGreaterThan(1);
  expect(packTex / procTex).toBeGreaterThan(0.75);
  expect(packTex / procTex).toBeLessThan(1.25);

  // ② 404 → 프로시저럴과 픽셀 단위로 같다
  await page.route("**/textures/**", (r) => r.fulfill({ status: 404, body: "" }));
  await open(page, "");
  const missing = await paperPixels(page);
  console.log("빈 종이 차이(404 vs 프로시저럴)", diff(proc, missing).toFixed(3));
  expect(diff(proc, missing)).toBeLessThan(0.05);
  await page.unroute("**/textures/**");

  // ③ 3초 늦게 도착 → 시간 제한(1.5s) 뒤라 버려져야 한다. 도착 뒤 한참 기다려도 그대로
  await page.route("**/textures/**", async (r) => {
    // 요철은 표시 전용(획에 안 구워짐)이라 늦게 와도 되는 별개 자원 — 이 시험(결 필드 봉인) 밖이다
    if (r.request().url().endsWith("/paper-linen-relief.png")) return r.abort();
    await new Promise((res) => setTimeout(res, 3000));
    await r.continue();
  });
  await open(page, "");
  await page.waitForTimeout(4000); // 팩 도착(3s) 이후
  await strokeTexture(page); // 침식 결 필드는 첫 획 때 만들어진다 — 봉인이 지키는 건 이것
  const late = await paperPixels(page);
  const lateSt = await paperState(page);
  console.log("빈 종이 차이(늦은 팩 vs 프로시저럴)", diff(proc, late).toFixed(3), "상태", JSON.stringify(lateSt));
  expect(diff(proc, late)).toBeLessThan(0.05);
  expect(lateSt.used).toEqual([]); // 늦게 온 파일은 어떤 필드에도 쓰이지 않았다
});

/*
 * 캔버스 요철(relief, 2026-10-08 아트봉봉 비교) — Firefly 레이킹 라이트 캔버스에서 뽑은 높이 음영을
 * 화면 맨 위에 soft-light + 연속 그림자 multiply 로 덮는다.
 *  ① 빈 종이에도 결이 보인다(soft-light 만으로는 흰 바탕이 안 바뀐다) — tint 보다 결 변동이 크다
 *  ② 물감 위에도 같은 결이 비친다 — 요철이 없을 때보다 획 안 고역 질감이 크다
 *  ③ 요철 파일이 없으면 tint 로 돌아간다(빈 종이가 tint 와 같다)
 */
test("캔버스 요철: 빈 종이·물감 위 결 · 파일 없으면 tint 폴백", async ({ page }) => {
  test.setTimeout(120_000);
  const std = (a: number[]) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
  };
  await page.route("**/textures/paper-linen-relief.png", (r) => r.abort());
  await open(page, "");
  const tint = await paperPixels(page);
  const tintTex = await strokeTexture(page);
  await page.unroute("**/textures/paper-linen-relief.png");

  await open(page, "");
  await page.waitForTimeout(500); // 요철 타일 로드 → 다시 그림
  const rel = await paperPixels(page);
  const relTex = await strokeTexture(page);
  console.log("요철 빈 종이 결 표준편차", std(tint).toFixed(1), "→", std(rel).toFixed(1), "· 획 질감", tintTex.toFixed(2), "→", relTex.toFixed(2));
  // 1.5 → 1.25: 골 곱하기를 0.7배로 낮춤(물감 위 회색 망사, 2026-10-08) — 요철이 빠지면 1.0배라 여전히 잡힌다
  expect(std(rel)).toBeGreaterThan(std(tint) * 1.25);
  expect(relTex).toBeGreaterThan(tintTex * 1.2);
  expect(diff(tint, rel)).toBeGreaterThan(3);
});
