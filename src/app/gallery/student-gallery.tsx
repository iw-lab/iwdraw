"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArtonLogo } from "@/components/arton-logo";
import { getStudentSession } from "@/lib/student-session";
import { groupByDay } from "@/lib/day-group";
import { GALLERY_GRID, GallerySizeControl, useGallerySize } from "@/components/gallery-size";
import {
  fetchStudentImage,
  listClassGallery,
  toggleLike,
  type GalleryItem,
} from "@/lib/student-api";

const SandReplay = dynamic(() => import("@/components/sand/SandReplay").then((m) => m.SandReplay), { ssr: false });

/*
 * 학생용 학급 갤러리 — 저장(제출)하면 바로 전시되고, 날짜별로 모아 보여주며 좋아요를
 * 누를 수 있다. 학생 세션(Bearer)이 필요해 이미지도 fetch→blob URL로 로드한다.
 * (승인 게이트는 비활성 — is_approved 분기는 되살릴 때를 위해 보존)
 */
export function StudentGallery() {
  // 정적 export의 프리렌더(세션 없음)와 실제 클라이언트(세션 있음)가 통째로 다른
  // 트리를 그리므로, 마운트 후에 세션을 읽어 hydration 불일치를 피한다.
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStudentSession>>(null);
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [expired, setExpired] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [big, setBig] = useState<GalleryItem | null>(null);
  const [bigUrl, setBigUrl] = useState<string | null>(null);
  const [size, setSize] = useGallerySize();

  useEffect(() => {
    setSession(getStudentSession());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      const list = await listClassGallery();
      if (list === null) {
        // 학생 토큰(6시간)이 만료됐거나 네트워크 오류 — 빈 갤러리로 오표시하지 않는다
        setExpired(true);
        setItems([]);
        return;
      }
      setItems(list);
      const entries = await Promise.all(
        // created_at을 버전으로 — 재저장(dedup)은 경로를 재사용하므로 이게 없으면 옛 그림이 남는다
        list.map(async (a) => [a.id, (await fetchStudentImage(a.thumb_path, a.created_at)) ?? ""] as const),
      );
      setUrls(Object.fromEntries(entries));
    })();
  }, [session]);

  useEffect(() => {
    if (!big) {
      setBigUrl(null);
      return;
    }
    // 연달아 다른 작품을 클릭해도 늦게 도착한 응답이 최신 선택을 덮지 않게 가드
    let stale = false;
    void fetchStudentImage(big.image_path, big.created_at).then((u) => {
      if (!stale) setBigUrl(u);
    });
    return () => {
      stale = true;
    };
  }, [big]);

  const like = async (a: GalleryItem) => {
    // 낙관적 갱신 → 서버 응답으로 확정, 실패(토큰 만료 등)면 클릭 전 상태(a)로 롤백
    setItems(
      (prev) =>
        prev?.map((x) =>
          x.id === a.id ? { ...x, liked: !x.liked, like_count: x.like_count + (x.liked ? -1 : 1) } : x,
        ) ?? null,
    );
    const res = await toggleLike(a.id);
    setItems(
      (prev) =>
        prev?.map((x) =>
          x.id === a.id
            ? res
              ? { ...x, liked: res.liked, like_count: res.like_count }
              : { ...x, liked: a.liked, like_count: a.like_count } // 롤백
            : x,
        ) ?? null,
    );
  };

  if (!mounted) return null;

  if (!session) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="font-display text-2xl text-ink">학급에 먼저 입장해 주세요</p>
          <p className="mt-2 text-ink-soft">선생님이 알려준 학급 코드로 들어오면 갤러리를 볼 수 있어요.</p>
          <Link
            href="/join"
            className="pressable mt-6 inline-block rounded-card bg-coral px-6 py-3 font-display text-white shadow-soft"
          >
            학급 코드로 입장하기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-cream-deep bg-cream/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/draw" className="pressable touch-target rounded-card px-2 text-xl" aria-label="그리기로">
            ←
          </Link>
          <ArtonLogo className="h-8" />
        </div>
        <span className="text-sm text-ink-soft">
          {session.className} · {session.nickname}
        </span>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-3xl text-ink">우리 반 갤러리 🖼️</h1>
          <GallerySizeControl size={size} onChange={setSize} />
        </div>
        <p className="mt-2 text-ink-soft">우리 반 친구들의 작품이에요. 마음에 드는 그림에 ❤를 눌러 주세요.</p>

        {items === null ? (
          <div className="mt-16 text-center text-ink-faint">작품을 불러오는 중…</div>
        ) : expired ? (
          <div className="mt-10 rounded-card bg-paper p-10 text-center text-ink-soft shadow-soft">
            시간이 지나 연결이 끊겼어요. 학급 코드로 다시 입장해 주세요.
            <div className="mt-4">
              <Link
                href="/join"
                className="pressable inline-block rounded-card bg-coral px-6 py-3 font-display text-white shadow-soft"
              >
                다시 입장하기
              </Link>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="mt-10 rounded-card bg-paper p-10 text-center text-ink-soft shadow-soft">
            아직 전시된 작품이 없어요. 멋진 그림을 그려서 저장하면
            <br />
            바로 여기에 전시돼요!
          </div>
        ) : (
          groupByDay(items, (a) => a.created_at).map((g) => (
            <section key={g.key} className="mt-6">
              <h2 className="flex items-center gap-2 font-display text-lg text-ink">
                📅 {g.label}
                <span className="text-sm font-normal text-ink-faint">{g.items.length}점</span>
              </h2>
              <div className={`mt-2 grid gap-3 ${GALLERY_GRID[size]}`}>
                {g.items.map((a) => (
              <div key={a.id} className="overflow-hidden rounded-card bg-paper shadow-soft">
                <button
                  onClick={() => setBig(a)}
                  className="block aspect-square w-full bg-white"
                  aria-label={`${a.nickname} 작품 크게 보기`}
                >
                  {urls[a.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[a.id]} alt={`${a.nickname} 작품`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-cream-deep" />
                  )}
                </button>
                {/* 제목이 있으면 그림 바로 아래에 — 아이들이 가장 먼저 보는 줄이다 */}
                {a.title && (
                  <p className="truncate px-3 pt-2 font-display text-sm text-ink" title={a.title}>
                    {a.title}
                  </p>
                )}
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="truncate text-sm font-semibold text-ink">
                    {a.nickname}
                    {a.mine && <span className="ml-1 text-xs text-coral">나</span>}
                  </span>
                  {a.is_approved ? (
                    <button
                      onClick={() => like(a)}
                      aria-pressed={a.liked}
                      className={`pressable rounded-full px-2 py-1 text-sm font-semibold ${
                        a.liked ? "bg-coral/15 text-coral" : "text-ink-faint hover:text-coral"
                      }`}
                    >
                      {a.liked ? "❤" : "🤍"} {a.like_count}
                    </button>
                  ) : (
                    <span className="rounded-full bg-cream-deep px-2 py-1 text-xs text-ink-soft">
                      선생님 확인 중
                    </span>
                  )}
                </div>
              </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {big && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-3 sm:p-6"
          onClick={() => setBig(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-h-[92dvh] w-full max-w-4xl overflow-auto rounded-bubble bg-paper p-3 shadow-lift sm:p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {bigUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={bigUrl}
                alt={`${big.nickname} 작품`}
                className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-card sm:max-h-[78dvh]"
              />
            ) : (
              <div className="mx-auto grid h-56 w-full max-w-sm place-items-center text-ink-faint sm:h-64">
                불러오는 중…
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-2 px-1">
              <span className="min-w-0 truncate font-display text-lg text-ink">
                {big.title ? (
                  <>
                    {big.title} <span className="text-base text-ink-soft">· {big.nickname}</span>
                  </>
                ) : (
                  big.nickname
                )}
              </span>
              {big.mode === "sand" && big.timelapse_path?.endsWith(".sand") && (
                <SandReplay
                  key={big.id}
                  load={async () => {
                    const u = await fetchStudentImage(big.timelapse_path!, big.created_at);
                    return u ? await (await fetch(u)).blob() : null;
                  }}
                />
              )}
              <button
                onClick={() => setBig(null)}
                className="pressable shrink-0 rounded-card bg-ink px-5 py-2 font-display text-white"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
