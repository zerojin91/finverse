"""LLM narrative report for a completed event-driven simulation."""

from __future__ import annotations

import json
from typing import Any, Callable

from .llm_market_simulator import LLMMarketUnavailable, _parse_json
from .scenario_investor_analyzer import analyze_scenario_investor


def enforce_verified_report_metrics(report: dict[str, Any],
                                    metrics: dict[str, Any]) -> dict[str, Any]:
    """Correct the common 100x total-return narration error without hiding it."""
    total = float(metrics["total_return_pct"])
    scaled = total * 100
    summary = str(report.get("executive_summary") or "")
    patterns = {f"{scaled:.2f}%", f"{scaled:.3f}%", f"{scaled:.4f}%"}
    corrected = summary
    for value in patterns:
        corrected = corrected.replace(value, f"{total:.4f}%")
    if corrected != summary:
        report["raw_executive_summary"] = summary
        report["executive_summary"] = corrected
        report.setdefault("metric_corrections", []).append({
            "field": "executive_summary", "reason": "100x_percentage_scale_error",
            "verified_value_pct": total,
        })
    # A verified deterministic line always takes precedence over narrative text.
    activity_label = "사용자 판단" if metrics.get("world_decision_count") is not None else "사용자 거래"
    activity_count = int(metrics.get("world_decision_count", metrics["trade_count"]))
    report["quantitative_summary"] = (
        f"검증된 총 수익률 {total:.4f}%, "
        f"최대 가격 낙폭 {float(metrics['max_price_drawdown_pct']):.4f}%, "
        f"{activity_label} {activity_count}회"
    )
    return report


REQUIRED_REPORT_KEYS = ("executive_summary", "investor_profile", "event_reviews",
                        "strengths", "risk_patterns", "action_plan")
REPORT_ATTEMPTS = 3


def _compact_agent_rounds(game: dict[str, Any]) -> list[dict[str, Any]]:
    """Keep every recorded agent action while making the report prompt bounded.

    Rationales are already available in the persisted game for drill-down. The
    report needs the complete action log, but not the repeated prose for every
    agent, so each action is represented by its identity, side and notional.
    """
    rounds = []
    for row in game.get("agent_rounds", []):
        actions = []
        for order in row.get("persona_orders") or []:
            actions.append({key: order.get(key) for key in
                            ("persona_id", "group", "side", "quantity", "filled_quantity", "notional")})
        rounds.append({
            "market_date": row.get("market_date"), "phase": row.get("phase"),
            "return_pct": row.get("return_pct"), "previous_price": row.get("previous_price"),
            "price": row.get("price"), "order_imbalance": row.get("order_imbalance"),
            "market_pressure": row.get("market_pressure"),
            "market_summary": row.get("market_summary", ""),
            "actions": actions,
        })
    return rounds


def _report_context(game: dict[str, Any]) -> dict[str, Any]:
    base = analyze_scenario_investor(game)
    world = game.get("world") or {}
    memory = world.get("memory") or {}
    portfolio = game.get("portfolio") or {}
    if not portfolio:
        from .scenario_trading import scenario_portfolio
        portfolio = scenario_portfolio(game)
    return {
        "security": {"ticker": game.get("ticker"), "name": game.get("name")},
        "mode": game.get("mode"),
        "simulation_period": game.get("simulation_days") or len(game.get("agent_rounds", [])),
        "portfolio_at_end": portfolio,
        "initial_equity": game.get("initial_equity"),
        "user_daily_actions": [
            {key: row.get(key) for key in
             ("market_date", "stance", "label", "event_id", "market_return_pct", "market_summary", "source")}
            for row in game.get("daily_reflections", [])
        ],
        "user_fills": [{key: fill.get(key) for key in
                        ("market_date", "event_id", "phase", "side", "quantity", "price", "gross_amount", "rationale", "confidence", "realized_pnl")}
                       for fill in game.get("fills", [])],
        "world_state_daily_memory": memory.get("daily_ledger", []),
        "world_event_memory": memory.get("event_ledger", []),
        "agent_rounds_and_all_actions": _compact_agent_rounds(game),
        "verified_assessment": base,
    }


def _call_structured_report(messages: list[dict[str, str]], required_keys: list[str],
                            chat: Callable[..., str]) -> dict[str, Any]:
    report: dict[str, Any] = {}
    missing: list[str] = []
    last_error: Exception | None = None
    for _ in range(REPORT_ATTEMPTS):
        retry = list(messages)
        if missing:
            retry.append({"role": "user", "content":
                          f"직전 응답에 다음 필수 키가 없었다. 형식을 지켜 모두 포함해 다시 반환하라: {', '.join(missing)}"})
        try:
            report = _parse_json(chat(retry, temperature=.35, max_tokens=5000,
                                      response_format={"type": "json_object"}))
        except Exception as exc:  # noqa: BLE001 - 제한된 횟수로 재시도
            last_error, missing = exc, []
            continue
        missing = [key for key in required_keys if key not in report]
        if not missing:
            return report
        last_error = None
    if last_error is not None:
        raise LLMMarketUnavailable("LLM 보고서 생성에 실패했습니다.") from last_error
    raise LLMMarketUnavailable(f"LLM 보고서에 필수 항목이 누락됐습니다: {', '.join(missing)}")


def generate_llm_reports(game: dict[str, Any],
                         chat: Callable[..., str] | None = None) -> dict[str, Any]:
    """Generate separate learner and world reports from one completed game.

    Both reports receive the same persisted world/action history, but use
    different prompts so the learner report focuses on the user's decisions
    while the scenario report explains the evolving environment and agents.
    """
    if chat is None:
        from .llm_client import LLMClient
        chat = LLMClient().chat
    context = _report_context(game)
    common = ("한국 주식 교육용 가상 시뮬레이션이다. 실제 투자 권유나 미래 예측을 하지 않는다. "
              "입력의 금액과 퍼센트는 엔진이 계산한 검증값이므로 임의로 바꾸지 않는다. "
              "근거가 없는 심리 특성은 단정하지 말고 기록에서 확인되는 행동 패턴으로만 설명한다. "
              "반드시 JSON 객체만 반환한다.")
    investment_keys = ["summary", "daily_action_review", "behavior_pattern", "strengths", "risk_patterns", "next_practice"]
    scenario_keys = ["summary", "environment_evolution", "event_reviews", "stock_flow", "group_behavior", "key_turning_points"]
    investment_message = {"role": "user", "content": (
        f"다음 기록으로 사용자의 투자보고서를 작성하라.\n{json.dumps(context, ensure_ascii=False)}\n"
        "사용자가 날짜별로 매수·매도·관찰을 어떻게 선택했는지, 최종 투자금액과 종료일 가격 기준 손익을 설명하라. "
        "daily_action_review는 날짜별 1~2문장 배열로 작성하라. 반환 형식: "
        '{"summary":"3~5문장", "daily_action_review":[{"date":"날짜","action":"행동","result":"다음 결과"}], '
        '"behavior_pattern":"종합 행동 패턴", "strengths":["잘한 점"], "risk_patterns":["주의할 점"], "next_practice":["다음 연습 원칙"]}'
    )}
    scenario_message = {"role": "user", "content": (
        f"다음 기록으로 시나리오 보고서를 작성하라.\n{json.dumps(context, ensure_ascii=False)}\n"
        "World State의 거래일별 변화, 실제 유사 근거로 생성된 이벤트, 사건 전후 종목 흐름, "
        "개인·외국인·기관·연기금의 집단 행동과 모든 개별 행동 기록을 종합하라. "
        "반환 형식: {\"summary\":\"전체 흐름 3~5문장\", \"environment_evolution\":\"환경 변화\", "
        "\"event_reviews\":[{\"date\":\"날짜\",\"event\":\"사건\",\"impact\":\"영향\"}], "
        "\"stock_flow\":\"가격 흐름\", \"group_behavior\":{\"retail\":\"개인\",\"foreign\":\"외국인\",\"institution\":\"기관\",\"pension\":\"연기금\"}, "
        "\"key_turning_points\":[\"전환점\"]}"
    )}
    investment = _call_structured_report(
        [{"role": "system", "content": common}, investment_message], investment_keys, chat)
    scenario = _call_structured_report(
        [{"role": "system", "content": common}, scenario_message], scenario_keys, chat)
    metrics = context["verified_assessment"]["metrics"]
    investment["verified_metrics"] = metrics
    investment["portfolio_at_end"] = context["portfolio_at_end"]
    investment["initial_equity"] = context["initial_equity"]
    investment = enforce_verified_report_metrics(investment, metrics)
    scenario["verified_metrics"] = metrics
    return {"investment": investment, "scenario": scenario}


def _slim_psychology(psychology: dict[str, Any]) -> dict[str, Any]:
    """Keep the psychology signal, drop the per-persona memory arrays.

    Each round carries every group's rolling `memory` list, which is most of the
    prompt and tells the model nothing the sentiment value doesn't already say.
    """
    groups = {
        group: {"sentiment": state.get("sentiment"),
                "risk_aversion": state.get("risk_aversion"),
                "event_conviction": state.get("event_conviction")}
        for group, state in (psychology.get("groups") or {}).items()
    }
    return {"aggregate_sentiment": psychology.get("aggregate_sentiment"),
            "event_impulse": psychology.get("event_impulse"),
            "event_regime": psychology.get("event_regime"), "groups": groups}


def generate_llm_scenario_report(game: dict[str, Any],
                                 chat: Callable[..., str] | None = None) -> dict[str, Any]:
    base = analyze_scenario_investor(game)
    context = {
        "ticker": game["ticker"], "name": game["name"],
        "scenario_premise": game.get("scenario_premise", ""),
        "events": [{"sequence": event["sequence"], "title": event["title"],
                    "description": event["description"], "event_date": event.get("event_date")}
                   for event in game.get("revealed_events", [])],
        "released_signal_timeline": game.get("released_signals", []),
        "price_history": [{"label": row.get("label"), "market_date": row.get("market_date"),
                           "phase": row.get("phase"), "close": row.get("close", row.get("price")),
                           "return_pct": row.get("return_pct")}
                          for row in game.get("price_history", [])],
        "user_fills": [{key: fill.get(key) for key in
                        ("event_id", "phase", "side", "quantity", "price",
                         "rationale", "confidence", "realized_pnl")}
                       for fill in game.get("fills", [])],
        "daily_reflections": [{key: row.get(key) for key in
                               ("market_date", "event_id", "stance", "label", "market_return_pct", "market_summary")}
                              for row in game.get("daily_reflections", [])],
        "agent_rounds": [{"label": row["label"], "market_date": row.get("market_date"),
                          "phase": row.get("phase"), "return_pct": row["return_pct"],
                          "order_imbalance": row["order_imbalance"],
                          "market_pressure": row.get("market_pressure"),
                          "return_components_pct": row.get("return_components_pct", {}),
                          "psychology": _slim_psychology(row.get("psychology", {})),
                          "market_summary": row.get("market_summary", "")}
                         for row in game.get("agent_rounds", [])],
        "quantitative_assessment": base,
    }
    messages = [
        {"role": "system", "content": "한국 주식 교육용 시뮬레이션 분석가다. 결과론적 비난과 투자 권유를 피하고, 이벤트 전후 의사결정 과정을 근거 중심으로 평가한다. World 모드의 사용자는 매수 고려·관찰 계속·매도 고려 판단을 기록하며, 매수·매도 수량은 시장에 영향을 주지 않는 개인 paper portfolio 체결로만 반영된다. daily_reflections와 user_fills의 판단·수량·체결 결과를 다음 시장 결과와 비교한다. 추격 매수, 손실 회피, 확증 편향, 과신, 과도한 매매는 기록에서 확인되는 경우에만 교육적 가설로 설명하고 단정하지 않는다. 입력의 백분율은 이미 % 단위이므로 100을 곱하거나 나누지 말고 그대로 인용한다. 수치를 재계산하지 않는다. 반드시 JSON 객체만 반환한다."},
        {"role": "user", "content": f"""다음 완료된 가상 시나리오를 분석하라.
{json.dumps(context, ensure_ascii=False)}
반환 형식:
{{"executive_summary":"전체 결과 3~5문장","investor_profile":"투자 성향 설명",
"event_reviews":[{{"event":"이벤트명","market_reaction":"시장 반응",
"user_decision":"사용자 전후 판단","lesson":"교육 포인트"}}],
"strengths":["잘한 판단"],"risk_patterns":["주의할 행동"],
"action_plan":["다음 훈련에서 적용할 구체적 원칙"]}}"""},
    ]
    if chat is None:
        from .llm_client import LLMClient
        chat = LLMClient().chat

    report: dict[str, Any] = {}
    missing: list[str] = []
    last_error: Exception | None = None
    for attempt in range(REPORT_ATTEMPTS):
        retry = list(messages)
        if missing:
            # 무엇이 빠졌는지 알려주면 다음 시도에서 대체로 채워 온다.
            retry.append({"role": "user", "content":
                          f"직전 응답에 다음 필수 키가 없었다. 형식을 지켜 모두 포함해 다시 반환하라: {', '.join(missing)}"})
        try:
            raw = chat(retry, temperature=.35, max_tokens=5000,
                       response_format={"type": "json_object"})
            report = _parse_json(raw)
        except Exception as exc:  # noqa: BLE001 - 다음 시도로 넘어가기 위함
            last_error, missing = exc, []
            continue
        missing = [key for key in REQUIRED_REPORT_KEYS if key not in report]
        if not missing:
            break
        last_error = None
    else:
        if last_error is not None:
            raise LLMMarketUnavailable(
                "LLM 종합 투자 보고서 생성에 실패했습니다.") from last_error
        raise LLMMarketUnavailable(
            f"LLM 종합 보고서에 필수 항목이 누락됐습니다: {', '.join(missing)}")
    metrics = base["metrics"]
    report["verified_metrics"] = metrics
    return enforce_verified_report_metrics(report, metrics)
