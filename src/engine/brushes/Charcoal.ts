import { BrushBase } from "./BrushBase";

/** 목탄: 종이 요철의 봉우리에만 묻는 가루 — 결이 가장 강하게 드러나는 마른 매체.
 * 크레용(왁스, 채도 꽉)과 달리 옅게 쌓아 진해지고(buildup), 가장자리가 가루처럼 부스스하다. */
export class Charcoal extends BrushBase {
  constructor(rng?: () => number) {
    super(
      {
        id: "charcoal",
        tip: "rough", // 연필의 grain 팁은 가장자리가 부드러워 에어브러시처럼 번졌다(시각 확인) — 가루 입자 팁
        sizeScale: 1.1,
        spacing: 0.14,
        flow: 0.5, // 한 번에 진하지 않다 — 덧그을수록 쌓인다(크레용 0.9 와의 구분점)
        jitter: 0.18,
        sizePressure: 0.3,
        alphaPressure: 0.65, // 꾹 누르면 진한 검정, 스치면 회색 가루
        minSizeRatio: 0.7,
        composite: "source-over",
        rotationFollowsStroke: true,
        paperGrain: 0.85, // 모든 매체 중 최강 — 골짜기는 하얗게 남는다
        thinGrain: 0.9,
        speedAlpha: 0.22, // 빠르게 그으면 가루가 덜 묻는다
        speedSpacing: 0.2,
      },
      rng,
    );
  }
}
