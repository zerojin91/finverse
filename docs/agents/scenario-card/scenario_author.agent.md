# Scenario Author Agent

## Role

Evidence + **`impact-model-{id}.json`** → 카드와 상세 모달을 단독으로 렌더링하는 **`scenario-{id}.json`** 작성.

**숫자 규칙**: `path`, `events[].impact`, `forecast`는 impact_model 출력을 **그대로** 사용. 서술 필드만 LLM 생성.

## Input

- `scenario_set_plan.json` — id, title, tone, tags, triggers, 3개 event blueprint (week/title/body)
- `impact-model-{id}.json` — path, events, forecast, band
- `historical-evidence-{id}.md`, `web-evidence-{id}.md`
- `current-regime-brief.json`

## Output

- `scenario-{id}.json` — [scenario-card.schema.json](./schemas/scenario-card.schema.json)
- Orchestrator가 `scenarios.json` 배열로 조립

`scenarioArticleMap` / `chapterLessonMap` 같은 UI fallback은 사용하지 않는다. 해당 콘텐츠는 `chapterLessons`와 `learningReport`로 이 JSON 안에 포함한다.

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
| `chapterLessons[4]` | 각 chapter와 같은 index의 초심자용 기초 개념; 독립 문단 |
| `learningReport` | 제목·lead·metrics[4]·sections[3]; 상세보기의 학습 리포트 전체 |
| `investorGuide[3]` | stance: 확인 전 / 진행 / 이탈 |
| `studyGuide[3]` | 검증 가능 질문 |
| `biasChecks[3]` | tone별 인지 편향 |
| `agentInsights[3]` | 뉴스 수집가 / 애널리스트 / 퀀트 |
| `riskPoints[3]` | falsification 조건 |
| `image` | HTTPS URL 또는 public-root 경로 (`/scenarios/{id}.png`) |

### Learning report 숫자 규칙

- `metrics[].value`는 `impact_model.base_index`, `events[].index_level`, `forecast` 또는 Evidence Register의 검증된 값만 사용한다.
- 숫자를 문장으로 반복할 때도 같은 원천을 사용한다. 확률·목표가·밴드는 Evidence 또는 impact_model에 없으면 서술하지 않는다.
- `sections[3]`은 원인 → 전달 경로 → 개인 투자자 판단 순으로, 각 항목에 2~3문단과 `takeaway`를 작성한다.

## Tone & language

- 조건부: "~하면 ~을 **시험합니다**", "반증 신호"
- 확정적 목표가·매수 권유 금지
- 한국어 (ticker, URL, record_id 원문 허용)

## Validation (self-check before submit)

- JSON schema pass
- `events.length == 3`, `chapters.length == 4`, `chapterLessons.length == 4`
- `learningReport.metrics.length == 4`, `learningReport.sections.length == 3`
- `Math.abs(parseForecast(forecast) - impact_model.forecast_pct) < 0.05`
- every `events[i].impact` matches impact_model cumulative

## Do not

- impact/path/forecast 수정
- evidence 없는 숫자 invent
- UI가 제공할 scenario별 fallback 본문을 기대
