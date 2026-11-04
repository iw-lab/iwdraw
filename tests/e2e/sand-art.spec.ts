import { test, expect, type Page } from "@playwright/test";

/*
 * 샌드아트(/sand) — 실제 손 움직임으로 모래판이 바뀌는지, 되돌리기·무비·이어 그리기가 맞는지.
 * 화면 픽셀로 잰다(엔진 내부 값을 믿지 않는다).
 */

const lum = (page: Page, fx: number, fy: number) =>
  page.evaluate(([fx, fy]) => {
    const c = document.querySelector('[data-testid="sand-canvas"]') as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
    return Math.round(0.3 * d[0] + 0.59 * d[1] + 0.11 * d[2]);
  }, [fx, fy] as const);

async function openClean(page: Page) {
  await page.goto("/sand");
  await page.getByTestId("sand-canvas").waitFor();
  await expect(page.getByText("모래판을 깔고 있어요")).toHaveCount(0);
  const sweep = page.getByTestId("sand-sweep");
  if (await sweep.isEnabled()) await sweep.click({ force: true });
  const box = (await page.getByTestId("sand-canvas").boundingBox())!;
  return (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
}

async function drag(page: Page, P: (x: number, y: number) => readonly [number, number], pts: [number, number][]) {
  const [x0, y0] = P(...pts[0]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const [x, y] = P(...p);
    await page.mouse.move(x, y, { steps: 2 });
  }
  await page.mouse.up();
}

test("붓기·손가락·손바닥이 판을 바꾸고, 되돌리기·다시하기가 정확하다", async ({ page }) => {
  const P = await openClean(page);
  const empty = await lum(page, 0.3, 0.5);
  expect(empty, "빈 판 = 환한 빛").toBeGreaterThan(180);

  // 붓기 — 1초 누르면 그 자리가 어두워진다
  await page.getByTestId("sand-tool-pour").click({ force: true });
  const [px, py] = P(0.3, 0.5);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
  await expect.poll(() => lum(page, 0.3, 0.5), { message: "붓기 = 모래가 쌓여 어두움" }).toBeLessThan(empty - 120);

  // 쏟기 → 손가락 선 → 그 자리에 빛
  await page.getByTestId("sand-fill").click({ force: true });
  await expect.poll(() => lum(page, 0.5, 0.5)).toBeLessThan(70);
  const full = await lum(page, 0.5, 0.5);
  await page.getByTestId("sand-tool-finger").click({ force: true });
  await drag(page, P, Array.from({ length: 21 }, (_, i) => [0.3 + i * 0.02, 0.5] as [number, number]));
  await expect.poll(() => lum(page, 0.5, 0.5), { message: "손가락 자국 = 빛" }).toBeGreaterThan(full + 100);

  // 손바닥 — 쓴 자리는 모래가 얇아져 밝아진다
  await page.getByTestId("sand-tool-palm").click({ force: true });
  const palmBefore = await lum(page, 0.5, 0.25);
  await drag(page, P, Array.from({ length: 16 }, (_, i) => [0.42 + i * 0.02, 0.25] as [number, number]));
  await expect.poll(() => lum(page, 0.5, 0.25), { message: "손바닥으로 쓴 자리" }).toBeGreaterThan(palmBefore + 30);

  // 되돌리기 2번 = 손가락 전(쏟은 판) · 다시 2번 = 지금
  await page.waitForTimeout(100);
  const now = await lum(page, 0.5, 0.5);
  await page.getByTestId("sand-undo").click({ force: true });
  await page.getByTestId("sand-undo").click({ force: true });
  // 화면은 다음 프레임에 칠해진다 — 한 프레임 기다려 잰다(poll)
  await expect.poll(async () => Math.abs((await lum(page, 0.5, 0.5)) - full)).toBeLessThanOrEqual(2);
  await page.getByTestId("sand-redo").click({ force: true });
  await page.getByTestId("sand-redo").click({ force: true });
  await expect.poll(() => lum(page, 0.5, 0.5)).toBe(now);
});

test("무비 마지막 장면 = 지금 그림 · 새로고침해도 그림이 남는다", async ({ page }) => {
  const P = await openClean(page);
  await page.getByTestId("sand-fill").click({ force: true });
  await page.getByTestId("sand-tool-finger").click({ force: true });
  const heart: [number, number][] = [];
  for (let t = 0; t <= Math.PI * 2 + 0.01; t += 0.08) {
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    heart.push([0.5 + x / 70, 0.45 - y / 55]);
  }
  await drag(page, P, heart);
  const sample = (sel: string) =>
    page.evaluate((sel) => {
      const c = document.querySelector(sel) as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      const out: number[] = [];
      for (let i = 0; i < d.length; i += 4 * 997) out.push(d[i], d[i + 1], d[i + 2]);
      return out;
    }, sel);
  const cur = await sample('[data-testid="sand-canvas"]');
  await page.getByTestId("sand-movie-btn").click({ force: true });
  await expect(page.getByTestId("sand-movie-progress")).toHaveAttribute("data-progress", "1.000", { timeout: 60_000 });
  const mov = await sample('[data-testid="sand-movie-canvas"]');
  let maxd = 0;
  for (let i = 0; i < cur.length; i++) maxd = Math.max(maxd, Math.abs(cur[i] - mov[i]));
  expect(maxd, "무비 끝 장면과 지금 그림의 픽셀 차").toBeLessThanOrEqual(6);
  await page.getByRole("button", { name: "닫기" }).click({ force: true });

  // 자동저장(3초 쉼) 뒤 새로고침
  const before = await lum(page, heart[8][0], heart[8][1]);
  await page.waitForTimeout(3800);
  await page.reload();
  await expect(page.getByText("모래판을 깔고 있어요")).toHaveCount(0);
  await expect.poll(() => lum(page, heart[8][0], heart[8][1])).toBe(before);
  // 새로고침 뒤 무비도 그대로 볼 수 있다(기록이 같이 저장됐다)
  await expect(page.getByTestId("sand-movie-btn")).toBeEnabled();
});

test("폰 세로: 넘치지 않고 손가락(터치)으로 그려진다", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await openClean(page);
  const ov = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(ov[0], "가로 넘침").toBeLessThanOrEqual(ov[1]);
  for (const id of ["sand-save", "sand-movie-btn", "sand-undo", "sand-tool-pour", "sand-tool-finger", "sand-tool-palm", "sand-fill", "sand-sweep"]) {
    const r = (await page.getByTestId(id).boundingBox())!;
    expect(r.x + r.width, `${id} 화면 안`).toBeLessThanOrEqual(390);
    expect(Math.min(r.width, r.height), `${id} 누르는 크기`).toBeGreaterThanOrEqual(44);
  }
  const grid = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="sand-canvas"]') as HTMLCanvasElement;
    return [c.width, c.height];
  });
  expect(grid[1], "세로 폰 = 세로 판").toBeGreaterThan(grid[0]);
  await page.getByTestId("sand-fill").click();
  await page.getByTestId("sand-tool-finger").click();
  const box = (await page.getByTestId("sand-canvas").boundingBox())!;
  const cdp = await ctx.newCDPSession(page);
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * 0.2, y }] });
  for (let i = 1; i <= 30; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * (0.2 + i * 0.02), y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => lum(page, 0.5, 0.5), { message: "터치로 판 자국(브라우저가 스크롤로 가로채면 실패)" }).toBeGreaterThan(150);
  await ctx.close();
});

test("모드 탭으로 샌드아트 ↔ 그리기를 오간다", async ({ page }) => {
  await page.goto("/draw?mode=sketch");
  await page.getByLabel("그림 캔버스").waitFor();
  await page.getByRole("tab", { name: "샌드아트" }).first().click();
  await expect(page).toHaveURL(/\/sand/);
  await page.getByTestId("sand-canvas").waitFor();
  await page.getByRole("tab", { name: "유화" }).first().click();
  await expect(page).toHaveURL(/\/draw\?mode=oil/);
});

/* 8way(grokweb): 한 번의 긴 붓질(10초 넘게 뿌리기) 중엔 저장이 없어 새로고침·크래시에 그린 모래를 잃었다 */
test("손을 떼지 않고 11초 뿌리다 새로고침해도 모래가 남는다", async ({ page }) => {
  const P = await openClean(page);
  await page.getByTestId("sand-tool-pour").click({ force: true });
  const [x, y] = P(0.5, 0.5);
  const before = await lum(page, 0.5, 0.5);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(11_500);
  await page.reload(); // 손을 떼기 전에 탭이 죽는 것과 같다
  await expect(page.getByText("모래판을 깔고 있어요")).toHaveCount(0);
  await expect.poll(() => lum(page, 0.5, 0.5), { message: "긴 붓질이 저장됐나" }).toBeLessThan(before - 120);
  // 저장된 판과 기록이 짝이 맞다 — 무비 끝 장면도 모래가 있다
  await page.getByTestId("sand-movie-btn").click({ force: true });
  await expect(page.getByTestId("sand-movie-progress")).toHaveAttribute("data-progress", "1.000", { timeout: 60_000 });
  const mv = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="sand-movie-canvas"]') as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return Math.round(0.3 * d[0] + 0.59 * d[1] + 0.11 * d[2]);
  });
  expect(mv, "무비 끝 장면 = 저장된 판").toBeLessThan(before - 120);
});

/* 8way(meta): 펜을 한 번 쓰면 그 뒤로 손가락이 영영 안 먹었다 — 샌드아트는 손가락 놀이다 */
test("펜을 쓴 뒤 잠시 지나면 손가락으로 다시 그려진다", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  await openClean(page);
  await page.getByTestId("sand-fill").click();
  await page.getByTestId("sand-tool-finger").click();
  const box = (await page.getByTestId("sand-canvas").boundingBox())!;
  const cdp = await ctx.newCDPSession(page);
  const yPen = box.y + box.height * 0.3;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + box.width * 0.3, y: yPen, button: "left", clickCount: 1, pointerType: "pen" });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.width * (0.3 + i * 0.03), y: yPen, button: "left", pointerType: "pen" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + box.width * 0.6, y: yPen, button: "left", clickCount: 1, pointerType: "pen" });
  await expect.poll(() => lum(page, 0.45, 0.3), { message: "펜 획" }).toBeGreaterThan(150);
  await page.waitForTimeout(2500);
  const y = box.y + box.height * 0.7;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * 0.3, y }] });
  for (let i = 1; i <= 20; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * (0.3 + i * 0.015), y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => lum(page, 0.45, 0.7), { message: "펜 뒤 손가락 획" }).toBeGreaterThan(150);
  await ctx.close();
});

/* 학급 학생으로 들어오면 단추가 «전시하기» — 세션을 렌더 중에 읽어 정적 HTML(«저장»)과 어긋나 React #418 이 났다(로컬 워커 실측) */
test("학급 학생으로 열어도 화면 오류가 없고 «전시하기»가 보인다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/privacy");
  await page.evaluate(() =>
    sessionStorage.setItem(
      "arton.student",
      JSON.stringify({ token: "x", studentId: "s", classId: "c", className: "반", nickname: "닉", classCode: "AAAAAA" }),
    ),
  );
  await page.goto("/sand");
  await expect(page.getByTestId("sand-save")).toContainText("전시하기");
  await page.waitForTimeout(1000);
  expect(errors, "화면 오류").toEqual([]);
});
