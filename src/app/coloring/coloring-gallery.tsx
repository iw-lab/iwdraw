"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArtonLogo } from "@/components/arton-logo";
import { Chip } from "@/components/ui";
import { PhotoImport, type PhotoImportHandle } from "@/components/photo-import";
import { printImageA4 } from "@/lib/print";
import {
  GRADE_LABEL,
  loadTemplateManifest,
  type TemplateItem,
  type TemplateManifest,
} from "@/lib/templates";

type Grade = "all" | "low" | "mid" | "high";

/* 한 화면에 실제로 마운트하는 카드 수의 상한.
 *
 * 예전엔 필터에 걸린 도안을 **전부** 걸었다 = 기본 화면에 1344장. 이미지 요소만 1344개라
 * DOM 이 1만 노드를 넘고 콜드 전송이 6MB 였다(2026-09-02 실측). lazy 로딩이 있어도
 * 요소·레이아웃 비용은 그대로 든다.
 *
 * "더 보기"로 늘리는 방식은 채택하지 않았다 — 늘기만 하고 줄지 않아 결국 1344 로 돌아간다.
 * 대신 **테마를 먼저 고르게** 한다: 첫 화면은 테마 커버 41장, 테마를 누르면 그 안(≤122)만.
 * 이 상한은 그중에서도 가장 큰 테마(명화 122장)에 대한 마지막 안전망이다. */
const MAX_MOUNTED = 120;

export function ColoringGallery() {
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [cat, setCat] = useState<string>("all");
  const [grade, setGrade] = useState<Grade>("all");
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<PhotoImportHandle>(null);

  useEffect(() => {
    loadTemplateManifest().then(setManifest).catch((e) => setError(String(e.message ?? e)));
  }, []);

  const themes = useMemo(() => {
    if (!manifest) return [];
    return Object.values(manifest.themes).filter(
      (t) => cat === "all" || t.category === cat,
    );
  }, [manifest, cat]);

  // 열어 둔 테마가 카테고리 필터 밖으로 밀려나면 테마 격자로 되돌린다
  const theme = openTheme ? themes.find((t) => t.theme === openTheme) ?? null : null;
  useEffect(() => {
    if (openTheme && !themes.some((t) => t.theme === openTheme)) setOpenTheme(null);
  }, [openTheme, themes]);

  const items = useMemo(() => {
    if (!theme) return [];
    const out: (TemplateItem & { theme: string })[] = [];
    for (const it of theme.items) {
      if (grade === "all" || it.grade === grade) out.push({ ...it, theme: theme.theme });
    }
    return out;
  }, [theme, grade]);
  const shown = items.slice(0, MAX_MOUNTED);
  const totalCount = useMemo(
    () => themes.reduce((n, t) => n + t.items.length, 0),
    [themes],
  );

  // 붙여넣기(Ctrl+V)로 이미지 가져오기 — 구글 등에서 이미지 복사 후 바로 붙여넣는 흐름
  // (시작 방식 모달·변환·이동은 PhotoImport 공용 컴포넌트가 담당)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        setError(null);
        photoRef.current?.openFile(f);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <main
      className="min-h-dvh"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) {
          setError(null);
          photoRef.current?.openFile(f);
        }
      }}
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-cream-deep bg-cream/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/" className="pressable touch-target rounded-card px-2 text-xl" aria-label="홈으로">
            ←
          </Link>
          <ArtonLogo className="h-8" />
        </div>
        <div className="flex items-center gap-2">
          {/* 버튼 2개는 같은 높이·수직 중앙 정렬(inline-flex h-11) — a/button 베이스라인 어긋남 방지 */}
          <PhotoImport
            ref={photoRef}
            onError={setError}
            renderButton={(openPicker, converting) => (
              <button
                onClick={openPicker}
                disabled={converting}
                aria-label="내 사진·그림으로 도안 만들기"
                className="pressable touch-target inline-flex h-11 items-center justify-center gap-1 rounded-card bg-sky px-4 font-display text-white shadow-soft disabled:opacity-60"
              >
                {/* 좁은 화면(390px)에서는 그림말만 — 글까지 두면 헤더가 넘쳐 페이지가
                    옆으로 밀린다(2026-07-25 실측 +62px). aria-label로 이름은 유지. */}
                📷<span className="hidden sm:inline">{converting ? "변환 중…" : "내 사진·그림으로"}</span>
              </button>
            )}
          />
          <Link
            href="/draw"
            className="pressable touch-target inline-flex h-11 items-center justify-center rounded-card bg-coral px-4 font-display text-white shadow-soft"
          >
            빈 캔버스
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="font-display text-3xl text-ink">색칠할 도안을 골라요 🖍️</h1>
        <p className="mt-2 text-ink-soft">
          로그인 없이 바로 색칠할 수 있어요. 직접 만든 도안 1,000여 장과 저작권이 만료된
          명화(반 고흐·모네·김홍도…)라 마음껏 써도 괜찮아요. 내가 받은 그림 파일을 이 화면에
          끌어다 놓거나 붙여넣기(Ctrl+V)하면 도안으로 만들어 그릴 수도 있어요.
        </p>

        {/* 카테고리 필터 */}
        <div className="mt-5 flex flex-wrap gap-2">
          <FilterChip active={cat === "all"} onClick={() => setCat("all")}>
            전체
          </FilterChip>
          {manifest?.categories.map((c) => (
            <FilterChip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>
              {c.emoji} {c.title}
            </FilterChip>
          ))}
        </div>

        {/* 난이도 필터 — 테마를 연 뒤에만 쓸 일이 있다(테마 격자엔 학년 개념이 없다) */}
        {theme && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(["all", "low", "mid", "high"] as Grade[]).map((g) => (
              <FilterChip key={g} active={grade === g} onClick={() => setGrade(g)} small>
                {g === "all" ? "모든 학년" : GRADE_LABEL[g]}
              </FilterChip>
            ))}
          </div>
        )}

        {error && <p className="mt-8 text-danger">{error}</p>}

        {!manifest && !error && (
          <div className="mt-16 text-center text-ink-faint">도안을 불러오는 중…</div>
        )}

        {manifest && !theme && (
          <>
            <p className="mt-5 text-sm text-ink-faint">
              {themes.length}가지 주제 · 도안 {totalCount}장 — 주제를 고르면 그 안의 도안이 보여요
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {/* 도안 카드와 같은 자리에서 "내 사진"도 고를 수 있게 — 헤더 버튼만 있으면
                  아이들이 못 찾는다(2026-08-25 사용자 요청). 누르면 헤더의 PhotoImport를 연다. */}
              <PhotoCard onClick={() => photoRef.current?.openPicker()} />
              {themes.map((t) => (
                <button
                  key={t.theme}
                  type="button"
                  onClick={() => {
                    setOpenTheme(t.theme);
                    setGrade("all");
                    window.scrollTo({ top: 0 });
                  }}
                  data-testid="theme-card"
                  className="pressable group flex flex-col overflow-hidden rounded-card bg-paper text-left shadow-soft"
                >
                  <div className="aspect-square overflow-hidden bg-white">
                    {t.coverThumb || t.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.coverThumb ?? t.cover ?? ""}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={320}
                        height={320}
                        className="h-full w-full object-contain transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-4xl">🖍️</div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 px-3 py-2">
                    <span className="truncate font-display text-ink">{t.title}</span>
                    <span className="shrink-0 text-sm text-ink-faint">{t.items.length}장</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {manifest && theme && (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setOpenTheme(null)}
                data-testid="theme-back"
                className="pressable rounded-full bg-paper px-4 py-2 font-semibold text-ink-soft shadow-soft hover:text-ink"
              >
                ← 주제 다시 고르기
              </button>
              <h2 className="font-display text-2xl text-ink">{theme.title}</h2>
              <span className="text-sm text-ink-faint">
                {items.length}장{items.length > shown.length ? ` 중 ${shown.length}장` : ""}
              </span>
            </div>
            {items.length > shown.length && (
              <p className="mt-2 text-sm text-ink-faint">
                한 번에 {MAX_MOUNTED}장까지 보여줘요 — 학년으로 좁히면 나머지도 볼 수 있어요.
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              <PhotoCard onClick={() => photoRef.current?.openPicker()} />
              {shown.map((it) => (
                <div
                  key={`${it.theme}/${it.id}`}
                  className="group relative overflow-hidden rounded-card bg-paper shadow-soft"
                >
                  <Link
                    // 캔버스로는 **원본**을 넘긴다 — 썸네일은 격자용이다
                    href={`/draw?template=${encodeURIComponent(it.image)}&mode=coloring`}
                    className="pressable block"
                  >
                    <div className="aspect-square overflow-hidden bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={it.thumb ?? it.image}
                        alt={`${it.title} 색칠 도안`}
                        loading="lazy"
                        decoding="async"
                        width={320}
                        height={320}
                        className="h-full w-full object-contain transition-transform group-hover:scale-105"
                      />
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="truncate text-sm font-semibold text-ink">{it.title}</span>
                      <Chip tone={it.grade === "high" ? "coral" : it.grade === "mid" ? "sun" : "leaf"}>
                        {GRADE_LABEL[it.grade]}
                      </Chip>
                    </div>
                  </Link>
                  {/* 도안 바로 인쇄(빈 라인아트를 A4로) — 인쇄도 원본을 쓴다 */}
                  <button
                    type="button"
                    onClick={() => printImageA4(it.image, it.title)}
                    aria-label={`${it.title} 도안 인쇄`}
                    title="이 도안 인쇄"
                    className="pressable absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-lg shadow-soft backdrop-blur transition-colors hover:bg-white"
                  >
                    🖨️
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-8 flex justify-center">
          <a
            href="https://ssamzip.com"
            target="_blank"
            rel="noopener"
            data-gb="site-link"
            className="touch-target inline-flex min-h-11 items-center justify-center rounded-full bg-paper px-4 text-xs font-semibold text-ink-faint shadow-soft"
          >
            선행쌤 · 선생님이 만든 다른 수업 놀이 보기
          </a>
        </div>
      </div>

    </main>
  );
}

function FilterChip({
  children,
  active,
  onClick,
  small,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`pressable rounded-full font-semibold transition-colors ${
        small ? "px-3 py-1 text-sm" : "px-4 py-2"
      } ${active ? "bg-ink text-white" : "bg-paper text-ink-soft shadow-soft hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function PhotoCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable group flex flex-col overflow-hidden rounded-card bg-sky-soft text-left shadow-soft ring-2 ring-sky/40"
    >
      <div className="grid aspect-square place-items-center">
        <span className="text-5xl transition-transform group-hover:scale-110">📷</span>
      </div>
      <div className="px-3 py-2">
        <span className="block truncate text-sm font-semibold text-sky-deep">내 사진·그림으로</span>
      </div>
    </button>
  );
}
