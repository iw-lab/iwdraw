import { test, expect } from "@playwright/test";

/*
 * 되돌리기·다시 하기가 화소 그대로인가(2026-11-17 획 끝 멈칫 제거: «앞» 픽셀은 GPU 사본 → 쉬는 틈에 배열,
 * «뒤» 픽셀은 되돌리는 순간에 읽는다). 붓 여러 개로 획을 긋고 획마다 레이어를 떠 둔 뒤,
 * 한 칸씩 되돌리며 그 앞 모습과 · 다시 하며 그 뒤 모습과 한 바이트도 안 다른지 본다.
 * 쉬는 틈 변환 전에 곧장 되돌리는 경우(빠른 손)와 기다린 뒤 되돌리는 경우 둘 다.
 */
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] }, deviceScaleFactor: 1, viewport: { width: 1366, height: 768 } });
test.setTimeout(300_000);
const BRUSHES = ["연필", "마커", "수채붓", "유화붓", "반짝이", "지우개", "색연필"];

for (const quick of [true, false]) {
  test(`되돌리기·다시 하기 화소 그대로 · ${quick ? "곧장" : "쉬었다가"}`, async ({ page }) => {
    await page.goto(`/draw?mode=sketch&backend=gl`);
    await page.getByLabel("그림 캔버스").waitFor();
    const fresh = page.getByRole("button", { name: /새로 시작/ });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    await page.waitForTimeout(500);
    const hashes: string[] = [];
    const snap = () => page.evaluate(() => {
      const e = (window as unknown as { __artonEngine: { layers: { active: { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } } } }).__artonEngine;
      const c = e.layers.active.canvas; const d = e.layers.active.ctx.getImageData(0, 0, c.width, c.height).data;
      let h1 = 2166136261 >>> 0, h2 = 0; for (let i = 0; i < d.length; i++) { h1 = Math.imul(h1 ^ d[i], 16777619) >>> 0; h2 = (h2 + d[i] * (i % 251 + 1)) >>> 0; }
      return `${h1}:${h2}`;
    });
    hashes.push(await snap());
    for (const [i, name] of BRUSHES.entries()) {
      const btn = page.getByRole("button", { name, exact: true });
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click();
      await page.evaluate(async (i) => {
        const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
        const r = el.getBoundingClientRect();
        const fire = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: r.left + x, clientY: r.top + y, pressure: 0.6, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
        const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
        const y0 = 80 + ((i * 53) % (r.height - 160));
        fire("pointerdown", 60, y0);
        for (let k = 1; k <= 24; k++) { fire("pointermove", 60 + k * ((r.width - 140) / 24), y0 + Math.sin(k / 3) * 50); await wait(8); }
        fire("pointerup", r.width - 80, y0);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      }, i);
      if (!quick) await page.waitForTimeout(1800);
      hashes.push(await snap());
    }
    const steps = hashes.length - 1;
    expect(steps, "그은 획 수").toBeGreaterThanOrEqual(5);
    const call = (fn: "undo" | "redo") => page.evaluate((fn) => (window as unknown as { __artonEngine: Record<string, () => boolean> }).__artonEngine[fn](), fn);
    for (let k = steps; k >= 1; k--) {
      await call("undo");
      expect(await snap(), `되돌리기 ${steps - k + 1}번째 = ${k - 1}번째 획 뒤 모습`).toBe(hashes[k - 1]);
    }
    for (let k = 1; k <= steps; k++) {
      await call("redo");
      expect(await snap(), `다시 하기 ${k}번째 = ${k}번째 획 뒤 모습`).toBe(hashes[k]);
    }
  });
}
