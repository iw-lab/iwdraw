import Link from "next/link";
import { Chip } from "@/components/ui";
import { JoinCodeForm } from "@/components/join-code-form";
import { ArtonLogo } from "@/components/arton-logo";
import { PhotoStartButton } from "@/components/photo-start-button";

const FEATURES = [
  {
    emoji: "💧",
    title: "진짜처럼 번지는 수채화",
    desc: "물 양을 조절하면 종이 위에서 물감이 스르르 번져요. 마르기 전에 다른 색을 얹으면 자연스럽게 섞여요.",
    tone: "sky" as const,
  },
  {
    emoji: "🎨",
    title: "두께가 느껴지는 유화",
    desc: "붓 자국이 그대로 남는 임파스토 유화. 캔버스에 남은 색과 섞이며 진짜 유화처럼 그려져요.",
    tone: "coral" as const,
  },
  {
    emoji: "🖍️",
    title: "선 밖으로 안 삐져나가는 색칠",
    desc: "100장의 자체 제작 도안. 색칠 모드에서는 윤곽선이 경계가 되어 어린 학생도 깔끔하게 완성해요.",
    tone: "leaf" as const,
  },
  {
    emoji: "🧵",
    title: "진짜 캔버스와 도화지 결",
    desc: "실제 캔버스천과 도화지를 본뜬 결 위에 그려요. 크레용·목탄·파스텔이 종이 요철을 타고 자연스럽게 묻어나요.",
    tone: "berry" as const,
  },
  {
    emoji: "🎬",
    title: "무비 모드",
    desc: "내 그림이 그려지는 과정을 영상처럼 재생하고 다운로드할 수 있어요.",
    tone: "sun" as const,
  },
  {
    emoji: "🔒",
    title: "학생 개인정보 제로",
    desc: "학생은 로그인이 없어요. 학급 코드와 닉네임만으로 참여하고, 이름·이메일 등 개인정보는 수집하지 않아요.",
    tone: "sky" as const,
  },
];

const STEPS = [
  { step: "1", title: "교사가 학급 만들기", desc: "이메일로 가입하고 학급을 만들면 6자리 코드와 QR이 생겨요." },
  { step: "2", title: "학생은 코드로 입장", desc: "설치도 로그인도 없이 코드만 입력하면 바로 캔버스가 열려요." },
  { step: "3", title: "그리고, 전시하기", desc: "저장하면 학급 갤러리에 바로 전시되고 A4 작품집으로 인쇄해요." },
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh">
      {/* ── 헤더 ── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <ArtonLogo className="h-10" />
        <nav className="flex items-center gap-3">
          {/* 요금제 링크는 유료화 보류로 숨김(라우트 = src/app/_pricing) — 복원 시 여기부터 */}
          {/* prefetch 끔 — /teacher 청크는 35KB 인데 랜딩에 들어오는 기기의 대부분은
              학생 웨일북이라 영영 안 쓴다. /draw·/coloring 프리페치는 그대로 둔다. */}
          <Link
            href="/teacher"
            prefetch={false}
            className="pressable touch-target inline-flex items-center rounded-control border border-line bg-transparent px-5 py-2.5 font-semibold text-ink-soft hover:bg-surface-2"
          >
            교사 시작하기
          </Link>
        </nav>
      </header>

      {/* ── 히어로 ── */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-2 md:gap-16 md:py-24">
        <div>
          <Chip tone="coral" className="mb-4">
            iw corp 제품군 · 수업ON의 형제 브랜드
          </Chip>
          <h1 className="font-display text-4xl leading-[1.2] tracking-tight text-ink md:text-6xl">
            학교 수업에 딱 맞춘
            <br />
            <span className="text-coral">디지털 미술 놀이터</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
            설치도 로그인도 필요 없어요. 지금 바로 그리거나 색칠하고, 내 사진을 도안으로
            바꿔서 색칠할 수도 있어요. 우리 반은 학급 코드로 함께 모여요.
          </p>

          {/* 게스트 우선: 바로 그리기 / 색칠하기 */}
          <div className="mt-8 flex max-w-md flex-wrap gap-3">
            <Link
              href="/draw"
              className="pressable touch-target inline-flex items-center gap-2 rounded-control bg-coral px-7 py-4 font-display text-lg text-white hover:bg-coral-deep"
            >
              🎨 바로 그리기
            </Link>
            <Link
              href="/coloring"
              className="pressable touch-target inline-flex items-center gap-2 rounded-control border border-line bg-transparent px-7 py-4 text-lg font-semibold text-ink-soft hover:bg-surface-2"
            >
              🖍️ 색칠하기
            </Link>
            {/* 내 사진·그림으로 시작 — 색칠 도안 고르기 화면에만 있던 걸 첫 화면에도 꺼냈다
                (자동 선따기 / 밑그림 / 그대로 이어 그리기 셋 다 여기서 고른다) */}
            <PhotoStartButton />
          </div>

          {/* 학급 코드 입장(선택) */}
          <div className="mt-8 max-w-md border-t border-line pt-6">
            <p className="mb-2 text-sm font-semibold text-ink-faint">우리 반 코드가 있나요?</p>
            <JoinCodeForm />
          </div>
        </div>

        {/* 히어로 비주얼: 4모드 — 클릭하면 바로 그 모드로 */}
        <div className="grid grid-cols-2 gap-3 rounded-panel border border-ink/6 bg-paper p-4 md:p-6">
          {[
            { emoji: "✏️", label: "스케치", bg: "bg-sun-soft", href: "/draw?mode=sketch" },
            { emoji: "💧", label: "수채화", bg: "bg-sky-soft", href: "/draw?mode=watercolor" },
            { emoji: "🎨", label: "유화", bg: "bg-coral-soft", href: "/draw?mode=oil" },
            { emoji: "🖍️", label: "색칠하기", bg: "bg-leaf-soft", href: "/coloring" },
          ].map((m) => (
            <Link
              key={m.label}
              href={m.href}
              className={`pressable flex aspect-square flex-col items-center justify-center rounded-control ${m.bg}`}
            >
              <span className="text-6xl md:text-7xl">{m.emoji}</span>
              <span className="mt-4 text-lg font-semibold text-ink">{m.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 3단계 흐름 ── */}
      <section className="border-y border-line bg-paper py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-ink">
            교실에서 이렇게 써요
          </h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.step} className="rounded-panel border border-line bg-surface-2 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-coral-soft text-2xl font-semibold text-coral-deep">
                  {s.step}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 기능 ── */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-24">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-ink">
          아이들이 좋아하는 진짜 그림 도구
        </h2>
        <p className="mt-3 text-center text-ink-soft">
          연필·크레용·마커·수채붓·유화붓·에어브러시·오일파스텔… 12가지 도구를 담았어요.
        </p>
        <div className="mt-12 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-panel border border-ink/6 bg-paper p-6">
              <Chip tone={f.tone} className="h-12 w-12 justify-center rounded-full p-0">
                <span className="text-lg">{f.emoji}</span>
              </Chip>
              <h3 className="mt-4 text-lg font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-panel bg-ink px-8 py-16 text-center">
          <h2 className="font-display text-3xl text-white">
            다음 미술 시간, 아트온으로 시작해 보세요
          </h2>
          <p className="mt-3 text-white/70">지금은 전부 무료예요. 가입하고 바로 쓸 수 있어요.</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/teacher"
              prefetch={false}
              className="pressable touch-target inline-flex items-center rounded-control bg-coral px-8 py-4 font-display text-lg text-white hover:bg-coral-deep"
            >
              교사로 시작하기
            </Link>
            <Link
              href="/join"
              className="pressable touch-target inline-flex items-center rounded-control border border-white/20 bg-transparent px-8 py-4 text-lg font-semibold text-white hover:bg-white/10"
            >
              학급 코드로 입장
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-paper py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-ink-faint">
          <span>© 2026 iw corp · 아트온 ArtON</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-ink">
              개인정보처리방침
            </Link>
            <Link href="/terms" className="hover:text-ink">
              이용약관
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
