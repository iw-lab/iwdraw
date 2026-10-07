"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

/* ── 공용 UI 프리미티브 (아트온 디자인 시스템) ─────────────────── */

type ButtonTone = "coral" | "sky" | "leaf" | "ghost" | "danger";
type ButtonSize = "md" | "lg" | "xl";

const toneClass: Record<ButtonTone, string> = {
  coral: "bg-coral text-white hover:bg-coral-deep",
  sky: "bg-sky text-white hover:bg-sky-deep",
  leaf: "bg-leaf text-white hover:bg-leaf-deep",
  ghost: "bg-transparent text-ink border border-line hover:bg-surface-2",
  danger: "bg-danger-soft text-danger border-2 border-danger/30 hover:bg-danger hover:text-white",
};

const sizeClass: Record<ButtonSize, string> = {
  md: "px-5 py-3 text-base",
  lg: "px-7 py-4 text-lg",
  xl: "px-9 py-5 text-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = "coral", size = "md", className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`pressable touch-target inline-flex items-center justify-center gap-2 rounded-control font-display disabled:cursor-not-allowed disabled:opacity-50 ${toneClass[tone]} ${sizeClass[size]} ${className}`}
      {...rest}
    />
  );
});

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-panel border border-ink/6 bg-paper p-6 ${className}`}>{children}</div>
  );
}

export function Chip({
  children,
  tone = "sky",
  className = "",
}: {
  children: ReactNode;
  tone?: "sky" | "coral" | "leaf" | "sun" | "berry";
  className?: string;
}) {
  const tones = {
    sky: "bg-sky-soft text-sky-deep",
    coral: "bg-coral-soft text-coral-deep",
    leaf: "bg-leaf-soft text-leaf-deep",
    sun: "bg-sun-soft text-ink",
    berry: "bg-berry-soft text-berry",
  } as const;
  return (
    <span
      /* whitespace-nowrap+shrink-0: 좁은 카드에서 "고학년"이 "고학/년"으로 접혔다(2026-07-13) */
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`touch-target w-full rounded-control border border-line bg-paper px-5 py-3 text-lg text-ink placeholder:text-ink-faint focus:border-sky ${className}`}
        {...rest}
      />
    );
  },
);

export function SectionTitle({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 className={`text-2xl font-semibold tracking-tight text-ink md:text-3xl ${className}`}>{children}</h2>
  );
}
