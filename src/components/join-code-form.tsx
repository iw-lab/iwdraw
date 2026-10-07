"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { CLASS_CODE_LENGTH, hasHangul, normalizeClassCode } from "@/lib/class-code";
import { getRememberedClassCode } from "@/lib/student-session";

/* 랜딩·/join 공용: 학급 코드 6자리 입력.
 * ⚠️ 일부러 <form>을 쓰지 않는다 — Safari/iCloud 키체인이 "input 1개 + 제출" 폼을
 *    로그인 폼으로 오인해 '암호 자동완성' 팝업을 띄운다(autoComplete="off"도 무시).
 *    Enter는 onKeyDown으로 처리하고, 코드 기억은 브라우저 암호가 아니라 localStorage로 한다. */
export function JoinCodeForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  // 한글 IME로 치면 normalize가 조용히 걸러 "안 써진다" — 감지해서 한/영 전환 안내
  const [imeWarn, setImeWarn] = useState(false);
  const ready = code.length === CLASS_CODE_LENGTH;

  // 이 기기에서 마지막에 쓴 학급 코드를 자동으로 채운다(브라우저 암호 저장이 아니라 localStorage).
  // 마운트 후 1회 — SSR엔 localStorage가 없어 초기값이 아닌 effect에서 읽는다.
  useEffect(() => {
    const remembered = getRememberedClassCode();
    if (remembered) setCode(normalizeClassCode(remembered));
  }, []);

  const enter = () => {
    if (ready) router.push(`/join?code=${code}`);
  };

  return (
    <div className="flex flex-wrap gap-3">
      <label className="sr-only" htmlFor="class-code">
        학급 코드 6자리
      </label>
      <input
        id="class-code"
        name="arton-class-code"
        value={code}
        onChange={(e) => {
          setImeWarn(hasHangul(e.target.value));
          setCode(normalizeClassCode(e.target.value));
        }}
        onKeyDown={(e) => e.key === "Enter" && enter()}
        placeholder="학급 코드 6자리"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoCapitalize="characters"
        autoFocus={autoFocus}
        maxLength={CLASS_CODE_LENGTH}
        // 브라우저 암호매니저(iCloud·1Password·LastPass) 자동완성/저장 제안 억제
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        className="touch-target w-full rounded-control border border-line bg-paper px-5 py-3 text-center text-2xl font-semibold tracking-[0.35em] text-ink placeholder:tracking-normal placeholder:text-base placeholder:text-ink-faint focus:border-sky"
      />
      <Button
        type="button"
        onClick={enter}
        size="lg"
        disabled={!ready}
        aria-label="학급 코드로 입장하기"
        className="join-code-entry shrink-0 whitespace-nowrap border border-line bg-transparent px-6 font-semibold text-ink-soft hover:bg-surface-2"
      >
        입장
      </Button>
      {imeWarn && (
        <p className="w-full text-sm font-semibold text-coral" role="status">
          ⌨️ 한글로는 쓸 수 없어요 — <b>한/영 키</b>를 눌러 영어로 바꿔 주세요!
        </p>
      )}
    </div>
  );
}
