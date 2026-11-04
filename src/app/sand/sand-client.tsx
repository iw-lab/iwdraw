"use client";

import { useCallback, useEffect, useState } from "react";
import { SandEditor } from "@/components/sand/SandEditor";
import { getStudentSession, type StudentSession } from "@/lib/student-session";
import { submitArtwork } from "@/lib/artwork-client";

/*
 * /sand — 샌드아트(라이트박스 모래 그림).
 * 학생 세션이 있으면 «전시하기» = 학급 갤러리 제출(mode=sand), 없으면 내 기기에 PNG 저장.
 */
export function SandClient() {
  // 학생 세션(sessionStorage)은 마운트 뒤에 읽는다 — 정적으로 미리 만든 HTML 에는 세션이 없어
  // 렌더 중에 읽으면 단추 글자(저장 ↔ 전시하기)가 어긋나 React #418(하이드레이션 불일치)이 난다(실측)
  const [session, setSession] = useState<StudentSession | null>(null);
  useEffect(() => setSession(getStudentSession()), []);
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
