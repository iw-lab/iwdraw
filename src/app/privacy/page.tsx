import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "개인정보처리방침 · 아트온 ArtON",
  description: "아트온 개인정보처리방침",
};

/*
 * 개인정보처리방침(PIPA §30) — 교사 회원가입 시 수집하는 개인정보의 처리 내용 고지.
 * 아트온은 사업자가 아닌 교사 개인이 무료로 운영하는 서비스라 상호·대표자·사업자등록번호
 * 항목이 없으며, 개인정보 보호책임자는 운영자 본인이 맡는다(연락은 아래 이메일).
 */
const OPERATOR = {
  name: "아트온 ArtON (교사 개인이 운영하는 무료 서비스)",
  contactEmail: "simssijjang@gmail.com",
  effectiveDate: "2026년 7월 10일",
};

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

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-ink-faint hover:text-ink">
        ← 아트온 홈으로
      </Link>
      <h1 className="mt-4 font-display text-3xl text-ink">개인정보처리방침</h1>
      <p className="mt-2 text-sm text-ink-soft">
        아트온(ArtON, 이하 “서비스”)은 「개인정보 보호법」을 준수하며, 이용자의
        개인정보를 소중히 보호합니다. 본 방침은 서비스가 어떤 개인정보를 어떻게
        처리하는지 알려드립니다.
      </p>

      <Section n={1} title="수집하는 개인정보 항목">
        <p>서비스는 최소한의 개인정보만 수집합니다.</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <b>교사 회원</b>: 이메일 주소, 이름(별칭 가능), 비밀번호(암호화
            저장).
          </li>
          <li>
            <b>학생</b>: 실명·이메일·생년월일 등 개인정보를 받지 않습니다. 학급
            코드와 닉네임(별명)만으로 참여합니다.
          </li>
          <li>
            <b>공통 자동수집</b>: 부정 이용(무차별 대입 등) 방지를 위해 접속
            IP를 원본이 아닌 해시 형태로만 잠시 기록하며, 7일 후 자동
            삭제합니다.
          </li>
        </ul>
      </Section>

      <Section n={2} title="개인정보의 수집·이용 목적">
        <ul className="ml-4 list-disc space-y-1">
          <li>교사 회원 식별 및 로그인 인증, 학급·작품 관리 기능 제공</li>
          <li>부정 이용(무차별 대입 등) 방지 및 서비스 안정적 운영</li>
        </ul>
      </Section>

      <Section n={3} title="보유 및 이용 기간">
        <ul className="ml-4 list-disc space-y-1">
          <li>교사 회원정보: 회원 탈퇴 시 지체 없이 파기합니다.</li>
          <li>학생 작품: 생성일로부터 180일(6개월) 후 자동 삭제합니다.</li>
          <li>접속 로그(해시된 IP): 수집일로부터 7일 후 자동 삭제합니다.</li>
          <li>관계 법령이 정한 경우 해당 기간 동안 보관 후 파기합니다.</li>
        </ul>
      </Section>

      <Section n={4} title="개인정보의 제3자 제공">
        <p>서비스는 이용자의 개인정보를 외부에 제공하지 않습니다.</p>
        <p className="mt-2">
          교사가 고른 작품은 선행쌤(sunhaengssam.web.app) 작품 전시관에 그림만 보이며, 학생 별명·작품 제목·학교·학급 같은
          정보는 함께 나가지 않습니다.
        </p>
      </Section>

      <Section n={5} title="개인정보 처리의 위탁 및 국외 이전">
        <p>
          서비스는 안정적인 운영을 위해 아래와 같이 인프라를 이용하며, 이
          과정에서 데이터가 국외에 저장·처리될 수 있습니다.
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <b>이전받는 자</b>: Cloudflare, Inc. (미국) —
            서버·데이터베이스·저장소 인프라 제공 (연락처:
            privacyquestions@cloudflare.com, www.cloudflare.com/privacypolicy)
          </li>
          <li>
            <b>이전 항목</b>: 본 방침 제1조의 수집 항목 · <b>이전 시점·방법</b>:
            서비스 이용 시 네트워크를 통해 전송 · <b>보유·이용 기간</b>: 위
            제3조와 동일
          </li>
        </ul>
        <p>
          이용자는 개인정보의 국외 이전을 거부할 수 있습니다. <b>거부 방법</b>:
          회원가입을 하지 않거나, 이미 가입한 경우 회원 탈퇴(대시보드의 “회원
          탈퇴” — 개인정보 즉시 파기) 또는 아래 제9조의 연락처로 요청하시면
          됩니다. 다만 본 서비스는 위 인프라를 기반으로 운영되므로, 거부 시
          회원가입 및 학급·작품 관리 기능의 이용이 제한될 수 있습니다.
        </p>
      </Section>

      <Section n={6} title="정보주체의 권리와 행사 방법">
        <p>
          이용자는 언제든지 자신의 개인정보에 대해 열람·정정·삭제·처리정지를
          요구할 수 있습니다.
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <b>회원 탈퇴(개인정보 파기)</b>: 교사 대시보드의 “회원 탈퇴”에서
            직접 계정과 개인정보를 삭제할 수 있습니다.
          </li>
          <li>
            기타 열람·정정 요청은 아래 연락처로 문의하시면 지체 없이 조치합니다.
          </li>
        </ul>
      </Section>

      <Section n={7} title="개인정보의 파기 절차 및 방법">
        <p>
          보유 기간이 지나거나 처리 목적이 달성된 개인정보는 지체 없이
          파기합니다. 전자적 파일은 복구할 수 없는 방식으로 삭제하며, 관련 작품
          이미지도 함께 삭제합니다.
        </p>
      </Section>

      <Section n={8} title="개인정보의 안전성 확보 조치">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            비밀번호는 복호화 불가능한 방식(PBKDF2 해시 + 임의 솔트)으로
            저장합니다.
          </li>
          <li>모든 통신은 HTTPS로 암호화합니다.</li>
          <li>
            세션은 서명된 토큰으로 관리하며, 스크립트로 읽을 수 없는
            쿠키(HttpOnly)를 사용합니다.
          </li>
          <li>
            접속 IP는 원본을 저장하지 않고 해시 처리하여 부정접속 방지 용도로만
            사용합니다.
          </li>
        </ul>
      </Section>

      <Section n={9} title="개인정보 보호책임자">
        <p>개인정보 처리에 관한 문의·불만·피해 구제는 아래로 연락해 주세요.</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>운영자: {OPERATOR.name}</li>
          <li>
            개인정보 보호책임자: 운영자 본인 (열람·정정·삭제·처리정지 청구 접수
            및 처리 담당)
          </li>
          <li>
            연락처:{" "}
            <a href={`mailto:${OPERATOR.contactEmail}`} className="underline">
              {OPERATOR.contactEmail}
            </a>
          </li>
        </ul>
        <p>문의를 주시면 지체 없이 확인하여 답변드립니다.</p>
        <p className="text-ink-faint">
          그 밖의 개인정보 침해 상담은 개인정보침해신고센터(privacy.kisa.or.kr /
          국번없이 118)에 문의하실 수 있습니다.
        </p>
      </Section>

      <Section n={10} title="고지 의무">
        <p>
          본 방침은 {OPERATOR.effectiveDate}부터 적용됩니다. 내용이 변경될 경우
          시행 전에 서비스 내 공지를 통해 알려드립니다.
        </p>
      </Section>

      <div className="mt-10 border-t border-cream-deep pt-4 text-xs text-ink-faint">
        <Link href="/terms" className="underline">
          이용약관
        </Link>
      </div>
    </main>
  );
}
