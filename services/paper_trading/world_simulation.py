"""World Agent-backed paper-trading game lifecycle.

This mode replaces a pre-scheduled event list with a day-by-day external
environment.  It deliberately reuses the proven deterministic clearing logic
from ``scenario_trading`` while changing where information and agent actions
come from.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any, Callable
import uuid

from .kospi_paper_trading import TradingError, calibrate_impact_model
from .llm_scenario_simulator import run_individual_agent_round
from .participant_sizing import scale_personas_to_representative_capacity
from .daily_market_summary import generate_daily_market_summary
from .scenario_trading import (
    GROUP_PSYCHOLOGY, _execute_user_orders, _real_candles, apply_agent_round,
    _record_daily_performance, scenario_portfolio,
)
from .world_agent import advance_environment, build_world_state, public_world_information, record_market_feedback


PHASE_WORLD_MARKET = "world_market"
PHASE_WORLD_DECISION = "world_decision"
PHASE_COMPLETED = "completed"


def _initial_portfolio(initial_cash: int, initial_position: dict[str, Any] | None, previous_close: int) -> tuple[int, int, int, int]:
    if int(initial_cash) < 0 or int(initial_cash) > 100_000_000_000:
        raise TradingError("투자 가능 금액은 0원 이상 1,000억원 이하로 입력해주세요.")
    position = initial_position or {}
    quantity = int(position.get("quantity") or 0)
    average_price = int(position.get("average_price") or 0)
    if quantity < 0 or average_price < 0 or bool(quantity) != bool(average_price):
        raise TradingError("보유 중인 경우 평균 매입가와 수량을 모두 입력해주세요.")
    equity = int(initial_cash) + quantity * int(previous_close)
    if equity <= 0:
        raise TradingError("투자 가능 금액이나 보유 종목 중 하나는 입력해주세요.")
    return int(initial_cash), quantity, average_price, equity


def new_world_game(
    ticker: str, name: str, previous_close: int, impact_history: list[dict[str, Any]], *,
    initial_context: dict[str, Any], agent_profiles: dict[str, Any], simulation_days: int,
    world_history: dict[str, Any] | None = None,
    initial_cash: int = 100_000_000, initial_position: dict[str, Any] | None = None,
    fee_rate: float = .00015, sell_tax_rate: float = .0018, slippage_bps: float = 5.0,
) -> dict[str, Any]:
    if simulation_days not in (10, 20, 60):
        raise TradingError("시뮬레이션 기간은 10일, 20일, 60일 중에서 선택해주세요.")
    if int(previous_close) <= 0:
        raise TradingError("시작 기준 가격이 필요합니다.")
    if not impact_history:
        raise TradingError("시나리오 가격 생성을 위한 시작일 이전 가격 이력이 부족합니다.")
    model = calibrate_impact_model(impact_history)
    personas = deepcopy(agent_profiles.get("profiles") or [])
    if len(personas) != 59:
        raise TradingError("초기 상황을 바탕으로 생성한 59개 에이전트 프로필이 필요합니다.")
    scale_personas_to_representative_capacity(
        personas, model.get("participant_sizing") or {})
    for persona in personas:
        profile = persona.get("profile") or {}
        persona["memory"] = [{
            "kind": "initial_context", "market_date": None,
            "note": str(profile.get("memory_seed") or "초기 공개 맥락만 근거로 판단한다.")[:500],
        }]
    cash, quantity, average_price, initial_equity = _initial_portfolio(initial_cash, initial_position, int(previous_close))
    if not model.get("return_distribution_pct"):
        raise TradingError("시나리오 가격 생성을 위한 시작일 이전 가격 이력이 부족합니다.")
    game_id = f"world_{uuid.uuid4().hex[:12]}"
    # 시장 체결 모델에는 일별 가격 이력만 주되, World Agent는 커뮤니티·거시까지
    # 포함한 시작 시점 이전의 전체 관측 이력을 받는다.
    source_history = dict(world_history or {})
    source_history["market_days"] = impact_history
    source_history.setdefault("ticker", ticker)
    source_history.setdefault("name", name)
    world = build_world_state(source_history, initial_context, simulation_days)
    psychology_groups = {
        group: {"sentiment": 0.0, "risk_aversion": settings["baseline_risk_aversion"],
                "event_conviction": 0.0, "half_life_days": settings["half_life_days"], "memory": []}
        for group, settings in GROUP_PSYCHOLOGY.items()
    }
    now = datetime.now().isoformat()
    return {
        "game_id": game_id, "mode": "world", "market": "KOSPI", "ticker": str(ticker).zfill(6), "name": name,
        "status": "ready", "phase": PHASE_WORLD_MARKET, "created_at": now, "updated_at": now,
        "simulation_days": simulation_days, "current_day_index": 0,
        "initial_cash": cash, "initial_equity": initial_equity, "cash": cash,
        "position": {"quantity": quantity, "average_price": average_price}, "realized_pnl": 0,
        "current_price": int(previous_close), "initial_reference_price": int(previous_close),
        "personas": personas, "agent_profile_manifest": {
            "context_id": agent_profiles.get("context_id"), "schema_version": agent_profiles.get("schema_version"),
            "counts": agent_profiles.get("counts"), "generated_at": agent_profiles.get("generated_at"),
        },
        "world": world, "events": [], "revealed_events": [], "released_signals": [],
        "pending_orders": [], "fills": [], "agent_rounds": [], "decision_log": [], "user_decision_memory": [],
        # 평상시 거래일의 방향성 메모다. 실제 주문과 달리 시장 체결에는 영향을 주지
        # 않고, 마지막 투자 회고에서만 사용자의 판단 패턴을 비교한다.
        "daily_reflections": [],
        "history_candles": _real_candles(impact_history),
        "price_history": [{"step": 0, "label": "시뮬레이션 시작", "phase": "initial", "price": int(previous_close),
                           "market_date": str(impact_history[-1].get("trade_date") or ""), "real": True}],
        "impact_model": {**model, "scenario_price_method": "empirical_return_quantile_10_90_by_order_imbalance"},
        "market_psychology": {"groups": psychology_groups, "event_regime": {"direction": 0.0, "intensity": 0.0, "days_remaining": 0, "source_event_id": None}, "aggregate_sentiment": 0.0},
        "psychology_history": [], "settings": {"fee_rate": fee_rate, "sell_tax_rate": sell_tax_rate, "slippage_bps": slippage_bps, "context_mode": "world_agent_individual"},
        "initial_context_id": initial_context.get("context_id"), "initial_context": initial_context.get("analysis"),
        "initial_context_sources": initial_context.get("source_summary"),
    }


def submit_world_order(game: dict[str, Any], side: str, quantity: int, rationale: str = "", confidence: int | None = None) -> dict[str, Any]:
    if game.get("phase") != PHASE_WORLD_DECISION:
        raise TradingError("중요 사건이 공개된 판단 단계에서만 주문할 수 있습니다.")
    side = str(side).upper()
    if side not in ("BUY", "SELL") or not isinstance(quantity, int) or quantity <= 0:
        raise TradingError("매수·매도 방향과 1주 이상의 수량이 필요합니다.")
    pending_sell = sum(int(order["quantity"]) for order in game.get("pending_orders", []) if order["side"] == "SELL")
    if side == "SELL" and pending_sell + quantity > int(game["position"]["quantity"]):
        raise TradingError("보유 수량을 초과하여 매도할 수 없습니다.")
    active_event = (game.get("world") or {}).get("active_event") or {}
    order = {
        "order_id": f"ord_{uuid.uuid4().hex[:10]}", "side": side, "quantity": quantity,
        "status": "pending", "phase": PHASE_WORLD_DECISION, "event_id": active_event.get("event_id"),
        "rationale": str(rationale or "").strip()[:500], "confidence": confidence,
        "submitted_at": datetime.now().isoformat(),
    }
    game["pending_orders"].append(order)
    return order


DAILY_REFLECTION_LABELS = {
    "BUY_WATCH": "내일 매수 고려",
    "HOLD_WATCH": "관찰 계속",
    "SELL_WATCH": "내일 매도 고려",
}


def _ensure_world_daily_reflection(game: dict[str, Any], latest: dict[str, Any]) -> None:
    """Persist the neutral learning stance when the user did not choose one."""
    market_date = str(latest.get("market_date") or "")
    if not market_date:
        return
    reflections = game.setdefault("daily_reflections", [])
    if any(row.get("market_date") == market_date for row in reflections):
        return
    reflections.append({
        "market_date": market_date,
        "stance": "HOLD_WATCH",
        "label": DAILY_REFLECTION_LABELS["HOLD_WATCH"],
        "market_return_pct": latest.get("return_pct"),
        "market_summary": latest.get("market_summary"),
        "recorded_at": datetime.now().isoformat(),
        "source": "default",
    })


def record_world_daily_reflection(game: dict[str, Any], stance: str, quantity: int | None = None) -> dict[str, Any]:
    """Save a daily stance and optionally queue a personal paper-trading order."""
    if game.get("mode") != "world":
        raise TradingError("일일 판단 기록은 World Agent 모의투자에서만 지원합니다.")
    if game.get("phase") not in (PHASE_WORLD_MARKET, PHASE_WORLD_DECISION, PHASE_COMPLETED):
        raise TradingError("현재 거래일에는 일일 판단을 기록할 수 없습니다.")
    stance = str(stance or "").upper()
    if stance not in DAILY_REFLECTION_LABELS:
        raise TradingError("매수 고려, 관찰, 매도 고려 중 하나를 선택해주세요.")
    rounds = game.get("agent_rounds") or []
    event = (game.get("world") or {}).get("active_event") if game.get("phase") == PHASE_WORLD_DECISION else None
    if not rounds and not event:
        raise TradingError("첫 거래일이 열린 뒤 오늘의 판단을 기록할 수 있습니다.")
    latest = rounds[-1] if rounds else {}
    market_date = str((event or {}).get("event_date") or latest.get("market_date") or "")
    if not market_date:
        raise TradingError("오늘의 시장 날짜를 확인하지 못했습니다.")
    requested_quantity = int(quantity or 0)
    if stance == "HOLD_WATCH":
        requested_quantity = 0
    elif requested_quantity < 1:
        raise TradingError("매수·매도 고려를 선택하면 1주 이상의 수량을 입력해주세요.")
    reflections = game.setdefault("daily_reflections", [])
    existing = next((row for row in reflections if row.get("market_date") == market_date), None)
    if existing and existing.get("order_id"):
        raise TradingError("오늘 판단 주문은 이미 기록되었습니다.")
    order = None
    if requested_quantity:
        side = "BUY" if stance == "BUY_WATCH" else "SELL"
        pending_orders = game.setdefault("pending_orders", [])
        pending_sell = sum(int(row.get("quantity") or 0) for row in pending_orders if row.get("side") == "SELL")
        position_quantity = int((game.get("position") or {}).get("quantity") or 0)
        if side == "SELL" and pending_sell + requested_quantity > position_quantity:
            raise TradingError("보유 수량을 초과하여 매도할 수 없습니다.")
        if side == "BUY":
            settings = game.get("settings") or {}
            fee_rate = float(settings.get("fee_rate") or 0)
            estimated_cost = requested_quantity * int(game.get("current_price") or 0)
            estimated_fee = round(estimated_cost * fee_rate)
            if estimated_cost + estimated_fee > int(game.get("cash") or 0):
                raise TradingError("현재 현금으로 입력한 매수 수량을 체결할 수 없습니다.")
        order = {
            "order_id": f"ord_{uuid.uuid4().hex[:10]}", "side": side,
            "quantity": requested_quantity, "status": "pending",
            "phase": "daily_reflection", "market_date": market_date,
            "event_id": (event or {}).get("event_id"),
            "rationale": DAILY_REFLECTION_LABELS[stance], "confidence": None,
            "submitted_at": datetime.now().isoformat(),
        }
        pending_orders.append(order)
    reflection = {
        "market_date": market_date,
        "stance": stance,
        "label": DAILY_REFLECTION_LABELS[stance],
        "quantity": requested_quantity or None,
        "order_side": order["side"] if order else None,
        "order_id": order["order_id"] if order else None,
        "market_return_pct": latest.get("return_pct") if latest.get("market_date") == market_date else None,
        "market_summary": latest.get("market_summary") if latest.get("market_date") == market_date else None,
        "event_id": (event or {}).get("event_id"),
        "recorded_at": datetime.now().isoformat(),
        "source": "user",
    }
    for index, existing in enumerate(reflections):
        if existing.get("market_date") == market_date:
            reflections[index] = reflection
            break
    else:
        reflections.append(reflection)
    game["updated_at"] = datetime.now().isoformat()
    return reflection


def _run_market_agents(
    game: dict[str, Any], market_date: str, information: dict[str, Any], phase: str,
    progress: Callable[[int, int, str], None] | None,
) -> dict[str, Any]:
    return run_individual_agent_round(
        game, market_date=market_date, world_information=information, phase=phase, progress=progress,
    )


def _advance_world_market_day(game: dict[str, Any], *, progress: Callable[[int, str], None] | None = None) -> dict[str, Any]:
    if game.get("phase") != PHASE_WORLD_MARKET:
        raise TradingError("현재는 다음 거래일 환경을 진행할 수 없습니다.")
    step = advance_environment(game)
    if step["completed"]:
        return {"completed": True, "phase": game["phase"]}
    market_date = step["market_date"]
    information = public_world_information(game, market_date)
    event = step.get("event")
    # 중요한 사건은 같은 공개 정보로 사용자와 에이전트가 판단하도록 우선 멈춘다.
    if event and float(event.get("impact_score") or 0) >= .55:
        game["phase"] = PHASE_WORLD_DECISION
        game["status"] = "awaiting_user"
        game["updated_at"] = datetime.now().isoformat()
        return {"completed": False, "awaiting_user": True, "market_date": market_date, "event": event}
    if progress:
        progress(8, f"{market_date} World Agent 환경을 공개했습니다.")
    def agent_progress(done: int, total: int, agent_id: str) -> None:
        if progress:
            progress(10 + round(78 * done / max(total, 1)), f"{market_date} 개별 에이전트 판단 {done}/{total} · {agent_id}")
    phase = "event_reaction" if event else "inter_event"
    round_data = _run_market_agents(game, market_date, information, phase, agent_progress)
    result = apply_agent_round(game, round_data, phase=phase, label=f"{market_date} · World Agent 시장 진행", market_date=market_date)
    # 사용자의 판단은 시장 형성 이후 개인 계좌에만 다음 거래일 가격으로 체결한다.
    result["user_fills"] = _execute_user_orders(game, market_date)
    record_market_feedback(game, result, market_date)
    result["market_summary_detail"] = generate_daily_market_summary(game, result, information, event)
    result["market_summary"] = result["market_summary_detail"]["summary"]
    _ensure_world_daily_reflection(game, result)
    _record_daily_performance(game, market_date)
    game["current_day_index"] = int(game["world"]["current_day"])
    game["phase"] = PHASE_COMPLETED if game["current_day_index"] >= game["simulation_days"] else PHASE_WORLD_MARKET
    game["status"] = "completed" if game["phase"] == PHASE_COMPLETED else "ready"
    game["updated_at"] = datetime.now().isoformat()
    return {"completed": game["phase"] == PHASE_COMPLETED, "awaiting_user": False, "market_date": market_date, "round": result}


def advance_world_market(game: dict[str, Any], *, days: int = 1,
                         progress: Callable[[int, str], None] | None = None) -> dict[str, Any]:
    """Advance one or more trading days, stopping before every important event."""
    requested_days = max(1, min(int(days or 1), max(1, int(game.get("simulation_days") or 1))))
    progressed: list[dict[str, Any]] = []
    result: dict[str, Any] = {}
    for index in range(requested_days):
        if game.get("phase") != PHASE_WORLD_MARKET:
            break
        result = _advance_world_market_day(game, progress=progress)
        progressed.append(result)
        if result.get("awaiting_user") or result.get("completed"):
            break
        if progress and requested_days > 1:
            progress(min(96, 10 + round(86 * (index + 1) / requested_days)),
                     f"{index + 1}/{requested_days} 거래일을 진행했습니다.")
    return {**result, "advanced_days": len(progressed), "requested_days": requested_days}


def resolve_world_decision(game: dict[str, Any], *, progress: Callable[[int, str], None] | None = None) -> dict[str, Any]:
    if game.get("phase") != PHASE_WORLD_DECISION:
        raise TradingError("현재는 사용자 판단을 반영할 사건이 없습니다.")
    world = game["world"]
    event = world.get("active_event")
    if not event:
        raise TradingError("공개된 World Agent 사건을 찾을 수 없습니다.")
    market_date = str(event["event_date"])
    information = public_world_information(game, market_date)
    user_fills = _execute_user_orders(game, market_date)
    if progress:
        progress(8, "사용자 판단을 저장하고 개별 에이전트 반응을 생성합니다.")
    def agent_progress(done: int, total: int, agent_id: str) -> None:
        if progress:
            progress(10 + round(78 * done / max(total, 1)), f"{market_date} 개별 에이전트 판단 {done}/{total} · {agent_id}")
    round_data = _run_market_agents(game, market_date, information, "event_reaction", agent_progress)
    result = apply_agent_round(game, round_data, phase="event_reaction", label=f"{market_date} · WORLD EVENT {event['sequence']} · {event['title']}", market_date=market_date)
    daily_reflection = next(
        (row for row in game.get("daily_reflections", []) if row.get("market_date") == market_date),
        None,
    )
    game["decision_log"].append({"event_id": event["event_id"], "phase": PHASE_WORLD_DECISION, "user_fills": user_fills, "user_stance": (daily_reflection or {}).get("stance"), "price_before": result["previous_price"], "price_after": result["price"]})
    game["user_decision_memory"].append({
        "event_id": event["event_id"], "event_title": event["title"], "market_date": market_date,
        "public_signal": event.get("public_signal"), "user_stance": (daily_reflection or {}).get("stance"), "user_fills": user_fills,
        "orders": [dict(row) for row in game.get("fills", [])[-len(user_fills):]] if user_fills else [],
        "world_state": information.get("world_state"),
    })
    record_market_feedback(game, result, market_date)
    result["market_summary_detail"] = generate_daily_market_summary(game, result, information, event)
    result["market_summary"] = result["market_summary_detail"]["summary"]
    _ensure_world_daily_reflection(game, result)
    _record_daily_performance(game, market_date)
    game["current_day_index"] = int(world["current_day"])
    game["phase"] = PHASE_COMPLETED if game["current_day_index"] >= game["simulation_days"] else PHASE_WORLD_MARKET
    game["status"] = "completed" if game["phase"] == PHASE_COMPLETED else "ready"
    game["updated_at"] = datetime.now().isoformat()
    return {"completed": game["phase"] == PHASE_COMPLETED, "user_fills": user_fills, "round": result}


def world_portfolio(game: dict[str, Any]) -> dict[str, Any]:
    return scenario_portfolio(game)
