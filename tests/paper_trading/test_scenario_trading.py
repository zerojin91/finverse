from services.paper_trading.scenario_trading import (
    _empirical_return, advance_inter_event_market, finish_event, new_scenario_game,
    public_scenario_game, reveal_and_react,
    submit_scenario_order,
)
from services.paper_trading.kospi_paper_trading import TradingError
import pytest


HISTORY = [
    {"trade_date": "2026-07-01", "close": 10000},
    {"trade_date": "2026-07-02", "close": 10100},
    {"trade_date": "2026-07-03", "close": 9900},
    {"trade_date": "2026-07-06", "close": 10200},
]


def _round(game, side="BUY"):
    return {"market_summary": "이벤트 반응", "observations": [], "risk_flags": [],
            "persona_decisions": [
                {"persona_id": persona["persona_id"], "side": side,
                 "allocation_pct": .01 if side != "HOLD" else 0,
                 "confidence": 70, "rationale": "시나리오 판단"}
            for persona in game["personas"]]}


def _advance(game, side="HOLD"):
    return advance_inter_event_market(
        game, lambda current, event, market_date, index, signals: _round(current, side))


def test_scenario_return_uses_robust_historical_quantiles_not_single_extreme():
    model = {"return_distribution_pct": [-30, -5, -2, 0, 1, 3, 6, 40]}
    assert round(_empirical_return(model, 1), 1) == 15.7
    assert round(_empirical_return(model, -1), 1) == -13.0
    assert _empirical_return(model, 0) == 0


def test_event_pre_and_post_decisions_with_autonomous_market_rounds():
    game = new_scenario_game(
        "005930", "삼성전자", 10200, HISTORY,
        [{"pre_brief": "실적 일정 예정", "title": "깜짝 실적",
          "description": "컨센서스 상회", "autonomous_rounds": 1}],
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1},
    )
    public = public_scenario_game(game)
    assert public["phase"] == "inter_event_market"
    assert "title" not in public["current_event"]
    _advance(game)
    submit_scenario_order(game, "BUY", 10, "이벤트 전 소규모 진입", 50)
    revealed = reveal_and_react(game, _round(game, "BUY"))
    assert revealed["event"]["title"] == "깜짝 실적"
    assert game["phase"] == "post_event_decision"
    assert game["current_price"] != 10200
    submit_scenario_order(game, "SELL", 5, "공개 후 일부 차익실현", 60)
    completed = finish_event(game)
    assert completed["status"] == "completed"
    assert game["position"]["quantity"] == 5
    assert len(game["price_history"]) == 3


def test_inter_event_days_release_signals_without_allowing_user_orders():
    game = new_scenario_game(
        "005930", "삼성전자", 10200, HISTORY,
        [{"pre_brief": "결과 미정인 발표 일정", "title": "비밀 호재 결과",
          "description": "공개 전에는 절대 보이면 안 되는 확정 결과",
          "trading_days_until": 3,
          "lead_signals": [{"days_before": 2, "channel": "rumor", "audience": "retail",
                            "reliability": .4, "content": "확인되지 않은 기대가 확산 중"}]}],
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1})
    with pytest.raises(TradingError):
        submit_scenario_order(game, "BUY", 1)
    seen = []
    advance_inter_event_market(
        game, lambda current, event, market_date, index, signals:
        (seen.append((market_date, [row["content"] for row in signals])) or _round(current, "HOLD")))
    assert game["phase"] == "pre_event_decision"
    assert len(seen) == 3
    assert seen[0][1] == []
    assert seen[1][1] == ["확인되지 않은 기대가 확산 중"]
    assert all(row["market_date"] for row in game["agent_rounds"])


def test_persistent_psychology_is_reinforced_then_reversed_by_next_event():
    events = [
        {"pre_brief": "호재 일정", "title": "강한 호재", "description": "긍정 결과",
         "trading_days_until": 1, "direction": 1, "severity": .9,
         "surprise": .9, "persistence_days": 5},
        {"pre_brief": "악재 일정", "title": "강한 악재", "description": "부정 결과",
         "trading_days_until": 1, "direction": -1, "severity": 1,
         "surprise": 1, "persistence_days": 5},
    ]
    game = new_scenario_game(
        "005930", "삼성전자", 10200, HISTORY, events,
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1})
    _advance(game, "HOLD")
    first = reveal_and_react(game, _round(game, "BUY"))["reaction"]
    positive = game["market_psychology"]["aggregate_sentiment"]
    first_intensity = first["psychology"]["event_regime"]["intensity"]
    assert positive > 0
    assert first["psychology"]["event_regime"]["days_remaining"] == 5
    finish_event(game)
    _advance(game, "HOLD")
    carried = game["market_psychology"]["aggregate_sentiment"]
    assert carried > 0
    assert game["market_psychology"]["event_regime"]["intensity"] < first_intensity
    second = reveal_and_react(game, _round(game, "SELL"))["reaction"]
    assert game["market_psychology"]["aggregate_sentiment"] < 0
    assert second["psychology"]["event_impulse"] < 0


def test_sell_pressure_no_longer_maps_to_positive_historical_median_drift():
    game = new_scenario_game(
        "005930", "삼성전자", 10200, HISTORY,
        [{"pre_brief": "일정", "title": "발표", "description": "중립",
          "trading_days_until": 1}],
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1})
    _advance(game, "SELL")
    result = game["agent_rounds"][-1]
    assert result["market_pressure"] < 0
    assert result["target_return_pct"] < 0
    assert result["return_components_pct"]["persistent_sentiment"] < 0


def test_five_event_scenario_completes_all_reaction_and_gap_rounds():
    events = [{"pre_brief": f"일정 {index}", "title": f"이벤트 {index}",
               "description": f"내용 {index}", "autonomous_rounds": 1}
              for index in range(1, 6)]
    game = new_scenario_game(
        "005930", "삼성전자", 10200, HISTORY, events,
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1})
    for _ in events:
        _advance(game)
        reveal_and_react(game, _round(game, "BUY"))
        finish_event(game)
    assert game["status"] == "completed"
    assert game["phase"] == "completed"
    assert game["current_event_index"] == 5
    assert len(game["agent_rounds"]) == 10
    assert len(game["decision_log"]) == 10
    assert len(game["price_history"]) == 11
