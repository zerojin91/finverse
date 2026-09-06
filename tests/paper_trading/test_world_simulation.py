from __future__ import annotations

from services.paper_trading.agent_profiles import _specs
from services.paper_trading import world_agent, world_simulation


HISTORY = [
    {"trade_date": "2026-08-24", "open": 10000, "high": 10200, "low": 9900, "close": 10100, "volume": 1000,
     "events": [{"title": "실적 전망 상향", "summary": "수요 기대가 높아짐", "scope": "micro", "source_score": 8}]},
    {"trade_date": "2026-08-25", "open": 10100, "high": 10300, "low": 10000, "close": 10200, "volume": 1200},
    {"trade_date": "2026-08-26", "open": 10200, "high": 10250, "low": 9900, "close": 10000, "volume": 1300},
    {"trade_date": "2026-08-27", "open": 10000, "high": 10100, "low": 9800, "close": 9900, "volume": 1400},
]


def _context() -> dict:
    return {
        "context_id": "ctx_abcdef1234567890",
        "analysis": {"summary_points": ["초기 시장 관측"], "tensions": ["수요와 금리"],
                     "economy": {"condition": "혼조"}},
        "source_summary": {"as_of": {"latest_market_date": "2026-08-27"}},
    }


def _profiles() -> dict:
    profiles = _specs(_context()["context_id"], 9900)
    for row in profiles:
        row["profile"] = {"memory_seed": "초기 실제 관측만 기억한다."}
    return {"context_id": _context()["context_id"], "schema_version": "test", "counts": {}, "profiles": profiles}


def _hold_round(game, **_kwargs):
    decisions = [{"persona_id": person["persona_id"], "action_type": "HOLD", "side": "HOLD",
                  "allocation_pct": 0, "confidence": 0, "sentiment": 0,
                  "rationale": "테스트 관망", "memory_note": "테스트 메모"}
                 for person in game["personas"]]
    return {"market_summary": "테스트 공개 환경", "risk_flags": [], "observations": [], "persona_decisions": decisions}


def _game():
    return world_simulation.new_world_game(
        "005930", "삼성전자", 9900, HISTORY, initial_context=_context(),
        agent_profiles=_profiles(), simulation_days=10,
        world_history={"market_days": HISTORY, "social_signals": []},
    )


def test_world_day_updates_only_after_independent_agent_round(monkeypatch):
    monkeypatch.setattr(world_simulation, "run_individual_agent_round", _hold_round)
    monkeypatch.setattr(world_agent, "_event_type", lambda *_args: None)
    game = _game()

    result = world_simulation.advance_world_market(game)

    assert result["awaiting_user"] is False
    assert game["phase"] == world_simulation.PHASE_WORLD_MARKET
    assert game["current_day_index"] == 1
    assert len(game["agent_rounds"]) == 1
    assert len(game["world"]["memory"]["daily_ledger"]) == 1
    assert all(len(person["memory"]) == 2 for person in game["personas"])


def test_daily_buy_reflection_is_filled_when_next_day_advances(monkeypatch):
    monkeypatch.setattr(world_simulation, "run_individual_agent_round", _hold_round)
    monkeypatch.setattr(world_agent, "_event_type", lambda *_args: None)
    game = _game()

    world_simulation.advance_world_market(game)
    world_simulation.record_world_daily_reflection(game, "BUY_WATCH", 30)
    starting_cash = game["cash"]

    world_simulation.advance_world_market(game)

    assert game["position"]["quantity"] == 30
    assert game["cash"] < starting_cash
    assert game["fills"][-1]["side"] == "BUY"
    assert game["fills"][-1]["quantity"] == 30


def test_default_daily_reflection_does_not_queue_or_fill_an_order(monkeypatch):
    monkeypatch.setattr(world_simulation, "run_individual_agent_round", _hold_round)
    monkeypatch.setattr(world_agent, "_event_type", lambda *_args: None)
    game = _game()

    world_simulation.advance_world_market(game)

    assert game["daily_reflections"][-1]["stance"] == "HOLD_WATCH"
    assert game["daily_reflections"][-1].get("order_id") is None
    assert game["pending_orders"] == []

    world_simulation.advance_world_market(game)

    assert game["position"]["quantity"] == 0
    assert game["fills"] == []


def test_material_world_event_shows_market_round_before_user_decision(monkeypatch):
    monkeypatch.setattr(world_simulation, "run_individual_agent_round", _hold_round)
    monkeypatch.setattr(world_agent, "_event_type", lambda *_args: "surprise")
    monkeypatch.setattr(
        world_agent, "_generate_event",
        lambda event_type, analogue, world, market_date: {
            **world_agent._fallback_event(event_type, analogue, world, market_date),
            "generation_source": "test",
        },
    )
    game = _game()

    waiting = world_simulation.advance_world_market(game)
    assert waiting["awaiting_user"] is True
    assert game["phase"] == world_simulation.PHASE_WORLD_DECISION
    assert game["world"]["active_event"]["is_simulated"] is True
    assert game["world"]["active_event"]["analogue_event_ids"]
    assert len(game["agent_rounds"]) == 1
    assert len(game["price_history"]) == 2
    assert game["agent_rounds"][-1]["market_date"] == game["world"]["active_event"]["event_date"]
    assert game["revealed_events"][-1]["event_id"] == game["world"]["active_event"]["event_id"]

    world_simulation.record_world_daily_reflection(game, "BUY_WATCH", 1)
    resolved = world_simulation.resolve_world_decision(game)
    assert resolved["completed"] is False
    assert game["phase"] == world_simulation.PHASE_WORLD_MARKET
    assert game["world"]["active_event"] is None
    assert len(game["revealed_events"]) == 1
    assert len(game["user_decision_memory"]) == 1
    assert len(game["agent_rounds"]) == 1
    assert game["fills"] == []
    assert game["pending_orders"][0]["event_id"]
