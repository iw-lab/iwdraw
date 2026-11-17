import { test } from "@playwright/test";

/*
 * 붓마다 획 중 프레임 간격(2026-11-17 운영 렉 표: 파스텔 p75 359 · 색연필 106 · 글로우·무지개 120+ · 마커·아크릴 77).
 * 같은 조건(CPU 느리게·같은 8획)으로 붓만 바꿔 잰다 — 계측용(단언 없음) · BRUSHES="파스텔,연필" 로 고른다.
 */
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] }, deviceScaleFactor: 1, viewport: { width: 1366, height: 768 } });
test.setTimeout(900_000);
const RATE = Number(process.env.STROKE_RATE ?? 6);
const BRUSHES = (process.env.BRUSHES ?? "연필,색연필,마커,아크릴펜,파스텔,글로우,무지개,반짝이,에어브러시,수채붓,유화붓").split(",");

test("붓별 획 중 프레임 간격", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const out: Record<string, unknown> = {};
  for (const name of BRUSHES) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.goto(`/draw?mode=sketch&backend=${process.env.STROKE_BACKEND ?? "gl"}${process.env.STROKE_QS ?? ""}`);
    await page.getByLabel("그림 캔버스").waitFor();
    const fresh = page.getByRole("button", { name: /새로 시작/ });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    await page.waitForTimeout(400);
    const btn = page.getByRole("button", { name, exact: true });
    if (!(await btn.isVisible().catch(() => false))) { out[name] = "단추 없음"; continue; }
    await btn.click();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    out[name] = await page.evaluate(async () => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const rect = el.getBoundingClientRect();
      const frames: number[] = [];
      let last = performance.now(), run = true;
      const tick = () => { const now = performance.now(); frames.push(now - last); last = now; if (run) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      const fire = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: rect.left + x, clientY: rect.top + y, pressure: 0.6, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await wait(400); frames.length = 0;
      for (let s = 0; s < 8; s++) { const y0 = 40 + s * 30; fire("pointerdown", 40, y0); for (let i = 1; i <= 40; i++) { fire("pointermove", 40 + (i / 40) * (rect.width - 80), y0 + Math.sin(i / 5) * 20); await wait(8); } fire("pointerup", rect.width - 40, y0); await wait(50); }
      run = false;
      const s = frames.slice().sort((a, b) => a - b); const q = (p: number) => Math.round(s[Math.floor(s.length * p)] ?? 0);
      return { p50: q(0.5), p75: q(0.75), p90: q(0.9), max: q(0.999) };
    });
  }
  console.log("[brush-cost]", JSON.stringify(out));
});
