-- 선행쌤 작품 전시관(2026-11-03) — 교사가 고른 작품만 이름 없이 밖에 보인다. NULL = 전시 안 함(기본).
-- cf:deploy 가 워커 배포 직전에 적용(scripts/migrate-remote.mjs). 재실행 = "duplicate column" → 이미 적용으로 통과.
ALTER TABLE artworks ADD COLUMN showcase_at INTEGER;
