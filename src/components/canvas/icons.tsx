/*
 * ArtON 아이콘 세트 — 이모지 대신 쓰는 자체 제작 컬러 SVG (viewBox 32×32).
 * 플랫·라운드 스타일 + 공통 잉크색(#2D2A26) 외곽선으로 통일감을 준다.
 */
"use client";

import { useState, type ReactNode } from "react";

const INK = "#2D2A26";
const O = { stroke: INK, strokeWidth: 1.4, strokeLinejoin: "round" as const };

export type IconName =
  | "pencil"
  | "colorpencil"
  | "crayon"
  | "signpen"
  | "acrylic"
  | "marker"
  | "watercolor"
  | "oil"
  | "inkbrush"
  | "airbrush"
  | "oilpastel"
  | "charcoal"
  | "pastel"
  | "glow"
  | "rainbow"
  | "glitter"
  | "smudge"
  | "eraser"
  | "fill"
  | "undo"
  | "redo"
  | "shapes"
  | "symNone"
  | "symVertical"
  | "symHorizontal"
  | "symQuad"
  | "save"
  | "trash"
  | "layers"
  | "movie"
  | "rotate"
  | "junior"
  | "eye"
  | "eyeOff"
  | "plus"
  | "picker"
  | "pointer"
  | "glasses"
  | "sketch"
  | "palette"
  | "coloring";

const ICONS: Record<IconName, ReactNode> = {
  /* ── 그리기 도구 ── */
  pencil: (
    <g transform="rotate(45 16 16)" {...O}>
      <rect x="13" y="2.5" width="6" height="3.5" rx="1.6" fill="#FF7A59" />
      <rect x="13" y="6" width="6" height="14" fill="#FFC84A" />
      <path d="M13 20h6l-3 7z" fill="#E8B27D" />
      <path d="M14.9 24.3h2.2L16 27z" fill={INK} />
    </g>
  ),
  /* 색연필: 연필과 같은 실루엣이지만 몸통이 색색 — 옅게 쌓아 칠하는 도구 */
  colorpencil: (
    <g transform="rotate(45 16 16)" {...O}>
      <rect x="13" y="2.5" width="6" height="3" rx="1.4" fill="#5BB8F5" />
      <rect x="13" y="5.5" width="6" height="6" fill="#7FD06A" />
      <rect x="13" y="11.5" width="6" height="8.5" fill="#E5484D" />
      <path d="M13 20h6l-3 7z" fill="#F2D9B5" />
      <path d="M14.9 24.3h2.2L16 27z" fill="#E5484D" />
    </g>
  ),
  crayon: (
    <g transform="rotate(45 16 16)" {...O}>
      <path d="M13.2 7.5 16 2.5l2.8 5z" fill="#E5484D" />
      <rect x="13.2" y="7.5" width="5.6" height="17" rx="1.4" fill="#E5484D" />
      <rect x="12.4" y="12" width="7.2" height="7" rx="1" fill="#FBF7F0" />
      <path d="M14 15.5h4" stroke="#E5484D" strokeWidth="1.2" strokeLinecap="round" />
    </g>
  ),
  /* 사인펜: 가는 원뿔 촉 + 캡 — 마커(납작촉)와 한눈에 구분되게 촉을 뾰족하게 */
  signpen: (
    <g transform="rotate(45 16 16)" {...O}>
      <rect x="13.2" y="2.5" width="5.6" height="5" rx="1.4" fill="#7C5CD6" />
      <rect x="13.6" y="7.5" width="4.8" height="12" rx="1.2" fill="#FBF7F0" />
      <path d="M13.6 19.5h4.8l-1.1 3h-2.6z" fill="#A78BEA" />
      <path d="M14.9 22.5h2.2L16 27.5z" fill="#7C5CD6" />
    </g>
  ),
  /* 아크릴펜: 굵은 몸통 + 둥근 물감 촉 + 물감 방울(불투명 물감 마카) */
  acrylic: (
    <g transform="rotate(45 16 16)" {...O}>
      <rect x="11.8" y="3" width="8.4" height="5" rx="1.6" fill="#2FA36B" />
      <rect x="12.2" y="8" width="7.6" height="11.5" rx="1.6" fill="#FBF7F0" />
      <rect x="12.2" y="14" width="7.6" height="5.5" rx="1" fill="#8BE0B4" />
      <path d="M13.4 19.5h5.2l-.8 3.2h-3.6z" fill="#2FA36B" />
      <circle cx="16" cy="25.6" r="2.6" fill="#2FA36B" />
    </g>
  ),
  marker: (
    <g transform="rotate(45 16 16)" {...O}>
      <path d="M14 8.5 14.6 3h2.8L18 8.5z" fill="#3D9BE0" />
      <rect x="12.6" y="8.5" width="6.8" height="13" rx="2" fill="#5BB8F5" />
      <rect x="12.6" y="21.5" width="6.8" height="4" rx="1.6" fill="#3D9BE0" />
    </g>
  ),
  inkbrush: (
    <g transform="rotate(35 16 16)" {...O}>
      <rect x="14.4" y="2" width="3.2" height="11" rx="1.6" fill="#2D2A26" />
      <rect x="13.9" y="13" width="4.2" height="3.4" rx="0.9" fill="#C9A227" />
      <path d="M13.9 16.4c0 4.4.9 7.6 2.1 10.1 1.2-2.5 2.1-5.7 2.1-10.1z" fill="#FBF7F0" />
      <path d="M14.8 21.5c.3 2.1.8 3.8 1.2 5 .4-1.2.9-2.9 1.2-5-.4-1.7-2-1.7-2.4 0z" fill="#1A1815" />
    </g>
  ),
  watercolor: (
    <g {...O}>
      <g transform="rotate(30 16 16)">
        <rect x="14.2" y="2" width="3.6" height="12" rx="1.8" fill="#FF7A59" />
        <rect x="13.6" y="14" width="4.8" height="4" rx="1" fill="#A39A8E" />
        <path d="M13.6 18c0 4 .8 7 2.4 9 1.6-2 2.4-5 2.4-9z" fill="#8B6D4B" />
        <path d="M14.6 22.5c.3 2 .8 3.6 1.4 4.5.6-.9 1.1-2.5 1.4-4.5z" fill="#5BB8F5" />
      </g>
      <path d="M7 20c0 2.4-1.3 3.2-2.5 3.2S2 22.4 2 20.6C2 18.6 4.6 15.5 4.6 15.5S7 18.4 7 20z" fill="#5BB8F5" transform="translate(3 3)" />
    </g>
  ),
  oil: (
    <g {...O}>
      <g transform="rotate(30 16 16)">
        <rect x="14" y="1.5" width="4" height="11" rx="2" fill="#B878E0" />
        <rect x="13.2" y="12.5" width="5.6" height="4.5" rx="1" fill="#A39A8E" />
        <path d="M13.2 17c0 3.6 1 6.4 2.8 8.5 1.8-2.1 2.8-4.9 2.8-8.5z" fill="#8B6D4B" />
      </g>
      <path d="M6 26c2.5-2.5 6-1 9-2.5 2.5-1.2 3-3.5 6-3.5 2 0 3.5 1.2 3.5 3 0 3-4 5-9.5 5-4 0-7.5-.7-9-2z" fill="#FF7A59" />
    </g>
  ),
  airbrush: (
    <g>
      <rect x="3" y="12.5" width="7" height="7" rx="2.4" fill="#6B645B" {...O} />
      <circle cx="14.5" cy="16" r="2" fill="#5BB8F5" />
      <circle cx="18.5" cy="10.5" r="1.7" fill="#5BB8F5" opacity="0.9" />
      <circle cx="19" cy="21.5" r="1.7" fill="#5BB8F5" opacity="0.9" />
      <circle cx="23.5" cy="7.5" r="1.4" fill="#5BB8F5" opacity="0.7" />
      <circle cx="24" cy="16" r="1.5" fill="#5BB8F5" opacity="0.8" />
      <circle cx="23.5" cy="24.5" r="1.4" fill="#5BB8F5" opacity="0.7" />
      <circle cx="28" cy="11.5" r="1.1" fill="#5BB8F5" opacity="0.5" />
      <circle cx="28.5" cy="20.5" r="1.1" fill="#5BB8F5" opacity="0.5" />
    </g>
  ),
  oilpastel: (
    <g {...O}>
      <g transform="rotate(45 16 16)">
        <rect x="12.8" y="4" width="6.4" height="19" rx="3.2" fill="#FF9838" />
        <rect x="12.8" y="10" width="6.4" height="8" fill="#FFB268" stroke="none" />
      </g>
      <path d="M6 27c3-1.5 7-1.5 10 0" stroke="#FF9838" strokeWidth="3.4" strokeLinecap="round" fill="none" />
    </g>
  ),
  /* 목탄: 울퉁불퉁한 검은 막대 + 회색 가루 자국 — 연필(깎은 나무)과 실루엣이 다르게 */
  charcoal: (
    <g {...O}>
      <g transform="rotate(45 16 16)">
        <path d="M13 4.5l1.6-1.2 1.8.8 1.8-.6 1 1.4V22l-1.4 1.6-1.6-.8-1.8.9L13 22.6z" fill="#3A3633" />
        <path d="M14.6 8v9.5" stroke="#6B6560" strokeWidth="1" strokeLinecap="round" />
      </g>
      <path d="M5.5 27.5c3.5-2 8-2.2 11.5-.4" stroke="#8A847E" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.55" />
    </g>
  ),
  /* 소프트 파스텔: 네모난 분필 막대(종이 띠) + 가루 점 — 둥근 오일파스텔과 구분 */
  pastel: (
    <g {...O}>
      <g transform="rotate(45 16 16)">
        <rect x="12.6" y="4" width="6.8" height="18" rx="1" fill="#F49AC1" />
        <rect x="12.6" y="9" width="6.8" height="7" fill="#FBF7F0" />
        <path d="M14 12.5h4" stroke="#F49AC1" strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <circle cx="7" cy="26" r="1.2" fill="#F49AC1" stroke="none" opacity="0.7" />
      <circle cx="10.5" cy="27.6" r="0.9" fill="#F49AC1" stroke="none" opacity="0.6" />
      <circle cx="5" cy="23.6" r="0.8" fill="#F49AC1" stroke="none" opacity="0.5" />
    </g>
  ),
  glow: (
    <g>
      <circle cx="16" cy="16" r="11.5" fill="#FFC84A" opacity="0.28" />
      <path
        d="M16 4.5 18.6 13l8.9 3-8.9 3L16 27.5 13.4 19l-8.9-3 8.9-3z"
        fill="#FFC84A"
        {...O}
      />
      <circle cx="25.5" cy="6.5" r="1.6" fill="#FFE082" />
      <circle cx="6.5" cy="25" r="1.4" fill="#FFE082" />
    </g>
  ),
  rainbow: (
    <g fill="none" strokeLinecap="round">
      <path d="M5 21.5a11 11 0 0 1 22 0" stroke="#E5484D" strokeWidth="3.2" />
      <path d="M8.6 21.5a7.4 7.4 0 0 1 14.8 0" stroke="#FFC84A" strokeWidth="3.2" />
      <path d="M12.2 21.5a3.8 3.8 0 0 1 7.6 0" stroke="#5BB8F5" strokeWidth="3.2" />
      <ellipse cx="5.5" cy="22.5" rx="3.2" ry="2.2" fill="#fff" stroke={INK} strokeWidth="1.2" />
      <ellipse cx="26.5" cy="22.5" rx="3.2" ry="2.2" fill="#fff" stroke={INK} strokeWidth="1.2" />
    </g>
  ),
  glitter: (
    // 반짝이 펜: 분홍 획 리본 위에 크고 작은 반짝 별
    <g>
      <path
        d="M4.5 24c5-6 13-9.5 22-9"
        stroke="#F06AAE"
        strokeWidth="5.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M12 8.2 13.3 12l3.8 1.3-3.8 1.3L12 18.4l-1.3-3.8-3.8-1.3 3.8-1.3z" fill="#FFE082" {...O} />
      <path d="M23 17.4l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="#fff" {...O} />
      <circle cx="19.5" cy="10" r="1.5" fill="#FFE082" />
      <circle cx="7.5" cy="19.5" r="1.3" fill="#fff" />
    </g>
  ),
  smudge: (
    // 손가락이 물감을 문질러 끌고 가는 스와이프
    <g fill="none" strokeLinecap="round">
      <path
        d="M5 22c4-1.5 7-1 10 .5"
        stroke="#5BB8F5"
        strokeWidth="5.5"
        opacity="0.45"
      />
      <path d="M4.5 22.5c3-1 5.5-.8 8 .3" stroke="#5BB8F5" strokeWidth="2.6" opacity="0.8" />
      <path
        d="M17.5 25.5c-2.2-1.6-2.6-4.2-.8-6.6l4.6-6.2a2.6 2.6 0 0 1 4.2 3l-2.4 3.4c2.8-.6 5 .8 5.4 3.4.3 2-.8 3.7-2.8 4.8-2.6 1.4-6 .9-8.2-1.8z"
        fill="#FFD8A8"
        stroke={INK}
        strokeWidth="1.6"
      />
    </g>
  ),
  eraser: (
    <g transform="rotate(-20 16 16)" {...O}>
      <rect x="7" y="11" width="18" height="11" rx="2.4" fill="#FF8FB1" />
      <path d="M9.4 11h5v11h-5a2.4 2.4 0 0 1-2.4-2.4v-6.2A2.4 2.4 0 0 1 9.4 11z" fill="#FBF7F0" />
      <path d="M26 6.5l2-2M28.5 11h2.6" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
    </g>
  ),
  fill: (
    <g {...O}>
      <g transform="rotate(-32 13 14)">
        <path d="M8.5 10h11l-1.4 12.5a2 2 0 0 1-2 1.8h-4.2a2 2 0 0 1-2-1.8z" fill="#FF7A59" />
        <path d="M9 13.5h10" stroke={INK} strokeWidth="1.2" />
        <path d="M10 8.5a4 4 0 0 1 8 0" fill="none" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <path
        d="M23.5 16.5s3.5 4.2 3.5 6.5c0 2-1.5 3.2-3 3.2s-3-1.2-3-3.2c0-2.3 2.5-6.5 2.5-6.5z"
        fill="#5BB8F5"
      />
      <ellipse cx="13" cy="27.5" rx="8" ry="2.2" fill="#5BB8F5" opacity="0.85" stroke="none" />
    </g>
  ),

  /* ── 액션 ── */
  undo: (
    <g fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 5.5 5.5 12l7 6.5" />
      <path d="M5.5 12H19a7.5 7.5 0 0 1 0 15h-7" />
    </g>
  ),
  redo: (
    <g fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.5 5.5 26.5 12l-7 6.5" />
      <path d="M26.5 12H13a7.5 7.5 0 0 0 0 15h7" />
    </g>
  ),
  shapes: (
    <g {...O}>
      <circle cx="9.5" cy="9.5" r="6" fill="#E0F1FD" stroke="#3D9BE0" strokeWidth="2" />
      <rect x="18.5" y="4" width="10.5" height="10.5" rx="2" fill="#FFE3DA" stroke="#E85F3E" strokeWidth="2" />
      <path d="M16 18.5 22.5 29h-13z" fill="#E6F5E3" stroke="#5FAF53" strokeWidth="2" />
    </g>
  ),
  symNone: (
    <g fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round">
      <rect x="6" y="6" width="20" height="20" rx="4" />
      <path d="M10 22 22 10" stroke="#A39A8E" />
    </g>
  ),
  symVertical: (
    <g>
      <path d="M16 4v24" stroke="#A39A8E" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" />
      <path d="M12 9c-5 2-7 6-6 10 .8 3 3.5 4 6 2.5z" fill="#B878E0" {...O} />
      <path d="M20 9c5 2 7 6 6 10-.8 3-3.5 4-6 2.5z" fill="#F3E6FB" {...O} />
    </g>
  ),
  symHorizontal: (
    <g>
      <path d="M4 16h24" stroke="#A39A8E" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" />
      <path d="M9 12c2-5 6-7 10-6 3 .8 4 3.5 2.5 6z" fill="#B878E0" {...O} />
      <path d="M9 20c2 5 6 7 10 6 3-.8 4-3.5 2.5-6z" fill="#F3E6FB" {...O} />
    </g>
  ),
  symQuad: (
    <g>
      <path d="M16 4v24M4 16h24" stroke="#A39A8E" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" />
      <circle cx="9.5" cy="9.5" r="3.4" fill="#B878E0" {...O} />
      <circle cx="22.5" cy="9.5" r="3.4" fill="#F3E6FB" {...O} />
      <circle cx="9.5" cy="22.5" r="3.4" fill="#F3E6FB" {...O} />
      <circle cx="22.5" cy="22.5" r="3.4" fill="#B878E0" {...O} />
    </g>
  ),
  save: (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4v13.5" stroke="currentColor" strokeWidth="3.2" />
      <path d="M10 12.5l6 6 6-6" stroke="currentColor" strokeWidth="3.2" />
      <path d="M5 21.5v3A3.5 3.5 0 0 0 8.5 28h15a3.5 3.5 0 0 0 3.5-3.5v-3" stroke="currentColor" strokeWidth="3" />
    </g>
  ),
  trash: (
    <g fill="none" stroke="#E5484D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="13" y="3.5" width="6" height="3" rx="1.5" />
      <path d="M6 8h20" />
      <path d="M8.5 8l1.2 17a2.5 2.5 0 0 0 2.5 2.3h7.6a2.5 2.5 0 0 0 2.5-2.3L23.5 8" />
      <path d="M13 13v9M19 13v9" />
    </g>
  ),
  layers: (
    <g strokeLinejoin="round">
      <path d="M16 3.5 28 10l-12 6.5L4 10z" fill="#FF7A59" stroke={INK} strokeWidth="1.4" />
      <path d="M4 16l12 6.5L28 16" fill="none" stroke="#5BB8F5" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M4 22l12 6.5L28 22" fill="none" stroke="#7BC96F" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
  movie: (
    <g {...O}>
      <rect x="3.5" y="7" width="25" height="18" rx="4" fill={INK} />
      <path d="M13.5 12.2v7.6c0 .8.9 1.3 1.6.9l6.2-3.8c.7-.4.7-1.4 0-1.8l-6.2-3.8c-.7-.4-1.6.1-1.6.9z" fill="#FFC84A" stroke="none" />
    </g>
  ),
  rotate: (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="11" width="14" height="10" rx="2" stroke={INK} strokeWidth="2.4" fill="#FFF3D6" />
      <path d="M27 16a11 11 0 0 0-19-7.5" stroke="#E85F3E" strokeWidth="2.6" />
      <path d="M8.5 4v5h5" stroke="#E85F3E" strokeWidth="2.6" />
      <path d="M5 16a11 11 0 0 0 19 7.5" stroke="#3D9BE0" strokeWidth="2.6" />
      <path d="M23.5 28v-5h-5" stroke="#3D9BE0" strokeWidth="2.6" />
    </g>
  ),
  junior: (
    <g {...O}>
      <circle cx="8.5" cy="8.5" r="3.6" fill="#C89B6D" />
      <circle cx="23.5" cy="8.5" r="3.6" fill="#C89B6D" />
      <circle cx="16" cy="17" r="11" fill="#C89B6D" />
      <ellipse cx="16" cy="21" rx="5" ry="4" fill="#F3E0C7" stroke="none" />
      <circle cx="12" cy="14.5" r="1.5" fill={INK} stroke="none" />
      <circle cx="20" cy="14.5" r="1.5" fill={INK} stroke="none" />
      <path d="M14.5 19.5a2.2 2.2 0 0 0 3 0" fill="none" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="16" cy="18.4" rx="1.6" ry="1.2" fill={INK} stroke="none" />
    </g>
  ),
  eye: (
    <g fill="none" stroke={INK} strokeWidth="2.2">
      <path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16z" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="4" fill="#5BB8F5" />
    </g>
  ),
  eyeOff: (
    <g fill="none" stroke="#A39A8E" strokeWidth="2.2" strokeLinecap="round">
      <path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16z" strokeLinejoin="round" />
      <path d="M6 26 26 6" stroke={INK} strokeWidth="2.6" />
    </g>
  ),
  plus: (
    <g stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
      <path d="M16 6v20M6 16h20" />
    </g>
  ),
  picker: (
    <g>
      <circle cx="12.5" cy="12" r="6" fill="#E5484D" opacity="0.85" />
      <circle cx="19.5" cy="12" r="6" fill="#5BB8F5" opacity="0.85" />
      <circle cx="16" cy="19" r="6" fill="#FFC84A" opacity="0.85" />
    </g>
  ),
  pointer: (
    // 검지 세운 손 + 반짝 — 클릭 전용 도구(그려지지 않음)
    <g {...O} strokeLinecap="round">
      <path
        d="M13.8 16.5V7.5a2.2 2.2 0 014.4 0v7l4.6 1c1.6.3 2.7 1.8 2.5 3.4l-.5 4c-.3 2-2 3.4-4 3.4h-4.6c-1.6 0-3.1-.8-4-2.1l-3.4-5c-.9-1.4.8-3 2.2-2.1z"
        fill="#F0C08E"
      />
      <path d="M20.5 6l2.4-2.4M22 9.5h3.4M11.5 6L9.1 3.6" fill="none" />
    </g>
  ),
  glasses: (
    <g fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round">
      <circle cx="9" cy="18" r="5.5" fill="#E0F1FD" />
      <circle cx="23" cy="18" r="5.5" fill="#E0F1FD" />
      <path d="M14.5 18a2.5 2 0 0 1 3 0M3.5 18l-1.5-3M28.5 18l1.5-3" />
    </g>
  ),

  /* ── 모드 ── */
  sketch: (
    <g transform="rotate(45 16 16)" {...O}>
      <rect x="13" y="2.5" width="6" height="3.5" rx="1.6" fill="#FF8FB1" />
      <rect x="13" y="6" width="6" height="14" fill="#FFC84A" />
      <path d="M13 20h6l-3 7z" fill="#E8B27D" />
      <path d="M14.9 24.3h2.2L16 27z" fill={INK} />
    </g>
  ),
  palette: (
    <g {...O}>
      <path
        d="M16 3.5C8.3 3.5 2.7 9.2 2.7 16.4c0 7.2 5.9 12.4 13.3 12.4 1.7 0 2.9-1.2 2.9-2.7 0-.7-.3-1.3-.7-1.9-.4-.5-.7-1-.7-1.7 0-1.5 1.2-2.7 2.7-2.7h2.9c3.5 0 6.2-2.8 6.2-6.4 0-5.6-5.6-9.9-13.3-9.9z"
        fill="#FF7A59"
      />
      <circle cx="10" cy="12" r="2.2" fill="#FBF7F0" stroke="none" />
      <circle cx="16" cy="8.7" r="2.2" fill="#FFC84A" stroke="none" />
      <circle cx="22" cy="12" r="2.2" fill="#5BB8F5" stroke="none" />
      <circle cx="8.7" cy="18.7" r="2.2" fill="#7BC96F" stroke="none" />
    </g>
  ),
  coloring: (
    <g {...O}>
      <path d="M16 4.5c6 4 10 4.5 10 10.5 0 5.5-4.5 10-10 10S6 20.5 6 15C6 9 10 8.5 16 4.5z" fill="#fff" />
      <path d="M16 4.5c6 4 10 4.5 10 10.5 0 5.5-4.5 10-10 10z" fill="#7BC96F" />
      <path d="M16 4.5V25" fill="none" strokeWidth="1.2" />
    </g>
  ),
};

export function Icon({
  name,
  className = "h-6 w-6",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      {ICONS[name]}
    </svg>
  );
}

/** AI 생성 일러스트(WebP)가 있는 도구 아이콘(/public/icons/tools/) — 없거나 로드 실패 시 SVG 폴백 */
const PNG_ICONS = new Set<IconName>([
  "pencil",
  "crayon",
  "marker",
  "watercolor",
  "oil",
  "airbrush",
  "oilpastel",
  "glow",
  "rainbow",
  "glitter",
  "eraser",
  "fill",
  "palette",
  "coloring",
]);

export function ToolIcon({
  name,
  className = "h-6 w-6",
}: {
  name: IconName;
  className?: string;
}) {
  const [fallback, setFallback] = useState(false);
  if (fallback || !PNG_ICONS.has(name)) return <Icon name={name} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // 96px WebP(총 45KB) — 원본 256px PNG 는 14장에 634KB 였는데 화면에선 20~24px 로만
      // 그린다. 생성 스크립트 = scripts/gen-tool-icons.mjs. 로드 실패 시 SVG 로 폴백.
      src={`/icons/tools/${name}.webp`}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`${className} select-none object-contain`}
      onError={() => setFallback(true)}
    />
  );
}
