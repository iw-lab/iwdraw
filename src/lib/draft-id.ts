/** 그리기 세션마다 발급하는 dedup 토큰(작품 id 아님·서버에 노출 안 되는 랜덤값). 구형 웹뷰 폴백 포함. */
export function genDraftId(): string {
  try {
    const u = globalThis.crypto?.randomUUID?.();
    if (u) return u;
    // randomUUID가 없는 구형 웹뷰(비보안 컨텍스트 등) — getRandomValues는 대개 살아있다.
    const b = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
    if (b) return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  } catch {
    /* 폴백 */
  }
  // 최후 폴백. draft 토큰은 남의 작품을 지우지 못하고(자기 행 덮어쓰기뿐) 어떤 API로도 노출되지
  // 않지만, 추측 저항성이 낮으면 같은 학생 명의로 재입장한 사람이 충돌을 노릴 수 있어 폭을 넓힌다.
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}
