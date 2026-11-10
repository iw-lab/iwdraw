#!/usr/bin/env node
/*
 * 원격 D1 마이그레이션 적용기 — cf:deploy 가 **워커 배포 직전에** 호출한다.
 *
 * 왜 스크립트인가: 마이그레이션이 배포보다 늦으면 새 워커가 없는 컬럼을 참조해
 * "no such column" 으로 **저장·갤러리가 통째로 죽는다**(2026-09-01 교차검증 CRITICAL).
 * 주석으로 순서를 지시하는 것만으론 사람이 잊는다 — 기계가 강제한다.
 *
 * SQLite 는 ALTER TABLE ... IF NOT EXISTS 가 없어 재실행이 "duplicate column" 으로
 * 실패한다. 그 에러 하나만 "이미 적용됨"으로 보고 통과시키고, 나머지 실패(인증·네트워크·
 * 문법)는 그대로 배포를 막는다 — 관용을 넓히면 미적용인 채로 배포되는 걸 못 막는다.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dir = path.join(process.cwd(), "worker", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const ALREADY = /duplicate column name|already exists/i;

// OAuth 토큰이 만료되면 import API 가 «Authentication error [code: 10000]»로 실패한다(2026-11-10 하루 두 번 배포 중단).
// whoami 가 토큰을 새로 받아 오므로, 그 오류면 한 번 새로 받고 다시 시도한다.
const AUTH_EXPIRED = /Authentication error \[code: 10000\]/;
const exec = (rel) => {
  const r = spawnSync(
    "bash",
    // 격리 로그인 래퍼(전역 wrangler 로그인은 다른 계정일 수 있다 — tools/cf.sh 주석)
    ["tools/cf.sh", "d1", "execute", "arton", "--remote", "--yes", "--file", rel],
    { encoding: "utf8" },
  );
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

for (const f of files) {
  const rel = path.join("worker", "migrations", f);
  let r = exec(rel);
  if (r.status !== 0 && AUTH_EXPIRED.test(r.out)) {
    console.log(`↻ ${f} — 로그인 토큰 만료, 새로 받아 다시 시도`);
    spawnSync("bash", ["tools/cf.sh", "whoami"], { encoding: "utf8" });
    r = exec(rel);
  }
  const out = r.out;
  if (r.status === 0) {
    console.log(`✓ ${f} 적용`);
  } else if (ALREADY.test(out)) {
    console.log(`· ${f} 이미 적용됨 — 통과`);
  } else {
    console.error(`✘ ${f} 실패 — 배포를 중단합니다\n${out}`);
    process.exit(1);
  }
}
