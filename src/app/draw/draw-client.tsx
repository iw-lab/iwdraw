"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Editor } from "@/components/canvas/Editor";
import { getStudentSession } from "@/lib/student-session";
import { submitArtwork } from "@/lib/artwork-client";
import { getAssignment, type Assignment } from "@/lib/student-api";
import type { Mode } from "@/engine/types";

const MODES: Mode[] = ["sketch", "watercolor", "oil", "coloring"];

/*
 * /draw — 메인 캔버스.
 *  ?template=<path> 색칠 도안, ?mode=<mode>
 * 학생 세션이 있으면 저장 시 작품 제출, 없으면(교사 미리보기) 로컬 다운로드.
 * 학생 세션 + 선생님이 배포한 도안이 있으면 하단 배너로 안내한다.
 */
export function DrawClient() {
  const params = useSearchParams();
  const router = useRouter();
  const templateParam = params.get("template") ?? undefined;
  // 사진→도안 변환본은 sessionStorage에 저장됨(게스트, 백엔드 불필요)
  const template =
    templateParam === "custom" && typeof window !== "undefined"
      ? sessionStorage.getItem("arton.customLineart") ?? undefined
      : templateParam;
  // 그대로 이어 그리기: 변환 없이 그림 레이어에 까는 원본(게스트, sessionStorage)
  const baseSrc =
    params.get("base") === "custom" && typeof window !== "undefined"
      ? sessionStorage.getItem("arton.customBase") ?? undefined
      : undefined;
  const modeParam = params.get("mode");
  const initialMode = MODES.includes(modeParam as Mode) ? (modeParam as Mode) : undefined;
  // 진입 고유 토큰 — 같은 ?base=custom/?template=custom URL로 재진입해도 캔버스를 새로
  // 마운트시켜 새 이미지가 반드시 로드되게 한다(2회차 이어그리기 무반응 방지)
  const navKey = params.get("v") ?? undefined;
  const session = getStudentSession();

  // 선생님이 배포한 도안(과제) — 이미 그 도안을 연 상태가 아니면 배너로 안내
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!session) return;
    void getAssignment().then(setAssignment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showBanner = !!assignment && !dismissed && templateParam !== assignment.image;

  const handleSave = useCallback(
    async (image: Blob, thumb: Blob, draftId?: string, title?: string) => {
      if (!session) {
        // 학생 세션 없음 → 로컬 다운로드로 폴백(원본 확장자에 맞춰 저장)
        const ext = image.type === "image/webp" ? "webp" : "png";
        const url = URL.createObjectURL(image);
        const a = document.createElement("a");
        a.href = url;
        a.download = `arton-${Date.now()}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      return await submitArtwork({
        image,
        thumb,
        mode: (params.get("mode") as string) ?? "sketch",
        draftId,
        title,
      });
    },
    [session, params],
  );

  return (
    <>
      <Editor
        lineartSrc={template}
        baseSrc={baseSrc}
        navKey={navKey}
        initialMode={initialMode}
        onSave={session ? handleSave : undefined}
        who={session ? `${session.nickname} · ${session.className}` : undefined}
        backHref={template ? "/coloring" : "/"}
        galleryHref={session ? "/gallery" : undefined}
      />
      {/* bottom-20: 에디터 저장 토스트(bottom-6)와 겹치지 않게 위로 */}
      {showBanner && assignment && (
        <div className="fixed bottom-20 left-1/2 z-40 flex w-[min(92vw,520px)] -translate-x-1/2 items-center gap-3 rounded-bubble bg-paper p-3 shadow-lift">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-card bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assignment.image} alt="" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-ink">📋 선생님이 내주신 도안</p>
            <p className="truncate text-sm text-ink-soft">
              {assignment.title || "오늘의 도안"}
              {assignment.note ? ` — ${assignment.note}` : ""}
            </p>
          </div>
          <button
            onClick={() =>
              router.push(`/draw?template=${encodeURIComponent(assignment.image)}&mode=coloring`)
            }
            className="pressable shrink-0 rounded-card bg-coral px-4 py-2 font-display text-white shadow-soft"
          >
            시작하기
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="pressable shrink-0 rounded-full px-2 text-ink-faint"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
