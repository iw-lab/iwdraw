/*
 * 저사양 기기 렉 자동 계측(2026-11-10 사용자 «웨일북 저사양에서 렉이 아직도»).
 *
 * 왜: 웨일북 렉은 개발 맥(헤드리스·소프트웨어 렌더러)에서 재현되지 않는다(2026-09-01·11-10 조사 —
 * 프로파일 73%가 브라우저 내부 그리기라 실기기를 대변 못 함). 실기기 수치가 있어야 무엇을 줄일지 정한다.
 * 그래서 «그리는 동안» 프레임 간격을 재서 세션당 한 번 서버에 보낸다(사용자가 ?perf=1 을 켤 필요 없음).
 *
 * 보내는 것 = 기술 수치뿐(프레임 간격·백엔드·캔버스 크기·코어·메모리·OS 종류·붓). 별명·학급·그림·IP 없음.
 * 렉(p75 ≥ LAG_MS) 기기는 늘 보내고, 정상 기기는 비교용으로 BASE_RATE 만 보낸다.
 */
export const LAG_MS = 35;
export const BASE_RATE = 0.1;
/** 이만큼 «그리는 프레임»이 모이면 판정한다(획 몇 개 분량) */
export const MIN_FRAMES = 150;
const SENT_KEY = "arton.perf.sent";
/** 계측 시험(tests/e2e/perf-beacon.spec.ts)만 켜는 표식 */
export const TEST_KEY = "arton.perf.test";

export interface PerfInfo {
  backend?: string;
  brush?: string;
  layers?: number;
}

export function summarize(gaps: number[]) {
  const s = gaps.slice().sort((a, b) => a - b);
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0);
  return { n: s.length, med: q(0.5), p75: q(0.75), p90: q(0.9), max: Math.round(s[s.length - 1] ?? 0) };
}

export function shouldSend(p75: number, rnd: number): boolean {
  return p75 >= LAG_MS || rnd < BASE_RATE;
}

function osOf(ua: string): string {
  if (/CrOS/.test(ua)) return "cros";
  if (/Whale/.test(ua)) return "whale";
  if (/Android/.test(ua)) return "android";
  if (/iPad|iPhone|Macintosh/.test(ua)) return "apple";
  if (/Windows/.test(ua)) return "win";
  return "other";
}

/** 캔버스에 붙인다. 떼는 함수를 돌려준다 */
export function startPerfBeacon(canvas: HTMLCanvasElement, page: "draw" | "sand", info: () => PerfInfo): () => void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return () => {};
  try {
    if (sessionStorage.getItem(SENT_KEY)) return () => {};
    // 자동 시험 브라우저는 보내지 않는다 — 배포본 회귀 시험이 운영 표를 시험 수치로 채운다(계측 시험만 표식으로 켠다)
    if (navigator.webdriver && !localStorage.getItem(TEST_KEY)) return () => {};
  } catch {
    return () => {};
  }
  const gaps: number[] = [];
  let down = 0;
  let raf = 0;
  let last = 0;
  let done = false;
  const tick = () => {
    const now = performance.now();
    if (last) gaps.push(now - last);
    last = now;
    if (gaps.length >= MIN_FRAMES) return finish();
    raf = down > 0 ? requestAnimationFrame(tick) : 0; // gb-juice-ok 계측 틱(그리는 동안만)
  };
  const onDown = () => {
    down++;
    if (!raf && !done) {
      last = 0;
      raf = requestAnimationFrame(tick); // gb-juice-ok 계측 틱(그리는 동안만)
    }
  };
  const onUp = () => {
    down = Math.max(0, down - 1);
  };
  const finish = () => {
    if (done) return;
    done = true;
    stop();
    const sm = summarize(gaps);
    if (!shouldSend(sm.p75, Math.random())) return;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const i = info();
    const body = {
      page,
      ...sm,
      backend: i.backend ?? "",
      brush: i.brush ?? "",
      layers: i.layers ?? 0,
      bw: canvas.width,
      bh: canvas.height,
      cw: Math.round(canvas.clientWidth),
      ch: Math.round(canvas.clientHeight),
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      cores: nav.hardwareConcurrency ?? 0,
      mem: nav.deviceMemory ?? 0,
      os: osOf(nav.userAgent),
    };
    try {
      sessionStorage.setItem(SENT_KEY, "1");
      navigator.sendBeacon?.("/api/perf", new Blob([JSON.stringify(body)], { type: "application/json" }));
    } catch {
      /* 계측 실패는 그리기에 영향 없음 */
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    canvas.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  return () => {
    done = true;
    stop();
  };
}
