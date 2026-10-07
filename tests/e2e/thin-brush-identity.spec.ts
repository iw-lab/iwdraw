import { test, expect } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

/*
 * "굵기가 얇아질수록 펜마다의 차이가 사라진다"(2026-07-25 사용자 지적) 회귀 가드.
 *
 * 개선 전 실측(굵기 1~2): 하드 하한 하나(MIN_DAB_PX 2.4)가 sizeScale 차이를 전부 뭉개
 *   · 사인펜 peak 0.605 / 잉크량 1.77  vs  아크릴펜 0.607 / 1.76  (차이 0.3% = 같은 획)
 *   · 연필 굵기 1·2·4가 peak 0.341/0.333/0.332 = 슬라이더 죽은 구간
 *   · 시각 폭이 전 브러시 2~3px, 질감 지표(texCV)도 0.03~0.09로 뭉침
 * 개선 후: 브러시별 최소 선 폭(minDabPxFor) + 하한 부드러운 압축(softFloorSize) +
 *   얇은 획의 길이 방향 농담(cfg.thinGrain).
 *
 * 여기서 재는 것은 세 가지 — ① 얇아도 폭 순서가 남는가 ② 마른 매체와 잉크 매체의 질감이
 * 갈리는가 ③ 굵기 슬라이더에 죽은 구간이 없는가.
 */

type Stat = { peak: number; w10: number; w50: number; texCV: number; gaps: number };

test("굵기를 낮춰도 브러시마다 다른 획이 나온다", async ({ page }) => {
  await page.goto("/draw?mode=sketch&backend=gl");
  const canvas = page.getByLabel("그림 캔버스");
  await canvas.waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "색 1", exact: true }).click();
  const box = (await canvas.boundingBox())!;

  /** 캔버스 세로 yFrac 위치에 수평 획 하나 */
  const stroke = async (yFrac: number) => {
    const y = box.y + box.height * yFrac;
    const x0 = box.x + box.width * 0.12;
    const x1 = box.x + box.width * 0.88;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let k = 1; k <= 30; k++) await page.mouse.move(x0 + (x1 - x0) * (k / 30), y);
    await page.mouse.up();
    await page.waitForTimeout(120);
  };

  /** 각 획의 단면 프로파일 — 폭(w10) · 농도(peak) · 길이 방향 요동(texCV) */
  const measure = (rows: { name: string; yFrac: number }[]) =>
    page.evaluate((rows: { name: string; yFrac: number }[]) => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const ctx = el.getContext("2d")!;
      const W = el.width;
      const H = el.height;
      const img = ctx.getImageData(0, 0, W, H).data;
      const lum = (i: number) => 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      let bgSum = 0;
      let bgN = 0;
      for (let y = 2; y < H; y += 7)
        for (let x = 2; x < 20; x += 3) {
          bgSum += lum((y * W + x) * 4);
          bgN++;
        }
      const bg = bgSum / bgN;
      const out: Record<
        string,
        { peak: number; w10: number; w50: number; texCV: number; gaps: number }
      > = {};
      for (const r of rows) {
        const cy = Math.round(H * r.yFrac);
        const half = Math.round(H * 0.04);
        const cols: number[][] = [];
        for (let x = Math.round(W * 0.2); x < Math.round(W * 0.8); x++) {
          const prof: number[] = [];
          for (let y = cy - half; y <= cy + half; y++)
            prof.push(Math.max(0, (bg - lum((y * W + x) * 4)) / bg));
          cols.push(prof);
        }
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
        const ink = cols.map((p) => p.reduce((s, v) => s + v, 0));
        const peak = cols.map((p) => Math.max(...p));
        const m = mean(ink);
        const sd = Math.sqrt(mean(ink.map((v) => (v - m) ** 2)));
        out[r.name] = {
          peak: +mean(peak).toFixed(3),
          w10: +mean(cols.map((p) => p.filter((v) => v >= 0.1).length)).toFixed(2),
          /* 반치폭 — 그 열 자신의 최대 농도의 절반을 넘는 행 수.
           * ⚠️ 절대 임계(w10)는 "폭"과 "진하기"를 섞어 잰다. 획이 3%만 옅어져도 폭이
           * 0.1~0.7행 줄어든 것처럼 나온다(2026-07-27 A/B 실측). 굵기 1↔4처럼 실제 dab
           * 지름 차가 0.5px(2.17→2.68)뿐인 구간에서는 그 혼입이 판정을 뒤집는다.
           * 자기 농도 기준이면 진하기와 무관하게 발자국만 잰다. */
          w50: +mean(
            cols.map((p) => {
              const mx = Math.max(...p);
              return mx <= 0 ? 0 : p.filter((v) => v >= mx * 0.5).length;
            }),
          ).toFixed(2),
          texCV: +(sd / (m || 1)).toFixed(3),
          gaps: peak.filter((v) => v < 0.04).length,
        };
      }
      return out;
    }, rows);

  const clear = async () => {
    await page.getByRole("button", { name: "전체 지우기" }).click();
    await page.getByRole("button", { name: "정말 지울래요" }).click();
    await page.waitForTimeout(200);
  };

  // ── ① · ② 굵기 2에서 브러시별 획 특성 ────────────────────────────────
  const BRUSHES = ["연필", "크레용", "사인펜", "마커", "수채붓"];
  const rows = BRUSHES.map((name, i) => ({ name, yFrac: 0.12 + i * 0.16 }));
  for (const r of rows) {
    await page.getByRole("button", { name: r.name, exact: true }).click();
    await page.getByLabel("브러시 굵기", { exact: true }).fill("2");
    await stroke(r.yFrac);
  }
  await page.waitForTimeout(300);
  const thin: Record<string, Stat> = await measure(rows);
  console.log("THIN-IDENTITY", JSON.stringify(thin));
  await clear();

  // ① 얇아도 폭 순서가 남는다(가는 펜 < 마커 < 수채붓). 개선 전엔 전부 2~3px로 동일.
  //    ⚠️ 연필(2.34px) vs 사인펜(2.60px)은 폭 차이가 래스터 1행 미만이라 폭으로 판정하지
  //    않는다 — 이 둘의 구분은 농도·질감이 담당(아래 ②·③). 폭 게이트는 1px 이상 벌어진
  //    쌍에만 건다(w10은 행 단위 계단이라 미세 차이에서 flaky).
  expect(thin["사인펜"].w10, "사인펜 폭").toBeLessThan(thin["마커"].w10);
  expect(thin["마커"].w10, "마커 폭").toBeLessThan(thin["수채붓"].w10);
  // ② 같은 폭이어도 농도로 갈린다 — 연필은 흑연이 종이에 얹힌 회색, 사인펜은 꽉 찬 잉크
  expect(thin["사인펜"].peak - thin["연필"].peak, "사인펜−연필 농도차").toBeGreaterThan(0.15);
  // ③ 마른 매체는 획을 따라 농담이 출렁이고, 잉크 매체는 균일하다(질감 정체성)
  expect(thin["연필"].texCV, "연필 길이방향 요동").toBeGreaterThan(0.1);
  expect(thin["크레용"].texCV, "크레용 길이방향 요동").toBeGreaterThan(0.1);
  expect(thin["사인펜"].texCV, "사인펜 균일성").toBeLessThan(0.06);
  expect(thin["마커"].texCV, "마커 균일성").toBeLessThan(0.06);
  // 얇아도 끊기면 안 된다(2026-07-13 회귀 가드와 같은 불변식)
  for (const b of BRUSHES) expect(thin[b].gaps, `${b} 끊긴 열`).toBeLessThan(3);

  // ④ 핵심 게이트 — "어느 두 브러시도 같은 획이 아니다".
  //    서명 = [폭, 농도, 길이방향 요동]을 비슷한 스케일로 정규화한 벡터, 거리 = L1.
  //    개선 전 실측 거리: 연필–크레용 0.07 · 사인펜–아크릴펜 0.02(= 사실상 동일 획).
  //    개선 후: 최솟값 0.44(크레용–사인펜). 게이트 0.25는 그 중간.
  const sig = (s: Stat) => [s.w10 / 6, s.peak, s.texCV * 3];
  let closest = { pair: "", d: Infinity };
  for (let i = 0; i < BRUSHES.length; i++)
    for (let j = i + 1; j < BRUSHES.length; j++) {
      const a = sig(thin[BRUSHES[i]]);
      const b = sig(thin[BRUSHES[j]]);
      const d = a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0);
      if (d < closest.d) closest = { pair: `${BRUSHES[i]}–${BRUSHES[j]}`, d: +d.toFixed(3) };
    }
  console.log("CLOSEST-PAIR", JSON.stringify(closest));
  expect(closest.d, `가장 비슷한 두 브러시(${closest.pair})`).toBeGreaterThan(0.25);

  // ── ③ 굵기 슬라이더 죽은 구간 없음 ─────────────────────────────────────
  // 개선 전: 연필 굵기 1·2·3·4가 raw 0.45~1.8로 전부 하한(2.4)에 걸려 완전히 같은 획.
  await page.getByRole("button", { name: "연필", exact: true }).click();
  const steps = [1, 4, 8];
  const stepRows = steps.map((s, i) => ({ name: `s${s}`, yFrac: 0.15 + i * 0.25 }));
  for (let i = 0; i < steps.length; i++) {
    await page.getByLabel("브러시 굵기", { exact: true }).fill(String(steps[i]));
    await stroke(stepRows[i].yFrac);
  }
  await page.waitForTimeout(300);
  const ramp: Record<string, Stat> = await measure(stepRows);
  console.log("SIZE-RAMP", JSON.stringify(ramp));
  /* ⚠️ 굵기 1→4를 "폭"으로 판정하면 안 된다 — 측정 해상도 아래다.
   * 연필 sizeScale 0.45, 하한 압축(softFloorSize) 때문에 실제 dab 지름은 2.17 → 2.68px,
   * 래스터 행 수로는 둘 다 2행이다. 2026-07-27 A/B 실측: 속도 반응을 넣기 전 기준선조차
   * w50 2.00 vs 2.01(=0.01행, 노이즈)로 겨우 통과하고 있었다. 즉 이 단언은 통과해도
   * 아무것도 보장하지 못했다.
   * 이 구간에서 사용자가 실제로 체감하는 변화는 **진하기**다(peak 0.27 → 0.34, 28%).
   * 폭은 해상되는 1→8에만 건다. 둘을 합치면 "슬라이더를 올리면 획이 달라진다"는
   * 원래 의도를 그대로, 다만 실제로 잴 수 있는 형태로 지킨다. */
  expect(ramp["s1"].peak, "연필 굵기1 < 굵기4 (진하기)").toBeLessThan(ramp["s4"].peak);
  expect(ramp["s4"].peak, "연필 굵기4 < 굵기8 (진하기)").toBeLessThan(ramp["s8"].peak);
  expect(ramp["s1"].w50, "연필 굵기1 < 굵기8 (폭)").toBeLessThan(ramp["s8"].w50);
});

/*
 * 굵은 쪽 정체성 — "얇은 쪽만 고치다 굵은 쪽이 뭉개지지 않았는가".
 *
 * 얇은 획 게이트(위)는 하한·길이방향 농담을 지키지만, 굵은 획의 정체성은 다른 것들이
 * 담당한다: 팁 텍스처(입자/납작촉/붓털), 종이 결, 임파스토·스트릭. 이쪽에 게이트가
 * 없으면 얇은 쪽을 손볼 때 굵은 쪽이 조용히 평평해져도 아무도 모른다(2026-07-29 추가).
 *
 * ⚠️ 종이 결 감쇠(ArtEngine.brushContext)는 침식 모드에만 걸어야 한다 — 백화 모드
 * (grainLift: 유화·오일파스텔)는 알파를 안 깎으므로 획을 끊을 수가 없는데도 같이
 * 감쇠하고 있어서 가는 유화·파스텔만 질감이 사라졌다. 그 회귀도 여기서 잡는다.
 */
test("굵은 획에서도 브러시마다 다른 획이 나온다", async ({ page }) => {
  await page.goto("/draw?mode=sketch&backend=gl");
  const canvas = page.getByLabel("그림 캔버스");
  await canvas.waitFor();
  const fresh = page.getByRole("button", { name: /새로 시작/ });
  if (await fresh.isVisible().catch(() => false)) await fresh.click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "색 1", exact: true }).click();
  const box = (await canvas.boundingBox())!;

  const stroke = async (yFrac: number) => {
    const y = box.y + box.height * yFrac;
    const x0 = box.x + box.width * 0.12;
    const x1 = box.x + box.width * 0.88;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let k = 1; k <= 30; k++) await page.mouse.move(x0 + (x1 - x0) * (k / 30), y);
    await page.mouse.up();
    await page.waitForTimeout(120);
  };

  /** 굵은 획 지표 — 폭·농도·길이방향 요동(texCV)·획 **안쪽** 결(inCV) */
  const measure = (rows: { name: string; yFrac: number }[]) =>
    page.evaluate((rows: { name: string; yFrac: number }[]) => {
      const el = document.querySelector('canvas[aria-label="그림 캔버스"]') as HTMLCanvasElement;
      const W = el.width;
      const H = el.height;
      const img = el.getContext("2d")!.getImageData(0, 0, W, H).data;
      const lum = (i: number) => 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      let bg = 0;
      let bgN = 0;
      for (let y = 2; y < H; y += 7)
        for (let x = 2; x < 20; x += 3) {
          bg += lum((y * W + x) * 4);
          bgN++;
        }
      bg /= bgN;
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
      const out: Record<string, { peak: number; w10: number; texCV: number; inCV: number }> = {};
      for (const r of rows) {
        const cy = Math.round(H * r.yFrac);
        const half = Math.round(H * 0.05);
        const ink: number[] = [];
        const peak: number[] = [];
        const width: number[] = [];
        const cols: number[][] = [];
        for (let x = Math.round(W * 0.2); x < Math.round(W * 0.8); x++) {
          const prof: number[] = [];
          for (let y = cy - half; y <= cy + half; y++)
            prof.push(Math.max(0, (bg - lum((y * W + x) * 4)) / bg));
          ink.push(prof.reduce((s, v) => s + v, 0));
          peak.push(Math.max(...prof));
          width.push(prof.filter((v) => v >= 0.1).length);
          cols.push(prof);
        }
        /* 획 **안쪽**의 요철(inCV) — 팁 입자·종이 결이 만드는 2D 질감.
         * ⚠️ 코어는 "값이 최대의 60% 이상인 행"으로 잡으면 안 된다: 좁은 획일수록
         * 가장자리 폴오프가 그 밴드의 큰 몫이 돼 질감이 아니라 **폭**을 재게 된다
         * (2026-07-29 실측: 사인펜 0.136 ≈ 크레용 0.133 — 마른/잉크가 안 갈렸다).
         * 획 중심에서 폭의 ±35% 안쪽만 기하학적으로 잘라야 평평한 잉크가 평평하게 나온다. */
        const core = Math.max(1, Math.round((mean(width) * 0.35) / 2));
        const inside: number[] = [];
        for (const prof of cols)
          for (let k = -core; k <= core; k++) inside.push(prof[half + k] ?? 0);
        const mi = mean(ink);
        const sdI = Math.sqrt(mean(ink.map((v) => (v - mi) ** 2)));
        const mn = mean(inside);
        const sdN = Math.sqrt(mean(inside.map((v) => (v - mn) ** 2)));
        out[r.name] = {
          peak: +mean(peak).toFixed(3),
          w10: +mean(width).toFixed(2),
          texCV: +(sdI / (mi || 1)).toFixed(3),
          inCV: +(sdN / (mn || 1)).toFixed(3),
        };
      }
      return out;
    }, rows);

  // 목탄·파스텔(2026-10-07 추가) — 크레용·오일파스텔과 같은 마른/입자 매체라 «같은 획»이 되기 가장 쉬운 짝
  const BRUSHES = ["연필", "크레용", "사인펜", "유화붓", "오일파스텔", "목탄", "파스텔"];
  const rows = BRUSHES.map((name, i) => ({ name, yFrac: 0.09 + i * 0.135 }));
  for (const r of rows) {
    await page.getByRole("button", { name: r.name, exact: true }).click();
    await page.getByLabel("브러시 굵기", { exact: true }).fill("20");
    await stroke(r.yFrac);
  }
  await page.waitForTimeout(300);
  const thick = await measure(rows);
  console.log("THICK-IDENTITY", JSON.stringify(thick));

  // 가는 획(굵기 3)에서도 불투명 매체의 질감이 남아 있는가 — 현재 동작을 못 박는 게이트.
  // 얇은 쪽을 손보다가 굵은 쪽/불투명 매체가 조용히 평평해지는 회귀를 잡는다.
  await page.getByRole("button", { name: "전체 지우기" }).click();
  await page.getByRole("button", { name: "정말 지울래요" }).click();
  await page.waitForTimeout(250);
  const LIFT = ["유화붓", "오일파스텔"];
  const liftRows = LIFT.map((name, i) => ({ name, yFrac: 0.3 + i * 0.35 }));
  for (const r of liftRows) {
    await page.getByRole("button", { name: r.name, exact: true }).click();
    await page.getByLabel("브러시 굵기", { exact: true }).fill("3");
    await stroke(r.yFrac);
  }
  await page.waitForTimeout(300);
  const liftThin = await measure(liftRows);
  console.log("LIFT-THIN", JSON.stringify(liftThin));

  // ① 굵은 획도 폭 순서가 남는다(연필은 가늘고 유화붓은 넓다)
  expect(thick["연필"].w10, "굵기20 연필 폭 < 유화붓 폭").toBeLessThan(thick["유화붓"].w10);
  // ② 마른/입자 매체는 획 안쪽에 결이 있고, 잉크 펜은 평평하다 — 굵은 쪽 질감 정체성
  expect(thick["크레용"].inCV, "크레용 내부 결 > 사인펜").toBeGreaterThan(thick["사인펜"].inCV * 2);
  // 목탄 = 가장 거친 가루 매체 — 내부 결이 크레용보다 크다(2026-10-07 실측 0.147 vs 0.103).
  // ⚠️ 이 단언은 «종이 결 반응»을 증명하지 않는다: 목탄 paperGrain 을 0 으로 꺼도 거친 팁·낮은 흐름만으로
  //    통과했다(고의 파손 실측). 종이 결 배선 자체는 paper-texture.spec 이 잰다.
  expect(thick["목탄"].inCV, "목탄 내부 결 > 크레용").toBeGreaterThan(thick["크레용"].inCV);
  // ③ 가는 불투명 매체도 질감이 남는다(2026-07-29 실측 유화붓 0.034 · 오일파스텔 0.22)
  expect(liftThin["유화붓"].inCV, "유화붓 굵기3 내부 결").toBeGreaterThan(0.024);
  expect(liftThin["오일파스텔"].inCV, "오일파스텔 굵기3 내부 결").toBeGreaterThan(0.14);

  // ④ 얇은 쪽과 같은 불변식 — 어느 두 브러시도 같은 획이 아니다
  /* 정규화는 **그 굵기 구간의 실제 분포**에 맞춘다 — 굵은 획의 폭은 8~28px이므로 20으로
   * 나눠야 농도(0.65~0.77)와 비슷한 크기가 된다(얇은 쪽은 폭 2~5.5라 6으로 나눈다).
   * 내부 결(inCV)에 큰 가중을 주는 이유: 굵은 획에서 연필과 사인펜을 가르는 건 폭보다
   * "입자가 보이는가"다(2026-07-29 실측 0.030 vs 0.013). 가중이 낮으면 눈에 뻔히 다른
   * 두 획이 수치상 붙어 버린다(w10/40·inCV×2로 재보니 0.15 = 게이트 무의미). */
  const sig = (s: { peak: number; w10: number; texCV: number; inCV: number }) => [
    s.w10 / 20,
    s.peak,
    s.texCV * 3,
    s.inCV * 6,
  ];
  let closest = { pair: "", d: Infinity };
  for (let i = 0; i < BRUSHES.length; i++)
    for (let j = i + 1; j < BRUSHES.length; j++) {
      const a = sig(thick[BRUSHES[i]]);
      const b = sig(thick[BRUSHES[j]]);
      const d = a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0);
      if (d < closest.d) closest = { pair: `${BRUSHES[i]}–${BRUSHES[j]}`, d: +d.toFixed(3) };
    }
  console.log("THICK-CLOSEST", JSON.stringify(closest));
  // 2026-07-29 실측 최솟값 0.32(연필–사인펜) · 다음 0.35(유화붓–오일파스텔). 게이트는 그 아래.
  expect(closest.d, `굵은 획에서 가장 비슷한 두 브러시(${closest.pair})`).toBeGreaterThan(0.25);
});
