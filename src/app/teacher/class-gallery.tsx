"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { renderPrintSheet, type PrintItem } from "@/engine/export/PrintSheet";
import { printImageA4, downloadImage } from "@/lib/print";
import { groupByDay } from "@/lib/day-group";
import { GALLERY_GRID, GallerySizeControl, useGallerySize } from "@/components/gallery-size";
import {
  deleteArtwork,
  listArtworks,
  listStudents,
  setShowcase,
  uploadShowcaseImage,
  signedUrl,
  type ArtworkRow,
  type ClassRow,
  type StudentRow,
} from "@/lib/teacher-api";
import { ShowcaseDialog } from "./showcase-dialog";
import { ShowcaseGuide } from "./showcase-guide";

/* 학급 갤러리: 날짜별 작품 목록 + 필요 없는 작품 삭제(큐레이션) + 작품집 A4 인쇄.
 * 승인 게이트는 2026-07-09 비활성(제출 즉시 전시) — 되살리려면 worker INSERT의
 * is_approved와 이 화면의 승인 UI(approveArtwork, git 이력 참조)를 복원. */
export function ClassGallery({ klass, onBack }: { klass: ClassRow; onBack: () => void }) {
  const [items, setItems] = useState<ArtworkRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  // 삭제 2단계 확인(오조작 방지): 첫 클릭 → "정말요?" 3초, 그 안에 재클릭 시 실행
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [size, setSize] = useGallerySize();
  // 클릭 시 원본(잘리지 않은 전체 이미지) 크게 보기
  const [big, setBig] = useState<ArtworkRow | null>(null);
  const [bigUrl, setBigUrl] = useState<string | null>(null);

  const askDelete = async (a: ArtworkRow) => {
    if (confirmDel !== a.id) {
      setConfirmDel(a.id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDel(null), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmDel(null);
    setDeleting(a.id);
    const ok = await deleteArtwork(a.id);
    setDeleting(null);
    if (ok) {
      setItems((prev) => prev.filter((x) => x.id !== a.id));
    } else {
      // 실패(네트워크·스토리지)를 조용히 삼키면 교사가 이유 없이 재시도만 반복한다
      setDelError(true);
      setTimeout(() => setDelError(false), 3500);
    }
  };
  const [delError, setDelError] = useState(false);
  // 선행쌤 작품 전시관(2026-11-03) — 교사가 고른 작품만, 그림만(별명·제목 없이) 밖에 보인다
  const [showing, setShowing] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  // 걸 때는 확인 창(이름 가리기 · «이름 없음» 확인) — 2026-11-03 그림 속 실명이 전시관에 나갔다
  const [asking, setAsking] = useState<ArtworkRow | null>(null);
  const toggleShowcase = async (a: ArtworkRow, cover: Blob | null = null, checked = false, sido = "") => {
    const on = !a.showcase_at;
    if (on && !checked) { setAsking(a); return; }
    setShowing(a.id);
    let ok = true;
    if (on && cover) ok = await uploadShowcaseImage(a.id, cover);
    if (ok) ok = await setShowcase(a.id, on, checked, sido);
    setShowing(null);
    if (ok) setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, showcase_at: on ? Date.now() : null, showcase_report: null } : x)));
    else {
      setShowError(true);
      setTimeout(() => setShowError(false), 3500);
    }
  };
  const [dlError, setDlError] = useState(false);
  // 학생 별명 명단 — 아이가 별명을 까먹으면 여기서 찾아 알려준다(접이식)
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [rosterOpen, setRosterOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [list, roster] = await Promise.all([listArtworks(klass.id), listStudents(klass.id)]);
    setItems(list);
    setStudents(roster);
    setLoading(false);
    // 썸네일 서명 URL 병렬 로드
    const entries = await Promise.all(
      list.map(async (a) => [a.id, (await signedUrl(a.thumb_path)) ?? ""] as const),
    );
    setUrls(Object.fromEntries(entries));
  }, [klass.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 언마운트 시 삭제 확인 타이머 정리
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  // 크게 보기 열릴 때 원본 이미지 로드(썸네일이 아닌 image_path)
  useEffect(() => {
    if (!big) {
      setBigUrl(null);
      return;
    }
    // 연달아 다른 작품을 클릭해도 늦게 도착한 응답이 최신 선택을 덮지 않게 가드
    let stale = false;
    void signedUrl(big.image_path).then((u) => {
      if (!stale) setBigUrl(u ?? urls[big.id] ?? null);
    });
    return () => {
      stale = true;
    };
  }, [big, urls]);

  const dayGroups = groupByDay(items, (a) => a.created_at);

  const printAll = async () => {
    setPrinting(true);
    try {
      const printItems: PrintItem[] = [];
      for (const a of items) {
        const url = (await signedUrl(a.image_path)) ?? urls[a.id];
        if (!url) continue;
        const img = await loadImg(url);
        printItems.push({ image: img, nickname: a.nickname ?? "학생" });
      }
      if (printItems.length === 0) return;
      const canvas = renderPrintSheet(printItems, { title: klass.name, cols: 2, rows: 3 });
      const win = window.open("");
      if (win) {
        win.document.write(
          `<img src="${canvas.toDataURL("image/png")}" style="width:100%" onload="print()"/>`,
        );
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onBack} className="pressable rounded-card px-2 text-xl" aria-label="뒤로">
          ← {klass.name}
        </button>
        <div className="flex items-center gap-2">
          <GallerySizeControl size={size} onChange={setSize} />
          <Button size="md" tone="sky" onClick={printAll} disabled={printing}>
            {printing ? "준비 중…" : "🖨️ 작품집 인쇄"}
          </Button>
        </div>
      </div>

      {delError && (
        <p className="mb-3 rounded-card bg-danger-soft px-4 py-2 text-sm font-semibold text-danger" role="status">
          작품을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}
      {dlError && (
        <p className="mb-3 rounded-card bg-danger-soft px-4 py-2 text-sm font-semibold text-danger" role="status">
          작품을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}

      {asking && urls[asking.id] && (
        <ShowcaseDialog
          src={urls[asking.id]}
          onCancel={() => setAsking(null)}
          onConfirm={async (cover, sido) => { const a = asking; setAsking(null); await toggleShowcase(a, cover, true, sido); }}
        />
      )}
      {showError && (
        <p className="mb-3 rounded-card bg-danger-soft px-4 py-2 text-sm font-semibold text-danger" role="status">
          전시관에 걸지(내리지) 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}
      <ShowcaseGuide />

      {/* 학생 별명 명단 — 별명을 까먹은 아이에게 알려주는 용도(접이식) */}
      {students.length > 0 && (
        <div className="mb-4 rounded-card bg-paper shadow-soft">
          <button
            onClick={() => setRosterOpen((o) => !o)}
            aria-expanded={rosterOpen}
            className="pressable flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="font-display text-base text-ink">
              👧 우리 반 별명 <span className="text-sm font-normal text-ink-faint">{students.length}명</span>
            </span>
            <span className="text-ink-faint">{rosterOpen ? "▲ 접기" : "▼ 펼치기"}</span>
          </button>
          {rosterOpen && (
            <div className="border-t border-cream-deep px-4 pb-4 pt-3">
              <p className="mb-2 text-xs text-ink-faint">
                아이가 별명을 까먹었을 때 여기서 찾아 알려주세요 — 같은 별명으로 들어와야 같은
                학생으로 이어져요. 작품 0점은 별명을 잘못 만들고 나간 경우일 수 있어요.
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {students.map((s) => (
                  <li
                    key={s.id}
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${
                      s.artwork_count > 0 ? "bg-sky-soft text-sky-deep" : "bg-cream text-ink-faint"
                    }`}
                    title={`들어온 날 ${dayStamp(s.created_at)} · 작품 ${s.artwork_count}점`}
                  >
                    {s.nickname}
                    <span className="ml-1 text-xs font-normal opacity-70">{s.artwork_count}점</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 삭제 임박(30일 이내) 안내 — 작품집 인쇄로 남기도록 유도 */}
      {(() => {
        const soon = items.filter(
          (a) => a.expires_at != null && a.expires_at - Date.now() <= 30 * 86400000,
        ).length;
        if (soon === 0) return null;
        return (
          <div className="mb-4 rounded-card border-2 border-sun bg-sun-soft px-4 py-3 text-sm text-ink">
            🗓️ 이 학급에 곧 삭제될 작품이 <b>{soon}점</b> 있어요. 작품은 만든 지 6개월(180일)이
            지나면 자동 삭제돼요. 위 <b>🖨️ 작품집 인쇄</b> 또는 작품별 인쇄로 남겨 두세요.
          </div>
        );
      })()}

      {loading ? (
        <div className="text-center text-ink-faint">불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="rounded-card bg-paper p-8 text-center text-ink-soft shadow-soft">
          아직 작품이 없어요.
        </div>
      ) : (
        dayGroups.map((g) => (
          <section key={g.key} className="mb-6">
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg text-ink">
              📅 {g.label}
              <span className="text-sm font-normal text-ink-faint">{g.items.length}점</span>
            </h2>
            <div className={`grid gap-3 ${GALLERY_GRID[size]}`}>
              {g.items.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-card bg-paper shadow-soft">
              <button
                type="button"
                onClick={() => setBig(a)}
                aria-label={`${a.nickname ?? "학생"} 작품 크게 보기`}
                className="block aspect-square w-full cursor-zoom-in bg-cream"
              >
                {urls[a.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[a.id]} alt={`${a.nickname ?? "학생"} 작품`} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full animate-pulse bg-cream-deep" />
                )}
              </button>
              {/* 삭제 임박 배지(30일 이내) */}
              {(() => {
                const d =
                  a.expires_at != null
                    ? Math.ceil((a.expires_at - Date.now()) / 86400000)
                    : Infinity;
                if (d > 30) return null;
                return (
                  <span className="absolute left-2 top-2 rounded-full bg-sun px-2 py-0.5 text-xs font-bold text-ink shadow-soft">
                    🗓️ {d <= 0 ? "곧 삭제" : `${d}일 후 삭제`}
                  </span>
                );
              })()}
              {/* 작품 저장(다운로드) · 인쇄 — 원본 해상도 */}
              <div className="absolute right-2 top-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    const url = (await signedUrl(a.image_path)) ?? urls[a.id];
                    const base = `${a.nickname ?? "학생"}_${dayStamp(a.created_at)}`;
                    if (url) {
                      const ok = await downloadImage(url, base);
                      if (!ok) {
                        setDelError(false);
                        setDlError(true);
                        setTimeout(() => setDlError(false), 3500);
                      }
                    }
                  }}
                  aria-label={`${a.nickname ?? "학생"} 작품 저장`}
                  title="이 작품 저장(다운로드)"
                  className="pressable grid h-9 w-9 place-items-center rounded-full bg-white/90 text-lg shadow-soft backdrop-blur transition-colors hover:bg-white"
                >
                  ⬇️
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const url = (await signedUrl(a.image_path)) ?? urls[a.id];
                    if (url) printImageA4(url, a.nickname ?? "학생");
                  }}
                  aria-label={`${a.nickname ?? "학생"} 작품 인쇄`}
                  title="이 작품 인쇄"
                  className="pressable grid h-9 w-9 place-items-center rounded-full bg-white/90 text-lg shadow-soft backdrop-blur transition-colors hover:bg-white"
                >
                  🖨️
                </button>
              </div>
              <div className="p-2">
                {/* 학생이 붙인 제목 — 인쇄·전시 때 이름만큼 중요하다 */}
                {a.title && (
                  <p className="truncate font-display text-sm text-ink" title={a.title}>
                    {a.title}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-semibold text-ink">{a.nickname ?? "학생"}</span>
                  <span className="text-xs text-ink-faint">❤ {a.like_count}</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleShowcase(a)}
                  disabled={showing === a.id}
                  aria-pressed={!!a.showcase_at}
                  data-showcase={a.showcase_at ? "on" : "off"}
                  data-showcase-art={a.id}
                  title="선행쌤(ssamzip.kr) 작품 전시관에 그림만 보여요 — 별명·제목은 안 나가요"
                  className={`pressable mt-2 w-full rounded-lg py-1.5 text-sm font-semibold disabled:opacity-60 ${
                    a.showcase_at ? "bg-sun text-ink" : "bg-cream text-ink-soft hover:bg-sun/60 hover:text-ink"
                  }`}
                >
                  {showing === a.id ? "바꾸는 중…" : a.showcase_at ? "🏛️ 전시 중 · 내리기" : "🏛️ 선행쌤 전시관에 걸기"}
                </button>
                {!a.showcase_at && a.showcase_report ? (
                  <p className="mt-1 rounded-md bg-danger-soft px-2 py-1 text-xs font-semibold text-danger" data-showcase-report>
                    «이름이 보여요» 신고로 내려졌어요 — 그림을 보고 가린 뒤 다시 걸 수 있어요
                  </p>
                ) : null}
                <button
                  onClick={() => askDelete(a)}
                  disabled={deleting === a.id}
                  className={`pressable mt-2 w-full rounded-lg py-1.5 text-sm font-semibold disabled:opacity-60 ${
                    confirmDel === a.id
                      ? "bg-danger text-white"
                      : "bg-cream text-ink-soft hover:bg-danger-soft hover:text-danger"
                  }`}
                >
                  {deleting === a.id
                    ? "삭제 중…"
                    : confirmDel === a.id
                      ? "정말 삭제할까요?"
                      : "🗑 삭제"}
                </button>
              </div>
            </div>
              ))}
            </div>
          </section>
        ))
      )}

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
                alt={`${big.nickname ?? "학생"} 작품`}
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
                    {big.title}{" "}
                    <span className="text-base text-ink-soft">· {big.nickname ?? "학생"}</span>
                  </>
                ) : (
                  (big.nickname ?? "학생")
                )}
              </span>
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
    </div>
  );
}

/** 다운로드 파일명용 날짜 도장(YYYY-MM-DD) */
function dayStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 로드 실패"));
    img.src = url;
  });
}
