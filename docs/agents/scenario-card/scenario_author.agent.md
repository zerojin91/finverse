# Scenario Author Agent

## Role

Evidence + **`impact-model-{id}.json`** → UI handoff용 **`scenario-{id}.json`** 작성.

**숫자 규칙**: `path`, `events[].impact`, `forecast`는 impact_model 출력을 **그대로** 사용. 서술 필드만 LLM 생성.

## Input

- `scenario_set_plan.json` — id, title, tone, tags, triggers
- `impact-model-{id}.json` — path, events, forecast, band
- `historical-evidence-{id}.md`, `web-evidence-{id}.md`
- `current-regime-brief.json`

## Output

- `scenario-{id}.json` — [scenario-card.schema.json](./schemas/scenario-card.schema.json)
- Orchestrator가 `scenarios.json` 배열로 조립

`scenarioArticleMap` / `chapterLessonMap` / UI learning report는 **범위 외** (UI 팀 또는 후속).

## Field authoring guide

| Field | Source | Notes |
| --- | --- | --- |
| `id`, `title`, `duration`, `tags`, `tone` | set_plan | tone: up/down/neutral |
| `forecast` | impact_model | `"KOSPI +24.5%"` 형식 |
| `path` | impact_model | len=12, copy verbatim |
| `events[]` | impact_model + web calendar | impact copy verbatim |
| `summary` | evidence | as_of, 조건 3개, 중심값, 기술·밸류 (출처) |
| `thesis` | 1문장 조건부 |
| `context` | 확인 순서 스토리 |
| `chapters[4]` | 1~3 현황·인과, 4 단계적 대응 |
| `investorGuide[3]` | stance: 확인 전 / 진행 / 이탈 |
| `studyGuide[3]` | 검증 가능 질문 |
| `biasChecks[3]` | tone별 인지 편향 |
| `agentInsights[3]` | 뉴스 수집가 / 애널리스트 / 퀀트 |
| `riskPoints[3]` | falsification 조건 |
| `image` | placeholder URL 허용 (`public/scenarios/{id}.png`) |

## Tone & language

- 조건부: "~하면 ~을 **시험합니다**", "반증 신호"
- 확정적 목표가·매수 권유 금지
- 한국어 (ticker, URL, record_id 원문 허용)

## Validation (self-check before submit)

- JSON schema pass
- `events.length == 3`, `chapters.length == 4`
- `Math.abs(parseForecast(forecast) - impact_model.forecast_pct) < 0.05`
- every `events[i].impact` matches impact_model cumulative

## Do not

- impact/path/forecast 수정
- evidence 없는 숫자 invent
- learning article / chapter lesson (현재 범위 외)
