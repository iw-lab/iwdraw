import type { BackendCaps, Dab, RGB } from "../types";
import { getTipCanvas, getTipEpoch, getTipPixels, unionDabBounds, type RendererBackend, type StrokeContext } from "./backend";
import { applyImpastoRelief, applyPaperGrain, applyPaperGrainLift, applyWetEdge, compositeGlaze, growRect, IMPASTO_REACH, type PxRect } from "./paper";
import type { TipKind } from "../brushes/BrushBase";
import { isRibbonTip } from "./ribbon";

/*
 * Canvas2DBackend: 크롬북 저사양/WebGL2 미지원 폴백.
 * 임시 스트로크 버퍼에 dab을 찍고, endStroke에서 레이어에 1회 합성(스트로크 내 겹침 방지).
 */
export class Canvas2DBackend implements RendererBackend {
  readonly caps: BackendCaps = { webgl2: false };

  private strokeBuf: HTMLCanvasElement;
  private strokeCtx: CanvasRenderingContext2D;
  private tipCache = new Map<TipKind, HTMLCanvasElement>();
  private tintCache = new Map<string, HTMLCanvasElement>();
  /** 틴트 스탬프의 수동 밉맵 체인(각 레벨 = 이전의 절반) — stampFor 참조 */
  private mipCache = new Map<string, HTMLCanvasElement[]>();
  private ctx: StrokeContext | null = null;
  private layerCtx: CanvasRenderingContext2D | null = null;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.strokeBuf = document.createElement("canvas");
    this.strokeBuf.width = width;
    this.strokeBuf.height = height;
    this.strokeCtx = this.strokeBuf.getContext("2d")!;
  }

  private tipEpoch = -1;

  private tip(kind: TipKind): HTMLCanvasElement {
    // AI 알파맵이 늦게 로드되면 epoch가 올라간다 → 팁·틴트 캐시 전체 무효화
    const epoch = getTipEpoch();
    if (epoch !== this.tipEpoch) {
      this.tipCache.clear();
      this.tintCache.clear();
      this.mipCache.clear();
      this.tipEpoch = epoch;
    }
    let t = this.tipCache.get(kind);
    if (!t) {
      t = getTipCanvas(kind);
      this.tipCache.set(kind, t);
    }
    return t;
  }

  /** 팁을 색으로 틴트한 스탬프(색상별 캐시) */
  private tinted(kind: TipKind, color: RGB): HTMLCanvasElement {
    const key = `${kind}:${color.r},${color.g},${color.b}`;
    let c = this.tintCache.get(key);
    if (!c) {
      const tip = this.tip(kind);
      c = document.createElement("canvas");
      c.width = tip.width;
      c.height = tip.height;
      const cx = c.getContext("2d")!;
      if (isRibbonTip(kind)) {
        // 띠 텍스처는 채널마다 뜻이 다르다(R 명암·G 하이라이트) — multiply 틴트면 G 가 색을 물들인다.
        // GL 셰이더(DAB_FS)와 같은 식을 픽셀로.
        cx.drawImage(tip, 0, 0);
        const img = cx.getImageData(0, 0, c.width, c.height);
        const d = img.data;
        const k = this.ctx?.streaks ?? 0;
        const dk = 1 - Math.max(color.r, color.g, color.b) / 255;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          const f = d[i] / 255;
          const hl = (d[i + 1] / 255) * k;
          const w = dk >= 0.6 ? Math.min(0.3, (1 - f) * 0.5 + hl * 0.5) * dk : Math.min(0.44, hl * 0.78);
          const m = dk >= 0.6 ? 1 : f;
          d[i] = color.r * m + (255 - color.r * m) * w;
          d[i + 1] = color.g * m + (255 - color.g * m) * w;
          d[i + 2] = color.b * m + (255 - color.b * m) * w;
        }
        cx.putImageData(img, 0, 0);
        this.tintCache.set(key, c);
        this.trimTintCache();
        return c;
      }
      // multiply 틴트: 팁의 밝기(셰이드 채널)가 물감 색의 명암으로 살아남는다(임파스토 줄무늬).
      // source-in은 밝기를 버리고 균일 색으로 채워 질감이 평평해진다.
      cx.drawImage(tip, 0, 0);
      cx.globalCompositeOperation = "multiply";
      cx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
      cx.fillRect(0, 0, c.width, c.height);
      cx.globalCompositeOperation = "destination-in";
      cx.drawImage(tip, 0, 0);
      // 어두운 색은 multiply로 명암이 사라진다(검정×무엇=검정) → 그때만 screen으로
      // 결을 밝게 "선택"(GL step(0.6, dk)과 동일 임계). 항상 섞으면 밝은 색까지 회색빛.
      const dk = 1 - Math.max(color.r, color.g, color.b) / 255;
      if (dk > 0.6) {
        // GL 셰이더와 같은 식을 픽셀로: lift = min(0.2, (1−f)·0.5)·dk, f = 팁 셰이드.
        //
        // ⚠️ 합성 연산(screen + destination-in)으로 하면 안 된다 — 두 가지가 동시에 깨진다:
        //  ① 폴라리티: 팁을 그대로 screen하면 밝은 몸통(f≈1)이 가장 밝아진다. GL은 반대로
        //     골(1−f)만 밝힌다. 연필 grain 팁은 순백(=골 없음)이라 GL 리프트가 0인데
        //     2D는 획 전체를 들어올렸다.
        //  ② 알파 제곱: 위에서 이미 destination-in을 한 번 했는데 여기서 또 하면 알파가
        //     a→a²가 된다(연필 심지 0.2 → 0.05). 이 둘이 겹쳐 2D 폴백의 검은 획이
        //     GL보다 2.3배 옅었다(2026-07-25 실측: 굵기 16 peak 2D 0.287 vs GL 0.675).
        // 픽셀 연산은 알파를 건드리지 않아 두 문제가 원천적으로 없다(캐시되므로 색당 1회).
        const shade = getTipPixels(kind).data;
        const img = cx.getImageData(0, 0, c.width, c.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          const lift = Math.min(0.2, (1 - shade[i] / 255) * 0.5) * dk;
          if (lift <= 0) continue;
          d[i] += (255 - d[i]) * lift;
          d[i + 1] += (255 - d[i + 1]) * lift;
          d[i + 2] += (255 - d[i + 2]) * lift;
        }
        cx.putImageData(img, 0, 0);
      }
      cx.globalCompositeOperation = "source-over";
      this.tintCache.set(key, c);
      this.trimTintCache();
    }
    return c;
  }

  /** 캐시 폭주 방지 */
  private trimTintCache(): void {
    if (this.tintCache.size > 48) {
      const first = this.tintCache.keys().next().value;
      if (first) {
        this.tintCache.delete(first);
        this.mipCache.delete(first);
      }
    }
  }

  /**
   * 이 dab 크기에 맞는 스탬프 — 필요하면 절반씩 줄인 밉맵 레벨을 쓴다.
   *
   * ⚠️ Canvas2D의 drawImage 축소는 2×2 탭짜리 필터라, 128px 입자 팁(연필 grain·크레용
   * rough)을 2~3px로 한 번에 줄이면 샘플 대부분이 팁의 구멍에 떨어져 획이 통째로
   * 증발한다 — 2D 폴백(웨일북·저사양 크롬북 경로)에서 굵기 2 연필이 점선이 되고
   * 농도가 GL의 절반이었다(2026-07-25 실측: 빈 열 36개, peak 0.14 vs GL 0.28).
   * GL은 generateMipmap으로 같은 문제를 이미 막아 뒀다(2026-07-13) — 그 2D판.
   * 축소비를 2배 이하로만 유지하면 박스 필터가 제대로 걸린다.
   */
  private stampFor(kind: TipKind, color: RGB, size: number): HTMLCanvasElement {
    const base = this.tinted(kind, color);
    if (size >= base.width / 2) return base;
    const key = `${kind}:${color.r},${color.g},${color.b}`;
    let chain = this.mipCache.get(key);
    if (!chain || chain[0] !== base) {
      chain = [base];
      this.mipCache.set(key, chain);
    }
    // 목표 크기 이상인 가장 작은 레벨까지만 지연 생성
    for (;;) {
      const last = chain[chain.length - 1];
      if (last.width <= 4 || last.width / 2 < size) break;
      const half = document.createElement("canvas");
      half.width = Math.max(2, last.width >> 1);
      half.height = Math.max(2, last.height >> 1);
      const hx = half.getContext("2d")!;
      hx.imageSmoothingQuality = "high";
      hx.drawImage(last, 0, 0, half.width, half.height);
      chain.push(half);
    }
    let pick = chain[0];
    for (const c of chain) if (c.width >= size) pick = c;
    return pick;
  }

  /** 띠 텍스처(가로로 긴 팁)의 축소 단계 — 정사각 팁과 달리 «높이»가 획 폭에 대응한다 */
  private sliceSource(kind: TipKind, color: RGB, size: number): HTMLCanvasElement {
    const base = this.tinted(kind, color);
    const key = `slice:${kind}:${color.r},${color.g},${color.b}`;
    let chain = this.mipCache.get(key);
    if (!chain || chain[0] !== base) {
      chain = [base];
      this.mipCache.set(key, chain);
    }
    for (;;) {
      const last = chain[chain.length - 1];
      if (last.height <= 4 || last.height / 2 < size) break;
      const half = document.createElement("canvas");
      half.width = Math.max(2, last.width >> 1);
      half.height = Math.max(2, last.height >> 1);
      const hx = half.getContext("2d")!;
      hx.imageSmoothingQuality = "high";
      hx.drawImage(last, 0, 0, half.width, half.height);
      chain.push(half);
    }
    let pick = chain[0];
    for (const c of chain) if (c.height >= size) pick = c;
    return pick;
  }

  beginStroke(ctx: StrokeContext): void {
    this.ctx = ctx;
    this.previewDabs = [];
    this.liveStale = true;
    this.liveDirty = null;
    this.layerCtx = (ctx.layerCanvas as HTMLCanvasElement).getContext("2d");
    this.strokeCtx.clearRect(0, 0, this.width, this.height);
    // 지우개는 스트로크 버퍼가 아니라 레이어에 직접(destination-out)
  }

  drawDabs(dabs: Dab[]): void {
    if (!this.ctx) return;
    const eraser = this.ctx.composite === "destination-out";
    this.drawDabsInto(eraser ? this.layerCtx! : this.strokeCtx, dabs);
    this.liveDirty = unionDabBounds(this.liveDirty, dabs);
  }

  /** 라이브 프리뷰 부분 갱신 — 지난 present 이후 바뀐 영역(없으면 그대로 재사용) */
  private liveDirty: PxRect | null = null;
  private liveStale = true;

  /** 아직 확정 안 된 꼬리(납작붓 끝 모양) — 표시에만 덧그리고 스트로크 버퍼엔 안 남긴다 */
  private previewDabs: Dab[] = [];
  setPreviewDabs(dabs: Dab[]): void {
    if (!this.ctx) return;
    // 지난 꼬리 자리도 다시 칠해야 지워진다
    this.liveDirty = unionDabBounds(unionDabBounds(this.liveDirty, this.previewDabs), dabs);
    this.previewDabs = dabs;
  }

  private drawDabsInto(target: CanvasRenderingContext2D, dabs: Dab[]): void {
    if (!this.ctx) return;
    // wash(MAX) 근사: Canvas2D엔 max 블렌드가 없어 source-over 누적을 쓴다.
    // 팁이 near-binary(스트릭≈1, 골≈0)라 over 누적≈union≈max로 질감이 유지되고,
    // 진하기는 strokeOpacity로 합성 시 1회 적용된다(실측: strokes-2d 스크린샷 검증).
    const eraser = this.ctx.composite === "destination-out";
    if (eraser) target.save();
    for (const dab of dabs) {
      const color = dab.color ?? this.ctx.color;
      // dab별 팁 오버라이드(글리터 별 글린트) — tintCache 키에 kind가 이미 포함돼 안전
      const s = dab.size;
      const stamp = this.stampFor(dab.tip ?? this.ctx.tip, color, s);
      target.save();
      // 수채는 팁 플래토 포화용으로 alpha>1을 보낼 수 있다 — globalAlpha에 1 초과
      // 대입은 "무시"(이전 값 유지)라 반드시 클램프
      target.globalAlpha = Math.min(1, dab.alpha);
      if (eraser) {
        target.globalCompositeOperation = "destination-out";
      } else if (this.ctx.composite === "lighter" && !this.ctx.wash) {
        // buildup+additive만 버퍼 내 가산. wash는 GL의 MAX와 짝 — 버퍼 안에서
        // lighter로 쌓으면 획 내부가 흰색으로 클리핑된다(글로우 실측: 속 빈 튜브).
        target.globalCompositeOperation = "lighter";
      }
      const seg = dab.slice?.seg;
      if (dab.slice && seg) {
        // 이음 띠 — GL 과 같은 사다리꼴(앞 단면 → 이 단면)을 삼각형 두 개로 나눠 각각 정확한 아핀 매핑.
        // 평행사변형 근사는 급한 꺾임(부채꼴 이음)에서 조각 사이가 비어 붓털이 부채살처럼 삐져나왔다(2026-10-08 실측).
        const src = this.sliceSource(dab.tip ?? this.ctx.tip, color, Math.max(s, seg.size));
        let turn = dab.rotation - seg.rot;
        turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
        if (turn < 0.12) {
          // 거의 곧은 구간 = 진행 방향으로 1.5px 겹친 사각 조각. 1px 남짓한 사다리꼴을 클립하면 경계마다
          // 반투명 안티에일리어싱이 겹쳐 덜 칠해져 회색·물결무늬가 났다(2026-10-08 ×3 확대 실측).
          const ax = dab.x - seg.x;
          const ay = dab.y - seg.y;
          const al = Math.hypot(ax, ay);
          const ext = 1.5;
          const dupp = (dab.slice.u1 - dab.slice.u0) / Math.max(1e-3, al);
          const u0 = Math.max(0, dab.slice.u0 - ext * dupp);
          const u1 = Math.min(1, dab.slice.u1 + ext * dupp);
          const hs = (s + seg.size) / 2;
          target.translate((seg.x + dab.x) / 2, (seg.y + dab.y) / 2);
          target.rotate(al > 1e-3 ? Math.atan2(ay, ax) : dab.rotation);
          const len = al + 2 * ext;
          target.drawImage(src, u0 * src.width, 0, Math.max(1, (u1 - u0) * src.width), src.height, -len / 2, -hs / 2, len, hs);
          target.restore();
          continue;
        }
        const n0x = -Math.sin(seg.rot) * seg.size * 0.5;
        const n0y = Math.cos(seg.rot) * seg.size * 0.5;
        const n1x = -Math.sin(dab.rotation) * s * 0.5;
        const n1y = Math.cos(dab.rotation) * s * 0.5;
        const su0 = dab.slice.u0 * src.width;
        const su1 = dab.slice.u1 * src.width;
        const H = src.height;
        // 꼭짓점: A(u0,0)=p0−n0 · B(u1,0)=p1−n1 · C(u1,1)=p1+n1 · D(u0,1)=p0+n0 — GL 셰이더와 같은 배치
        const A = [seg.x - n0x, seg.y - n0y, su0, 0];
        const B = [dab.x - n1x, dab.y - n1y, su1, 0];
        const Cq = [dab.x + n1x, dab.y + n1y, su1, H];
        const D = [seg.x + n0x, seg.y + n0y, su0, H];
        this.texTri(target, src, A, B, D); // globalAlpha·합성은 위 save 상태를 물려받는다
        this.texTri(target, src, D, B, Cq);
        target.restore();
        continue;
      }
      target.translate(dab.x, dab.y);
      target.rotate(dab.rotation);
      if (dab.slice) {
        // 띠 조각(리본 붓) — 텍스처 가로 구간만, 획 방향 길이 len × 폭 s
        const src = this.sliceSource(dab.tip ?? this.ctx.tip, color, s);
        const sx = dab.slice.u0 * src.width;
        const sw = Math.max(1, (dab.slice.u1 - dab.slice.u0) * src.width);
        target.drawImage(src, sx, 0, sw, src.height, -dab.slice.len / 2, -s / 2, dab.slice.len, s);
      } else {
        target.drawImage(stamp, -s / 2, -s / 2, s, s);
      }
      target.restore();
    }
    if (eraser) target.restore();
  }

  /**
   * 텍스처 삼각형 — 점 = [x, y, 원본 sx, 원본 sy]. 원본 삼각형을 대상 삼각형으로 보내는 아핀 변환을 걸고
   * 대상 삼각형(무게중심에서 0.6px 부풀림 — 이웃 삼각형과 안티에일리어싱 실선 방지)으로 잘라 그린다.
   */
  private texTri(t: CanvasRenderingContext2D, src: HTMLCanvasElement, p0: number[], p1: number[], p2: number[]): void {
    const ux = p1[2] - p0[2];
    const uy = p1[3] - p0[3];
    const vx = p2[2] - p0[2];
    const vy = p2[3] - p0[3];
    const det = ux * vy - vx * uy;
    if (Math.abs(det) < 1e-6) return;
    const pux = p1[0] - p0[0];
    const puy = p1[1] - p0[1];
    const pvx = p2[0] - p0[0];
    const pvy = p2[1] - p0[1];
    const a = (pux * vy - pvx * uy) / det;
    const c = (pvx * ux - pux * vx) / det;
    const b = (puy * vy - pvy * uy) / det;
    const d = (pvy * ux - puy * vx) / det;
    const e = p0[0] - a * p0[2] - c * p0[3];
    const f = p0[1] - b * p0[2] - d * p0[3];
    const cx = (p0[0] + p1[0] + p2[0]) / 3;
    const cy = (p0[1] + p1[1] + p2[1]) / 3;
    const grow = (p: number[]) => {
      const dx = p[0] - cx;
      const dy = p[1] - cy;
      const l = Math.hypot(dx, dy) || 1;
      return [p[0] + (dx / l) * 0.6, p[1] + (dy / l) * 0.6];
    };
    const [q0, q1, q2] = [grow(p0), grow(p1), grow(p2)];
    t.save();
    t.beginPath();
    t.moveTo(q0[0], q0[1]);
    t.lineTo(q1[0], q1[1]);
    t.lineTo(q2[0], q2[1]);
    t.closePath();
    t.clip();
    t.transform(a, b, c, d, e, f);
    const sx0 = Math.max(0, Math.floor(Math.min(p0[2], p1[2], p2[2])) - 1);
    const sx1 = Math.min(src.width, Math.ceil(Math.max(p0[2], p1[2], p2[2])) + 1);
    t.drawImage(src, sx0, 0, Math.max(1, sx1 - sx0), src.height, sx0, 0, Math.max(1, sx1 - sx0), src.height);
    t.restore();
  }

  private liveBuf: CanvasRenderingContext2D | null = null;

  presentStroke(target: CanvasRenderingContext2D): void {
    if (!this.ctx) return;
    // 지우개는 레이어에 직접 그려져 이미 실시간으로 보임
    if (this.ctx.composite === "destination-out") return;
    // 종이 결·임파스토를 프리뷰에도 실시간 적용("떼는 순간 질감·명암이 변하는" 팝인 제거)
    let src: HTMLCanvasElement = this.strokeBuf;
    if (this.ctx.paperGrain > 0 || this.ctx.impasto > 0 || this.previewDabs.length) {
      if (!this.liveBuf) {
        const c = document.createElement("canvas");
        c.width = this.width;
        c.height = this.height;
        this.liveBuf = c.getContext("2d")!;
      }
      // 바뀐 영역만 다시 만든다 — 매 프레임 캔버스 전체 임파스토·결은 저사양에서 프레임당 100ms+
      // (2026-10-08 CPU 4배 감속 실측, 사용자 «중간중간 끊긴다»). 릴리프는 둘레까지 번지니 그만큼 넓힌다.
      const L = this.liveBuf;
      const reach = this.ctx.impasto > 0 ? IMPASTO_REACH : 1;
      // 획 시작 = 버퍼가 비어 있으니 지우기만 하고, 그다음부터는 dab 이 닿은 곳만
      if (this.liveStale) L.clearRect(0, 0, this.width, this.height);
      const R = this.liveDirty && growRect(this.liveDirty, reach, this.width, this.height);
      if (R && R.w > 0 && R.h > 0) {
        const part = R;
        L.clearRect(R.x, R.y, R.w, R.h);
        L.drawImage(this.strokeBuf, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
        if (this.previewDabs.length) {
          L.save();
          L.beginPath();
          L.rect(R.x, R.y, R.w, R.h);
          L.clip();
          this.drawDabsInto(L, this.previewDabs);
          L.restore();
        }
        // endStroke와 같은 순서(임파스토 → 종이 결) — 프리뷰=최종
        if (this.ctx.impasto > 0)
          applyImpastoRelief(L, this.width, this.height, this.ctx.impasto, this.ctx.impastoShadow, part);
        if (this.ctx.paperGrain > 0) this.grain(L, part);
      }
      this.liveStale = false;
      this.liveDirty = null;
      src = L.canvas;
    }
    if (this.ctx.composite === "glaze") {
      compositeGlaze(target, src, this.width, this.height);
      return;
    }
    target.save();
    target.globalAlpha = this.ctx.strokeOpacity; // wash 획 전체 불투명도(프리뷰=최종)
    target.globalCompositeOperation =
      this.ctx.composite === "multiply"
        ? "multiply"
        : this.ctx.composite === "darken"
          ? "darken"
          : this.ctx.composite === "lighter"
            ? "lighter"
            : "source-over";
    target.drawImage(src, 0, 0);
    target.restore();
  }

  /** 종이 결 적용 — 불투명 매체(grainLift)는 백화, 그 외는 알파 침식(라이브/최종 공용) */
  private grain(target: CanvasRenderingContext2D, rect?: PxRect): void {
    const c = this.ctx!;
    if (c.grainLift) {
      const dk = 1 - Math.max(c.color.r, c.color.g, c.color.b) / 255;
      applyPaperGrainLift(target, this.width, this.height, c.paperGrain, c.paperKind, dk, rect);
    } else {
      applyPaperGrain(target, this.width, this.height, c.paperGrain, c.paperKind, rect);
    }
  }

  endStroke(): void {
    if (!this.ctx || !this.layerCtx) return;
    this.previewDabs = []; // 꼬리는 brush.end() 가 확정 dab 으로 이미 그렸다
    if (this.ctx.composite === "destination-out") {
      this.ctx = null;
      return; // 지우개는 이미 레이어에 직접 반영됨
    }
    // wet edge(실루엣 가장자리 안료 몰림) → 종이 결 순서로 후처리
    // (종이 결은 presentStroke 라이브 경로와 동일 — 프리뷰=최종)
    if (this.ctx.wetEdge > 0) {
      applyWetEdge(this.strokeCtx, this.width, this.height, this.ctx.wetEdge, this.ctx.paperKind);
    }
    if (this.ctx.impasto > 0) {
      applyImpastoRelief(this.strokeCtx, this.width, this.height, this.ctx.impasto, this.ctx.impastoShadow);
    }
    if (this.ctx.paperGrain > 0) this.grain(this.strokeCtx);
    // 스트로크 버퍼를 레이어에 1회 합성 — 브러시 composite 반영(라이브 프리뷰와 동일해야 함)
    if (this.ctx.composite === "glaze") {
      compositeGlaze(this.layerCtx, this.strokeBuf, this.width, this.height);
      this.ctx = null;
      return;
    }
    this.layerCtx.save();
    this.layerCtx.globalAlpha = this.ctx.strokeOpacity;
    this.layerCtx.globalCompositeOperation =
      this.ctx.composite === "multiply"
        ? "multiply"
        : this.ctx.composite === "darken"
          ? "darken"
          : this.ctx.composite === "lighter"
            ? "lighter"
            : "source-over";
    this.layerCtx.drawImage(this.strokeBuf, 0, 0);
    this.layerCtx.restore();
    this.ctx = null;
  }

  cancelStroke(): void {
    // 스트로크 버퍼는 다음 beginStroke가 클리어. 지우개(레이어 직접)는 취소 불가 —
    // 호출측(ArtEngine)이 destination-out 브러시에서 QuickShape를 막는다.
    this.previewDabs = [];
    this.ctx = null;
  }

  tick(): boolean {
    return false; // 시간 진행 시뮬 없음
  }

  dispose(): void {
    this.tipCache.clear();
    this.tintCache.clear();
  }
}
