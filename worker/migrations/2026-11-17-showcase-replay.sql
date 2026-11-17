-- 전시관에 «그리는 과정»(샌드아트 기록)도 내보낼지 — 교사가 걸기 창에서 과정을 보고 따로 확인해야 1(2026-11-17).
-- 그림을 가렸거나(showcase_path) 학생이 다시 내면 0 — 과정 속 지운 이름은 네모로 못 가린다.
ALTER TABLE artworks ADD COLUMN showcase_replay INTEGER NOT NULL DEFAULT 0;
