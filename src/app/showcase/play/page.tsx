import type { Metadata } from "next";
import { ShowcasePlay } from "./showcase-play";

export const metadata: Metadata = {
  title: "그리는 과정",
  robots: { index: false, follow: false },
};

export default function ShowcasePlayPage() {
  return <ShowcasePlay />;
}
