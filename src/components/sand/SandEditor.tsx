"use client";

/*
 * 샌드아트 화면 — 라이트박스 위 모래 그림.
 *  헤더 = 뒤로 · 로고 · [모드 탭] · 전체화면 · 새 그림 · 무비 · 저장
 *  본체 = 손 고르기(붓기·손가락·손바닥) + 굵기 · 모래판(되돌리기/다시 떠 있음) · 빛·모래 색 · 쏟기·쓸기 · 소리
 * 엔진 = src/sand(모래 두께 격자). 그리기 화면(Editor)의 붓 엔진은 하나도 끌고 오지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { SandEngine, isSandSaved } from "@/sand/SandEngine";
import { LIGHTS, SANDS, lookOf } from "@/sand/SandRender";
import type { SandTool } from "@/sand/SandSim";
import { SandAudio } from "@/sand/sandAudio";
import { loadPref, loadSand, savePref, saveSand, type SandPref } from "@/sand/sandSave";
import { ModeTabs } from "@/components/canvas/ModeTabs";
import { Icon, type IconName } from "@/components/canvas/icons";
import { TitleAsk, Toast } from "@/components/canvas/SaveUi";
import { ArtonLogo } from "@/components/arton-logo";
import { genDraftId } from "@/lib/draft-id";

const SandMovie = dynamic(() => import("./SandMovie").then((m) => m.SandMovie), { ssr: false });

/** 격자 크기 — 긴 변 800칸. 화면에선 부드럽게 늘려 보인다(모래는 원래 경계가 부드럽다) */
const LONG = 800;
const SHORT = 533;

const TOOLS: { id: SandTool; label: string; hint: string; icon: IconName }[] = [
  { id: "pour", label: "뿌리기", hint: "누르고 있으면 모래가 흘러내려요", icon: "sandPour" },
  { id: "finger", label: "손가락", hint: "모래를 밀어 빛나는 선을 그려요", icon: "sandFinger" },
  { id: "palm", label: "손바닥", hint: "넓게 쓸어 장면을 바꿔요", icon: "sandPalm" },
];

export interface SandEditorProps {
  onSave?: (image: Blob, thumb: Blob, draftId?: string, title?: string) => Promise<unknown>;
  who?: string;
  backHref?: string;
  galleryHref?: string;
}

function toBlob(c: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), type, q));
}

/** 판 둘레로 새어 나오는 빛 — 판이 종이가 아니라 켜진 유리판으로 보이게(화면에만 · 저장 그림에는 안 들어간다) */
function lightGlow(id: string) {
  const l = LIGHTS.find((x) => x.id === id) ?? LIGHTS[0];
  const [r, g, b] = l.rgb;
  const [r2, g2, b2] = l.rgb2 ?? l.rgb;
  return {
    boxShadow: `0 -6px 28px rgba(${r},${g},${b},.55), 0 6px 28px rgba(${r2},${g2},${b2},.55), 0 0 70px rgba(${(r + r2) >> 1},${(g + g2) >> 1},${(b + b2) >> 1},.35)`,
  };
}

export function SandEditor({ onSave, who, backHref = "/", galleryHref }: SandEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SandEngine | null>(null);
  const audioRef = useRef<SandAudio | null>(null);
  const draftRef = useRef<string>("");
  const [ready, setReady] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [pref, setPref] = useState<SandPref>(() => ({ light: "warm", sand: "dark", sound: true }));
  const [tool, setToolState] = useState<SandTool>("pour");
  const [size, setSizeState] = useState(22);
  const [hist, setHist] = useState({ undo: false, redo: false, empty: true });
  const [showMovie, setShowMovie] = useState(false);
  const [askTitle, setAskTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [toast, setToast] = useState<{ text: string; tone?: "ink" | "leaf" } | null>(null);
  const [busy, setBusy] = useState(false);
  const submits = !!onSave;

  const flash = (text: string, tone: "ink" | "leaf" = "ink", ms = 2600) => {
    setToast({ text, tone });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), ms);
  };

  /* 1) 판 크기 정하기 — 저장된 그림이 있으면 그 크기, 없으면 화면 모양(세로 화면 = 세로 판) */
  useEffect(() => {
    let alive = true;
    const p = loadPref();
    setPref(p);
    void loadSand().then((saved) => {
      if (!alive) return;
      if (isSandSaved(saved)) {
        setDims({ w: saved.w, h: saved.h });
        return;
      }
      // 무대에 더 크게 들어가는 쪽으로(폰은 세로 판이 대개 크다). 비율 문턱으로 정하면
      // 헤더가 두 줄인 폰에서 무대가 거의 정사각이라 가로 판이 골라졌다(실측 374×396)
      const el = stageRef.current;
      const aw = el?.clientWidth ?? LONG;
      const ah = el?.clientHeight ?? SHORT;
      const land = Math.min(aw / LONG, ah / SHORT) ** 2;
      const port = Math.min(aw / SHORT, ah / LONG) ** 2;
      setDims(port > land * 1.05 ? { w: SHORT, h: LONG } : { w: LONG, h: SHORT });
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 2) 엔진 만들기·복원·자동저장 */
  useEffect(() => {
    if (!dims || !canvasRef.current) return;
    const p = loadPref();
    const look = lookOf(p.light, p.sand);
    const eng = new SandEngine(dims.w, dims.h, look);
    if (p.sizes) eng.sizes = { ...eng.sizes, ...p.sizes };
    const audio = new SandAudio();
    audio.enabled = p.sound;
    audioRef.current = audio;
    eng.onActivity = (t, sp) => audio.set(t, sp);
    engineRef.current = eng;
    eng.attach(canvasRef.current);
    const canvas = canvasRef.current;
    const unlock = () => audio.unlock();
    canvas.addEventListener("pointerdown", unlock);
    setToolState(eng.tool);
    setSizeState(eng.size);

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstDirty = 0;
    let savedVersion = -1;
    let savedLive = eng.liveRev;
    let lastSaveAt = Date.now();
    const flushSave = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      firstDirty = 0;
      if (eng.version === savedVersion && eng.liveRev === savedLive) return;
      // 저장이 «끝난 뒤»에만 저장됨으로 친다 — 용량 부족·IndexedDB 오류면 다음 기회에 다시(8way gptweb)
      const v = eng.version;
      const lv = eng.liveRev;
      lastSaveAt = Date.now();
      void saveSand(eng.snapshot(draftRef.current)).then((ok) => {
        if (!ok) return;
        savedVersion = v;
        savedLive = lv;
      });
    };
    // 손을 떼지 않는 긴 붓질 — 획이 끝나야 오는 emit 만 보면 10초 넘게 뿌리는 동안 저장이 0이다.
    // 마지막 저장부터 잰다(처음 알아챈 때부터 재면 2초 늦어 12초가 된다). 닫힐 때(pagehide) 저장은
    // IndexedDB 쓰기가 끝나기 전에 페이지가 사라질 수 있어 이것을 대신하지 못한다.
    const liveTimer = setInterval(() => {
      if (!eng.drawing || eng.liveRev === savedLive) return;
      if (Date.now() - lastSaveAt >= 10_000) flushSave();
    }, 1000);
    const off = eng.on(() => {
      setHist({ undo: eng.canUndo, redo: eng.canRedo, empty: eng.empty });
      // 3초 쉬면 저장 · 계속 그려도 10초마다는 저장(웨일북 통째 유실 교훈)
      const now = Date.now();
      if (!firstDirty) firstDirty = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flushSave, now - firstDirty > 10_000 ? 0 : 3000);
    });
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushSave);

    void loadSand().then((saved) => {
      if (!alive) return;
      let ok = false;
      try {
        ok = !!saved && eng.restore(saved);
      } catch {
        ok = false; // 손상본 — 빈 판으로
      }
      if (ok && saved) {
        draftRef.current = typeof saved.draftId === "string" && saved.draftId.length > 0 && saved.draftId.length <= 64 ? saved.draftId : genDraftId();
        savedVersion = eng.version;
      } else {
        draftRef.current = genDraftId();
      }
      setHist({ undo: eng.canUndo, redo: eng.canRedo, empty: eng.empty });
      setReady(true);
    });

    return () => {
      alive = false;
      clearInterval(liveTimer);
      flushSave();
      off();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushSave);
      canvas.removeEventListener("pointerdown", unlock);
      eng.detach();
      audio.dispose();
      engineRef.current = null;
    };
  }, [dims]);

  const updatePref = useCallback((patch: Partial<SandPref>) => {
    setPref((p) => {
      const n = { ...p, ...patch };
      savePref(n);
      return n;
    });
  }, []);

  const setTool = (t: SandTool) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setTool(t);
    setToolState(t);
    setSizeState(eng.size);
  };
  const setSize = (n: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setSize(n);
    setSizeState(eng.size);
    updatePref({ sizes: { ...eng.sizes } });
  };
  const setLight = (id: string) => {
    const eng = engineRef.current;
    const l = LIGHTS.find((x) => x.id === id);
    if (!eng || !l) return;
    eng.setLook({ ...eng.render.look, light: l.rgb, light2: l.rgb2 });
    updatePref({ light: id });
  };
  const setSand = (id: string) => {
    const eng = engineRef.current;
    const s = SANDS.find((x) => x.id === id);
    if (!eng || !s) return;
    eng.setLook({ ...eng.render.look, sand: s.rgb });
    updatePref({ sand: id });
  };
  const toggleSound = () => {
    const on = !pref.sound;
    audioRef.current?.setEnabled(on);
    if (on) audioRef.current?.unlock();
    updatePref({ sound: on });
  };

  const undo = () => engineRef.current?.undo();
  const redo = () => engineRef.current?.redo();
  const fill = () => engineRef.current?.fill();
  const sweep = () => {
    const eng = engineRef.current;
    if (!eng || eng.empty) return;
    eng.clear();
    flash("모래를 다 쓸었어요 — 되돌리기로 다시 살릴 수 있어요");
  };
  const newDrawing = () => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.reset();
    draftRef.current = genDraftId();
    setTitle("");
    flash("새 판을 깔았어요");
  };

  /* 헤더 글자 접기 — 넘치면 부가 항목(mid) → 탭 글자(off) 순으로 버린다(그리기 화면과 같은 단계) */
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      for (const lv of ["on", "mid", "off"]) {
        el.dataset.labels = lv;
        if (el.scrollWidth <= el.clientWidth + 1) return;
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [submits, who]);

  /* 단축키: Ctrl/⌘+Z 되돌리기 · Shift+Z / Y 다시 · 1·2·3 손 고르기 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) engineRef.current?.redo();
        else engineRef.current?.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        engineRef.current?.redo();
      } else if (!mod && (e.key === "1" || e.key === "2" || e.key === "3")) {
        setTool(TOOLS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 전체화면 — 그리기 화면과 같은 규칙(API 없는 곳엔 단추를 안 보인다) */
  const [fsAvail, setFsAvail] = useState(false);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    setFsAvail(!!document.documentElement.requestFullscreen);
    const on = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const exportImage = async (kind: "submit" | "download", t?: string) => {
    const eng = engineRef.current;
    if (!eng || busy) return;
    setBusy(true);
    const draftId = draftRef.current; // 인코딩 중 새 그림으로 갈려도 이 그림의 토큰을 쓴다
    try {
      const big = eng.toCanvas(2);
      if (kind === "submit" && onSave) {
        flash("우리 반 갤러리로 보내는 중…", "ink", 8000);
        const image = await toBlob(big, "image/webp", 0.9);
        const th = document.createElement("canvas");
        const k = 400 / Math.max(eng.w, eng.h);
        th.width = Math.round(eng.w * k);
        th.height = Math.round(eng.h * k);
        const tctx = th.getContext("2d")!;
        tctx.imageSmoothingQuality = "high";
        tctx.drawImage(big, 0, 0, th.width, th.height);
        const thumb = await toBlob(th, "image/webp", 0.85);
        await onSave(image, thumb, draftId, t);
        flash("우리 반 갤러리에 전시했어요! 갤러리에서 확인해 보세요", "leaf", 3500);
      } else {
        const png = await toBlob(big, "image/png");
        const url = URL.createObjectURL(png);
        const a = document.createElement("a");
        a.href = url;
        a.download = `arton-sand-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        flash("내 기기에 그림 파일로 저장했어요", "leaf");
      }
    } catch {
      flash("저장하지 못했어요 — 잠시 후 다시 눌러 주세요");
    } finally {
      setBusy(false);
    }
  };

  /* 판을 무대에 «비율 그대로» 꽉 맞춘다 — CSS 비율+최대 높이로 하면 한쪽이 늘어나 모래가 찌그러진다 */
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !dims) return;
    const measure = () => {
      const pad = 16;
      const aw = Math.max(50, el.clientWidth - pad);
      const ah = Math.max(50, el.clientHeight - pad);
      const k = Math.min(aw / dims.w, ah / dims.h);
      setFit({ w: Math.floor(dims.w * k), h: Math.floor(dims.h * k) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims]);

  const toolInfo = TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="editor-no-pinch flex h-dvh flex-col gap-2 bg-cream p-2" data-testid="sand-editor">
      <header ref={headerRef} data-labels="on" className="editor-toolbar relative z-20 flex shrink-0 flex-wrap items-center gap-2 rounded-panel border border-ink/6 bg-paper px-3 py-2 shadow-panel sm:flex-nowrap sm:overflow-x-auto">
        <Link href={backHref} className="editor-back pressable touch-target grid place-items-center rounded-control px-3 text-xl hover:bg-surface-2" aria-label="나가기">
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
          <Link href={galleryHref} className="editor-context hdr-extra pressable touch-target flex shrink-0 items-center whitespace-nowrap rounded-control bg-surface-2 px-3 py-1 text-sm font-semibold text-ink-soft">
            우리 반 갤러리
          </Link>
        )}
        {/* 폰에선 모드 탭이 둘째 줄을 다 쓴다(다섯 개 + 단추들이 한 줄에 안 들어간다) */}
        <div className="editor-modes sand-modes order-last flex basis-full justify-center sm:order-none sm:flex-[1_0_auto] sm:basis-auto">
          <ModeTabs current="sand" />
        </div>
        {fsAvail && (
          <button onClick={toggleFs} className="pressable touch-target grid shrink-0 place-items-center rounded-control px-2 hover:bg-surface-2" aria-label={isFs ? "전체화면 끝내기" : "전체화면"} title="전체화면">
            <Icon name={isFs ? "fullscreenExit" : "fullscreen"} className="h-5 w-5" />
          </button>
        )}
        <button onClick={newDrawing} disabled={hist.empty} className="pressable touch-target grid shrink-0 place-items-center rounded-control px-2 hover:bg-surface-2 disabled:opacity-40" aria-label="새 그림" title="새 판 깔기">
          <Icon name="plus" className="h-5 w-5" />
        </button>
        <button onClick={() => setShowMovie(true)} disabled={hist.empty} className="pressable touch-target grid shrink-0 place-items-center rounded-control px-2 hover:bg-surface-2 disabled:opacity-40" aria-label="무비" title="그린 과정을 영상으로 보기" data-testid="sand-movie-btn">
          <Icon name="movie" className="h-5 w-5" />
        </button>
        {submits && (
          <button onClick={() => void exportImage("download")} disabled={busy} className="hdr-extra pressable touch-target flex shrink-0 items-center gap-1 whitespace-nowrap rounded-control bg-surface-2 px-3 text-sm font-semibold text-ink-soft" title="그림 파일(PNG)로 저장해요">
            내 기기에 저장
          </button>
        )}
        <button
          onClick={() => (submits ? setAskTitle(true) : void exportImage("download"))}
          disabled={busy}
          className="editor-save pressable touch-target ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control bg-coral px-4 font-display text-white hover:bg-coral-deep sm:ml-0"
          aria-label={submits ? "우리 반 갤러리에 보내기" : "저장하기"}
          data-testid="sand-save"
        >
          <Icon name="save" className="h-5 w-5" />
          <span className="editor-save-label">{submits ? "전시하기" : "저장"}</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
        {/* 손 고르기 + 굵기 */}
        <aside className="order-2 flex shrink-0 items-center gap-2 rounded-panel border border-ink/6 bg-paper p-2 shadow-panel md:order-1 md:w-28 md:flex-col md:items-stretch">
          <div className="flex gap-1.5 md:flex-col" role="radiogroup" aria-label="손 고르기">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={tool === t.id}
                aria-label={t.label}
                title={t.hint}
                onClick={() => setTool(t.id)}
                data-testid={`sand-tool-${t.id}`}
                className={`pressable flex min-h-14 min-w-14 flex-col items-center justify-center gap-0.5 rounded-control px-2 py-1.5 text-xs font-semibold ${
                  tool === t.id ? "bg-sun-soft text-ink ring-2 ring-sun ring-inset" : "text-ink-soft hover:bg-surface-2"
                }`}
              >
                <Icon name={t.icon} className="h-8 w-8" />
                {t.label}
              </button>
            ))}
          </div>
          <label className="flex min-w-0 flex-1 items-center gap-2 px-1 text-xs font-semibold text-ink-soft md:flex-none md:flex-col md:items-stretch">
            <span className="shrink-0">굵기 {size}</span>
            <input
              type="range"
              min={3}
              max={80}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              aria-label="굵기"
              data-testid="sand-size"
              className="min-h-11 w-full min-w-24 accent-coral"
            />
          </label>
        </aside>

        {/* 모래판 */}
        <div ref={stageRef} className="canvas-stage relative order-1 grid min-h-0 min-w-0 flex-1 place-items-center rounded-panel bg-[#17110c] p-2 md:order-2">
          <canvas
            ref={canvasRef}
            data-testid="sand-canvas"
            aria-label="모래판"
            className="canvas-surface touch-none select-none rounded-[10px]"
            style={{ width: fit ? fit.w : 0, height: fit ? fit.h : 0, cursor: "crosshair", ...lightGlow(pref.light) }}
          />
          {!ready && <p className="absolute font-display text-cream">모래판을 깔고 있어요…</p>}
          <div className="absolute bottom-3 left-3 flex gap-2">
            <button onClick={undo} disabled={!hist.undo} className="pressable touch-target grid h-12 w-12 place-items-center rounded-full bg-paper/90 shadow-panel disabled:opacity-40" aria-label="되돌리기" data-testid="sand-undo">
              <Icon name="undo" className="h-6 w-6" />
            </button>
            <button onClick={redo} disabled={!hist.redo} className="pressable touch-target grid h-12 w-12 place-items-center rounded-full bg-paper/90 shadow-panel disabled:opacity-40" aria-label="다시 하기" data-testid="sand-redo">
              <Icon name="redo" className="h-6 w-6" />
            </button>
          </div>
          <p className="pointer-events-none absolute right-3 top-3 hidden rounded-full bg-ink/55 px-3 py-1 text-xs font-semibold text-cream sm:block">
            {toolInfo.hint}
          </p>
        </div>

        {/* 빛·모래·판 */}
        <aside className="order-3 flex min-w-0 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-ink/6 bg-paper p-2 shadow-panel md:w-44 md:flex-col md:flex-nowrap md:items-stretch">
          <fieldset className="flex w-full min-w-0 flex-col gap-1">
            <legend className="mb-1 text-xs font-semibold text-ink-soft">빛 색</legend>
            {/* 폰: 한 줄 옆 넘기기(빛 11·모래 8을 접어 쌓으면 판이 작아져 세로 판을 못 깐다) · md 이상: 접어 쌓기 */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
              {LIGHTS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLight(l.id)}
                  aria-label={l.label}
                  aria-pressed={pref.light === l.id}
                  title={l.label}
                  data-testid={`sand-light-${l.id}`}
                  className={`pressable h-11 w-11 shrink-0 rounded-full border-2 ${pref.light === l.id ? "border-ink ring-2 ring-sun" : "border-ink/15"}`}
                  style={{
                    background: l.rgb2
                      ? `linear-gradient(180deg, rgb(${l.rgb.join(",")}), rgb(${l.rgb2.join(",")}))`
                      : `radial-gradient(circle at 40% 35%, #fff, rgb(${l.rgb.join(",")}) 70%)`,
                  }}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="flex w-full min-w-0 flex-col gap-1">
            <legend className="mb-1 text-xs font-semibold text-ink-soft">모래 색</legend>
            {/* 폰: 한 줄 옆 넘기기(빛 11·모래 8을 접어 쌓으면 판이 작아져 세로 판을 못 깐다) · md 이상: 접어 쌓기 */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
              {SANDS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSand(s.id)}
                  aria-label={s.label}
                  aria-pressed={pref.sand === s.id}
                  title={s.label}
                  data-testid={`sand-color-${s.id}`}
                  className={`pressable h-11 w-11 shrink-0 rounded-full border-2 ${pref.sand === s.id ? "border-ink ring-2 ring-sun" : "border-ink/15"}`}
                  style={{ background: `rgb(${s.rgb.join(",")})` }}
                />
              ))}
            </div>
          </fieldset>
          <div className="flex gap-1.5 md:flex-col">
            <button onClick={fill} className="pressable touch-target flex items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-sm font-semibold text-ink" data-testid="sand-fill" title="판 전체에 모래를 고르게 깔아요">
              <Icon name="sandFill" className="h-6 w-6" />
              모래 쏟기
            </button>
            <button onClick={sweep} disabled={hist.empty} className="pressable touch-target flex items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-sm font-semibold text-ink disabled:opacity-40" data-testid="sand-sweep" title="판의 모래를 모두 쓸어 내요">
              <Icon name="sweep" className="h-6 w-6" />
              모두 쓸기
            </button>
            <button onClick={toggleSound} aria-pressed={pref.sound} className="pressable touch-target flex items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-sm font-semibold text-ink" data-testid="sand-sound" title="모래 소리 켜고 끄기">
              <Icon name={pref.sound ? "sound" : "soundOff"} className="h-6 w-6" />
              소리 {pref.sound ? "켜짐" : "꺼짐"}
            </button>
          </div>
        </aside>
      </div>

      {toast && <Toast tone={toast.tone}>{toast.text}</Toast>}
      {askTitle && (
        <TitleAsk
          initial={title}
          onCancel={(d) => {
            setTitle(d);
            setAskTitle(false);
          }}
          onDone={(t) => {
            setAskTitle(false);
            if (t) setTitle(t);
            void exportImage("submit", t);
          }}
        />
      )}
      {showMovie && engineRef.current && <SandMovie engine={engineRef.current} onClose={() => setShowMovie(false)} />}
    </div>
  );
}
