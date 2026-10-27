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

const inkCount = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
    const d = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 100) n++;
    return n;
  });

test("도안 선 굵기·200% 진하기로 선이 굵고 진해지고, 다시 들어와도 남는다", async ({ page }) => {
  const url = `/draw?template=${encodeURIComponent("/templates/animals/animals_high_01.webp")}&mode=coloring&backend=gl`;
  await page.goto(url);
  await page.getByLabel("그림 캔버스").waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  await expect(page.getByLabel("도안 선 굵기")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  const base = await inkCount(page);
  await page.getByLabel("도안 선 굵기").fill("3");
  await page.waitForTimeout(900);
  const thick = await inkCount(page);
  expect(thick).toBeGreaterThan(base * 1.4);
  await page.getByLabel("도안 선 진하기").fill("200");
  await page.waitForTimeout(900);
  const dark = await inkCount(page);
  expect(dark).toBeGreaterThan(thick * 1.03);
  await expect(page.getByText("아주 굵게")).toBeVisible();
  // 자동 저장(디바운스 5초) 뒤 새로고침하면 굵기·진하기 그대로 되살아난다
  await page.waitForTimeout(7000);
  await page.reload();
  await page.getByLabel("그림 캔버스").waitFor();
  const cont = page.getByRole("button", { name: "이어 그리기" });
  if (await cont.isVisible({ timeout: 4000 }).catch(() => false)) await cont.click();
  await expect(page.getByLabel("도안 선 굵기")).toHaveValue("3", { timeout: 10000 });
  await page.waitForTimeout(800);
  expect(await inkCount(page)).toBeGreaterThan(base * 1.4);
});

test("빈 그림판에는 도안 선 진하기가 없다", async ({ page }) => {
  await page.goto("/draw?mode=sketch&backend=gl");
  await page.getByLabel("그림 캔버스").waitFor();
  await page.waitForTimeout(800);
  await expect(page.getByLabel("도안 선 진하기")).toHaveCount(0);
});
