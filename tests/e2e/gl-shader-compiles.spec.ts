import { test, expect } from "@playwright/test";

/*
 * ?backend=gl 이면 실제로 WebGL2 백엔드로 그린다 — 셰이더 컴파일이 실패하면 엔진이 «조용히» Canvas2D 로
 * 넘어가 모든 GL 질감(물감 입체·붓결)이 사라진다(2026-10-08: 프래그먼트 셰이더 변수 이름 충돌 →
 * 화면엔 그대로 그려져 한동안 몰랐다). 셰이더를 고치면 이 시험이 먼저 빨개진다.
 */
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });
test("backend=gl 이면 WebGL2 셰이더가 컴파일돼 GL 로 그린다", async ({ page }) => {
  await page.goto("/draw?mode=oil&backend=gl");
  await page.getByLabel("그림 캔버스").waitFor();
  await page.waitForTimeout(800);
  // ⚠️ 클래스 이름(constructor.name)으로 보면 프로덕션 빌드는 이름을 줄여(«tc») 배포본 검사에서 늘 빨갛다 — 엔진이 내는 값으로 본다
  const gl = await page.evaluate(() => (window as unknown as { __artonEngine?: { usingWebGL2?: boolean } }).__artonEngine?.usingWebGL2);
  expect(gl).toBe(true);
});
