# Impact Model Specification

순수 함수 모듈: [`agents/scenario_card/impact_model.py`](../../../agents/scenario_card/impact_model.py)

LLM은 이 모듈의 **입력을 준비**하고 **출력을 서술에 반영**할 뿐, impact 숫자를 임의로 변경하지 않는다.

## 1. 입력

| 입력 | 출처 |
| --- | --- |
| `base_index` | `market.index_daily.close` @ `as_of` |
| `trading_value[]` | `market.index_daily.trading_value` (KOSPI) |
| `impact_channel` | Historical Agent `impact-channel-{id}.json` |
| `web_news_channel` | Web Agent (evidence gap 시만) |
| `weights` | `volume_regime.json` (또는 모듈 내 재계산) |
| `tone` | `up` / `down` / `neutral` |
| `event_templates[]` | `scenario_set_plan.json` |

## 2. 결측 backfill

`trading_value` 또는 `volume`이 null/0인 거래일:

1. 동일 series에서 **전진 fill** (직전 유효값)
2. 여전히 null이면 **후진 fill**
3. 구간 전체 결측이면 `volume` → `trading_value` proxy 또는 상수 median backfill

backfill 사용 시 `volume_regime.limitations`에 기록.

## 3. Volume-adaptive weights

```text
TV_20   = mean(trading_value, 최근 20거래일)   # backfill 후
TV_240  = median(trading_value, 최근 240거래일)

tv_ratio = TV_20 / TV_240
activity = clip((tv_ratio - 0.75) / (1.35 - 0.75), 0, 1)

w_quant    = 0.18 + 0.32 * activity    # 18% ~ 50%
w_news     = 0.42 - 0.22 * activity    # 42% ~ 20%
w_analyst  = 1 - w_quant - w_news      # 40% ~ 30%
```

| tv_ratio | activity | quant | news | analyst |
| --- | --- | --- | --- | --- |
| ≤ 0.75 | 0 | 18% | 42% | 40% |
| 1.00 | 0.42 | 31% | 33% | 36% |
| ≥ 1.35 | 1 | 50% | 20% | 30% |

## 4. 채널 추정 (Historical)

이벤트 `e`, analog 집합 `A` (similarity 가중):

```text
I_quant_raw = weighted_median(r_a, h)          # h = event horizon (거래일)
I_tech      = weighted_median(tech_overlay_a)
I_quant     = 0.70 * I_quant_raw + 0.30 * I_tech

I_analyst   = weighted_median(r_earnings_a)    # 실적 analog 없으면 I_quant_raw
```

`evidence_sufficient = (n_analog >= 2) AND (channel_confidence >= 0.55)`

## 5. Web 보완 (`I_news`)

```text
if evidence_sufficient:
    I_news = 0
else:
    cap = min(0.5 * |I_quant| + 0.5 * |I_analyst|, 4.0)   # n_analog==0 절대상한 4%p
    I_news = sign(tone) * min(|I_web_direction|, cap)
```

`I_web_direction`: Web Agent narrative strength × (가능하면) 유사 narrative 과거 median.

## 6. 이벤트 impact

```text
I_event = w_quant * I_quant + w_analyst * I_analyst + w_news * I_news

cum_0 = 0
cum_k = cum_{k-1} + I_event_k                    # %p
level_k = base_index * (1 + cum_k / 100)
```

UI `events[k].impact` = `format_pct(cum_k)` (예: `"+10.0%"`).

### Tone 제약

- `up`: `cum_k` non-decreasing (ε=0.3%p 이내 조정 허용)
- `down`: non-increasing
- `neutral`: `|cum_final| <= neutral_forecast_abs_cap_pct` (기본 5%p)

## 7. Path (12점)

앵커: `(0, base_index)`, `(t_k, level_k)` for k=1..3 events.

```text
path[i] = linear_interp(anchors, i * horizon_trading_days / 11),  i = 0..11
path[0] == base_index
path[11] ≈ level_3
```

`forecast_pct = (path[11] / base_index - 1) * 100`

`band`: analog `cum_final`의 weighted p25 / p75 → index level 변환.

## 8. 출력

[`schemas/impact-model.schema.json`](./schemas/impact-model.schema.json) — Scenario Author와 Orchestrator QA의 단일 숫자 소스.

## 9. QA (Orchestrator)

- look-ahead: analog 선정에 anchor 이후 정보 사용 → reject
- `impact_model.events[k].impact` ≠ Author JSON → reject
- `evidence_sufficient`인데 `news_fallback_used` → reject
- `path[0] != base_index` → reject
