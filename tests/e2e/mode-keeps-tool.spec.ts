import { test, expect } from "@playwright/test";

/* 캔버스(모드)를 바꿔도 쓰던 도구가 그대로 선택돼 있다 — 2026-10-08 사용자 «캔버스를 변경하면 도구가 자동으로 바뀐다» */
test("모드를 바꿔도 쓰던 도구가 유지된다", async ({ page }) => {
  await page.goto("/draw?mode=sketch");
  await page.getByLabel("그림 캔버스").waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  const tool = page.getByRole("button", { name: "오일파스텔", exact: true });
  await tool.click();
  await expect(tool).toHaveAttribute("aria-pressed", "true");
  for (const mode of ["유화", "수채화", "스케치"]) {
    await page.getByRole("tab", { name: mode }).first().click();
    await expect(tool, `${mode} 로 바꾼 뒤`).toHaveAttribute("aria-pressed", "true");
  }
});

/* 도구를 바꿔도 캔버스(빈 종이)는 그대로 — 붓펜을 고르면 바탕이 한지로 바뀌던 것(2026-10-08 사용자) */
test("붓펜을 골라도 빈 종이가 바뀌지 않는다", async ({ page }) => {
  await page.goto("/draw?mode=oil&backend=gl");
  await page.getByLabel("그림 캔버스").waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  const paper = () =>
    page.evaluate(() => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      return Array.from(el.getContext("2d")!.getImageData(Math.round(el.width * 0.6), Math.round(el.height * 0.7), 80, 40).data);
    });
  await page.getByRole("button", { name: "유화붓", exact: true }).click();
  await page.waitForTimeout(800);
  const before = await paper();
  await page.getByRole("button", { name: "붓펜", exact: true }).click();
  await page.waitForTimeout(500);
  const after = await paper();
  const d = before.reduce((s, v, i) => s + Math.abs(v - after[i]), 0) / before.length;
  expect(d, "빈 종이 픽셀 차이").toBeLessThan(0.5);
});
