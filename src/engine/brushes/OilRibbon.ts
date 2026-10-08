import { BrushBase } from "./BrushBase";
import type { BrushSettings, Dab, StrokePoint } from "../types";
import { RIBBON, ribbonLen, ribbonU } from "../core/ribbon";

/**
 * 납작붓(리본 유화) — 붓자국 그림 한 장(Firefly 생성, public/brush-tips/oil-ribbon.png)을
 * 획 경로를 따라 얇은 조각으로 잘라 이어 붙인다(2026-10-07 아트봉봉 비교 — 도장을 찍는 유화붓은
 * 가는 획에서 붓결이 사라지고 끝이 둥근 알약이 됐다).
 *
 *  · 조각 위치 = 지나온 거리. 시작 구간 → 몸통 구간(가로 반복) → 손 뗄 때 끝 구간.
 *  · 굵기와 무관하게 붓결이 획을 따라 길게 이어진다(텍스처 높이 = 획 폭).
 *  · 끝은 «마른 붓이 갈라지는 모양»이라 몸통 위에 덧칠로는 못 만든다(wash = MAX 합성은 칠을 더하기만).
 *    그래서 마지막 «끝 구간 길이»만큼은 붙잡아 두었다가 손을 떼면 끝 그림으로 그린다 —
 *    붙잡아 둔 구간은 매 프레임 «지금 떼면» 끝 그림으로 표시만 한다(preview) — 펜에 바로 붙어 온다
 *    (2026-10-08 사용자 «커서를 늦게 따라온다»: 표시까지 붙잡아 두면 획 폭만큼 늦었다).
 *  · 결정론: 점열만으로 정해진다(무비 재생 = 같은 그림).
 */
export class OilRibbon extends BrushBase {
  constructor(rng?: () => number) {
    super(
      {
        id: "oilribbon",
        tip: "ribbon",
        sizeScale: 1.5,
        spacing: 0.04,
        flow: 1,
        jitter: 0,
        sizePressure: 0.2,
        alphaPressure: 0.05, // 불투명 물감
        minSizeRatio: 0.7,
        composite: "source-over",
        rotationFollowsStroke: true,
        paperGrain: 0.38, // 유화붓과 같은 캔버스 결 배어남
        strokeBlend: "wash",
        washOpacity: 1,
        grainLift: true,
        streaks: 0, // 붓결은 텍스처가 담당
        impasto: 0.6,
        impastoShadow: 0, // 테두리 검은 테 제거 — 아트봉봉 붓자국은 둘레가 밝다(2026-10-08 사용자)
        wetMix: 0.4,
        speedSize: 0.1,
        speedAlpha: 0.08,
      },
      rng,
    );
  }

  /** 아직 내보내지 않은(끝 구간이 될 수도 있는) 조각과 그 호 길이 */
  private queue: { d: Dab; arc: number }[] = [];
  private arcOf = new WeakMap<Dab, number>();
  private tapAt: StrokePoint | null = null;

  private width(): number {
    return this.strokePx(this.settings.size);
  }

  private sliceLen(): number {
    const step = Math.max(0.6, this.width() * this.cfg.spacing);
    return step * 1.7 + 0.6; // 이웃 조각과 겹쳐 굽은 길 바깥쪽에 틈이 안 나게
  }

  /** 구간 안 비율 t 의 조각(u0~u1) — 구간 경계 밖으로 새지 않게 자른다 */
  private sliceAt(region: readonly [number, number], t: number, regionLenPx: number): Dab["slice"] {
    const len = this.sliceLen();
    const du = ((len / Math.max(1, regionLenPx)) * (region[1] - region[0])) / RIBBON.W;
    const u = ribbonU(region, t);
    const lo = region[0] / RIBBON.W;
    const hi = region[1] / RIBBON.W;
    return { u0: Math.max(lo, u - du / 2), u1: Math.min(hi, u + du / 2), len };
  }

  /** 그리는 중의 위치(시작 → 몸통 반복) */
  private liveSlice(arc: number): Dab["slice"] {
    const w = this.width();
    const ls = ribbonLen(RIBBON.start, w);
    const lb = ribbonLen(RIBBON.body, w);
    if (arc < ls) return this.sliceAt(RIBBON.start, arc / ls, ls);
    return this.sliceAt(RIBBON.body, ((arc - ls) % lb) / lb, lb);
  }

  /** 가는 획(폭 40px 미만)은 붓털을 굵게 묶은 띠 — 원본의 가는 결은 축소되면 평균으로 사라진다 */
  private tipFor(): Dab["tip"] {
    return this.width() < 40 ? "ribbon-bold" : undefined;
  }

  protected override makeDab(p: StrokePoint, angle: number): Dab {
    const d = super.makeDab(p, angle);
    d.tip = this.tipFor();
    d.slice = this.liveSlice(this.arc);
    this.arcOf.set(d, this.arc);
    return d;
  }

  override begin(p: StrokePoint, settings: BrushSettings): Dab[] {
    this.queue = [];
    this.tapAt = p;
    super.begin(p, settings); // rotationFollowsStroke — 첫 조각은 방향이 정해질 때까지 보류된다
    return [];
  }

  override move(p: StrokePoint): Dab[] {
    for (const d of super.move(p)) this.queue.push({ d, arc: this.arcOf.get(d) ?? this.traveled });
    // 끝 구간 길이만큼 뒤처진 조각까지만 내보낸다
    const keepFrom = this.traveled - ribbonLen(RIBBON.end, this.width());
    let n = 0;
    while (n < this.queue.length && this.queue[n].arc <= keepFrom) n++;
    return this.queue.splice(0, n).map((q) => q.d);
  }

  override preview(): Dab[] {
    const w = this.width();
    const total = this.traveled;
    if (!this.queue.length || total <= w * 0.25) return [];
    const e = Math.min(ribbonLen(RIBBON.end, w), total * 0.5);
    // end() 와 같은 계산 — 손을 떼도 화면이 안 바뀐다(프리뷰=최종)
    return this.queue.map((q) =>
      q.arc > total - e ? { ...q.d, slice: this.sliceAt(RIBBON.end, (q.arc - (total - e)) / e, e) } : q.d,
    );
  }

  override end(): Dab[] {
    const w = this.width();
    const total = this.traveled;
    const tapPoint = this.tapAt;
    super.end(); // 상태 정리 — 탭 보강 dab·보류된 첫 dab 은 리본에선 쓰지 않는다
    this.tapAt = null;
    // 제자리 탭 = 붓을 콕 눌렀다 뗀 짧은 붓자국(시작 절반 + 끝 절반)
    if (total <= w * 0.25 && tapPoint) return this.tapStroke(tapPoint);

    // 남은 조각 중 마지막 e(끝 구간 길이, 짧은 획이면 절반까지 줄임)를 끝 그림으로 다시 매긴다
    const e = Math.min(ribbonLen(RIBBON.end, w), total * 0.5);
    const out = this.queue.map((q) => {
      if (q.arc > total - e) q.d.slice = this.sliceAt(RIBBON.end, (q.arc - (total - e)) / e, e);
      return q.d;
    });
    this.queue = [];
    return out;
  }

  /** 콕 찍기 — 진행 방향 0 으로 획 폭 1.2배 길이의 짧은 붓자국 */
  private tapStroke(p: StrokePoint): Dab[] {
    const w = this.width();
    const total = w * 1.2;
    const step = Math.max(0.6, w * this.cfg.spacing);
    const out: Dab[] = [];
    for (let a = 0; a <= total; a += step) {
      const ip: StrokePoint = { ...p, x: p.x - total / 2 + a };
      this.arc = a;
      const d = super.makeDab(ip, 0);
      d.tip = this.tipFor();
      const half = total / 2;
      d.slice =
        a < half
          ? this.sliceAt(RIBBON.start, a / half, half)
          : this.sliceAt(RIBBON.end, (a - half) / half, half);
      out.push(d);
    }
    return out;
  }
}
