import { BrushBase } from "./BrushBase";

/** 소프트 파스텔: 넓고 부드러운 분필 가루 — 불투명하게 덮되(결은 알파 구멍이 아니라 백화)
 * 종이 요철이 하얗게 비친다. 오일파스텔(기름진 덩어리·wash)보다 가볍고 가루답게. */
export class SoftPastel extends BrushBase {
  constructor(rng?: () => number) {
    super(
      {
        id: "pastel",
        tip: "rough",
        sizeScale: 1.5,
        spacing: 0.09,
        flow: 0.55,
        jitter: 0.12,
        sizePressure: 0.35,
        alphaPressure: 0.35,
        minSizeRatio: 0.7,
        composite: "source-over",
        rotationFollowsStroke: false,
        paperGrain: 0.62,
        grainLift: true, // 분필은 불투명 — 골짜기는 투명 구멍이 아니라 종이색이 비친다
        thinGrain: 0.7,
        speedSpacing: 0.15,
        speedAlpha: 0.12,
      },
      rng,
    );
  }
}
