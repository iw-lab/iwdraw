import { Suspense } from "react";
import { SandClient } from "./sand-client";

export const metadata = { title: "샌드아트" };

export default function SandPage() {
  return (
    <Suspense fallback={<div className="grid h-dvh place-items-center font-display text-ink-soft">모래판을 깔고 있어요…</div>}>
      <SandClient />
    </Suspense>
  );
}
