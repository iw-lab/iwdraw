-- «이름·학교가 보여요» 신고(선행쌤 화면) — 이제 바로 내리지 않고 그림을 건 선생님께 알린다(2026-11-17 사용자
-- «신고를 하면 바로 내리지 말고 올리신 선생님에게 안내가 가도록»). 마지막 신고 때 · 신고 수. 선생님이 «괜찮아요»·내리기·다시 걸기를 하면 지운다.
ALTER TABLE artworks ADD COLUMN showcase_flag INTEGER;
ALTER TABLE artworks ADD COLUMN showcase_flags INTEGER NOT NULL DEFAULT 0;
