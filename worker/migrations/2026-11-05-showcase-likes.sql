-- 선행쌤 전시관 공개 하트(2026-11-03 «이 화면에서도 바로 하트 · 하트 받은 순 · 50위까지»)
-- 하루 상한(IP 해시 — 원문 0) · 하트 순 목록은 건 작품만 담는 부분 색인으로(표 전체 훑기 0)
CREATE TABLE IF NOT EXISTS showcase_like_caps (day INTEGER NOT NULL, iph TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, iph));
CREATE INDEX IF NOT EXISTS artworks_showcase_rank_idx ON artworks(like_count DESC, showcase_at DESC) WHERE showcase_at IS NOT NULL;
