import { BrushBase } from "./BrushBase";
import type { BrushSettings, Dab, StrokePoint } from "../types";
import { RIBBON, ribbonLen, ribbonU } from "../core/ribbon";

type Seg = NonNullable<NonNullable<Dab["slice"]>["seg"]>;

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
        // 질감의 주역 = 화면 맨 위 캔버스 요철(paper.ts drawPaperRelief — 아트봉봉 비교 2026-10-08:
        // 몸통은 한 색, 천 요철이 물감에 비친다). 물감 자체 결은 약하게 — 요철과 다른 무늬라 겹치면 지저분
        paperGrain: 0.2,
        edgeNoise: 0.5, // 가장자리를 천 결 따라 거칠게(붓 띠 알파 폴오프 구간만)
        strokeBlend: "wash",
        washOpacity: 1,
        washOver: true, // 나중 붓질이 앞을 덮는다(MAX 면 겹친 자리마다 밝은 테가 쌓임)
        grainLift: true,
        streaks: 1, // 붓결 하이라이트 = 띠 텍스처 G 채널(셰이더 u_hlTip) — 강도는 텍스처가 정한다
        impasto: 0.6,
        impastoShadow: 0, // 테두리 검은 테 제거 — 아트봉봉 붓자국은 둘레가 밝다(2026-10-08 사용자)
        wetMix: 0.4,
        speedSize: 0.1,
        speedAlpha: 0.08,
      },
      rng,
    );
  }

  /** 아직 내보내지 않은(끝 구간이 될 수도 있는) 조각과 그 호 길이·앞 조각까지 거리 */
  private queue: { d: Dab; arc: number; segLen: number }[] = [];
  private arcOf = new WeakMap<Dab, number>();
  private segLenOf = new WeakMap<Dab, number>();
  /** 앞 조각 단면(이음 띠의 왼쪽 변) */
  private prev: { x: number; y: number; rot: number; size: number; arc: number } | null = null;
  private tapAt: StrokePoint | null = null;
  /** 이 획에서 만든 조각 중심(호 길이순) — 앞뒤를 같이 보는 진행 방향 계산용 */
  private pts: { x: number; y: number; arc: number }[] = [];
  /** 마지막으로 확정해 내보낸 조각의 단면 — 다음 이음 띠의 왼쪽 변 */
  private lastOut: Seg | null = null;

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

  /**
   * 이음 띠 조각 — 구간 안 비율 t 위치가 오른쪽 끝(u1), 앞 조각까지 거리 segLen 만큼 왼쪽(u0).
   * 구간 시작을 넘으면 구간 안쪽으로 민다(폭 0 조각 = 텍셀 한 줄이 늘어난 띠가 된다).
   */
  private segAt(
    region: readonly [number, number],
    t: number,
    regionLenPx: number,
    segLen: number,
    seg: NonNullable<NonNullable<Dab["slice"]>["seg"]>,
  ): Dab["slice"] {
    const lo = region[0] / RIBBON.W;
    const du = Math.min(
      ((segLen / Math.max(1, regionLenPx)) * (region[1] - region[0])) / RIBBON.W,
      (region[1] - region[0]) / RIBBON.W,
    );
    const u1 = Math.max(ribbonU(region, t), lo + du);
    return { u0: u1 - du, u1, len: segLen, seg };
  }

  /** 그리는 중의 위치(시작 → 몸통 반복) — 앞 조각이 있으면 이음 띠, 없으면 사각 조각 */
  private liveSlice(arc: number, d: Dab): Dab["slice"] {
    const w = this.width();
    const ls = ribbonLen(RIBBON.start, w);
    const lb = ribbonLen(RIBBON.body, w);
    const [region, t, len] =
      arc < ls ? ([RIBBON.start, arc / ls, ls] as const) : ([RIBBON.body, ((arc - ls) % lb) / lb, lb] as const);
    const p = this.prev;
    if (!p) return this.sliceAt(region, t, len);
    const segLen = Math.max(0.01, arc - p.arc);
    this.segLenOf.set(d, segLen);
    return this.segAt(region, t, len, segLen, { x: p.x, y: p.y, rot: p.rot, size: p.size });
  }

  /** 끝 구간으로 다시 매긴 조각(손 뗄 때·꼬리 미리보기 공용) */
  private endSlice(q: { d: Dab; arc: number; segLen: number }, total: number, e: number): Dab["slice"] {
    const t = (q.arc - (total - e)) / e;
    const seg = q.d.slice?.seg;
    return seg ? this.segAt(RIBBON.end, t, e, q.segLen, seg) : this.sliceAt(RIBBON.end, t, e);
  }

  /** 가는 획(폭 40px 미만)은 붓털을 굵게 묶은 띠 — 원본의 가는 결은 축소되면 평균으로 사라진다 */
  private tipFor(): Dab["tip"] {
    return this.width() < 40 ? "ribbon-bold" : undefined;
  }

  protected override makeDab(p: StrokePoint, angle: number): Dab {
    const d = super.makeDab(p, angle);
    d.tip = this.tipFor();
    // 폭·방향을 획을 따라 매끈하게 — 이음 띠는 단면을 그대로 잇기 때문에 입력 이벤트마다 튀는
    // 속도·필압 폭이 가장자리 계단으로 보였다(2026-10-08 지그재그 실측). 반 폭 거리에 걸쳐 따라간다.
    const pv = this.prev;
    if (pv) {
      const w = this.width();
      d.size = pv.size + (d.size - pv.size) * Math.min(1, (this.arc - pv.arc) / (w * 0.5));
    }
    // 방향(d.rotation)은 여기서 정하지 않는다 — 내보낼 때 앞뒤 경로를 함께 보고 정한다(settle)
    d.slice = this.liveSlice(this.arc, d);
    this.arcOf.set(d, this.arc);
    this.pts.push({ x: d.x, y: d.y, arc: this.arc });
    this.prev = { x: d.x, y: d.y, rot: d.rotation, size: d.size, arc: this.arc };
    return d;
  }

  override begin(p: StrokePoint, settings: BrushSettings): Dab[] {
    this.queue = [];
    this.prev = null;
    this.pts = [];
    this.lastOut = null;
    this.tapAt = p;
    super.begin(p, settings); // rotationFollowsStroke — 첫 조각은 방향이 정해질 때까지 보류된다
    return [];
  }

  override move(p: StrokePoint): Dab[] {
    for (const d of super.move(p))
      this.queue.push({ d, arc: this.arcOf.get(d) ?? this.traveled, segLen: this.segLenOf.get(d) ?? 0 });
    // 끝 구간 길이만큼 뒤처진 조각까지만 내보낸다
    const keepFrom = this.traveled - ribbonLen(RIBBON.end, this.width());
    let n = 0;
    while (n < this.queue.length && this.queue[n].arc <= keepFrom) n++;
    return this.queue.splice(0, n).map((q) => this.settle(q.d, q.arc));
  }

  /** 호 길이 a 의 경로 위 점(조각 중심 사이 선형 보간) */
  private pointAt(a: number): { x: number; y: number } {
    const P = this.pts;
    let lo = 0;
    let hi = P.length - 1;
    if (a <= P[0].arc) return P[0];
    if (a >= P[hi].arc) return P[hi];
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (P[m].arc <= a) lo = m;
      else hi = m;
    }
    const t = (a - P[lo].arc) / Math.max(1e-9, P[hi].arc - P[lo].arc);
    return { x: P[lo].x + (P[hi].x - P[lo].x) * t, y: P[lo].y + (P[hi].y - P[lo].y) * t };
  }

  /**
   * 조각을 확정한다 — 방향 = 앞뒤 폭 20% 구간의 현(대칭이라 꺾일 때 늦게 돌지 않고, 입력 이벤트마다의
   * 잔꺾임은 평균된다), 급한 꺾임에선 단면을 1/cos(꺾임/2) 만큼 넓혀(최대 1.5배) 폭이 줄지 않게.
   * 앞 확정 조각의 단면을 이음 띠의 왼쪽 변으로 붙인다(2026-10-08 사용자 «꺾이는 부분이 너무 얇아짐»
   * — 한쪽 지연 평활은 모서리를 얇게, 지연 0 은 이벤트마다 계단을 만들었다).
   * 내보내기는 펜보다 끝 구간(획 폭)만큼 뒤라 «앞쪽» 경로가 이미 있다.
   */
  private settle(d: Dab, arc: number): Dab {
    if (this.pts.length > 1) {
      // 앞뒤 폭 35% — 20% 는 꺾임 꼭짓점에서 몇 조각 만에 휙 돌아 각졌다(2026-10-08 낙서 실측)
      const h = this.width() * 0.35;
      const p0 = this.pointAt(arc - h);
      const pc = this.pointAt(arc);
      const p1 = this.pointAt(arc + h);
      const li = Math.hypot(pc.x - p0.x, pc.y - p0.y);
      const lo = Math.hypot(p1.x - pc.x, p1.y - pc.y);
      // 방향이 아니라 «축»으로 평균(각도 2배 평균) — 실제 납작붓은 왔다 갔다 문지를 때 180° 돌지 않는다.
      // 방향으로 평균하면 되돌림마다 단면이 반 바퀴 돌며 부채꼴·너트 모양이 생겼다(2026-10-08 사용자 낙서).
      let sx = 0;
      let sy = 0;
      const ti = Math.atan2(pc.y - p0.y, pc.x - p0.x);
      const to = Math.atan2(p1.y - pc.y, p1.x - pc.x);
      if (li > 1e-3) {
        sx += Math.cos(2 * ti) * li;
        sy += Math.sin(2 * ti) * li;
      }
      if (lo > 1e-3) {
        sx += Math.cos(2 * to) * lo;
        sy += Math.sin(2 * to) * lo;
      }
      if (sx * sx + sy * sy > 1e-9) {
        let rot = Math.atan2(sy, sx) / 2;
        // 앞 단면과 같은 쪽을 향하게(축은 π 주기) — 반대로 잡히면 이음 띠가 X 자로 꼬인다
        if (this.lastOut) {
          const dd = Math.atan2(Math.sin(rot - this.lastOut.rot), Math.cos(rot - this.lastOut.rot));
          if (Math.abs(dd) > Math.PI / 2) rot += Math.PI;
        }
        d.rotation = rot;
      }
      if (li > 1e-3 && lo > 1e-3) {
        // 축 사이 각(0~90°)만큼 마이터 보정 — 꺾임에서 폭 유지, 되돌림(축 같음)은 보정 없음
        let turn = Math.abs(ti - to) % Math.PI;
        turn = Math.min(turn, Math.PI - turn);
        d.size *= 1 / Math.cos(turn / 2);
      }
    }
    if (d.slice?.seg) {
      if (this.lastOut) d.slice = { ...d.slice, seg: { ...this.lastOut } };
      else d.slice = { u0: d.slice.u0, u1: d.slice.u1, len: d.slice.len };
    }
    this.lastOut = { x: d.x, y: d.y, rot: d.rotation, size: d.size };
    return d;
  }

  override preview(): Dab[] {
    const w = this.width();
    const total = this.traveled;
    if (!this.queue.length || total <= w * 0.25) return [];
    const e = Math.min(ribbonLen(RIBBON.end, w), total * 0.5);
    // end() 와 같은 계산 — 손을 떼도 화면이 안 바뀐다(프리뷰=최종). 확정 상태는 되돌린다.
    const keep = this.lastOut;
    const out = this.queue.map((q) =>
      this.settle({ ...q.d, slice: q.arc > total - e ? this.endSlice(q, total, e) : q.d.slice }, q.arc),
    );
    this.lastOut = keep;
    return out;
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
      if (q.arc > total - e) q.d.slice = this.endSlice(q, total, e);
      return this.settle(q.d, q.arc);
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
