# FINVERSE 시나리오 온톨로지 — 어휘 사전 (단일 진실)

> `finverse-ontology.md`가 **무엇을 왜 모으는가**라면, 이 문서는 **그것을 어떤 이름의 노드·엣지·속성으로 부르는가**다.
> 그래프 projection · API · 시뮬레이션 브리프 생성은 전부 이 표를 따른다.
> 여기 없는 라벨·엣지·속성명을 코드에 쓰면 안 된다. 변경은 이 문서 수정 → 코드 순서로만.

- 노드 라벨: PascalCase 단수 / 엣지: UPPER_SNAKE 동사구 / 속성: snake_case
- 날짜는 ISO 문자열 `"YYYY-MM-DD"` (사전순=시간순)
- `uid`는 외부 식별자 — **불변 ID 기반**. 이름 기반 금지 (§7-2 예외 부채 참조)
- 모든 노드·엣지는 유래한 `lake.records.record_id` 집합을 `evidence` 로 들고 있다

---

## 0. 세 계층 — 무엇을 어디에 두는가

```text
lake    수집 원본 (record_id · payload jsonb · 불변)        ← 이미 존재
core    정규화 시계열 + 실체 테이블 (관계형)                  ← 만들어야 함
graph   온톨로지 (실체 · 사건 · 해석 · 시나리오)              ← 만들어야 함
```

**시계열은 그래프에 넣지 않는다.** `market_price_daily` 하나가 이미 970만 행이다.
그래프는 *무엇이 무엇과 어떤 관계인가*만 담고, 값은 `core`의 테이블에 둔다.
그래프 노드는 시계열을 **참조**하고, 시계열이 임계를 넘은 순간에만 `MarketMove` 노드가 생긴다.

| lake record_type | 행수 규모 | 가는 곳 |
|---|---|---|
| `market_price_daily` | ~9.7M | core 시계열 (그래프 ✗) |
| `market_index_daily` | 대량 | core 시계열 + `Index` 노드 |
| `market_investor_flow_daily` | 대량 | core 시계열 (그래프 ✗) |
| `market_foreign_holding_daily` | 대량 | core 시계열 (그래프 ✗) |
| `market_security` | ~2.8K | `Security`·`Market` 노드 |
| `market_sector_membership` | ~4.0K | `Sector`(naver_wics) 노드 + `IN_SECTOR` 엣지 |
| `economic_observation` | ~24K | core 시계열 + `Indicator`·`Release` 노드 |
| `news_article` | 수백~ | `Event` 노드 |
| *(미수집)* youtube/reddit | 0 | `SentimentWindow` 노드 |

---

## 1. 실체 노드 — 시간이 지나도 같은 것

| 라벨 | uid | 속성 | 유래 |
|---|---|---|---|
| `Market` | `market:{code}` | `code`(KOSPI/KOSDAQ/KONEX), `name` | `market_security.market` |
| `Index` | `index:{source}:{idx_class}:{slug(idx_name)}` | `idx_class`, `idx_name`, `source`, **`kind`**, `universe?`, `classified_by` | `market_index_daily` |
| `Sector` | `sector:{scheme}:{slug(name)}` | `scheme`, `name` | **업종지수에서 도출** (§1-1) |
| `Security` | `security:{isin}` | `isin`, `ticker`, `name`, `short_name`, `english_name`, `share_type`, `listed_on`, `par_value`, `board_segment?` | `market_security` |
| `Indicator` | `indicator:{source}:{external_series_id}` | `series_name`, `unit`, `cycle`, `stat_code`, `item_codes`, `seasonal_adj` | `economic_observation` |
| `Actor` | `actor:{scheme}:{id}` | `name`, `kind`(company/regulator/media/analyst/retail_group) | `Event`·`Brief`에서 추출. §5의 MiroFish 경계에 필요 |

`Security.ticker`는 속성이지 키가 아니다 — §6-8.

### 1-1. `Index.kind` — 지수 131개는 같은 종류가 아니다

KRX 지수 시리즈에는 `코스피`, `코스피 200 금융`, `KRX 삼성전자 지수`, `코스닥 벤처기업부`가
**전부 같은 엔드포인트로** 들어온다. 한 라벨로 뭉치면 "지수 평균 변동률" 같은 계산이 곧바로 무의미해진다.
`kind` 없이 `Index` 노드를 만들지 않는다.

| `kind` | 예 | 개수 |
|---|---|---|
| `market` | 코스피, 코스닥, 코스피 (외국주포함) | 4 |
| `size` | 코스피 대형주/중형주/소형주, 코스닥 대형주/… | 6 |
| `sector` | 건설, 금융, 화학, 전기전자, KRX 반도체, 코스피 200 금융, KRX 300 헬스케어 | ~80 |
| `strategy` | 코스피 200, KRX 300, KTOP 30, 코스닥 150, 코리아 밸류업 지수 | ~25 |
| `board_segment` | 코스닥 벤처기업부, 코스닥 우량기업부 | 4 |
| `single_stock` | KRX 삼성전자 지수, KRX SK하이닉스 지수 | 2 |
| `factor` | K-샤프지수(1·3·5·10년), KRX TMI 시리즈 | ~8 |

`kind='sector'`인 지수에서 `Sector` 노드가 나온다. `scheme`은 네 가지다 —
`krx_industry`(건설·금융·화학 등 전통 업종), `gics_like`(코스피200·KRX300·코스닥150 하위의
산업재·소재·정보기술 등), `krx_thematic`(KRX 반도체·자동차·K콘텐츠), 그리고
`naver_wics`(sector_ingest 가 가져오는 79개 업종).
같은 섹터를 서로 다른 유니버스가 추종하므로 `SECTOR_INDEX_OF` 엣지에 `universe`를 적는다.

**`naver_wics`만 구성종목을 가진다.** KRX 업종지수는 지수 *수준*은 주지만 그 안에 무엇이
들었는지는 공개하지 않는다. 그래서 `IN_SECTOR`(종목→섹터)는 `naver_wics` 쪽으로만 생긴다.
두 체계 사이의 대응은 아직 없다 — §8.

분류는 이름 패턴 규칙이고 `classified_by`에 규칙명을 박는다 — §8의 지수 코드 부채가 해소되면 교체한다.

**`market_security.sector_type`은 섹터가 아니다.** 실제 값은 `중견기업부`·`우량기업부`·
`벤처기업부`·`기술성장기업부`이고 KOSPI 종목 943건은 아예 비어 있다. 이건 업종이 아니라
**코스닥 소속부**다. `Security.board_segment` 속성으로 두고, 여기서 `Sector` 노드를 만들지 않는다.

## 2. 사건 노드 — 시간 위의 한 점

| 라벨 | uid | 속성 | 생성 규칙 |
|---|---|---|---|
| `MarketMove` | `move:{target_uid}:{bas_dd}:{kind}` | `kind`(SPIKE_UP/SPIKE_DOWN/TREND_UP/TREND_DOWN), `bas_dd`, `magnitude`, `direction`, `duration_days`, `detected_by`, `source`, `price_basis` | 250일 ±3σ 또는 절대 ±3% 일간 변동 / 직전 극점 대비 15% 되돌림(ZigZag) |
| `Release` | `release:{indicator_uid}:{period}` | `period`(기준), `released_at`(발표), `value`, `unit`, `consensus?`, `surprise?`, `revision_of?` | 지표 발표 1건 = 1노드. 수정 발표는 **새 노드** + `revision_of` |
| `Event` | `event:{source}:{external_id}` | `title`, `url`, `published_at`, `country_codes`, `event_types`, `fact`, `interpretation?`, `market_reaction?` | `news_article`. 제목만 저장하지 않는다 — §6-12 |
| `SentimentWindow` | `senti:{target_uid}:{platform}:{period_start}` | `platform`, `period_start`, `period_end`, `mention_count`, `polarity`, `intensity`, `sample_size`, `bot_ratio`, `dedup_ratio` | 종목·섹터 × 플랫폼 × 기간 집계 |
| `Regime` | `regime:{target_uid}:{start}` | `start`, `end?`, `label`, `volatility`, `detected_by` | 국면 구간. `MarketMove`가 점이라면 이것은 구간 |

`detected_by`에는 규칙명과 임계값을 문자열로 박는다. 임계값을 바꾸면 이전 결과와 구분되어 나란히 남는다.

**`MarketMove`는 가격 수열에서만 만든다.** 지수 시리즈에는 가격이 아닌 것이 섞여 들어온다 —
`K-샤프지수`는 위험조정 수익률이라 `-2.27 ~ 3.54`를 오가며 0을 지나가고, 그런 수열에
백분율 변화를 적용하면 `0.02 → 0.24`가 "+1100%"가 된다. 실제로 그렇게 잡혔다.

거르는 기준은 이름이나 `kind`가 아니라 **값이 한 번이라도 0 이하로 내려갔는지**다.
`kind`는 이름 패턴 규칙(§1-1)이라 `K-샤프지수`와 `KRX TMI`를 똑같이 `factor`로 묶는데,
TMI는 `887~5,763`짜리 멀쩡한 가격지수다. 값의 성질로 판단하면 둘이 정확히 갈리고,
새 비율 지표가 들어와도 규칙을 고치지 않아도 된다.

## 3. 관측 엣지 — 원본에서 그대로 도출

공통 속성 `source`. 재계산이 지워서는 안 되는 사실 관계.

| 엣지 | 방향 | 규칙 |
|---|---|---|
| `LISTED_ON` | (Security)→(Market) | `market_security.market` |
| `IN_SECTOR` | (Security)→(Sector) | `market_sector_membership`. `naver_wics` 섹터로만. 소속부로 만들지 않는다 |
| `COMPONENT_OF` | (Security)→(Index) | 지수 구성종목. **KOSDAQ150은 구성종목 미확보** — `membership="proxy_marketcap"` 표시 |
| `TRACKS` | (Index)→(Market) | `idx_class`. `kind='sector'`인 지수도 자기 시장을 가리킨다 |
| `SECTOR_INDEX_OF` | (Index)→(Sector) | `kind='sector'`인 지수만. `universe` 속성 필수 |
| `MOVED` | (MarketMove)→(Index\|Sector\|Security) | 무엇이 움직였나 |
| `REPORTED` | (Release)→(Indicator) | 어느 지표의 발표인가 |
| `MENTIONS` | (Event)→(Security\|Sector\|Index\|Indicator) | 기사가 명시적으로 지목한 대상만. 추론 금지 |
| `ISSUED_BY` | (Event)→(Actor) | 공시·발표의 주체 |
| `ABOUT` | (SentimentWindow)→(Security\|Sector\|Index) | 심리 관측 대상 |

## 4. 해석 엣지 — 배치 계산, 재계산이 지워도 되는 것

**공통 속성 `method` · `computed_at` · `pipeline_version` 3종 필수.**
이 3종이 있으면 "재계산이 지워도 되는 엣지"라는 계약이다. 없으면 §3의 관측 엣지다.

| 엣지 | 노드쌍 | 추가 속성 | 대응하는 핵심 관계 |
|---|---|---|---|
| `INFLUENCED` | (Event)→(Indicator\|MarketMove) | `lag_days`, `confidence`, `basis`, `direction` | 외부 사건 → 경제 / 외부 사건 → 시장 |
| `TRANSMITS_TO` | (Indicator)→(Index\|Sector\|Security) | `lag_days`, `confidence`, `basis`, `elasticity?` | 경제 → 시장 |
| `REACTED_TO` | (SentimentWindow)→(MarketMove) | `lag_days`, `confidence` | 시장 → 사람들의 심리 |
| `AMPLIFIED` | (SentimentWindow)→(MarketMove) | `lag_days`, `confidence` | 사람들의 심리 → 시장 |
| `ANALOGOUS_TO` | (Situation)→(Regime\|MarketMove) | `score`, `matched_on[]`, `divergence[]` | 과거 유사 사례 → 현재 상황 해석 |
| `CO_MOVES_WITH` | (Security)↔(Security) | `corr`, `window_days`, `observations`, `sector_uid` | 섹터·종목 동조 |

`CO_MOVES_WITH`는 **같은 섹터 안에서만** 짝을 만든다. 전 종목 쌍은 2,800개면 390만 쌍이라
계산이 무의미하게 커지고, 섹터를 넘는 동조성은 그 자체로 다른 질문이다. 대상은 시총 상위
`comove_max_universe`개로 자르며, 자른 규모를 결과에 `dropped`로 보고한다 — 조용히 줄이면
"전 종목을 봤다"로 읽힌다. 임계값은 `derive.params` 한 곳에 있고 `method` 문자열에 박힌다.

`INFLUENCED` · `TRANSMITS_TO`는 **인과가 아니라 시차 상관 관측**이다 — §6-6.
`ANALOGOUS_TO`는 `divergence[]`(현재와 과거의 차이) 없이 만들 수 없다 — 온톨로지 원문의
"과거 결과를 미래의 정답으로 사용하지 않고, 현재 조건과의 차이를 함께 표시한다"의 스키마적 구현이다.

## 5. 시나리오 계층 — 질문에서 분기까지

| 라벨 | uid | 속성 |
|---|---|---|
| `Question` | `question:{uuid}` | `text`, `asked_at`, `scope`(사용자 지정 대상), `horizon_days` |
| `Situation` | `situation:{uuid}` | `as_of`, `summary`, `coverage`(수집 충족도), `neutralized[]`(근거 부족으로 중립 처리한 항목) |
| `Brief` | `brief:{situation_uuid}` | `text`, `actors[]`, `seed_event`, `locale` |
| `Simulation` | `sim:{run_id}` | `engine`(mirofish), `run_id`, `rounds`, `started_at`, `config_digest` |
| `Branch` | `branch:{sim_uid}:{path}` | `path`(base/optimistic/adverse/…), `label`, `conditions[]`, `range`, `confidence_interval`, `limits[]` |
| `Assumption` | `assumption:{branch_uid}:{n}` | `subject_uid`, `statement`, `value?`, `basis` |

| 엣지 | 방향 | 규칙 |
|---|---|---|
| `SCOPED_BY` | (Situation)→(Question) | 어느 질문의 상황 구성인가 |
| `INCLUDES` | (Situation)→(Index\|Security\|Indicator\|Event\|SentimentWindow) | 스냅샷에 포함된 대상. `role`(user_specified/auto_supplemented/neutralized) |
| `SIMULATED_AS` | (Situation)→(Brief) | 그래프 → 텍스트 변환 산출물 |
| `FED` | (Brief)→(Simulation) | MiroFish 입력 |
| `PRODUCED` | (Simulation)→(Branch) | 시뮬레이션 산출 분기 |
| `BRANCHES_FROM` | (Branch)→(Branch) | 분기 트리. 루트는 나가는 엣지 없음 |
| `ASSUMES` | (Branch)→(Assumption) | 분기의 전제 |
| `GROUNDED_IN` | (Branch)→(Regime\|MarketMove) | 과거 근거. `method`/`computed_at`/`pipeline_version` 보유 |

### 검색 원칙의 스키마적 표현

`INCLUDES.role`이 온톨로지 원문의 3단 검색 원칙을 그대로 담는다.

```text
사용자 지정 정보        → role="user_specified"     반드시 검색
분석에 필요한 누락 정보  → role="auto_supplemented"   LLM 판단해 추가 검색
영향 작거나 근거 부족    → role="neutralized"        중립 처리 (Situation.neutralized[]에도 기록)
```

중립 처리된 항목을 **엣지 없이 빼버리면 안 된다.** 무엇을 왜 뺐는지가 시나리오의 한계 설명이 된다.

---

## 6. 불변식

1. **그래프의 유일한 작성자는 projection이다.** API·시뮬레이션은 그래프에 쓰지 않는다.
2. **그래프는 drop 후 core에서 전량 재구축 가능해야 한다** (full rebuild 멱등).
   예외: `Question`·`Simulation`·`Branch`와 사람이 확정한 판단은 재계산으로 만들 수 없다 —
   `core.scenario_*` 원장에 두고 projection이 읽는다. 어떤 재계산도 이 행을 삭제하지 못한다.
3. **시계열은 노드가 아니다.** §0의 표를 어기면 노드 수가 종목수 × 거래일수로 폭발한다.
4. **관측(§3)과 해석(§4)을 같은 엣지로 쓰지 않는다.** 해석 엣지는 3종 속성이 반드시 있다.
5. **`source`는 식별자의 일부다.** lake가 이미 그렇게 설계돼 있고 그래프도 따른다.
   같은 날 같은 종목이라도 소스가 다르면 각각 남고 덮어쓰지 않는다.
   - **종목의 수익률·변동성·`MarketMove` → `naver_finance`** (수정주가). 원주가를 쓰면
     분할일에 가짜 폭락이 생긴다 — 삼성전자 2018-05-04가 -98%로 잡힌다.
   - **지수는 예외다.** 지수 수준은 액면분할의 영향을 받지 않으므로 KRX 원지수를 그대로 쓴다.
     `price_basis='unadjusted'`인 `MarketMove`는 대상이 `Index`일 때만 정상이다.
   - **거래대금·시가총액·상장주식수 → `krx_open_api`** (Naver는 제공하지 않는다).
   - `MarketMove`는 `source`와 `price_basis`를 반드시 들고 있다. 둘을 섞은 노드는 만들지 않는다.
6. **인과를 주장하지 않는다.** `INFLUENCED`·`TRANSMITS_TO`는 시차 상관 관측이다.
   `confidence`와 `basis` 없이 만들 수 없다. 단일 사례로 만든 엣지는 `confidence≤0.3`.
7. **심리는 사실이 아니다.** `SentimentWindow`만으로 `AMPLIFIED`를 만들 수 없고,
   `sample_size`·`bot_ratio`·`dedup_ratio` 없이는 노드 자체를 만들지 않는다.
   언급량이 많다는 사실과 시장 방향을 동일하게 취급하지 않는다.
8. **키는 `isin`이지 `ticker`가 아니다.** KRX는 표준코드(`KR7005930003`), Naver는 단축코드(`005930`)뿐이다.
   두 소스 조인은 `Security.ticker`로 하되, 단축코드는 재사용될 수 있으므로 `uid`로 쓰지 않는다.
9. **`Branch`에 `probability` 속성을 두지 않는다.** 조건(`conditions[]`)과 범위(`range`,
   `confidence_interval`)와 한계(`limits[]`)만 둔다. 확률값은 교육용 시뮬레이션이
   예측을 단정하는 것처럼 읽히게 만든다 — README 금융 안전 원칙.
10. **`Release`는 기준 시점과 발표 시점이 다르다.** `period`(기준)와 `released_at`(발표)를 분리한다.
    수정 발표는 기존 노드를 고치지 않고 새 노드 + `revision_of`로 남긴다.
11. **`Event`는 제목만 저장하지 않는다.** `fact`(원문이 말한 사실)·`interpretation`(해석)·
    `market_reaction`(실제 반응)을 분리한다. 셋을 한 필드에 뭉치면 나중에 근거와 추측을 못 가른다.
12. **`MENTIONS`는 기사가 명시한 대상만.** "반도체 뉴스니까 삼성전자"는 `MENTIONS`가 아니라
    `INFLUENCED`(해석, confidence 보유)다.

---

## 7. MiroFish 경계 — 두 온톨로지는 다르다

MiroFish는 **여론 시뮬레이션** 엔진이다(OASIS + Zep). 자체 온톨로지를 문서로부터 매번 새로 생성한다.

| | FINVERSE 온톨로지 | MiroFish 온톨로지 |
|---|---|---|
| 무엇을 담나 | 사실 — 무엇이 얼마나 움직였나 | 화자 — 누가 무엇을 말하나 |
| 노드 자격 | 시장·경제·사건·심리의 관측 대상 | **발언할 수 있는 주체만** |
| 타입 수 | 이 문서에 고정 | 정확히 10개, 문서마다 LLM이 생성 (9–10번은 `Person`/`Organization` 고정) |
| 수명 | 영속 | 실행 단위 |

**1. KOSPI·기준금리·반도체 섹터는 MiroFish 노드가 될 수 없다.**
MiroFish는 모든 노드를 소셜 계정으로 환생시키므로 발언할 수 없는 것은 노드가 되지 못한다.
"여론", "정서", "트렌드" 같은 추상 개념도 금지 — 그건 시뮬레이션 *결과*로 나와야 할 것이지 입력이 아니다.

→ 그래서 `Brief`가 필요하다. `Situation`(사실 그래프)을 **행위자가 등장하는 텍스트**로 변환한다.
`Brief.actors[]`에는 기업 IR·금융당국·언론사·애널리스트·개인투자자 집단처럼 발언 주체가 명시돼야 한다.
행위자 없이 지수와 금리만 서술한 브리프를 넣으면 MiroFish의 온톨로지 생성 단계가 성립하지 않는다.

**2. MiroFish는 가격 경로를 만들지 않는다.**
라운드마다 에이전트가 게시·반응하고, 확산 결과가 SQLite와 Zep에 남는다.
따라서 MiroFish 출력은 **4번 영역(심리)의 미래값**이며, `AMPLIFIED` 엣지를 통해 분기의 한 축이 된다.
`Branch`의 가격·수치 축은 §4의 `TRANSMITS_TO`와 `ANALOGOUS_TO`(과거 유사 사례)에서 와야 한다.
생성형 AI가 시장 가격이나 수익률을 임의로 만들지 않도록 분리한다는 README 원칙이 여기서 지켜진다.

**3. 왕복 추적을 위해 uid를 각인한다.**
MiroFish는 페르소나에 `source_entity_uuid`를 남겨 "이 발언이 그래프의 어느 노드에서 나왔나"를 역추적한다.
`Brief`가 등장시킨 행위자에 FINVERSE `Actor.uid`를 심어두어야 시뮬 결과를 원래 대상에 되붙일 수 있다.

**4. Zep 예약어를 속성명으로 쓰지 않는다.**
`uuid` · `name` · `group_id` · `graph_id` · `name_embedding` · `summary` · `created_at`.
`Brief`가 넘기는 속성명이 이와 충돌하면 인제스천이 깨진다.

```text
Situation ──SIMULATED_AS──> Brief ──FED──> Simulation ──PRODUCED──> Branch
 (사실 그래프)              (행위자 텍스트)   (MiroFish)            (분기)
                                                                    │
                          ANALOGOUS_TO / TRANSMITS_TO ──GROUNDED_IN─┘
                          (과거 유사 사례 · 경제 전이 — 수치 축)
```

---

## 8. 아직 없는 것 — 이 온톨로지가 지금 채울 수 없는 자리

정직하게 적어둔다. 스키마가 준비돼 있다는 것과 데이터가 있다는 것은 다르다.

| 자리 | 상태 |
|---|---|
| 섹터 체계 간 대응 | `naver_wics`(구성종목 있음)와 `krx_industry`/`gics_like`(지수 있음)가 서로 연결돼 있지 않다. "반도체와반도체장비 종목들"과 "KRX 반도체 지수"를 같이 보려면 둘을 잇는 매핑이 필요하다 |
| `market_sector_membership` 이력 | 현재 스냅샷뿐이다. 종목이 업종을 옮긴 시점을 복원할 수 없고, 상장폐지 종목에 tombstone 이 남지 않는다 |
| `naver_wics` 의 `기타` | 4,028쌍 중 1,236개가 `기타`로 몰려 있다. ETF·SPAC·우선주가 섞인 것으로 보이며, 섹터 분석에서 이 덩어리를 어떻게 다룰지 정해야 한다 |
| `SentimentWindow` | **데이터 0건.** `data/youtube_comments/`에 `latest.jsonl`이 없다. 4번 영역 전체가 비어 있다 |
| `Event` (공시) | DART 미수집. 외부 사건이 RSS 뉴스뿐이라 기업 실적·CapEx·공시가 없다 |
| `Release.consensus` / `surprise` | 예상값 소스 없음. "시장 예상값과 실제 발표값의 차이"를 아직 못 만든다 |
| `MarketMove` | 탐지기(±3σ / ZigZag 15%)는 로컬 `finverse/analyze.py`에만 있고 서버 파이프라인에 없다 |
| `COMPONENT_OF` (KOSDAQ150) | Naver가 구성종목을 노출하지 않아 시총상위 프록시. `membership`으로 구분해 기록 |
| `Index.uid` · `Index.kind` | KRX 지수 코드(`IDX_IND_CD`)를 수집하지 않아 uid도 분류도 `idx_name` 문자열 패턴에 기댄다. **이름 기반 uid 금지 원칙 위반** — 코드 수집 후 함께 교체해야 할 부채. 지수 이름이 바뀌면 uid가 끊긴다 |
| `Regime` | 국면 라벨링 규칙 미정 |
