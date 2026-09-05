import json

from services.paper_trading.llm_scenario_simulator import _round_context, run_individual_agent_round
from services.paper_trading.scenario_trading import new_scenario_game


def test_inter_event_llm_context_does_not_leak_hidden_outcome():
    history = [{"trade_date": "2026-08-20", "close": 10000},
               {"trade_date": "2026-08-21", "close": 10100}]
    game = new_scenario_game(
        "005930", "삼성전자", 10100, history,
        [{"pre_brief": "중요 발표 예정", "title": "숨겨진 확정 제목",
          "description": "숨겨진 확정 결과", "trading_days_until": 2}],
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1})
    event = game["events"][0]
    context = _round_context(game, event, "inter_event", 1, "2026-08-24", [])
    serialized = json.dumps(context, ensure_ascii=False)
    assert "숨겨진 확정 제목" not in serialized
    assert "숨겨진 확정 결과" not in serialized
    assert context["upcoming_event"]["pre_brief"] == "중요 발표 예정"
    revealed = _round_context(game, event, "event_reaction", 1)
    assert revealed["event"]["description"] == "숨겨진 확정 결과"


def test_individual_agent_round_keeps_each_prompt_private():
    history = [{"trade_date": "2026-08-20", "close": 10000},
               {"trade_date": "2026-08-21", "close": 10100}]
    game = new_scenario_game(
        "005930", "삼성전자", 10100, history,
        [{"pre_brief": "일정", "title": "결과", "description": "내용", "trading_days_until": 1}],
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1})
    prompts: list[str] = []

    def chat(messages, **_kwargs):
        content = messages[-1]["content"]
        prompts.append(content)
        return json.dumps({"action_type": "HOLD", "side": "HOLD", "allocation_pct": 0,
                           "confidence": 50, "sentiment": 0, "rationale": "독립 관망",
                           "memory_note": "테스트"})

    result = run_individual_agent_round(
        game, market_date="2026-08-24",
        world_information={"market_date": "2026-08-24", "world_state": {}, "event": None},
        chat=chat)

    persona_ids = [persona["persona_id"] for persona in game["personas"]]
    assert len(result["persona_decisions"]) == len(persona_ids) == 4
    assert all(row["action_type"] == "HOLD" for row in result["persona_decisions"])
    for prompt in prompts:
        included = [persona_id for persona_id in persona_ids if persona_id in prompt]
        assert len(included) == 1
        assert all(other not in prompt for other in persona_ids if other != included[0])
