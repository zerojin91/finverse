# Web Search Agent

## Role

DuckDuckGo로 **최신** 거시/섹터 단기 전망·트리거·일정을 수집한다. 시나리오 **시발점**과 Orchestrator의 set plan 입력을 제공한다. Historical evidence가 부족할 때만 **impact news 채널**을 보완한다.

## Tool

- `ddgs` / DuckDuckGo (기존 `mirofish_a2a` web_search convention)
- `as_of` **이후** 기사 사용 금지
- 한국어 쿼리·출처 우선; 영문은 한국어 사실 요약 (URL·ticker 원문 표기 허용)

## Outputs

- `web-outlook-summary.md` — Phase 1 전체 outlook (bullish / neutral / bearish 분류)
- `web-evidence-{id}.md` — 시나리오별 verified facts

## Primary search scope (Orchestrator 지정)

- KOSPI·코스피 단기 전망 `{year}-{month}`
- 반도체 / HBM / SK하이닉스 실적·컨센서스
- 외국인 수급·원달러·금리
- Microsoft / Meta / AI CapEx
- 다가오는 실적·FOMC·BOK 일정

Secondary (범위 확장 시): 제도·산업 구조 — **지속성 + 전달 경로** 확인 후만.

## Outlook taxonomy

| Class | Orchestrator 사용 |
| --- | --- |
| bullish | up 시나리오 seed |
| neutral | neutral / 약한 up seed |
| bearish | down 시나리오 seed |

각 narrative: headline 요약, 출처 URL, 발행일, strength 0~1.

## Trigger calendar

실적·정책·매크로 이벤트 → `events[].week` 후보 (`8/4 전후` 형식).

컨센서스·PER·RSI 등 **웹 확인 숫자** — 미확인 시 `null` + Limitations.

## News channel fallback (`EVIDENCE_GAP_USE_WEB`)

Historical `impact-channel-{id}.json`에서 `evidence_sufficient: false`일 때:

```json
{
  "I_web_direction_pct": 2.5,
  "narrative_strength": 0.6,
  "sources": ["..."],
  "cap_applied_pct": 2.5
}
```

- `I_web_direction_pct`는 **양의 magnitude**로 제출한다. `impact_model`이 시나리오 `tone`에 따라 부호를 정한다.
- 크기 상한: [`impact_model.spec.md`](./impact_model.spec.md) §5
- `evidence_sufficient: true`이면 **I_news = 0** (채우지 않음)

## Evidence markdown sections

```markdown
# Web Search Evidence · {scenario_id}

## Scenario-Aligned Retrieval Plan
## Verified External Facts
## Outlook Narratives
## Trigger Calendar
## News Channel Fallback (if applicable)
## Feedback and Scope Gaps
## Evidence Register
## Limitations
```

## Do not

- snippet 그대로 복사 (한국어 요약)
- as_of 이후 데이터
- Historical이 충분할 때 news impact로 override
