import type { BackendCaps, BlendMode, Dab, RGB } from "../types";
import type { TipKind, DabComposite } from "../brushes/BrushBase";
import type { PaperKind } from "./paper";

/*
 * RendererBackend: 브러시가 만든 백엔드 독립 Dab 스트림을 래스터화하는 추상.
 * WebGL2Backend와 Canvas2DBackend가 이 인터페이스를 구현 → 브러시는 백엔드를 모른다.
 * (DESIGN-REVIEW C: WebGL2/Canvas2D 이중 렌더패스 추상화)
 */

export interface StrokeContext {
  layerCanvas: HTMLCanvasElement | OffscreenCanvas;
  tip: TipKind;
  composite: DabComposite;
  color: RGB;
  /** 종이 결 침식 강도 0~1 — endStroke에서 스트로크 버퍼에 적용(0이면 생략) */
  paperGrain: number;
  /** 종이 종류(모드가 결정: 유화=linen, 수채=cotton, 그 외=smooth) */
  paperKind: PaperKind;
  /**
   * wash 누적: 스트로크 버퍼에 픽셀별 최대 알파만 유지(GL blendEquation MAX).
   * 겹침 포화로 팁 질감이 뭉개지는 것을 막는다 — 유화 붓결·수채 워시의 핵심.
   */
  wash: boolean;
  /** 스트로크 전체 불투명도(wash용, 합성 시 1회 적용) — buildup 브러시는 1 */
  strokeOpacity: number;
  /** 획 실루엣 가장자리 안료 몰림 강도 0~1(수채) — endStroke에서 applyWetEdge */
  wetEdge: number;
  /** 임파스토 릴리프 강도 0~1(유화) — endStroke에서 applyImpastoRelief */
  impasto: number;
  /** 종이 결을 색 백화로(불투명 유지, 유화) — false면 알파 침식(수채 등) */
  grainLift: boolean;
  /** 붓 방향 밝은 스트릭 강도 0~1(유화) — GL 전용(2D 폴백은 근사 생략) */
  streaks: number;
  /**
   * 수채 농담 구름 강도 0~1 — 캔버스 고정 저주파 노이즈로 색 농도만 요동(GL 전용).
   * 캔버스 고정·결정론이라 겹침 수렴(darken min)을 깨지 않는다.
   */
  washCloud: number;
  /**
   * 가장자리 요철 강도 0~1 — 알파<1인 팁 폴오프 영역만 캔버스 고정 노이즈로 침식(GL 전용).
   * 수채 워시의 스며든 실루엣. 내부(알파=1)는 불변이라 겹침 수렴 유지.
   */
  edgeNoise: number;
}

/*
 * 팁 오버라이드: AI 생성 알파맵(public/brush-tips/*)이 로드되면 프로시저럴 팁을 대체.
 * epoch로 백엔드 캐시(2D 캔버스/GL 텍스처)를 무효화한다.
 */
const tipOverrides = new Map<TipKind, HTMLCanvasElement>();
let tipEpoch = 0;

export function setTipOverride(kind: TipKind, canvas: HTMLCanvasElement): void {
  tipOverrides.set(kind, canvas);
  tipEpoch++;
}

export function getTipEpoch(): number {
  return tipEpoch;
}

/** 백엔드 공용 팁 소스 — 오버라이드 우선, 없으면 프로시저럴 */
export function getTipCanvas(kind: TipKind): HTMLCanvasElement {
  return tipOverrides.get(kind) ?? makeTipCanvas(kind);
}

export interface RendererBackend {
  readonly caps: BackendCaps;
  /** 스트로크 시작 — 백엔드가 임시 버퍼/셰이더 준비 */
  beginStroke(ctx: StrokeContext): void;
  /** Dab 배치 렌더 */
  drawDabs(dabs: Dab[]): void;
  /**
   * 진행 중 스트로크를 표시 캔버스에 라이브 프리뷰로 그린다(매 composite 프레임).
   * 스트로크가 없으면 no-op. endStroke 전에도 획이 즉시 보이게 하는 핵심.
   * ⚠️ wetEdge 후처리만 의도적으로 endStroke 전용 — "펜을 떼면 물감이 마르며
   * 가장자리가 배어나는" 연출. paperGrain·impasto는 프리뷰에도 적용(프리뷰=최종) —
   * 손 떼는 순간 질감·명암이 변하는 팝인은 버그로 읽힌다(2026-07-10 사용자 실측).
   * 지우개(destination-out) 처리는 구현체별로 다르다 —
   * Canvas2DBackend는 레이어에 직접 지워 이미 반영되므로 no-op,
   * WebGL2Backend는 스트로크 버퍼를 매 프레임 destination-out으로 합성한다.
   */
  presentStroke(target: CanvasRenderingContext2D): void;
  /** 스트로크 종료 — 임시 버퍼를 (종이 결 침식 후) 레이어에 합성 */
  endStroke(): void;
  /**
   * 스트로크 폐기 — 임시 버퍼를 레이어에 합성하지 않고 버린다(QuickShape 스냅 시
   * 프리핸드 획 대체). 스트로크가 없으면 no-op(멱등). ⚠️ Canvas2D 지우개는 레이어에
   * 직접 그려 취소 불가 — 호출측이 destination-out 브러시에서 QuickShape를 막아야 한다.
   */
  cancelStroke(): void;
  /** rAF마다 호출되는 시간 진행 훅 — 현재 두 구현 모두 미사용(false). 향후 시뮬 확장용 */
  tick(dtMs: number): boolean;
  dispose(): void;
}

/**
 * 팁 하이라이트 스트릭 맵 — 붓 진행 방향(팁 x축)을 따라 끊어진 밝은 줄.
 * 셰이더가 색을 흰색 쪽으로 lift(알파 아님 — 불투명 유지). 밝은 값은 wash(MAX)에서
 * 살아남아 덧칠 내부에도 붓결이 유지된다(어두운 골은 MAX가 지움 — i-scream 비교 실측).
 * 고정 시드(색 게이트 결정론). bristle 계열만 — 그 외 팁은 빈 맵.
 */
const tipHlCache = new Map<TipKind, HTMLCanvasElement>();

export function makeTipHighlightCanvas(kind: TipKind, size = 128): HTMLCanvasElement {
  let c = tipHlCache.get(kind);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  if (kind === "wet") {
    // 수채 붓결 — bristle보다 훨씬 은은한 젖은 붓털 자국(rotationFollowsStroke로
    // 획 방향을 따라 이어진다). 진하면 "긁힌 자국"으로 읽히므로 가늘고 옅게.
    const r = size / 2;
    let seed = 211;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    ctx.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const yn = 0.14 + (i / 5) * 0.72; // 0.14~0.86
      const y = size * yn + (rand() - 0.5) * 6;
      const half = Math.sqrt(Math.max(0, r * r - (y - r) * (y - r)));
      if (half < 8) continue;
      ctx.lineWidth = 2 + rand() * 2.5;
      let x = r - half + rand() * 20;
      while (x < r + half - 6) {
        const seg = 18 + rand() * 34; // 긴 대시 — 물기가 끌린 자국
        const alpha = 0.1 + rand() * 0.22;
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(x, y + (rand() - 0.5) * 2);
        ctx.lineTo(Math.min(x + seg, r + half), y + (rand() - 0.5) * 2);
        ctx.stroke();
        x += seg + 8 + rand() * 20;
      }
    }
    tipHlCache.set(kind, c);
    return c;
  }
  if (kind === "bristle" || kind === "bristle-bold") {
    const r = size / 2;
    let seed = 137;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    ctx.lineCap = "round";
    // 8줄 — 붓털이 갈라지는 위/아래쪽이 진하고 중앙은 드물게
    for (let i = 0; i < 8; i++) {
      const yn = 0.1 + (i / 7) * 0.8; // 0.1~0.9
      const y = size * yn + (rand() - 0.5) * 5;
      const half = Math.sqrt(Math.max(0, r * r - (y - r) * (y - r)));
      if (half < 6) continue;
      const edgeBoost = 0.45 + Math.abs(yn - 0.5) * 1.1; // 가장자리 줄이 더 뚜렷
      ctx.lineWidth = 1.4 + rand() * 1.8;
      // 끊어진 대시 — 이어진 줄은 기계적(마른 붓털은 스치다 끊긴다)
      let x = r - half + rand() * 14;
      while (x < r + half - 4) {
        const seg = 10 + rand() * 26;
        const alpha = (0.22 + rand() * 0.5) * edgeBoost;
        ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.85, alpha)})`;
        ctx.beginPath();
        ctx.moveTo(x, y + (rand() - 0.5) * 2);
        ctx.lineTo(Math.min(x + seg, r + half), y + (rand() - 0.5) * 2);
        ctx.stroke();
        x += seg + 5 + rand() * 16;
      }
    }
  }
  tipHlCache.set(kind, c);
  return c;
}

/** 팁 종류 → 방사형 그라디언트 스탬프(공용, Canvas2D/WebGL 텍스처 소스) */
export function makeTipCanvas(tip: TipKind, size = 128): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const r = size / 2;

  switch (tip) {
    case "soft": {
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.7, "rgba(255,255,255,0.6)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      break;
    }
    case "wet": {
      // 수채: 워시 플래토 + "넓은" 가장자리 폴오프. rim(가장자리 안료 몰림)은 dab이 아니라
      // 획 실루엣 기준이어야 하므로 endStroke의 applyWetEdge 후처리가 담당한다.
      // (dab에 rim을 베이크하면 wash(MAX) 누적에서 dab별 고리가 사슬로 남는다 — 실측)
      // 폴오프 폭 주의(양쪽 다 실측 실패 이력):
      //  · 좁으면(0.9~1.0) 알파 부스트 ×1.35가 페이드를 1로 밀어올려 딱딱한 스티커 테두리.
      //  · 넓으면(0.55~1.0) 획 전체가 연기/에어브러시로 읽힘(2026-07-10 사용자 "이게 뭐야").
      // i-scream 수채는 경계가 분명한 평평한 워시 + 가장자리 몇 px만 부드러움 —
      // 플래토 0.8 + 0.8~1.0 페이드(부스트 후 유효 소프트 밴드 ~반경 12%)가 정답.
      // 유기적 요철은 셰이더 edgeNoise가 담당(페이드 폭이 아니라 침식으로).
      // granulation 구멍(240개)은 제거 — 부스트·paperGrain과 겹쳐 모래알 반점으로 읽힘(실측).
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, "rgba(255,255,255,0.94)");
      g.addColorStop(0.8, "rgba(255,255,255,0.94)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ink": {
      // 붓펜(먹): 진한 코어 + 진행 방향(x) 갈필 골. 골은 "중간 알파"로 깎는다 —
      // 살짝·빠르게 그으면(dab 알파 ~1) 골이 종이빛 갈필(비백)로 드러나고,
      // 꾹 누르면(알파 부스트, 셰이더 clamp) 골까지 포화돼 진한 먹이 된다.
      // rotationFollowsStroke로 골이 획 방향을 따라 이어진다(유화 bristle과 같은 원리).
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, "rgba(255,255,255,0.97)");
      g.addColorStop(0.86, "rgba(255,255,255,0.97)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fill();
      // 갈필 골 — 고정 시드(로드마다 배치가 바뀌면 질감 요동, 색 게이트 교훈).
      // 붓털이 갈라지는 위/아래 가장자리 골이 더 깊고, 중심축은 얕게(먹이 고이는 곳).
      let inkSeed = 41;
      const irand = () => {
        inkSeed = (inkSeed * 1103515245 + 12345) & 0x7fffffff;
        return inkSeed / 0x7fffffff;
      };
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round";
      for (let i = 0; i < 5; i++) {
        const yn = 0.1 + (i / 4) * 0.8; // 0.1~0.9
        const y = size * yn + (irand() - 0.5) * 4;
        const half = Math.sqrt(Math.max(0, r * r - (y - r) * (y - r)));
        if (half < 5) continue;
        const edge = Math.abs(yn - 0.5) * 2; // 0(중심)~1(가장자리)
        // 골 깊이 상한 0.62 — 더 깊으면 꾹 눌러도(알파 1.7 클램프) 골이 포화되지 않아
        // 모든 획이 갈필로 보인다. 0.62면 눌렀을 때 골 알파 ~0.85(먹), 스칠 때 ~0.45(갈필).
        const depth = 0.25 + edge * 0.35 + irand() * 0.08;
        ctx.strokeStyle = `rgba(0,0,0,${Math.min(0.62, depth)})`;
        // 획 굵기 30~60px 축소 + 밉맵 평균화를 견디려면 팁 기준 9px+ 필요(3~8px는 씻겨나감 실측)
        ctx.lineWidth = 9 + irand() * 7;
        // 끊어진 대시 — 이어진 골은 기계적(마른 붓털은 스치다 끊긴다)
        let x = r - half + irand() * 10;
        ctx.beginPath();
        while (x < r + half - 4) {
          const seg = 14 + irand() * 30;
          ctx.moveTo(x, y + (irand() - 0.5) * 2.5);
          ctx.lineTo(Math.min(x + seg, r + half), y + (irand() - 0.5) * 2.5);
          x += seg + 4 + irand() * 10;
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      break;
    }
    case "hard": {
      const g = ctx.createRadialGradient(r, r, r * 0.8, r, r, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "grain": {
      // 연필 흑연결: 아주 작은 입자를 촘촘히 — 가장자리로 갈수록 희박.
      // 코어 플래토: 1px 입자는 실제 연필 굵기(~14px)로 축소되면 서브픽셀로 사라져
      // 알파가 붕괴 → 진하기 100%가 회색(2026-07-06 사용자 실측). 낮은 알파의 심지가
      // buildup 누적으로 흑연 농도를 만들고, 입자는 결 질감을 담당한다.
      ctx.clearRect(0, 0, size, size);
      const core = ctx.createRadialGradient(r, r, 0, r, r, r);
      core.addColorStop(0, "rgba(255,255,255,0.2)");
      core.addColorStop(0.55, "rgba(255,255,255,0.14)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, size, size);
      const dots = Math.floor(size * size * 0.14);
      for (let i = 0; i < dots; i++) {
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * r;
        const x = r + Math.cos(a) * rad;
        const y = r + Math.sin(a) * rad;
        const fall = Math.pow(1 - rad / r, 0.6);
        ctx.fillStyle = `rgba(255,255,255,${fall * (0.62 + Math.random() * 0.38)})`;
        ctx.fillRect(x, y, 1.1, 1.1);
      }
      break;
    }
    case "rough": {
      // 크레용 왁스: 굵고 성긴 덩어리 입자 — 종이 요철에 왁스가 묻는 느낌.
      // 커버리지·알파 상향(0.018→0.03, 최저 0.35→0.55): 왁스답게 채도 꽉 차게 —
      // 흰 틈은 paperGrain 침식이 담당(연필=미세 입자, 크레용=왁스+종이 골 구분)
      ctx.clearRect(0, 0, size, size);
      const clumps = Math.floor(size * size * 0.03);
      for (let i = 0; i < clumps; i++) {
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * r * 0.95;
        const x = r + Math.cos(a) * rad;
        const y = r + Math.sin(a) * rad;
        const fall = Math.pow(1 - rad / r, 0.75);
        const s = 2.5 + Math.random() * 4.5;
        ctx.fillStyle = `rgba(255,255,255,${fall * (0.55 + Math.random() * 0.45)})`;
        ctx.beginPath();
        ctx.arc(x, y, s / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "chunk": {
      // 오일파스텔: 거의 꽉 찬 중심 + 부슬거리는 가장자리 — 진하고 크리미
      ctx.clearRect(0, 0, size, size);
      // 몸통 알파 1(불투명 매체) — 0.9~0.95는 겹친 획이 진해짐(유화와 동일 버그 클래스)
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.65, "rgba(255,255,255,1)");
      g.addColorStop(0.85, "rgba(255,255,255,0.4)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fill();
      // 가장자리 입자
      for (let i = 0; i < 140; i++) {
        const a = Math.random() * Math.PI * 2;
        const rad = r * (0.7 + Math.random() * 0.3);
        ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.5})`;
        ctx.fillRect(r + Math.cos(a) * rad, r + Math.sin(a) * rad, 2.2, 2.2);
      }
      // 크리미 스트릭(셰이드 채널, rotationFollowsStroke로 진행 방향을 따름) —
      // 민무늬 플래토는 "진한 마커"로 읽힌다(2026-07-06 사용자 실측) → 버터가 뭉개진
      // 명암 결. 고정 시드: 로드마다 결 배치가 바뀌면 평균 셰이드 요동(색 게이트 교훈)
      let chunkSeed = 59;
      const crand = () => {
        chunkSeed = (chunkSeed * 1103515245 + 12345) & 0x7fffffff;
        return chunkSeed / 0x7fffffff;
      };
      ctx.lineCap = "round";
      for (let i = 0; i < 7; i++) {
        const y = size * (0.14 + (i / 7) * 0.72) + (crand() - 0.5) * 6;
        const half = Math.sqrt(Math.max(0, r * r - (y - r) * (y - r))) * 0.9;
        if (half < 4) continue;
        const v = 208 + Math.floor(crand() * 26);
        ctx.strokeStyle = `rgba(${v},${v},${v},1)`;
        ctx.lineWidth = 2.5 + crand() * 3.5;
        ctx.beginPath();
        ctx.moveTo(r - half + crand() * half * 0.3, y);
        ctx.lineTo(r + half - crand() * half * 0.3, y + (crand() - 0.5) * 4);
        ctx.stroke();
      }
      break;
    }
    case "bristle-bold": {
      // 작은 획용 붓결 LOD(20~40px dab): 큰 bristle과 같은 "solid 중립 몸통 + 셰이드 붓결"
      // 구조. 붓결은 알파 구멍이 아니라 불투명 셰이드 줄로만 — destination-out 홈은
      // wash(MAX) 누적에서 획 전체에 이어지는 반투명 줄이 돼 종이가 흰 줄로 비친다(실측).
      // 행 전체를 어둡게(v=185~) 칠하는 것도 금지: multiply 틴트로 획이 통째로 회색빛(실측).
      ctx.clearRect(0, 0, size, size);
      ctx.lineCap = "round";
      // 고정 시드 LCG — Math.random()이면 행 배치·딥 개수가 로드마다 달라져
      // 평균 셰이드가 요동(굵기별 색 게이트 flaky 실측). 질감은 유지, 배치만 고정.
      let boldSeed = 73;
      const brand = () => {
        boldSeed = (boldSeed * 1103515245 + 12345) & 0x7fffffff;
        return boldSeed / 0x7fffffff;
      };
      const boldRows = 8;
      for (let i = 0; i < boldRows; i++) {
        const y = ((i + 0.5) / boldRows) * size + (brand() - 0.5) * 3;
        const half = Math.sqrt(Math.max(0, r * r - (y - r) * (y - r)));
        const jl = brand() * half * 0.35;
        const jr = brand() * half * 0.35;
        // 셰이드 채널(v<255 = 물감 명암). 딥 행은 고정 인덱스(3/8) — fine 팁 밴드와 정합.
        const deepRow = i === 1 || i === 4 || i === 6;
        // 골 옅게 — fine 팁(0.85~0.92 밴드)과 평균 셰이드 정합(색 게이트)
        const v = deepRow ? 218 + Math.floor(brand() * 16) : 246 + Math.floor(brand() * 10);
        // 획 좌우 가장자리 밝은 테 — fine 팁(tipLoader)과 동일 처리(색 게이트 정합)
        const bny = Math.abs(y - r) / r;
        const bEdgeK = bny > 0.78 ? 1 - 0.45 * Math.min(1, (bny - 0.78) / 0.22) : 1;
        ctx.strokeStyle = `rgba(${v},${v},${v},${bEdgeK})`;
        // 행 피치(size/8)보다 넓게 → 행 사이 알파 틈 없음(틈=종이 비침 흰 줄)
        ctx.lineWidth = size * 0.13 + brand() * size * 0.05;
        ctx.beginPath();
        ctx.moveTo(r - half + jl, y);
        ctx.lineTo(r + half - jr, y);
        ctx.stroke();
      }
      // 몸통 채움 — 큰 bristle의 solid 타원과 동일 역할(알파 구멍 방지). 좌우 끝은
      // 행의 jl/jr 지터가 너덜한 마른 붓끝을 만든다. 셰이드는 순백(255)이 아니라
      // fine 팁(바이모달 밴드) 중앙값과 같은 248(≈0.97) — wash MAX에서 튜브 중심은 이 타원이 항상
      // 이기므로, 255면 얇은 획만 순색이 돼 굵은 획과 색이 어긋난다(프로브 실측).
      ctx.fillStyle = "rgba(240,240,240,1)";
      ctx.beginPath();
      ctx.ellipse(r, r, r * 0.4, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 붓결 줄 4개: 불투명 셰이드(색이 살짝 어두워질 뿐 종이는 안 비침) — fine 팁의
      // 깊은 밴드(4줄, 0.60~0.72)와 면적·깊이를 맞춰 굵기 전환 시 평균 색이 같게 유지
      for (const gy of [0.26, 0.44, 0.6, 0.76]) {
        const y = size * gy;
        const half = Math.sqrt(Math.max(0, r * r - (y - r) * (y - r)));
        ctx.strokeStyle = "rgba(206,206,206,1)";
        ctx.lineWidth = size * 0.06;
        ctx.beginPath();
        ctx.moveTo(r - half * 0.9, y);
        ctx.lineTo(r + half * 0.9, y);
        ctx.stroke();
      }
      break;
    }
    case "sparkle": {
      // 글리터 별 글린트: 밝은 코어 + 십자 4갈래 플레어(+옅은 대각 플레어).
      // 둥근 원 입자는 "기포/물방울"로 읽힌다(2026-07-23 사용자 실측) — 반짝임의
      // 지각 신호는 점광원의 회절 스파이크(십자 광선)라 별 모양이 필수.
      // 축소(3~6px)되면 밉맵이 십자를 뭉개 살짝 트윙클한 점이 된다 — 잔입자에도 안전.
      ctx.clearRect(0, 0, size, size);
      const ray = (rot: number, sy: number, radius: number, a: number) => {
        ctx.save();
        ctx.translate(r, r);
        ctx.rotate(rot);
        ctx.scale(1, sy); // y 압축 → 가로로 긴 렌즈꼴 플레어(끝으로 갈수록 소멸)
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.55, `rgba(255,255,255,${a * 0.35})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      ray(0, 0.09, r, 1); // 가로 광선
      ray(Math.PI / 2, 0.09, r, 1); // 세로 광선
      ray(Math.PI / 4, 0.06, r * 0.55, 0.7); // 대각(짧고 옅게 — 8갈래는 과함)
      ray(-Math.PI / 4, 0.06, r * 0.55, 0.7);
      // 중심 코어 — 플레어 교차점의 점광원
      const core = ctx.createRadialGradient(r, r, 0, r, r, r * 0.2);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(0.5, "rgba(255,255,255,0.9)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(r, r, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "glow": {
      // 네온 단면: 중심 플래토(솔리드 코어) + 넓게 퍼지는 할로.
      // wash(MAX)에서 이 프로필이 그대로 튜브 단면이 된다 — 획 내부 균일이 전제.
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.3, "rgba(255,255,255,1)");
      g.addColorStop(0.42, "rgba(255,255,255,0.5)");
      g.addColorStop(0.7, "rgba(255,255,255,0.18)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      break;
    }
    case "flat": {
      // 마커 납작촉: 가로로 긴 라운드 사각 — 스트로크 방향으로 회전해 챠콜펜 느낌
      ctx.clearRect(0, 0, size, size);
      const w = size * 0.92;
      const h = size * 0.46;
      const x = (size - w) / 2;
      const y = (size - h) / 2;
      const rr = h / 2;
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x + rr, y + h);
      ctx.arc(x + rr, y + rr, rr, Math.PI / 2, (Math.PI * 3) / 2);
      ctx.fill();
      break;
    }
    case "bristle": {
      // 유화 붓결(near-binary): wash 누적에서 알파 패턴이 그대로 획이 되므로
      // 스트릭은 거의 불투명, 골은 완전히 빈다. 좌우 길이 차이 → 획 시작·끝의 마른 붓자국.
      ctx.clearRect(0, 0, size, size);
      ctx.lineCap = "round";
      const rows = 16;
      for (let i = 0; i < rows; i++) {
        const y = ((i + 0.5) / rows) * size + (Math.random() - 0.5) * 2.5;
        if (Math.random() < 0.12) continue; // 붓털 사이 빈 골(획 전체에 이어지는 줄)
        const half = Math.sqrt(Math.max(0, r * r - (y - r) * (y - r)));
        const jl = Math.random() * half * 0.5;
        const jr = Math.random() * half * 0.5;
        // 셰이드 바이모달: 깊은 골 행은 고정 인덱스(3/8) — Math.random() 확률 선택은
        // 페이지 로드마다 딥 행 개수가 달라져 평균 셰이드가 요동(색 게이트 flaky 실측)
        const deepRow = i === 1 || i === 4 || i === 6;
        // 골 옅게(216~) — 질감은 밝은 스트릭이 주도(fine 팁 밴드 0.85~0.92와 정합)
        const fv = deepRow ? 216 + Math.floor(Math.random() * 18) : 246 + Math.floor(Math.random() * 10);
        // 획 좌우 가장자리(팁 상하단 행) 물감 얇게 — 종이가 비쳐 밝은 테(i-scream).
        // 실루엣 후처리는 펜 뗄 때 팝인(사용자 실측) → 팁 베이크로 프리뷰=최종
        const ny = Math.abs(y - r) / r;
        const edgeK = ny > 0.78 ? 1 - 0.45 * Math.min(1, (ny - 0.78) / 0.22) : 1;
        ctx.strokeStyle = `rgba(${fv},${fv},${fv},${(0.82 + Math.random() * 0.18) * edgeK})`;
        ctx.lineWidth = 2.2 + Math.random() * 4.2;
        ctx.beginPath();
        ctx.moveTo(r - half + jl, y);
        ctx.lineTo(r + half - jr, y);
        ctx.stroke();
      }
      // 몸통은 꽉 차게 — 가장자리(위아래 행·좌우 끝)만 결이 갈라진다
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.beginPath();
      ctx.ellipse(r, r, r * 0.5, r * 0.68, 0, 0, Math.PI * 2);
      ctx.fill();
      // 흩날리는 얇은 털
      for (let i = 0; i < 6; i++) {
        const y = size * (0.08 + Math.random() * 0.84);
        const half = Math.sqrt(Math.max(0, r * r - (y - r) * (y - r)));
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const from = Math.random() < 0.5 ? r - half : r + half - 12;
        ctx.moveTo(from, y);
        ctx.lineTo(from + 12, y + (Math.random() - 0.5) * 3);
        ctx.stroke();
      }
      break;
    }
  }
  return c;
}

const tipPixelCache = new Map<TipKind, { img: ImageData; epoch: number }>();

/**
 * GL 업로드용 팁 픽셀(ImageData) — 알파 0 픽셀의 셰이드 채널(RGB)을 중립(255)으로 메운다.
 *
 * 셰이더는 t.r을 "물감 명암"(f)으로 읽어 col*f로 곱하는데, LINEAR 필터·밉맵은 알파와
 * 무관하게 RGB만 평균하므로 "안 그린" 텍셀(RGB=0=검정)이 이웃에 섞이면 f가 0쪽으로
 * 끌려가 색이 검게 죽는다.
 * · 크레용(rough): 텍셀 대부분이 알파 0인 성긴 입자 팁 → 팔레트 노랑(255,200,74)이
 *   (217,189,125) 올리브로 탁해졌다(2026-07-13 사용자 실측 "검은색이 섞여 있다").
 * · 마커(flat): dab 가장자리마다 검은 셰이드 테 → 획끼리 darken(min)이 그 테를 보존해
 *   같은 색을 덧칠해도 dab 실루엣이 테두리로 남는다(사용자 실측 "동그라미가 보인다").
 *
 * ⚠️ 캔버스에 되쓸 수 없다: 2D 캔버스는 premultiplied 저장이라 알파 0 픽셀의 RGB는
 * putImageData 즉시 0으로 소실된다(실측 — 캔버스에 메우는 1차 시도는 무효). 그래서
 * 캔버스가 아니라 GL에 올릴 픽셀 배열에서 메우고, texImage2D도 캔버스가 아닌 이
 * ImageData를 올린다(캔버스 소스는 브라우저가 다시 premultiply/unpremultiply 왕복).
 */
export function getTipPixels(kind: TipKind): ImageData {
  const epoch = getTipEpoch();
  const hit = tipPixelCache.get(kind);
  if (hit && hit.epoch === epoch) return hit.img;
  const c = getTipCanvas(kind);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) d[i] = d[i + 1] = d[i + 2] = 255;
  }
  tipPixelCache.set(kind, { img, epoch });
  return img;
}

export function blendToComposite(blend: BlendMode): GlobalCompositeOperation {
  switch (blend) {
    case "multiply":
      return "multiply";
    case "screen":
      return "screen";
    case "overlay":
      return "overlay";
    default:
      return "source-over";
  }
}
