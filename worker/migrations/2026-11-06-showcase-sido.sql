-- 전시관 그림에 붙는 시·도(예: 전북) — 교사가 걸 때 고른다 · NULL = 밝히지 않음. 학교·반은 절대 안 나간다(2026-11-03 «학교 이름은 빼자 · 도만»)
ALTER TABLE artworks ADD COLUMN showcase_sido TEXT;
