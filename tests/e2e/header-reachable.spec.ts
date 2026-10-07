import { test, expect } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

/*
 * 헤더 버튼이 서로 겹쳐 "눌리지 않는" 상태가 되면 안 된다.
 * 2026-07-25 실측(태블릿 712px): 모드 탭 칸이 `min-w-0 flex-1`이라 폭이 0까지 줄고,
 * 탭 자체는 안 줄어서 칸 밖으로 흘러 좌우 버튼 위를 덮었다(당시 협동 방의 "모둠 나가기"가
 * 연필 아이콘에 가려 클릭이 안 됐다 — 협동은 2026-10-07 종료, 헤더 겹침 불변식은 유지).
 *
 * 각 컨트롤의 중심점에서 elementFromPoint가 자기 자신(또는 자손)인지 본다.
 */
const WIDTHS = [712, 820, 1024, 1366];

async function covered(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header")!;
    const bad: string[] = [];
    for (const el of header.querySelectorAll("button, a")) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue; // 스크롤 밖은 별개
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) {
        const name = el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 12);
        bad.push(`${name} ← ${hit?.tagName.toLowerCase()}.${(hit?.className ?? "").toString().slice(0, 24)}`);
      }
    }
    return bad;
  });
}

for (const width of WIDTHS) {
  test(`${width}px: 혼자 그리기 헤더의 모든 버튼이 안 가려진다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/draw?mode=sketch&backend=gl");
    await page.getByLabel("그림 캔버스").waitFor();
    // 글꼴이 늦게 오면 헤더가 한 번 더 접힌다 — 최종 상태에서 판정한다
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    expect(await covered(page), `가려진 컨트롤`).toEqual([]);
  });
}
