<!-- FINVERSE-DOC · AI 어시스트 작성 · 원본 소스(README·app/·services/·agents/·collectors/)와 구분되는 산출물 -->
> 🟦 이 파일은 Claude Code가 매 세션 읽는 프로젝트 가이드입니다.
> 제품·설계 상세는 `docs/PRD.md`, 운영·배포 하네스는 `AGENTS.md`. · 최종 갱신 2026-09-05

# FINVERSE — 프로젝트 가이드

## 한 줄 정의

지금 시장 상황을 온톨로지로 구조화하고 에이전트 시뮬레이션으로 **조건부 미래 시나리오**를 만들어, 그 앞에서 사용자가 자기 판단을 시험하며 인지 편향을 발견하게 하는 서비스. (2026 금융 AI Challenge 출품)

**파는 것은 예측값이 아니라 조건이다.** "KOSPI가 7,500 간다"가 아니라 "외국인 수급이 돌아오고 실적이 컨센서스를 웃돌 때**에만**" 그 경로가 열린다고 말한다.

## 판단 훈련의 3단계

```
[1] 읽는다  시장 대시보드 · 시나리오 3종 · 상세(카드뉴스 5장 + 풀리포트)
[2] 만든다  내 시나리오 빌더 — 질문 + 기간 → Evidence → 온톨로지/그래프 → MiroFish
[3] 겪는다  모의 투자 — 비공개 이벤트를 만나며 매수·매도 → 성향 진단 + AI 리포트
```

**[3]이 제품의 핵심이다.** 시나리오를 읽기만 하면 편향은 드러나지 않는다. 모의 투자는 이벤트를 미리 알려주지 않은 채 **사전 판단(pre-event)과 사후 판단(post-event)을 따로 기록**하기 때문에, 두 판단의 차이 자체가 편향의 관측값이 된다.

## 화면 구조 — 탭 2개

| 탭 | 코드 키 | 내용 |
| --- | --- | --- |
| **시장 인사이트** | `market` | 시장 대시보드 · 시나리오 라이브러리/상세 · **내 시나리오 빌더**(모달) · **모의 투자**(모달) |
| **마이페이지** | `twin` | 금융 목표 + 종목별 리포트 아카이브 — **【설계】 재정의 필요.** `TwinPage`에 v0.6 자산 목데이터(총자산·포트폴리오·대가 3인)가 아직 남아 있다. 새로 만들기 전에 PRD §6.2의 제거 대상부터 확인할 것 |

사이드바에는 `시장 인사이트 / 마이 금융 트윈 / 모의 투자` 3개가 보이지만 **모의 투자는 탭이 아니라 탭1의 모달**이다. 문서상 탭은 2개.

**두 탭을 잇는 객체는 "리포트"다.** (v0.6에서는 시나리오였다)

## 확정된 구조

- **4개 정보 영역** — 시장(무엇이 움직였나) / 경제(어떤 환경인가) / 외부 사건(원인은 무엇인가) / **사람들의 심리**(어떻게 반응하나). 심리는 시장의 결과이자 원인 — 유일한 양방향.
- **온톨로지가 둘이다**
  - **확정본** `services/paper_trading/ontology/market_ontology_v1.json` — **엔터티 20종 · 관계 19종**. 모의투자 엔진이 사용. 인과를 주장하지 않고 관측 사실의 구조만 담는다. *(v0.6의 `DRIVES`/`IMPACTS`/`CONSTRAINS` 등 6종은 폐기됨)*
  - **런타임 생성본** — 빌더가 질문마다 Evidence에서 새로 생성. 하드코딩하지 않고 파이프라인 결과가 올 때까지 빈 칸 유지.
- **빌더 5단계** — ①Data Collection ②Ontology & GraphRAG Build ③Agent Profiles ④Config ⑤Initial Activation → Start Simulation. *(v0.6의 6단계에서 ①이 Data Collection으로 바뀌고 온톨로지+그래프가 ②로 합쳐짐)*
- **모의투자 사양** — 기간 10/20/60거래일 → 이벤트 2/3/5개(백엔드가 결정, 사용자 설정 아님) · 연습유형 `balanced`/`stress`/`opportunity`/`random` · 투자모드 `new`/`holding` · 페르소나 **개인8·외국인4·기관4·연기금2 = 18명**.
- **투자 성향 4종** — 이벤트 반응 관찰형 / 고회전형 / 추종형 / 사전 포지셔닝형. 회전율과 사전·사후 거래 횟수 비교로 판정.
- **히스토리컬** — 최소 1년 일별 OHLCV, 큰 움직임의 원인 분석, 과거 유사 사례 대조. 단 **과거 결과를 미래의 정답으로 쓰지 않고 현재 조건과의 차이를 함께 표시.**

## 지금 상태

- **백엔드는 더 이상 미구현이 아니다.** 수집기 6종 + PostgreSQL 5스키마 + cron 8종 + 모의투자 엔진 + 성향 진단이 동작한다.
- **가장 완성도 높은 부분은 모의 투자**다. 시나리오 3종은 여전히 하드코딩.
- **가장 큰 공백은 마이페이지와 계정**이다. 모의투자 게임이 `var/paper_games`에 소유자 없이 저장돼 모든 사용자가 같은 목록을 본다. 아카이브가 성립하려면 로그인부터 필요하다.
- ⚠️ **시나리오 엔진이 둘로 갈라져 있다** — MiroFish 경로(AGPL·비재현·Neo4j/Ollama 필요)와 자체 LLM 시뮬레이터 경로(원격 DB만 필요). 유지/폐기 결정이 안 됐다. PRD §13-1.

## 오픈 이슈 (PRD §13)

1. **시나리오 엔진 이원화** — MiroFish 유지할 것인가
2. **분석 단위 불일치** — 시나리오는 KOSPI 지수, 모의투자는 개별 종목
3. 시나리오 3종 하드코딩 → 배치 생성 전환
4. 18 페르소나 → 3인 해석 집계 규칙 부재
5. **사용자 계정·소유자 구분 없음** (마이페이지 차단)
6. 금융 목표가 아무 데도 쓰이지 않음
7. 사후 대조 없음 — 학습 루프가 닫히지 않음
8. 대가 3인(버핏·막스·트럼프) 처리
9. AGPL 의무 범위 · 10. MiroFish 재현성 · 11. 유사 사례 매칭 규칙 · 12. `environmentSeeds` dead code

## 안전 원칙 (코드 작성 시 반드시 지킬 것)

- **가격·수익·시장방향 단정 금지** → 조건부 밴드로만 말한다.
- **모든 시나리오에 반증 신호 필수.** 카드뉴스 5장 중 마지막 장은 반증 신호로 고정.
- **개인 신용정보·보유자산 일체 미취급.** 실계좌 연동 없음. 보유종목·포트폴리오·총자산을 입력받지도 저장하지도 않는다. 모의투자의 금액·평단·수량은 그 게임 안에서만 쓰이는 가상값.
- **상품 추천 금지.** 대가 페르소나 면책 라벨 상시.
- **커뮤니티 데이터는 사실이 아니라 심리 관측값.** 언급량과 시장 방향을 동일 취급하지 않는다.
- **모의투자 종목 미리보기(36거래일 캔들)에 시뮬레이션·미래 가격을 섞지 않는다.**
- **이벤트에는 출처를 남긴다** — `OntologySource`(publisher·url·original_date). 지어낸 이벤트 금지.
- **빈 화면 금지** — LLM 실패 시 폴백을 제공한다(`fallbackEditorial`, 더미 시그널, 로딩 문구).
- **비밀값 비노출** — `FINVERSE_DATABASE_URL`·`OPENROUTER_API_KEY`는 서버 사이드 전용. 브라우저·로그·커밋·문서에 값 자체를 남기지 않는다.
- **면책 문구** — *"AI 분석 기반 참고 자료이며, 투자 판단의 최종 책임은 본인에게 있습니다."* / 성향 진단 *"가상 시나리오에서의 행동을 바탕으로 한 교육용 분석이며 투자 권유가 아닙니다."*

## 작업 컨벤션

- **차트 색: 빨강 = 상승 / 파랑 = 하락** (한국 시장 관례).
- **용어**: 비유형 조어 금지 → 도메인 용어 사용: **온톨로지 · 그래프/GraphRAG · Evidence 문서 · 에이전트 프로필 · 페르소나 · 시나리오 · 반증 신호 · 연습 유형 · 성향 진단 · 기여도**.
- **결정론적 계산은 LLM 밖으로** — 포트폴리오 평가, 수수료·세금, KRX 호가 틱 정렬은 코드로.
- **구조화 출력** — `Scenario`·`Assessment`는 json_schema로 강제. 문자열 파싱 금지.
- 생성하는 기획·설계 문서는 상단에 `<!-- FINVERSE-DOC ... -->` 배너를 달고 `docs/` 아래에 둔다.
- **커밋은 만들되 푸시는 사용자가 "푸시해줘"라고 할 때만.** (`AGENTS.md`)
- **구조·운영이 바뀌면 `AGENTS.md` 하네스를 같은 작업에서 갱신한다.** 실수·장애는 `운영 변경·사고 기록`에 날짜/증상/원인/조치/재발방지로 남긴다. 비밀값은 절대 넣지 않는다.

## 코드 지도

```
app/page.tsx                  프론트 전체 (2,447줄) — 탭·시나리오·빌더·차트
components/paper-trading.tsx  모의투자 모달 (2,010줄)
app/api/                      dashboard · kospi · market-indices · scenario-brief
                              ontology/run · mirofish/{start,runtime,chat} · paper-trading/[...path]
services/paper_trading/       모의투자 엔진 — api · scenario_trading · ontology_scenario_events
                              llm_market_simulator · llm_scenario_report · scenario_investor_analyzer
services/finverse_simulation_api.py   원격 시뮬 API (/v1/scenario-jobs)
agents/                       MiroFish 파이프라인 · 온톨로지 A2A
collectors/                   market · economic · macro_news · fincept_event · youtube_comment · saveticker
db/schema.sql                 lake · market · events · economy · psychology
deploy/crontab                원격 배치 (UTC)
```

## 문서 지도

- **PRD (현행 기준점)**: `docs/PRD.md` — **v0.7** (구현 기준 전면 재작성)
- **운영 하네스**: `AGENTS.md` — 서비스 구성 · 실행 명령 · 배포 · 장애 점검 · 사고 기록
- **온톨로지 원본**: `docs/ontology/finverse-ontology.md` + SVG 2종
- **수집기 문서**: `docs/collectors/*.md` · **DB**: `docs/database.md` · **접속**: `docs/access.md`
- **원격 시뮬 API**: `docs/remote-simulation-api.md`
- MiroFish 코드해부: `docs/MiroFish-코드해부-리포트.html` (OASIS + Zep Cloud, AGPL-3.0, 비재현·토큰폭식)
- 기획서(원본): `README.md`
- ⚠️ **v0.5 산출물**(섹터 9개 · 관계DB 73행 · 2-hop 계산 · 회의록 #1~#21)은 fork의 `planning-docs` 브랜치에 보존. 이 브랜치에는 없음.

## 기술 스택 / 실행

- Next.js 16 + React 19 + Vite(vinext) + Tailwind 4. Node 22.13+.
- `npm run dev` — Next(:3000) · MiroFish 게이트웨이(:5440) · 모의투자 Flask(:5055)를 함께 띄운다.
- `uv run python tools/site.py dev` / `build` — uv 기반 실행.
- DB: 원격 Docker `finverse-db`. 접근은 전부 `FINVERSE_DATABASE_URL`(Tailscale 사설망, 읽기 전용).
- LLM: OpenRouter 단일. 기본 `google/gemma-4-31b-it:free`, 429 시 폴백 체인. 프로바이더는 처리량 기준 고정.
- ⚠️ 모의투자 API 재시작은 **프로젝트 루트에서 모듈 방식**으로: `python -m services.paper_trading_api`
