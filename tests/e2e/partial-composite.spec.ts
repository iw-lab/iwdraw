import { test, expect } from "@playwright/test";

/*
 * «바뀐 곳만 다시 합성»(2026-11-17 저사양 렉) = 화질 그대로인가.
 * 같은 상태에서 ① 부분 합성 화면 ② 통째 합성 화면을 떠서 화소를 비교한다 — 어느 화소든 2/255 넘게 다르면 실패.
 * (확대 화면의 반투명 획(색연필 wash 0.78)은 통째·부분 래스터 경로의 반올림이 ±2 다를 수 있다 — 2026-11-17 배포본 실측 445화소·최대 2. 눈에 안 보이는 반올림이라 허용)
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
        (e as unknown as { frameClip: () => unknown }).frameClip = () => { const r = fc(); if (r && r !== "skip") { w.__partial = (w.__partial ?? 0) + 1; (window as unknown as { __take?: unknown }).__take = r; } return r; };
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
            let n = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
            const W = e.cm.display.width;
            for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) > 2 || Math.abs(a[k + 1] - b[k + 1]) > 2 || Math.abs(a[k + 2] - b[k + 2]) > 2 || Math.abs(a[k + 3] - b[k + 3]) > 2) { n++; const px = (k / 4) % W, py = Math.floor(k / 4 / W); bx0 = Math.min(bx0, px); bx1 = Math.max(bx1, px); by0 = Math.min(by0, py); by1 = Math.max(by1, py); }
            if (n && !(window as unknown as { __dump?: string[] }).__dump) {
              const cv = document.createElement("canvas"); cv.width = W; cv.height = a.length / 4 / W; const g = cv.getContext("2d")!;
              g.putImageData(new ImageData(new Uint8ClampedArray(a), W), 0, 0); const ua = cv.toDataURL();
              g.putImageData(new ImageData(new Uint8ClampedArray(b), W), 0, 0); const ub = cv.toDataURL();
              (window as unknown as { __dump?: string[] }).__dump = [ua, ub];
            }
            if (n) ((window as unknown as { __dbg: unknown[] }).__dbg ??= []).push(({ n, box: [bx0, by0, bx1, by1], y0, view: (e as unknown as { view: unknown }).view, st: (e as unknown as { settings: unknown }).settings, take: (window as unknown as { __take?: unknown }).__take }));
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
    const dbg = await page.evaluate(() => (window as unknown as { __dbg?: unknown[] }).__dbg ?? []);
    if (dbg.length) console.log("[diff]", JSON.stringify(dbg).slice(0, 3000));
    const dump = await page.evaluate(() => (window as unknown as { __dump?: string[] }).__dump);
    if (dump) { const fs = await import("node:fs"); dump.forEach((u, i) => fs.writeFileSync(`test-results/pc-${i ? "full" : "partial"}-${zoom}.png`, Buffer.from(u.split(",")[1], "base64"))); }
    for (const [name, d] of Object.entries(report)) {
      const used = -d[d.length - 1];
      const px = d.slice(0, -1);
      expect(px.every((n) => n === 0), `${name} 부분 합성 화면이 통째 합성과 2/255 넘게 다르다: ${px}`).toBe(true);
      if (name !== "지우개") expect(used, `${name} 부분 합성이 실제로 쓰였다(${used}번)`).toBeGreaterThan(5);
    }
    expect(Object.keys(report).length, "잰 붓 수").toBeGreaterThanOrEqual(6);
  });
}
