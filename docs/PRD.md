<!-- FINVERSE-DOC · AI 어시스트 작성 · 원본 소스(README · app/ · services/ · agents/ · collectors/)와 구분되는 산출물 -->
> 🟦 **FINVERSE 기획·설계 문서** — AI 어시스트 작성.
> 상태: **v0.7 (구현 기준 전면 재작성)** · 최종 갱신 2026-09-05

# FINVERSE PRD — Product Requirements Document

**v0.7** · 기준 구현: `app/page.tsx` · `components/paper-trading.tsx` · `services/paper_trading/` · `collectors/`
기준 커밋: `main` @ `47d82b5` (2026-09-05)

---

## 변경 이력

| 버전 | 변경 | 비고 |
| --- | --- | --- |
| **v0.7** | **구현 기준 전면 재작성** — 모의 투자를 탭1의 정식 구성요소로 편입 · 탭2를 "마이페이지"로 재정의 · 백엔드 구현분 반영 · 성공지표 절 삭제 | 본 문서 |
| v0.6 | 온톨로지 기준 재작성. 트리거를 사용자 질문으로, 정보 영역 4개, 파이프라인 6단계 | **대체됨** |
| v0.5 | 4층 아키텍처 · 섹터 9개 · 관계DB 73행 · 이벤트 카드 온디맨드+캐시 | 대체됨 (fork `planning-docs` 브랜치) |

> **v0.6에서 무엇이 바뀌었나**
> 1. **"백엔드 전부 미구현"이 더 이상 사실이 아니다.** 수집기 6종·PostgreSQL 5스키마·배치 8종·모의투자 엔진·투자 성향 분석기가 동작한다.
> 2. **모의 투자(Paper Trading)가 들어왔다.** v0.6에 없던 기능이고, 지금 제품에서 **가장 완성도가 높은 부분**이다. 시나리오를 *읽는* 것에서 시나리오 안에서 *판단해보는* 것으로 제품의 무게중심이 옮겨졌다.
> 3. **탭2가 "마이 금융 트윈" → "마이페이지"로 재정의된다.** 개인 신용정보·보유자산을 일체 취급하지 않는다.
> 4. **시나리오 엔진이 둘로 갈라졌다.** MiroFish 경로(사용자 질문형)와 자체 LLM 시뮬레이터 경로(모의투자)가 병존한다. → §13 오픈 이슈 1
> 5. 성공지표 절을 삭제했다.

---

## 1. 이 문서 사용법

| 읽는 사람 | 볼 곳 |
| --- | --- |
| 처음 보는 사람 | §2 제품 정의 · §4 아키텍처 |
| 프론트 | §5 탭1 화면 명세 · §6 탭2 · §8 데이터 계약 |
| 백엔드 | §4 아키텍처 · §8 데이터 계약 · §9 데이터 계층 · §11 비기능 |
| 데이터 수집 | §7 도메인 모델 · §9 수집·배치 |
| 운영 | `AGENTS.md`의 하네스 절 (실행·배포·장애 점검) |

**표기** — 【구현됨】 코드에 있는 것 · 【부분】 일부만 · 【설계】 문서만 · 【미확정】 결정 필요

---

## 2. 제품 정의

### 2.1 문제

금융소비자는 예측 가능한 비합리성(과신·손실회피·FOMO·현재편향·기준점 의존)으로 자신의 목표에 맞지 않는 결정을 반복한다. 기존 서비스(뉴스·증권앱·금융교육·모의투자)는 **정보는 주지만 판단을 훈련시키지 못한다.**

### 2.2 해결

**지금 시장 상황을 온톨로지로 구조화하고, 에이전트 시뮬레이션으로 조건부 미래 시나리오를 만들어, 그 시나리오 앞에서 사용자가 자기 판단을 시험하게 한다.**

파는 것은 **예측값이 아니라 조건**이다. "KOSPI가 7,500 간다"가 아니라 **"외국인 수급이 3거래일 이상 돌아오고, 실적이 컨센서스를 10% 이상 웃돌고, AI CapEx가 유지될 때에만"** 그 경로가 열린다고 말한다.

### 2.3 판단 훈련의 3단계

v0.7에서 제품은 세 겹으로 정리된다. 각 겹은 사용자의 개입 정도가 다르다.

```
[1] 읽는다    시장 대시보드 · 준비된 시나리오 3종 · 시나리오 상세(카드뉴스 + 풀리포트)
                  ↓  "내 조건은 다른데"
[2] 만든다    내 시나리오 빌더 — 질문 + 기간 → Evidence 수집 → 온톨로지/그래프 → MiroFish 시뮬
                  ↓  "그래서 나는 그때 어떻게 할 건데"
[3] 겪는다    모의 투자 — 실제 KOSPI 시세 위에서 비공개 이벤트를 만나며 매수·매도 결정
                  ↓
              투자 성향 진단 + AI 종합 리포트  →  탭2 마이페이지에 축적
```

**[3]이 v0.7의 핵심이다.** 시나리오를 읽기만 하면 편향은 드러나지 않는다. 사후에 결과를 아는 상태로 되돌아보면 후견지명 편향이 개입한다. 모의 투자는 **이벤트를 미리 알려주지 않은 채** 사전 판단(pre-event)과 사후 판단(post-event)을 따로 기록하기 때문에, 두 판단의 차이 자체가 편향의 관측값이 된다.

### 2.4 두 개의 탭

| 탭 | 코드상 키 | 역할 | 성격 |
| --- | --- | --- | --- |
| **시장 인사이트** | `market` | 오늘 시장 이해 → 시나리오 열람·생성 → 모의 투자 실행 | 탐색 · **상호작용** |
| **마이페이지** | `twin` | 내 금융 목표 + 시뮬레이션 결과·성향 진단 리포트 아카이브 | 축적 · 회고 |

> 코드의 사이드바에는 `시장 인사이트 / 마이 금융 트윈 / 모의 투자` 3개 항목이 있으나, **모의 투자는 독립 탭이 아니라 탭1의 모달**이다(`paperTradingOpen`). 사이드바 항목은 바로가기다. → 문서상 탭은 2개로 센다.

**두 탭을 잇는 객체는 "리포트"다.** v0.6에서는 시나리오가 두 탭을 이었으나, 탭2가 자산 시뮬레이션을 버리고 아카이브가 되면서 연결 객체가 바뀌었다.

---

## 3. 사용자

- **B2C(중심)**: 금융 초보 청년 · 사회초년생 투자자
- **후속**: B2B2C (증권사·은행의 금융교육 채널)

---

## 4. 시스템 아키텍처

### 4.1 서비스 구성 【구현됨】

```
브라우저
  └─ Next.js 앱 (:3000, app/)
       ├─ /api/dashboard        시장 연결 4영역 + OpenRouter 시장 요약
       ├─ /api/kospi            KOSPI 최신값 + 최근 거래일 캔들 (60초 폴링)
       ├─ /api/market-indices   코스닥·나스닥·S&P500 장중 지수
       ├─ /api/scenario-brief   시나리오 카드뉴스 에디토리얼 (OpenRouter)
       ├─ /api/ontology/run     ─┐
       ├─ /api/mirofish/start    ├→ MiroFish 로컬 게이트웨이 (:5440)
       ├─ /api/mirofish/runtime  │   scripts/mirofish_gateway.mjs
       ├─ /api/mirofish/chat    ─┘
       └─ /api/paper-trading/*  → 모의투자 Flask (:5055)
                                     services/paper_trading_api.py

  모든 DB 접근: FINVERSE_DATABASE_URL (서버 사이드 전용, Tailscale 사설망)

원격 수집 서버 (/home/ubuntu/finverse)
  ├─ collectors/*.py            → data/*.jsonl
  ├─ scripts/load_postgres.py   → PostgreSQL lake.records
  ├─ scripts/bedrock_signal_update.py → OpenRouter 시장 요약 → lake.records
  └─ scripts/sync_ontology.sh   → lake → core → graph 동기화
```

### 4.2 시나리오 엔진이 둘이다 ⚠️

| | **A. MiroFish 경로** | **B. 모의투자 경로** |
| --- | --- | --- |
| 트리거 | 사용자 질문 (내 시나리오 빌더) | 종목 선택 + 기간/유형 설정 |
| 위치 | `agents/mirofish_*.py` · `services/finverse_simulation_api.py` | `services/paper_trading/` |
| 엔진 | OASIS + Zep Cloud (AGPL-3.0), Neo4j, Ollama 임베딩 | 자체 LLM 시뮬레이터 (`llm_market_simulator` · `llm_scenario_simulator`) |
| 에이전트 | 프로필 4종 예시 · 소셜 플랫폼(Twitter/Reddit) 라운드 | 개인8 · 외국인4 · 기관4 · 연기금2 = **18 페르소나** |
| 산출 | 지식그래프 + 시뮬 런타임 + 채팅 | `ScenarioGame` + `Assessment` + `LlmReport` |
| 상태 | 【부분】 로컬 의존성(Neo4j·Ollama·MiroFish-Offline) 필요 | 【구현됨】 원격 DB만 있으면 동작 |
| 결정론 | 없음(시드 미고정) | 부분적 — 라운드 종가는 재계산 가능하게 설계 |

> 【미확정】 **두 엔진을 계속 병행할지가 v0.7 최대 결정 사항이다.** B가 A 없이도 완결된 학습 루프를 제공하고 배포 의존성도 훨씬 가볍다. A를 유지하면 AGPL §13·재현성·로컬 의존성 문제를 계속 안고 간다. → §13 오픈 이슈 1

### 4.3 내 시나리오 빌더 — 5단계 파이프라인 【구현됨 — UI / 【부분】 백엔드】

v0.6의 6단계에서 **01 Ontology Generation이 01 Data Collection으로 바뀌고, 온톨로지 생성과 GraphRAG 빌드가 02로 합쳐졌다.** 화면상 카드는 5장이다(`ScenarioBuildScreen`, 내부 `BuildStage`는 1~6).

| # | 단계 | 하는 일 | 산출 |
| --- | --- | --- | --- |
| 01 | **Data Collection** | 원격 DB + 웹에서 시장·경제·이벤트·커뮤니티 4영역 근거 수집 | Evidence 문서 4종 (`market-evidence.md` · `economic-evidence.md` · `external-event-evidence.md` · `psychology-evidence.md`) |
| 02 | **Ontology & GraphRAG Build** | Evidence에서 엔터티·관계 타입을 생성하고 Neo4j에 실시간 적재 | `ontology.json` · `graph.json` · 노드/엣지 수 |
| 03 | **Generate Agent Profiles** | 엔터티를 역할별 에이전트로 변환 (관점·활동량·편향) | 에이전트 프로필 |
| 04 | **Generate Config** | 라운드 수 · 활동 시간대 가중치 · 모델 설정 계산 | `simulation_config.json` |
| 05 | **Initial Activation Orchestration** | 첫 행동 · 내러티브 방향 · 핫토픽 고정 | `initial-activation.json` |
| — | **Start Simulation** | `agents/mirofish_start.py` 실행 → 런타임 폴링 → 완료 후 채팅 | `SimulationRuntime` |

- 각 단계는 `WAITING / IN PROGRESS / COMPLETED` 상태를 표시한다.
- **엔터티·관계 타입은 하드코딩하지 않는다.** 파이프라인이 이번 세션의 Evidence에서 생성한 스키마가 올 때까지 빈 칸으로 둔다(`ontologySchema?.entityTypes ?? []`).
- 지식그래프 프리뷰는 드래그·줌·팬이 되는 인터랙티브 캔버스다. 파이프라인 결과가 오기 전에는 데모 그래프(29노드·52엣지)를 보여준다.
- 실행은 `POST /api/ontology/run`이 NDJSON 스트림으로 로그를 흘리고, 프론트가 그 로그를 사용자 문장으로 번역해 표시한다(`importantLog`).

**활동 시간대 가중치** 【구현됨 — 표시값】

| 시간대 | 배수 |
| --- | --- |
| Peak 19:00–22:00 | ×1.5 |
| Work 09:00–18:00 | ×0.7 |
| Morning 06:00–08:00 | ×0.4 |
| Off-Peak 00:00–05:00 | ×0.05 |

**빌더 입력** — v0.6의 환경 시드 8종·파일 업로드는 **화면에서 빠졌다.** 현재 입력은 **질문 텍스트 + 예측 기간(7일/30일/3개월)** 둘뿐이다. `environmentSeeds` 배열은 코드에 남아 있으나 렌더되지 않는다(dead code). 기간별 라운드는 7일=168 / 30일=720 / 3개월=2160.

---

## 5. 탭 1 — 시장 인사이트 【구현됨】

### 5.1 시장 대시보드

| 블록 | 내용 | 데이터 |
| --- | --- | --- |
| **시장 연결** | 경제·국가·이벤트·커뮤니티 4영역. 영역마다 상위 토픽 2개 + 중요도 ★1~3 + 근거 개수. 클릭 시 상세 모달(키워드·영향 요약·출처 링크) | `GET /api/dashboard` → `lake.records`. 미연결 시 더미 4종 폴백 |
| **KOSPI 차트** | 실제 캔들 + 선택 시나리오의 조건부 예측 경로를 겹쳐 그림. 화면 58% 지점이 현재/미래 분기선 | `GET /api/kospi` (60초 폴링) + `Scenario.path` |
| **보조 지수** | 코스닥 · S&P 500 · 나스닥 스파크라인 | `GET /api/market-indices` |
| **AI 요약** | 장마감 후 배치가 만든 시장 요약. 클릭하면 전문 펼침 | `record_type='market_signal_analysis'`, `source='openrouter'`. 없으면 "요약을 불러오고 있습니다" |
| **발생 가능 이벤트** | 선택 시나리오의 이벤트 타임라인 — 주차 · 카테고리 · 제목 · 설명 · 예상 영향 | `Scenario.events` |

### 5.2 시나리오 라이브러리

**시나리오 3종 고정** 【구현됨 — 하드코딩】

| id | 제목 | 기간 | tone | forecast | 태그 |
| --- | --- | --- | --- | --- | --- |
| `kospi-rebound` | KOSPI 조건부 반등 | 1개월 | up | KOSPI +24.5% | 외국인 순매수 · AI CapEx |
| `chip-miss` | 반도체 실적 미스·AI CapEx 둔화 | 1개월 | down | KOSPI -13.8% | SK하이닉스 실적 하회 · AI 투자 재평가 |
| `risk-off` | 외국인 매도·원화 약세 재확산 | 1개월 | down | KOSPI -8.7% | 외국인 순매도 · 원·달러·금리 |

구성 규칙은 **상승 1 + 하락 2**다. 카드 옆에 `내 시나리오 예측하기`(빌더 진입)와 `모의 투자로 연습하기`(모달 진입)가 나란히 붙는다.

> 【미확정】 시나리오 3종이 **KOSPI 지수 단위**로만 존재한다. 모의 투자는 **개별 종목 단위**로 돈다. 두 단위가 어긋나 있고, 종목별 시나리오는 아직 없다. → §13 오픈 이슈 3

### 5.3 시나리오 상세 (모달)

**2층 구조**다.

1. **카드뉴스 5장** — `POST /api/scenario-brief`가 OpenRouter로 매번 편집한다. 1장 핵심 결론 / 2~4장 시간 순 핵심 조건 / **5장 반증 신호**. 모델이 그날 시장 톤에 맞춰 `theme`(sunny·forest·cobalt·berry)과 `rhythm`(calm·bold·playful), 카드별 `layout`·`visual`까지 고른다. 문구 상한: title 28자 · body 85자 · 해설 문단 180자.
2. **풀 리포트** — 하드코딩된 `Scenario`를 그대로 읽는다.
   시나리오를 읽는 순서(4장 내러티브 + 장별 학습 포인트) → 학습 아티클 → **개인 투자자의 선택지**(investorGuide) + **다음에 공부할 질문**(studyGuide) → **인지 편향 체크**(biasChecks 3종) → 멀티 에이전트 해석 3인 → 핵심 리스크

**에디토리얼 실패 시 폴백** — `fallbackEditorial()`이 시나리오 자체 데이터로 같은 5장을 조립한다. **빈 화면을 만들지 않는다.**

**멀티 에이전트 해석 3인** 【구현됨 — 시나리오별 고정 텍스트】 — `뉴스 수집가` · `애널리스트` · `퀀트 트레이더`.
**편향 목록** 【구현됨】 — `FOMO` · `확증 편향` · `기준점 편향` · `손실 회피` · `평균단가 집착` · `낙관적 과신` · `처분 효과` · `군집 행동` · `통제 착각` 중 시나리오마다 3종.

> 【미확정】 24명(또는 18명) 에이전트가 어떤 규칙으로 3인 해석에 집계되는지는 여전히 정의되지 않았다. 지금은 사람이 쓴 고정 텍스트다. → §13 오픈 이슈 4

### 5.4 모의 투자 (모달) 【구현됨】 ★ v0.7 신규

실제 KOSPI 시세 위에서, **아직 공개되지 않은 이벤트**를 만나며 매수·매도를 결정한다.

#### 설정 흐름 — 4단계 순차 공개

```
① 종목 선택  →  ② 자료 수집  →  ③ 투자 상태  →  ④ 시뮬레이션 설정  →  시작
```

- 첫 화면에는 **① 종목 선택만** 보인다. 완료되면 ②가, ②가 끝나면 ③이 자동으로 열린다. 각 단계가 열릴 때 해당 섹션을 모달 중앙으로 부드럽게 스크롤한다.
- **① 종목 선택** — `GET /securities` 검색. 추천 종목은 삼성전자·SK하이닉스. 선택하면 `GET /securities/:ticker/candles`로 **최근 36거래일 실제 OHLC**를 미리보기로 그린다. **이 미리보기에는 시뮬레이션·미래 가격을 섞지 않는다.**
- **② 자료 수집** — `GET /securities/:ticker/scenario-context`로 시장·경제·사건·커뮤니티 4도메인의 건수와 최신 시점을 확인한다. **OpenRouter·온톨로지·MiroFish를 실행하지 않는다.** 캐시로 즉시 준비돼도 **최소 1.5초는 유지**해 사용자가 무슨 일이 일어났는지 읽을 시간을 준다.
- **③ 투자 상태** — `신규 투자`는 투자 가능 금액을, `기존 보유`는 평단·수량만 받고 추가 현금 0원으로 시작한다. **`투자 상태 설정 완료`를 명시적으로 눌러야** ④와 시작 버튼이 열린다. 이후 조건을 수정하면 다시 확정해야 한다.
- **④ 시뮬레이션 설정** — 사용자가 고르는 것은 **기간 2개 축**뿐이다.

| 기간 | 이벤트 수 | 근거 수집 창 |
| --- | --- | --- |
| 10거래일 | 2개 | 40일 |
| 20거래일 | 3개 | 60일 |
| 60거래일 | 5개 | 75일 |

| 연습 유형 | 이벤트 선별 |
| --- | --- |
| `balanced` 균형 | 전체 후보에서 |
| `stress` 위기 대응 | 하락 방향(−5% 초과) 우선 |
| `opportunity` 기회 포착 | 상승 방향(+5% 초과) 우선 |
| `random` 무작위 연습 | 무작위 |

> **이벤트 개수와 시장 참여자 수는 사용자 설정이 아니다.** 백엔드가 기간에서 도출한다. 사용자가 조절할 수 있는 것을 최소로 묶어 "설정 놀이"가 아니라 판단에 집중하게 만든 결정이다.

#### 시장 참여자 — 18 페르소나 【구현됨】

| 그룹 | 인원 | 심리 반감기 | 기본 위험회피 | 이벤트 반응 |
| --- | --- | --- | --- | --- |
| 개인 `retail` | 8 | 2.0일 | .45 | ×1.05 |
| 외국인 `foreign` | 4 | 5.0일 | .50 | ×1.0 |
| 기관 `institution` | 4 | 4.0일 | .48 | ×0.9 |
| 연기금 `pension` | 2 | 8.0일 | .62 | ×0.55 |

반감기가 그룹의 성격을 만든다. 개인은 이틀이면 감정이 반으로 식고, 연기금은 8일이 걸린다. 같은 뉴스에 개인이 먼저 몰리고 연기금이 마지막에 움직이는 이유가 여기서 나온다. 라운드마다 각 페르소나가 LLM으로 주문(BUY/SELL/HOLD)과 근거를 낸다.

#### 진행 국면

| phase | 사용자가 하는 일 |
| --- | --- |
| `inter_event_market` | 이벤트 없는 거래일. 시장이 자율 진행되는 것을 관찰 |
| `pre_event_decision` | **이벤트 내용은 비공개.** 선행 신호(`LeadSignal`)만 보고 매수·매도를 담는다. 담지 않으면 **관망으로 기록** |
| `post_event_decision` | 이벤트 공개 후 판단 |
| `completed` | 종료 → 성향 진단 + AI 리포트 |

**`pre_event_decision`이 이 기능의 핵심이다.** 정보가 불완전한 상태에서 내린 판단을 먼저 기록해두기 때문에, 공개 후의 판단과 비교할 수 있다. 그 차이가 §5.5의 편향 관측값이 된다.

#### 이벤트의 출처 【구현됨】

이벤트는 지어낸 것이 아니다. `ontology_scenario_events.py`가 실제 DB에서 뽑고, `OntologySource`에 출처를 남긴다 — `origin`(macro/micro) · `series_name` · `observed_change` · `headline` · `publisher` · `url` · `original_date` · `original_title`. **"실제로 있었던 일"이라는 근거를 화면에 남기기 위한 필드다.**

#### 그 외 실행 사양

- 사건 사이 거래일을 재배치해 선택한 전체 기간과 정확히 맞춘다(`_fit_scenario_duration`).
- 기존 보유로 시작하면 미실현 손익은 평단 기준으로 보이고, 수익률은 시작 시점의 현금+평가액(`initial_equity`) 기준 0%에서 출발한다.
- 라운드 진행은 비동기 잡(`ScenarioJobManager`) — `POST /scenarios/:id/actions` → `GET /scenario-jobs/:job_id` 폴링. 정상 라운드 하나가 수 분 걸린다. **8분을 넘기면 사용자에게 알린다**(백엔드 재시작 시 `running`으로 굳는 문제 때문).
- 수수료·세금·슬리피지: `settings.fee_rate` · `sell_tax_rate` · `slippage_bps`. 호가는 KRX 틱으로 맞춘다.
- **최근 6개 게임을 "이어하기" 목록으로 표시**한다(`GET /games?summary=1&limit=6`).

### 5.5 투자 성향 진단 【구현됨】

게임이 끝나면 `analyze_scenario_investor()`가 규칙 기반으로 성향을 판정하고, 그 위에 LLM 리포트를 얹는다.

**성향 유형 4종** — 거래 행동에서 도출한다.

| 유형 | 판정 조건 |
| --- | --- |
| `이벤트 고회전형` | 회전율 > 1.5 |
| `이벤트 추종형` | 사후 매수 횟수 > 사전 거래 횟수 |
| `사전 포지셔닝형` | 사전 거래 > 사후 거래 |
| `이벤트 반응 관찰형` | 그 외 (기본값) |

**지표 10종** — `completed_events` · `trade_count` · `pre_event_trades` · `post_event_trades` · `autonomous_market_days` · `max_abs_market_sentiment` · `turnover_ratio` · `total_return_pct` · `max_price_drawdown_pct` · `average_confidence`

**행동 관찰(findings) + 학습 포인트(lessons)** — 예: 이벤트 공개 후 추가 매수가 N회 있었다면 → *"공개 직후에는 사건의 사실과 이미 가격에 반영된 기대를 분리해 확인하세요."*

**AI 종합 리포트(`LlmReport`)** — 사용자가 명시적으로 [리포트 생성]을 눌러야 만든다.
`quantitative_summary` · `executive_summary` · `investor_profile` · `event_reviews[{event, market_reaction, user_decision, lesson}]` · `strengths` · `risk_patterns` · `action_plan`

**면책** — *"가상 시나리오에서의 행동을 바탕으로 한 교육용 분석이며 투자 권유가 아닙니다."*

> 이것이 v0.6 `biasChecks`의 실행판이다. v0.6의 편향 체크는 **읽는 것**이었고, 이것은 **사용자 자신의 행동에서 도출된 것**이다.

---

## 6. 탭 2 — 마이페이지 【부분 — 재정의 필요】

### 6.1 재정의

**개인 신용정보·보유종목·포트폴리오를 일체 취급하지 않는다.** v0.6의 "마이 금융 트윈"은 가상이라도 자산 구성을 다뤘다. v0.7의 마이페이지는 그 축을 버리고 **금융 목표 + 시뮬레이션 결과 아카이브**만 남긴다.

| 블록 | 내용 | 상태 |
| --- | --- | --- |
| **금융 목표** | 목표 이름 · 목표 금액 · 준비 기간 입력 → 요약 카드 | 【설계】 시안에 존재, `page.tsx` 미구현 |
| **종목별 리포트 아카이브** | 모의 투자를 돌려본 종목들의 결과 + 투자 성향 진단 리포트를 종목별로 모아보기 | 【설계】 |

### 6.2 현재 구현 상태 (제거 대상) 【구현됨 — 목데이터】

`TwinPage`에는 아직 v0.6 구조가 그대로 있다. **§6.1 재정의에 따라 아래 3개 블록은 제거한다.**

| 블록 | 내용 | 처리 |
| --- | --- | --- |
| 나의 자산 현황 | 총자산 128,450,000원 · 현금 비중 18.4% · 목표 달성률 62% · 순자산 추이 6개월 | **제거** — 신용정보 미취급 원칙 위반 |
| 포트폴리오 보유 현황 | 삼성전자·SK하이닉스·KODEX 200·USD 현금 4종 목데이터 | **제거** — 동일 |
| 금융 대가의 한마디 | 워런 버핏 · 하워드 막스 · **트럼프식 시장 관점** 3인 | **보류** — 마이페이지 재정의와 맞지 않음. 실존 정치인 실명 면책 이슈도 미해결. 되살린다면 탭1 시나리오 상세 쪽이 자연스럽다 |
| 시나리오별 내 자산 경로 | 시나리오 선택 → 가상 자산 경로 재계산 | **제거** — 보유자산 없이 성립하지 않음 |

### 6.3 리포트 아카이브 설계 【설계】

**저장 단위는 게임(실행)이다.** 종목당 1개가 아니라 실행마다 1개씩 쌓인다. `GET /games?summary=1`이 이미 `GameSummary`(game_id · ticker · name · phase · scenario_premise · current_event_index / total_events · market_days · total_return_pct · updated_at)를 반환하므로, 그 목록을 종목으로 그룹핑해 보여준다.

```
마이페이지
├─ 금융 목표 (이름 · 금액 · 기간)
└─ 종목별 리포트
   ├─ 삼성전자 (3건)
   │   ├─ 2026-09-05 · 20일 · 균형 · +4.2% · 이벤트 추종형
   │   ├─ 2026-08-28 · 10일 · 위기 대응 · −1.8% · 사전 포지셔닝형
   │   └─ …
   └─ SK하이닉스 (1건)
```

각 항목을 열면 §5.5의 성향 진단 + AI 리포트 전문을 본다.

### 6.4 미해결 — 아카이브가 성립하려면 【미확정】

| 문제 | 현재 상태 | 필요한 것 |
| --- | --- | --- |
| **소유자 구분이 없다** | 게임은 서버 파일(`var/paper_games`)에 저장되고 사용자 식별자가 없다. 모두가 같은 목록을 본다 | 로그인 + 게임에 소유자 부여 |
| **금융 목표가 어디에도 쓰이지 않는다** | 입력받아 되비출 뿐 | 성향 진단·리포트에 맥락으로 연결하거나, 아니면 넣지 않는다 |
| **사후 대조가 없다** | 시뮬 기간이 지난 뒤 실제 주가와 비교하는 기능이 없다 | 학습 효과의 상당 부분이 여기 있다. MVP 후속으로 |

→ §13 오픈 이슈 5·6·7

---

## 7. 도메인 모델

### 7.1 네 가지 정보 영역

| 영역 | 답하는 질문 | 담는 것 | 화면상 라벨 |
| --- | --- | --- | --- |
| **시장** | 실제로 무엇이 움직였나 | 지수·섹터·종목 · OHLCV · 외국인/기관 수급 · 변동률/변동성 | (차트) |
| **경제** | 어떤 환경에 놓였나 | 환율 · 기준금리 · 국채 · 물가 · 고용 · **예상값과 실제값의 차이** | 경제 / 국가 |
| **외부 사건** | 무슨 일이 원인이었나 | 뉴스 · 실적/전망 · CapEx · 정책/규제 · 무역분쟁 · 지정학 | 이벤트 |
| **사람들의 심리** | 사람들은 어떻게 반응하나 | 언급량 · 긍정/부정 · 공포/낙관 · FOMO · 군집행동 | 커뮤니티 |

```
외부 사건 → 경제        경제 → 시장          시장 → 사람들의 심리
외부 사건 → 시장        사람들의 심리 → 시장  과거 유사 사례 → 현재 상황 해석
```

**심리는 시장의 결과이자 원인이다** — 유일하게 양방향인 관계다.

### 7.2 온톨로지가 둘이다

#### A. 확정 온톨로지 — `market_ontology_v1.json` 【구현됨】

모의투자 엔진이 쓰는 **정적 스키마**다. v0.6이 오픈 이슈로 남겼던 "관계 타입의 의미 미정의"는 **여기서 해소됐다.** 다만 v0.6이 예고한 7종/6종이 아니라 **엔터티 20종 · 관계 19종**이고, 범위도 KOSPI 상장 보통주 / 거래일 단위 / paper_trading 모드로 좁다.

**엔터티 20종**
`Security` `Issuer` `Market` `Sector` `TradingSession` `PriceObservation` `Index` `IndexObservation` `InvestorFlow` `ForeignHolding` `MarketEvent` `SourceDocument` `SocialSignal` `MacroObservation` `InvestorGroup` `Persona` `Scenario` `Order` `Execution` `PortfolioState`

**관계 19종**
`ISSUED_BY` `LISTED_ON` `CLASSIFIED_IN` `SECURITY_OBSERVED_FOR` `ON_SESSION` `OBSERVED_FOR` `INDEX_ON_SESSION` `HAS_FLOW` `HAS_FOREIGN_HOLDING` `AFFECTS` `SUPPORTED_BY` `HAS_SOCIAL_SIGNAL` `HAS_MACRO_CONTEXT` `REPRESENTS` `CONTAINS_PERSONA` `PLACES` `TARGETS` `EXECUTED_AS` `UPDATES`

**규약** — 타임존 `Asia/Seoul` · 통화 `KRW` · 가격 단위 `KRW_per_share` · 수량 `shares`
**자산 지원** — 보통주/우선주/지수는 연결됨. 채권·선물·옵션·ETF/ETN은 `not_found_in_current_catalog`(필요 엔터티만 명시).

> v0.6의 `DRIVES` `IMPACTS` `TRACKS` `CORRELATES_WITH` `CONSTRAINS` `TRIGGERS` 6종은 **폐기됐다.** 이 관계들은 "무엇이 무엇을 움직이는가"라는 인과 주장을 담으려 했으나 방향·부호·강도를 실증할 근거가 없었다. v1 온톨로지는 인과를 주장하지 않고 **관측 사실의 구조**만 담는다. 인과 해석은 시뮬레이션과 LLM 쪽으로 옮겼다.

#### B. 런타임 생성 온톨로지 — MiroFish 경로 【부분】

내 시나리오 빌더는 **질문마다 새 온톨로지를 만든다.** 엔터티·관계 타입을 고정하지 않고 그 세션의 Evidence 문서에서 생성한다. 화면은 파이프라인이 스키마를 돌려주기 전까지 빈 칸을 유지한다.

### 7.3 히스토리컬 데이터 원칙

- 가격은 **일 단위 OHLCV**, 수집 기간 **최소 1년**(길수록 좋음).
- 큰 움직임(급등·급락·추세 전환) 시점의 뉴스·정책·경제 변화·수급·심리를 찾아 **원인을 분석**한다.
- 과거 이벤트의 **영향 방향·강도·지속기간**을 기록하고, 현재와 유사하면 시나리오 근거로 인용한다.
- ⚠️ **과거 결과를 미래의 정답으로 쓰지 않는다.** 현재 조건과의 차이를 반드시 함께 표시한다.

### 7.4 검색 원칙

```
사용자가 지정한 정보     → 반드시 검색
분석에 필요한 누락 정보  → LLM이 판단해 추가 검색
영향이 작거나 근거 부족  → 중립 처리
```

검색 결과는 **출처 · 수집 시각 · 관련 대상 · 영향 방향**과 함께 저장한다.

---

## 8. 데이터 계약

### 8.1 `Scenario` — 탭1 시나리오 라이브러리 【구현됨】

```ts
type Scenario = {
  id: string; title: string; duration: string; tags: string[];
  forecast: string;                    // "KOSPI +24.5%"
  tone: "up" | "down";                 // 빨강=상승 / 파랑=하락
  image: string;
  summary: string; thesis: string; context: string;
  chapters:      { title: string; body: string; evidence: string }[];   // 4장 내러티브
  investorGuide: { stance: string; action: string; rationale: string }[];
  studyGuide:    { topic: string; question: string }[];
  biasChecks:    { bias: string; trap: string; counter: string }[];     // 3종
  path: number[];                      // 예측 경로 (차트)
  events:        { week: string; category: string; title: string; body: string; impact: string }[];
  agentInsights: { role: string; title: string; body: string }[];       // 뉴스/애널리스트/퀀트
  riskPoints: string[];
};
```

### 8.2 `ScenarioEditorial` — 카드뉴스 【구현됨】

```ts
type ScenarioEditorial = {
  ui: { theme: "sunny"|"forest"|"cobalt"|"berry"; rhythm: "calm"|"bold"|"playful" };
  badge: string; headline: string; subhead: string;
  cards: Array<{                       // 정확히 5장
    kicker: string; title: string; body: string; stat: string; statLabel: string;
    layout: "hero"|"split"|"reverse"|"spotlight"|"stacked";
    visual: "market-path"|"capital-flow"|"earnings"|"calendar"|"risk-radar";
  }>;
  explanation: { title: string; lead: string; paragraphs: string[] };   // 정확히 2문단
};
```

### 8.3 `ScenarioGame` — 모의 투자 【구현됨】

```ts
type ScenarioGame = {
  game_id: string; ticker: string; name: string;
  phase: "inter_event_market"|"pre_event_decision"|"post_event_decision"|"completed";
  status: string;
  current_price: number; initial_reference_price: number; initial_equity?: number;
  current_event: ScenarioEvent | null; current_event_index: number; total_events: number;
  portfolio: { cash; quantity; average_price; market_value; equity;
               realized_pnl; unrealized_pnl; total_return_pct; mark_price };
  price_history: PricePoint[];         // step·label·phase·price·OHLCV
  history_candles?: HistoryCandle[];   // 실제 과거 캔들 (real 플래그)
  agent_rounds?: AgentRound[];         // 라운드별 페르소나 주문·심리·시장압력
  fills?: Fill[];                      // 체결 + rationale + confidence
  pending_orders: PendingOrder[];
  released_signals: LeadSignal[];      // 이벤트 공개 전 선행 신호
  revealed_events?: ScenarioEvent[];
  scenario_premise?: string;
  simulation_days?: 10|20|60;
  practice_mode?: "balanced"|"stress"|"opportunity"|"random";
  investment_mode?: "new"|"holding";
  event_provenance?: EventProvenance;  // 이벤트 후보 개수·수집 창
  market_psychology?: { aggregate_sentiment?: number };
  settings?: { fee_rate; sell_tax_rate; slippage_bps };
};
```

### 8.4 `Assessment` — 투자 성향 진단 【구현됨】

```ts
type Assessment = {
  style?: string;                      // 이벤트 반응 관찰형 | 고회전형 | 추종형 | 사전 포지셔닝형
  metrics?: Record<string, number|null>;   // 지표 10종 (§5.5)
  findings?: string[];                 // 관측된 행동
  lessons?: { topic: string; message: string }[];
  llm_report?: {
    quantitative_summary?; executive_summary?; investor_profile?;
    event_reviews?: { event; market_reaction; user_decision; lesson }[];
    strengths?: string[]; risk_patterns?: string[]; action_plan?: string[];
  } | null;
  disclaimer?: string;
};
```

### 8.5 엔드포인트

| 경로 | 메서드 | 하는 일 |
| --- | --- | --- |
| `/api/dashboard` | GET | 시장 연결 4영역 + AI 요약 |
| `/api/kospi` | GET | KOSPI 최신값 + 캔들 |
| `/api/market-indices` | GET | 코스닥·나스닥·S&P500 |
| `/api/scenario-brief` | POST | 카드뉴스 에디토리얼 (인메모리 캐시 1건) |
| `/api/ontology/run` | POST | Evidence 수집 + 파이프라인 (NDJSON 스트림) |
| `/api/mirofish/start` `/runtime` `/chat` | POST/GET | 시뮬 실행·폴링·질의 |
| `/api/paper-trading/securities` | GET | 종목 검색 |
| `/api/paper-trading/securities/:t/candles` | GET | 최근 36거래일 실제 OHLC |
| `/api/paper-trading/securities/:t/scenario-context` | GET | 4도메인 자료 준비 상태 |
| `/api/paper-trading/games` | GET | 게임 목록 (`?summary=1&limit=`) |
| `/api/paper-trading/games/:id` | GET | 게임 상태 |
| `/api/paper-trading/scenarios` | POST | 게임 생성 |
| `/api/paper-trading/scenarios/:id/orders` | POST | 주문 |
| `/api/paper-trading/scenarios/:id/actions` | POST | 라운드 진행 (비동기 잡) |
| `/api/paper-trading/scenarios/:id/assessment` | GET | 성향 진단 + AI 리포트 |
| `/api/paper-trading/scenario-jobs/:id` | GET | 잡 진행 폴링 |

원격 시뮬레이션 API(`services/finverse_simulation_api.py`)는 `POST /v1/scenario-jobs` · `GET /v1/scenario-jobs/:id` · `/graph` · `POST /:id/start` · `GET /:id/runtime` · `POST /:id/chat` — 토큰 인증.

---

## 9. 데이터 계층 【구현됨】

### 9.1 PostgreSQL 스키마

`lake`(수집 원본 + AI 분석 결과, 중심 저장소) · `market` · `events` · `economy` · `psychology`
핵심 테이블: `lake.records` · `lake.changes` · `lake.runs`

### 9.2 수집기 6종

| 수집기 | 영역 |
| --- | --- |
| `market_ingest.py` | 시장 — KRX Open API(공식) + 네이버(보조) |
| `economic_ingest.py` | 경제 — 금리·환율·물가·고용 |
| `macro_news_ingest.py` | 외부 사건 — 거시 뉴스 |
| `fincept_event_ingest.py` | 외부 사건 — 기업 이벤트 |
| `youtube_comment_ingest.py` | 심리 — 국내 주식 유튜브 채널 30개의 영상·댓글·답글. 영상별 상위 좋아요 댓글 보존, 기업 검색 기반 수집, 반도체 영상 필터, `community v2` 분류 |
| `saveticker_ingest.py` | 시장 보조 |

### 9.3 배치 (원격 cron · 서버 시간 UTC)

| 시각 (UTC / KST) | 작업 |
| --- | --- |
| 평일 10:00 / 19:00 | 시장 수집 → DB 적재 → **성공 시에만** OpenRouter 시장 요약 |
| 평일 00–06시 5분마다 | 국내 지수 동기화 |
| 평일 13–22시 10분마다 | 해외 지수 동기화 |
| 매일 20:30 / 05:30 | 경제·뉴스 수집 및 적재 |
| 토 18:00 / 일 03:00 | 네이버 소스 30일 룩백 보정 |
| 매일 22:00 / 07:00 | `sync_ontology.sh` — lake → core → graph |
| 매일 19:00 / 04:00 | 30일 지난 로그 삭제 |
| `@reboot` | Tailscale 대기 후 `finverse-db` 컨테이너 기동 |

### 9.4 LLM

전 구간 **OpenRouter**. 기본 `google/gemma-4-31b-it:free`, 429 시 `google/gemma-4-26b-a4b-it:free` → `dots-studio/dots-3-note-preview:free` → `poolside/laguna-s-2.1:free` 순 폴백. 프로바이더는 **처리량(throughput) 기준 고정** — 같은 모델도 프로바이더에 따라 처리량이 17배까지 갈린다.
`scripts/bedrock_signal_update.py`는 **과거 호환 파일명일 뿐 Bedrock을 쓰지 않는다.**

---

## 10. 안전 불변식

- **조건부로만 말한다** — 단일 수치 단정 금지. 시나리오는 항상 `조건 → 경로 → 반증 신호` 3종 세트를 갖는다.
- **밴드 표기** — 중심값과 함께 밴드를 제시한다.
- **반증 신호 필수** — 모든 시나리오는 "이 시나리오를 취소해야 하는 신호"를 명시한다. 카드뉴스 5장 중 **마지막 장이 반증 신호로 고정**되어 있다.
- **개인 신용정보·보유자산 일체 미취급** ★ v0.7 신규 — 실계좌 연동 없음, 보유종목·포트폴리오·총자산을 입력받지도 저장하지도 않는다. 모의 투자의 투자 금액·평단·수량은 **그 게임 안에서만 쓰이는 가상값**이다.
- **상품 추천 금지** · **대가 페르소나 면책 라벨 상시**.
- **커뮤니티는 사실이 아니라 심리 관측값** — 언급량과 시장 방향을 동일 취급하지 않는다.
- **모의 투자 미리보기에 미래 가격을 섞지 않는다** — 종목 선택 화면의 36거래일 캔들은 실제 데이터만.
- **이벤트에는 출처를 남긴다** — `OntologySource`로 실제 근거를 추적 가능하게.
- **면책 문구** — *"AI 분석 기반 참고 자료이며, 투자 판단의 최종 책임은 본인에게 있습니다."* · 성향 진단에는 *"가상 시나리오에서의 행동을 바탕으로 한 교육용 분석이며 투자 권유가 아닙니다."*
- **차트 색** — 빨강 = 상승 / 파랑 = 하락 (한국 시장 관례).
- **빈 화면 금지** — LLM 실패 시 폴백을 제공한다(`fallbackEditorial`, 더미 시그널, "요약을 불러오고 있습니다").
- **비밀값 비노출** — `FINVERSE_DATABASE_URL`·`OPENROUTER_API_KEY`는 서버 사이드 전용. 브라우저·로그·커밋·문서에 값 자체를 남기지 않는다.

---

## 11. 비기능 요구사항

### 11.1 비용 구조가 v0.6과 달라졌다

v0.6의 최대 리스크는 "질문마다 온톨로지를 새로 만들면 캐시 키가 없다"였다. v0.7에서는 경로별로 갈린다.

| | MiroFish 경로 | 모의투자 경로 |
| --- | --- | --- |
| 캐시 키 | **없음** — 질문 원문이 키 | **있음** — 종목 + 기간 + 연습유형 |
| 반복 비용 | 질문 1건 = 파이프라인 1회 전체 | `scenario-context` 캐시 재사용, 이벤트 후보 재사용 |
| LLM 호출 | 라운드 수 × 에이전트 (7일=168 / 30일=720 / 3개월=2160 라운드) | 라운드 × 18 페르소나. 라운드 1회 수 분 |

**모의투자가 종목 단위로 내려오면서 캐시가 성립한다.** 이것이 v0.6 최대 리스크의 실질적 완화책이었다. MiroFish 경로는 여전히 캐시가 없다.

**남은 완화 후보** 【미확정】

1. **레이어 분리 캐시** — 시장 전체 그래프를 매일 1회 미리 빌드하고, 질문별로는 서브그래프만 잘라 쓴다.
2. **정규화 캐시 키** — 프롬프트 원문 대신 정규화된 조건 + 기간을 키로.
3. **사전 생성 시나리오** — 하드코딩된 3종이 이미 그 역할을 한다.
4. **비동기 잡 큐** — 모의투자는 이미 적용됨(`ScenarioJobManager`). MiroFish 경로도 `/v1/scenario-jobs`로 잡 기반.

### 11.2 성능·비용 지침

- **프롬프트 캐싱** — 그래프 스냅샷·에이전트 프로필처럼 시뮬 내내 고정인 콘텐츠를 프리픽스 앞에 둔다. system에 시각·UUID·질문 id 금지(프리픽스 오염).
- ⚠️ 에이전트를 **동시에 한꺼번에 던지면 전원 캐시 미스**. 1개 먼저 보내고 첫 토큰 수신 후 팬아웃.
- **effort가 1차 비용 레버** — 모델 교체보다 먼저 시도.
- **Batch API** — 사전 생성 시나리오·히스토리컬 원인 분석 등 지연 무관 경로.
- **구조화 출력** — `Scenario`·`Assessment` 스키마를 json_schema로 강제. 문자열 파싱 금지.
- **결정론적 계산은 LLM 밖으로** — 포트폴리오 평가, 수수료·세금, 호가 틱 정렬은 코드로.
- **상한과 폴백** — 잡별 토큰 상한·타임아웃·재시도 상한. 잡이 8분을 넘기면 사용자에게 알린다.
- **무료 모델 한도** — OpenRouter 무료 티어의 일일 요청 한도 소진을 사용자 문구로 흡수한다.

### 11.3 엔진 제약 (MiroFish)

OASIS + Zep Cloud 기반, **AGPL-3.0**. 단일프로세스·무인증·비재현(난수 시드 없음)·토큰 폭식. 로컬 실행에 **Neo4j + Ollama 임베딩(`nomic-embed-text`)** 이 필요하다. [코드해부 리포트](./MiroFish-코드해부-리포트.html) 참조.

- **재현성 없음** — 같은 입력이 같은 시나리오를 만들지 않는다. 사용자에게 "같은 질문 = 같은 답"을 약속할 수 없다.
- **AGPL §13** — 사용자 요청이 트리거하는 네트워크 서비스는 §13 대상이 될 수 있다. 완화 설계는 생성기를 별도 프로세스로 두고 스냅샷 JSON 단방향 통신. 법률 판단은 별건.
- **배포 부담** — 원격 배포 시 Neo4j·Ollama·MiroFish-Offline 소스가 모두 필요하다. 모의투자 경로는 원격 DB만으로 동작한다.

---

## 12. 모듈 상태 & 로드맵

| 모듈 | 산출물 | 상태 |
| --- | --- | --- |
| 데이터 수집 (6종) | 4영역 원천 데이터 | 【구현됨】 배치 가동 중 |
| PostgreSQL 데이터 레이크 | `lake` 외 4스키마 | 【구현됨】 |
| 시장 대시보드 | 시장 연결 · 차트 · AI 요약 | 【구현됨】 |
| 시나리오 라이브러리 | `Scenario` 3종 | 【구현됨 — 하드코딩】 |
| 시나리오 상세 (카드뉴스) | `ScenarioEditorial` | 【구현됨】 |
| **모의 투자 엔진** | `ScenarioGame` | 【구현됨】 |
| **투자 성향 진단** | `Assessment` + `LlmReport` | 【구현됨】 |
| 확정 온톨로지 | `market_ontology_v1.json` | 【구현됨】 |
| 내 시나리오 빌더 | 5단계 파이프라인 | 【부분】 UI 완성, 로컬 의존성 필요 |
| MiroFish 시뮬 실행 | `SimulationRuntime` | 【부분】 |
| **마이페이지** | 목표 + 리포트 아카이브 | 【설계】 미구현 |
| 사용자 계정 | 로그인 · 소유자 구분 | 【설계】 미구현 |

**임계 경로** — 마이페이지가 성립하려면 **계정 → 게임 소유자 → 아카이브 화면** 순으로 필요하다. 지금 병목은 여기다.

| 단계 | 목표 |
| --- | --- |
| **1. 계정** | 로그인, 모의투자 게임에 소유자 부여 |
| **2. 마이페이지** | 금융 목표 입력 + 종목별 리포트 아카이브 화면 |
| **3. 정리** | 탭2의 자산·포트폴리오 목데이터 제거, 대가 3인 처리 결정 |
| **4. 엔진 정리** | MiroFish 경로 유지/폐기 결정 (§13-1) |
| **5. 후속** | 사후 대조 · 종목별 시나리오 · 다중 시장 |

**MVP In** — KOSPI 1시장 · 4영역 수집 · 시나리오 3종 · 카드뉴스 상세 · 모의 투자 · 성향 진단 · 마이페이지 아카이브 · 계정
**MVP Out** — 다중 시장 · 실계좌 · 대가와의 실시간 대화 · 파일 업로드 시드 · 사후 대조 · B2B2C

---

## 13. 오픈 이슈

| # | 이슈 | 왜 지금 필요한가 | 권장 |
| --- | --- | --- | --- |
| 1 | **시나리오 엔진 이원화** — MiroFish 경로와 모의투자 경로 병존 | 배포 의존성·AGPL·재현성 문제가 전부 A쪽에 몰려 있고, B가 이미 완결된 학습 루프를 제공 | A를 "고급 탐색" 기능으로 축소하거나 MVP에서 제외. 결정 전까지 A는 로컬 전용으로 표기 |
| 2 | **분석 단위 불일치** — 시나리오 3종은 KOSPI 지수, 모의투자는 개별 종목 | 사용자가 시나리오를 보고 모의투자로 넘어갈 때 대상이 바뀜 | 종목별 시나리오 생성 또는 "지수 시나리오 → 종목 민감도" 매핑 정의 |
| 3 | **시나리오 3종이 하드코딩** | 매일 갱신되는 시장과 정적 시나리오가 어긋남 | 배치로 일 1회 재생성. `scenario-brief`가 이미 매일 편집하므로 그 아래 데이터도 같이 |
| 4 | **에이전트 → 3인 해석 집계 규칙 없음** | 18 페르소나의 결과가 시나리오 상세의 3인 해석과 연결되지 않음 (지금은 사람이 쓴 고정 텍스트) | 그룹별 집계 후 역할 매핑, 또는 3인 해석을 폐기하고 페르소나 그룹 상태를 직접 노출 |
| 5 | **사용자 계정·소유자 구분 없음** | 마이페이지 아카이브가 성립하지 않음. 모든 사용자가 같은 게임 목록을 봄 | MVP 필수. 로그인 + `game.owner_id` |
| 6 | **금융 목표가 아무 데도 쓰이지 않음** | 입력만 받고 되비출 뿐 | 성향 진단·리포트의 맥락으로 연결하거나, 연결하지 않을 거면 화면에서 뺀다 |
| 7 | **사후 대조 없음** | 시뮬 기간이 지난 뒤 실제 결과와 비교하는 기능이 없어 학습 루프가 닫히지 않음 | MVP 후속. `GameSummary`에 실제 종가 대조 필드 추가 |
| 8 | **대가 3인 처리** — 버핏·막스·**트럼프식 시장 관점** | 마이페이지 재정의와 맞지 않고, 실존 정치인 실명 면책 수위 미해결 | 탭2에서 제거. 되살린다면 탭1 시나리오 상세로 옮기고 익명 렌즈로 전환 검토 |
| 9 | **AGPL 의무 범위** | 엔진 선택이 굳기 전에 | 이슈 1의 결정에 종속. A를 유지하면 프로세스 분리 + 법률 1회 확인 |
| 10 | **MiroFish 재현성** — 시드 고정 가능 여부 | 같은 질문에 다른 답 | 이슈 1의 결정에 종속 |
| 11 | **히스토리컬 유사 사례 매칭 규칙** | §7.3의 "유사하면 근거로 인용"의 판정 기준이 없음 | 유사도 정의 + 차이 표시 의무화 |
| 12 | **`environmentSeeds` dead code** | 환경 시드 8종이 코드에 있으나 렌더되지 않음 | 빌더에 되살릴지 삭제할지 결정 |

---

## 부록 A. 용어집

- **온톨로지** — 엔터티 타입 + 관계 타입의 집합. 확정본(`market_ontology_v1.json`)과 런타임 생성본 두 가지가 있다
- **그래프 / GraphRAG** — 온톨로지를 실제 데이터로 채운 것
- **Evidence 문서** — 빌더 01단계가 4영역별로 만드는 근거 마크다운
- **에이전트 프로필 / 페르소나** — 시뮬 참여자. MiroFish는 엔터티에서 파생, 모의투자는 투자자 그룹 4종에서 18명 생성
- **Scenario** — 탭1 시나리오 라이브러리의 객체 (§8.1)
- **ScenarioGame** — 모의 투자 1회 실행 (§8.3)
- **Assessment** — 게임 종료 후 투자 성향 진단 (§8.4)
- **LeadSignal** — 이벤트 공개 전에 주어지는 선행 신호. 신뢰도(`reliability`)를 가짐
- **pre-event / post-event 판단** — 이벤트 비공개 상태의 판단과 공개 후 판단. 둘의 차이가 편향 관측값
- **반증 신호** — 시나리오를 취소해야 하는 조건. 모든 시나리오에 필수
- **연습 유형** — `balanced` · `stress` · `opportunity` · `random`
- **기여도(contribution)** — 개별 종목이 지수 변동에 기여한 %p
