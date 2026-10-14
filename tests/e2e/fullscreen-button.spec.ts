import { test, expect } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

/*
 * 그리기 화면 전체화면 단추 — 폰 브라우저는 주소창·아래 막대가 그림판을 크게 먹는다(2026-10-14 사용자 폰 제보:
 * 412px 갤럭시에서 캔버스가 화면 1/3). 단추는 «더보기» 메뉴 속이 아니라 헤더에 바로 보여야 하고,
 * 누르면 전체화면이 되고 다시 누르면 풀린다. 다른 헤더 단추를 가리면 안 된다.
 */
for (const width of [360, 412, 768, 1366]) {
  test(`${width}px: 전체화면 단추가 헤더에 보이고 켜고 끈다`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 860 : 800 });
    await page.goto("/draw?mode=sketch&backend=gl");
    await page.getByLabel("그림 캔버스").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const btn = page.getByTestId("fullscreen-toggle");
    await expect(btn).toBeVisible();
    const box = (await btn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    // 단추 중심을 누르면 단추 자신이 맞아야 한다(다른 단추에 가려지지 않음)
    const hitSelf = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (el === hit || el.contains(hit));
    });
    expect(hitSelf).toBe(true);
    await btn.click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(btn).toHaveAttribute("aria-label", "전체화면 끝내기");
    await btn.click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  });
}
