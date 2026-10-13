-- 2026-10-13 무료 읽기 한도(DO/D1 하루 500만 행) 대응.
-- (check-db-reads.mjs FAIL)
-- 1) collab_rooms 는 class_id·host_teacher_id 에 색인이 없어, classes/teachers 삭제 시
--    FK CASCADE(ON DELETE CASCADE) 검사가 collab_rooms 를 매번 전체 훑었다
--    (worker/index.ts 의 교사 탈퇴 DELETE FROM classes/teachers WHERE ... 자리).
CREATE INDEX IF NOT EXISTS collab_rooms_class_idx ON collab_rooms(class_id);
CREATE INDEX IF NOT EXISTS collab_rooms_host_idx ON collab_rooms(host_teacher_id);
-- 2) 배포된 도안 조회(/api/classes/:id/assignment · /api/student/assignment)가
--    class_id+is_active 로 찾은 뒤 created_at 으로 정렬 — 기존 assignments_class_idx(class_id, is_active)
--    는 정렬열이 없어 매 호출마다 정렬용 TEMP B-TREE 로 그 학급의 행을 전부 읽었다.
CREATE INDEX IF NOT EXISTS assignments_class_active_created_idx ON assignments(class_id, is_active, created_at);
