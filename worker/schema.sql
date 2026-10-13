-- ArtON D1(SQLite) 스키마 — Supabase Postgres(0001_init.sql) 포팅.
-- 변경점: uuid→text(Worker crypto.randomUUID), timestamptz→integer(unix ms),
--         boolean→integer(0/1), RLS/정책/트리거/pgcrypto 제거(권한은 Worker가 강제),
--         teachers는 auth.users FK 대신 password_hash/salt 자체 인증, templates 테이블 생략(정적 매니페스트 사용).
-- created_at 기본값 = unixepoch()*1000 (ms). 앱 코드(Date.now())와 단위 일치.

PRAGMA foreign_keys = ON;

-- ── 교사 (이메일+비밀번호 자체 인증) ──
CREATE TABLE IF NOT EXISTS teachers (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '선생님',
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  password_hash TEXT NOT NULL,           -- PBKDF2 파생키(base64)
  password_salt TEXT NOT NULL,           -- 랜덤 salt(base64)
  agreed_at     INTEGER,                 -- 개인정보 수집·이용 동의 시각(ms). PIPA 동의 입증용.
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
-- 이미 배포된 DB: `wrangler d1 execute arton --remote --command "ALTER TABLE teachers ADD COLUMN agreed_at INTEGER"` — 2026-07-10 원격 적용 완료.

-- ── 학급 ──
CREATE TABLE IF NOT EXISTS classes (
  id         TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT '우리 반',
  code       TEXT NOT NULL UNIQUE,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS classes_teacher_idx ON classes(teacher_id);
CREATE INDEX IF NOT EXISTS classes_code_idx ON classes(code) WHERE is_active = 1;

-- ── 학생(개인정보 없음: 닉네임/아바타 시드만) ──
CREATE TABLE IF NOT EXISTS students (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  avatar_seed TEXT NOT NULL DEFAULT '',
  -- 작품 제출 rate limit 카운터(60초 슬라이딩 윈도). dedup 덮어쓰기까지 포함해 총 쓰기 시도를 세어
  -- draft를 여러 개 돌려 난타하는 우회를 막는다. 단일 UPDATE...RETURNING으로 증가시켜 원자적.
  -- ⚠️ 이미 배포된 DB엔 1회 필요:
  --    ALTER TABLE students ADD COLUMN write_window_start INTEGER;
  --    ALTER TABLE students ADD COLUMN write_count INTEGER;
  write_window_start INTEGER,
  write_count        INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS students_class_idx ON students(class_id);

-- ── 작품 ──
CREATE TABLE IF NOT EXISTS artworks (
  id             TEXT PRIMARY KEY,
  class_id       TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id     TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  mode           TEXT NOT NULL DEFAULT 'sketch',
  image_path     TEXT NOT NULL,
  thumb_path     TEXT NOT NULL,
  timelapse_path TEXT,
  -- 승인 게이트 비활성(2026-07-09): 제출 즉시 전시라 DEFAULT 1. 게이트를 되살리면 0으로.
  -- ⚠️ 이미 배포된 DB에 is_approved=0 행이 있다면 `UPDATE artworks SET is_approved=1` 1회 필요
  --    (학생 갤러리 WHERE is_approved=1 필터에 영구 은닉되고 승인 UI도 제거됨 — 교차검증 발견)
  is_approved    INTEGER NOT NULL DEFAULT 1,
  like_count     INTEGER NOT NULL DEFAULT 0,   -- 캐시(원천은 artwork_likes)
  -- dedup: 그리기 세션마다 클라가 발급하는 익명 랜덤 토큰. 같은 그림 재저장은 새 행을 만들지 않고
  -- (student_id, draft_id)로 자기 행을 덮어쓴다(삭제 능력 노출 0 — 남의 작품 못 지움). NULL=구버전/단발.
  -- ⚠️ 이미 배포된 DB엔 `ALTER TABLE artworks ADD COLUMN draft_id TEXT` 1회 필요(cf:deploy는 미실행).
  draft_id       TEXT,
  -- 학생이 붙인 그림 제목(선택). 서버가 제어문자 제거 + 30자로 자른다. NULL/빈문자 = 제목 없음.
  -- ⚠️ 이미 배포된 DB엔 `ALTER TABLE artworks ADD COLUMN title TEXT` 1회 필요(cf:deploy는 미실행).
  title          TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS artworks_class_idx ON artworks(class_id);
CREATE INDEX IF NOT EXISTS artworks_approved_idx ON artworks(class_id, is_approved);
-- 만료 정리 cron(WHERE created_at < ?)·삭제 임박 집계 스캔용
CREATE INDEX IF NOT EXISTS artworks_created_idx ON artworks(created_at);
-- dedup upsert 조회용 + 동시 요청(더블탭·재시도)에도 행이 둘로 갈라지지 않도록 UNIQUE.
-- SQLite는 NULL을 서로 다른 값으로 보므로 draft_id가 NULL인 구버전·단발 제출은 제한 없이 쌓인다.
-- ⚠️ 이미 배포된 DB엔 아래 1회 필요:
--    ALTER TABLE artworks ADD COLUMN draft_id TEXT;
--    CREATE UNIQUE INDEX artworks_student_draft_idx ON artworks(student_id, draft_id);
CREATE UNIQUE INDEX IF NOT EXISTS artworks_student_draft_idx ON artworks(student_id, draft_id);

-- ── 좋아요(중복 방지) ──
CREATE TABLE IF NOT EXISTS artwork_likes (
  artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  voter_key  TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (artwork_id, voter_key)
);

-- ── 협동 방(unique code + host + 만료) ──
CREATE TABLE IF NOT EXISTS collab_rooms (
  id              TEXT PRIMARY KEY,
  class_id        TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  host_teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  max_users       INTEGER NOT NULL DEFAULT 6,
  is_locked       INTEGER NOT NULL DEFAULT 0,
  expires_at      INTEGER NOT NULL DEFAULT ((unixepoch() + 21600) * 1000),  -- +6h
  closed_at       INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS collab_rooms_code_idx ON collab_rooms(code) WHERE closed_at IS NULL;
-- FK CASCADE(classes/teachers 삭제) 검사가 전체 훑기 하던 자리 — 2026-10-13 migrations/
CREATE INDEX IF NOT EXISTS collab_rooms_class_idx ON collab_rooms(class_id);
CREATE INDEX IF NOT EXISTS collab_rooms_host_idx ON collab_rooms(host_teacher_id);

-- ── 도안 배포(과제): 학급당 활성 1건 — 새 배포 시 이전 것을 비활성화 ──
CREATE TABLE IF NOT EXISTS assignments (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL,               -- /templates/... 정적 도안 경로(Worker가 검증)
  note        TEXT NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS assignments_class_idx ON assignments(class_id, is_active);
-- 배포 도안 조회의 ORDER BY created_at 까지 받침 — 2026-10-13 migrations/
CREATE INDEX IF NOT EXISTS assignments_class_active_created_idx ON assignments(class_id, is_active, created_at);

-- ── 학급코드 브루트포스 방어: join 시도 기록 ──
CREATE TABLE IF NOT EXISTS join_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash    TEXT NOT NULL,
  code_tried TEXT NOT NULL,
  success    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS join_attempts_ip_idx ON join_attempts(ip_hash, created_at DESC);
-- 정리 cron(created_at 단독 범위 삭제)용 — 위 복합 인덱스는 선행 컬럼이 ip_hash 라 못 쓴다
CREATE INDEX IF NOT EXISTS join_attempts_created_idx ON join_attempts(created_at);

-- ── 구독/결제(빌링키 자동결제 골격, 기본 비활성) ──
CREATE TABLE IF NOT EXISTS subscriptions (
  id                 TEXT PRIMARY KEY,
  teacher_id         TEXT NOT NULL UNIQUE REFERENCES teachers(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none','active','past_due','canceled')),
  billing_key        TEXT,
  current_period_end INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  teacher_id      TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  order_id        TEXT NOT NULL UNIQUE,        -- 멱등성
  payment_key     TEXT UNIQUE,
  amount          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed','canceled')),
  idempotency_key TEXT UNIQUE,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS payments_teacher_idx ON payments(teacher_id);
