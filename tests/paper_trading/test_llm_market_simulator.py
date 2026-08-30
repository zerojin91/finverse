import json

from services.paper_trading.kospi_paper_trading import advance_one_day, new_game
from services.paper_trading.llm_market_simulator import run_llm_market_round


DAY = {
    "trade_date": "2026-08-20", "open": 70_000, "high": 72_000,
    "low": 69_500, "close": 71_500, "volume": 10_000_000,
    "trading_value": 710_000_000_000,
    "events": [{"title": "장전 실적 상향", "impact": .4,
                "available_before_open": True}],
}


def llm_payload(persona_ids):
    observations = []
    for group in ("retail", "foreign", "institution", "pension"):
        for platform in ("reddit", "x"):
            observations.append({
                "investor_group": group, "platform": platform,
                "sentiment": .4, "engagement": 100,
                "content": f"{group} {platform} 장전 반응",
                "rationale": "공개된 실적 상향 이벤트",
            })
    decisions = [{"persona_id": persona_id, "side": "BUY", "allocation_pct": .01,
                  "confidence": 70, "rationale": "장전 실적 상향"}
                 for persona_id in persona_ids]
    return {"market_summary": "장전 심리가 우호적이다.",
            "risk_flags": ["기대가 이미 반영됐을 수 있다."],
            "observations": observations, "persona_decisions": decisions}


def test_llm_round_generates_eight_social_posts_before_deterministic_advance():
    game = new_game("005930", "삼성전자", [DAY], previous_close=69_000,
                    impact_history=[
                        {"trade_date": "2026-08-17", "close": 68_000},
                        {"trade_date": "2026-08-18", "close": 69_000},
                        {"trade_date": "2026-08-19", "close": 68_500},
                    ],
                    persona_counts={"retail": 2, "foreign": 2,
                                    "institution": 2, "pension": 2},
                    llm_enabled=True)
    captured = {}

    def fake_chat(messages, **kwargs):
        captured["messages"] = messages
        captured["kwargs"] = kwargs
        return json.dumps(llm_payload([p["persona_id"] for p in game["personas"]]), ensure_ascii=False)

    round_data = run_llm_market_round(game, fake_chat)
    assert len(round_data["observations"]) == 8
    assert round_data["information_phase"] == "pre_open"
    assert set(round_data["aggregated_signals"]) == {
        "retail", "foreign", "institution", "pension"}
    assert "71500" not in captured["messages"][1]["content"]
    result = advance_one_day(game)
    assert all(value["mentions"] == 2 for value in result["social_signals"].values())
    assert all(order["decision_source"] == "llm" for order in result["persona_orders"])
    assert game["status"] == "completed"


def test_missing_orders_trigger_dedicated_llm_order_retry():
    game = new_game("005930", "삼성전자", [DAY], previous_close=69_000,
                    persona_counts={"retail": 1, "foreign": 1,
                                    "institution": 1, "pension": 1},
                    llm_enabled=True)
    payload = llm_payload([persona["persona_id"] for persona in game["personas"]])
    calls = []

    def fake_chat(messages, **kwargs):
        calls.append(messages)
        if len(calls) == 1:
            return json.dumps({key: value for key, value in payload.items()
                               if key != "persona_decisions"}, ensure_ascii=False)
        return json.dumps({"persona_decisions": payload["persona_decisions"]}, ensure_ascii=False)

    result = run_llm_market_round(game, fake_chat)
    assert len(calls) == 2
    assert len(result["persona_decisions"]) == 4
