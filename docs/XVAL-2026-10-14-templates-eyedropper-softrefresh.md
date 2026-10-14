# 교차검증 기록 — 도안 정리·스포이트·안전 새로고침·교사 갤러리 (2026-10-14)

- 깊이: FULL(verify-router: 작업트리 5430줄 — 대부분 manifest·도안 데이터) · Tier-0 `preflight-gate.sh` 통과 · 타입·단위 170개 통과
- 레인: codex(GPT) · gemini(agy) · grok(xAI) · meta(Llama, 보조) + Claude 렌즈 = 메인 직접
- `full-lanes.sh check codex gemini claude grok meta` → **✅ FULL 성립 (frontier 4/4 · 권고 1/1 → 총 5계열)**
- 번들 4개(그록 크기 상한 때문에 나눔): a1 스포이트(eyedropper.ts + ArtEngine) · a2 안전 새로고침(soft-refresh.ts + AutoSave + Editor) · a3 교사 갤러리 + gen-masters · b 도안 큐레이션 스크립트

## 채택(고침)

| 출처 | 발견 | 처리 |
|---|---|---|
| codex | 위·아래 레이어 칠이 창 안에서 안 겹치면 평균 덮임끼리 곱해 덜 보이는 레이어를 고름 | `visiblePaint` — 픽셀마다 투과 몫을 곱해 비교 · 단위 시험(변이 시 빨강 확인) |
| codex · grok | 채우기가 획 위를 덮었는데 옛 획 색을 돌려줌(채우기 판정 코드가 continue 에 막혀 죽은 코드) | 채우기는 지금 물감 색과 같으면 그 색, 다르면 더 옛 기록으로 · 단위 시험 2개 |
| gemini | 빠른 획은 기록 점 사이가 굵기보다 멀어 점 사이를 찍으면 획을 못 찾음 | 점이 아니라 선분 거리 · 단위 시험 |
| codex · gemini · 메인 | 갤러리 열고 [뒤로] 닫기를 반복하면 대시보드 기록이 쌓여 뒤로 가기를 여러 번 | 이 화면에서 연 갤러리는 `history.back()` 으로 닫음 · e2e(되돌리면 기록 6>5 빨강 확인) |
| codex · grok | 저장하는 사이 다른 화면으로 가면 그 화면을 새로고침함 | 취소 표시 + 주소 동일 확인 뒤에만 표식·새로고침 |
| grok | 저장 중 예외가 나면 덮개가 안 풀려 화면이 멈춤 | try/finally 로 덮개·상태 되돌림 |
| grok | 새로고침 뒤 복원이 실패하면 배너도 그림도 없음 | 실패하면 [이어 그리기] 배너를 되살림 |
| codex | 두 손가락 중 하나만 떼도 «안 누름»이 됨 | 포인터 id 마다 추적 + 창을 떠나면 비움 |
| grok | 미술관 데이터 파일이 깨지면 명화 목록 갱신까지 멈춤 | 파싱 실패는 미술관 작품만 work 캐시로, 목록 갱신은 계속 |
| codex · grok | 부분색칠·새 도안은 깨진 파일 검사를 안 거침 / remove 가 pc_* 에 안 먹음 | 디코드 검사·remove 적용 |
| 메인(자체) | 새 도안에 들어와 [이어 그리기] 배너가 떠 있을 때 새로고침하면 이전 그림 저장본을 덮어씀 | 배너가 떠 있으면 금지 · e2e |
| 메인(자체) | 배너 닫기(dismissRestore)가 저장본을 지워 복원보다 먼저 지워짐 → 빈 캔버스 | 상태만 접고 저장본은 유지 · e2e(수정 전 빨강) |

## 기각(오탐)

| 출처 | 주장 | 기각 근거 |
|---|---|---|
| gemini | `busy` 가 `this.brush !== null` 이라 항상 바쁨 | `this.brush` 는 획 동안만 존재 — e2e 에서 획 뒤 실제로 새로고침됨 |
| gemini · grok | `saveNow` 가 `saveAndWait` 를 안 부름 / 엔진에 `restore()` 없음 | 다른 번들(a1)에 있는 코드 — `ArtEngine.saveNow → autosave.saveAndWait`, `ArtEngine.restore()` 존재·e2e 통과 |
| meta(보조 단독) | `pending` 에 함수를 넣어 IDB 저장 실패 | `pending` 은 원래 스냅샷 «팩토리» — flush 가 호출해 저장. e2e 저장·복원 통과 |
| gemini | 로딩 중 `?gallery` 가 지워짐 | `loading` 초기값이 true — 새로고침 e2e 통과 |
| gemini | 픽 캔버스 잔여물 | 쓴 영역만 읽는다 |
| gemini | 큐레이션이 pc_* 수동 항목을 덮어씀 | pc_* 는 큐레이션 소유(설계) |
| grok | 원본을 덮어쓴 뒤 옛 썸네일이 남음 | 썸네일 생성기가 mtime 으로 다시 굽는다 |
| meta(보조 단독) | 복구 때 썸네일 삭제가 불변식 위반 | 복구된 그림의 낡은 썸네일 삭제는 의도 |

## 결론

8way 반영 완료 — 채택 12건 수정·시험 추가(변이·옛 배포본으로 빨강 확인), 기각 8건 근거 기록. 수정 후 재검증 = LITE(게이트 + 메인 + 단위·e2e 재실행), 신규 CRITICAL 없음.
