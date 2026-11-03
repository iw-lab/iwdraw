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
ok((await O(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true}' })).status === 404, '남의 교사는 못 건다');
ok((await fetch(`${BASE}/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true}' })).status === 401, '로그인 없이는 못 건다');
ok((await T(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":"yes"}' })).status === 400, '모양 틀린 요청은 400');
ok((await T(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true}' })).ok, '내 학급 작품 걸기');

const list = await fetch(BASE + '/api/showcase');
const raw = await list.text();
const body = JSON.parse(raw);
ok(list.headers.get('access-control-allow-origin') === '*', '공개 목록 CORS *');
ok(body.works.some((w) => w.id === a1) && !body.works.some((w) => w.id === a2), '건 작품만 나온다');
ok(body.works.every((w) => Object.keys(w).sort().join() === 'at,id,likes'), `나가는 칸 = id·at·likes 뿐 (${Object.keys(body.works[0] || {}).join(',')})`);
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

ok((await T(`/api/artworks/${a1}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true}' })).ok, '다시 걸기');
await fetch(`${BASE}/api/showcase/${a1}`);   // 그림 캐시를 채워 둔다
ok((await T(`/api/artworks/${a1}`, { method: 'DELETE' })).ok, '전시 중인 작품 삭제');
ok(!(await (await fetch(BASE + '/api/showcase')).json()).works.some((w) => w.id === a1), '지운 작품은 목록에서 바로 빠진다');
ok((await fetch(`${BASE}/api/showcase/${a1}`)).status === 404, '지운 작품 그림도 바로 404');

console.log(bad ? `❌ 전시관 시험 ${bad}칸 실패` : '✅ 전시관 시험 전부 통과');
process.exit(bad ? 1 : 0);
