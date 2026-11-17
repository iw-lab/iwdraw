import { test, expect } from "@playwright/test";

/*
 * «바뀐 곳만 다시 합성»(2026-11-17 저사양 렉) = 화질 그대로인가.
 * 같은 상태에서 ① 부분 합성 화면 ② 통째 합성 화면을 떠서 화소를 비교한다 — 한 화소라도 다르면 실패.
 * 붓마다(이음 띠·임파스토·반짝이·무지개·지우개 포함) · 확대·이동한 화면에서도.
 */
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] }, deviceScaleFactor: 1, viewport: { width: 1366, height: 768 } });
test.setTimeout(600_000);
const BRUSHES = ["연필", "마커", "납작붓", "유화붓", "반짝이", "무지개", "에어브러시", "색연필", "수채붓", "지우개"];

for (const zoom of [1, 1.7]) {
  test(`부분 합성 = 통째 합성(화소 동일) · 확대 ${zoom}`, async ({ page }) => {
    await page.goto(`/draw?mode=sketch&backend=gl`);
    await page.getByLabel("그림 캔버스").waitFor();
    const fresh = page.getByRole("button", { name: /새로 시작/ });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    await page.waitForTimeout(500);
    if (zoom !== 1) {
      await page.evaluate((z) => {
        const e = (window as unknown as { __artonEngine: { zoomBy(f: number, x: number, y: number): void } }).__artonEngine;
        const r = document.querySelector('canvas[aria-label="그림 캔버스"]')!.getBoundingClientRect();
        e.zoomBy(z, r.left + r.width * 0.3, r.top + r.height * 0.4);
      }, zoom);
      await page.waitForTimeout(300);
    }
    const report: Record<string, number[]> = {};
    for (const name of BRUSHES) {
      const btn = page.getByRole("button", { name, exact: true });
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click();
      report[name] = await page.evaluate(async () => {
        type E = { frameFull: boolean; needsComposite: boolean; brush: unknown; cm: { display: HTMLCanvasElement; displayCtx: CanvasRenderingContext2D } };
        const e = (window as unknown as { __artonEngine: E }).__artonEngine;
        // 그은 채 멈추면 도형으로 바뀐다(꾹 누르기 스냅) — 두 화면을 뜨는 사이 상태가 바뀌면 비교가 무의미하다
        (e as unknown as { armQuickShapeHold: () => void }).armQuickShapeHold = () => {};
        // 부분 합성이 정말 쓰였는지 센다(통째로만 그리면 비교가 늘 0 — 자기참조 통과)
        const w = window as unknown as { __partial?: number };
        const fc = (e as unknown as { frameClip: () => unknown }).frameClip.bind(e);
        (e as unknown as { frameClip: () => unknown }).frameClip = () => { const r = fc(); if (r && r !== "skip") w.__partial = (w.__partial ?? 0) + 1; return r; };
        const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
        const rect = el.getBoundingClientRect();
        const fire = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: rect.left + x, clientY: rect.top + y, pressure: 0.6, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
        const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const grab = () => { const c = e.cm.display; return e.cm.displayCtx.getImageData(0, 0, c.width, c.height).data; };
        const diffs: number[] = [];
        const y0 = 60 + Math.random() * (rect.height - 160);
        fire("pointerdown", 60, y0);
        for (let i = 1; i <= 36; i++) {
          fire("pointermove", 60 + i * ((rect.width - 140) / 36), y0 + Math.sin(i / 4) * 40);
          await wait(10);
          if (i % 12 === 0) {
            await raf();
            const a = grab();
            e.frameFull = true; e.needsComposite = true;
            await raf();
            const b = grab();
            let n = 0;
            for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) > 1 || Math.abs(a[k + 1] - b[k + 1]) > 1 || Math.abs(a[k + 2] - b[k + 2]) > 1 || Math.abs(a[k + 3] - b[k + 3]) > 1) n++;
            diffs.push(n);
          }
        }
        fire("pointerup", rect.width - 80, y0);
        await raf();
        diffs.push(-(w.__partial ?? 0));
        w.__partial = 0;
        return diffs;
      });
    }
    console.log(`[partial-composite zoom ${zoom}]`, JSON.stringify(report));
    for (const [name, d] of Object.entries(report)) {
      const used = -d[d.length - 1];
      const px = d.slice(0, -1);
      expect(px.every((n) => n === 0), `${name} 부분 합성 화면이 통째 합성과 다르다: ${px}`).toBe(true);
      if (name !== "지우개") expect(used, `${name} 부분 합성이 실제로 쓰였다(${used}번)`).toBeGreaterThan(5);
    }
    expect(Object.keys(report).length, "잰 붓 수").toBeGreaterThanOrEqual(6);
  });
}
