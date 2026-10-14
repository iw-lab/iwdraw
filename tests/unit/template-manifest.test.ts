import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/*
 * 도안 목록(public/templates/manifest.json) 판정 — 2026-10-14 전수 조사 뒤 다시 깨지지 않게.
 * 사용자 제보: «단계별 색칠» 11주제가 0장이었고, 해적·서커스·사파리 104장은 제목이 영어 코드였고,
 * 같은 그림 두 장·그림과 다른 제목·0바이트 그림이 섞여 있었다. 정리 정본 = scripts/template-curation.json.
 */
const PUB = path.resolve(__dirname, "../../public");
const manifest = JSON.parse(readFileSync(path.join(PUB, "templates/manifest.json"), "utf8"));
const curation = JSON.parse(readFileSync(path.resolve(__dirname, "../../scripts/template-curation.json"), "utf8"));
const themes = Object.values(manifest.themes) as {
  theme: string;
  count: number;
  cover: string | null;
  coverThumb?: string | null;
  items: { id: string; title: string; image: string; thumb?: string }[];
}[];

describe("도안 목록", () => {
  it("카테고리에 걸린 주제는 전부 한 장 이상 있다(부분색칠 포함)", () => {
    const empty = manifest.categories
      .flatMap((c: { themes: string[] }) => c.themes)
      .filter((t: string) => !manifest.themes[t]?.items.length);
    expect(empty).toEqual([]);
  });

  it("제목이 영어 코드가 아니다", () => {
    const bad = themes.flatMap((t) => t.items.filter((i) => i.title === i.id || /^[a-z_]+_\d+$/.test(i.title)));
    expect(bad.map((i) => i.id)).toEqual([]);
  });

  it("한 주제 안에 같은 제목이 두 번 나오지 않는다", () => {
    const dup = themes.flatMap((t) => {
      const seen = new Set<string>();
      return t.items.filter((i) => (seen.has(i.title) ? true : (seen.add(i.title), false))).map((i) => `${t.theme}:${i.title}`);
    });
    expect(dup).toEqual([]);
  });

  it("정리 목록에서 뺀 도안이 되살아나지 않았다", () => {
    const ids = new Set(themes.flatMap((t) => t.items.map((i) => i.id)));
    expect(Object.keys(curation.remove).filter((id) => ids.has(id))).toEqual([]);
  });

  it("그림·썸네일 파일이 있고 0바이트가 아니다", () => {
    const bad: string[] = [];
    for (const t of themes)
      for (const i of t.items)
        for (const f of [i.image, i.thumb]) {
          const p = f && path.join(PUB, f);
          if (!p || !existsSync(p) || statSync(p).size === 0) bad.push(`${i.id} ${f}`);
        }
    expect(bad).toEqual([]);
  });

  it("개수·표지가 목록과 맞다", () => {
    const bad = themes.filter(
      (t) => t.count !== t.items.length || t.cover !== (t.items[0]?.image ?? null) || t.coverThumb !== (t.items[0]?.thumb ?? null),
    );
    expect(bad.map((t) => t.theme)).toEqual([]);
  });
});
