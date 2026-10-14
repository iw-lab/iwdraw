import { test, expect, type Page } from "@playwright/test";

/* 새로고침하면 서비스워커가 페이지를 넘겨받아 /api 요청이 page.route(가짜 응답)를 비켜 간다 → 로그인 화면으로 오판 */
test.use({ serviceWorkers: "block" });

/*
 * 선생님 학급 갤러리 새로고침 — 2026-10-14 사용자 «선생님 계정으로 갤러리에서 새로고침하면 갤러리에 남게, 자꾸 나가진다».
 * 열린 갤러리를 화면 state 에만 두면 새로고침에 날아간다 → 주소(?gallery=<학급>)에 둔다.
 * 서버(/api)는 가짜 응답으로 막는다 — 실제 계정·데이터에 손대지 않는다(라이브 설정에서도 쓰기 0).
 */
async function mockTeacherApi(page: Page) {
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/teacher/me") return json({ id: "t-test", name: "시험 선생님" });
    if (p === "/api/classes") return json([{ id: "c-test", name: "시험반", code: "TEST01", is_active: true, created_at: 0, student_count: 0 }]);
    if (p.endsWith("/students") || p.endsWith("/artworks")) return json([]);
    return json({}, 404);
  });
}

test("학급 갤러리에서 새로고침해도 갤러리에 남고, 뒤로 가면 대시보드", async ({ page }) => {
  await mockTeacherApi(page);
  await page.goto("/teacher");
  test.skip(await page.getByText("교사 기능 준비 중").isVisible().catch(() => false), "백엔드 없는 빌드");
  await page.getByText("시험반").first().waitFor();
  await page.getByRole("button", { name: /갤러리/ }).first().click();
  const back = page.getByRole("button", { name: "뒤로" });
  await expect(back).toBeVisible();
  await expect(page).toHaveURL(/\?gallery=c-test/);

  await page.reload();
  await expect(back, "새로고침 뒤에도 학급 갤러리").toBeVisible({ timeout: 15_000 });
  await expect(back).toContainText("시험반");

  await back.click();
  await expect(page.getByText("입장 코드").first(), "뒤로 = 대시보드").toBeVisible();
  await expect(page).not.toHaveURL(/gallery=/);

  // 브라우저 뒤로 가기도 대시보드로
  await page.getByRole("button", { name: /갤러리/ }).first().click();
  await expect(back).toBeVisible();
  await page.goBack();
  await expect(page.getByText("입장 코드").first()).toBeVisible();

  // [뒤로] 단추로 닫은 뒤 기록에 대시보드가 두 번 남지 않는다 — 열고 닫은 횟수와 무관하게 기록 길이 그대로
  const len0 = await page.evaluate(() => history.length);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /갤러리/ }).first().click();
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.getByText("입장 코드").first()).toBeVisible();
  }
  await expect(page).not.toHaveURL(/gallery=/);
  expect(await page.evaluate(() => history.length), "열고 닫기 3번 뒤 기록 길이").toBeLessThanOrEqual(len0 + 1);
});
