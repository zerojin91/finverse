import json

from services.paper_trading.llm_scenario_report import enforce_verified_report_metrics, generate_llm_reports, generate_llm_scenario_report
from services.paper_trading.scenario_trading import advance_inter_event_market, finish_event, new_scenario_game, reveal_and_react


def test_completed_scenario_generates_structured_llm_report():
    history = [{"trade_date": "2026-08-01", "close": 10000},
               {"trade_date": "2026-08-02", "close": 10100}]
    game = new_scenario_game(
        "005930", "삼성전자", 10100, history,
        [{"pre_brief": "일정", "title": "발표", "description": "내용",
          "autonomous_rounds": 0}],
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1})
    round_data = {"market_summary": "반응", "observations": [], "risk_flags": [],
                  "persona_decisions": [{"persona_id": persona["persona_id"],
                    "side": "HOLD", "allocation_pct": 0, "confidence": 50,
                    "rationale": "관망"} for persona in game["personas"]]}
    advance_inter_event_market(
        game, lambda current, event, market_date, index, signals: round_data)
    reveal_and_react(game, round_data)
    finish_event(game, [])
    payload = {"executive_summary": "요약", "investor_profile": "관찰형",
               "event_reviews": [{"event": "발표", "market_reaction": "중립",
                                  "user_decision": "관망", "lesson": "근거 기록"}],
               "strengths": ["과도한 거래 없음"], "risk_patterns": [],
               "action_plan": ["판단 근거 기록"]}
    report = generate_llm_scenario_report(
        game, lambda messages, **kwargs: json.dumps(payload, ensure_ascii=False))
    assert report["executive_summary"] == "요약"
    assert report["event_reviews"][0]["event"] == "발표"
    assert report["verified_metrics"]["total_return_pct"] == 0
    assert "검증된 총 수익률" in report["quantitative_summary"]


def test_report_corrects_100x_total_return_narration_and_keeps_raw_text():
    report = {"executive_summary": "총 13.11%의 수익을 달성했습니다."}
    metrics = {"total_return_pct": .1311, "max_price_drawdown_pct": -.7477,
               "trade_count": 4}
    corrected = enforce_verified_report_metrics(report, metrics)
    assert "0.1311%" in corrected["executive_summary"]
    assert "13.11%" in corrected["raw_executive_summary"]
    assert corrected["metric_corrections"][0]["reason"] == "100x_percentage_scale_error"


def test_reports_split_user_review_from_world_review_and_include_action_log():
    game = new_scenario_game(
        "005930", "삼성전자", 10100,
        [{"trade_date": "2026-08-01", "close": 10000}, {"trade_date": "2026-08-02", "close": 10100}],
        [{"pre_brief": "일정", "title": "발표", "description": "내용", "autonomous_rounds": 0}],
        persona_counts={"retail": 1, "foreign": 1, "institution": 1, "pension": 1})
    game["daily_reflections"] = [{"market_date": "2026-08-03", "stance": "HOLD_WATCH", "label": "관찰 계속"}]
    game["agent_rounds"] = [{"market_date": "2026-08-03", "phase": "inter_event", "return_pct": 1.2,
                              "previous_price": 10100, "price": 10200, "order_imbalance": .2,
                              "market_pressure": .3, "market_summary": "요약",
                              "persona_orders": [{"persona_id": "retail_001", "group": "retail",
                                                  "side": "BUY", "quantity": 10, "filled_quantity": 10,
                                                  "notional": 102000}]}]
    responses = [
        {"summary": "사용자 요약", "daily_action_review": [], "behavior_pattern": "관찰형",
         "strengths": [], "risk_patterns": [], "next_practice": []},
        {"summary": "환경 요약", "environment_evolution": "변화", "event_reviews": [],
         "stock_flow": "흐름", "group_behavior": {"retail": "매수"}, "key_turning_points": []},
    ]
    prompts = []
    def chat(messages, **kwargs):
        prompts.append(messages[-1]["content"])
        return json.dumps(responses[len(prompts) - 1], ensure_ascii=False)

    reports = generate_llm_reports(game, chat)
    assert reports["investment"]["summary"] == "사용자 요약"
    assert reports["scenario"]["summary"] == "환경 요약"
    assert '"group_behavior":{"retail":"개인"' in prompts[1]
    assert "retail_001" in prompts[0]
