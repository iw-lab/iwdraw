// 선행쌤 작품 전시관 실제 흐름 시험(2026-11-03) — 이름이 절대 안 나가는지·고른 것만 나가는지.
//   교사 가입 → 학급 → 학생 입장(별명·제목에 표식) → 작품 2점 → 1점만 전시 → 공개 목록·그림 → 남의 교사 못 건드림 → 내리면 사라짐
//   node tools/showcase-e2e.mjs [base]      (기본 http://127.0.0.1:8799 — tools/cf.sh dev --port 8799 --persist-to <빈 폴더>)
const BASE = (process.argv[2] || 'http://127.0.0.1:8799').replace(/\/$/, '');
const MARK = '비밀별명';
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };

function jar() {
  let cookie = '';
  return async (path, init = {}) => {
    const r = await fetch(BASE + path, { ...init, headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}), origin: BASE }, redirect: 'manual' });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((s) => s.split(';')[0]).join('; ');
    return r;
  };
}
const json = { 'content-type': 'application/json' };
const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' });

async function teacher(tag) {
  const t = jar();
  const email = `sc-${tag}-${Date.now()}@example.com`;
  const r = await t('/api/teacher/signup', { method: 'POST', headers: json, body: JSON.stringify({ email, password: 'testpass-1234', agreed: true }) });
  if (!r.ok) throw new Error(`가입 ${r.status} ${await r.text()}`);
  return t;
}

const T = await teacher('a');
const cls = await (await T('/api/classes', { method: 'POST', headers: json, body: JSON.stringify({ name: `${MARK}반` }) })).json();
const join = await (await fetch(BASE + '/api/join', { method: 'POST', headers: { ...json, origin: BASE }, body: JSON.stringify({ code: cls.code, nickname: MARK }) })).json();
ok(!!join.token, '학생 입장');
const up = async (title) => {
  const f = new FormData();
  f.set('mode', 'sketch'); f.set('image', png(), 'a.png'); f.set('thumb', png(), 't.png'); f.set('title', title); f.set('draft_id', `d${Math.random()}`);
  const r = await fetch(BASE + '/api/artwork', { method: 'POST', headers: { authorization: `Bearer ${join.token}`, origin: BASE }, body: f });
  return (await r.json()).id;
};
const a1 = await up(`${MARK} 제목`), a2 = await up('안 건 그림');
ok(!!a1 && !!a2, '작품 2점 저장');

const before = await (await fetch(BASE + '/api/showcase')).json();
ok(!before.works.some((w) => w.id === a1 || w.id === a2), '제출만으로는 전시관에 안 나간다');
ok((await fetch(`${BASE}/api/showcase/${a1}`)).status === 404, '안 건 작품 그림은 404');

const O = await teacher('b');
ok((await T(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true}' })).status === 400, '«이름 없음» 확인 없이 걸기 = 거절');
ok((await O(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true,"checked":true}' })).status === 404, '남의 교사는 못 건다');
ok((await fetch(`${BASE}/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true}' })).status === 401, '로그인 없이는 못 건다');
ok((await T(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":"yes"}' })).status === 400, '모양 틀린 요청은 400');
ok((await T(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true,"checked":true}' })).ok, '내 학급 작품 걸기');

const list = await fetch(BASE + '/api/showcase');
const raw = await list.text();
const body = JSON.parse(raw);
ok(list.headers.get('access-control-allow-origin') === '*', '공개 목록 CORS *');
ok(body.works.some((w) => w.id === a1) && !body.works.some((w) => w.id === a2), '건 작품만 나온다');
ok(body.works.every((w) => Object.keys(w).sort().join() === 'at,fresh,id,likes,r,v,wk' && typeof w.v === 'boolean'), `나가는 칸 = id·at·likes·wk·fresh·시도·과정 여부 뿐 (${Object.keys(body.works[0] || {}).join(',')})`);
ok(!raw.includes(MARK) && !raw.includes(cls.id) && !raw.includes(join.studentId), '목록에 별명·제목·학급·학생 id 0');
const img = await fetch(`${BASE}/api/showcase/${a1}`);
const bytes = new Uint8Array(await img.arrayBuffer());
ok(img.ok && /^image\//.test(img.headers.get('content-type') || '') && bytes[1] === 0x50, `그림 200 image/* (${img.status} ${img.headers.get('content-type')})`);
ok(![...img.headers].some(([, v]) => v.includes(MARK) || v.includes(cls.id)), '그림 머리글에도 이름·학급 0');
ok((await fetch(`${BASE}/api/showcase/..%2f..%2fetc`)).status >= 400, '이상한 id 는 거절');

const tl = await (await T(`/api/classes/${cls.id}/artworks`)).json();
ok(tl.find((x) => x.id === a1)?.showcase_at > 0 && !tl.find((x) => x.id === a2)?.showcase_at, '교사 목록에 전시 표시');

ok((await T(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":false}' })).ok, '내리기');
const after = await (await fetch(BASE + '/api/showcase')).json();
ok(!after.works.some((w) => w.id === a1), '내리면 목록에서 바로 빠진다(이 지역 캐시 비움)');
ok((await fetch(`${BASE}/api/showcase/${a1}`)).status === 404, '내리면 그림도 404');

ok((await T(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true,"checked":true}' })).ok, '다시 걸기');
// 🔒 2026-11-03 공개 하트(선행쌤 화면) — 선행쌤 출처만 · 같은 기기 하나 · 취소 · 하트 순 목록 · 응답에 이름 0
{ const SS = 'http://localhost:4177'; const did = 'ab'.repeat(16), did2 = 'cd'.repeat(16);
  const like = (id, d, on, origin = SS) => fetch(`${BASE}/api/showcase/${id}/like`, { method: 'POST', headers: { ...json, origin }, body: JSON.stringify({ did: d, on }) });
  ok((await like(a1, did, true, 'https://evil.example')).status === 403, '남의 출처 하트 거절');
  ok((await like(a2, did, true)).status === 404, '안 건 작품엔 하트 못 줌');
  const r1 = await (await like(a1, did, true)).json(); const r2 = await (await like(a1, did, true)).json();
  ok(r1.likes === 1 && r2.likes === 1, `같은 기기 두 번 = 1 (${r1.likes}/${r2.likes})`);
  const r3 = await (await like(a1, did2, true)).json(); ok(r3.likes === 2, `다른 기기 = 2 (${r3.likes})`);
  const r4 = await (await like(a1, did, false)).json(); ok(r4.likes === 1, `취소 = 1 (${r4.likes})`);
  ok(!JSON.stringify(r4).includes(MARK) && Object.keys(r4).sort().join() === 'liked,likes,ok', '하트 응답에 이름·학급 0');
  const pre = await fetch(`${BASE}/api/showcase/${a1}/like`, { method: 'OPTIONS', headers: { origin: SS, 'access-control-request-method': 'POST' } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === SS, '미리 묻기(CORS) 통과');
  ok((await like(a1, 'zz', true)).status === 400, '이상한 기기 번호 거절'); }

await fetch(`${BASE}/api/showcase/${a1}`);   // 그림 캐시를 채워 둔다
ok((await T(`/api/artworks/${a1}`, { method: 'DELETE' })).ok, '전시 중인 작품 삭제');
ok(!(await (await fetch(BASE + '/api/showcase')).json()).works.some((w) => w.id === a1), '지운 작품은 목록에서 바로 빠진다');
ok((await fetch(`${BASE}/api/showcase/${a1}`)).status === 404, '지운 작품 그림도 바로 404');

// 🔒 2026-11-03 이름 가린 전시용 사본 · «숨겨 주세요» 신고
{ const T2 = await teacher('c'); const c2 = await (await T2('/api/classes', { method: 'POST', headers: json, body: JSON.stringify({ name: '셋째반' }) })).json();
  const j2 = await (await fetch(BASE + '/api/join', { method: 'POST', headers: { ...json, origin: BASE }, body: JSON.stringify({ code: c2.code, nickname: '별' }) })).json();
  const f = new FormData(); f.set('mode', 'sketch'); f.set('image', png(), 'a.png'); f.set('thumb', png(), 't.png'); f.set('draft_id', 'dz');
  const a3 = (await (await fetch(BASE + '/api/artwork', { method: 'POST', headers: { authorization: `Bearer ${j2.token}`, origin: BASE }, body: f })).json()).id;
  const cover = new Uint8Array(await png().arrayBuffer()); cover[cover.length - 13] ^= 1;   /* 원본과 다른 바이트 */
  ok((await T(`/api/artworks/${a3}/showcase-image`, { method: 'PUT', body: cover })).status === 404, '남의 교사는 전시용 사본 못 올림');
  ok((await T2(`/api/artworks/${a3}/showcase-image`, { method: 'PUT', body: new TextEncoder().encode('not image') })).status === 415, '그림 아닌 것 거절');
  ok((await T2(`/api/artworks/${a3}/showcase-image`, { method: 'PUT', body: cover })).ok, '이름 가린 사본 올리기');
  ok((await T2(`/api/artworks/${a3}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true,"checked":true,"sido":"김제중앙초"}' })).status === 400, '시·도 칸에 학교 이름 = 거절');
  ok((await T2(`/api/artworks/${a3}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true,"checked":true,"sido":"전북"}' })).ok, '사본으로 걸기(시·도 전북)');
  { const L = await (await fetch(BASE + '/api/showcase')).json(); ok(L.works.find((w) => w.id === a3)?.r === '전북', '목록에 시·도 «전북»'); }
  const served = new Uint8Array(await (await fetch(`${BASE}/api/showcase/${a3}`)).arrayBuffer());
  ok(served.length === cover.length && served.every((b, i) => b === cover[i]), '전시관엔 가린 사본이 나간다(원본 아님)');
  const rep = await (await fetch(`${BASE}/api/showcase/${a3}/report`, { method: 'POST', headers: { origin: 'http://localhost:4177' } })).json();
  ok(rep.hidden === true, '«숨겨 주세요» 한 번 = 바로 내려감');
  ok(!(await (await fetch(BASE + '/api/showcase')).json()).works.some((w) => w.id === a3), '신고한 작품은 목록에서 빠진다');
  ok((await fetch(`${BASE}/api/showcase/${a3}`)).status === 404, '신고한 작품 그림도 404');
  const tl3 = await (await T2(`/api/classes/${c2.id}/artworks`)).json(); ok(tl3.find((x) => x.id === a3)?.showcase_report > 0, '교사 목록에 «신고로 내려짐»');
  ok((await fetch(`${BASE}/api/showcase/${a3}/report`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status === 403, '남의 출처 신고 거절'); }

// 🔒 2026-11-17 «그리는 과정»도 걸기 — 교사가 과정까지 확인한 샌드아트만 · 가리면·다시 내면 안 나간다
{ const T4 = await teacher('d'); const c4 = await (await T4('/api/classes', { method: 'POST', headers: json, body: JSON.stringify({ name: '넷째반' }) })).json();
  const j4 = await (await fetch(BASE + '/api/join', { method: 'POST', headers: { ...json, origin: BASE }, body: JSON.stringify({ code: c4.code, nickname: '모래' }) })).json();
  const rec = new Uint8Array(await new Response(new Blob([JSON.stringify({ k: 'arton-sand', v: 1, ops: [] })]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const sand = async (draft, mode = 'sand') => { const f = new FormData(); f.set('mode', mode); f.set('image', png(), 'a.png'); f.set('thumb', png(), 't.png'); f.set('draft_id', draft); f.set('timelapse', new Blob([rec], { type: 'application/gzip' }), 'r.sand');
    return (await (await fetch(BASE + '/api/artwork', { method: 'POST', headers: { authorization: `Bearer ${j4.token}`, origin: BASE }, body: f })).json()).id; };
  const s1 = await sand('ds1'), s2 = await sand('ds2', 'sketch');
  const verOf = async (id) => (await (await T4(`/api/classes/${c4.id}/artworks`)).json()).find((x) => x.id === id)?.created_at;
  const hang = async (id, b) => T4(`/api/artworks/${id}/showcase`, { method: 'PATCH', headers: json, body: JSON.stringify({ on: true, checked: true, ver: await verOf(id), ...b }) });
  const L = async () => (await (await fetch(BASE + '/api/showcase')).json()).works;
  const R = (id) => fetch(`${BASE}/api/showcase/${id}/replay`);
  ok((await hang(s1, {})).ok && (await L()).find((w) => w.id === s1)?.v === false, '과정 확인 없이 걸면 그림만(v=false)');
  ok((await R(s1)).status === 404, '과정 안 건 작품의 기록 = 404');
  ok((await hang(s1, { replay: true })).status === 400, '과정 확인(replayChecked) 없이 과정 걸기 = 거절');
  ok((await hang(s1, { replay: true, replayChecked: true })).ok && (await L()).find((w) => w.id === s1)?.v === true, '과정까지 확인 = v=true');
  { const r = await R(s1); const b = new Uint8Array(await r.arrayBuffer());
    ok(r.ok && b.length === rec.length && b.every((x, i) => x === rec[i]), '전시관 기록 = 학생이 낸 그 기록');
    ok(!r.headers.get('access-control-allow-origin'), '기록은 아트온 재생 화면(같은 출처)만 — CORS 없음'); }
  ok((await hang(s2, { replay: true, replayChecked: true })).ok && (await L()).find((w) => w.id === s2)?.v === false && (await R(s2)).status === 404, '샌드아트 아닌 그림은 과정 안 나감');
  ok(!JSON.stringify(await L()).includes('모래') && !JSON.stringify(await L()).includes('.sand'), '목록에 별명·저장 경로 0');
  // 가린 사본 = 과정은 못 가리니 내린다
  { const cover = new Uint8Array(await png().arrayBuffer()); cover[cover.length - 13] ^= 1;
    ok((await T4(`/api/artworks/${s1}/showcase-image`, { method: 'PUT', body: cover })).ok, '가린 사본 올리기');
    ok((await L()).find((w) => w.id === s1)?.v === false && (await R(s1)).status === 404, '가린 그림은 과정이 안 나간다'); }
  // 다시 걸고 → 학생이 같은 그림을 다시 내면 전시관에서 내려간다(선생님이 본 건 옛 그림)
  const s3 = await sand('ds3');
  ok((await hang(s3, { replay: true, replayChecked: true })).ok && (await R(s3)).ok, '새 작품 과정까지 걸기');
  await new Promise((r) => setTimeout(r, 1700));   /* 같은 그림 1.5초 안 덮어쓰기는 서버가 막는다 */
  ok((await sand('ds3')) === s3, '학생이 같은 그림을 다시 냄');
  ok(!(await L()).some((w) => w.id === s3) && (await R(s3)).status === 404 && (await fetch(`${BASE}/api/showcase/${s3}`)).status === 404, '다시 낸 그림은 전시관에서 내려간다(확인 없이 새 그림·새 과정이 나가지 않게)');
  ok((await hang(s3, { replay: true, replayChecked: true, ver: 1 })).status === 409 && !(await L()).some((w) => w.id === s3), '옛 판을 보고 누른 걸기 = 409(창을 연 사이 다시 낸 그림은 안 걸린다)');
  ok((await hang(s3, { replay: true, replayChecked: true, ver: undefined })).status === 400, '본 판 없이 과정 걸기 = 거절');
  ok((await hang(s3, { replay: true, replayChecked: true })).ok && (await R(s3)).ok, '선생님이 다시 확인하면 다시 걸린다');
  ok((await T4(`/api/artworks/${s3}/showcase`, { method: 'PATCH', headers: json, body: '{"on":false}' })).ok && (await R(s3)).status === 404, '내리면 과정도 바로 404'); }

console.log(bad ? `❌ 전시관 시험 ${bad}칸 실패` : '✅ 전시관 시험 전부 통과');
process.exit(bad ? 1 : 0);
