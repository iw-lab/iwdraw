// 선행쌤 전시관 «걸기 전 확인» 실창 시험(2026-11-03 그림 속 실명 «김서하»가 그대로 나갔다)
//   교사 화면에서 «걸기» → 확인 창 → 확인 칸을 안 누르면 못 건다 → 이름 자리를 네모로 그려 가린다 → 걸기
//   → 공개 그림에 글씨(검은 획)가 안 남았다 · 학생 원본은 그대로
//   node tools/showcase-ui-e2e.mjs [base]   (tools/cf.sh dev --port 8833 --persist-to <폴더> · 빌드 out/ 필요)
import { createRequire } from 'node:module';
import os from 'node:os';
const puppeteer = createRequire(os.homedir() + '/.claude/skills/game-builder/')('puppeteer');
const BASE = (process.argv[2] || 'http://127.0.0.1:8833').replace(/\/$/, '');
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };
const b = await puppeteer.launch({ headless: 'new' });
try {
  const p = await b.newPage(); await p.setViewport({ width: 1100, height: 900 });
  await p.goto(BASE + '/teacher/', { waitUntil: 'domcontentloaded' });
  // 교사·학급·학생·작품(노란 바탕 + 검은 «김서하» 글씨)을 같은 출처 fetch 로 — 쿠키는 브라우저가 들고 있다
  const setup = await p.evaluate(async () => {
    const j = { 'content-type': 'application/json' };
    const email = `ui-${Date.now()}@example.com`;
    const s = await fetch('/api/teacher/signup', { method: 'POST', headers: j, body: JSON.stringify({ email, password: 'testpass-1234', agreed: true }) });
    if (!s.ok) return { err: `signup ${s.status}` };
    const cls = await (await fetch('/api/classes', { method: 'POST', headers: j, body: JSON.stringify({ name: '시험반' }) })).json();
    const jn = await (await fetch('/api/join', { method: 'POST', headers: j, body: JSON.stringify({ code: cls.code, nickname: '별' }) })).json();
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300; const g = cv.getContext('2d');
    g.fillStyle = '#f6d86a'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#111'; g.font = 'bold 40px sans-serif'; g.fillText('김서하', 220, 270);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const f = new FormData(); f.set('mode', 'sketch'); f.set('image', blob, 'a.png'); f.set('thumb', blob, 't.png'); f.set('draft_id', 'ui1');
    const up = await (await fetch('/api/artwork', { method: 'POST', headers: { authorization: `Bearer ${jn.token}` }, body: f })).json();
    // 세로로 긴 그림(2026-11-04 사용자 «전시관 등록 누르면 카드가 아래가 잘려») — 확인 창이 화면을 넘던 것
    const tv = document.createElement('canvas'); tv.width = 400; tv.height = 1100; const tg = tv.getContext('2d'); tg.fillStyle = '#9ad'; tg.fillRect(0, 0, 400, 1100);
    const tb = await new Promise((r) => tv.toBlob(r, 'image/png'));
    const f2 = new FormData(); f2.set('mode', 'sketch'); f2.set('image', tb, 'b.png'); f2.set('thumb', tb, 't2.png'); f2.set('draft_id', 'ui2');
    const up2 = await (await fetch('/api/artwork', { method: 'POST', headers: { authorization: `Bearer ${jn.token}` }, body: f2 })).json();
    return { cls: cls.id, art: up.id, tall: up2.id };
  });
  ok(!setup.err && setup.art, `준비(교사·학급·작품) ${setup.err || ''}`);
  // 안내문(2026-11-03 «선생님 계정에서 안내문 잘 해줘 · 학교 이름은 빼고 도만») — 대시보드에 펼쳐져 있고 «시·도만»·«학교 안 나감»을 말한다
  await p.goto(`${BASE}/teacher/`, { waitUntil: 'networkidle2' });
  const guide = await p.waitForSelector('[data-showcase-guide]', { timeout: 15000 }).then((e) => e.evaluate((d) => ({ open: d.open, t: d.textContent }))).catch(() => null);
  // 2026-11-04 사용자 «첫 화면 다 차지 · 정리해줘» → 안내문은 접힌 한 줄 · 학급 목록 아래
  const place = await p.evaluate(() => { const g = document.querySelector('[data-showcase-guide]'); const c = [...document.querySelectorAll('h2')].find((h) => h.textContent.includes('시험반')); return { h: Math.round(g.getBoundingClientRect().height), below: !!c && (c.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 }; });
  ok(!guide?.open && place.h <= 60 && place.below, `대시보드 안내문 = 접힌 한 줄(${place.h}px) · 학급 목록 아래(${place.below})`);
  await p.$eval('[data-showcase-guide]', (d) => { d.open = true; }); const guideOpen = await p.$eval('[data-showcase-guide]', (d) => d.textContent);
  ok(guide && /시·도/.test(guideOpen) && /학교·반은/.test(guideOpen) && /3칸마다/.test(guideOpen) && /숨겨 주세요/.test(guideOpen), '대시보드 안내문(펼치면): 시·도만 · 학교 안 나감 · 새 그림 3칸마다 · 신고');
  await p.goto(`${BASE}/teacher/?gallery=${setup.cls}`, { waitUntil: 'networkidle2' });
  await p.waitForSelector(`[data-showcase-art="${setup.art}"]`, { timeout: 20000 });
  await p.click(`[data-showcase-art="${setup.art}"]`);
  ok(!!(await p.waitForSelector('[data-showcase-dialog]', { timeout: 5000 }).catch(() => null)), '«걸기» → 확인 창이 뜬다(바로 걸리지 않는다)');
  ok(await p.$eval('[data-showcase-confirm]', (e) => e.disabled), '«이름 없음» 확인 전엔 걸기 단추가 잠겨 있다');
  await p.waitForFunction(() => { const i = document.querySelector('[data-cover-box] img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 10000 });
  // 이름 자리(그림 x 210~400 · y 225~285)를 네모로 그린다 — 화면 좌표로 바꿔 진짜 끌기
  const box = await p.$eval('[data-cover-box]', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const at = (fx, fy) => [box.x + box.w * fx, box.y + box.h * fy];
  await p.mouse.move(...at(205 / 400, 222 / 300)); await p.mouse.down(); await p.mouse.move(...at(330 / 400, 260 / 300), { steps: 6 }); await p.mouse.move(...at(399 / 400, 288 / 300), { steps: 6 }); await p.mouse.up();
  ok(/가린 곳 1개/.test(await p.$eval('[data-showcase-dialog]', (e) => e.textContent)), '네모 하나 그림');
  await p.select('[data-showcase-sido]', '전북');
  await p.click('[data-showcase-check]');
  await p.click('[data-showcase-confirm]');
  ok(!!(await p.waitForSelector('[data-showcase="on"]', { timeout: 15000 }).catch(() => null)), '가린 그림으로 걸림');
  const res = await p.evaluate(async (id) => {
    const dark = async (url) => { const r = await fetch(url); if (!r.ok) return { st: r.status }; const bm = await createImageBitmap(await r.blob()); const cv = new OffscreenCanvas(bm.width, bm.height); const g = cv.getContext('2d'); g.drawImage(bm, 0, 0); const d = g.getImageData(0, 0, bm.width, bm.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 200) n++; return { st: r.status, n }; };
    const list = await (await fetch('/api/showcase')).json();
    return { pub: await dark(`/api/showcase/${id}`), r: list.works.find((w) => w.id === id)?.r };
  }, setup.art);
  ok(res.r === '전북', `전시 목록에 시·도 «전북»만 (${res.r})`);
  ok(!!(await p.$('[data-showcase-guide]')), '학급 갤러리에도 안내문');
  // 다른 기기(이 기기 기억 없음)에서도 전에 고른 «전북»이 미리 골라진다(2026-11-03 «다른 학교는 시·도를 모르나? 자동으로?»)
  const g = await p.evaluate(async () => (await fetch('/api/teacher/showcase-sido')).json());
  ok(g.sido === '전북' && g.from === 'last', `미리 고를 시·도 = 전에 고른 값 (${JSON.stringify(g)})`);
  ok(res.pub.st === 200 && res.pub.n === 0, `공개 그림에 글씨 획 0 (어두운 픽셀 ${res.pub.n})`);
  // 세로로 긴 그림 · 노트북 높이(700) — 확인 창이 화면 안에 다 들어오고 «걸기» 단추까지 닿는다
  await p.setViewport({ width: 1100, height: 700 });
  await p.goto(`${BASE}/teacher/?gallery=${setup.cls}`, { waitUntil: 'networkidle2' });
  await p.waitForSelector(`[data-showcase-art="${setup.tall}"]`, { timeout: 20000 });
  await p.click(`[data-showcase-art="${setup.tall}"]`);
  await p.waitForSelector('[data-showcase-dialog]', { timeout: 5000 });
  await p.waitForFunction(() => { const i = document.querySelector('[data-cover-box] img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 10000 });
  const fit = await p.evaluate(() => {
    const panel = document.querySelector('[data-showcase-dialog] > div').getBoundingClientRect();
    const btn = document.querySelector('[data-showcase-confirm]'); btn.scrollIntoView({ block: 'nearest' });
    const br = btn.getBoundingClientRect(); const box = document.querySelector('[data-cover-box]').getBoundingClientRect();
    return { top: Math.round(panel.top), bottom: Math.round(panel.bottom), vh: innerHeight, btnBottom: Math.round(br.bottom), boxH: Math.round(box.height) };
  });
  ok(fit.top >= 0 && fit.bottom <= fit.vh && fit.btnBottom <= fit.vh && fit.boxH <= fit.vh * 0.6, `세로로 긴 그림도 확인 창이 화면 안 · 걸기 단추 보임 (${JSON.stringify(fit)})`);
} finally {
  await b.close();
}
console.log(bad ? `❌ 전시 확인 창 시험 ${bad}칸 실패` : '✅ 전시 확인 창 시험 전부 통과');
process.exit(bad ? 1 : 0);
