-- 전시관 목록(WHERE showcase_at IS NOT NULL ORDER BY showcase_at DESC) — 건 작품만 담는 부분 색인(표 전체 훑기 0)
-- 파일 이름 날짜를 컬럼 추가(2026-11-03-showcase.sql) 뒤로 — 적용기는 이름 순서로 돈다
CREATE INDEX IF NOT EXISTS artworks_showcase_idx ON artworks(showcase_at) WHERE showcase_at IS NOT NULL;
