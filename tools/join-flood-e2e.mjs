// 입장 폭주 시험(2026-11-06) — 한 IP 가 틀린 코드를 60번 눌러도 막힌 시도는 줄이 쌓이지 않는다·막힘은 그대로 유지된다.
//   실측: 한 IP 4,222번 → D1 800만 행 → 계정 하루 한도 초과 → 아트온 전시·학습만화 이미지 전부 500.
//   node tools/join-flood-e2e.mjs <base> <persist 폴더>   (tools/cf.sh dev --port 8799 --persist-to <폴더>)
import { execFileSync } from 'node:child_process';
const BASE = (process.argv[2] || 'http://127.0.0.1:8799').replace(/\/$/, ''), PERSIST = process.argv[3];
const post = (code) => fetch(`${BASE}/api/join`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ code, nickname: '시험' }) });
const seen = {};
for (let i = 0; i < 60; i++) { const r = await post('ZZZZZ9'); seen[r.status] = (seen[r.status] || 0) + 1; }
const out = execFileSync('bash', ['tools/cf.sh', 'd1', 'execute', 'arton', '--local', '--persist-to', PERSIST, '--json', '--command', 'SELECT COUNT(*) AS n FROM join_attempts'], { encoding: 'utf8' });
const rows = JSON.parse(out.slice(out.indexOf('[')))[0].results[0].n;
console.log('응답', JSON.stringify(seen), '쌓인 줄', rows);
let bad = 0; const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };
ok(rows <= 8, `막힌 시도는 줄을 안 쌓는다(${rows} ≤ 8)`);
ok((seen[429] || 0) >= 50, `상한 뒤로는 계속 막힌다(429 ${seen[429] || 0}번)`);
process.exit(bad ? 1 : 0);
