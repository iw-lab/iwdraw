/* 선행쌤 링크(반짝이 배너) — 첫 화면·도안 고르기 화면 아래. 스타일 = globals.css .gb-site(학교 키트 gb-ui.css 사본) */
export function SiteLink({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://ssamzip.kr"
      target="_blank"
      rel="noopener"
      data-gb="site-link"
      className={`gb-site ${className}`}
    >
      <span className="gb-site-ic">
        <svg className="gb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>
      </span>
      <span className="gb-site-tx"><b>선행쌤</b><small>선생님이 만든 수업 놀이 더 보기</small></span>
      <span className="gb-site-go">
        가 보기
        <svg className="gb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
      </span>
    </a>
  );
}
