import { test, expect } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

/*
 * 유화 손 뗄 때 색 팝인 회귀 테스트(2026-07-10 사용자 실측: "그려지다가 손 떼면
 * 약간 색이 변한다"). 원인은 임파스토 릴리프가 endStroke 전용 후처리라 라이브
 * 프리뷰와 최종 베이크의 명암이 달랐던 것 — 프리뷰=최종(같은 함수)으로 수정.
 * 획을 그린 채(마우스 다운 유지) 평균색을 재고, 뗀 뒤 같은 영역을 다시 재서
 * 채널별 편차를 단언한다.
 */
/*
 * 2026-10-08 확장: 라이브 프리뷰를 «바뀐 영역만» 다시 만들도록 바꿨다(저사양 끊김) — 부분 갱신이
 * 어긋나면 그리는 중 화면과 뗀 뒤가 달라진다. 납작붓은 꼬리를 표시만 하다가 뗄 때 확정하므로
 * 같은 단언으로 잠근다. 경로는 되돌아오는 지그재그(자기 겹침·꼬리 자리 갱신)까지 포함.
 */
for (const [brush, backend] of [
  ["유화붓", "gl"],
  ["유화붓", "2d"],
  ["납작붓", "gl"],
  ["납작붓", "2d"],
] as const)
test(`${brush}(${backend}) 획이 손을 떼도 색이 변하지 않는다(임파스토 프리뷰=최종)`, async ({ page }) => {
  await page.goto(`/draw?mode=oil&backend=${backend}`);
  const canvas = page.getByLabel("그림 캔버스");
  await canvas.waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: brush, exact: true }).click();
  await page.getByRole("button", { name: "색 8", exact: true }).click(); // 노랑 255,200,74
  await page.getByLabel("브러시 굵기", { exact: true }).fill("24");

  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * 0.5;
  await page.mouse.move(x, box.y + box.height * 0.15);
  await page.mouse.down();
  for (let k = 1; k <= 30; k++)
    await page.mouse.move(x + Math.sin(k / 3) * 40, box.y + box.height * (0.15 + 0.6 * (k / 30)));
  // 되돌아 올라가며 자기 획과 겹친다
  for (let k = 1; k <= 12; k++)
    await page.mouse.move(x + 30 - k * 2, box.y + box.height * (0.75 - 0.3 * (k / 12)));
  // 획 끝(뗄 때 붓털 끌림 dab·납작붓 끝 그림)은 측정 창(가운데 ±90px) 밖에서 — 끝 처리는 이 시험 대상이 아니다
  for (let k = 1; k <= 10; k++)
    await page.mouse.move(x + 6 + k * 20, box.y + box.height * 0.45);
  await page.waitForTimeout(400); // 라이브 컴포짓 안정화(아직 마우스 다운)

  // 획 주변 넓은 영역의 픽셀 전체를 캡처 — 릴리프 림(가장자리 2~3px 밴드)의 팝인은
  // 평균색으론 희석돼 안 잡힌다(실측 delta ~1). 픽셀 단위 diff로 측정한다.
  const sample = () =>
    page.evaluate(() => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const ctx = el.getContext("2d")!;
      const cx = Math.round(el.width * 0.5);
      const y0 = Math.round(el.height * 0.22);
      const h = Math.round(el.height * 0.5);
      return Array.from(ctx.getImageData(cx - 90, y0, 180, h).data);
    });

  const live = await sample(); // 손 떼기 전(라이브 프리뷰)
  await page.mouse.up();
  await page.waitForTimeout(400);
  const final = await sample(); // 손 뗀 후(레이어 베이크)

  let painted = 0; // 종이가 아닌(획) 픽셀 수 — 획이 실제 그려졌는지 확인용
  let changed = 0; // 팝인 픽셀(채널 delta > 12)
  let maxD = 0;
  for (let i = 0; i < live.length; i += 4) {
    if (final[i + 2] < 200 && final[i] > 100) painted++;
    const d = Math.max(
      Math.abs(live[i] - final[i]),
      Math.abs(live[i + 1] - final[i + 1]),
      Math.abs(live[i + 2] - final[i + 2]),
    );
    if (d > maxD) maxD = d;
    if (d > 12) changed++;
  }
  console.log(`OILPOP: painted=${painted} changed(Δ>12)=${changed} maxΔ=${maxD}`);
  expect(painted, "획이 실제로 그려졌어야 함").toBeGreaterThan(2000);
  // 프리뷰=최종 — 팝인 픽셀이 획 픽셀의 0.5% 미만(버그 시 림 밴드 수천 픽셀이 바뀜)
  expect(changed, "손 뗄 때 변한 픽셀 수").toBeLessThan(painted * 0.005);
});
