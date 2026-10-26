import type { Metadata, Viewport } from "next";
import { Jua } from "next/font/google";
import { BootWatchdogClear } from "@/components/BootWatchdogClear";
import "./globals.css";

const jua = Jua({
  weight: "400",
  variable: "--font-jua",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "아트온 ArtON — 학교 수업에 딱 맞춘 디지털 미술 놀이터",
    template: "%s | 아트온 ArtON",
  },
  description:
    "설치·로그인 없이 학급 코드로 바로 참여하는 초등 교실용 디지털 스케치 & 색칠 웹앱. 진짜 물감처럼 번지는 수채화, 두께감 있는 유화, 저작권 걱정 없는 자체 제작 도안.",
  applicationName: "아트온 ArtON",
  keywords: ["아트온", "ArtON", "초등 미술", "디지털 드로잉", "색칠공부", "iw corp"],
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "아트온", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title: "아트온 ArtON — 디지털 미술 놀이터",
    description: "설치·로그인 없이 바로 그리고 색칠하는 초등 교실용 미술 웹앱.",
    images: ["/og.png"],
    type: "website",
    locale: "ko_KR",
  },
};

export const viewport: Viewport = {
  themeColor: "#fbf7f0",
  width: "device-width",
  initialScale: 1,
  // 캔버스 앱: 핀치줌은 엔진 제스처가 처리하므로 페이지 줌은 잠금
  maximumScale: 1,
  userScalable: false,
};

// 배포마다 유일한 빌드ID(cf:build/cf:deploy가 date +%s로 주입). 정적 export라 이 값이
// 아래 인라인 스크립트에 그대로 박히고, /version.json(네트워크)과 비교해 낡은 코드를 감지한다.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard(본문 글꼴)는 **렌더를 막지 않게** 불러온다.
            그냥 stylesheet 로 두면 첫 페인트가 이 CDN 응답을 기다린다 — 학교망에서 jsDelivr
            가 막히면 브라우저 타임아웃(수십 초)까지 화면이 통째로 정지한다(2026-09-02
            교차검증 codex). media="print" 로 받으면 렌더 블로킹이 아니고, 도착하면 onload 가
            media 를 all 로 바꿔 적용한다. 폰트 스택에 시스템 한글 폴백이 있어 그 사이에는
            FOUT(글꼴만 바뀜)만 생긴다. noscript 는 JS 없는 환경용 원래 경로. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          id="pretendard-css"
          rel="stylesheet"
          href={PRETENDARD_CSS}
          media="print"
          crossOrigin="anonymous"
        />
        {/* ⚠️ 속성으로 쓴 onload 는 React 가 SSR HTML 에서 떨어뜨린다(실측: out/draw.html 에
            안 나온다) — 그러면 media 가 print 인 채로 굳어 글꼴이 영영 안 붙는다.
            링크 바로 뒤 인라인 스크립트로 직접 건다. 캐시에서 즉시 와 load 가 이미 지나간
            경우를 위해 sheet 유무도 함께 본다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var l=document.getElementById("pretendard-css");if(!l)return;
var f=function(){l.media="all"};
try{l.addEventListener("load",f,{once:true});if(l.sheet)f()}catch(e){l.media="all"}})();`,
          }}
        />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-css-tags */}
          <link rel="stylesheet" href={PRETENDARD_CSS} crossOrigin="anonymous" />
        </noscript>
        {/* 부트 워치독(React 밖) — 배포로 구버전 청크가 404 나면 React가 아예 못 떠서
            에러 바운더리도 실행되지 않고 흰 화면만 남는다(2026-07-10·07-13 실측: 그리다
            새로고침 = 흰 화면). 방어를 3중으로:
              ① 청크 로드 실패(script error / ChunkLoadError)를 즉시 감지 → 바로 복구
              ② 8초 내 하이드레이션(BootWatchdogClear 마운트)이 없으면 복구
              ③ 복구는 최대 2회(2회차는 캐시 우회 쿼리로 새 문서 강제) — 그래도 못 뜨면
                 흰 화면 대신 "다시 불러오기" 화면을 보여준다(교실에서 아이가 손쓸 수 있게)
            SW·캐시만 지우고 그림(IndexedDB)은 보존한다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var K="arton.selfheal.boot";
  function tries(){try{return parseInt(sessionStorage.getItem(K)||"0",10)||0}catch(e){return 0}}
  function purge(){
    var p=[];
    try{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){p.push(navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}))}}catch(e){}
    try{if(window.caches){p.push(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}))}}catch(e){}
    return Promise.all(p).catch(function(){});
  }
  function screen(failed){
    if(document.getElementById("arton-boot-msg"))return;
    var d=document.createElement("div");
    d.id="arton-boot-msg";
    d.setAttribute("style","position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#fbf7f0;color:#4a4238;font-family:system-ui,sans-serif;text-align:center;padding:24px");
    var t=document.createElement("div");
    t.setAttribute("style","font-size:20px;font-weight:700");
    t.textContent=failed?"그림 앱을 불러오지 못했어요":"그림 앱을 불러오는 중이에요…";
    d.appendChild(t);
    if(failed){
      var s=document.createElement("div");
      s.setAttribute("style","font-size:15px;color:#8a7f70");
      s.textContent="그리던 그림은 안전하게 저장돼 있어요. 아래 버튼을 눌러 주세요.";
      d.appendChild(s);
      var b=document.createElement("button");
      b.setAttribute("style","margin-top:8px;padding:14px 28px;border:0;border-radius:16px;background:#f4795b;color:#fff;font-size:17px;font-weight:700;cursor:pointer");
      b.textContent="다시 불러오기";
      b.onclick=function(){try{sessionStorage.removeItem(K)}catch(e){}purge().then(bust)};
      d.appendChild(b);
    }
    (document.body||document.documentElement).appendChild(d);
  }
  function bust(){
    // 캐시 우회 — 어느 계층(SW·HTTP 캐시)에 낡은 HTML이 남아도 새 문서를 받는다
    try{var u=new URL(location.href);u.searchParams.set("_r",String(Date.now()));location.replace(u.toString())}
    catch(e){location.reload()}
  }
  function heal(){
    if(window.__artonHealing)return;
    window.__artonHealing=1;
    var n=tries()+1;
    try{sessionStorage.setItem(K,String(n))}catch(e){}
    if(n>2){screen(true);return}
    purge().then(function(){ n>=2?bust():location.reload() });
  }
  // ① 청크(_next/static) 로드 실패 = React가 못 뜬다는 확정 신호 → 8초 안 기다리고 즉시 복구.
  //    (CDN 폰트 등 앱 밖 리소스 실패로는 복구하지 않는다 — 무한 새로고침 방지)
  window.addEventListener("error",function(e){
    var t=e&&e.target;
    if(t&&t.tagName==="SCRIPT"&&String(t.src||"").indexOf("/_next/")>=0)heal();
  },true);
  window.addEventListener("unhandledrejection",function(e){
    var r=e&&e.reason;
    var m=String((r&&(r.name+" "+r.message))||r||"");
    if(m.indexOf("ChunkLoadError")>=0||/Loading (chunk|CSS chunk)|dynamically imported module/i.test(m))heal();
  });
  if(tries()>2){screen(true);return}
  // 낡은 코드 자가치유(2026-07-21) — precache된 옛 앱 JS는 강력새로고침으로도 안 지워져
  //   "고쳤는데 그대로"가 반복됐다. 배포마다 /version.json에 새 빌드ID가 실리는데(네트워크
  //   우선), 지금 로드된 앱이 품은 BUILD와 다르면 옛 코드가 서빙된 것 → SW·캐시를 비우고
  //   캐시우회 새로고침으로 새 코드를 강제 수신. 사용자가 아무것도 안 해도 새로고침 1회면 최신.
  //   같은 목표버전으론 1회만 치유(sessionStorage 가드)해 무한 루프를 막는다.
  var BUILD=${JSON.stringify(BUILD_ID)};
  if(BUILD){try{
    fetch("/version.json",{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(d){
      if(!d||!d.v||d.v===BUILD)return;
      var VK="arton.ver.heal",done;
      try{done=sessionStorage.getItem(VK)}catch(e){}
      if(done===d.v)return;
      try{sessionStorage.setItem(VK,d.v)}catch(e){}
      purge().then(function(){
        try{var u=new URL(location.href);u.searchParams.set("_v",d.v);location.replace(u.toString())}
        catch(e){location.reload()}
      });
    }).catch(function(){});
  }catch(e){}}
  // 배포 자동 반영 — 새 SW가 제어권을 잡으면(새 버전 활성화) 1회 새로고침해 새 앱 코드를 로드.
  //   precache된 옛 JS 청크는 강력새로고침으로도 안 지워져 "고쳤는데 그대로"가 반복됐다
  //   (2026-07-21 실측: 선따기 개선이 배포됐는데 옛 코드가 계속 서빙). skipWaiting+clientsClaim로
  //   활성화된 새 SW가 controllerchange를 쏘면 그때 새로고침. 첫 등록(제어자 없음→claim)은 제외.
  try{if(navigator.serviceWorker){
    var hadCtrl=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange",function(){
      if(window.__artonSwReloaded||!hadCtrl)return;
      window.__artonSwReloaded=1;location.reload();
    });
  }}catch(e){}
  window.__artonBootSlow=setTimeout(function(){screen(false)},3500); // 흰 화면 대신 안내
  window.__artonBoot=setTimeout(heal,8000);
})();`,
          }}
        />
      </head>
      <body className={`${jua.variable} antialiased`}>
        <BootWatchdogClear />
        {children}
        {/* 오늘·누적 이용자 수 — 선행쌤 공용 카운터(ssam-count). 개인정보 0: 기기 무작위 id 해시만 */}
        <script src="/ssam-count.js" data-app="arton" data-place="host" defer />
      </body>
    </html>
  );
}
