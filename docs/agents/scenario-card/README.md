# Scenario Card Agent Pipeline

FINVERSE Scenario Library 카드 JSON을 생성하는 4-Agent 파이프라인 설계 문서.

- **Entry point (신규)**: `agents/scenario_card_a2a.py` — `mirofish_a2a.py`와 분리
- **Impact 계산 (순수 함수)**: [`agents/scenario_card/impact_model.py`](../../../agents/scenario_card/impact_model.py)
- **최종 산출물**: `output/scenario-cards/<target>-asof-<date>/scenarios.json` (+ per-scenario artifacts)

## 문서 목록

| 파일 | 역할 |
| --- | --- |
| [orchestrator.agent.md](./orchestrator.agent.md) | Harness: 기획·조율·검수 |
| [historical_retrieval.agent.md](./historical_retrieval.agent.md) | DB 유사국면·시계열·채널 추정 |
| [web_search.agent.md](./web_search.agent.md) | 최신 전망·트리거·뉴스 보완 |
| [scenario_author.agent.md](./scenario_author.agent.md) | Evidence → 카드 JSON 서술 |
| [impact_model.spec.md](./impact_model.spec.md) | 가중치·impact·path 계산식 |
| [schemas/](./schemas/) | JSON Schema (v1) |

## 파이프라인

```text
run_spec
  ├─ Phase 1 (병렬): Web outlook + Historical regime/volume
  ├─ Phase 2: Orchestrator → scenario_set_plan.json
  ├─ Phase 3 (시나리오별): Historical channels + Web evidence
  ├─ Phase 4: impact_model.py → impact-model-{id}.json
  ├─ Phase 5: Scenario Author → scenario-{id}.json
  └─ Phase 6: Orchestrator → scenarios.json (배열 조립)
```

## 시나리오 세트 규칙

- 긍정(up): 1~2개
- 중립(neutral): 0~1개 — `tone: "neutral"` 또는 약한 up/down
- 부정(down): 1개
- UI 렌더링은 별도 담당; 본 파이프라인은 **JSON만** 산출

## Evidence 원칙

- 사후 반응: Historical 우선
- `evidence_sufficient == false`일 때만 Web 채널(`I_news`) 보완
- 정량 필드 결측: **backfill** 허용 (전진·후진·인접 거래일)

## 테스트

현재 구현된 순수 함수 모듈 [`impact_model.py`](../../../agents/scenario_card/impact_model.py)에 대한 단위 테스트입니다. A2A 파이프라인 통합 테스트는 `scenario_card_a2a.py` 구현 후 추가 예정.

### 사전 준비

저장소 루트에서 의존성을 설치합니다.

```bash
cd /path/to/finverse
uv sync --group dev
```

### 터미널 명령

**impact_model 전용** (권장):

```bash
uv run pytest tests/test_impact_model.py -v
```

**scenario-card 관련만 필터**:

```bash
uv run pytest tests/test_impact_model.py -v -k "impact"
```

**저장소 전체 pytest** (MiroFish A2A 등 포함, DB·AWS 설정 필요할 수 있음):

```bash
uv run pytest tests/ -v
```

한 줄 smoke check (pytest 없이도 가능):

```bash
uv run python -c "from agents.scenario_card.impact_model import compute_volume_regime; print(compute_volume_regime([1e12]*244).regime_label)"
```

### Python에서 직접 사용

거래대금 기반 가중치:

```python
from agents.scenario_card.impact_model import compute_volume_regime

# oldest → newest (240+ 거래일 권장)
trading_values = [8e12] * 200 + [1.2e13] * 44
regime = compute_volume_regime(trading_values)
print(regime.regime_label)   # elevated / hot
print(regime.weights.as_dict())  # quant, news, analyst
```

impact model 전체 조립:

```python
from agents.scenario_card.impact_model import (
    EventChannelInput,
    EventMeta,
    WebNewsFallback,
    build_impact_model,
    weights_from_activity,
)

weights = weights_from_activity(0.5)
channels = [
    EventChannelInput("e1", 5.0, 6.0, n_analog=3, channel_confidence=0.8),
    EventChannelInput("e2", 4.0, 5.0, n_analog=3, channel_confidence=0.8),
    EventChannelInput("e3", 3.0, 4.0, n_analog=3, channel_confidence=0.8),
]
meta = [
    EventMeta("e1", "8/4 전후", "수급·실적", "외국인 순매수 회복", "..."),
    EventMeta("e2", "8/11 전후", "빅테크·AI", "AI CapEx 유지", "..."),
    EventMeta("e3", "8/28 전후", "분기점", "20일선 회복", "..."),
]

result = build_impact_model(
    scenario_id="kospi-rebound",
    base_index=6023.66,
    tone="up",
    weights=weights,
    channel_inputs=channels,
    event_meta=meta,
)

print(result.forecast)           # KOSPI +9.3%
print(result.path)               # 12-point path
print(result.as_dict())          # impact-model JSON shape
```

Evidence 부족 시 Web fallback:

```python
result = build_impact_model(
    scenario_id="chip-miss",
    base_index=6023.66,
    tone="down",
    weights=weights,
    channel_inputs=[
        EventChannelInput("e1", -2.0, -3.0, n_analog=0, channel_confidence=0.2),
        EventChannelInput("e2", -2.5, -2.0, n_analog=0, channel_confidence=0.2),
        EventChannelInput("e3", -3.0, -2.5, n_analog=0, channel_confidence=0.2),
    ],
    event_meta=[
        EventMeta("e1", "8/4 전후", "실적", "실적 미스", "..."),
        EventMeta("e2", "8/11 전후", "AI", "CapEx 둔화", "..."),
        EventMeta("e3", "8/28 전후", "산업", "공급 경쟁", "..."),
    ],
    web_fallbacks={
        "e1": WebNewsFallback(I_web_direction_pct=-3.0, narrative_strength=0.7),
    },
)
assert result.events[0].news_fallback_used
```

### 테스트 파일

| 파일 | 범위 |
| --- | --- |
| [`tests/test_impact_model.py`](../../../tests/test_impact_model.py) | backfill, volume regime, path, web fallback |
