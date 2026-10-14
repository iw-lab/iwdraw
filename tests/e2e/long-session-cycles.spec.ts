import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { execSync } from "node:child_process";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--js-flags=--expose-gc"] } });
test.setTimeout(900_000);

/*
 * 웨일북 한 시간 렉 재현 — 수업 흐름 그대로 «도안 고르기 → 여러 붓으로 칠하기 → 도안으로 돌아가기»를
 * 페이지 새로 읽기 없이(SPA 이동) 반복한다. 2026-10-14 사용자: «한 시간쯤 쓰다 보니 렉 걸리고 느려진다,
 * 나갔다 들어오면 괜찮아진다» = 세션 안에서만 쌓이는 것. 7월 하네스(long-session-perf)는 한 그림 안의
 * 획만 재서 «그림을 바꿀 때마다» 남는 것(엔진·GL·리스너·이미지)을 못 봤다.
 *
 * 매 바퀴 끝에 GC 후 ① JS 힙 ② DOM 노드·리스너 ③ 살아 있는 WebGL 컨텍스트 ④ 같은 크레용 10획의 멈춤 총합을 잰다.
 */
const CYCLES = Number(process.env.CYCLES ?? 10);
const BRUSHES = ["크레용", "유화붓", "수채붓", "납작붓", "마커", "반짝이", "색연필", "오일파스텔"];

async function strokes(page: Page, count: number, seed: number) {
  return page.evaluate(
    async ([n, sd]: [number, number]) => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const r = el.getBoundingClientRect();
      const fire = (type: string, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1, pointerType: "mouse", isPrimary: true,
            clientX: r.left + x, clientY: r.top + y, pressure: 0.5,
            buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true,
          }),
        );
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      for (let s = 0; s < n; s++) {
        const y0 = 20 + (((s + sd) * 37) % Math.max(1, r.height - 40));
        fire("pointerdown", 10, y0);
        for (let i = 1; i <= 60; i++) {
          const t = i / 60;
          fire("pointermove", 10 + t * (r.width - 20), y0 + Math.sin(t * 6 + sd) * 30);
        }
        fire("pointerup", r.width - 10, y0);
        await wait(16);
      }
    },
    [count, seed] as [number, number],
  );
}

/** 이 테스트 브라우저(ms-playwright)의 렌더러·GPU 프로세스 RSS(MB) — 캔버스 백킹·텍스처는 JS 힙 밖이라 여기서 본다 */
function rssMB() {
  const sum = { renderer: 0, gpu: 0 };
  try {
    for (const line of execSync("ps -axo rss=,command=", { encoding: "utf8" }).split("\n")) {
      if (!line.includes("ms-playwright")) continue;
      const kb = parseInt(line.trim(), 10) || 0;
      if (line.includes("--type=renderer")) sum.renderer += kb;
      else if (line.includes("--type=gpu-process")) sum.gpu += kb;
    }
  } catch {
    /* ps 가 없는 환경 — 0 */
  }
  return { rendererMB: Math.round(sum.renderer / 1024), gpuMB: Math.round(sum.gpu / 1024) };
}

async function metrics(client: CDPSession) {
  await client.send("HeapProfiler.collectGarbage");
  const { metrics: m } = await client.send("Performance.getMetrics");
  const get = (k: string) => m.find((x) => x.name === k)?.value ?? -1;
  return {
    heapMB: Math.round(get("JSHeapUsedSize") / 1e6),
    nodes: get("Nodes"),
    listeners: get("JSEventListeners"),
    ...rssMB(),
  };
}

test("도안을 바꿔 가며 오래 칠해도 힙·GL·멈춤이 쌓이지 않는다", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "절대 수치는 desktop-chrome 기준");
  await page.addInitScript(() => {
    // 헤드리스는 SwiftShader라 기본이 Canvas2D 폴백 — 웨일북(실 GPU)처럼 GL 경로를 타게 강제
    const get = URLSearchParams.prototype.get;
    URLSearchParams.prototype.get = function (this: URLSearchParams, k: string) {
      const v = get.call(this, k);
      return k === "backend" && v === null && location.pathname.startsWith("/draw") ? "gl" : v;
    };
    const w = window as unknown as { __ctxs: WebGL2RenderingContext[]; __long: number[] };
    w.__ctxs = [];
    w.__long = [];
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]): any {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = (orig as any).call(this, type, ...rest);
      // ⚠️ 살았나 = isContextLost() 로 본다. webglcontextlost 이벤트로 세면 캔버스가 먼저 GC 된
      // 컨텍스트는 이벤트가 안 와서 «반납 안 됨»으로 오판한다(2026-10-14 진단: 이벤트 6개 미수신 · 실제 살아 있음 0)
      if (type === "webgl2" && ctx && !w.__ctxs.includes(ctx)) w.__ctxs.push(ctx);
      return ctx;
    };
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__long.push(Math.round(e.duration));
    }).observe({ entryTypes: ["longtask"] });
  });
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");

  await page.goto("/coloring");
  await page.getByTestId("theme-card").first().waitFor();
  // 웨일북급 4배 감속(기본) — 오래 돌리는 소크는 THROTTLE=1 로 빠르게
  await client.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE ?? 4) });

  const marks: Record<string, number>[] = [];
  for (let c = 0; c < CYCLES; c++) {
    // ① 도안 고르기(주제 → 도안) — 클릭 이동(SPA). 주제가 열린 채로 돌아왔으면 그대로 고른다
    const themeCard = page.getByTestId("theme-card");
    if (await themeCard.first().isVisible().catch(() => false)) await themeCard.nth(c % 6).click();
    const items = page.locator('a[href^="/draw?template="]');
    await items.first().waitFor();
    await items.nth((c * 3) % 8).click();
    await page.getByLabel("그림 캔버스").waitFor();
    const fresh = page.getByRole("button", { name: /새로 시작/ });
    if (await fresh.isVisible({ timeout: 1500 }).catch(() => false)) await fresh.click();
    await page.waitForTimeout(800);

    // ② 그 그림에서 붓 두 가지로 30획(아이가 한 장 칠하는 분량의 축소판)
    for (const b of [BRUSHES[c % BRUSHES.length], BRUSHES[(c + 3) % BRUSHES.length]]) {
      const btn = page.getByRole("button", { name: b, exact: true });
      if (await btn.isVisible().catch(() => false)) await btn.click();
      await strokes(page, 15, c);
    }
    // ③ 같은 측정 획 — 크레용 10획의 멈춤 총합(바퀴마다 같은 일을 시켜 «느려짐»만 본다)
    await page.getByRole("button", { name: "크레용", exact: true }).click();
    await page.waitForTimeout(1500);
    await page.evaluate(() => ((window as unknown as { __long: number[] }).__long.length = 0));
    await strokes(page, 10, 99);
    await page.waitForTimeout(1000);
    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long.slice());

    // ④ 도안 목록으로 돌아가기(뒤로 가기 = 아이들이 실제로 누르는 길) 후 계측
    await page.goBack();
    await page.waitForURL(/\/coloring/);
    await page.waitForTimeout(1500);
    const gl = await page.evaluate(() => {
      const all = (window as unknown as { __ctxs: WebGL2RenderingContext[] }).__ctxs;
      return { alive: all.filter((c) => !c.isContextLost()).length, created: all.length };
    });
    const m = { cycle: c + 1, ...(await metrics(client)), glAlive: gl.alive, glCreated: gl.created, probeLongSum: long.reduce((a, x) => a + x, 0), probeLongMax: long.length ? Math.max(...long) : 0 };
    marks.push(m);
    console.log("CYCLE", JSON.stringify(m));
  }
  console.log("CYCLE-ALL", JSON.stringify(marks));

  const base = marks[1]; // 첫 바퀴는 워밍업(청크·셰이더·도안 목록)
  const last = marks[marks.length - 1];
  expect(last.glAlive, "살아 있는 WebGL 컨텍스트 — 그림을 나가면 반납돼야 한다").toBeLessThanOrEqual(1);
  expect(last.heapMB, "JS 힙(MB) — 바퀴마다 쌓이면 누수").toBeLessThan(base.heapMB * 1.3 + 15);
  expect(last.listeners, "이벤트 리스너 — 바퀴마다 쌓이면 누수").toBeLessThan(base.listeners * 1.3 + 50);
  expect(last.nodes, "DOM 노드").toBeLessThan(base.nodes * 1.5 + 500);
  if (base.rendererMB > 0) expect(last.rendererMB, "렌더러 프로세스 메모리(MB) — 캔버스가 쌓이면 여기서 보인다").toBeLessThan(base.rendererMB * 1.4 + 150);
  const tail = marks.slice(-3).map((x) => x.probeLongSum).sort((a, b) => a - b)[1];
  const head = marks.slice(1, 4).map((x) => x.probeLongSum).sort((a, b) => a - b)[1];
  expect(tail, `같은 10획의 멈춤 총합 — 앞 ${head}ms 대비`).toBeLessThan(Math.max(300, head * 1.8));
});
