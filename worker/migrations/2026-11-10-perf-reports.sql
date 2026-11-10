-- 저사양 렉 계측(/api/perf) — 기술 수치만(개인정보 없음) · 30일 뒤 cron 삭제
CREATE TABLE IF NOT EXISTS perf_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  page TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS perf_reports_at_idx ON perf_reports (at);
