"""Event-driven single-stock investment simulation domain engine."""

from __future__ import annotations

from datetime import date, datetime, timedelta
import hashlib
import math
from typing import Any
import uuid

from .kospi_paper_trading import (
    INVESTOR_GROUPS, TradingError, build_personas, calibrate_impact_model,
    round_to_krx_tick,
)
from .volatility_regime import (
    IDIOSYNCRATIC_SHARE, fetch_vix_regime, session_multiplier, update_cluster_level)
from .ontology import standardize_market_context


PHASE_PRE_EVENT = "pre_event_decision"
PHASE_POST_EVENT = "post_event_decision"
PHASE_INTER_EVENT = "inter_event_market"
PHASE_COMPLETED = "completed"
MAX_LLM_ALLOCATION_PCT = .05
# 관측 가능한 수급과 심리로 설명되는 부분은 하루 변동의 일부일 뿐이다. 실제
# 시장에서 대부분은 설명되지 않고 남는다. 그 몫을 이 종목의 실제 수익률 분포에서
# 뽑아 더한다. 없으면 가격이 에이전트 신호만 따라가며 변동성이 실제의 7%까지
# 줄고(실측), 신호가 이어지는 탓에 같은 방향으로 71% 연속해 흐른다.
# 평균은 빼고 쓴다. 추세는 모델링된 요인에서 나와야지 잡음에서 나오면 안 된다.
# 사건이 공개된 날은 그 사건이 하루의 이야기다. 잔차를 눌러 사건이 읽히게 한다.
EVENT_DAY_NOISE_DAMPING = .3
# _empirical_return은 신호를 p10~p90 안으로만 매핑한다. 잔차는 꼬리까지 쓰는
# 전체 분포에서 뽑으므로, 배수를 주지 않으면 이벤트가 평범한 하루보다 작아진다.
EVENT_AMPLIFICATION = 2.2
CONTEXT_MODE = "integrated"
GROUP_PSYCHOLOGY = {
    "retail": {"half_life_days": 2.0, "baseline_risk_aversion": .45,
               "event_reaction": 1.05},
    "foreign": {"half_life_days": 5.0, "baseline_risk_aversion": .50,
                "event_reaction": 1.0},
    "institution": {"half_life_days": 4.0, "baseline_risk_aversion": .48,
                    "event_reaction": .9},
    "pension": {"half_life_days": 8.0, "baseline_risk_aversion": .62,
                "event_reaction": .55},
}


def _next_business_day(value: date) -> date:
    value += timedelta(days=1)
    while value.weekday() >= 5:
        value += timedelta(days=1)
    return value


def _previous_business_day(value: date) -> date:
    value -= timedelta(days=1)
    while value.weekday() >= 5:
        value -= timedelta(days=1)
    return value


def _add_business_days(value: date, count: int) -> date:
    for _ in range(max(0, count)):
        value = _next_business_day(value)
    return value


def _business_days_after(start: date, before: date) -> list[date]:
    result, cursor = [], _next_business_day(start)
    while cursor < before:
        result.append(cursor)
        cursor = _next_business_day(cursor)
    return result


def _validate_events(events: list[dict[str, Any]], scenario_start: date) -> list[dict[str, Any]]:
    if not events:
        raise TradingError("시나리오 이벤트가 최소 1개 필요합니다.")
    normalized = []
    cursor = _previous_business_day(scenario_start)
    for index, item in enumerate(events):
        title = str(item.get("title") or "").strip()
        if not title:
            raise TradingError(f"{index + 1}번째 이벤트 제목이 없습니다.")
        legacy_rounds = item.get("autonomous_rounds")
        trading_days_until = int(item.get(
            "trading_days_until", max(1, int(legacy_rounds)) if legacy_rounds is not None else 3))
        if not 1 <= trading_days_until <= 20:
            raise TradingError("이벤트까지의 자율거래일은 1~20일이어야 합니다.")
        requested_date = str(item.get("event_date") or "").strip()
        if requested_date:
            event_date = date.fromisoformat(requested_date)
            while event_date.weekday() >= 5:
                event_date = _next_business_day(event_date)
            if event_date <= cursor:
                raise TradingError("이벤트 날짜는 이전 이벤트보다 늦어야 합니다.")
        else:
            event_date = _add_business_days(cursor, trading_days_until + 1)
        signals = []
        raw_signals = item.get("lead_signals") or [
            {"days_before": min(3, trading_days_until), "channel": "schedule",
             "audience": "all", "reliability": .9,
             "content": str(item.get("pre_brief") or "주요 일정이 예정되어 있습니다.")},
            {"days_before": 1, "channel": "market_expectation", "audience": "all",
             "reliability": .55, "content": "발표를 앞두고 시장의 기대와 경계가 엇갈립니다."},
        ]
        for signal_index, signal in enumerate(raw_signals):
            days_before = max(1, min(trading_days_until, int(signal.get("days_before", 1))))
            release_date = event_date
            for _ in range(days_before):
                release_date = _previous_business_day(release_date)
            signals.append({"signal_id": f"sig_{uuid.uuid4().hex[:10]}",
                            "sequence": signal_index + 1, "release_date": release_date.isoformat(),
                            "days_before": days_before,
                            "channel": str(signal.get("channel") or "news")[:40],
                            "audience": str(signal.get("audience") or "all")[:40],
                            "reliability": max(0.0, min(1.0, float(signal.get("reliability", .5)))),
                            "content": str(signal.get("content") or "").strip()[:500]})
        normalized.append({
            "event_id": str(item.get("event_id") or f"evt_{uuid.uuid4().hex[:10]}"),
            "sequence": index + 1,
            "pre_brief": str(item.get("pre_brief") or "중요 일정이 예정되어 있습니다.").strip()[:500],
            "title": title[:200],
            "description": str(item.get("description") or "").strip()[:2000],
            "event_date": event_date.isoformat(),
            "trading_days_until": trading_days_until,
            # These fields remain hidden until reveal. If direction is omitted,
            # the revealed Reddit/X sentiment and net orders infer it.
            "direction": (max(-1.0, min(1.0, float(item["direction"])))
                          if item.get("direction") is not None else None),
            "severity": max(0.0, min(1.0, float(item.get("severity", .65)))),
            "surprise": max(0.0, min(1.0, float(item.get("surprise", .55)))),
            "persistence_days": max(1, min(10, int(item.get("persistence_days", 4)))),
            "lead_signals": signals,
            # 이 사건이 실제로 언제 어디서 있었는지. 공개 후 화면에서 근거로 쓴다.
            "ontology_source": item.get("ontology_source"),
            "status": "hidden",
        })
        cursor = event_date
    return normalized


def _real_candles(history: list[dict[str, Any]], limit: int = 60) -> list[dict[str, Any]]:
    """Keep the tail of the real OHLC history so the chart has context.

    The scenario itself never uses these bars — the impact model is already
    calibrated from them. They exist so the user can see the price the
    simulation departs from instead of an empty axis.
    """
    rows = []
    for row in history[-limit:]:
        close = int(float(row.get("close") or 0))
        if close <= 0:
            continue
        rows.append({
            "market_date": str(row.get("trade_date") or ""),
            "open": int(float(row.get("open") or close)),
            "high": int(float(row.get("high") or close)),
            "low": int(float(row.get("low") or close)),
            "close": close,
            "volume": int(float(row.get("volume") or 0)),
            "real": True,
        })
    return rows


def new_scenario_game(
    ticker: str, name: str, previous_close: int, impact_history: list[dict[str, Any]],
    events: list[dict[str, Any]], *, initial_cash: int = 100_000_000,
    persona_counts: dict[str, int] | None = None, fee_rate: float = .00015,
    sell_tax_rate: float = .0018, slippage_bps: float = 5.0,
    scenario_start_date: str | None = None,
) -> dict[str, Any]:
    ticker = str(ticker).zfill(6)
    if not ticker.isdigit() or len(ticker) != 6:
        raise TradingError("KOSPI 종목 코드는 6자리 숫자여야 합니다.")
    if int(previous_close) <= 0 or int(initial_cash) <= 0:
        raise TradingError("기준 가격과 초기 자본은 0보다 커야 합니다.")
    game_id = f"scenario_{uuid.uuid4().hex[:12]}"
    personas = build_personas(persona_counts, game_id, int(previous_close))
    if len(personas) > 80:
        raise TradingError("LLM 시나리오 모드의 페르소나는 최대 80명입니다.")
    model = calibrate_impact_model(impact_history)
    if not model.get("return_distribution_pct"):
        raise TradingError("시나리오 가격 생성을 위한 시작일 이전 가격 이력이 부족합니다.")
    model["scenario_price_method"] = "empirical_return_quantile_10_90_by_order_imbalance"
    history_end = date.fromisoformat(str(impact_history[-1]["trade_date"]))
    scenario_start = (date.fromisoformat(scenario_start_date) if scenario_start_date
                      else _next_business_day(history_end))
    while scenario_start.weekday() >= 5:
        scenario_start = _next_business_day(scenario_start)
    normalized_events = _validate_events(events, scenario_start)
    psychology_groups = {
        group: {"sentiment": 0.0, "risk_aversion": settings["baseline_risk_aversion"],
                "event_conviction": 0.0, "half_life_days": settings["half_life_days"],
                "memory": []}
        for group, settings in GROUP_PSYCHOLOGY.items()
    }
    now = datetime.now().isoformat()
    return {
        "game_id": game_id, "mode": "scenario", "market": "KOSPI",
        "ticker": ticker, "name": name, "status": "ready",
        "phase": PHASE_INTER_EVENT, "current_event_index": 0,
        "created_at": now, "updated_at": now,
        "initial_cash": int(initial_cash), "cash": int(initial_cash),
        "position": {"quantity": 0, "average_price": 0}, "realized_pnl": 0,
        "current_price": int(previous_close), "initial_reference_price": int(previous_close),
        "events": normalized_events, "revealed_events": [],
        "scenario_start_date": scenario_start.isoformat(),
        "last_market_date": _previous_business_day(scenario_start).isoformat(),
        "released_signals": [], "calendar_type": "KOSPI_WEEKDAY_POC",
        "market_psychology": {
            "groups": psychology_groups,
            "event_regime": {"direction": 0.0, "intensity": 0.0,
                             "days_remaining": 0, "source_event_id": None},
            "aggregate_sentiment": 0.0,
        },
        "psychology_history": [],
        "personas": [persona.__dict__ for persona in personas],
        "pending_orders": [], "fills": [], "agent_rounds": [],
        "history_candles": _real_candles(impact_history),
        "price_history": [{"step": 0, "label": "시나리오 시작", "phase": "initial",
                           "price": int(previous_close),
                           "market_date": str(impact_history[-1].get("trade_date") or ""),
                           **{key: value for key, value in
                              (_real_candles(impact_history, 1) or [{}])[0].items()
                              if key in ("open", "high", "low", "close", "volume")}}],
        "impact_model": model,
        # 시나리오를 만든 시점의 공포 수준. 시나리오 내내 고정한다.
        "volatility_regime": fetch_vix_regime(),
        "volatility_state": {"level": 1.0},
        "settings": {"fee_rate": fee_rate, "sell_tax_rate": sell_tax_rate,
                     "slippage_bps": slippage_bps, "context_mode": CONTEXT_MODE},
        "decision_log": [],
    }


def current_event(game: dict[str, Any]) -> dict[str, Any] | None:
    index = game["current_event_index"]
    return game["events"][index] if index < len(game["events"]) else None


def public_scenario_game(game: dict[str, Any]) -> dict[str, Any]:
    result = {key: value for key, value in game.items() if key != "events"}
    event = current_event(game)
    if event:
        result["current_event"] = ({**event} if event["status"] == "revealed" else {
            "event_id": event["event_id"], "sequence": event["sequence"],
            "pre_brief": event["pre_brief"], "status": event["status"],
            "event_date": event["event_date"],
            "trading_days_until": event["trading_days_until"],
            "released_signals": [signal for signal in game.get("released_signals", [])
                                 if signal["event_id"] == event["event_id"]],
            # 공개 전에는 사건의 정체를 숨기되, 지어낸 것이 아니라는 사실만
            # 알린다. 지표명이나 변화량은 결과를 그대로 누설하므로 뺀다.
            "ontology_source": {
                "origin": (event.get("ontology_source") or {}).get("origin"),
            } if event.get("ontology_source") else None,
        })
    else:
        result["current_event"] = None
    result["total_events"] = len(game["events"])
    result["portfolio"] = scenario_portfolio(game)
    model = dict(result.get("impact_model") or {})
    model.pop("return_distribution_pct", None)
    result["impact_model"] = model
    return result


def submit_scenario_order(game: dict[str, Any], side: str, quantity: int,
                          rationale: str = "", confidence: int | None = None) -> dict[str, Any]:
    if game["phase"] not in (PHASE_PRE_EVENT, PHASE_POST_EVENT):
        raise TradingError("현재 단계에서는 사용자 주문을 제출할 수 없습니다.")
    side = str(side).upper()
    if side not in ("BUY", "SELL") or not isinstance(quantity, int) or quantity <= 0:
        raise TradingError("매수·매도 방향과 1주 이상의 수량이 필요합니다.")
    pending_sell = sum(order["quantity"] for order in game["pending_orders"]
                       if order["side"] == "SELL")
    if side == "SELL" and pending_sell + quantity > game["position"]["quantity"]:
        raise TradingError("보유 수량을 초과하여 매도할 수 없습니다.")
    order = {"order_id": f"ord_{uuid.uuid4().hex[:10]}", "side": side,
             "quantity": quantity, "status": "pending", "phase": game["phase"],
             "event_id": current_event(game)["event_id"],
             "rationale": str(rationale or "").strip()[:500],
             "confidence": confidence, "submitted_at": datetime.now().isoformat()}
    game["pending_orders"].append(order)
    return order


def _execute_user_orders(game: dict[str, Any]) -> list[dict[str, Any]]:
    fills, price = [], game["current_price"]
    settings = game["settings"]
    for order in game["pending_orders"]:
        direction = 1 if order["side"] == "BUY" else -1
        fill_price = round_to_krx_tick(
            price * (1 + direction * settings["slippage_bps"] / 10_000))
        gross = fill_price * order["quantity"]
        fee = round(gross * settings["fee_rate"])
        tax = round(gross * settings["sell_tax_rate"]) if direction < 0 else 0
        if direction > 0:
            if gross + fee > game["cash"]:
                order.update({"status": "rejected", "reason": "insufficient_cash"})
                continue
            old_quantity = game["position"]["quantity"]
            old_cost = old_quantity * game["position"]["average_price"]
            new_quantity = old_quantity + order["quantity"]
            game["cash"] -= gross + fee
            game["position"] = {"quantity": new_quantity,
                                "average_price": round((old_cost + gross) / new_quantity)}
            realized = 0
        else:
            if order["quantity"] > game["position"]["quantity"]:
                order.update({"status": "rejected", "reason": "insufficient_position"})
                continue
            average = game["position"]["average_price"]
            game["cash"] += gross - fee - tax
            realized = (fill_price - average) * order["quantity"] - fee - tax
            game["realized_pnl"] += realized
            remaining = game["position"]["quantity"] - order["quantity"]
            game["position"] = {"quantity": remaining,
                                "average_price": average if remaining else 0}
        order["status"] = "filled"
        fill = {**order, "price": fill_price, "gross_amount": gross,
                "fee": fee, "tax": tax, "realized_pnl": realized}
        game["fills"].append(fill)
        fills.append(fill)
    game["pending_orders"] = []
    return fills


def _interpolate_distribution(distribution: list[float], position: float) -> float:
    position = max(0.0, min(1.0, position))
    location = position * (len(distribution) - 1)
    lower = math.floor(location)
    upper = min(len(distribution) - 1, math.ceil(location))
    weight = location - lower
    return float(distribution[lower]) * (1 - weight) + float(distribution[upper]) * weight


def _empirical_return(model: dict[str, Any], imbalance: float) -> float:
    """Map a signed signal to a zero-centred historical return quantile."""
    distribution = model.get("return_distribution_pct") or []
    if not distribution:
        return 0.0
    signal = max(-1.0, min(1.0, imbalance))
    if not signal:
        return 0.0
    median = _interpolate_distribution(distribution, .5)
    # Full pressure reaches the historical 10th/90th percentile so a single
    # split/limit-day outlier cannot dominate the path. Subtracting
    # the median guarantees that balanced flow produces exactly 0%, even when
    # the calibration window contains a strong bull or bear trend.
    return _interpolate_distribution(distribution, .5 + .4 * signal) - median


def _group_observation_sentiment(round_data: dict[str, Any]) -> dict[str, float]:
    values = {group: [] for group in INVESTOR_GROUPS}
    for row in round_data.get("observations", []):
        group = row.get("investor_group")
        if group in values:
            values[group].append(max(-1.0, min(1.0, float(row.get("sentiment", 0)))))
    return {group: (sum(rows) / len(rows) if rows else 0.0)
            for group, rows in values.items()}


def _update_market_psychology(
    game: dict[str, Any], round_data: dict[str, Any], orders: list[dict[str, Any]],
    *, phase: str, market_date: str | None,
) -> dict[str, Any]:
    psychology = game["market_psychology"]
    event = current_event(game)
    observations = _group_observation_sentiment(round_data)
    group_flows = {group: 0.0 for group in INVESTOR_GROUPS}
    for order in orders:
        direction = 1 if order["side"] == "BUY" else -1 if order["side"] == "SELL" else 0
        group_flows[order["group"]] += direction * float(order.get("allocation_pct", 0)) / MAX_LLM_ALLOCATION_PCT
    group_counts = {group: max(1, sum(p["group"] == group for p in game["personas"]))
                    for group in INVESTOR_GROUPS}
    group_flows = {group: max(-1.0, min(1.0, value / group_counts[group]))
                   for group, value in group_flows.items()}

    regime = psychology["event_regime"]
    if phase != "event_reaction" and regime["days_remaining"] > 0:
        regime["intensity"] *= .82
        regime["days_remaining"] -= 1
        if regime["days_remaining"] <= 0 or regime["intensity"] < .03:
            regime.update({"direction": 0.0, "intensity": 0.0,
                           "days_remaining": 0, "source_event_id": None})
    regime_signal = regime["direction"] * regime["intensity"]

    event_impulse = 0.0
    if phase == "event_reaction":
        observed_market = sum(observations.values()) / len(INVESTOR_GROUPS)
        inferred_flow = sum(group_flows.values()) / len(INVESTOR_GROUPS)
        direction = event.get("direction")
        if direction is None:
            direction = max(-1.0, min(1.0, .6 * observed_market + .4 * inferred_flow))
            if abs(direction) < .1:
                direction = math.copysign(.1, direction or 1)
        event_impulse = (float(direction) * float(event["severity"])
                         * (.5 + .5 * float(event["surprise"])))
        combined = regime_signal + event_impulse
        regime.update({"direction": math.copysign(1.0, combined) if combined else 0.0,
                       "intensity": min(1.0, abs(combined)),
                       "days_remaining": int(event["persistence_days"]),
                       "source_event_id": event["event_id"]})
        regime_signal = regime["direction"] * regime["intensity"]

    weighted_sentiment, total_weight = 0.0, 0.0
    for group, state in psychology["groups"].items():
        settings = GROUP_PSYCHOLOGY[group]
        decay = .5 ** (1 / state["half_life_days"])
        decayed_sentiment = state["sentiment"] * decay
        event_term = event_impulse * settings["event_reaction"] if phase == "event_reaction" else 0.0
        carry_term = regime_signal * .16 if phase != "event_reaction" else 0.0
        state["sentiment"] = max(-1.0, min(1.0,
            decayed_sentiment + .28 * observations[group] + .14 * group_flows[group]
            + .48 * event_term + carry_term))
        baseline = settings["baseline_risk_aversion"]
        negative_stress = max(0.0, -event_term, -observations[group] * .5)
        state["risk_aversion"] = max(0.0, min(1.0,
            baseline + (state["risk_aversion"] - baseline) * decay + .28 * negative_stress))
        state["event_conviction"] = min(1.0, abs(state["sentiment"]) * .65
                                        + abs(event_term) * .35)
        if phase == "event_reaction":
            state["memory"].append({"event_id": event["event_id"],
                                    "event_sequence": event["sequence"],
                                    "market_date": market_date,
                                    "impulse": round(event_term, 6),
                                    "sentiment_after": round(state["sentiment"], 6)})
            state["memory"] = state["memory"][-10:]
        weight = sum(p["cash"] + p["quantity"] * game["current_price"]
                     for p in game["personas"] if p["group"] == group)
        weighted_sentiment += state["sentiment"] * weight
        total_weight += weight
    psychology["aggregate_sentiment"] = (weighted_sentiment / total_weight if total_weight else 0.0)
    snapshot = {"market_date": market_date, "phase": phase,
                "aggregate_sentiment": round(psychology["aggregate_sentiment"], 6),
                "event_impulse": round(event_impulse, 6),
                "event_regime": dict(regime),
                "groups": {group: {key: round(value, 6) if isinstance(value, float) else value
                                    for key, value in state.items() if key != "memory"}
                           for group, state in psychology["groups"].items()}}
    game["psychology_history"].append(snapshot)
    return snapshot


def apply_agent_round(game: dict[str, Any], round_data: dict[str, Any], *,
                      phase: str, label: str, market_date: str | None = None) -> dict[str, Any]:
    decisions = {row["persona_id"]: row for row in round_data["persona_decisions"]}
    orders, buy, sell = [], 0, 0
    price = game["current_price"]
    for persona in game["personas"]:
        decision = decisions.get(persona["persona_id"])
        if not decision:
            raise TradingError(f"페르소나 주문이 누락됐습니다: {persona['persona_id']}")
        side = decision["side"]
        allocation = float(decision["allocation_pct"])
        base = persona["cash"] if side == "BUY" else persona["quantity"] * price
        quantity = int(base * allocation / price) if side != "HOLD" else 0
        quantity = min(quantity, persona["cash"] // price) if side == "BUY" else min(quantity, persona["quantity"])
        if quantity <= 0:
            side = "HOLD"
        notional = quantity * price
        buy += notional if side == "BUY" else 0
        sell += notional if side == "SELL" else 0
        orders.append({**decision, "group": persona["group"], "strategy": persona["strategy"],
                       "side": side, "quantity": quantity, "notional": notional,
                       "decision_source": "llm"})
    gross = buy + sell
    imbalance = (buy - sell) / gross if gross else 0.0
    total_persona_equity = sum(
        persona["cash"] + persona["quantity"] * price for persona in game["personas"])
    max_round_capacity = total_persona_equity * MAX_LLM_ALLOCATION_PCT
    market_pressure = ((buy - sell) / max_round_capacity if max_round_capacity else 0.0)
    market_pressure = max(-1.0, min(1.0, market_pressure))
    psychology = _update_market_psychology(
        game, round_data, orders, phase=phase, market_date=market_date)
    sentiment_signal = psychology["aggregate_sentiment"]
    regime = psychology["event_regime"]
    regime_signal = regime["direction"] * regime["intensity"]
    event_signal = psychology["event_impulse"] if phase == "event_reaction" else 0.0
    market_context = standardize_market_context(
        game.get("ontology_snapshot") or {}, market_date or "")
    market_context_return_pct = market_context["price_return_contribution_pct"]
    flow_return_pct = .55 * _empirical_return(game["impact_model"], market_pressure)
    sentiment_return_pct = .35 * _empirical_return(game["impact_model"], sentiment_signal)
    regime_return_pct = (.35 * _empirical_return(game["impact_model"], regime_signal)
                         if phase != "event_reaction" else 0.0)
    event_return_pct = (EVENT_AMPLIFICATION * _empirical_return(game["impact_model"], event_signal)
                        if phase == "event_reaction" else 0.0)
    volatility_multiplier = session_multiplier(game)
    if phase == "event_reaction":
        volatility_multiplier *= EVENT_DAY_NOISE_DAMPING
    idiosyncratic_return_pct = volatility_multiplier * _idiosyncratic_return(
        game["impact_model"], f"{game['game_id']}:{len(game['agent_rounds'])}")
    target_return_pct = max(-30.0, min(30.0, market_context_return_pct + flow_return_pct
                                      + sentiment_return_pct + regime_return_pct
                                      + event_return_pct + idiosyncratic_return_pct))
    impact_signal = max(-1.0, min(1.0,
        .35 * market_pressure + .25 * sentiment_signal + .2 * regime_signal + .5 * event_signal))
    next_price = round_to_krx_tick(price * (1 + target_return_pct / 100))
    next_price = min(round_to_krx_tick(price * 1.30),
                     max(round_to_krx_tick(price * .70), next_price))
    return_pct = (next_price / price - 1) * 100
    by_id = {persona["persona_id"]: persona for persona in game["personas"]}
    for order in orders:
        persona, quantity = by_id[order["persona_id"]], order["quantity"]
        if order["side"] == "BUY" and quantity:
            cost = quantity * next_price
            quantity = min(quantity, persona["cash"] // next_price)
            cost = quantity * next_price
            old_cost = persona["quantity"] * persona["average_price"]
            persona["cash"] -= cost
            persona["quantity"] += quantity
            persona["average_price"] = round((old_cost + cost) / persona["quantity"])
        elif order["side"] == "SELL" and quantity:
            quantity = min(quantity, persona["quantity"])
            persona["cash"] += quantity * next_price
            persona["realized_pnl"] += (next_price - persona["average_price"]) * quantity
            persona["quantity"] -= quantity
            if not persona["quantity"]:
                persona["average_price"] = 0
        order["filled_quantity"] = quantity
        order["fill_price"] = next_price if quantity else None
    game["current_price"] = next_price
    result = {"round_id": f"rnd_{uuid.uuid4().hex[:10]}", "phase": phase,
              "label": label, "market_date": market_date,
              "previous_price": price, "price": next_price,
              "return_pct": round(return_pct, 4), "order_imbalance": round(imbalance, 6),
              "market_pressure": round(market_pressure, 6),
              "impact_signal": round(impact_signal, 6),
              "target_return_pct": round(target_return_pct, 4),
              "return_components_pct": {
                  "flow": round(flow_return_pct, 4),
                  "market_context": round(market_context_return_pct, 4),
                  "persistent_sentiment": round(sentiment_return_pct, 4),
                  "event_regime": round(regime_return_pct, 4),
                  "event_shock": round(event_return_pct, 4),
                  "idiosyncratic": round(idiosyncratic_return_pct, 4),
                  "volatility_multiplier": round(volatility_multiplier, 4),
                  "context_signals": market_context,
              },
              "psychology": psychology,
              "max_round_capacity": round(max_round_capacity),
              "context_mode": game.get("settings", {}).get("context_mode", CONTEXT_MODE),
              "buy_notional": buy, "sell_notional": sell, "persona_orders": orders,
              "market_summary": round_data.get("market_summary", ""),
              "observations": round_data.get("observations", []),
              "risk_flags": round_data.get("risk_flags", [])}
    # 오늘 실제로 움직인 폭을 다음 세션 폭에 반영한다. 큰 날 뒤에는 큰 날이 온다.
    update_cluster_level(game, return_pct)
    game["agent_rounds"].append(result)
    candle = _intraday_candle(
        price, next_price, phase, result["return_components_pct"],
        int((buy + sell) / next_price) if next_price else 0, result["round_id"])
    result["candle"] = candle
    game["price_history"].append({"step": len(game["price_history"]), "label": label,
                                  "phase": phase, "price": next_price,
                                  "market_date": market_date,
                                  "return_pct": round(return_pct, 4), **candle})
    return result


def _seeded_unit(seed: str, salt: str) -> float:
    """Return a stable 0..1 value for `seed`.

    Candles are persisted with the game, so the same round must always redraw
    the same wick. random.random() would change on every recomputation.
    """
    digest = hashlib.sha256(f"{seed}|{salt}".encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF


def _intraday_candle(
    previous_close: int, close: int, phase: str,
    components: dict[str, Any], turnover_shares: int, seed: str,
) -> dict[str, int]:
    """Rebuild an OHLC bar from a settled close.

    The engine only produces one price per round, but a candle needs an
    intraday path. We reconstruct a plausible one from the round's own return
    components: an event shock lands mostly as an opening gap, flow and
    sentiment accumulate through the session, and wicks extend past the body
    in proportion to the day's move.
    """
    previous_close = int(previous_close)
    close = int(close)
    if previous_close <= 0:
        return {"open": close, "high": close, "low": close, "close": close,
                "volume": int(turnover_shares)}

    move = close - previous_close
    # 이벤트 공개일은 갭 상승/하락으로 시작하고, 평시에는 전일 종가 근처에서 열린다.
    gap_ratio = .62 if phase == "event_reaction" else .22
    gap_ratio *= .7 + .6 * _seeded_unit(seed, "gap")
    open_price = round_to_krx_tick(previous_close + move * gap_ratio)

    body_top, body_bottom = max(open_price, close), min(open_price, close)
    # 장중 변동은 최소 0.4%는 잡아준다. 보합이어도 캔들이 선으로 뭉개지지 않게.
    span = max(abs(move), previous_close * .004)
    high = round_to_krx_tick(body_top + span * (.22 + .55 * _seeded_unit(seed, "hi")))
    low = round_to_krx_tick(body_bottom - span * (.22 + .55 * _seeded_unit(seed, "lo")))

    # 틱 반올림이 몸통을 침범하지 않도록 마지막에 한 번 더 조인다.
    limit_high = round_to_krx_tick(previous_close * 1.30)
    limit_low = round_to_krx_tick(previous_close * .70)
    high = max(body_top, min(high, limit_high))
    low = min(body_bottom, max(low, limit_low, 1))
    return {"open": open_price, "high": high, "low": low, "close": close,
            "volume": int(turnover_shares)}


def _idiosyncratic_return(model: dict[str, Any], seed: str) -> float:
    """Draw the unexplained part of a session's move from real returns.

    Sampling the security's own historical distribution keeps the tails and
    the shape that security actually had, instead of assuming a normal curve.
    Seeded so a reloaded game replays the same path.
    """
    distribution = model.get("return_distribution_pct") or []
    if len(distribution) < 5:
        return 0.0
    centre = sum(distribution) / len(distribution)
    # 분위 보간이 아니라 실제 관측치 하나를 그대로 뽑는다. 보간은 정렬된 표본
    # 사이를 메우면서 꼬리를 눌러, 큰 하루가 사라지고 변동성이 실제보다 낮아진다.
    position = int(_seeded_unit(seed, "idio") * len(distribution))
    draw = distribution[min(position, len(distribution) - 1)]
    return (draw - centre) * IDIOSYNCRATIC_SHARE


def pending_inter_event_dates(game: dict[str, Any]) -> list[str]:
    """Return market dates that can advance without revealing the next event."""
    if game["phase"] != PHASE_INTER_EVENT:
        return []
    event = current_event(game)
    if not event:
        return []
    start = date.fromisoformat(game["last_market_date"])
    end = date.fromisoformat(event["event_date"])
    return [value.isoformat() for value in _business_days_after(start, end)]


def _release_signals(game: dict[str, Any], event: dict[str, Any], market_date: str) -> list[dict[str, Any]]:
    known_ids = {row["signal_id"] for row in game.get("released_signals", [])}
    released = []
    for signal in event.get("lead_signals", []):
        if signal["signal_id"] not in known_ids and signal["release_date"] <= market_date:
            public_signal = {**signal, "event_id": event["event_id"],
                             "event_sequence": event["sequence"]}
            game["released_signals"].append(public_signal)
            released.append(public_signal)
    return released


def advance_inter_event_market(game: dict[str, Any], round_provider: Any,
                               max_days: int | None = None) -> dict[str, Any]:
    """Advance hidden-information trading days up to the next event.

    ``max_days`` stops after that many sessions and stays in the inter-event
    phase, so the caller can step the market one day at a time instead of
    waiting out the whole stretch in a single request.
    """
    if game["phase"] != PHASE_INTER_EVENT:
        raise TradingError("현재는 이벤트 사이 시장 진행 단계가 아닙니다.")
    event = current_event(game)
    if not event:
        raise TradingError("진행할 다음 이벤트가 없습니다.")
    rounds = []
    dates = pending_inter_event_dates(game)
    remaining = len(dates)
    if max_days is not None:
        dates = dates[:max(1, int(max_days))]
    for index, market_date in enumerate(dates, 1):
        newly_released = _release_signals(game, event, market_date)
        visible_signals = [row for row in game["released_signals"]
                           if row["event_id"] == event["event_id"]
                           and row["release_date"] <= market_date]
        round_data = round_provider(game, event, market_date, index, visible_signals)
        result = apply_agent_round(
            game, round_data, phase="inter_event",
            label=f"{market_date} · 이벤트 전 자율거래", market_date=market_date)
        result["newly_released_signals"] = newly_released
        rounds.append(result)
        game["last_market_date"] = market_date
    # 남은 날이 있으면 아직 이벤트 전 구간이다. 다음 호출에서 이어서 진행한다.
    if max_days is None or len(dates) >= remaining:
        game["phase"] = PHASE_PRE_EVENT
    game["updated_at"] = datetime.now().isoformat()
    return {"market_days": rounds, "next_phase": game["phase"],
            "event_date": event["event_date"]}


def reveal_and_react(game: dict[str, Any], round_data: dict[str, Any]) -> dict[str, Any]:
    if game["phase"] != PHASE_PRE_EVENT:
        raise TradingError("현재는 이벤트 공개 단계가 아닙니다.")
    event = current_event(game)
    user_fills = _execute_user_orders(game)
    event["status"] = "revealed"
    game["revealed_events"].append({**event})
    reaction = apply_agent_round(game, round_data, phase="event_reaction",
                                 label=f"{event['event_date']} · EVENT {event['sequence']} · {event['title']}",
                                 market_date=event["event_date"])
    game["last_market_date"] = event["event_date"]
    game["decision_log"].append({"event_id": event["event_id"], "phase": PHASE_PRE_EVENT,
                                 "user_fills": user_fills, "price_before": reaction["previous_price"],
                                 "price_after": reaction["price"]})
    game["phase"] = PHASE_POST_EVENT
    game["updated_at"] = datetime.now().isoformat()
    return {"event": {**event}, "user_fills": user_fills, "reaction": reaction}


def finish_event(game: dict[str, Any], autonomous_rounds: Any = None) -> dict[str, Any]:
    if game["phase"] != PHASE_POST_EVENT:
        raise TradingError("현재는 이벤트 사후 판단 단계가 아닙니다.")
    event = current_event(game)
    user_fills = _execute_user_orders(game)
    game["decision_log"].append({"event_id": event["event_id"], "phase": PHASE_POST_EVENT,
                                 "user_fills": user_fills,
                                 "price_after_autonomous": game["current_price"]})
    game["current_event_index"] += 1
    game["phase"] = (PHASE_COMPLETED if game["current_event_index"] >= len(game["events"])
                     else PHASE_INTER_EVENT)
    game["status"] = "completed" if game["phase"] == PHASE_COMPLETED else "ready"
    game["updated_at"] = datetime.now().isoformat()
    return {"user_fills": user_fills, "autonomous_rounds": [],
            "next_event": current_event(game), "status": game["status"]}


def scenario_portfolio(game: dict[str, Any]) -> dict[str, Any]:
    quantity = game["position"]["quantity"]
    market_value = quantity * game["current_price"]
    equity = game["cash"] + market_value
    return {"cash": game["cash"], "quantity": quantity,
            "average_price": game["position"]["average_price"],
            "mark_price": game["current_price"], "market_value": market_value,
            "equity": equity, "realized_pnl": game["realized_pnl"],
            "unrealized_pnl": (game["current_price"] - game["position"]["average_price"]) * quantity,
            "total_return_pct": round((equity / game["initial_cash"] - 1) * 100, 4)}
