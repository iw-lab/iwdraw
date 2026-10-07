import { test, expect } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

/*
 * 유화 굵기별 색 일관성 회귀 테스트.
 * <40px는 bristle-bold LOD, ≥40px는 fine bristle(AI 맵) — 두 팁의 평균 셰이드가
 * 어긋나면 굵기 슬라이더만 움직여도 색이 변한다(2026-07-06 사용자 실측: R 254 vs 220).
 * 같은 노랑을 4가지 굵기로 칠하고 획 내부 중앙값 RGB의 채널별 편차를 단언한다.
 */
test("유화 굵기(LOD 경계)에 따라 색이 달라지지 않는다", async ({ page }) => {
  await page.goto("/draw?mode=oil&backend=gl");
  const canvas = page.getByLabel("그림 캔버스");
  await canvas.waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "유화붓", exact: true }).click();
  await page.getByRole("button", { name: "색 8", exact: true }).click(); // 노랑 255,200,74

  const box = (await canvas.boundingBox())!;
  const sizeSlider = page.getByLabel("브러시 굵기", { exact: true });
  // 15→22px(bold), 24→36px(bold), 30→45px(fine), 60→90px(fine)
  const cases: Array<[number, number]> = [
    [15, 0.15],
    [24, 0.35],
    [30, 0.55],
    [60, 0.8],
  ];
  for (const [sz, fx] of cases) {
    await sizeSlider.fill(String(sz));
    const x = box.x + box.width * fx;
    await page.mouse.move(x, box.y + box.height * 0.15);
    await page.mouse.down();
    for (let k = 1; k <= 30; k++)
      await page.mouse.move(x, box.y + box.height * (0.15 + 0.6 * (k / 30)));
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);

  const means = await page.evaluate((fxs: number[]) => {
    const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
    const ctx = el.getContext("2d")!;
    return fxs.map((fx) => {
      const cx = Math.round(el.width * fx);
      // 획 «몸통» 평균 — 행마다 획 폭(B<200 & R>150 인 픽셀 구간)의 가운데 60%만.
      // ⚠️ 전폭 평균은 반투명 테두리를 포함해서, 테두리를 부드럽게 하면(2026-10-07 가는 유화 계단
      //    제거) 테두리 비율이 큰 가는 획만 연하게 잡혔다(B 87 vs 102). 이 게이트가 막는 결함은
      //    «두 팁의 몸통 셰이드 불일치»라 몸통만 잰다. 붓결 밴드 확률 영향은 폭 60%·40행 평균으로 흡수.
      let r = 0, g = 0, b = 0, n = 0;
      for (let fy = 0.25; fy <= 0.65; fy += 0.01) {
        const y = Math.round(el.height * fy);
        const d = ctx.getImageData(cx - 70, y, 140, 1).data;
        let lo = -1, hi = -1;
        for (let i = 0; i < 140; i++) {
          const R = d[i * 4], B = d[i * 4 + 2];
          if (B < 200 && R > 150) { if (lo < 0) lo = i; hi = i; }
        }
        if (lo < 0) continue;
        const span = hi - lo;
        for (let i = Math.round(lo + span * 0.2); i <= Math.round(hi - span * 0.2); i++) {
          r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++;
        }
      }
      return n ? ([Math.round(r / n), Math.round(g / n), Math.round(b / n)] as const) : ([0, 0, 0] as const);
    });
  }, cases.map((c) => c[1]));

  console.log("OILCOLOR:", cases.map(([sz], i) => `굵기${sz}=rgb(${means[i].join(",")})`).join("  "));
  // 채널별 최대-최소 편차 — 버그 시(팁 평균 셰이드 불일치) R 편차 30+.
  // 2026-10-07 몸통 측정으로 바꾼 뒤 정상 R 8·B 3, 고의 파손(가는 팁 줄 셰이드 246→200 = −18%)은 R 14.
  // 옛 상한 14 는 그 파손을 통과시켰다(약한 게이트) → 11.
  for (let ch = 0; ch < 3; ch++) {
    const vals = means.map((m) => m[ch]);
    expect(Math.max(...vals) - Math.min(...vals), `채널 ${"RGB"[ch]} 편차`).toBeLessThanOrEqual(11);
  }
});
