"use client";

import { hasBackend } from "./backend";
import { apiFetch } from "./api";

/* 교사 데이터 액세스 — Worker(/api)가 세션 쿠키로 자기 학급만 접근 강제. */

export interface ClassRow {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: number;
  student_count?: number;
  expiring_soon?: number; // 삭제 30일 이내 작품 수(대시보드 임박 배너용)
}

export interface ArtworkRow {
  id: string;
  student_id: string;
  mode: string;
  thumb_path: string;
  image_path: string;
  is_approved: boolean;
  like_count: number;
  created_at: number;
  nickname?: string;
  /** 학생이 붙인 제목(없으면 null) — 서버가 항상 내려주므로 옵셔널이 아니다(학생 API와 동일) */
  title: string | null;
  expires_at?: number; // 이 시각 이후 자동 삭제(보관 180일). 30일 이내면 갤러리에 배지
  /** 선행쌤 작품 전시관에 건 때(없으면 전시 안 함) — 밖에는 그림만, 별명·제목은 안 나간다 */
  showcase_at?: number | null;
  /** 선행쌤 화면 «숨겨 주세요» 신고로 내려간 때(없으면 null) */
  showcase_report?: number | null;
}

/** 회원 탈퇴 — 비밀번호 재확인 후 계정·개인정보·작품을 영구 파기. 성공 시 세션도 무효화됨. */
export async function deleteAccount(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasBackend()) return { ok: false, error: "offline" };
  try {
    const res = await apiFetch("/teacher/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? "server" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function listClasses(): Promise<ClassRow[]> {
  if (!hasBackend()) return [];
  try {
    const res = await apiFetch("/classes");
    if (!res.ok) return [];
    return (await res.json()) as ClassRow[];
  } catch {
    return [];
  }
}

export async function createClass(name: string): Promise<ClassRow | null> {
  if (!hasBackend()) return null;
  try {
    const res = await apiFetch("/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "우리 반" }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ClassRow;
  } catch {
    return null;
  }
}

export async function toggleClassActive(id: string, active: boolean): Promise<void> {
  if (!hasBackend()) return;
  try {
    await apiFetch(`/classes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: active }),
    });
  } catch {
    /* 네트워크 오류 무시(UI는 다음 새로고침에 복원) */
  }
}

export async function regenerateCode(id: string): Promise<string | null> {
  if (!hasBackend()) return null;
  try {
    const res = await apiFetch(`/classes/${id}/code`, { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as { code?: string };
    return data.code ?? null;
  } catch {
    return null;
  }
}

export interface StudentRow {
  id: string;
  nickname: string;
  created_at: number;
  artwork_count: number;
  last_artwork_at: number | null;
}

/** 학급 학생(별명) 명단 — 아이가 별명을 까먹으면 선생님이 찾아 알려준다 */
export async function listStudents(classId: string): Promise<StudentRow[]> {
  if (!hasBackend()) return [];
  try {
    const res = await apiFetch(`/classes/${classId}/students`);
    if (!res.ok) return [];
    return (await res.json()) as StudentRow[];
  } catch {
    return [];
  }
}

export async function listArtworks(classId: string): Promise<ArtworkRow[]> {
  if (!hasBackend()) return [];
  try {
    const res = await apiFetch(`/classes/${classId}/artworks`);
    if (!res.ok) return [];
    return (await res.json()) as ArtworkRow[];
  } catch {
    return [];
  }
}

/** 작품 영구 삭제(교사 큐레이션) — 원본·썸네일·타임랩스와 좋아요까지 지워진다 */
export async function deleteArtwork(id: string): Promise<boolean> {
  if (!hasBackend()) return false;
  try {
    const res = await apiFetch(`/artworks/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/** 선행쌤 작품 전시관에 걸기/내리기 — 성공하면 true */
export async function setShowcase(id: string, on: boolean, checked = false, sido = ""): Promise<boolean> {
  if (!hasBackend()) return false;
  try {
    // 걸 때는 «그림 안에 이름·학교·얼굴 사진이 없다(있으면 가렸다)» 확인이 있어야 서버가 받는다
    const res = await apiFetch(`/artworks/${id}/showcase`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on, checked, sido }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 전시관에만 보일 «이름 가린 사본» 올리기(학생 원본·학급 썸네일은 그대로) — 성공하면 true */
export async function uploadShowcaseImage(id: string, img: Blob): Promise<boolean> {
  if (!hasBackend()) return false;
  try {
    const res = await apiFetch(`/artworks/${id}/showcase-image`, { method: "PUT", headers: { "Content-Type": img.type || "image/webp" }, body: img });
    return res.ok;
  } catch {
    return false;
  }
}

/** (보존 — 승인 게이트 비활성 중이라 UI에선 미사용. 되살릴 때 그대로 사용) */
export async function approveArtwork(id: string, approved: boolean): Promise<void> {
  if (!hasBackend()) return;
  try {
    await apiFetch(`/artworks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_approved: approved }),
    });
  } catch {
    /* 네트워크 오류 무시 */
  }
}

/* ── 도안 배포(과제) ── */
export interface AssignmentRow {
  id: string;
  template_id: string;
  title: string;
  image: string;
  note: string;
  created_at: number;
}

export async function getClassAssignment(classId: string): Promise<AssignmentRow | null> {
  if (!hasBackend()) return null;
  try {
    const res = await apiFetch(`/classes/${classId}/assignment`);
    if (!res.ok) return null;
    const data = (await res.json()) as { assignment: AssignmentRow | null };
    return data.assignment;
  } catch {
    return null;
  }
}

export async function setClassAssignment(
  classId: string,
  a: { template_id: string; title: string; image: string; note?: string },
): Promise<boolean> {
  if (!hasBackend()) return false;
  try {
    const res = await apiFetch(`/classes/${classId}/assignment`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearClassAssignment(classId: string): Promise<void> {
  if (!hasBackend()) return;
  try {
    await apiFetch(`/classes/${classId}/assignment`, { method: "DELETE" });
  } catch {
    /* 네트워크 오류 무시 */
  }
}

/* 작품 이미지 URL — same-origin Worker가 교사 쿠키로 소유 검증 후 R2에서 스트리밍.
 * <img src>로 쓰면 same-origin이라 세션 쿠키가 자동 전송된다(Supabase signed URL 대체). */
export async function signedUrl(path: string): Promise<string | null> {
  if (!hasBackend()) return null;
  return `/api/artwork/file?path=${encodeURIComponent(path)}`;
}
