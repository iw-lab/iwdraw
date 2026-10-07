/* 아트온 로고: 붓 + 물감 방울 모티프 인라인 SVG (자체 제작) */
export function ArtonLogo({ className = "h-10" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <svg viewBox="0 0 48 48" className="h-full w-auto" aria-hidden="true">
        {/* 팔레트 */}
        <path
          d="M24 4C12.4 4 4 12.6 4 23.4 4 34.2 12.8 42 24 42c2.6 0 4.4-1.8 4.4-4 0-1.1-.4-2-1.1-2.8-.6-.8-1-1.6-1-2.6 0-2.2 1.8-4 4-4h4.4C39.9 28.6 44 24.4 44 19 44 10.6 35.6 4 24 4Z"
          fill="#FF7A59"
        />
        {/* 물감 점 */}
        <circle cx="15" cy="18" r="3.4" fill="#FBF7F0" />
        <circle cx="24" cy="13" r="3.4" fill="#FFC84A" />
        <circle cx="33" cy="18" r="3.4" fill="#5BB8F5" />
        <circle cx="13" cy="28" r="3.4" fill="#7BC96F" />
        {/* 붓 */}
        <path
          d="M40.5 30.5 30 41c-1.6 1.6-4.2 1.6-5.7 0-1.6-1.6-1.6-4.2 0-5.7L34.8 24.8Z"
          fill="#2D2A26"
        />
        <path d="M40.5 30.5 44 27l-3.2-3.2-3.5 3.5Z" fill="#B878E0" />
      </svg>
      <span className="font-display text-2xl leading-none tracking-tight text-ink">
        아트온 <span className="text-coral">ArtON</span>
      </span>
    </span>
  );
}
