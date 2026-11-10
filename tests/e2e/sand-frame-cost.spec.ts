import { test, expect } from "@playwright/test";

/*
 * 샌드아트 저사양(웨일북) 렉 계측 — 2026-11-10 사용자 «웨일북 저사양에서 렉이 아직도».
 * 렉 판정 = 사용자 체감 축(그리는 동안 rAF 프레임 간격). CPU 스로틀 SAND_RATE 배(기본 6).
 * 붓기(오래 누름+이동) · 손가락 · 손바닥 각각 p75 프레임 간격을 잰다.
 */
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] }, deviceScaleFactor: 1, viewport: { width: 1366, height: 768 } });
test.setTimeout(240_000);
const RATE = Number(process.env.SAND_RATE ?? 6);
const P75_MAX = Number(process.env.SAND_P75_MAX ?? 50);

for (const tool of ["pour", "finger", "palm"] as const) {
  test(`샌드 프레임 간격 — ${tool} · CPU ${RATE}배`, async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await page.goto("/sand");
    await page.getByTestId("sand-canvas").waitFor();
    await expect(page.getByText("모래판을 깔고 있어요")).toHaveCount(0);
    if (tool !== "pour") await page.getByTestId("sand-fill").click({ force: true });
    await page.getByTestId(`sand-tool-${tool}`).click({ force: true });
    await page.waitForTimeout(400);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    const r = await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="sand-canvas"]') as HTMLCanvasElement;
      const rect = el.getBoundingClientRect();
      const frames: number[] = [];
      let last = performance.now();
      let run = true;
      const tick = () => { const now = performance.now(); frames.push(now - last); last = now; if (run) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      const fire = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: rect.left + x, clientY: rect.top + y, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      const t0 = performance.now();
      for (let s = 0; s < 3; s++) {
        const y = rect.height * (0.3 + s * 0.2);
        fire("pointerdown", rect.width * 0.15, y);
        for (let i = 0; i <= 60; i++) { fire("pointermove", rect.width * (0.15 + i * 0.012), y + Math.sin(i / 6) * 30); await wait(16); }
        await wait(300); // 붓기는 멈춰도 흘러내린다
        fire("pointerup", rect.width * 0.87, y);
      }
      run = false;
      const f = frames.slice(2).sort((a, b) => a - b);
      const q = (p: number) => Math.round(f[Math.min(f.length - 1, Math.floor(f.length * p))]);
      return { n: f.length, med: q(0.5), p75: q(0.75), p90: q(0.9), wall: Math.round(performance.now() - t0) };
    });
    console.log(`SAND_FRAME ${tool} rate=${RATE} ${JSON.stringify(r)}`);
    expect(r.p75, "그리는 동안 프레임 간격 p75(ms)").toBeLessThanOrEqual(P75_MAX);
  });
}
