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
