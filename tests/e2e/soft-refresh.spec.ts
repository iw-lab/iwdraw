import { test, expect, type Page } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });
test.setTimeout(120_000);

/*
 * 안전 새로고침(lib/soft-refresh.ts) — 2026-10-14 사용자 «웨일북 한 시간 렉, 15분에 한 번씩 작업 그대로 리프레싱».
 * ?softRefreshMs=4000 으로 간격만 줄여, ① 손을 뗀 틈에 새로고침되고 ② 그림·붓·색이 그대로이며
 * ③ [이어 그리기] 배너를 묻지 않고 ④ 긋는 중에는 절대 새로고침하지 않는지 본다.
 */
async function open(page: Page) {
  await page.goto("/draw?mode=sketch&backend=gl&softRefreshMs=4000");
  await page.getByLabel("그림 캔버스").waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible({ timeout: 1500 }).catch(() => false)) await fresh.click();
  await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));
}
const marked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mark?: number }).__mark === 1).catch(() => false);

async function yellowAt(page: Page, fx: number, fy: number) {
  return page.evaluate(
    ([x, y]) => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const d = el.getContext("2d")!.getImageData(Math.round(el.width * x) - 4, Math.round(el.height * y) - 4, 9, 9).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 140 && d[i + 2] < 150) n++;
      return n;
    },
    [fx, fy] as [number, number],
  );
}

test("손을 뗀 틈에 새로고침되고 그림·붓·색이 그대로다", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "크레용", exact: true }).click();
  await page.getByRole("button", { name: "색 8", exact: true }).click(); // 노랑 255,200,74
  const box = (await page.getByLabel("그림 캔버스").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(box.x + box.width * (0.3 + 0.4 * (k / 20)), box.y + box.height * 0.5);
  await page.mouse.up();
  expect(await yellowAt(page, 0.5, 0.5)).toBeGreaterThan(10);

  await page.waitForEvent("load", { timeout: 40_000 }); // 4초 경과 + 4초 손 뗌 → 저장 후 새로고침
  await page.getByLabel("그림 캔버스").waitFor();
  await page.waitForTimeout(2500);
  expect(await marked(page), "페이지가 실제로 새로 불러와졌다").toBe(false);
  await expect(page.getByRole("button", { name: "이어 그리기" }), "묻지 않고 되살린다").toHaveCount(0);
  expect(await yellowAt(page, 0.5, 0.5), "그린 획이 그대로").toBeGreaterThan(10);
  const st = await page.evaluate(() => {
    const e = (window as unknown as { __artonEngine: { brushId: string; settings: { color: { r: number; g: number; b: number } } } }).__artonEngine;
    return { brush: e.brushId, color: e.settings.color };
  });
  expect(st.brush, "붓 그대로").toBe("crayon");
  expect(st.color, "색 그대로").toEqual({ r: 255, g: 200, b: 74 });
  await expect(page.getByRole("button", { name: "크레용", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("긋는 중에는 새로고침하지 않는다", async ({ page }) => {
  await open(page);
  const box = (await page.getByLabel("그림 캔버스").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.down();
  // 간격(4초)을 한참 넘겨 12초 동안 붓을 떼지 않는다
  for (let k = 0; k < 60; k++) {
    await page.mouse.move(box.x + box.width * (0.3 + (k % 10) * 0.03), box.y + box.height * 0.4);
    await page.waitForTimeout(200);
  }
  expect(await marked(page), "긋는 중 새로고침 금지").toBe(true);
  await page.mouse.up();
  await page.waitForEvent("load", { timeout: 40_000 }); // 손을 떼면 그다음 틈에
  expect(await marked(page)).toBe(false);
});

test("[이어 그리기] 배너가 떠 있으면 새로고침하지 않는다(이전 그림 저장본을 덮어쓰지 않게)", async ({ page }) => {
  await open(page);
  const box = (await page.getByLabel("그림 캔버스").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + box.width * (0.3 + 0.04 * k), box.y + box.height * 0.5);
  await page.mouse.up();
  await page.waitForEvent("load", { timeout: 40_000 }); // 첫 새로고침(저장본 생김)
  // 다른 주소(가로 캔버스)로 새로 들어오면 표식은 안 맞고 저장본만 있다 → 배너
  await page.goto("/draw?mode=sketch&backend=gl&softRefreshMs=4000&orientation=landscape");
  await expect(page.getByRole("button", { name: "이어 그리기" })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));
  await page.waitForTimeout(14_000); // 간격 4초 + 손 뗌 4초를 넉넉히 넘긴다
  expect(await marked(page), "배너가 떠 있는 동안 새로고침 금지").toBe(true);
  await expect(page.getByRole("button", { name: "이어 그리기" })).toBeVisible();
});
