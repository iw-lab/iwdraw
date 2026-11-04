"use client";

import { useCallback } from "react";
import { SandEditor } from "@/components/sand/SandEditor";
import { getStudentSession } from "@/lib/student-session";
import { submitArtwork } from "@/lib/artwork-client";

/*
 * /sand — 샌드아트(라이트박스 모래 그림).
 * 학생 세션이 있으면 «전시하기» = 학급 갤러리 제출(mode=sand), 없으면 내 기기에 PNG 저장.
 */
export function SandClient() {
  const session = getStudentSession();
  const handleSave = useCallback(
    async (image: Blob, thumb: Blob, draftId?: string, title?: string) =>
      await submitArtwork({ image, thumb, mode: "sand", draftId, title }),
    [],
  );
  return (
    <SandEditor
      onSave={session ? handleSave : undefined}
      who={session ? `${session.nickname} · ${session.className}` : undefined}
      galleryHref={session ? "/gallery" : undefined}
    />
  );
}
