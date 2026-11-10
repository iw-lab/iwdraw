"use client";

import { getStudentSession } from "./student-session";
import { hasBackend } from "./backend";
import { apiFetch } from "./api";
import { withStudentAuth } from "./student-auth";

/*
 * 학생 데이터 액세스 — Bearer JWT(학생 세션)로 자기 학급만 접근.
 * <img>는 Authorization 헤더를 못 보내므로 이미지는 fetch→blob URL로 로드한다.
 */

export interface GalleryItem {
  id: string;
  mode: string;
  thumb_path: string;
  image_path: string;
  /** 샌드아트 «그린 과정 기록»(.sand) — 없으면 null */
  timelapse_path?: string | null;
  like_count: number;
  created_at: number;
  nickname: string;
  /** 학생이 붙인 제목(없으면 null) */
  title: string | null;
  liked: boolean;
  mine: boolean;
  /** false = 본인 작품이지만 아직 선생님 승인 대기 */
  is_approved: boolean;
}

export interface Assignment {
  id: string;
  template_id: string;
  title: string;
  image: string;
  note: string;
  created_at: number;
}

/** null = 오류(토큰 만료 등 — 재입장 안내), [] = 정말로 전시작 없음 */
export async function listClassGallery(): Promise<GalleryItem[] | null> {
  if (!hasBackend()) return null;
  try {
    // 401(6시간 토큰 만료)이면 조용히 재입장해 1회 재시도 — 아이에겐 끊김이 안 보인다
    const res = await withStudentAuth((h) => apiFetch("/student/gallery", { headers: h }));
    if (!res?.ok) return null;
    return (await res.json()) as GalleryItem[];
  } catch {
    return null;
  }
}

export async function toggleLike(
  artworkId: string,
): Promise<{ liked: boolean; like_count: number } | null> {
  if (!hasBackend()) return null;
  try {
    const res = await withStudentAuth((h) =>
      apiFetch(`/student/artworks/${artworkId}/like`, { method: "POST", headers: h }),
    );
    if (!res?.ok) return null;
    return (await res.json()) as { liked: boolean; like_count: number };
  } catch {
    return null;
  }
}

export async function getAssignment(): Promise<Assignment | null> {
  if (!hasBackend()) return null;
  try {
    const res = await withStudentAuth((h) => apiFetch("/student/assignment", { headers: h }));
    if (!res?.ok) return null;
    const data = (await res.json()) as { assignment: Assignment | null };
    return data.assignment;
  } catch {
    return null;
  }
}

// blob URL 캐시 — 같은 썸네일 재fetch 방지(학급 갤러리 ≤200장).
// 학생이 바뀌면(같은 탭에서 재입장) 이전 학생 것을 재사용하지 않도록 소유자 기준으로
// 전체 revoke 후 비운다(메모리 해제 겸 권한 경계 유지).
const blobCache = new Map<string, string>();
let blobCacheOwner: string | null = null;

/**
 * @param version 작품의 created_at. dedup 덮어쓰기는 R2 경로를 그대로 재사용하므로, 경로만 캐시 키로
 *   쓰면 갱신된 그림이 옛 버전으로 계속 보인다(서버도 10분 캐시). 저장 시각을 키·쿼리에 얹어 무효화.
 */
export async function fetchStudentImage(path: string, version?: number): Promise<string | null> {
  if (!hasBackend() || !getStudentSession()) return null;
  const owner = getStudentSession()?.studentId ?? null;
  if (owner !== blobCacheOwner) {
    for (const url of blobCache.values()) URL.revokeObjectURL(url);
    blobCache.clear();
    blobCacheOwner = owner;
  }
  const key = version ? `${path}#${version}` : path;
  const cached = blobCache.get(key);
  if (cached) return cached;
  try {
    const res = await withStudentAuth((h) =>
      apiFetch(
        `/student/file?path=${encodeURIComponent(path)}${version ? `&v=${version}` : ""}`,
        { headers: h },
      ),
    );
    if (!res?.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    blobCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
