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
