"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { QrCode } from "@/components/QrCode";
import {
  createClass,
  deleteAccount,
  listClasses,
  regenerateCode,
  toggleClassActive,
  type ClassRow,
} from "@/lib/teacher-api";
import { ClassGallery } from "./class-gallery";
import { AssignmentModal } from "./assignment-modal";

/* 교사 대시보드: 학급 목록·생성·코드/QR·갤러리·도안 배포 */
export function TeacherDashboard({ onSignOut }: { onSignOut: () => void }) {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [big, setBig] = useState<ClassRow | null>(null);
  const [galleryOf, setGalleryOf] = useState<ClassRow | null>(null);
  const [assignOf, setAssignOf] = useState<ClassRow | null>(null);
  const [origin, setOrigin] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    void refresh();
  }, []);

  const refresh = async () => {
    setLoading(true);
    setClasses(await listClasses());
    setLoading(false);
  };

  const add = async () => {
    setCreating(true);
    const c = await createClass(name);
    setCreating(false);
    setName("");
    if (c) {
      await refresh();
      setBig(c);
    }
  };

  if (galleryOf) {
    return <ClassGallery klass={galleryOf} onBack={() => setGalleryOf(null)} />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink">내 학급</h1>
        <button onClick={onSignOut} className="text-sm text-ink-faint hover:text-ink-soft">
          로그아웃
        </button>
      </div>

      {/* 학급 생성 */}
      <Card className="mb-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="학급 이름 (예: 3학년 2반)"
            className="flex-1 rounded-card border-2 border-cream-deep bg-cream px-4 py-3 text-ink focus:border-sky"
          />
          <Button onClick={add} disabled={creating} tone="leaf">
            {creating ? "만드는 중…" : "＋ 학급 만들기"}
          </Button>
        </div>
      </Card>

      {/* 삭제 임박 안내: 작품은 만든 지 180일 후 자동 삭제, 30일 전부터 알림 */}
      {(() => {
        const total = classes.reduce((s, c) => s + (c.expiring_soon ?? 0), 0);
        if (total === 0) return null;
        return (
          <div className="mb-6 rounded-card border-2 border-sun bg-sun-soft px-4 py-3 text-sm text-ink">
            🗓️ 곧 삭제될 작품이 <b>{total}점</b> 있어요. 작품은 만든 지 6개월(180일)이 지나면
            자동으로 삭제돼요. 남기고 싶은 작품은 각 학급 <b>갤러리 → 🖨️ 작품집 인쇄</b>로 저장해 두세요.
          </div>
        );
      })()}

      {loading ? (
        <div className="text-center text-ink-faint">불러오는 중…</div>
      ) : classes.length === 0 ? (
        <Card className="text-center text-ink-soft">
          아직 학급이 없어요. 위에서 학급을 만들어 보세요.
        </Card>
      ) : (
        <div className="grid gap-4">
          {classes.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-xl text-ink">{c.name}</h2>
                    {!c.is_active && (
                      <span className="rounded-full bg-cream-deep px-2 py-0.5 text-xs text-ink-soft">비활성</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    학생 {c.student_count ?? 0}명
                    {(c.expiring_soon ?? 0) > 0 && (
                      <span className="ml-2 rounded-full bg-sun-soft px-2 py-0.5 text-xs font-semibold text-ink">
                        🗓️ {c.expiring_soon}점 곧 삭제
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-display text-3xl tracking-widest text-coral">{c.code}</div>
                  <p className="text-xs text-ink-faint">입장 코드</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="md" tone="sky" onClick={() => setBig(c)}>
                  📺 큰 화면으로 보여주기
                </Button>
                <Button size="md" tone="ghost" onClick={() => setGalleryOf(c)}>
                  🖼️ 갤러리
                </Button>
                <Button size="md" tone="ghost" onClick={() => setAssignOf(c)}>
                  📋 도안 배포
                </Button>
                <Button
                  size="md"
                  tone="ghost"
                  onClick={async () => {
                    const nc = await regenerateCode(c.id);
                    if (nc) refresh();
                  }}
                >
                  🔄 코드 새로 발급
                </Button>
                <Button
                  size="md"
                  tone="ghost"
                  onClick={async () => {
                    await toggleClassActive(c.id, !c.is_active);
                    refresh();
                  }}
                >
                  {c.is_active ? "⏸️ 잠그기" : "▶️ 열기"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-sm text-ink-faint">
        도안 관리는 <Link href="/coloring" className="underline">색칠 도안</Link>에서 할 수 있어요.
      </p>

      {/* 계정 설정 — 회원 탈퇴(개인정보 파기) */}
      <div className="mt-10 border-t border-cream-deep pt-4 text-center">
        <button
          onClick={() => setShowDelete(true)}
          className="text-sm text-ink-faint underline hover:text-danger"
        >
          회원 탈퇴
        </button>
      </div>

      {showDelete && (
        <DeleteAccountModal onClose={() => setShowDelete(false)} onDeleted={onSignOut} />
      )}

      {/* 전자칠판 대형 표시 */}
      {big && <BigCodeModal klass={big} origin={origin} onClose={() => setBig(null)} />}
      {/* 도안 배포 */}
      {assignOf && <AssignmentModal klass={assignOf} onClose={() => setAssignOf(null)} />}
    </div>
  );
}

function BigCodeModal({
  klass,
  origin,
  onClose,
}: {
  klass: ClassRow;
  origin: string;
  onClose: () => void;
}) {
  const joinUrl = `${origin}/join?code=${klass.code}`;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="rounded-bubble bg-paper p-10 text-center shadow-lift" onClick={(e) => e.stopPropagation()}>
        <p className="font-display text-2xl text-ink-soft">{klass.name}</p>
        <p className="mt-4 text-ink-soft">아트온에 접속해서 코드를 입력하세요</p>
        <div className="my-6 font-display text-8xl tracking-[0.2em] text-coral">{klass.code}</div>
        <div className="flex justify-center">
          <QrCode value={joinUrl} size={240} />
        </div>
        <p className="mt-4 text-ink-faint">{origin.replace(/^https?:\/\//, "")}/join</p>
        <button
          onClick={onClose}
          className="pressable mt-8 rounded-card bg-ink px-8 py-3 font-display text-white"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

/* 회원 탈퇴 확인 — 비밀번호 재확인 후 계정·개인정보·작품을 영구 파기. 되돌릴 수 없음. */
function DeleteAccountModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const res = await deleteAccount(password);
    setBusy(false);
    if (res.ok) {
      // 교사 행이 삭제돼 이후 모든 인증 요청이 401(requireTeacher 존재확인) — 전 기기 세션 무효.
      // 현재 기기 쿠키도 서버가 지웠으니 로컬 상태만 정리하면 됨.
      onDeleted();
      return;
    }
    const map: Record<string, string> = {
      invalid_password: "비밀번호가 맞지 않아요",
      rate_limited: "잠시 후 다시 시도해 주세요",
    };
    setError(map[res.error] ?? "탈퇴 처리 중 문제가 생겼어요. 다시 시도해 주세요.");
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-bubble bg-paper p-8 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl text-danger">회원 탈퇴</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          탈퇴하면 <b>계정 정보와 만든 모든 학급·학생·작품</b>이 영구히 삭제되며 되돌릴 수 없어요.
          계속하려면 비밀번호를 입력해 주세요.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && password && !busy && confirm()}
          placeholder="비밀번호"
          autoComplete="current-password"
          className="mt-4 w-full rounded-card border-2 border-cream-deep bg-cream px-4 py-3 text-ink focus:border-danger"
        />
        {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
        <div className="mt-6 flex gap-2">
          <Button onClick={onClose} tone="ghost" className="flex-1">
            취소
          </Button>
          <button
            onClick={confirm}
            disabled={!password || busy}
            className="pressable flex-1 rounded-card bg-danger py-3 font-display text-white disabled:opacity-50"
          >
            {busy ? "탈퇴 중…" : "영구 탈퇴"}
          </button>
        </div>
      </div>
    </div>
  );
}
