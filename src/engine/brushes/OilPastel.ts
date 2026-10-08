import { BrushBase } from "./BrushBase";

/** 오일파스텔: 굵고(1.3배) 크리미한 덩어리(chunk 팁) — 크레용보다 진하고 부드럽게 뭉개짐 */
export class OilPastel extends BrushBase {
  constructor(rng?: () => number) {
    super(
      {
        id: "oilpastel",
        tip: "chunk",
        sizeScale: 1.3,
        spacing: 0.12,
        flow: 1,
        jitter: 0.06,
        sizePressure: 0.4,
        alphaPressure: 0.1, // 불투명 매체 — 0.25는 마우스 필압에서 겹침 진해짐(유화와 동일 버그 클래스)
        minSizeRatio: 0.65,
        composite: "source-over",
        rotationFollowsStroke: true,
        paperGrain: 0.45, // 0.25는 민무늬 "진한 마커"로 읽힘(사용자 실측)
        grainLift: true, // 불투명 매체 — 결은 알파 구멍이 아니라 백화(겹침 진해짐 방지, 유화와 동일)
        strokeBlend: "wash", // 크리미한 덩어리 질감이 획 전체에 유지
        thinGrain: 0.6, // 얇게 그으면 기름진 덩어리가 끊긴다(크레용보다는 덜)
        speedSpacing: 0.22, // 기름진 덩어리가 끊기는 결(크레용보다 약하게)
        speedAlpha: 0.1,
        washOpacity: 1,
        edgeNoise: 0.55, // 가장자리 부슬거림 = 캔버스 고정 요철(팁 입자는 획을 따라 털 선이 됐다)
      },
      rng,
    );
  }
}
