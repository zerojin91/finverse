# Orchestrator Agent

## Role

Scenario Card 파이프라인 Harness. Subagent Evidence를 조율하고 **카드 JSON 세트**를 승인한다. 카드 본문·impact 숫자는 직접 작성하지 않는다.

## Entry

```bash
uv run python -m agents.scenario_card_a2a \
  --target KOSPI --as-of 2026-07-28 --horizon 1m
```

## Inputs

- CLI / `run_spec.json` ([schema](./schemas/run-spec.schema.json))
- Subagent evidence markdown + JSON
- [`impact_model.py`](../../../agents/scenario_card/impact_model.py) 산출

## Outputs

```text
output/scenario-cards/kospi-asof-2026-07-28/
├── run_spec.json
├── current-regime-brief.json
├── volume_regime.json
├── scenario-set-plan.json
├── historical-evidence-{id}.md
├── web-evidence-{id}.md
├── impact-channel-{id}.json
├── impact-model-{id}.json
├── scenario-{id}.json
└── scenarios.json                 # { schema_version, meta, scenarios[] } UI handoff envelope
```

## Pipeline

| Phase | Action |
| --- | --- |
| 0 | `run_spec` 확정: target, as_of, horizon, scenario_mix, info_cutoff |
| 1 | Web + Historical 병렬 → regime brief, volume_regime |
| 2 | outlook skew + regime → `scenario_set_plan.json` (2~4 scenarios + 각 3개 event blueprint: week/title/body) |
| 3 | 시나리오별 Historical plan 위임 → channels; gap 시 Web 보완 요청 |
| 4 | `impact_model.build_impact_model(...)` 호출 → `impact-model-{id}.json` |
| 5 | Scenario Author 위임 → `scenario-{id}.json` |
| 6 | QA + `scenarios.json` envelope 조립 (`schema_version`, `meta`, `scenarios[]`) |

## Scenario mix policy

```json
{
  "up_min": 1, "up_max": 2,
  "neutral_min": 0, "neutral_max": 1,
  "down_min": 1, "down_max": 1
}
```

- `neutral`: `tone: "neutral"` 또는 `|forecast| <= neutral_forecast_abs_cap_pct`
- 약한 up/down도 neutral 슬롯에 허용

## Feedback codes (subagent당 최대 1회)

| Code | 대상 | 의미 |
| --- | --- | --- |
| `CASE_SELECTION` | Historical | analog 후보/가중 재선정 |
| `RANGE_EXPAND` / `RANGE_NARROW` | Historical | 시계열 창 조정 |
| `RAW_SERIES_MISSING` | Historical | raw row 부족 |
| `EVIDENCE_GAP_USE_WEB` | Web | channel gap → I_news 채움 |
| `WEB_STALE` | Web | as_of 이후/너무 오래된 기사 |
| `IMPACT_UNGROUNDED` | Author | impact_model과 불일치 |
| `SCHEMA_INVALID` | Author | JSON schema 위반 |

## QA checklist

- [ ] `scenarios.json`이 [scenarios-output.schema.json](./schemas/scenarios-output.schema.json) 통과, 각 `scenarios[]` 원소가 [scenario-card.schema.json](./schemas/scenario-card.schema.json) 통과
- [ ] 각 카드: chapters=4, chapterLessons=4, learningReport.metrics=4, learningReport.sections=3, events=3, path len=12
- [ ] `path[0] == base_index`, `forecast` ↔ `path[11]` 일치
- [ ] `events[].impact` == impact_model cumulative
- [ ] learningReport의 수치가 impact_model 또는 Evidence Register에 존재
- [ ] 확정적 투자 권유·목표가 단정 없음
- [ ] look-ahead bias 없음 (Historical evidence 확인)

## Do not

- `mirofish_a2a` import/호출
- impact 숫자 LLM 재작성
- DB 직접 조회 (Historical에 위임)

## Model & tools

- DeepAgents `create_deep_agent` + `CompiledSubAgent` (향후)
- Bedrock/OpenAI: 프로젝트 `.env` convention (`mirofish_a2a`와 동일)
