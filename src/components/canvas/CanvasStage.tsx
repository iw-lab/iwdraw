"use client";

import { useEffect, useRef, useState } from "react";
import { ArtEngine } from "@/engine/ArtEngine";
import { useEditor } from "@/store/editor";
import type { Mode } from "@/engine/types";
import { fitAspectHelper } from "@/lib/aspect";
import { loadPaperPack } from "@/engine/core/paperPack";

/*
 * CanvasStage: 실제 캔버스 DOM을 만들고 ArtEngine을 마운트한다.
 * 캔버스 해상도는 "도안 비율"에 맞춰 결정한다(세로 도안 → 세로 캔버스).
 * 폰(세로)에선 꽉 차고, 크롬북(가로)에선 색칠지처럼 가운데 세로로 표시 — 도안 재생성 불필요.
 * 빈 캔버스는 orientation(가로/세로)으로 결정.
 * 바깥은 어두운 작업대(bg), 종이(캔버스)만 하얗게 — 그릴 수 있는 영역이 한눈에 보인다.
 */
export interface CanvasStageProps {
  /** 색칠 모드 초기 도안 URL */
  lineartSrc?: string;
  /** 그대로 이어 그리기 — 변환 없이 그림 레이어에 까는 원본 이미지 */
  baseSrc?: string;
  /** 초기 모드(랜딩에서 ?mode=... 로 진입) */
  initialMode?: Mode;
  /** 빈 캔버스 방향 */
  orientation?: "landscape" | "portrait";
  onEngineReady?: (engine: ArtEngine) => void;
}

const fitCanvasSize = fitAspectHelper;

function loadImageSize(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight || 1);
    img.onerror = () => resolve(4 / 3);
    img.src = src;
  });
}

export function CanvasStage({
  lineartSrc,
  baseSrc,
  initialMode,
  orientation = "landscape",
  onEngineReady,
}: CanvasStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ArtEngine | null>(null);
  const attach = useEditor((s) => s.attach);
  const detach = useEditor((s) => s.detach);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // 1단계: 캔버스 크기 결정(도안 비율 또는 방향)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 종이 결 팩은 엔진보다 먼저 — 결은 획에 구워져서 그림 도중엔 바꿀 수 없다(paperPack.ts)
      const pack = loadPaperPack();
      let aspect: number;
      if (lineartSrc) aspect = await loadImageSize(lineartSrc);
      else if (baseSrc) aspect = await loadImageSize(baseSrc);
      else aspect = orientation === "portrait" ? 1152 / 1536 : 1536 / 1152;
      await pack;
      if (!cancelled) setSize(fitCanvasSize(aspect));
    })();
    return () => {
      cancelled = true;
    };
  }, [lineartSrc, baseSrc, orientation]);

  // 2단계: 크기 확정 후 엔진 마운트
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !size) return;
    // QA용 백엔드 강제(?backend=2d|gl) — gl은 headless 테스트에서 SwiftShader 허용
    const param = new URLSearchParams(window.location.search).get("backend");
    const backendOverride = param === "2d" || param === "gl" ? param : undefined;
    const engine = new ArtEngine({
      width: size.width,
      height: size.height,
      display: el,
      // 작업대(캔버스 + 여백)에서 포인터를 받는다 — 캔버스는 도안 비율에 맞춰 fit돼서
      // 사방에 여백이 남고, 두 손가락 중 하나가 그 여백에 닿으면 핀치가 통째로 무산됐다
      // (2026-08-21 실측: 확대 배율 1.00 · 대신 남은 손가락이 획을 그림)
      surface: stageRef.current ?? undefined,
      backendOverride,
    });
    engineRef.current = engine;
    // QA/디버그 핸들 — 확대 배율 등 내부 상태를 e2e에서 실측한다
    (window as unknown as { __artonEngine?: ArtEngine }).__artonEngine = engine;
    attach(engine);
    const store = useEditor.getState();
    if (lineartSrc) {
      store.setMode("coloring");
      void engine.loadLineart(lineartSrc);
    } else if (baseSrc) {
      // 그대로 이어 그리기 — 원본을 그림 레이어에 깔고 자유 그리기 모드
      if (initialMode) store.setMode(initialMode);
      void engine.loadBaseImage(baseSrc);
    } else if (initialMode) {
      store.setMode(initialMode);
    }
    onEngineReady?.(engine);
    // 데스크톱 트랙패드/마우스 줌(ctrl+wheel)은 touch-action·viewport 잠금으로 못 막는다
    // — 크로뮴이 이걸 브라우저 페이지 줌으로 처리하면 새로고침해도 확대가 안 풀린다(JS로
    // 페이지 줌 리셋 불가). 캔버스 위에서 가로채 앱 뷰 줌으로 돌리면 새로고침 시 리셋된다.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // 핀치/줌 제스처만(일반 스크롤은 통과)
      e.preventDefault();
      // deltaY<0 = 확대. 감도 완만하게(트랙패드는 delta가 크게 들어온다)
      const factor = Math.exp(-e.deltaY * 0.01);
      engine.zoomBy(factor, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      detach();
      engine.destroy();
      engineRef.current = null;
    };
    // size 확정 시 1회 마운트
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return (
    <div
      ref={stageRef}
      className="canvas-stage flex h-full w-full items-center justify-center overflow-hidden rounded-card bg-cream-deep/60 p-2 md:p-4"
    >
      {size && (
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          className="canvas-surface h-auto max-h-full w-auto max-w-full rounded-md bg-white shadow-lift"
          style={{
            aspectRatio: `${size.width}/${size.height}`,
            touchAction: "none",
            // 엔진이 백킹을 DPR 배율로 키운다(레티나·줌 선명도) — 화면 레이아웃 크기는
            // 논리 해상도 기준을 유지(거대 모니터에서 캔버스가 2배로 커지는 것 방지)
            maxWidth: `min(100%, ${size.width}px)`,
            maxHeight: `min(100%, ${size.height}px)`,
          }}
          aria-label="그림 캔버스"
        />
      )}
    </div>
  );
}
