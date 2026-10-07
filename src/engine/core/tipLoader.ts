import { setTipOverride } from "./backend";
import type { TipKind } from "../brushes/BrushBase";

/*
 * AI 생성 브러시 팁 알파맵 로더.
 * public/brush-tips/<kind>.png = 검은 배경 + 흰 붓결 → luminance를 알파로 변환해
 * 프로시저럴 팁을 대체한다. 로드 실패/미존재 시 조용히 프로시저럴 유지(폴백).
 */

const TIP_FILES: Partial<Record<TipKind, string>> = {
  bristle: "/brush-tips/bristle.png",
};

/** luminance→alpha 변환 + 노이즈 플로어 컷 + 원형 클램프(텍스처 가장자리 번짐 방지) */
function toAlphaMap(img: HTMLImageElement, size = 256): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size);
  const px = d.data;
  const r = size / 2;
  const FLOOR = 24; // 생성 이미지의 "거의 검정" 노이즈 제거(없으면 획이 사각 리본이 됨)
  // 붓털별 명암 밴드(가로 10줄): AI 맵의 헤어라인 명암은 축소 시 사라지므로,
  // 굵은 톤 밴드를 곱해 넓은 획에서도 임파스토 줄무늬가 보이게 한다(고정 시드 LCG)
  const BANDS = 12;
  let seed = 41;
  // 어두운 밴드만 — 밝은 하이라이트 밴드를 팁에 섞으면 모든 색이 회색빛(검정 실측).
  // 색 일관성(평균)과 붓결 대비(분산)는 분리해서 조절한다: 대부분 중립 + 4줄만
  // 깊은 골(0.60~0.72) 바이모달 — i-scream 유화 수준 골 대비. 깊은 줄은 고정
  // 인덱스(불균등 간격)로 보장 — 시드 난수에 맡기면 개수가 들쭉날쭉(실측).
  const DEEP = new Set([1, 4, 6, 9]);
  const bandShade: number[] = [];
  for (let b = 0; b < BANDS; b++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const rnd = seed / 0x7fffffff;
    // 골 0.85~0.92 — i-scream은 질감을 어두운 골이 아니라 밝은 스트릭으로 표현
    // (2026-07-06 사용자 실측 "우리는 검은 느낌, 원본은 밝은 느낌") → 골은 은은하게만
    bandShade.push(DEEP.has(b) ? 0.85 + rnd * 0.07 : 0.96 + rnd * 0.04);
  }
  for (let y = 0; y < size; y++) {
    // 밴드 사이 선형 보간 — 경계가 기계적인 평행선으로 보이지 않게
    const t = (y / size) * BANDS - 0.5;
    const i0 = Math.max(0, Math.min(BANDS - 1, Math.floor(t)));
    const i1 = Math.min(BANDS - 1, i0 + 1);
    const fr = Math.max(0, Math.min(1, t - i0));
    const band = bandShade[i0] * (1 - fr) + bandShade[i1] * fr;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const lum = Math.max(px[i], px[i + 1], px[i + 2]);
      let a = lum <= FLOOR ? 0 : ((lum - FLOOR) / (255 - FLOOR)) * (px[i + 3] / 255) * 255;
      // 몸통 알파 포화(×1.18 클램프): AI 맵 몸통이 1 미만이면 겹친 획이 진해져
      // 불투명 물감이 아니라 반투명 마커로 읽힌다(i-scream 비교 실측 2026-07-06).
      // 0은 0으로 유지 — 가장자리/마른 끝 그라디언트 형태는 보존된다.
      a = Math.min(255, a * 1.18);
      // 깊은 골은 물감도 살짝 얇게(-4%) — 종이 결이 비쳐 마른 붓결이 산다.
      // ⚠️ 강한 알파 골(≥30%)은 wash에서 획 전체 흰 줄(bristle-bold 실측), -8%도
      // 검정에선 종이 흰 줄로 읽힌다(실기기 실측) — 지각 하한까지만.
      if (band < 0.8) a *= 0.96;
      // CLAMP_TO_EDGE 스머 방지: 반지름 0.94~1.0 구간에서 페이드아웃
      const dn = Math.hypot(x - r + 0.5, y - r + 0.5) / r;
      if (dn > 1) a = 0;
      else if (dn > 0.94) a *= 1 - (dn - 0.94) / 0.06;
      // 획 좌우 가장자리(팁 상하단) 물감 얇게 — 종이가 비쳐 밝은 테가 획 전체에
      // 이어진다(i-scream 유화). 실루엣 후처리(dryEdge)는 펜 뗄 때 팝인이라 금지
      // (2026-07-06 사용자 실측) — 팁에 베이크하면 그리는 중에도 동일(프리뷰=최종).
      // ⚠️ 내부 알파 골 금지 교훈과 별개: 최외곽 밴드(ny>0.78)에만 건다.
      const ny = Math.abs(y - r + 0.5) / r;
      if (ny > 0.78) {
        const et = Math.min(1, (ny - 0.78) / 0.22);
        a *= 1 - 0.45 * et * et * (3 - 2 * et);
      }
      // 셰이드 채널 = 밴드 톤 × 원본 밝기(0.92~1.0) — 물감 명암 줄무늬의 근원.
      // 두 계수의 곱이 평균 셰이드 → 색 밝기를 좌우하므로 합산 평균 ≈0.95 유지
      const shade = Math.round(255 * band * (0.92 + 0.08 * (lum / 255)));
      px[i] = px[i + 1] = px[i + 2] = shade;
      px[i + 3] = a;
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

let started = false;

/** 앱 수명당 1회 — 엔진 생성 시 호출. 로드 완료 시 epoch가 올라가 백엔드 캐시가 갱신된다. */
export function loadTipOverrides(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  for (const [kind, url] of Object.entries(TIP_FILES) as [TipKind, string][]) {
    const img = new Image();
    img.onload = () => {
      try {
        setTipOverride(kind, toAlphaMap(img));
      } catch {
        // tainted canvas 등 getImageData 실패 → 프로시저럴 폴백 유지
      }
    };
    img.src = url; // onerror 무시 → 프로시저럴 폴백 유지
  }
}
