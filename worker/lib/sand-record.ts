/** 샌드아트 «그린 과정 기록» 상한(gzip) — 클라 RECORD_MAX(src/sand/sandRecord.ts) 와 같다 */
export const SAND_RECORD_MAX = 4 * 1024 * 1024;

/** 받은 바이트가 기록으로 받아도 되는가 — 클라 MIME 을 믿지 않고 gzip 머리(1f 8b)·크기만 본다.
 * 속 내용(JSON)은 보는 쪽(decodeRecord)이 검증한다 — 서버는 풀지 않는다(압축 폭탄을 서버에서 풀지 않게) */
export function isSandRecord(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 18 || buf.byteLength > SAND_RECORD_MAX) return false;
  const h = new Uint8Array(buf, 0, 3);
  return h[0] === 0x1f && h[1] === 0x8b && h[2] === 0x08;
}
