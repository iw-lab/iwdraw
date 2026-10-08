import { test, expect } from "@playwright/test";

/*
 * 유화·납작붓 획 중 프레임 비용 게이트 — 2026-10-08 사용자 «중간중간 끊긴다».
 * 원인: 라이브 프리뷰가 매 프레임 «캔버스 전체»에 임파스토 릴리프(blur + 전면 drawImage 10여 회)를
 * 다시 계산 → CPU 4배 감속에서 유화 146ms·납작붓 118ms/프레임(연필 27ms). 바뀐 영역만 다시
 * 만들도록 고친 뒤 38·36ms. 절대값은 기기마다 달라 «같은 조건의 연필 대비 배율»로 잠근다.
 * 입력은 페이지 안에서 rAF 마다 직접 쏜다 — page.mouse 는 왕복 지연이 프레임 간격에 섞인다.
 */
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] }, deviceScaleFactor: 1 });
test.setTimeout(180_000);

for (const backend of ["gl", "2d"]) {
  test(`유화 획 중 프레임이 연필과 비슷하다(${backend}, CPU 4배 감속)`, async ({ page }) => {
    await page.goto(`/draw?mode=oil&backend=${backend}`);
    await page.getByLabel("그림 캔버스").waitFor();
    const fresh = page.getByRole("button", { name: /새로 시작/ });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    await page.waitForTimeout(300);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const p50: Record<string, number> = {};
    for (const [i, brush] of ["연필", "유화붓", "납작붓"].entries()) {
      await page.getByRole("button", { name: brush, exact: true }).click();
      await page.getByLabel("브러시 굵기", { exact: true }).fill("20");
      p50[brush] = await page.evaluate(async (row) => {
        const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
        const b = el.getBoundingClientRect();
        const y0 = b.top + b.height * (0.25 + row * 0.25);
        const fire = (type: string, k: number) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
              buttons: type === "pointerup" ? 0 : 1,
              pressure: 0.5,
              clientX: b.left + b.width * (0.1 + (0.8 * k) / 60),
              clientY: y0 + Math.sin(k / 6) * 30,
            }),
          );
        const raf = () => new Promise((res) => requestAnimationFrame(res));
        const gaps: number[] = [];
        fire("pointerdown", 0);
        await raf();
        let t = performance.now();
        for (let k = 1; k <= 60; k++) {
          fire("pointermove", k);
          await raf();
          const n = performance.now();
          gaps.push(n - t);
          t = n;
        }
        fire("pointerup", 60);
        gaps.sort((x, y) => x - y);
        return gaps[30];
      }, i);
    }
    console.log(`OIL-FRAME ${backend} ${JSON.stringify(p50)}`);
    // 수정 전 배율 4.3~5.4, 수정 후 ≈1.1
    expect(p50["유화붓"], "유화붓 / 연필 프레임 간격").toBeLessThan(p50["연필"] * 2);
    expect(p50["납작붓"], "납작붓 / 연필 프레임 간격").toBeLessThan(p50["연필"] * 2);
  });
}
