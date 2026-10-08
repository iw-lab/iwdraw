/*
 * 리본 붓(붓자국 그림을 획 경로에 입히는 유화) — 띠 텍스처 배치의 단일 진실원.
 *
 * public/brush-tips/oil-ribbon.png(2048×256, RGB = 물감 명암, A = 물감 유무)는
 * [시작 256 | 몸통 1536(가로 반복) | 끝 256] 세 구간으로 나뉜다. 끝 구간 = 획 폭 1배 —
 * 끝은 손을 뗄 때 채우므로 그 길이만큼 펜보다 늦게 그려진다(짧을수록 지연이 적다). scripts/process-ribbon.py 가 이 배치로 만든다.
 * 브러시(OilRibbon)는 지나온 거리로 구간 안의 위치를 고르고, 백엔드는 Dab.slice 로 그 조각만 그린다.
 */
export const RIBBON = {
  W: 2048,
  H: 256,
  start: [0, 256] as const,
  body: [256, 1792] as const,
  end: [1792, 2048] as const,
};

/** 띠 텍스처 팁인가 — R = 물감 명암(어둡게), G = 붓결 하이라이트(밝게), A = 물감 유무 */
export function isRibbonTip(tip: string | undefined): boolean {
  return tip === "ribbon" || tip === "ribbon-bold";
}

/** 텍스처 px → 획 px 배율은 «텍스처 높이 H ↔ 획 폭». 구간 길이(획 px) */
export function ribbonLen(region: readonly [number, number], strokeWidth: number): number {
  return ((region[1] - region[0]) / RIBBON.H) * strokeWidth;
}

/** 구간 안 비율 t(0~1) → 텍스처 u(0~1) */
export function ribbonU(region: readonly [number, number], t: number): number {
  return (region[0] + (region[1] - region[0]) * Math.min(1, Math.max(0, t))) / RIBBON.W;
}

/**
 * 로드 전·실패 시 대체 띠(코드 생성) — 같은 배치. 몸통 = 가로 붓결 줄무늬(가로 반복 이음매 없음),
 * 시작 = 둥글게 눌린 머리, 끝 = 줄마다 길이가 다른 마른 붓 꼬리. 고정 시드(로드마다 같은 붓).
 */
let fallback: HTMLCanvasElement | null = null;
export function makeRibbonFallback(): HTMLCanvasElement {
  if (fallback) return fallback;
  const { W, H } = RIBBON;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  let seed = 4111;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // 붓털 줄(4px 묶음)마다 명암·끝 길이·머리 들어감
  const rows = Math.ceil(H / 4);
  const shade = Array.from({ length: rows }, () => 0.82 + rnd() * 0.18);
  const tail = Array.from({ length: rows }, () => 0.35 + rnd() * 0.65);
  const head = Array.from({ length: rows }, () => rnd() * 0.25);
  for (let y = 0; y < H; y++) {
    const ny = Math.abs(y - H / 2 + 0.5) / (H / 2); // 0 중심 ~ 1 가장자리
    const r = Math.floor(y / 4);
    for (let x = 0; x < W; x++) {
      let a = ny < 0.9 ? 1 : Math.max(0, 1 - (ny - 0.9) / 0.1);
      if (x < RIBBON.start[1]) {
        // 시작: 둥근 머리 + 줄마다 조금씩 늦게 닿는 붓털
        const t = x / (RIBBON.start[1] - RIBBON.start[0]);
        const edge = Math.sqrt(Math.max(0, 1 - ny * ny)) * 0.35 + head[r];
        a *= Math.min(1, Math.max(0, (t - (0.35 - edge * 0.9)) / 0.06));
      } else if (x >= RIBBON.end[0]) {
        const t = (x - RIBBON.end[0]) / (RIBBON.end[1] - RIBBON.end[0]);
        a *= Math.min(1, Math.max(0, (tail[r] - t) / 0.08));
        if (t > tail[r] * 0.55) a *= 0.75 + 0.25 * shade[r];
      }
      // 몸통 명암: 줄 명암 + 가로 주기(구간 길이로 나누어떨어지게) 미세 요동
      const wave = 0.03 * Math.sin((x / (RIBBON.body[1] - RIBBON.body[0])) * Math.PI * 2 * 4 + r);
      const v = Math.round(255 * Math.min(1, shade[r] + wave));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  fallback = c;
  return c;
}
