/*
 * 도안 선 굵기·진하기(2026-10-27 사용자 «선따기 선의 선명도 조절 · 굵기도 · 더 진하게»).
 * 도안 레이어 원본은 그대로 두고(채우기 경계·저장 원본) 화면·내보내기용 사본만 만든다.
 *  - 굵기 weight 0~3: 잉크(어두움×알파)가 가장 진한 이웃 픽셀을 옮겨 오는 팽창을 weight 번
 *    (십자·네모 번갈아 = 팔각형 붓끝 — 네모만 쓰면 대각선만 굵어진다). 한 번에 양옆 1px 씩.
 *  - 진하기 dark 1~3: 밝기·알파에 감마 — 흰 바탕은 그대로, 회색 안티앨리어싱과 연한 선이 검정 쪽으로.
 * 흰 바탕 도안(템플릿)·투명 바탕 도안 둘 다 같은 식으로 된다.
 */
export const LINE_WEIGHT_MAX = 3;
export const LINE_DARK_MAX = 3;

export function styleLineart(src: ImageData, weight: number, dark: number): ImageData {
  const { width: w, height: h } = src;
  let px = new Uint32Array(src.data.slice().buffer);
  const n = w * h;
  const inkOf = (p: Uint32Array) => {
    const ink = new Uint16Array(n);
    const b = new Uint8Array(p.buffer);
    for (let i = 0, q = 0; i < n; i++, q += 4) {
      const lum = (b[q] * 299 + b[q + 1] * 587 + b[q + 2] * 114) / 1000;
      ink[i] = ((255 - lum) * b[q + 3]) | 0; // 0~65025 → 비교용
    }
    return ink;
  };
  for (let pass = 0; pass < weight; pass++) {
    const ink = inkOf(px);
    const out = new Uint32Array(px);
    const square = pass % 2 === 1;
    for (let y = 0; y < h; y++) {
      const y0 = y > 0 ? -w : 0, y1 = y < h - 1 ? w : 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, x0 = x > 0 ? -1 : 0, x1 = x < w - 1 ? 1 : 0;
        let best = i, bi = ink[i];
        const t = (j: number) => { if (ink[j] > bi) { bi = ink[j]; best = j; } };
        t(i + x0); t(i + x1); t(i + y0); t(i + y1);
        if (square) { t(i + y0 + x0); t(i + y0 + x1); t(i + y1 + x0); t(i + y1 + x1); }
        if (best !== i) out[i] = px[best];
      }
    }
    px = out;
  }
  const b = new Uint8ClampedArray(px.buffer);
  if (dark > 1.001) {
    const lut = new Uint8Array(256), alut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      lut[v] = Math.round(255 * Math.pow(v / 255, dark));
      alut[v] = Math.round(255 * (1 - Math.pow(1 - v / 255, dark)));
    }
    for (let q = 0; q < b.length; q += 4) {
      b[q] = lut[b[q]]; b[q + 1] = lut[b[q + 1]]; b[q + 2] = lut[b[q + 2]]; b[q + 3] = alut[b[q + 3]];
    }
  }
  return new ImageData(b, w, h);
}
