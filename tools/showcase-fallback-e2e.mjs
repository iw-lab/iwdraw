// DB 가 막혀도 전시 그림은 보인다·내린 그림은 비상 경로로도 안 나간다(2026-11-06 계정 D1 한도 초과로 그림 전부 500).
//   node tools/showcase-fallback-e2e.mjs <base> <persist 폴더>
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2], PERSIST = process.argv[3], json = { 'content-type': 'application/json' };
let bad = 0; const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };
let cookie = ''; const T = async (p, i = {}) => { const r = await fetch(BASE + p, { ...i, headers: { ...(i.headers || {}), ...(cookie ? { cookie } : {}), origin: BASE }, redirect: 'manual' }); const sc = r.headers.getSetCookie?.() || []; if (sc.length) cookie = sc.map((s) => s.split(';')[0]).join('; '); return r; };
await T('/api/teacher/signup', { method: 'POST', headers: json, body: JSON.stringify({ email: `fb-${Date.now()}@example.com`, password: 'testpass-1234', agreed: true }) });
const cls = await (await T('/api/classes', { method: 'POST', headers: json, body: JSON.stringify({ name: '시험반' }) })).json();
const join = await (await fetch(BASE + '/api/join', { method: 'POST', headers: { ...json, origin: BASE }, body: JSON.stringify({ code: cls.code, nickname: '시험' }) })).json();
const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' });
const up = async () => { const f = new FormData(); f.set('mode', 'sketch'); f.set('image', png(), 'a.png'); f.set('thumb', png(), 't.png'); f.set('title', '그림'); f.set('draft_id', `d${Math.random()}`); return (await (await fetch(BASE + '/api/artwork', { method: 'POST', headers: { authorization: `Bearer ${join.token}`, origin: BASE }, body: f })).json()).id; };
const a = await up(), b = await up();
for (const id of [a, b]) await T(`/api/artworks/${id}/showcase`, { method: 'PATCH', headers: json, body: '{"on":true,"checked":true}' });
await fetch(BASE + '/api/showcase');   // 마지막 정상 전시 적기
await new Promise((r) => setTimeout(r, 800));
await T(`/api/artworks/${b}/showcase`, { method: 'PATCH', headers: json, body: '{"on":false}' });   // b 내리기
const l2 = await (await fetch(BASE + '/api/showcase')).json();
ok(l2.works.some((w) => w.id === a) && !l2.works.some((w) => w.id === b), '내린 그림은 목록에서 빠진다');
await new Promise((r) => setTimeout(r, 800));
execFileSync('bash', ['tools/cf.sh', 'd1', 'execute', 'arton', '--local', '--persist-to', PERSIST, '--command', 'ALTER TABLE artworks RENAME TO artworks_down'], { stdio: 'ignore' });   // DB 막힘 흉내
const ia = await fetch(`${BASE}/api/showcase/${a}`), ib = await fetch(`${BASE}/api/showcase/${b}`);
ok(ia.status === 200 && (ia.headers.get('content-type') || '').startsWith('image/'), `DB 가 막혀도 걸린 그림은 보인다(${ia.status})`);
ok(ib.status !== 200, `내린 그림은 비상 경로로도 안 나간다(${ib.status})`);
const before = cls.code; void before;
process.exit(bad ? 1 : 0);
