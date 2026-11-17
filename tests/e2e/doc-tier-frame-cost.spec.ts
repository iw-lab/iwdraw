import { test, expect } from "@playwright/test";

/*
 * 기기별 그림 판 단계(lib/perf-tier · 2026-11-17 «저사양만 더 낮추고 고사양은 그대로»)가 렉을 정말 줄이는지 —
 * 같은 기기(CPU 6배 느리게)·같은 붓·같은 획으로 판 배율 1 / 0.75 / 0.6 의 획 중 프레임 간격을 잰다.
 * 맥 헤드리스는 웨일북을 대변 못 한다(SwiftShader) — 절대값이 아니라 «같은 조건에서 판만 바꾼 차이»를 본다.
 */
test.use({
  launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  deviceScaleFactor: 1,
  viewport: { width: 1366, height: 768 },
});
test.setTimeout(300_000);
const RATE = Number(process.env.STROKE_RATE ?? 6);
const TIER_I: Record<number, number> = { 1: 0, 0.75: 1, 0.6: 2 };

test("판 배율이 낮을수록 획 중 프레임 간격이 준다 · 판 크기는 저장된 단계를 따른다", async ({ browser }) => {
  const out: Record<string, { p50: number; p75: number; p90: number; w: number; h: number }> = {};
  for (const scale of [1, 0.75, 0.6]) {
    const ctx = await browser.newContext();
    await ctx.addInitScript((i) => localStorage.setItem("arton.perf.tier", JSON.stringify({ i, good: 0 })), TIER_I[scale]);
    const page = await ctx.newPage();
    const cdp = await page.context().newCDPSession(page);
    await page.goto(`/draw?mode=sketch&backend=${process.env.STROKE_BACKEND ?? "gl"}`);
    await page.getByLabel("그림 캔버스").waitFor();
    const fresh = page.getByRole("button", { name: /새로 시작/ });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: process.env.STROKE_BRUSH ?? "연필", exact: true }).click();
    const doc = await page.evaluate(() => {
      const e = (window as unknown as { __artonEngine: { width: number; height: number; sizeScale: number } }).__artonEngine;
      return { w: e.width, h: e.height, s: e.sizeScale };
    });
    expect(doc.s, "엔진 판 배율 = 저장된 단계").toBe(scale);
    expect(Math.abs(doc.w - 1536 * scale), `판 너비 ${doc.w}`).toBeLessThanOrEqual(4);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    const r = await page.evaluate(async () => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const rect = el.getBoundingClientRect();
      const frames: number[] = [];
      let last = performance.now();
      let run = true;
      const tick = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const fire = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: rect.left + x, clientY: rect.top + y, pressure: 0.6, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      await wait(500);
      frames.length = 0;
      for (let s = 0; s < 8; s++) {
        const y0 = 40 + s * 30;
        fire("pointerdown", 40, y0);
        for (let i = 1; i <= 40; i++) {
          fire("pointermove", 40 + (i / 40) * (rect.width - 80), y0 + Math.sin(i / 5) * 20);
          await wait(8);
        }
        fire("pointerup", rect.width - 40, y0);
        await wait(50);
      }
      run = false;
      const sorted = frames.slice().sort((a, b) => a - b);
      const q = (p: number) => Math.round(sorted[Math.floor(sorted.length * p)] ?? 0);
      return { p50: q(0.5), p75: q(0.75), p90: q(0.9) };
    });
    out[String(scale)] = { ...r, w: doc.w, h: doc.h };
    await ctx.close();
  }
  console.log("[doc-tier]", JSON.stringify(out));
  expect(out["0.6"].p75, "0.6 판이 1 판보다 가볍다").toBeLessThan(out["1"].p75);
});
