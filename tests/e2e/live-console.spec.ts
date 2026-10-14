import { test, expect } from "@playwright/test";

/*
 * 주요 화면 콘솔 오류 0 — 배포본 실측(라이브 설정)에서 화면마다 오류·페이지 예외를 센다.
 * 2026-10-14 도안 정리(부분색칠·명화 추가) 뒤 새 도안을 실제로 열어 그림·썸네일이 깨지지 않는지도 본다.
 */
test("주요 화면·새 도안에서 콘솔 오류 0", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // 로그인 안 한 선생님 화면의 세션 확인(/api/teacher/me) 401 은 «로그인 필요»라는 정상 응답 — 브라우저가 빨간 줄로 찍을 뿐
    if (page.url().endsWith("/teacher") && /status of 401/.test(m.text())) return;
    errors.push(`${page.url()} :: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${page.url()} :: pageerror ${e.message}`));
  for (const path of ["/", "/coloring", "/gallery", "/teacher", "/draw?mode=sketch"]) {
    await page.goto(path);
    await page.waitForTimeout(2000);
  }
  // 부분색칠·명화(미술관)·메타 전통 도안을 실제로 연다
  for (const tpl of ["/templates/pc_zoo/pc_zoo_01_half.webp", "/templates/masters/masters_quarter_mu_tiger_family.webp", "/templates/tradition/tradition_mid_16.webp"]) {
    await page.goto(`/draw?template=${encodeURIComponent(tpl)}&mode=coloring`);
    await page.getByLabel("그림 캔버스").waitFor();
    await page.waitForTimeout(2000);
  }
  // 도안 목록: 단계별 색칠 주제가 비어 있지 않다
  await page.goto("/coloring");
  await page.getByTestId("theme-card").first().waitFor();
  await page.getByTestId("theme-card").filter({ hasText: "부분색칠" }).first().click();
  await expect(page.locator('a[href^="/draw?template="]').first()).toBeVisible();
  console.log(`console_errors=${errors.length}`);
  expect(errors, errors.join("\n")).toEqual([]);
});
