import { test, expect } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

/*
 * 유화 wet mixing 회귀 테스트(2026-07-10 사용자 요청: i-scream처럼 밑색과 섞이게).
 * 청록 패치 위를 지나는 노랑 획은 청록을 묻혀 황록이 되고(R 하락),
 * 흰 종이 위 대조군 획은 순수 노랑을 유지해야 한다.
 * wetMix=0.5 기준 기대값: 섞임 획 R ≈ 255→~190 이하, 대조군 R ≥ 220.
 */
test("유화 획이 밑색을 묻혀 와 섞인다(wet mixing)", async ({ page }) => {
  await page.goto("/draw?mode=oil&backend=gl");
  const canvas = page.getByLabel("그림 캔버스");
  await canvas.waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "유화붓", exact: true }).click();
  await page.getByLabel("브러시 굵기", { exact: true }).fill("28");
  const box = (await canvas.boundingBox())!;
  const X = (fx: number) => box.x + box.width * fx;
  const Y = (fy: number) => box.y + box.height * fy;

  const stroke = async (pts: Array<[number, number]>, steps = 24) => {
    await page.mouse.move(X(pts[0][0]), Y(pts[0][1]));
    await page.mouse.down();
    for (let s = 1; s < pts.length; s++) {
      const [x0, y0] = pts[s - 1];
      const [x1, y1] = pts[s];
      for (let k = 1; k <= steps; k++)
        await page.mouse.move(X(x0 + ((x1 - x0) * k) / steps), Y(y0 + ((y1 - y0) * k) / steps));
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
  };

  // 청록 패치(촘촘한 가로 획 7줄 = 틈 없는 면)
  await page.getByRole("button", { name: "색 12", exact: true }).click();
  for (const fy of [0.3, 0.325, 0.35, 0.375, 0.4, 0.425, 0.45]) await stroke([[0.3, fy], [0.7, fy]]);

  // 노랑: 패치 관통 획(0.375 줄 위) + 흰 종이 대조군
  await page.getByRole("button", { name: "색 8", exact: true }).click();
  await stroke([[0.15, 0.375], [0.85, 0.375]], 40);
  await stroke([[0.15, 0.6], [0.85, 0.6]], 40);
  await page.waitForTimeout(400);

  // 획 중심선의 획 픽셀(노랑 계열: R>140, B<200) 평균 — 패치 안(0.45~0.6x) vs 대조군
  const meanR = (fy: number) =>
    page.evaluate((fyy: number) => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const ctx = el.getContext("2d")!;
      const y = Math.round(el.height * fyy);
      const x0 = Math.round(el.width * 0.45);
      const d = ctx.getImageData(x0, y - 6, Math.round(el.width * 0.15), 13).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 140 && d[i + 2] < 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      }
      return n > 300 ? [r / n, g / n, b / n, n] : [0, 0, 0, n];
    }, fy);

  const mixed = await meanR(0.375);
  const control = await meanR(0.6);
  console.log(
    `OILWETMIX: mixed=rgb(${mixed.slice(0, 3).map((v) => v.toFixed(0)).join(",")}) n=${mixed[3]}`,
    `control=rgb(${control.slice(0, 3).map((v) => v.toFixed(0)).join(",")}) n=${control[3]}`,
  );
  expect(control[0], "대조군은 순수 노랑 유지").toBeGreaterThan(215);
  expect(mixed[0], "패치 안 획은 청록이 섞여 R 하락").toBeLessThan(control[0] - 25);
  // 2026-10-08 wetMix 0.5 → 0.3(덧칠은 위에 «쌓이게», 사용자 요청) — 섞임은 R 하락(청록 방향)으로만 단언.
  // B 는 노랑 위 청록이 대조군과 거의 같아(실측 +6 이하) 세기 축소 뒤 노이즈와 구분이 안 된다
  expect(mixed[2], "패치 안 획은 B 가 떨어지지 않는다(청록 방향)").toBeGreaterThan(control[2]);
});
