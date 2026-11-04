/*
 * 모래판 → 화면 색. 라이트박스 = 아래에서 빛이 올라오는 유리판.
 *   두꺼운 모래 = 모래색(위에서 비친 은은한 볼록함) · 얇으면 빛이 새어 노을빛 · 없으면 환한 빛
 * 바뀐 사각형만 다시 칠한다(손가락 한 번 = 손 둘레 몇천 칸).
 */
import { SandSim } from "./SandSim";

export type RGB = [number, number, number];

export interface SandLook {
  /** 빛 색(유리판) */
  light: RGB;
  /** 모래 색 */
  sand: RGB;
}

export const LIGHTS: { id: string; label: string; rgb: RGB }[] = [
  { id: "warm", label: "노을빛", rgb: [255, 214, 140] },
  { id: "white", label: "하얀 빛", rgb: [252, 248, 236] },
  { id: "sky", label: "하늘빛", rgb: [150, 214, 255] },
  { id: "pink", label: "분홍빛", rgb: [255, 170, 205] },
  { id: "green", label: "풀빛", rgb: [178, 238, 160] },
];

export const SANDS: { id: string; label: string; rgb: RGB }[] = [
  { id: "dark", label: "검은 모래", rgb: [34, 26, 20] },
  { id: "brown", label: "갈색 모래", rgb: [96, 64, 38] },
  { id: "navy", label: "밤 모래", rgb: [26, 34, 72] },
];

/** 두께 → 빛이 새는 비율. exp 를 칸마다 부르지 않게 표로 */
const LUT_N = 1024;
const LUT_MAX = 8;
const TRANS = new Float32Array(LUT_N + 1);
for (let i = 0; i <= LUT_N; i++) TRANS[i] = Math.exp(-2.3 * ((i / LUT_N) * LUT_MAX));

export class SandRender {
  readonly img: ImageData;
  private vig: Float32Array;
  constructor(
    private sim: SandSim,
    private grain: Uint8Array,
    public look: SandLook,
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
  }

  /** 사각형 [x0,x1)×[y0,y1) 을 img 에 칠한다 */
  paint(x0: number, y0: number, x1: number, y1: number): void {
    const { w, h, H } = this.sim;
    const g = this.grain;
    const px = this.img.data;
    const vig = this.vig;
    const [lr, lg, lb] = this.look.light;
    const [sr, sg, sb] = this.look.sand;
    for (let y = y0; y < y1; y++) {
      const up = y > 0 ? -w : 0;
      const dn = y < h - 1 ? w : 0;
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const hv = H[i];
        const gr = g[i] * (1 / 255);
        // 얇은 곳은 낱알 결이 드러난다(두께를 칸마다 0.6~1.4배로 흔든다)
        const he = hv * (0.6 + 0.8 * gr);
        const li = he >= LUT_MAX ? LUT_N : ((he * (LUT_N / LUT_MAX)) | 0);
        const T = TRANS[li];
        // 볼록함: 왼쪽 위에서 비친 방 불빛 — 두꺼운 둑의 윗면이 밝고 아랫면이 어둡다
        const gx = H[x < w - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i];
        const gy = H[i + dn] - H[i + up];
        let sh = 1 - (gx + gy) * 0.55;
        sh = sh < 0.55 ? 0.55 : sh > 1.7 ? 1.7 : sh;
        const sk = sh * (0.82 + 0.36 * gr);
        const v = vig[i] * T;
        const o = 1 - T;
        const j = i * 4;
        px[j] = sr * sk * o + lr * v;
        px[j + 1] = sg * sk * o + lg * v;
        px[j + 2] = sb * sk * o + lb * v;
        px[j + 3] = 255;
      }
    }
  }

  paintAll(): void {
    this.paint(0, 0, this.sim.w, this.sim.h);
  }
}
