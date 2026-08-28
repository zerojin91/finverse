from services.paper_trading.ontology import (build_coverage_report, build_market_snapshot,
                          load_market_ontology, preflight_simulation,
                          standardize_market_context)


def _game_data():
    return {
        "ticker": "5930",
        "name": "삼성전자",
        "market": "KOSPI",
        "market_days": [{
            "trade_date": "2026-08-03", "open": 100, "high": 110,
            "low": 90, "close": 105, "volume": 1000, "trading_value": 105000,
            "market_cap": 1000000, "listed_shares": 10000,
            "price_source": "test", "investor_flow": {"foreign": 5000},
            "investor_flow_scope": "stock", "events": []
        }],
        "foreign_holdings": [{"trade_date": "2026-08-03", "held_shares": 3000, "held_pct": 30}],
        "indices": [{"trade_date": "2026-08-03", "index_id": "krx:코스피", "name": "코스피", "close": 2500, "change_pct": 1.2, "quality_status": "verified"}],
        "macro_observations": [{"trade_date": "2026-08-03", "series_code": "USD_KRW", "value": 1300, "unit": "KRW"}],
        "social_signals": [{"trade_date": "2026-08-03", "platform": "youtube_aggregate", "post_count": 10, "sentiment": 0.2, "engagement": 20}],
    }


def test_market_ontology_contract_is_valid():
    ontology = load_market_ontology()
    assert ontology["ontology_id"] == "finsimulation.market"
    assert any(entity["name"] == "Bond" for entity in ontology.get("entities", [])) is False
    assert ontology["asset_support"]["bond"]["status"] == "not_found_in_current_catalog"


def test_snapshot_and_coverage_include_connected_inputs():
    snapshot = build_market_snapshot(_game_data())
    assert snapshot["security"]["security_id"] == "krx:005930"
    assert len(snapshot["prices"]) == 1
    assert len(snapshot["investor_flows"]) == 1
    assert len(snapshot["foreign_holdings"]) == 1
    assert len(snapshot["index_observations"]) == 1
    assert len(snapshot["macro_observations"]) == 1
    assert len(snapshot["social_signals"]) == 1
    report = build_coverage_report(snapshot)
    assert report["ready_for_simulation"] is True
    assert report["checks"]["investor_flow"] == "stock"


def test_context_standardization_is_bounded_and_point_in_time():
    snapshot = build_market_snapshot(_game_data())
    snapshot["index_observations"][0]["name"] = "코스피"
    signal = standardize_market_context(snapshot, "2026-08-03")
    assert signal["availability"]["benchmark"] is True
    assert signal["availability"]["foreign_holding"] is True
    assert -1 <= signal["macro_change_signal"] <= 1
    assert -2 <= signal["price_return_contribution_pct"] <= 8


def test_preflight_rejects_duplicate_price_dates():
    snapshot = build_market_snapshot(_game_data())
    snapshot["prices"].append(dict(snapshot["prices"][0]))
    check = preflight_simulation(snapshot)
    assert check["ready"] is False
    assert any("unique" in error for error in check["errors"])
