import { test, expect, type Page } from "@playwright/test";

/*
 * 게스트에게 "학급 코드로 들어오면 우리 반 갤러리에 전시할 수 있다"고 알려 주는 흐름
 * (2026-09-02 사용자 요청). 안내는 백엔드가 켜진 빌드에서만 뜬다 — 게스트 전용 빌드엔
 * 학급이 아예 없어 문구가 거짓이 되기 때문이다.
 *
 * 로컬 하네스(`pnpm dev`)는 NEXT_PUBLIC_HAS_BACKEND 가 없어 안내가 꺼져 있다.
 * 그래서 /join 의 "체험 모드" 문구로 백엔드 유무를 먼저 재고, 없으면 건너뛴다.
 * (라이브 검증 `playwright.live.config.ts` 에서는 백엔드가 켜져 있어 실제로 돈다.)
 */
async function backendOn(page: Page): Promise<boolean> {
  await page.goto("/join");
  return !(await page.getByText(/체험 모드예요/).isVisible().catch(() => false));
}

test("게스트: 학급 안내 토스트 → 입장하기 → 그리던 화면으로 복귀", async ({ page }) => {
  test.skip(!(await backendOn(page)), "백엔드 없는 빌드 — 학급 안내가 꺼져 있다");

  await page.goto("/draw?mode=sketch");
  await page.getByLabel("그림 캔버스").waitFor();

  // ① 진입 시 세션당 1회 안내
  const toastLink = page.getByTestId("class-join-toast-link");
  await expect(toastLink).toBeVisible({ timeout: 8000 });
  // ② 헤더 칩도 함께
  await expect(page.getByTestId("class-join-chip")).toBeVisible();

  // 그림을 조금 그려 둔다 — 입장 후 복구 배너가 떠야 한다
  const canvas = page.getByLabel("그림 캔버스");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 12 });
    await page.mouse.up();
  }
  // 자동저장(디바운스)이 IndexedDB에 내려앉을 시간
  await page.waitForTimeout(2500);

  // "입장하기" → /join?next=<그리던 경로>
  await toastLink.click();
  await page.waitForURL(/\/join\?next=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("next")!)).toContain("/draw");

  // 코드가 없으면 입장을 끝까지 갈 수 없다 — 여기서는 next 가 안전하게 보존되는지까지가 범위.
  // (실제 입장 후 복귀는 아래 "복귀 경로" 스펙이 라우터 수준에서 확인한다.)
});

test("게스트: 안내는 세션당 1회 — 새로고침해도 다시 뜨지 않는다", async ({ page }) => {
  test.skip(!(await backendOn(page)), "백엔드 없는 빌드 — 학급 안내가 꺼져 있다");

  await page.goto("/draw?mode=sketch");
  await expect(page.getByTestId("class-join-toast-link")).toBeVisible({ timeout: 8000 });
  await page.reload();
  await page.getByLabel("그림 캔버스").waitFor();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("class-join-toast-link")).toHaveCount(0);
  // 헤더 칩은 세션과 무관하게 계속 남는다(언제든 들어갈 수 있는 입구)
  await expect(page.getByTestId("class-join-chip")).toBeVisible();
});

test("게스트: 학급 세션이 있으면 안내가 아예 없다", async ({ page }) => {
  test.skip(!(await backendOn(page)), "백엔드 없는 빌드 — 학급 안내가 꺼져 있다");

  await page.goto("/");
  await page.evaluate(() =>
    sessionStorage.setItem(
      "arton.student",
      JSON.stringify({
        token: "t",
        studentId: "s1",
        classId: "c1",
        className: "3학년 2반",
        nickname: "초록거북",
        classCode: "ABC123",
      }),
    ),
  );
  await page.goto("/draw?mode=sketch");
  await page.getByLabel("그림 캔버스").waitFor();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("class-join-chip")).toHaveCount(0);
  await expect(page.getByTestId("class-join-toast-link")).toHaveCount(0);
});

/*
 * 헤더 항목이 하나 늘어나는 케이스 — 과거에 학급 입장 조합이 뷰포트 기준(xl=1280)을 깨뜨려
 * 한글 라벨이 글자 단위로 접힌 이력이 있다(header-layout.spec 주석). 칩이 붙어도 어느 폭에서든
 * 세로로 늘어난 항목이 없어야 한다.
 */
for (const width of [1024, 1280, 1366]) {
  test(`${width}px 학급 입장 칩이 붙어도 헤더가 세로로 접히지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    test.skip(!(await backendOn(page)), "백엔드 없는 빌드 — 학급 안내가 꺼져 있다");

    await page.goto("/draw?mode=sketch");
    await page.getByLabel("그림 캔버스").waitFor();
    await expect(page.getByTestId("class-join-chip")).toBeVisible();
    await page.waitForTimeout(300);

    const tall = await page.evaluate(() => {
      const header = document.querySelector("header")!;
      const bad: { label: string; h: number }[] = [];
      for (const el of header.querySelectorAll("button, a")) {
        const h = el.getBoundingClientRect().height;
        if (h > 56) bad.push({ label: (el.textContent ?? "").trim().slice(0, 12), h: Math.round(h) });
      }
      return bad;
    });
    expect(tall, `세로로 늘어난 버튼: ${JSON.stringify(tall)}`).toEqual([]);
  });
}

/*
 * 토스트는 캔버스 위(하단 중앙)에 뜬다 — 클릭을 통과시키지 않으면 떠 있는 6초 동안
 * 그 자리의 탭·획이 통째로 먹힌다(2026-09-04 실측: 페인트통 스펙이 이걸로 깨졌다).
 */
test("학급 안내 토스트가 떠 있어도 캔버스 탭이 먹히지 않는다", async ({ page }) => {
  test.skip(!(await backendOn(page)), "백엔드 없는 빌드 — 학급 안내가 꺼져 있다");

  await page.goto("/draw?mode=sketch");
  await page.getByLabel("그림 캔버스").waitFor();
  await expect(page.getByTestId("class-join-toast-link")).toBeVisible({ timeout: 8000 });

  const box = (await page.getByLabel("그림 캔버스").boundingBox())!;
  // 토스트가 뜨는 하단 중앙 지점
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.95;
  const top = await page.evaluate(
    ([px, py]) => (document.elementFromPoint(px, py) as HTMLElement)?.tagName ?? "none",
    [x, y],
  );
  expect(top, "토스트가 캔버스를 덮고 있다").toBe("CANVAS");

  // 실제로 획이 그어진다
  await page.mouse.move(x - 40, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "되돌리기" })).toBeEnabled();

  // 안내 링크 자체는 여전히 눌린다
  await page.getByTestId("class-join-toast-link").click();
  await page.waitForURL(/\/join/);
});
