import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

/*
 * 저사양 렉 자동 계측(2026-11-10) — CPU 를 느리게 해 «렉 나는 기기»를 만들고, 그리면 서버(로컬 D1)에 한 줄이 남는지.
 * ⚠️ 쓰기 시험 — 로컬 전체(.harness/local-stack.sh)에서만.
 */
const local = /localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL ?? "");
test.skip(!local, "계측 쓰기 시험 — 로컬 전체에서만");
test.setTimeout(180_000);
test.use({ deviceScaleFactor: 1, viewport: { width: 1366, height: 768 } });

const rows = () => {
  const out = execFileSync("bash", ["tools/cf.sh", "d1", "execute", "arton", "--local", "--persist-to", ".harness/wstate", "--json", "--command", "SELECT data FROM perf_reports ORDER BY id DESC LIMIT 1"], { encoding: "utf8" });
  const r = JSON.parse(out)[0].results as { data: string }[];
  return r.map((x) => JSON.parse(x.data));
};

test("자동 시험 브라우저(표식 없음)는 보내지 않는다 — 배포본 회귀가 운영 표를 안 채운다", async ({ page }) => {
  let sent = false;
  page.on("request", (r) => { if (r.url().endsWith("/api/perf")) sent = true; });
  const cdp = await page.context().newCDPSession(page);
  await page.goto("/draw?mode=sketch&backend=2d");
  await page.getByLabel("그림 캔버스").waitFor();
  await page.waitForTimeout(1200);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  await page.evaluate(async () => {
    const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
    const rect = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: rect.left + x, clientY: rect.top + y, pressure: 0.6, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let s = 0; s < 10; s++) { const y0 = 40 + s * 30; fire("pointerdown", 40, y0); for (let i = 1; i <= 40; i++) { fire("pointermove", 40 + (i / 40) * (rect.width - 80), y0); await wait(8); } fire("pointerup", rect.width - 40, y0); await wait(50); }
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.waitForTimeout(1500);
  expect(sent).toBe(false);
});

test("렉 나는 기기에서 그리면 기술 수치 한 줄이 서버에 남는다(세션당 한 번)", async ({ page }) => {
  const before = rows()[0]?.max ?? -1;
  await page.addInitScript(() => localStorage.setItem("arton.perf.test", "1"));
  const cdp = await page.context().newCDPSession(page);
  await page.goto("/draw?mode=sketch&backend=2d");
  await page.getByLabel("그림 캔버스").waitFor();
  await page.waitForTimeout(1200);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/perf"), { timeout: 120_000 });
  await page.evaluate(async () => {
    const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
    const rect = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: rect.left + x, clientY: rect.top + y, pressure: 0.6, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let s = 0; s < 10; s++) { const y0 = 40 + s * 30; fire("pointerdown", 40, y0); for (let i = 1; i <= 40; i++) { fire("pointermove", 40 + (i / 40) * (rect.width - 80), y0 + Math.sin(i / 5) * 20); await wait(8); } fire("pointerup", rect.width - 40, y0); window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })); await wait(50); }
  });
  await sent;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await expect.poll(() => rows()[0]?.max ?? -1, { timeout: 15_000 }).not.toBe(before);
  const r = rows()[0];
  expect(r.page).toBe("draw");
  expect(r.backend).toMatch(/^(gl|2d)$/);
  expect(r.p75).toBeGreaterThanOrEqual(35);
  expect(r.n).toBeGreaterThanOrEqual(150);
  expect(Object.keys(r)).not.toContain("nickname");
});
