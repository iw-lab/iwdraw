import { BrushBase } from "./BrushBase";
import type { Dab, StrokePoint } from "../types";

/**
 * 유화붓: 굵고(1.5배) 완전 불투명 — 대비 강한 bristle 팁이 스트로크 방향(스무딩된 각도)을
 * 따라 회전해 붓결 스트릭이 이어지고, 종이 결(린넨 백화)이 배어난다.
 * 임파스토 릴리프(실루엣 명암) + 획 내 물감 로드 변조로 "두께 있는 물감" 인상
 * (2026-07-10 유화 전문가 관점 교차진단 1·2순위).
 */
export class OilBrush extends BrushBase {
  constructor(rng?: () => number) {
    super(
      {
        id: "oil",
        tip: "bristle",
        sizeScale: 1.5, // 유화는 넓은 붓이 기본 — 기본 굵기에서도 붓결이 보일 폭 확보
        spacing: 0.05,
        flow: 1,
        jitter: 0.015,
        sizePressure: 0.28, // i-scream 유화는 획 폭이 거의 일정 — 속도 필압 출렁임 완화(0.45는 ±13%)
        alphaPressure: 0.1, // 유화 물감은 불투명 — 0.35는 마우스 필압(속도 0.35~0.85)에서
        // dab 알파 0.77까지 떨어져 겹친 획이 진해짐(i-scream 비교 실측). 마른 끝은 fringe 담당
        minSizeRatio: 0.6,
        composite: "source-over",
        rotationFollowsStroke: true,
        paperGrain: 0.38, // 캔버스 결이 배어나되 진행방향 붓결을 덮지 않게(0.6은 격자가 결을 가림, 0.45는 격자가 붓결과 경합 — 실측)
        strokeBlend: "wash", // 겹침 포화 방지 → 붓결이 획 전체에 보존
        washOpacity: 1,
        // fringe(양끝 트레일 dab) 금지 — 불투명 물감에선 꼬리 dab이 캡 경계 밖에 걸려
        // "물감 점"으로 읽힘(2026-07-06 산포 축소 후에도 재발, 사용자 실측 2회 → 기능 off).
        // 붓끝 갈라짐은 팁의 좌우 지터(jl/jr)·가장자리 폴오프·스트릭이 담당
        // ⚠️ 고립된 흰 점(fleck) 금지 — 캔버스 고정 점은 붓 방향과 무관해 "인위적"으로
        // 읽힌다(2026-07-06 사용자 실측 3회 수렴, 기능 제거). 질감은 streaks+직조 백화 전담
        grainLift: true, // 유화 물감은 불투명 — 결은 구멍이 아니라 흰 캔버스 배어남(겹침 진해짐 방지)
        streaks: 0.66, // 붓 방향 밝은 스트릭 — MAX에서 살아남아 덧칠 내부에도 붓결 유지. 0.55는 i-scream 대비 디테일 부족(2026-07-10 사용자 실측)
        impasto: 0.8, // 실루엣 좌상단 하이라이트/우하단 그림자 — 물감 두께감(프리뷰=최종)
        // 얇은 유화 획은 붓결(streaks)이 폭 안에 못 들어간다 — 길이 방향 물감 농담으로 환산
        thinGrain: 0.45,
        // 물감이 늘어나며 얇고 옅어진다
        speedAlpha: 0.25,
        speedSize: 0.12,
        wetMix: 0.5, // 젖은 물감 섞임 — 지나간 밑색을 붓에 묻혀 와 섞임(i-scream 유화 실측, 2026-07-10 사용자 요청)
      },
      rng,
    );
  }

  /** 획 내 물감 로드 변조 — 색 명도가 저주파로 은근히 출렁여 "손으로 칠한 물감" 인상.
   * ⚠️ 랜덤 노이즈 금지(지저분한 얼룩) — p.t 기반 두 사인 합성 저주파(수채 드리프트와 동형).
   * wash(MAX)에서 밝은 dab이 겹침 우세지만 드리프트가 느려 국소적으로 균일 = 얼룩 없음.
   * 진폭 ±5%는 유화 굵기별 색 일관성 e2e(oil-color-consistency, 채널 평균 비교)를 깨지 않는
   * 제로 평균. */
  protected override makeDab(p: StrokePoint, angle: number): Dab {
    const dab = super.makeDab(p, angle);
    const drift =
      Math.sin(p.t * 0.003 + this.strokeSeed) * 0.5 + Math.sin(p.t * 0.0013 + this.strokeSeed * 2.7) * 0.5;
    const v = 1 + drift * 0.05;
    // wet mixing이 켜졌으면 super가 넣은 섞인 색(paintColor) 위에 드리프트를 곱한다
    const c = dab.color ?? this.settings.color;
    // 4단계 양자화 — Canvas2D 폴백의 색 틴트 캐시(색상별)가 dab마다 새 항목으로
    // 스래싱하지 않게(획당 유니크 색 ~5개로 제한). 오차 ≤2는 비가시.
    const q = (x: number) => Math.max(0, Math.min(252, Math.round((x * v) / 4) * 4));
    dab.color = { r: q(c.r), g: q(c.g), b: q(c.b) };
    return dab;
  }

  /** 획별 위상(수채와 동형) — Math.random 없이 결정론적 다양성 */
  private strokeSeed = 0.9;

  override begin(p: StrokePoint, settings: Parameters<BrushBase["begin"]>[1]): Dab[] {
    this.strokeSeed = (p.t % 10000) * 0.00047;
    return super.begin(p, settings);
  }
}
