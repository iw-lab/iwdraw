import { test, expect, type Page } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });
test.setTimeout(240_000);

/*
 * 스포이트 왕복 — «찍은 색으로 옆에 칠하면 원래 칠과 똑같이 보여야 한다».
 * 2026-10-14 사용자: «스포이트 색이 약간 원본보다 어둡게 나옴.. 똑같이 나오도록».
 * 붓마다: 색 C0 로 A 칸을 빽빽이 칠함 → A 가운데를 스포이트 → 그 색으로 B 칸을 똑같이 칠함 →
 * 화면(사용자가 보는 표시 캔버스)의 A·B 중앙값을 비교한다.
 */
const BRUSHES = (process.env.EYE_BRUSHES ?? "crayon,marker,oil,oilribbon,watercolor,colorpencil,oilpastel,acrylic,signpen,pencil").split(",");
const C0 = { r: 70, g: 140, b: 200 };

async function paintBox(page: Page, fx0: number, fx1: number) {
  await page.evaluate(
    async ([a, b]) => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const r = el.getBoundingClientRect();
      const fire = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, {
          pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: r.left + x, clientY: r.top + y,
          pressure: 0.7, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true,
        }));
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      for (let pass = 0; pass < 2; pass++) {
        for (let fy = 0.3; fy <= 0.7; fy += 0.02) {
          const y = r.height * fy;
          fire("pointerdown", r.width * a, y);
          for (let i = 1; i <= 30; i++) fire("pointermove", r.width * (a + ((b - a) * i) / 30), y + (i % 2) * 3);
          fire("pointerup", r.width * b, y);
          await wait(16);
        }
      }
    },
    [fx0, fx1] as [number, number],
  );
  await page.waitForTimeout(500);
}

/** 표시 캔버스(사용자가 보는 것)의 칸 중앙 창 중앙값 */
async function shown(page: Page, fx: number) {
  return page.evaluate((fxc) => {
    const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
    const ctx = el.getContext("2d")!;
    const cx = Math.round(el.width * fxc), cy = Math.round(el.height * 0.5), h = Math.round(el.width * 0.03);
    const d = ctx.getImageData(cx - h, cy - h, h * 2, h * 2).data;
    const ch = [[], [], []] as number[][];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) ch[k].push(d[i + k]);
    const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
    return { r: med(ch[0]), g: med(ch[1]), b: med(ch[2]) };
  }, fx);
}

const lum = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

for (const id of BRUSHES) {
  test(`스포이트 왕복 — ${id}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "한 프로파일에서만");
    await page.goto("/draw?mode=sketch&backend=gl");
    await page.getByLabel("그림 캔버스").waitFor();
    const fresh = page.getByRole("button", { name: /새로 시작/ });
    if (await fresh.isVisible({ timeout: 1500 }).catch(() => false)) await fresh.click();
    await page.waitForTimeout(400);
    await page.evaluate(([b, c]) => {
      const e = (window as unknown as { __artonEngine: { setBrush(b: string): void; setColor(c: unknown): void; setSize?(n: number): void } }).__artonEngine;
      e.setBrush(b as string);
      e.setColor(c);
      e.setSize?.(36);
    }, [id, C0] as [string, typeof C0]);

    await paintBox(page, 0.12, 0.38);
    const a = await shown(page, 0.25);
    const picked = await page.evaluate(() => {
      const e = (window as unknown as { __artonEngine: { pickColor(x: number, y: number): { r: number; g: number; b: number }; width: number; height: number } }).__artonEngine;
      return e.pickColor(e.width * 0.25, e.height * 0.5);
    });
    // EYE_CONTROL=1 — 대조군: B 도 원래 색 C0 로 칠한다(붓 자체의 칸별 편차를 잰다)
    const second = process.env.EYE_CONTROL ? C0 : picked;
    await page.evaluate((c) => (window as unknown as { __artonEngine: { setColor(c: unknown): void } }).__artonEngine.setColor(c), second);
    await paintBox(page, 0.62, 0.88);
    const b = await shown(page, 0.75);
    const dl = lum(b) - lum(a);
    console.log("EYE", JSON.stringify({ id, C0, picked, shownA: a, shownB: b, dLum: Math.round(dl * 10) / 10 }));
    // ① 핵심: 찍은 색 = 칠한 색 — 그러면 그 색으로 칠한 결과는 원래 칠과 «같은 붓·같은 색»이다
    //    (예전 1픽셀 스포이트 실측: 크레용 104,160,209 · 유화 78,139,194 · 색연필 205,223,241 — 칠한 색 70,140,200)
    for (const k of ["r", "g", "b"] as const) expect(Math.abs(picked[k] - C0[k]), `${id}: 찍은 색 ${k}`).toBeLessThanOrEqual(3);
    // ② 화면 확인 — 유화·납작붓은 같은 색을 두 칸에 칠해도 결이 달라 밝기 차가 ±10 까지 난다(대조군 EYE_CONTROL 실측 −1.4~9.5)
    const tol = id === "oil" || id === "oilribbon" ? 12 : 6;
    expect(Math.abs(dl), `${id}: 찍은 색으로 칠한 B 가 원래 A 보다 ${dl.toFixed(1)} 밝기 차`).toBeLessThan(tol);
  });
}
