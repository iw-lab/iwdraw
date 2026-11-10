import { test, expect } from "@playwright/test";

/*
 * 샌드아트 «그린 과정» 갤러리 공유(2026-11-10 사용자 «샌드아트는 영상을 공유해야 큰 의미»).
 * 학생: 입장 → 쏟고 다른 색으로 붓기 → 전시하기(기록 함께) → 우리 반 갤러리 → «▶ 그리는 과정» → 무비 끝까지.
 * 교사: 같은 작품의 «그리는 과정»도 열린다.
 * ⚠️ 쓰기 시험 — 라이브(실서버 D1·R2)에서는 돌지 않는다. 로컬 전체(.harness/local-stack.sh, :8799)에서만.
 */
const local = /localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL ?? "");
test.skip(!local, "갤러리 쓰기 시험 — 로컬 전체(E2E_BASE_URL=http://localhost:8799)에서만");
test.setTimeout(180_000);

test("학생이 전시한 샌드아트의 그리는 과정을 반 친구·선생님이 무비로 본다", async ({ page, browser, baseURL }) => {
  // 교사·학급(API)
  const t = await browser.newContext({ baseURL });
  const email = `sand${Date.now()}@test.local`;
  expect((await t.request.post("/api/teacher/signup", { data: { email, password: "pass12345!", agreed: true } })).ok()).toBe(true);
  const cls = await (await t.request.post("/api/classes", { data: { name: "모래반" } })).json();
  expect(cls.code).toBeTruthy();

  // 학생 입장
  await page.goto("/join?next=/sand");
  await page.getByLabel("학급 코드").fill(cls.code);
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByLabel("닉네임").fill("모래아이");
  await page.getByRole("button", { name: /그리러 가기/ }).click();
  await page.waitForURL(/\/sand/);
  await page.getByTestId("sand-canvas").waitFor();
  await expect(page.getByText("모래판을 깔고 있어요")).toHaveCount(0);

  // 검은 모래 쏟기 → 붉은 모래로 긋기
  await page.getByTestId("sand-color-dark").click({ force: true });
  await page.getByTestId("sand-fill").click({ force: true });
  await page.getByTestId("sand-color-red").click({ force: true });
  await page.getByTestId("sand-tool-pour").click({ force: true });
  const box = (await page.getByTestId("sand-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.3 + i * 0.02), box.y + box.height * 0.5, { steps: 2 });
  await page.mouse.up();

  // 전시하기 — 그림과 함께 기록(.sand · gzip)이 올라간다(서버 목록으로 확인 — 멀티파트 본문은 Playwright 가 못 읽는다)
  await page.getByTestId("sand-save").click();
  await page.getByRole("button", { name: "이 제목으로 저장" }).click();
  await expect(page.getByText(/갤러리에 전시했어요/)).toBeVisible({ timeout: 20_000 });
  const arts = await (await t.request.get(`/api/classes/${cls.id}/artworks`)).json();
  expect(arts[0].mode).toBe("sand");
  expect(arts[0].timelapse_path, "기록이 함께 올라간다").toMatch(/\.sand$/);

  // 우리 반 갤러리 → 크게 → 그리는 과정
  await page.goto("/gallery");
  await page.getByAltText(/모래아이/).first().click();
  await page.getByTestId("sand-replay").click();
  await expect(page.getByTestId("sand-movie")).toBeVisible();
  await expect(page.getByTestId("sand-movie-progress")).toHaveAttribute("data-progress", "1.000", { timeout: 60_000 });
  // 끝 장면에 붉은 줄이 있다(색까지 기록에 들어갔다)
  const red = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="sand-movie-canvas"]') as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.5), 1, 1).data;
    return d[0] - d[2];
  });
  expect(red, "무비 끝 장면 = 붉은 줄").toBeGreaterThan(40);

  // 교사 갤러리에서도
  const tp = await t.newPage();
  await tp.goto("/teacher");
  await tp.getByRole("button", { name: /갤러리/ }).first().click();
  await tp.getByAltText(/모래아이/).first().click();
  await tp.getByTestId("sand-replay").click();
  await expect(tp.getByTestId("sand-movie-progress")).toHaveAttribute("data-progress", "1.000", { timeout: 60_000 });
  await t.close();
});
