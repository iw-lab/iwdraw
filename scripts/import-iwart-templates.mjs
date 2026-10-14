#!/usr/bin/env node
/*
 * iwart(Coloria) 색칠 도안 → 아트온 정적 템플릿 이관.
 * webp를 public/templates/<theme>/ 로 복사하고, 카테고리 매핑으로 manifest.json 생성.
 * 로그인 없이 게스트가 색칠할 수 있도록 정적 자산으로 제공(Storage 불필요).
 *
 * 끝에서 curate-templates.mjs 를 부른다 — 중복·오류 도안 정리, 부분색칠(pc_*) 세트, 썸네일이 재이관 뒤에도 유지된다.
 *
 * 사용: node scripts/import-iwart-templates.mjs [--limit N] [--webp-only]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const MAP = JSON.parse(readFileSync(join(__dir, "iwart-category-map.json"), "utf8"));
const SRC = process.env.IWART_SITE || MAP.source; // /Users/.../iwart/site (다른 맥이면 IWART_SITE 로 덮는다)
const THEMES_DIR = join(SRC, "content", "themes");
const OUT_DIR = join(ROOT, "public", "templates");

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : Infinity;

// theme → category 역매핑
const themeToCat = {};
for (const [catId, cat] of Object.entries(MAP.categories)) {
  for (const t of cat.themes) themeToCat[t] = { catId, ...cat };
}

const manifest = { categories: [], themes: {}, generatedFrom: "iwart" };
let copied = 0;
let missing = 0;

for (const [catId, cat] of Object.entries(MAP.categories)) {
  manifest.categories.push({
    id: catId,
    title: cat.title,
    emoji: cat.emoji,
    themes: cat.themes,
    partial: !!cat.partial,
  });
}

for (const [theme, meta] of Object.entries(themeToCat)) {
  const themeJsonPath = join(THEMES_DIR, `${theme}.json`);
  if (!existsSync(themeJsonPath)) {
    // 부분채색(pc_*)은 content/themes에 없을 수 있음 → index.json fallback 생략
    console.warn(`  [skip] ${theme}: themes/${theme}.json 없음`);
    continue;
  }
  const tj = JSON.parse(readFileSync(themeJsonPath, "utf8"));
  const items = (tj.items ?? []).slice(0, limit);
  const themeOut = join(OUT_DIR, theme);
  mkdirSync(themeOut, { recursive: true });

  const outItems = [];
  for (const it of items) {
    // iwart 경로는 site 기준 상대(assets/coloring/<theme>/<id>.webp)
    const webpRel = it.webp || (it.id ? `assets/coloring/${theme}/${it.id}.webp` : null);
    if (!webpRel) {
      missing++;
      continue;
    }
    const srcWebp = join(SRC, webpRel);
    if (!existsSync(srcWebp)) {
      missing++;
      continue;
    }
    const fname = `${it.id}.webp`;
    copyFileSync(srcWebp, join(themeOut, fname));
    copied++;
    outItems.push({
      id: it.id,
      title: it.subject_ko || tj.title,
      grade: it.grade || "low",
      // 색칠 캔버스 라인아트 + 그리드 썸네일 공용(webp)
      image: `/templates/${theme}/${fname}`,
    });
  }
  manifest.themes[theme] = {
    theme,
    title: tj.title,
    category: meta.catId,
    count: outItems.length,
    cover: outItems[0]?.image ?? null,
    items: outItems,
  };
}

// iwart 밖에서 추가된 카테고리(명화 팩 masters 등)는 보존 — 재실행이 남의 항목을 지우면 안 된다
const manifestPath = join(OUT_DIR, "manifest.json");
if (existsSync(manifestPath)) {
  const prev = JSON.parse(readFileSync(manifestPath, "utf8"));
  const iwartThemes = new Set(Object.keys(themeToCat));
  for (const cat of prev.categories ?? []) {
    if (!MAP.categories[cat.id] && !manifest.categories.some((c) => c.id === cat.id)) {
      manifest.categories.push(cat);
    }
  }
  for (const [name, theme] of Object.entries(prev.themes ?? {})) {
    if (!iwartThemes.has(name) && !manifest.themes[name]) manifest.themes[name] = theme;
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const totalItems = Object.values(manifest.themes).reduce((a, t) => a + t.count, 0);
console.log(`✅ 템플릿 이관 완료: ${copied}장 복사, ${missing} 누락, ${totalItems} 매니페스트 등록`);
console.log(`   카테고리 ${manifest.categories.length}개, 테마 ${Object.keys(manifest.themes).length}개`);

// 2026-10-14 전수 조사 정리(template-curation.json) + 부분색칠 세트 + 썸네일 — 이걸 빼면 재이관이 정리를 되돌린다
execFileSync(process.execPath, [join(__dir, "curate-templates.mjs"), "--iwart", SRC], { stdio: "inherit" });
