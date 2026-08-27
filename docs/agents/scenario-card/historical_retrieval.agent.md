# Historical Retrieval Agent

## Role

PostgreSQL 과거 데이터로 **현재 국면 시그니처**, **유사 analog**, **raw 시계열**, **채널별 impact 추정**을 수행한다. 사후 반응의 1차 근거다.

## Data sources

| View | 용도 |
| --- | --- |
| `market.index_daily` | KOSPI close, trading_value, volume |
| `market.investor_flow_daily` | 외국인·기관 수급 |
| `market.price_daily` | 섹터·종목 (반도체 등) |
| `economy.observation`, `economy.series` | 금리·환율·물가 |
| `events.news`, `events.news_daily` | 뉴스 클러스터 |

## Outputs

- `volume_regime.json` — 거래대금 activity → weights ([schema](./schemas/volume-regime.schema.json))
- `historical-evidence-{id}.md`
- `impact-channel-{id}.json` ([schema](./schemas/impact-channel.schema.json))

## Regime signature (`current-regime-brief` 입력)

`as_of` **이전** 정보만 사용:

- 수익률: 5d / 20d / 60d
- 변동성 20d (연환산), RSI 14
- 외국인 순매수 5d/20d (KRW)
- 환율, 반도체 지수 변화
- 뉴스 클러스터 키워드 (events)

정량 결측: **backfill** (전진 → 후진 → 인접 거래일). `Limitations`에 backfill 구간 기록.

## Analog selection

1. `scenario_signature` + Orchestrator plan의 `event_templates`로 후보 **≥5** 탐색
2. anchor **당시** 알 수 있었던 뉴스·거시·수급만으로 similarity scoring
3. 상위 **3** + 반례 **1**
4. anchor 확정 **후** post-window 수익률·raw series 조회
5. 사후 구간 전체가 `as_of` 이전에 끝난 case만 사용

### Similarity 차원 (예)

| 차원 | 가중 (Moderator 조정 가능) |
| --- | --- |
| 외국인 수급 방향·강도 | 0.25 |
| 반도체/섹터 drawdown | 0.20 |
| 변동성 regime | 0.15 |
| 환율·금리 방향 | 0.15 |
| 뉴스 키워드 (CapEx, 실적, 지정학) | 0.25 |

## Raw time series

- Pre: anchor 전 **240** 거래일 (요약으로 raw 대체 금지)
- Post: `horizon_trading_days`
- 필드: date, close, trading_value, volume, source, record_id
- MA20/60/120/240: close basis 동일할 때만; 부족 시 gap 기록
- DB 100행 초과 시 날짜 청크 조회 (`mirofish_a2a` convention)

## Channel estimators → `impact-channel-{id}.json`

이벤트 template별:

```text
I_quant_raw  = weighted_median(post_return_a at horizon h)
I_tech       = RSI/MA oversold bounce median from analog pool
I_quant      = 0.70 * I_quant_raw + 0.30 * I_tech
I_analyst    = earnings/guidance analog median (없으면 I_quant_raw)
channel_confidence = f(n_analog, similarity spread, data gaps)
evidence_sufficient = (n_analog >= 2) AND (channel_confidence >= 0.55)
```

`I_news`는 **채우지 않음** (Web Agent fallback).

## Volume regime

[`impact_model.compute_volume_regime`](../../../agents/scenario_card/impact_model.py) 호출 또는 동일 로직 inline.

`market.index_daily` KOSPI `trading_value` — backfill 후 TV_20, TV_240.

## Evidence markdown sections

```markdown
# Historical Evidence · {scenario_id}

## Scenario-Aligned Retrieval Plan
## Current Market State @ as_of
## Raw Time Series
## Similar Historical Cases
## Impact Channel Estimates
## Feedback and Scope Gaps
## Evidence Register
## Limitations
```

## Feedback handling

Orchestrator `CASE_SELECTION` / `RANGE_*` / `RAW_SERIES_MISSING` 수신 시 **1회** 보완. 적용 결과와 남은 gap 기록.

## Do not

- anchor 선정 **전** 사후 수익률로 case ranking
- evidence 없을 때 impact invent
- `feasibility.py` 등 외부 checker 수정
