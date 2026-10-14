#!/usr/bin/env node
/*
 * 도안 큐레이션 — scripts/template-curation.json(2026-10-14 전수 조사 결과)을 manifest.json 에 멱등 적용.
 *
 *  ① remove  : 중복·제목과 다른 그림·우리 전통과 맞지 않는 그림을 목록과 파일(원본·썸네일)에서 뺀다
 *  ② retitle : 영어 코드가 제목으로 나가던 항목(pirates·circus·safari)과 그림과 다른 제목을 고친다
 *  ③ 깨진 그림 : 디코드가 안 되는 항목은 --iwart 원본 png 로 다시 만들고, 원본이 없으면 목록에서 뺀다
 *  ③-2 add  : 메타 AI로 다시 그린 도안을 붙인다(빠진 서양풍 그림 자리)
 *  ④ partial : 비어 있던 «단계별 색칠» pc_* 11주제를 iwart 부분채색 세트(반쪽·1/4)로 채운다
 *  ⑤ 개수·표지를 다시 맞추고 썸네일 생성기(gen-template-thumbs.mjs)를 부른다
 *
 * import-iwart-templates.mjs 가 끝에서 부른다 → 재이관해도 정리가 유지된다.
 * 실행: node scripts/curate-templates.mjs [--iwart <iwart/site>]   (--iwart 는 새 파일을 복사할 때만 필요)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const PUB = join(ROOT, "public");
const MANIFEST = join(PUB, "templates", "manifest.json");
const CUR = JSON.parse(readFileSync(join(__dir, "template-curation.json"), "utf8"));
const args = process.argv.slice(2);
const IWART = args.includes("--iwart") ? args[args.indexOf("--iwart") + 1] : null;
if (args.includes("--iwart") && (!IWART || !existsSync(IWART))) throw new Error(`--iwart 경로가 없다: ${IWART}`);

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const pub = (url) => join(PUB, url.replace(/^\//, ""));
const stat = { removed: 0, retitled: 0, repaired: 0, dropped: 0, added: 0, partial: 0 };

async function decodes(file) {
  if (!existsSync(file) || statSync(file).size === 0) return false;
  try {
    await sharp(file).stats();
    return true;
  } catch {
    return false;
  }
}

// ①②③ 일반 주제
for (const t of Object.values(manifest.themes)) {
  if (t.theme.startsWith("pc_")) continue;
  const kept = [];
  for (const it of t.items) {
    if (CUR.remove[it.id]) {
      for (const f of [it.image, it.thumb]) if (f && existsSync(pub(f))) rmSync(pub(f));
      stat.removed++;
      continue;
    }
    if (CUR.retitle[it.id] && it.title !== CUR.retitle[it.id]) {
      it.title = CUR.retitle[it.id];
      stat.retitled++;
    }
    if (!(await decodes(pub(it.image)))) {
      const png = IWART && join(IWART, "assets", "coloring", t.theme, `${it.id}.png`);
      if (png && existsSync(png)) {
        await sharp(png).toColorspace("srgb").removeAlpha().webp({ quality: 82 }).toFile(pub(it.image) + ".tmp");
        copyFileSync(pub(it.image) + ".tmp", pub(it.image));
        rmSync(pub(it.image) + ".tmp");
        if (it.thumb && existsSync(pub(it.thumb))) rmSync(pub(it.thumb)); // 썸네일도 새로 굽게
        stat.repaired++;
      } else {
        console.warn(`  [drop] ${it.id}: 그림이 깨졌고 원본이 없다`);
        stat.dropped++;
        continue;
      }
    }
    kept.push(it);
  }
  // 새로 그린 도안(add) — 파일이 있고 아직 목록에 없으면 같은 학년 묶음 끝에 붙인다
  const ORDER = { low: 0, mid: 1, high: 2 };
  for (const a of CUR.add?.[t.theme] ?? []) {
    const image = `/templates/${t.theme}/${a.id}.webp`;
    if (kept.some((i) => i.id === a.id) || !existsSync(pub(image))) continue;
    if (!(await decodes(pub(image)))) {
      console.warn(`  [skip] ${a.id}: 새 도안 그림이 깨졌다`);
      continue;
    }
    const at = kept.findLastIndex((i) => (ORDER[i.grade] ?? 1) <= (ORDER[a.grade] ?? 1)) + 1;
    kept.splice(at, 0, { id: a.id, title: a.title, grade: a.grade, image });
    stat.added++;
  }
  t.items = kept;
}

// ④ 부분색칠 — 세트마다 반쪽(저학년)·1/4(중학년), 방향은 세트 번호로 돌린다
const HALF = ["half_l", "half_r", "half_t", "half_b"];
const QUARTER = ["quarter", "quarter_tr", "quarter_bl", "quarter_br"];
for (const [theme, sets] of Object.entries(CUR.partial.sets)) {
  const t = manifest.themes[theme];
  if (!t) continue;
  const prevThumb = Object.fromEntries(t.items.map((i) => [i.id, i.thumb]));
  const dir = join(PUB, "templates", theme);
  mkdirSync(dir, { recursive: true });
  const halves = [];
  const quarters = [];
  for (const [n, { set, ko }] of sets.entries()) {
    for (const [kind, variant, grade, label, list] of [
      ["half", HALF[n % 4], "low", "반쪽 완성하기", halves],
      ["quarter", QUARTER[n % 4], "mid", "1/4 완성하기", quarters],
    ]) {
      const id = `pc_${set}_${kind}`;
      const dst = join(dir, `${id}.webp`);
      const src = IWART && join(IWART, "assets", "partial", theme.slice(3), set, `${variant}.webp`);
      if (CUR.remove[id]) {
        for (const f of [dst, prevThumb[id] && pub(prevThumb[id])]) if (f && existsSync(f)) rmSync(f);
        continue;
      }
      if (src && existsSync(src)) copyFileSync(src, dst);
      if (!existsSync(dst)) continue;
      if (!(await decodes(dst))) {
        console.warn(`  [drop] ${id}: 부분색칠 그림이 깨졌다`);
        stat.dropped++;
        continue;
      }
      const item = { id, title: `${ko} ${label}`, grade, image: `/templates/${theme}/${id}.webp` };
      if (prevThumb[id]) item.thumb = prevThumb[id];
      list.push(item);
    }
  }
  t.items = [...halves, ...quarters];
  stat.partial += t.items.length;
}

// ⑤ 개수·표지
for (const t of Object.values(manifest.themes)) {
  t.count = t.items.length;
  t.cover = t.items[0]?.image ?? null;
  t.coverThumb = t.items[0]?.thumb ?? null;
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(
  `✅ 큐레이션: 삭제 ${stat.removed} · 제목 ${stat.retitled} · 복구 ${stat.repaired} · 깨져서 뺌 ${stat.dropped} · 새 도안 ${stat.added} · 부분색칠 ${stat.partial}장`,
);
execFileSync(process.execPath, [join(__dir, "gen-template-thumbs.mjs")], { cwd: ROOT, stdio: "inherit" });
