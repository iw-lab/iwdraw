import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "이용약관 · 아트온 ArtON",
  description: "아트온 서비스 이용약관",
};

const EFFECTIVE_DATE = "2026년 7월 10일";

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg text-ink">
        제{n}조 · {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-ink-faint hover:text-ink">
        ← 아트온 홈으로
      </Link>
      <h1 className="mt-4 font-display text-3xl text-ink">이용약관</h1>
      <p className="mt-2 text-sm text-ink-soft">
        본 약관은 아트온(ArtON, 이하 “서비스”)의 이용 조건을 정합니다.
      </p>

      <Section n={1} title="목적">
        <p>
          본 약관은 서비스가 제공하는 초등 미술 수업 도구(디지털
          그리기·색칠·학급 갤러리 등)의 이용에 관한 회원과 운영자의
          권리·의무·책임을 규정합니다.
        </p>
      </Section>

      <Section n={2} title="회원가입 및 계정">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            교사는 이메일과 비밀번호로 가입하며, 가입 시 개인정보처리방침에
            동의해야 합니다.
          </li>
          <li>
            학생은 별도 가입 없이 학급 코드와 닉네임으로 참여합니다(개인정보
            미수집).
          </li>
          <li>
            회원은 비밀번호를 안전하게 관리할 책임이 있으며, 언제든지 탈퇴할 수
            있습니다.
          </li>
        </ul>
      </Section>

      <Section n={3} title="서비스의 이용">
        <ul className="ml-4 list-disc space-y-1">
          <li>서비스는 교육 목적의 창작 활동을 위해 제공됩니다.</li>
          <li>
            타인의 권리를 침해하거나, 욕설·비방·불법 콘텐츠를 게시하는 행위는
            금지됩니다.
          </li>
          <li>
            운영자는 서비스 안정성을 위해 부적절한 콘텐츠나 이용을 제한할 수
            있습니다.
          </li>
        </ul>
      </Section>

      <Section n={4} title="콘텐츠(작품)의 관리">
        <ul className="ml-4 list-disc space-y-1">
          <li>학생이 만든 작품의 권리는 창작자(학생)에게 있습니다.</li>
          <li>
            작품은 원활한 운영을 위해 생성일로부터 180일 후 자동 삭제되며,
            교사는 그 전에 교육활동(수업·전시·평가) 목적의 통상적인 범위에서
            저장·인쇄로 보관할 수 있습니다.
          </li>
        </ul>
      </Section>

      <Section n={5} title="면책 및 책임의 한계">
        <p>
          서비스는 무상으로 제공되며, 천재지변·인프라 장애 등 운영자의 통제를
          벗어난 사유로 인한 서비스 중단이나 데이터 손실에 대해 법이 허용하는
          범위에서 책임을 지지 않습니다. 이용자는 중요한 작품을 별도로
          저장하시길 권장합니다.
        </p>
      </Section>

      <Section n={6} title="약관의 변경">
        <p>
          운영자는 필요 시 약관을 변경할 수 있으며, 변경 시 시행 전에 서비스 내
          공지를 통해 알려드립니다. 본 약관은 {EFFECTIVE_DATE}부터 적용됩니다.
        </p>
      </Section>

      {/* 약관 조항이 아니라 고지 — 재질 텍스처의 출처(Adobe 생성형 AI 약관 §3.1: 생성물 출처를 오인시키지 않는다) */}
      <section className="mt-10">
        <h2 className="font-display text-base text-ink">자료 출처</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-soft">
          <li>
            캔버스천 질감은 Adobe Firefly(생성형 AI)로 만든 이미지를 가공해 사용합니다.
          </li>
          <li>도화지 질감은 ambientCG(CC0 1.0 퍼블릭 도메인) 재질 자료를 가공해 사용합니다.</li>
          <li>명화 밑그림은 저작권 보호기간이 끝난 퍼블릭 도메인 작품(위키미디어 공용)입니다.</li>
        </ul>
      </section>

      <div className="mt-10 border-t border-cream-deep pt-4 text-xs text-ink-faint">
        <Link href="/privacy" className="underline">
          개인정보처리방침
        </Link>
      </div>
    </main>
  );
}
