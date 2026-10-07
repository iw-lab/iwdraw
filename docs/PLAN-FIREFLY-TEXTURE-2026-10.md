# 아트온 × Firefly — 재질(캔버스·종이·붓) 강화 계획서 (r3 — 실행 결과 반영, 2026-10-07)

> r1 → r2: 8way(FULL) 검수 반영 — GPT(웹)·Gemini(agy)·Grok(웹)·Claude(메인)·Meta(보조) 5계열 응답, `full-lanes.sh check` FULL 성립.
> 채택 19 · 기각 5 (표는 §8).

## ★ 실행 결과(r3) — 사용자 「니가 판단해서 더 좋은 방향으로 모두 순서대로」
롤백 지점 = git 태그 `pre-texture-pack-2026-10-07`(원격 푸시) · 즉시 끄기 = `NEXT_PUBLIC_TEXTURE_PACK=0` 또는 `?paper=proc`.

| Phase | 결정 | 근거(실측) |
|---|---|---|
| P0 소스 비교 | **캔버스천 = Firefly(평직), 도화지 = CC0 ambientCG Paper001(실측 높이맵)**, 화선지·수채지 = 프로시저럴 유지 | CC0 캔버스 Fabric036 = 능직(사선 「~」 무늬, 시각 확인)·Fabric039 = 결이 너무 잘아 게이트 FAIL(무게중심 0.255 vs 0.117). Firefly 도화지 = 조명 줄무늬(사진 명도 ≠ 높이). Firefly 평직 캔버스는 CC0 에 없는 정답 |
| P1 종이 결 | 완료 — 순위 타일 + **런타임 히스토그램 매칭**(grainLo/Hi·브러시 상수 무변경), 세션 고정(봉인), 시드 고정 폴백, 프리캐시(@serwist 기본) | 덮는 면적 g 평균 0.046 = 0.046(기준과 동일). 404/늦은 도착 = 프로시저럴과 픽셀 차 0.000 |
| P2 팁 실사화 | **보류** | 기존 AI 팁도 「헤어라인 명암은 축소 시 사라져 톤 밴드를 곱함」(tipLoader.ts) — 128px 팁이 수 px·8겹 dab 으로 평균화돼 세부가 소멸. 효과 대비 게이트 재튜닝 위험만 큼 |
| P3 C′ 음영 굽기 | 도화지 tint 에 실측 높이맵 경사 음영(좌상단 광원) 굽기. 캔버스천은 사진 자체 음영 사용 | 런타임 조명 0 → WebGL2/Canvas2D 동일 경로 |
| P4 새 매체 | 목탄·소프트 파스텔. **팔레트 나이프 제외** | 나이프 = 납작 문지르기 메커니즘 신설 필요(질감 개선과 별개, 위험 큼) |
| P5 종이 고르기 | 보류(제품 결정) | |

검수 지적 중 실행에서 뒤집힌 것: ① 「격자 반복 = 자기상관 주기 피크」는 **죽은 지표**(반복 타일은 항상 정확히 주기적 → 피크 = 1) → 패치 이질성으로 대체 ② 「이음매 = 경계/내부 평균 차분」은 줄무늬 재질에서 표본 1개 통계라 1.4~3.0 으로 튐 → 경계/내부 열쌍 최댓값 ③ 「획 질감 ±12%」는 획 위치 편차보다 좁음 → 등방 고역 std ±25%(실측 0.85배). 가로 차분 지표는 방향 편향(0.55배)이라 기각.

## 0. 현황 확인 (실측)
- **Firefly 배선(전역)**: `~/.claude/skills/yt-video-builder/engines/firefly_image.mjs`(모델표에 `Firefly Image 5`=`image5`·GPT Image 2·Nano Banana 등, 1:1, `--ref` 다중, 「무제한」 아니면 rc4로 안 누름), `~/.claude/bin/firefly-edit.mjs`(부분 편집). 엔진 크롬 CDP 9230.
- **아트온에는 Firefly 배선 0곳.** 이미지 재질 자산은 `public/brush-tips/bristle.png` 1장뿐(7월 codex).
- 팁 11종 중 10종 프로시저럴(`core/backend.ts makeTipCanvas`). 이미지 팁 오버라이드는 이미 배선됨(`tipLoader.ts TIP_FILES` → `setTipOverride` + `tipEpoch`, 두 백엔드 모두 `getTipPixels` 경유 = 빈 텍셀 RGB 메움).
- 종이 4종 전부 프로시저럴(`core/paper.ts`, `Math.random` → 새로고침마다 결이 바뀜). `WebGL2Backend.paperTexture()` 는 **kind 별 1회 캐시·갱신 epoch 없음**.
- **종이 결이 실제로 먹히는 곳**(`paperGrain`): 크레용 0.5·오일파스텔 0.45·유화 0.38·색연필 0.35·붓펜 0.24 / 수채 **0.02**·사인펜 0.05. 수채 모드 표시 틴트는 cotton 이 아니라 smooth. ⇒ **체감 효과 = 도화지(smooth) > 캔버스천(linen) > 화선지(hanji) ≫ 수채지(cotton)**.
- 프로시저럴 결 입자 크기 = 1~3px(256 타일에 lattice 셀 96~190).
- 과거 함정: ① 저주파 = "얼룩"(지적 3회+) ② 256 반복 = 격자 ③ 팁 빈 텍셀 RGB=0 ④ 브러시 상수는 현 팁·현 결 분포(grainLo/Hi)에 튜닝됨 ⑤ SW 프리캐시 137MB 이력 ⑥ 웨일북 저사양.
- **약관(원문 확인)**: Adobe Generative AI Product Specific Terms(2026-04-23) §3.1 — «must not remove or alter any watermarks or Content Authenticity Initiative metadata (e.g., Content Credentials)… or otherwise attempt to mislead others about the origin». 개인 Premium 은 §8 IP 면책 대상 아님.

## 1. 목표 / 비목표
- 목표: 아이들이 체감하는 "진짜 재료 느낌" — 도화지 위 크레용·색연필 결, 캔버스천 위 유화.
- 비목표: 브러시 물리 재작성, 내부 해상도 변경(1536 고정), **런타임 AI 호출(생성은 빌드 타임만)**, 런타임 노멀맵 조명.

## 2. 강화 항목 (우선순위 재조정)
| # | 항목 | 내용 | 비고 |
|---|---|---|---|
| A1 | **도화지(smooth) 실사 결** | grain(침식)·tint(표시) 별도 산출 | 가장 많이 쓰는 경로 |
| A2 | **캔버스천(linen)** | 위브 주파수 보존이 관건 | 유화 0.38 |
| A3 | 화선지(hanji) | 섬유 절제(과거 "낙서선") | |
| A4 | 수채지(cotton) | **보류** — paperGrain 0.02라 체감 거의 0 | |
| B | **팁 실사화** | 크레용(rough)·오일파스텔(chunk)·색연필(grain)·붓펜(ink)·수채(wet) | 기존 배선 재사용 |
| C′ | 캔버스 음영 **베이크** | 런타임 노멀맵 폐기. 좌상단 고정광 음영을 오프라인에서 tint 에 1회 굽기. 높이는 사진 명도가 아니라 **프로시저럴 위브 높이장**에서 | Canvas2D 정합 유지 |
| D | 신규 매체 3종 | 목탄·소프트 파스텔·팔레트 나이프 | `BRUSH_META` 한 줄 → brush-matrix 자동 편입 |
| E | 종이 고르기 | 모드 강제 해제 | 제품 결정 |

## 3. 공통 파이프라인 (`scripts/gen-textures.mjs` → `scripts/process-texture.mjs`)
1. **소스 3종 비교(P0에서 결정)**: ⓐ Firefly(`--model "Firefly Image 5" --aspect 1:1`, 재질당 4변형) ⓑ CC0 실물 스캔(ambientCG 등, 라이선스 원문 확인 후) ⓒ 개선 프로시저럴. 블라인드 나란히 렌더 → 사용자 판정. Firefly 가 이기지 못하면 A 는 ⓑ/ⓒ로 간다.
2. **가공(결정론, sharp)**: 그레이 → 크롭 → **목표 해상도로 먼저 다운샘플**(결 입자 1~3px 에 맞춘 배율) → 고역통과(타일 해상도 기준 σ, 얼룩 게이트와 **같은 차단 대역**) → **그 다음 심리스화**(반 타일 오프셋 + 경계 크로스페이드, wrap 샘플링) → grain/tint **별도 정규화** → WebP.
   - grain: 침식 램프(grainLo~grainHi) 안에 들어오는 픽셀 비율을 현행과 맞춘다(평균 0.5 고정이 아니라 램프 점유율 매칭). 맞추기 전엔 기본 경로 금지.
   - tint: 표시 대비만. C′ 음영은 여기에만.
   - 팁: 검은 배경 원본 → 기존 `toAlphaMap`(luminance→alpha) → `getTipPixels` 메움. 정규화 지표 = 평균 알파·커버리지·방사 프로파일·중심점(평균만 맞추면 폭·농도가 바뀐다).
3. **게이트** `scripts/gate-textures.mjs`(`pnpm gate:textures`, test 체인·pre-push). **납품 최종 WebP 를 디코드해서** 잰다:
   - 이음매: 2×2 반복 경계 차분(절대 상한)
   - **격자 반복**: 4×4 반복 영상의 자기상관 — 타일 주기 피크/0-lag 비 ≤ 상한
   - **얼룩(절대)**: cycles/tile ≤ 4 대역 에너지 비율 ≤ 절대 상한 + 64px 패치별 국소 평균 편차 최대치. 상한은 **과거 얼룩 표본(네거티브 케이스)이 반드시 FAIL** 하도록 정한다 — 현 프로시저럴 값은 참고치일 뿐
   - grain 램프 점유율 ±10%, std ±10%
   - 팁: 알파 0 텍셀 비율·커버리지·방사 프로파일 / 순흑 여백 팁으로 그은 획 평균색이 입력색 하한 이상(픽셀 단언)
   - 용량: 개당 ≤ 48KB · 합계 ≤ 640KB(최대 13장 기준 식이 성립하게)
   - 출처 원장 `assets-src/textures/PROVENANCE.json`: 소스 원본 sha256 + **납품 파일 sha256** 2단 · 모델·프롬프트·날짜·라이선스 — 불일치/누락 FAIL
   - **Content Credentials**: Firefly 소스면 원본(자격증명 포함) 보관 + 납품 WebP 에 c2patool 로 파생 매니페스트(ingredient=원본) 부착 → `c2patool` 검증 FAIL 시 차단. CC0·프로시저럴이면 해당 없음
   - **고의 파손 시험**: 이음매 타일·반복 타일·얼룩 표본·해시 변조·자격증명 제거 각각 FAIL 확인
4. **런타임 배선**
   - `setPaperOverride(kind, {grain, tint})` + `paperEpoch` → `WebGL2Backend.paperTexture()` 캐시 키에 epoch 포함(지금은 갱신 불가).
   - **세션 중 교체 금지**: 결은 획에 구워진다 → 엔진 시작 전에 await(타임아웃 1.5s), 실패하면 **그 세션 내내** 프로시저럴. 그림 도중 스왑 0.
   - 텍스처 팩은 **SW 프리캐시에 포함**(≤640KB, 리비전 키) — 오프라인 첫 실행에서도 같은 결, 롤백은 리비전 교체로(CacheFirst 잔존 문제 회피).
   - 폴백 프로시저럴도 **시드 고정 난수**로 바꿔 결정론 확보(무비 재생·협동 결 일치).
   - 내보내기: tint 는 지금처럼 화면 전용(제품 결정 시 변경). 완료 조건은 화면 합성 기준으로 한정.

## 4. 검증 (완료 증거)
- 기존 e2e 전부 유지: watercolor-mottle·oil-color-consistency·oil-liftoff-pop·oil-wetmix·crayon-color·marker-overlap·thin-brush-identity·min-size-smooth·brush-matrix·backend-parity·export-paper·stroke-frame-cost·long-session-perf.
- 신규 `paper-texture.spec.ts`: 오버라이드 로드 · 404 주입 폴백 · 로드 지연 주입 시 세션 내 결 불변 · 획 내부 명도 std 가 기준 획 대비 **±12%**(수치 고정).
- 신규 `texture-parity.spec.ts`: 같은 획·같은 텍스처를 WebGL2/Canvas2D 로 렌더해 획 통계 오차 상한.
- 성능(절대 상한, 웨일북 프로파일 — CPU 4× 스로틀 + 실기 1회): 획 중 프레임 p95 ≤ 기존 실측값, 텍스처 디코드+업로드 ≤ 80ms, 추가 GPU 메모리 ≤ 4MB. 512 타일이 넘으면 256 으로 강등.
- 시각: 기존 vs 신규 나란히 → 사용자 판정. 수치 통과만으로 완료 선언 안 함.
- 배포본: `playwright.live.config.ts` 재실행.

## 5. Phase
- **P0 (0.5~1일)** Firefly 로그인·무제한·`Firefly Image 5` 1:1 해상도 실측 → smooth·linen 각 4장 + CC0 스캔 + 개선 프로시저럴 **3자 블라인드 비교** → 진행/중단·소스 결정은 사용자. c2patool 로 WebP 파생 매니페스트 시험.
- **P1 (1.5일)** 파이프라인·게이트(파손 시험 포함)·`setPaperOverride`+epoch·세션 고정 로드·프리캐시·시드 폴백 → A1·A2.
- **P2 (1일)** B 팁 5종, 브러시별 A/B.
- **P3 (0.5일)** A3 화선지 + C′ 음영 베이크(실패 시 기각 기록).
- **P4 (1일)** D 신규 매체 3종.
- **P5** E 종이 고르기 — 사용자 결정 후.

## 6. 위험·롤백
- 플래그 `NEXT_PUBLIC_TEXTURE_PACK=0` = 즉시 프로시저럴. 팩 리비전 교체로 SW 캐시 폐기.
- Firefly rc4·rc6 은 폴백 엔진으로 덮지 않고 보고.
- 프롬프트에 실존 브랜드 종이명 금지.
- 앱 크레딧/정보 화면에 «일부 재질 이미지는 Adobe Firefly 로 생성» 고지(출처 오인 방지 — §3.1 취지).

## 7. 사용자 결정 필요
1. P0 3자 비교에서 Firefly 가 지면 CC0/프로시저럴로 가도 되는가?
2. C′(캔버스 음영 베이크)·D(신규 매체 3종) 포함 여부, D 후보 확정.
3. E 종이 고르기(모드 강제 해제) 여부 · 내보내기에 종이 결 포함 여부.

## 8. 검수 반영표
| 발견 | 계열 | 판정 |
|---|---|---|
| Content Credentials 제거 금지(§3.1) — WebP 재인코딩이 지운다 | GPT | **채택**(원문 확인) |
| 이음매 차분은 격자 반복을 못 잡음 | GPT·Grok·Meta·Gemini | 채택 → 자기상관 |
| 얼룩 상한을 현 프로시저럴(=얼룩 원인)에 고정 | GPT·Grok·Meta | 채택 → 절대 상한 + 네거티브 표본 |
| 사진 명도 ≠ 높이 / Canvas2D 런타임 조명 불가 | GPT·Grok·Meta·Gemini | 채택 → C′ 오프라인 베이크 |
| 고역통과·다운샘플 순서/대역 불일치, 다운샘플이 이음매 재개방 | Grok·Gemini·Meta | 채택 → 다운샘플→고역→심리스, 최종 파일로 게이트 |
| grain/tint 분리 + grainLo/Hi 재정합 | GPT·Grok | 채택 → 램프 점유율 매칭 |
| 세션 중 비동기 교체 = 결 혼재 / paperTexture 캐시 epoch 없음 | Gemini·Claude | 채택 → 시작 전 로드·epoch |
| 프리캐시 제외 = 오프라인 첫 실행 실패·롤백 불가 | GPT·Gemini·Claude | 채택 → 프리캐시+리비전 |
| 용량 식 불성립(13×60>600) | Grok | 채택 |
| ±범위·+10% 수치 없음/상대값 | Grok·GPT | 채택 → 절대 수치 |
| 백엔드 정합 테스트 부재 | GPT | 채택 |
| 팁 정규화가 평균만 | GPT | 채택 |
| P0 비교군 부재(CC0·프로시저럴) | GPT·Meta | 채택 |
| 원장 해시 기준 모호 | Meta | 채택 → 2단 해시 |
| 폴백 Math.random 비결정 | Meta | 채택 |
| 결 크기·수채지 저효과 우선순위 | Claude | 채택 |
| 「Firefly Image 5 없음」 | Meta | 기각 — 브릿지 모델표에 `image5` |
| 「grainTile 은 Float32Array 경로라 캔버스 교체 불가」 | Meta | 기각 — `paperGrainTile()` 이 캔버스 반환, texImage2D 업로드 |
| 「toAlphaMap 이 RGB 안 메워 RGB=0 재발」 | Meta | 기각 — 두 백엔드 모두 `getTipPixels` 경유 |
| 「여백 순흑 강제가 검은 테두리 재발」 | Gemini | 기각 — 순흑은 원본 이미지 규약, 텍셀 RGB 는 `getTipPixels` 가 메움(문구만 명확화) |
| 「600KB 가 137MB 처럼 TTI 지연·AVIF 로」 | Meta | 기각 — 규모 2자릿수 차이, 프리캐시 포함으로 정리 |

(문서 끝)
