import copy
import pytest

from services.paper_trading.kospi_paper_trading import (
    TradingError, advance_one_day, calibrate_impact_model, inject_scenario_event, krx_tick_size,
    new_game, public_game, round_to_krx_tick,
    set_social_signals, submit_order,
)
from services.paper_trading.investor_behavior_analyzer import analyze_investor


def market_days():
    return [
        {"trade_date": "2026-08-20", "open": 70000, "high": 72000, "low": 69500,
         "close": 71500, "volume": 10_000_000, "trading_value": 710_000_000_000,
         "price_source": "krx_open_api", "investor_flow_scope": "kospi_market_fallback",
         "investor_flow": {"retail": -20_000_000_000, "foreign": 15_000_000_000,
                           "institution": 4_000_000_000, "pension": 1_000_000_000},
         "events": [{"title": "실적 상향", "impact": 0.4}]},
        {"trade_date": "2026-08-21", "open": 71800, "high": 72500, "low": 70500,
         "close": 71000, "volume": 9_000_000, "trading_value": 640_000_000_000,
         "investor_flow": {"retail": 10_000_000_000, "foreign": -8_000_000_000,
                           "institution": -2_000_000_000, "pension": 500_000_000}},
    ]


def test_impact_model_is_calibrated_from_pre_game_returns_without_fixed_cap():
    model = calibrate_impact_model([
        {"trade_date": "2026-08-17", "close": 10000},
        {"trade_date": "2026-08-18", "close": 10200},
        {"trade_date": "2026-08-19", "close": 9894},
    ])
    assert model["method"] == "historical_rms_x_order_imbalance"
    assert model["sample_days"] == 3
    assert model["daily_rms_pct"] > 0
    assert model["absolute_return_p90_pct"] == 3.0


def test_krx_tick_size_and_rounding_follow_price_bands():
    assert krx_tick_size(49_999) == 50
    assert krx_tick_size(70_000) == 100
    assert krx_tick_size(257_000) == 500
    assert krx_tick_size(500_000) == 1_000
    assert round_to_krx_tick(256_635) == 256_500
    assert round_to_krx_tick(199_950) == 200_000


def test_buy_sell_and_daily_advance_are_accounted_in_integer_krw():
    game = new_game("005930", "삼성전자", market_days(), previous_close=69000, persona_counts={
        "retail": 2, "foreign": 1, "institution": 1, "pension": 1,
    })
    submit_order(game, "BUY", 100)
    first = advance_one_day(game)

    buy_fill = first["user_fills"][0]
    assert buy_fill["price"] == 70000
    assert game["position"]["quantity"] == 100
    assert game["cash"] == 100_000_000 - buy_fill["gross_amount"] - buy_fill["fee"]
    assert set(first["persona_groups"]) == {"retail", "foreign", "institution", "pension"}
    assert game["market_days"][0]["price_source"] == "krx_open_api"
    assert first["released_investor_flow_scope"] == "kospi_market_fallback"
    assert all({"cash", "quantity", "average_price", "realized_pnl"} <= set(persona)
               for persona in game["personas"])
    assert all(persona["cash"] >= 0 and persona["quantity"] >= 0 for persona in game["personas"])

    submit_order(game, "SELL", 40)
    second = advance_one_day(game)
    assert second["user_fills"][0]["tax"] > 0
    assert game["position"]["quantity"] == 60
    assert game["status"] == "completed"


def test_rejects_overselling_and_insufficient_cash_without_corrupting_ledger():
    game = new_game("005930", "삼성전자", market_days(), previous_close=69000, initial_cash=100_000)
    with pytest.raises(TradingError):
        submit_order(game, "SELL", 1)
    submit_order(game, "BUY", 100)
    result = advance_one_day(game)
    assert result["user_fills"] == []
    assert game["cash"] == 100_000
    assert game["position"]["quantity"] == 0
    assert game["fills"] == []


def test_persona_decisions_are_reproducible_for_same_game_and_day():
    game = new_game("005930", "삼성전자", market_days(), previous_close=69000)
    clone = copy.deepcopy(game)
    assert advance_one_day(game)["persona_orders"] == advance_one_day(clone)["persona_orders"]


def test_market_days_must_be_ordered_and_valid_ohlc():
    invalid = market_days()
    invalid[0] = {**invalid[0], "low": 73000}
    with pytest.raises(TradingError):
        new_game("005930", "삼성전자", invalid, previous_close=69000)


def test_reddit_and_x_sentiment_is_attached_to_market_personas_and_orders():
    game = new_game("005930", "삼성전자", market_days(), previous_close=69000, persona_counts={
        "retail": 5, "foreign": 3, "institution": 3, "pension": 2,
    })
    assert any(persona["platforms"] for persona in game["personas"])
    summary = set_social_signals(game, "2026-08-20", [
        {"investor_group": "retail", "platform": "reddit", "sentiment": .8, "engagement": 100},
        {"investor_group": "foreign", "platform": "x", "sentiment": -.5, "engagement": 40},
    ])
    assert summary["retail"]["sentiment"] == .8
    result = advance_one_day(game)
    social_orders = [order for order in result["persona_orders"] if order["platforms"]]
    assert any(order["social_sentiment"] != 0 for order in social_orders)


def test_investor_assessment_returns_explainable_education():
    game = new_game("005930", "삼성전자", market_days(), previous_close=69000)
    submit_order(game, "BUY", 100)
    advance_one_day(game)
    submit_order(game, "SELL", 40)
    advance_one_day(game)
    report = analyze_investor(game)
    assert 0 <= report["risk_score"] <= 100
    assert report["style"]
    assert report["lessons"]
    assert "교육용" in report["disclaimer"]


def test_pre_open_snapshot_hides_same_day_market_outcomes():
    game = new_game("005930", "삼성전자", market_days(), previous_close=69000)
    snapshot = public_game(game)["current_day"]
    assert snapshot["previous_close"] == 69000
    assert snapshot["information_phase"] == "pre_open"
    assert not ({"open", "high", "low", "close", "volume", "trading_value", "investor_flow"} & set(snapshot))


def test_persona_decisions_do_not_use_same_day_close_or_investor_flow():
    game = new_game("005930", "삼성전자", market_days(), previous_close=69000)
    altered = copy.deepcopy(game)
    altered["market_days"][0].update({"close": 70000, "high": 72000, "low": 69000,
                                      "investor_flow": {"retail": 999_000_000_000}})
    first = advance_one_day(game)["persona_orders"]
    second = advance_one_day(altered)["persona_orders"]
    fields = lambda rows: [(row["persona_id"], row["side"], row["quantity"], row["score"])
                           for row in rows]
    assert fields(first) == fields(second)


def test_scenario_event_respects_reveal_phase():
    game = new_game("005930", "삼성전자", market_days(), previous_close=69000)
    visible = inject_scenario_event(game, "2026-08-20", "장전 실적 상향", .6, "pre_open")
    hidden = inject_scenario_event(game, "2026-08-20", "장후 공시", -.4, "after_close")
    snapshot = public_game(game)["current_day"]
    assert visible in snapshot["events"]
    assert hidden not in snapshot["events"]
    result = advance_one_day(game)
    assert hidden in result["events"]
