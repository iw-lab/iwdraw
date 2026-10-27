import { test, expect } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

/*
 * 도안 선 진하기(2026-10-27 사용자 «선따기 선의 선명도를 사용자가 조절»).
 * 패널 맨 위 «도안 선 진하기» 슬라이더를 내리면 화면의 도안 선이 실제로 연해지고, 올리면 다시 진해진다.
 * 도안이 없는 빈 그림판에는 슬라이더가 없다.
 */
const darkest = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
    const d = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
    let min = 255;
    for (let i = 0; i < d.length; i += 16) min = Math.min(min, 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    return Math.round(min);
  });

test("도안 선 진하기 슬라이더로 선이 연해졌다 진해진다", async ({ page }) => {
  await page.goto(`/draw?template=${encodeURIComponent("/templates/animals/animals_high_01.webp")}&mode=coloring&backend=gl`);
  const canvas = page.getByLabel("그림 캔버스");
  await canvas.waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  const slider = page.getByLabel("도안 선 진하기");
  await expect(slider).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  const full = await darkest(page);
  expect(full).toBeLessThan(80);
  await slider.fill("20");
  await page.waitForTimeout(400);
  const light = await darkest(page);
  expect(light).toBeGreaterThan(150);
  await slider.fill("100");
  await page.waitForTimeout(400);
  expect(await darkest(page)).toBeLessThan(80);
});

test("빈 그림판에는 도안 선 진하기가 없다", async ({ page }) => {
  await page.goto("/draw?mode=sketch&backend=gl");
  await page.getByLabel("그림 캔버스").waitFor();
  await page.waitForTimeout(800);
  await expect(page.getByLabel("도안 선 진하기")).toHaveCount(0);
});
