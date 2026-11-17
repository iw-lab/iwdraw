import { test, expect } from "@playwright/test";

/*
 * 선행쌤 전시관 «그리는 과정» 반복 재생(2026-11-17 사용자 «샌드아트 보내면 그리는 과정이 전시관에서 계속 반복»).
 * 학생: 모래 그림 전시 → 교사: 걸기 창에서 «과정 확인» 전엔 과정 걸기 칸이 잠김 → 보고 확인 → 걸기
 * → 공개 목록 v=true → /showcase/play 가 끝까지 그리고(붉은 줄) 다시 처음부터 그린다.
 * 가린 곳이 있으면 과정은 못 건다(과정 속에선 못 가린다).
 * ⚠️ 쓰기 시험 — 로컬 전체(E2E_BASE_URL=http://localhost:8799)에서만.
 */
const local = /localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL ?? "");
test.skip(!local, "전시관 쓰기 시험 — 로컬 전체에서만");
test.setTimeout(240_000);

test("과정까지 확인해 건 샌드아트는 전시관 재생 화면에서 끝없이 다시 그려진다", async ({ page, browser, baseURL }) => {
  const t = await browser.newContext({ baseURL });
  expect((await t.request.post("/api/teacher/signup", { data: { email: `play${Date.now()}@test.local`, password: "pass12345!", agreed: true } })).ok()).toBe(true);
  const cls = await (await t.request.post("/api/classes", { data: { name: "모래반" } })).json();

  await page.goto("/join?next=/sand");
  await page.getByLabel("학급 코드").fill(cls.code);
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByLabel("닉네임").fill("모래아이");
  await page.getByRole("button", { name: /그리러 가기/ }).click();
  await page.waitForURL(/\/sand/);
  await page.getByTestId("sand-canvas").waitFor();
  await expect(page.getByText("모래판을 깔고 있어요")).toHaveCount(0);
  await page.getByTestId("sand-color-dark").click({ force: true });
  await page.getByTestId("sand-fill").click({ force: true });
  await page.getByTestId("sand-color-red").click({ force: true });
  await page.getByTestId("sand-tool-pour").click({ force: true });
  const box = (await page.getByTestId("sand-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.3 + i * 0.02), box.y + box.height * 0.5, { steps: 2 });
  await page.mouse.up();
  await page.getByTestId("sand-save").click();
  await page.getByRole("button", { name: "이 제목으로 저장" }).click();
  await expect(page.getByText(/갤러리에 전시했어요/)).toBeVisible({ timeout: 20_000 });
  const art = (await (await t.request.get(`/api/classes/${cls.id}/artworks`)).json())[0];

  // 교사 걸기 창
  const tp = await t.newPage();
  await tp.goto("/teacher");
  await tp.getByRole("button", { name: /갤러리/ }).first().click();
  await tp.locator(`[data-showcase-art="${art.id}"]`).click();
  const dlg = tp.locator("[data-showcase-dialog]");
  await expect(dlg.locator("[data-showcase-replay-box]")).toBeVisible();
  await expect(dlg.locator("[data-showcase-replay-check]"), "과정을 보기 전엔 과정 걸기 칸이 잠김").toBeDisabled();
  // 네모로 가리면 과정은 못 건다
  const cb = (await dlg.locator("[data-cover-box]").boundingBox())!;
  await tp.mouse.move(cb.x + 10, cb.y + 10);
  await tp.mouse.down();
  await tp.mouse.move(cb.x + 60, cb.y + 40, { steps: 4 });
  await tp.mouse.up();
  await expect(dlg.locator("[data-showcase-replay-blocked]")).toBeVisible();
  await dlg.getByRole("button", { name: "하나 되돌리기" }).click();
  // 과정 확인 → 무비 끝까지 → 닫기 → 칸 풀림
  await dlg.getByTestId("sand-replay").click();
  await expect(tp.getByTestId("sand-movie-progress")).toHaveAttribute("data-progress", "1.000", { timeout: 60_000 });
  await tp.getByTestId("sand-movie").getByRole("button", { name: "닫기" }).click();
  await dlg.locator("[data-showcase-replay-check]").check();
  await dlg.locator("[data-showcase-check]").check();
  await dlg.locator("[data-showcase-confirm]").click();
  await expect(tp.locator(`[data-showcase-art="${art.id}"]`)).toHaveAttribute("data-showcase", "on");

  const list = await (await t.request.get("/api/showcase")).json();
  expect(list.works.find((w: { id: string }) => w.id === art.id)?.v, "공개 목록에 과정 표시").toBe(true);

  // 재생 화면 — 끝까지 그린 뒤 다시 처음부터(빈 판에서 다시 붉은 줄이 생긴다)
  const v = await browser.newPage();
  await v.goto(`/showcase/play?id=${art.id}`);
  await expect(v.getByTestId("showcase-play")).toHaveAttribute("data-state", "playing", { timeout: 20_000 });
  const redAt = () =>
    v.evaluate(() => {
      const c = document.querySelector("canvas") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.5), 1, 1).data;
      return d[0] - d[2];
    });
  await expect.poll(redAt, { timeout: 40_000, message: "끝 장면 = 붉은 줄" }).toBeGreaterThan(40);
  await expect.poll(redAt, { timeout: 40_000, message: "다시 처음부터(붉은 줄이 사라진 판)" }).toBeLessThan(20);
  await expect.poll(redAt, { timeout: 40_000, message: "두 번째 바퀴도 끝까지" }).toBeGreaterThan(40);

  // 과정을 안 건 그림·없는 id = 재생 화면은 «bad»(선행쌤은 그림 한 장으로 돌아간다)
  await v.goto(`/showcase/play?id=nope123456`);
  await expect(v.getByTestId("showcase-play")).toHaveAttribute("data-state", "bad", { timeout: 20_000 });
  await t.close();
});
