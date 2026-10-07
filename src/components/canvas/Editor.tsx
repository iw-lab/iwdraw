"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { ArtEngine } from "@/engine/ArtEngine";
import { useEditor } from "@/store/editor";
import { exportPng, exportWebp, exportThumb } from "@/engine/export/PngExporter";
import { CanvasStage } from "./CanvasStage";
import { ModeTabs } from "./ModeTabs";
import { BrushBar } from "./BrushBar";
import { ColorPalette } from "./ColorPalette";
import { BrushControls } from "./BrushControls";
import { LayerPanel } from "./LayerPanel";
import { ActionRail } from "./ActionRail";
import { useKeyboard } from "./useKeyboard";
import { SuggestBar } from "./SuggestBar";
import { PendingStampBar } from "./PendingStampBar";
import { ArtonLogo } from "@/components/arton-logo";
import { Icon } from "./icons";
import { hasBackend } from "@/lib/backend";
import { takeEntryHint, takeSaveHint } from "@/lib/class-hint";

/* 성능 눈금은 ?perf=1 일 때만 내려받는다 — 평상시엔 번들 평가 비용도 0(교차검증 지적) */
const PerfHud = dynamic(() => import("./PerfHud").then((m) => m.PerfHud), { ssr: false });

/* 글씨 팔레트는 한글 웹폰트 6종의 CSS 를 끌고 온다 — 글씨를 안 쓰는 아이가 대부분인데
 * /draw 의 CSS 참조가 그 때문에 7개였다. 지연 로딩으로 2개로 줄인다.
 * ⚠️ 짝: 무비 재생은 글씨 도구를 안 열어도 글씨를 다시 그린다 →
 *    TextInsert.ensureTextFontsLoaded() 를 재생 직전에 부른다(MovieModal). */
const TextPalette = dynamic(() => import("./TextPalette").then((m) => m.TextPalette), {
  ssr: false,
});

/* 아래 넷도 첫 화면에 필요 없다 — 열 때 비로소 받는다.
 * MovieModal 은 타임랩스 인코더(TimelapseExporter)까지, PhotoImport 는 선따기 변환기
 * (photo-to-lineart, 42KB)까지 끌고 온다. StampPalette 는 스탬프 132종의 카탈로그.
 * ⚠️ 엔진이 직접 쓰는 StampTool/SketchMatch 는 그대로 둔다(획 처리 핫패스). */
const MovieModal = dynamic(() => import("./MovieModal").then((m) => m.MovieModal), { ssr: false });
const StampPalette = dynamic(() => import("./StampPalette").then((m) => m.StampPalette), {
  ssr: false,
});
const PhotoImport = dynamic(
  () => import("@/components/photo-import").then((m) => m.PhotoImport),
  { ssr: false },
);

export interface EditorProps {
  lineartSrc?: string;
  /** 그대로 이어 그리기 — 변환 없이 그림 레이어에 까는 원본 이미지 */
  baseSrc?: string;
  /** 진입마다 고유한 토큰(URL의 ?v=) — 같은 커스텀 이미지 URL 재진입 시 강제 재마운트용 */
  navKey?: string;
  initialMode?: import("@/engine/types").Mode;
  /**
   * 저장 콜백(학생 작품 제출) — 없으면 로컬 다운로드.
   * draftId = 이 그리기 세션의 익명 토큰. 서버가 같은 토큰의 자기 행을 덮어써 갤러리에 최신본만 남긴다.
   */
  onSave?: (
    image: Blob,
    thumb: Blob,
    draftId?: string,
    /** 학생이 붙인 제목(빈 문자열/미지정이면 제목 없음 — 서버는 기존 제목을 지우지 않는다) */
    title?: string,
  ) => Promise<{ id: string } | null | void> | void;
  /** 상단에 표시할 닉네임/학급 */
  who?: string;
  backHref?: string;
  /** 학생 세션이 있을 때 학급 갤러리 링크 */
  galleryHref?: string;
}

/*
 * 에디터 레이아웃: 캔버스가 주인공.
 *  헤더 = 뒤로 · 로고 · [모드 탭] · 방향/무비/저학년 · 저장(주요 버튼)
 *  본체 = 좌 도구 레일(세로) · 캔버스(플로팅 되돌리기/다시) · 우 색/굵기/마법/레이어
 */
/** 그리기 세션마다 발급하는 dedup 토큰(작품 id 아님·서버에 노출 안 되는 랜덤값). 구형 웹뷰 폴백 포함. */
function genDraftId(): string {
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

/* 마지막으로 "제출한" 그림의 draft 토큰을 자동저장(이어그리기)과 짝지어 보관한다.
 * 새로고침·탭 크래시 후 [이어그리기]로 돌아온 그림은 같은 작품이므로, 그때만 이 토큰을 되살려
 * 서버가 갤러리의 그 행을 덮어쓰게 한다. 반대로 단순 재마운트(가로/세로 전환 등)에는 항상
 * 새 토큰을 쓴다 — 빈 캔버스에 그린 다른 그림이 옛 작품을 덮어쓰는 사고가 유실보다 나쁘기 때문. */
const DRAFT_KEY = "arton.draftId";
function rememberDraft(id: string | null): void {
  try {
    if (id) localStorage.setItem(DRAFT_KEY, id);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 사생활 보호 모드 등 — dedup만 포기하고 저장은 정상 동작 */
  }
}
function recallDraft(): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}


/*
 * 헤더 라벨(글자)을 켤지 끌지를 **뷰포트 폭이 아니라 실측**으로 정한다.
 *
 * 예전엔 `hidden xl:inline`(1280px) 하나로 켰다. 그 값은 게스트 헤더 기준으로 잰 것이라,
 * 학급 코드로 입장하면(닉네임·학급 칩 + 우리 반 갤러리 링크가 더 붙는다) 같은 1366px에서도
 * 필요 폭이 1541px이 되어 헤더가 넘쳤다. 넘치면 flex가 남은 항목을 눌러 한글 라벨이
 * **글자 단위로 접히면서** 칩이 세로로 길쭉해진다("초 록 거 북 · 3 학 년 2 반",
 * 2026-08-25 사용자 제보 + 실측 36×208px).
 *
 * 그래서 매 렌더·리사이즈마다 "라벨을 켠 상태의 scrollWidth"를 재고, 안 들어가면 끈다.
 * 페인트 전(useLayoutEffect)에 확정되므로 깜빡임이 없고, 항목 구성이 바뀌어도(학급/협동/
 * 도안 유무) 손으로 잰 브레이크포인트를 다시 고칠 필요가 없다.
 *
 * 루프가 안 나는 이유: 헤더는 폭 100% 블록이라 라벨을 껐다 켜도 clientWidth가 안 변한다
 * → ResizeObserver가 자기 자신을 다시 부르지 않는다.
 */
function useAutoHeaderLabels(
  ref: React.RefObject<HTMLElement | null>,
  probeRef: React.RefObject<HTMLElement | null>,
): void {
  /* 마지막으로 측정한 상태의 지문. 이게 같으면 결과도 같으므로 다시 재지 않는다.
   *
   * 왜 필요한가: 측정은 dataset 쓰기 → scrollWidth 읽기를 최대 3번 반복하는데, 그 짝마다
   * 브라우저가 레이아웃을 강제로 다시 계산한다(강제 동기 리플로). useLayoutEffect 에
   * 의존성이 없어 **매 렌더** 돌았고, /draw CPU 프로파일(4x 스로틀)에서 JS self 0.8s 중
   * 330ms 를 이 함수 혼자 썼다 — 단일 최대 항목이었다(2026-09-02 실측).
   *
   * ⚠️ 리사이즈와 웹폰트 도착은 이 가드를 **우회해야 한다**. 둘 다 텍스트도 항목 수도
   * 그대로인데 필요 폭만 변하므로, 지문으로는 구별되지 않아 라벨이 접힌 채 굳는다
   * (2026-09-02 교차검증 3계열 공통 지적). clientWidth 를 지문에 넣어도 헤더는 폭 100%
   * 블록이라 창이 줄면 같이 줄어 대개 잡히지만, 폰트 도착은 그마저도 안 변한다. */
  const lastRef = useRef<string>("");
  const recheckRef = useRef<number | null>(null);
  const measureRef = useRef<(force?: boolean) => void>(() => {});
  measureRef.current = (force = false) => {
    const el = ref.current;
    if (!el) return;
    const sig = `${el.clientWidth}|${el.childElementCount}|${el.textContent ?? ""}`;
    if (!force && sig === lastRef.current) return;
    lastRef.current = sig;
    // +1px 여유: 소수점 폭 반올림으로 1px 넘쳐 라벨이 깜빡이며 꺼지는 걸 막는다
    const overflows = () => el.scrollWidth > el.clientWidth + 1;
    // 넓은 쪽부터 좁혀 간다: 전부(on) → 부가 항목만 버림(mid) → 글자 라벨 전부 버림(off).
    // 중간 단계를 둔 건 웨일북(1366px) + 학급 입장 조합 때문이다. 그 조합은 전부 켜면
    // 1757px가 필요해 못 맞추는데, 장식(로고)·부가정보(닉네임 칩)·긴 보조 라벨
    // ("우리 반 갤러리"·"내 기기에 저장" — 둘 다 아이콘과 aria-label로 뜻이 남는다)만
    // 버리면 아이에게 실제로 필요한 버튼 글자("스케치"·"새 그림"·"무비"…)는 살아남는다.
    /* ⚠️ 웹폰트가 아직 오는 중이면 "전부 켬"을 건너뛴다.
     * 본문 글꼴(Pretendard)은 비차단으로 늦게 오는데, 폴백 글꼴로 재면 "들어간다"고 나왔다가
     * 진짜 글꼴이 도착하면 넘친다 — 그 사이 저장 버튼이 헤더 밖으로 밀린다(2026-09-04
     * 라이브 실측, 1366px 웨일북). 폰트가 확정된 뒤 loadingdone 이 다시 재게 하고,
     * 그때 들어가면 "on" 으로 올라간다. 잠깐 라벨이 덜 보이는 편이 버튼이 사라지는 것보다 낫다. */
    const fontsSettling = typeof document !== "undefined" && document.fonts?.status === "loading";
    if (!fontsSettling) {
      el.dataset.labels = "on";
      if (!overflows()) return;
    }
    el.dataset.labels = "mid";
    if (!overflows()) return;
    el.dataset.labels = "off";
  };

  /* 한 프레임 뒤 한 번 더 확인한다.
   * 웹폰트는 여러 묶음으로 도착하고, 그 사이에 fonts.status 가 잠깐 "loaded" 로 보인다 —
   * 그 순간에 재면 "전부 켬"이 들어간다고 나왔다가 다음 묶음이 와서 넘친다. 다음 프레임에
   * 다시 재면 그 틈이 닫힌다. 상태가 그대로면 지문 가드에 걸려 실제 측정은 안 일어난다. */
  const scheduleRecheck = () => {
    if (recheckRef.current !== null) return;
    recheckRef.current = requestAnimationFrame(() => {
      recheckRef.current = null;
      measureRef.current(true);
    });
  };

  // 렌더마다(=헤더 항목이 바뀔 때마다) 페인트 전에 다시 잰다 — 깜빡임 없음.
  // 실제 측정은 지문이 달라졌을 때만 일어난다.
  useLayoutEffect(() => {
    measureRef.current();
    scheduleRecheck();
  });

  /* 창 크기 변화는 리렌더 없이도 온다 — 관찰자는 한 번만 만든다.
   *
   * ⚠️ 헤더 자신만 보면 **글꼴 변화를 영영 못 잡는다**: 헤더는 폭 100% 블록이라 글자가
   * 넓어져도 자기 크기는 그대로다(ResizeObserver 가 안 운다). 그래서 글자 폭을 그대로
   * 따라가는 작은 탐침(probe)을 하나 같이 관찰한다.
   *
   * 왜 폰트 이벤트로는 안 되는가(2026-09-04 라이브 실측): Pretendard 는 CDN CSS 를
   * 비차단으로 받아 늦게 적용되는데, 그 시점엔 이미 `document.fonts.status === "loaded"`
   * 이고 `fonts.size` 도 안 변한다 — ready 도 loadingdone 도 안 온다. 0ms 에 1366 이던
   * 헤더가 300ms 에 1425 로 커져 [저장하기]가 화면 밖으로 밀린 채 굳었다. 탐침은 원인이
   * 무엇이든(글꼴 교체·CSS 늦은 적용·확대) 폭이 변하면 운다. */
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureRef.current(true));
    ro.observe(el);
    if (probeRef.current) ro.observe(probeRef.current);

    /* 헤더 항목이 **리렌더 없이** 늘어나는 경로가 있다: 지연 로딩한 컴포넌트가 청크를 받고
     * 스스로 마운트할 때다(사진 가져오기 버튼 — C3). 부모가 다시 그리지 않으니
     * useLayoutEffect 는 안 돌고, 헤더 폭도 그대로라 ResizeObserver 도 안 운다. 그 사이
     * 항목만 114px 늘어 헤더가 넘치고 [저장하기]가 화면 밖으로 밀린 채 굳었다
     * (2026-09-04 라이브 실측: 항목 11 → 13, scrollWidth 1366 → 1425, 재측정 0회). */
    const mo = new MutationObserver(() => measureRef.current(true));
    mo.observe(el, { childList: true, subtree: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref, probeRef]);

  /* 웹폰트가 늦게 도착하면 같은 글자의 폭이 달라진다 — 지문은 그대로라 강제로 다시 잰다.
   *
   * ⚠️ `fonts.ready` 하나로는 부족하다. 본문 글꼴(Pretendard)은 CDN CSS 를 비차단으로
   * 받아(레이아웃의 media=print 트릭) **나중에** @font-face 가 등록된다 — 그 전에 이미
   * ready 가 resolve 돼 버려 재측정이 한 번도 안 일어난다. 실제로 라이브에서 1366px 헤더가
   * 넘쳐 [저장하기]가 화면 밖으로 밀렸다(2026-09-04 배포 후 실측: scrollWidth 1425 >
   * clientWidth 1366, labels 는 여전히 "on"). `loadingdone` 은 폰트가 한 묶음 로드될
   * 때마다 오므로 늦게 온 글꼴도 잡는다. */
  useEffect(() => {
    let alive = true;
    const remeasure = () => {
      if (!alive) return;
      measureRef.current(true);
      scheduleRecheck();
    };
    void document.fonts?.ready.then(remeasure);
    document.fonts?.addEventListener("loadingdone", remeasure);
    return () => {
      alive = false;
      document.fonts?.removeEventListener("loadingdone", remeasure);
      if (recheckRef.current !== null) cancelAnimationFrame(recheckRef.current);
    };
    // scheduleRecheck 는 ref 만 만지는 안정 함수다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Editor({ lineartSrc, baseSrc, navKey, initialMode, onSave, who, backHref = "/", galleryHref }: EditorProps) {
  useKeyboard();
  const editorRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const fontProbeRef = useRef<HTMLSpanElement>(null);
  useAutoHeaderLabels(headerRef, fontProbeRef);
  // 캔버스 밖(툴바·여백)에서 시작한 ctrl+wheel(트랙패드 핀치/마우스 줌)은 브라우저 페이지
  // 줌을 걸어 새로고침해도 확대가 안 풀린다(JS로 페이지 줌 리셋 불가) — 에디터 전역 차단.
  // 캔버스 위 줌은 CanvasStage가 앱 뷰 줌으로 처리(새로고침 시 리셋). 여기선 막기만 한다.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    el.addEventListener("wheel", block, { passive: false });
    return () => el.removeEventListener("wheel", block);
  }, []);
  const router = useRouter();
  const engineRef = useRef<ArtEngine | null>(null);
  const [engine, setEngine] = useState<ArtEngine | null>(null);
  // dedup: 같은 그림을 여러 번 저장하면(중간 저장→완성 저장) 갤러리에 최신본만 남긴다.
  // 이 그리기 세션의 익명 토큰 — 저장 때 서버로 보내면 서버가 같은 토큰의 자기 행을 덮어쓴다.
  // 새 그림(리셋)·다른 도안 진입 시 새 토큰으로 갈려, 진짜 다른 작품은 별개로 남는다.
  const draftIdRef = useRef<string>(genDraftId());
  const mode = useEditor((s) => s.mode);
  const juniorMode = useEditor((s) => s.juniorMode);
  const toggleJunior = useEditor((s) => s.toggleJunior);
  const restoreAt = useEditor((s) => s.restoreAvailable);
  const dismissRestore = useEditor((s) => s.dismissRestore);
  const viewScale = useEditor((s) => s.viewScale);
  const resetView = useEditor((s) => s.resetView);
  const newDrawing = useEditor((s) => s.newDrawing);
  // 새 그림 2단계 확인(아동 오조작 방지): 첫 클릭 → "정말요?" 3초, 그 안에 재클릭 시 실행
  const [confirmNew, setConfirmNew] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* 도안·이어그리기 원본을 떼어낸 "진짜 빈 종이".
   * 엔진의 newDrawing()은 **그리기 레이어만** 비우고 도안(라인아트)·원본(isBase) 잠금
   * 레이어는 그대로 둔다. 그래서 도안으로 들어왔거나 사진을 깔고 그리던 아이가 "새 그림 →
   * 정말요?"를 눌러도 화면은 하나도 안 바뀐다 = "새로운 그림판이 안 나온다"(2026-09-01 제보).
   * 도안을 유지한 채 색칠만 지우는 건 이미 [전체 지우기]가 한다 — 새 그림은 빈 종이를 준다. */
  /* ⚠️ 단순 카운터로 두면 안 된다 — [새 그림] 뒤에 Editor 가 살아 있는 채로 다른 도안·사진으로
   * 들어오면(같은 /draw 경로라 언마운트 없이 prop 만 바뀐다) 그 **새 도안까지 계속 걷어낸다**
   * (2026-09-01 교차검증 지적). "어느 진입분을 걷어냈는지"를 같이 들고 다녀 저절로 무효화한다. */
  const entryId = `${navKey ?? ""}|${lineartSrc ?? ""}|${baseSrc ?? ""}`;
  const [blank, setBlank] = useState<{ n: number; entry: string } | null>(null);
  const blankKey = blank && blank.entry === entryId ? blank.n : 0;
  /* 성능 눈금(?perf=1) — 웨일북 같은 저사양 기기에서 "지금 몇 ms인지"를 기기에서 직접 읽으려고.
   * 개발 머신에서는 그 렉이 재현되지 않는다(2026-09-01 조사). 평상시엔 렌더되지 않는다. */
  const [perfHud, setPerfHud] = useState(false);
  useEffect(() => {
    setPerfHud(new URLSearchParams(window.location.search).get("perf") === "1");
  }, []);
  const templateDropped = blankKey > 0;
  const lineart = templateDropped ? undefined : lineartSrc;
  const base = templateDropped ? undefined : baseSrc;
  const handleNewDrawing = () => {
    if (!confirmNew) {
      setConfirmNew(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmNew(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmNew(false);
    // 새 그림 = 새 그리기 세션 → 다음 저장은 별개 작품(이어그리기 짝도 끊는다)
    draftIdRef.current = genDraftId();
    rememberDraft(null);
    newDrawing(); // 픽셀·히스토리·무비 로그·자동저장 초기화(잠금 레이어는 남는다)
    if (!lineart && !base) return;
    /* 도안·원본이 깔려 있으면 레이어를 비워도 화면이 그대로다 → 캔버스를 통째로 새로 만든다.
     * 자동저장을 먼저 지우고(purge) 마운트해야 새 엔진이 방금 지운 그림으로 "이어그리기"를
     * 다시 권하지 않는다. 주소의 도안 파라미터도 떼서 새로고침해도 빈 종이로 돌아온다. */
    dismissRestore(); // 떠 있던 [이어 그리기] 배너도 같이 접는다(옛 저장본을 가리키는 죽은 UI)
    /* 주소 정리는 **지금** 한다 — purge 를 기다렸다 하면 그 사이 다른 그림으로 옮겨 갔을 때
     * 남의 주소에서 도안 파라미터를 지운다. 그리고 raw history API 대신 Next 라우터로 —
     * useSearchParams 로 파생되는 값(뒤로가기 링크·과제 배너)이 옛 도안을 붙들지 않게 한다. */
    try {
      const url = new URL(window.location.href);
      ["template", "base", "v"].forEach((k) => url.searchParams.delete(k));
      router.replace(url.pathname + url.search, { scroll: false });
    } catch {
      /* 주소 정리는 부가 기능 — 실패해도 캔버스는 이미 비었다 */
    }
    /* purge 가 실패해도 캔버스 교체는 반드시 일어나야 한다 — 실패가 "새 그림이 아무 일도
     * 안 하는" 원래 증상으로 되돌아가면 안 된다(그래서 then 의 두 갈래 모두 swap). */
    const eng = engineRef.current;
    const swap = () => setBlank({ n: Date.now(), entry: entryId });
    void Promise.resolve(eng?.discardRestore()).then(swap, swap);
  };
  // 정상 마운트 = 자가치유 1회권 재장전(global-error/error.tsx의 크래시 자동 복구용)
  useEffect(() => {
    try {
      sessionStorage.removeItem("arton.selfheal");
    } catch {
      /* 통과 */
    }
  }, []);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  // onSave가 있다 = 학급 코드로 입장한 학생 세션 — 저장이 곧 학급 갤러리 제출
  const submits = !!onSave;
  // 첫 진입 1회 안내(세션당) — 터치 기기는 저장 버튼 툴팁을 볼 수 없다
  const [showSubmitHint, setShowSubmitHint] = useState(false);
  useEffect(() => {
    if (!submits || sessionStorage.getItem("arton.submitHint")) return;
    sessionStorage.setItem("arton.submitHint", "1");
    setShowSubmitHint(true);
    const t = setTimeout(() => setShowSubmitHint(false), 6000);
    return () => clearTimeout(t);
  }, [submits]);
  /* 학급 안내 — 혼자 그리는 게스트에게만.
   * onSave 가 있으면 이미 학급 학생이다. 백엔드가 없는
   * 게스트 빌드에선 학급 자체가 없으니 문구가 거짓이 된다. */
  const classHintable = hasBackend() && !submits;
  const [classHint, setClassHint] = useState(false);
  // 지금 화면으로 되돌아오기 위한 경로 — location 은 서버에 없어 마운트 후에 읽는다
  const [joinHref, setJoinHref] = useState("/join");
  useEffect(() => {
    if (!classHintable) return;
    setJoinHref(`/join?next=${encodeURIComponent(location.pathname + location.search)}`);
    if (!takeEntryHint()) return;
    setClassHint(true);
    const t = setTimeout(() => setClassHint(false), 6000);
    return () => clearTimeout(t);
  }, [classHintable]);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  /* 방향 전환은 캔버스를 새로 만든다 = 그림이 통째로 사라지고 되돌리기도 안 된다.
   * 경고가 title 툴팁뿐이라 터치 기기(웨일북·태블릿)에선 아예 볼 수 없었다 —
   * "새 그림"과 같은 2단계 확인으로 통일. 빈 캔버스면 잃을 게 없으니 바로 바꾼다. */
  const [confirmRotate, setConfirmRotate] = useState(false);
  const rotateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRotate = () => {
    const flip = () => setOrientation((o) => (o === "landscape" ? "portrait" : "landscape"));
    if (rotateTimer.current) clearTimeout(rotateTimer.current);
    if (!confirmRotate && engineRef.current?.hasArtwork()) {
      setConfirmRotate(true);
      rotateTimer.current = setTimeout(() => setConfirmRotate(false), 3000);
      return;
    }
    setConfirmRotate(false);
    flip();
  };
  useEffect(() => () => void (rotateTimer.current && clearTimeout(rotateTimer.current)), []);
  const stampPaletteOpen = useEditor((s) => s.stampPaletteOpen);
  const textPaletteOpen = useEditor((s) => s.textPaletteOpen);
  const [showMovie, setShowMovie] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  /* 저장은 두 갈래 — 학급으로 입장했어도 "내 컴퓨터에 저장"은 늘 쓸 수 있어야 한다
   * (2026-07-13 사용자 요청: 갤러리 제출과 파일 저장은 별개의 일). */
  const handleExport = useCallback(
    async (mode: "submit" | "download", title?: string) => {
      const engine = engineRef.current;
      if (!engine || saving || downloading) return;
      const submit = mode === "submit" && !!onSave;
      if (submit) setSaving(true);
      else setDownloading(true);
      try {
        const layers = engine.getLayers();
        // ⚠️ draft 토큰은 인코딩(await) 전에 캡처한다 — 인코딩 중 "새 그림"·재마운트가 일어나면
        //    ref는 새 세션 토큰으로 갈리는데, 지금 내보내는 픽셀은 그 전 그림이다. 나중에 읽으면
        //    서로 다른 두 작품이 같은 토큰을 공유해 앞 작품이 덮어써진다(2026-07-22 교차검증).
        const draftId = draftIdRef.current;
        if (submit) {
          // 갤러리 제출(R2 누적) = webp 원본 — 무료 스토리지 한도를 6~7배 더 버틴다.
          const image = await exportWebp(layers, engine.width, engine.height);
          const thumb = await exportThumb(layers, engine.width, engine.height);
          // 같은 그림 재저장이면 같은 draft 토큰으로 → 서버가 자기 행을 덮어써 최신본만 남김.
          await onSave!(image, thumb, draftId, title);
          // 이 그림 = 갤러리의 그 행. 이어그리기로 돌아오면 되살린다. 저장 도중 새 그림으로
          // 갈렸다면 자동저장은 이미 다른 그림이므로 짝을 갱신하지 않는다.
          if (draftIdRef.current === draftId) rememberDraft(draftId);
          setSaved(true);
          setTimeout(() => setSaved(false), 3500); // 제출 안내 문구가 길어 읽을 시간 확보
        } else {
          // 내 컴퓨터에 저장 = 무손실 PNG 유지(아이 소장·인쇄·구형 PC 호환).
          const png = await exportPng(layers, engine.width, engine.height, {
            background: true,
            scale: 1,
          });
          const url = URL.createObjectURL(png);
          const a = document.createElement("a");
          a.href = url;
          a.download = `arton-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(url);
          setDownloaded(true);
          setTimeout(() => setDownloaded(false), 2500);
          // 저장 뒤 한 번 더: 파일로 갖는 것과 학급 갤러리 전시는 별개라는 걸 알려 준다
          if (classHintable && takeSaveHint()) {
            setTimeout(() => {
              setClassHint(true);
              setTimeout(() => setClassHint(false), 6000);
            }, 2500);
          }
        }
      } catch {
        // 제출 실패(네트워크·잠긴 학급 403·과속 429) — 아이에게도 알려야 재시도한다
        setSaveError(true);
        setTimeout(() => setSaveError(false), 3500);
      } finally {
        setSaving(false);
        setDownloading(false);
      }
    },
    [onSave, saving, downloading, classHintable],
  );

  /* 제목 달기(학급 제출 전용) — 저장 버튼을 누르면 먼저 "제목을 지어 줄래요?"를 띄운다.
   * [그냥 저장]은 반드시 남긴다: 제목을 강제하면 글씨가 느린 아이가 저장 자체를 못 한다.
   * 붙인 제목은 이 그리기 세션 동안 기억해 재저장 때 그대로 채워 준다(서버도 제목 없이 온
   * 재저장에서는 기존 제목을 지우지 않는다 — COALESCE). */
  const [askTitle, setAskTitle] = useState(false);
  const [title, setTitle] = useState("");
  const submitWithTitle = (t: string) => {
    setAskTitle(false);
    /* [그냥 저장](t === "")은 기억해 둔 제목을 **지우지 않는다** — 서버도 COALESCE 로
     * 기존 제목을 지키므로, 여기서 비우면 UI만 서버와 어긋난다(교차검증 지적). */
    if (t) setTitle(t);
    void handleExport("submit", t);
  };

  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const menu = headerRef.current?.querySelector(".editor-more");
      if (event.target instanceof Node && !menu?.contains(event.target)) setMoreOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        headerRef.current?.querySelector<HTMLButtonElement>(".editor-more-toggle")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [moreOpen]);

  // shrink-0: 헤더가 좁아지면 flex가 버튼을 눌러 라벨이 접힌다(웨일북에서 버튼이 세로로 길쭉)
  const iconBtn =
    "pressable touch-target flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-control bg-transparent px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2";

  return (
    // editor-no-pinch: 데스크톱 크로뮴(웨일북)은 뷰포트 메타 줌 잠금을 무시 — 툴바·여백에서
    // 시작한 핀치가 "브라우저 페이지 줌"을 걸면 캔버스(touch-action:none) 위 핀치로는 못 되돌려
    // 갇힌다(2026-07-07 실사용 보고). 에디터 전역에서 핀치줌 제스처 자체를 차단.
    <div ref={editorRef} className="editor-no-pinch flex h-dvh flex-col bg-cream">
      {/* ── 상단바: 모드 탭이 중앙, 저장이 가장 눈에 띄게 ── */}
      {/* overflow-x-auto: 버튼은 전부 shrink-0(라벨이 글자 단위로 접히는 걸 막으려고)이라
          좁은 화면에선 헤더가 넘친다. 그대로 두면 넘치는 게 "페이지"라서 캔버스까지 옆으로
          밀려 흔들린다 — 넘침은 헤더 안에서만 흡수한다(2026-07-25 실측: 390px에서 저장 버튼이
          화면 밖 x=406). */}
      <header
        ref={headerRef}
        data-labels="off"
        className="editor-toolbar relative z-20 flex shrink-0 items-center gap-2 overflow-x-auto rounded-panel border border-ink/6 bg-paper px-3 py-2 shadow-panel compact:gap-1 compact:px-2 compact:py-1"
      >
        {/* 글자 폭 탐침 — 보이지 않고 흐름 밖(absolute)이라 배치에 영향이 없다.
            글꼴이 바뀌면 이 폭이 변하고, 그걸 ResizeObserver 가 잡아 헤더를 다시 잰다. */}
        <span
          ref={fontProbeRef}
          aria-hidden="true"
          className="pointer-events-none absolute -z-10 whitespace-nowrap opacity-0"
        >
          내 기기에 저장
        </span>
        <Link href={backHref} className="editor-back pressable touch-target grid place-items-center rounded-control bg-transparent px-3 text-xl hover:bg-surface-2" aria-label="나가기">
          ←
        </Link>
        <span className="hdr-extra block shrink-0">
          <ArtonLogo className="h-8" />
        </span>
        {who && (
          <span className="hdr-extra block shrink-0 whitespace-nowrap rounded-control bg-surface-2 px-3 py-1 text-sm font-semibold text-ink-soft">
            {who}
          </span>
        )}
        {galleryHref && (
          <Link
            href={galleryHref}
            className="editor-context pressable touch-target hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-control bg-surface-2 px-3 py-1 text-sm font-semibold text-ink-soft sm:flex"
          >
            🖼️ <span className="hdr-extra">우리 반 갤러리</span>
          </Link>
        )}
        {classHintable && (
          <Link
            href={joinHref}
            className="editor-context pressable touch-target hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-control bg-sun-soft px-3 py-1 text-sm font-semibold text-ink sm:flex"
            title="학급 코드로 들어오면 그림을 우리 반 갤러리에 전시할 수 있어요"
            data-testid="class-join-chip"
          >
            {/* 라벨은 hdr-extra — 헤더가 빠듯해지면(mid) 가장 먼저 버린다. 학급 입장은
                있으면 좋은 안내지, 그리기 버튼보다 먼저 자리를 차지할 것은 아니다.
                아이콘과 title 로 뜻은 남는다. */}
            🏫 <span className="hdr-extra">학급 입장</span>
          </Link>
        )}

        {/* ⚠️ 이 칸은 절대 줄어들면 안 된다(flex: 1 0 auto) — 줄어들면 모드 탭이 자기 칸
            밖으로 흘러 좌우 버튼 위를 덮는다. 실측: 협동 방에서 "모둠 나가기"가 연필
            아이콘에 가려 클릭 자체가 안 됐다(= 방에서 나갈 방법이 없음, 2026-07-25).
            min-w-0(줄어듦) 도, flex-1 기본값(basis 0 + shrink 1) 도 안 된다.
            넘치는 건 헤더의 가로 스크롤이 받는다. */}
        <div className="editor-modes flex flex-[1_0_auto] justify-center">
          <ModeTabs hasLineart={!!lineartSrc} />
        </div>

        <div className="editor-more" data-open={moreOpen}>
          <button
            type="button"
            aria-label="더보기"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
            className="editor-more-toggle pressable touch-target hidden items-center justify-center rounded-control text-2xl text-ink-soft hover:bg-surface-2"
          >
            ⋯
          </button>
          <div className="editor-more-content">
            {/* 도안·이어그리기 원본이 있으면 캔버스 비율이 그 그림에 묶여 있어 방향 전환이
                아무 일도 하지 않는다(CanvasStage가 이미지 비율을 쓴다) — 라벨만 가로↔세로로
                바뀌는 죽은 버튼이었다(2026-07-25). 아예 감춘다. */}
            {!lineart && !base && (
              <button
                onClick={handleRotate}
                className={
                  confirmRotate
                    ? "pressable touch-target flex items-center gap-1 rounded-control bg-berry px-3 py-2 text-sm font-semibold text-white"
                    : iconBtn
                }
                title="캔버스 방향 바꾸기 (그림이 지워져요)"
                aria-label="캔버스 방향 바꾸기"
              >
                <Icon name="rotate" className="h-5 w-5" />
                <span className={confirmRotate ? "" : "hdr-label"}>
                  {confirmRotate ? "지워요?" : orientation === "landscape" ? "가로" : "세로"}
                </span>
              </button>
            )}
            <button
              onClick={handleNewDrawing}
              className={
                confirmNew
                  ? "pressable touch-target flex items-center gap-1 rounded-control bg-berry px-3 py-2 text-sm font-semibold text-white"
                  : iconBtn
              }
              aria-label="새 그림"
              title="새 그림: 지금 그림을 지우고 처음부터"
            >
              <Icon name="plus" className="h-5 w-5" />
              <span className={confirmNew ? "" : "hdr-label"}>
                {confirmNew ? "정말요?" : "새 그림"}
              </span>
            </button>
            {/* 그림 불러오기 — "사진"은 무슨 기능인지 헷갈린다는 실사용 피드백(2026-07-13) → "불러오기" */}
            <PhotoImport
              renderButton={(openPicker, converting) => (
                <button
                  onClick={openPicker}
                  disabled={converting}
                  className={iconBtn}
                  aria-label="내 사진·그림으로 그리기"
                  title="내 사진·그림을 도안으로 만들거나(선따기) 밑그림으로 깔고 이어 그려요"
                >
                  📷
                  <span className="hdr-label">{converting ? "변환 중…" : "내 사진·그림"}</span>
                </button>
              )}
            />
            <button
              onClick={() => {
                setShowMovie(true);
                setMoreOpen(false); // 무비는 전체 화면 모달 — 폰 더보기 메뉴가 뒤에 열린 채 남지 않게
              }}
              className={iconBtn}
              aria-label="무비 모드"
              title="그려지는 과정 재생"
            >
              <Icon name="movie" className="h-5 w-5" />
              <span className="hdr-label">무비</span>
            </button>
            <button
              onClick={toggleJunior}
              aria-pressed={juniorMode}
              aria-label="저학년 모드"
              title="저학년 모드: 도구를 쉬운 것만 보여줘요"
              className={`pressable touch-target flex items-center gap-1 rounded-control px-3 py-2 text-sm font-semibold ${
                juniorMode ? "bg-coral-soft text-coral-deep ring-2 ring-coral/60 ring-inset" : "bg-transparent text-ink-soft hover:bg-surface-2"
              }`}
            >
              <Icon name="junior" className="h-5 w-5" />
              <span className="hdr-label">저학년</span>
            </button>
            {/* 학급으로 입장했어도 파일 저장은 따로 쓸 수 있어야 한다(사용자 요청 2026-07-13) */}
            {submits && (
              <button
                onClick={() => handleExport("download")}
                disabled={downloading}
                className={iconBtn}
                aria-label="내 컴퓨터에 저장"
                title="그림을 그림 파일(PNG)로 내 기기에 저장해요"
              >
                <Icon name="save" className="h-5 w-5" />
                <span className="hdr-extra">{downloading ? "저장 중…" : "내 기기에 저장"}</span>
              </button>
            )}
          </div>
        </div>
        <button
          onClick={() => (submits ? setAskTitle(true) : handleExport("download"))}
          disabled={saving || (!submits && downloading)}
          className="editor-save pressable touch-target flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control bg-coral px-5 py-2.5 font-display text-white disabled:opacity-60"
          aria-label={submits ? "우리 반 갤러리에 보내기" : "저장하기"}
          title={
            submits ? "우리 반 갤러리에 바로 전시돼요" : "그림을 그림 파일(PNG)로 저장해요"
          }
        >
          {submits ? (
            <span className="text-lg leading-none">🖼️</span>
          ) : (
            <Icon name="save" className="h-5 w-5" />
          )}
          <span className="editor-save-label">
            {submits
              ? saving
                ? "보내는 중…"
                : "갤러리로 보내기"
              : downloading
                ? "저장 중…"
                : "저장"}
          </span>
        </button>
      </header>

      {/* 복구 배너 */}
      {restoreAt && (
        <RestoreBanner
          savedAt={restoreAt}
          onRestore={() => {
            // 되살린 그림은 저장했던 그 작품 — 짝지어둔 draft 토큰을 되살려 갤러리에 중복으로
            // 쌓이지 않게 한다(없으면 그냥 새 작품으로 남는다).
            const prev = recallDraft();
            if (prev) draftIdRef.current = prev;
            void engineRef.current?.restore();
          }}
          onDismiss={dismissRestore}
        />
      )}

      {/* ── 본체: 좌 도구 레일 · 캔버스 · 우 패널 ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3 compact:flex-row compact:gap-1.5 compact:px-2 compact:pb-2 rail:flex-row">
        <div className="order-2 flex min-h-0 min-w-0 shrink-0 compact:order-1 rail:order-1">
          <BrushBar />
        </div>

        {/* 중앙: 캔버스 + 플로팅 되돌리기/다시 */}
        <div className="arton-workbench relative order-1 min-h-0 flex-1 compact:order-2 rail:order-2">
          <CanvasStage
            // navKey(진입 고유 토큰)가 있으면 그것으로 key 고정 — 커스텀 이미지는 dataURL 앞부분이
            // 같아(같은 크기) slice(0,64) 충돌 → 2회차 재마운트 실패하던 버그의 근본 수정.
            key={
              blankKey > 0
                ? // 새 그림 = 도안·원본을 뗀 새 캔버스. ⚠️ orientation 을 반드시 섞는다 —
                  // 도안을 떼면 가로/세로 버튼이 다시 살아나는데, key 에 방향이 없으면
                  // 눌러도 재마운트가 안 돼 죽은 버튼이 된다(2026-09-01 교차검증 지적).
                  `n:${blankKey}:${orientation}`
                : navKey
                  ? `v:${navKey}`
                  : lineartSrc
                    ? `t:${lineartSrc}`
                    : baseSrc
                      ? `b:${baseSrc.slice(0, 64)}`
                      : `o:${orientation}`
            }
            lineartSrc={lineart}
            baseSrc={base}
            initialMode={initialMode}
            orientation={orientation}
            onEngineReady={(e) => {
              engineRef.current = e;
              setEngine(e);
              // 재마운트(다른 도안·재진입·가로세로 전환)는 빈 캔버스로 시작한다 → 항상 새 토큰.
              // 이어그리기로 되살린 경우에만 RestoreBanner가 옛 토큰을 되돌려준다.
              draftIdRef.current = genDraftId();
            }}
          />
          {perfHud && <PerfHud />}
          <SuggestBar />
          <PendingStampBar />
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex gap-2 rounded-panel border border-ink/6 bg-paper p-1 shadow-lift compact:bottom-1.5 compact:left-1.5 compact:gap-1.5">
            <button
              onClick={undo}
              disabled={!canUndo}
              aria-label="되돌리기"
              title="되돌리기 (Ctrl+Z)"
              className="pressable touch-target pointer-events-auto grid h-12 w-12 place-items-center rounded-control bg-transparent hover:bg-surface-2 disabled:opacity-35"
            >
              <Icon name="undo" className="h-6 w-6" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              aria-label="다시 실행"
              title="다시 실행 (Ctrl+Shift+Z)"
              className="pressable touch-target pointer-events-auto grid h-12 w-12 place-items-center rounded-control bg-transparent hover:bg-surface-2 disabled:opacity-35"
            >
              <Icon name="redo" className="h-6 w-6" />
            </button>
            {viewScale > 1.01 && (
              <button
                onClick={resetView}
                aria-label="화면 맞춤"
                title="확대 풀고 화면에 맞추기"
                className="pressable touch-target pointer-events-auto flex h-12 items-center gap-1 rounded-control bg-sky-soft px-4 text-sm font-semibold text-sky-deep"
              >
                🔍 화면 맞춤 ×{viewScale.toFixed(1)}
              </button>
            )}
          </div>
        </div>

        {/* 우측: 색 → 굵기 → 마법 도구 → 레이어 (접으면 캔버스 풀폭) */}
        {/* ⚠️ max-h-[40dvh]는 **세로 스택에서만** 걸리는 안전장치 — 패널은 shrink-0이라
            제한이 없으면 자기 내용 높이(≈420px)를 그대로 가져가고 캔버스가 0이 된다
            (2026-07-28 세로 폰 제보: 되돌리기 버튼만 있는 얇은 띠가 캔버스였다).
            3열(rail·compact)에서는 세로로 스크롤하면 되므로 제한을 푼다. */}
        <div className="order-3 flex max-h-[40dvh] min-h-0 min-w-0 shrink-0 items-stretch gap-1 compact:max-h-none rail:max-h-none">
          <button
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            aria-label={panelOpen ? "도구 패널 접기" : "도구 패널 펼치기"}
            title={panelOpen ? "도구 패널 접기 — 캔버스를 더 넓게" : "도구 패널 펼치기"}
            /* ⚠️ compact(가로 폰)에는 내보내지 않는다 — 그 화면에서 캔버스는 **높이에 묶여**
               있어서 패널을 접어도 커지지 않는다(실측 387 → 387). 눌러도 아무 변화가 없는
               버튼은 아이에게 혼란만 준다. rail(넉넉한 화면)에서만 실제로 넓어진다. */
            className="pressable hidden w-5 shrink-0 items-center justify-center self-center rounded-control border border-line bg-paper py-6 text-xs text-ink-faint hover:text-ink rail:flex"
          >
            {panelOpen ? "▸" : "◂"}
          </button>
          {panelOpen && (
            // 우측 패널은 모든 화면에서 1열 — 2열(xl)은 시선이 갈라져 불편(2026-07-10
            // 사용자 실측). 폰은 세로 스크롤로 굵기 카드가 화면 밖에 밀리지 않게 한다.
            <div className="editor-panels phone-panel-stack flex min-w-0 gap-3 overflow-x-auto overflow-y-auto compact:w-[228px] compact:shrink-0 compact:flex-col compact:overflow-x-hidden rail:w-[264px] rail:shrink-0 rail:flex-col rail:overflow-x-hidden">
              <ColorPalette />
              <BrushControls />
              <ActionRail />
              <LayerPanel />
            </div>
          )}
        </div>
      </div>

      {showSubmitHint && !saving && !saved && (
        <Toast>🖼️ 다 그리면 &ldquo;갤러리로 보내기&rdquo; — 파일로 갖고 싶으면 &ldquo;내 기기에 저장&rdquo;</Toast>
      )}
      {classHint && !saving && !downloading && (
        <Toast tone="ink">
          <span className="flex items-center gap-3">
            <span>
              🏫 학급 코드로 입장하면 그림을 <b>우리 반 갤러리</b>에 전시할 수 있어요
            </span>
            <Link
              href={joinHref}
              onClick={() => setClassHint(false)}
              className="pressable shrink-0 rounded-full bg-white px-3 py-1 text-sm font-bold text-ink"
              data-testid="class-join-toast-link"
            >
              입장하기
            </Link>
          </span>
        </Toast>
      )}
      {saveError && <Toast>😢 저장하지 못했어요 — 잠시 후 다시 눌러 주세요</Toast>}
      {saving && <Toast>우리 반 갤러리로 보내는 중…</Toast>}
      {downloading && <Toast>내 기기에 저장하는 중…</Toast>}
      {saved && (
        <Toast tone="leaf">
          {submits ? "✅ 우리 반 갤러리에 전시했어요! 갤러리에서 확인해 보세요" : "✅ 저장했어요!"}
        </Toast>
      )}
      {downloaded && <Toast tone="leaf">✅ 내 기기에 그림 파일로 저장했어요</Toast>}
      {askTitle && (
        <TitleAsk
          initial={title}
          onCancel={(draft) => {
            setTitle(draft); // 실수로 닫아도 쓰던 제목은 남는다
            setAskTitle(false);
          }}
          onDone={submitWithTitle}
        />
      )}
      {showMovie && engineRef.current && (
        <MovieModal engine={engineRef.current} onClose={() => setShowMovie(false)} />
      )}
      {/* 스탬프·글씨 팔레트는 스스로 열림 여부를 보고 null 을 돌려주지만, 여기서 마운트하는
          순간 청크는 이미 받는다. 스토어 상태로 감싸 "열 때 받도록" 한다. */}
      {stampPaletteOpen && <StampPalette />}
      {textPaletteOpen && <TextPalette />}
    </div>
  );
}

/* 제목 묻기 — 저장(제출) 직전 1회. 아이 손에 맞춰 큼직한 입력 한 칸과 버튼 두 개만. */
function TitleAsk({
  initial,
  onDone,
  onCancel,
}: {
  initial: string;
  onDone: (title: string) => void;
  /** 닫기 — 쓰던 제목을 초안으로 넘긴다(실수로 배경을 탭해도 다시 열면 그대로 있다) */
  onCancel: (draft: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="그림 제목 정하기"
      onClick={() => onCancel(v)}
    >
      <div
        className="w-[min(92vw,420px)] rounded-bubble bg-paper p-5 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl text-ink">그림에 제목을 지어 줄래요? ✏️</h2>
        <p className="mt-1 text-sm text-ink-soft">갤러리에서 친구들이 제목과 함께 봐요.</p>
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            /* ⚠️ isComposing 가드 — 한글 조합을 확정하는 Enter 가 그대로 제출로 새면
             * 마지막 음절이 빠진 제목("우리 강아")이 저장된다(교차검증 지적). */
            if (e.key === "Enter" && !e.nativeEvent.isComposing) onDone(v);
            if (e.key === "Escape") onCancel(v);
          }}
          maxLength={30} // ⚠️ worker/lib/title.ts 의 TITLE_MAX 와 같은 값이어야 한다
          placeholder="예) 우리 강아지"
          aria-label="그림 제목"
          className="mt-4 w-full rounded-card border border-cream-deep bg-white px-4 py-3 text-lg text-ink outline-none focus:border-sky"
        />
        <div className="mt-2 text-right text-xs text-ink-faint">{v.length}/30</div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onDone("")}
            className="pressable flex-1 rounded-card bg-cream-deep px-4 py-3 font-display text-ink-soft"
          >
            그냥 저장
          </button>
          <button
            onClick={() => onDone(v)}
            className="pressable flex-[2] rounded-card bg-coral px-4 py-3 font-display text-white shadow-soft"
          >
            이 제목으로 저장
          </button>
        </div>
      </div>
    </div>
  );
}

function RestoreBanner({
  savedAt,
  onRestore,
  onDismiss,
}: {
  savedAt: number;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const mins = Math.round((Date.now() - savedAt) / 60000);
  return (
    <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-card bg-sky-soft px-4 py-2 text-sm text-sky-deep">
      <span>이어서 그릴 그림이 있어요 ({mins < 1 ? "방금" : `${mins}분 전`}).</span>
      <div className="flex gap-2">
        <button onClick={onRestore} className="pressable rounded-full bg-sky px-3 py-1 font-semibold text-white">
          이어 그리기
        </button>
        <button onClick={onDismiss} className="pressable rounded-full px-3 py-1 font-semibold text-ink-soft">
          새로 시작
        </button>
      </div>
    </div>
  );
}

/* ⚠️ pointer-events-none 필수. 토스트는 캔버스 위(bottom-6 중앙)에 떠서, 그대로 두면
 * 떠 있는 동안 그 자리의 탭·획을 통째로 삼킨다 — 아이가 캔버스 아래쪽을 누르는데 아무 일도
 * 안 일어난다(2026-09-04 실측: 페인트통 스펙이 이걸로 깨졌다. 안내가 없던 시절에도 저장
 * 토스트가 같은 자리를 막고 있었다). 안내 안의 링크만 pointer-events-auto 로 되살린다. */
function Toast({ children, tone = "ink" }: { children: React.ReactNode; tone?: "ink" | "leaf" }) {
  return (
    <div
      className={`pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full px-6 py-3 font-display text-white shadow-lift [&_a]:pointer-events-auto [&_button]:pointer-events-auto ${
        tone === "leaf" ? "bg-leaf" : "bg-ink"
      }`}
      role="status"
    >
      {children}
    </div>
  );
}
