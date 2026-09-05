from __future__ import annotations

from services.paper_trading.agent_profiles import _specs
from services.paper_trading.participant_sizing import (
    group_targets_for_round, calibrate_participant_sizing,
)
from services.paper_trading.scenario_trading import apply_agent_round
from services.paper_trading.world_simulation import new_world_game


HISTORY = [
    {
        "trade_date": "2026-08-24", "open": 10000, "high": 10200,
        "low": 9900, "close": 10100, "volume": 100000,
        "trading_value": 1_000_000_000,
        "investor_flow_scope": "stock",
        "investor_flow": {"retail": -600_000_000, "foreign": 200_000_000,
                           "institution": 150_000_000, "pension": 50_000_000},
    },
    {
        "trade_date": "2026-08-25", "open": 10100, "high": 10300,
        "low": 10000, "close": 10200, "volume": 100000,
        "trading_value": 1_000_000_000,
        "investor_flow_scope": "stock",
        "investor_flow": {"retail": -600_000_000, "foreign": 200_000_000,
                           "institution": 150_000_000, "pension": 50_000_000},
    },
]


def test_historical_trading_value_becomes_group_notional_targets():
    sizing = calibrate_participant_sizing(HISTORY)
    targets = group_targets_for_round(sizing, 1)

    assert sizing["method"] == "historical_trading_value_with_flow_proxy"
    assert sizing["flow_coverage_days"] == 2
    assert targets["retail"] > targets["foreign"] > targets["pension"]
    assert sum(targets.values()) == 350_000_000


def test_world_orders_represent_group_scale_while_remaining_individual():
    context_id = "ctx_participant_sizing_test"
    profiles = _specs(context_id, 10200)
    for profile in profiles:
        profile["profile"] = {"memory_seed": "초기 근거"}
    game = new_world_game(
        "005930", "삼성전자", 10200, HISTORY,
        initial_context={"context_id": context_id, "analysis": {}, "source_summary": {}},
        agent_profiles={"context_id": context_id, "schema_version": "test", "profiles": profiles},
        simulation_days=10,
        world_history={"market_days": HISTORY, "social_signals": []},
    )
    decisions = [{
        "persona_id": persona["persona_id"], "action_type": "BUILD_POSITION",
        "side": "BUY", "allocation_pct": .01, "confidence": 80,
        "sentiment": .2, "rationale": "테스트 매수", "memory_note": "테스트",
    } for persona in game["personas"]]

    result = apply_agent_round(
        game, {"persona_decisions": decisions, "observations": [], "risk_flags": []},
        phase="inter_event", label="테스트", market_date="2026-08-26",
    )

    assert len(result["persona_orders"]) == 59
    assert all(order["decision_source"] == "llm" for order in result["persona_orders"])
    actual = result["group_notional_actuals"]
    targets = result["group_notional_targets"]
    for group in ("retail", "foreign", "institution", "pension"):
        # Whole-share rounding can leave less than one share per active agent.
        assert abs(actual[group]["buy"] - targets[group]) < 59 * game["current_price"]
    assert actual["retail"]["buy"] > actual["pension"]["buy"]
