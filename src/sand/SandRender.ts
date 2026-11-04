/*
 * 모래판 → 화면 색. 라이트박스 = 아래에서 빛이 올라오는 유리판.
 *   두꺼운 모래 = 모래색(위에서 비친 은은한 볼록함) · 얇으면 빛이 새어 노을빛 · 없으면 환한 빛
 * 바뀐 사각형만 다시 칠한다(손가락 한 번 = 손 둘레 몇천 칸).
 */
import { SandSim } from "./SandSim";

export type RGB = [number, number, number];

export interface SandLook {
  /** 빛 색(유리판) — light2 가 있으면 위(light) → 아래(light2)로 바뀌는 빛(노을 하늘처럼) */
  light: RGB;
  light2?: RGB;
  /** 모래 색 */
  sand: RGB;
}

export interface LightDef {
  id: string;
  label: string;
  rgb: RGB;
  /** 아래쪽 색 — 있으면 위→아래 빛 */
  rgb2?: RGB;
}

/* 2026-11-04 사용자 «빛 색도 더 다양하게» → 한 색 8 + 위아래로 바뀌는 빛 3(검은 모래 실루엣이 노을·밤하늘 위에 서는 장면) */
export const LIGHTS: LightDef[] = [
  { id: "warm", label: "노을빛", rgb: [255, 214, 140] },
  { id: "white", label: "하얀 빛", rgb: [252, 248, 236] },
  { id: "yellow", label: "햇빛", rgb: [255, 236, 128] },
  { id: "orange", label: "주황빛", rgb: [255, 168, 92] },
  { id: "pink", label: "분홍빛", rgb: [255, 170, 205] },
  { id: "violet", label: "보랏빛", rgb: [206, 172, 255] },
  { id: "sky", label: "하늘빛", rgb: [150, 214, 255] },
  { id: "green", label: "풀빛", rgb: [178, 238, 160] },
  { id: "sunset", label: "노을 하늘", rgb: [255, 122, 92], rgb2: [255, 222, 128] },
  { id: "dawn", label: "새벽 하늘", rgb: [140, 196, 255], rgb2: [255, 196, 214] },
  { id: "night", label: "밤하늘", rgb: [72, 98, 200], rgb2: [196, 152, 240] },
];

/* 2026-11-04 사용자 «모래색도 더 다양하게» */
export const SANDS: { id: string; label: string; rgb: RGB }[] = [
  { id: "dark", label: "검은 모래", rgb: [34, 26, 20] },
  { id: "brown", label: "갈색 모래", rgb: [96, 64, 38] },
  { id: "gold", label: "금빛 모래", rgb: [138, 102, 40] },
  { id: "red", label: "붉은 흙", rgb: [118, 44, 30] },
  { id: "forest", label: "숲 모래", rgb: [32, 70, 42] },
  { id: "navy", label: "밤 모래", rgb: [26, 34, 72] },
  { id: "plum", label: "보라 모래", rgb: [66, 36, 82] },
  { id: "stone", label: "돌가루", rgb: [74, 74, 78] },
];

/** 고른 빛·모래 id → 화면 색(없는 id 면 첫째) */
export function lookOf(lightId: string, sandId: string): SandLook {
  const l = LIGHTS.find((x) => x.id === lightId) ?? LIGHTS[0];
  const s = SANDS.find((x) => x.id === sandId) ?? SANDS[0];
  return { light: l.rgb, light2: l.rgb2, sand: s.rgb };
}

/** 두께 → 빛이 새는 비율. exp 를 칸마다 부르지 않게 표로 */
const LUT_N = 1024;
const LUT_MAX = 8;
const TRANS = new Float32Array(LUT_N + 1);
for (let i = 0; i <= LUT_N; i++) TRANS[i] = Math.exp(-2.3 * ((i / LUT_N) * LUT_MAX));

export class SandRender {
  readonly img: ImageData;
  private vig: Float32Array;
  /** 칸마다 빛 색(가장자리 어둡게 포함) — 위아래 빛 때문에 칸마다 다르다. setLook 이 다시 만든다 */
  private lmap: Uint8ClampedArray;
  private _look!: SandLook;
  constructor(
    private sim: SandSim,
    private grain: Uint8Array,
    look: SandLook,
  ) {
    // 시험(jsdom)에는 ImageData 가 없다 — 같은 모양의 객체로 대신한다
    this.img =
      typeof ImageData !== "undefined"
        ? new ImageData(sim.w, sim.h)
        : ({ data: new Uint8ClampedArray(sim.w * sim.h * 4), width: sim.w, height: sim.h } as ImageData);
    // 유리판 가운데가 조금 더 밝다(가장자리 0.72배) — 평평한 단색 빛은 화면 배경처럼 보인다
    const { w, h } = sim;
    this.vig = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = (x / (w - 1)) * 2 - 1;
        const ny = (y / (h - 1)) * 2 - 1;
        const r2 = (nx * nx + ny * ny) / 2;
        this.vig[y * w + x] = 1 - 0.28 * r2;
      }
    }
    this.lmap = new Uint8ClampedArray(w * h * 3);
    this.look = look;
  }

  get look(): SandLook {
    return this._look;
  }
  set look(l: SandLook) {
    this._look = l;
    const { w, h } = this.sim;
    const [r1, g1, b1] = l.light;
    const [r2, g2, b2] = l.light2 ?? l.light;
    const m = this.lmap;
    for (let y = 0; y < h; y++) {
      const t = h > 1 ? y / (h - 1) : 0;
      const r = r1 + (r2 - r1) * t, g = g1 + (g2 - g1) * t, b = b1 + (b2 - b1) * t;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = this.vig[i];
        m[i * 3] = r * v;
        m[i * 3 + 1] = g * v;
        m[i * 3 + 2] = b * v;
      }
    }
  }

  /** 사각형 [x0,x1)×[y0,y1) 을 img 에 칠한다 */
  paint(x0: number, y0: number, x1: number, y1: number): void {
    const { w, h, H } = this.sim;
    const g = this.grain;
    const px = this.img.data;
    const lm = this.lmap;
    const [sr, sg, sb] = this._look.sand;
    for (let y = y0; y < y1; y++) {
      const up = y > 0 ? -w : 0;
      const dn = y < h - 1 ? w : 0;
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const hv = H[i];
        const gr = g[i] * (1 / 255);
        // 얇은 곳은 낱알 결이 드러난다(두께를 칸마다 0.45~1.55배로 흔든다 — 가장자리가 «모래알»로 부서져 보이게)
        const he = hv * (0.45 + 1.1 * gr);
        const li = he >= LUT_MAX ? LUT_N : ((he * (LUT_N / LUT_MAX)) | 0);
        const T = TRANS[li];
        // 볼록함: 왼쪽 위에서 비친 방 불빛 — 은은하게만. 세게(0.55·최대 1.7배) 두면 둑 가장자리가
        // 주황빛으로 볼록 튀어 «찰흙»처럼 보였다(2026-11-04 사용자 폰 화면). 라이트박스 위 모래는 거의 평평한 그림자다
        const gx = H[x < w - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i];
        const gy = H[i + dn] - H[i + up];
        let sh = 1 - (gx + gy) * 0.28;
        sh = sh < 0.75 ? 0.75 : sh > 1.3 ? 1.3 : sh;
        const sk = sh * (0.76 + 0.48 * gr);
        const o = 1 - T;
        const j = i * 4;
        const k = i * 3;
        px[j] = sr * sk * o + lm[k] * T;
        px[j + 1] = sg * sk * o + lm[k + 1] * T;
        px[j + 2] = sb * sk * o + lm[k + 2] * T;
        px[j + 3] = 255;
      }
    }
  }

  paintAll(): void {
    this.paint(0, 0, this.sim.w, this.sim.h);
  }
}
