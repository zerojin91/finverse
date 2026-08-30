"""Deterministic KOSPI paper-trading domain engine.

LLMs may propose sentiment, but this module alone owns cash, positions, fills,
and prices.  Money is stored as integer KRW and Korean equities trade in whole
shares.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
import hashlib
import json
import math
import random
from typing import Any
import uuid

from .ontology import standardize_market_context


INVESTOR_GROUPS = ("retail", "foreign", "institution", "pension")


class TradingError(ValueError):
    """Raised when a paper-trading command violates a domain rule."""


def krx_tick_size(price: int | float) -> int:
    """Return the KRX equity quotation unit for a KRW price band."""
    price = max(0, float(price))
    if price < 2_000:
        return 1
    if price < 5_000:
        return 5
    if price < 20_000:
        return 10
    if price < 50_000:
        return 50
    if price < 200_000:
        return 100
    if price < 500_000:
        return 500
    return 1_000


def round_to_krx_tick(price: int | float) -> int:
    """Round a simulated price to the nearest valid KRX quotation price."""
    price = max(1.0, float(price))
    tick = krx_tick_size(price)
    rounded = max(tick, round(price / tick) * tick)
    final_tick = krx_tick_size(rounded)
    return max(final_tick, round(rounded / final_tick) * final_tick)


@dataclass(frozen=True)
class MarketDay:
    trade_date: str
    open: int
    high: int
    low: int
    close: int
    volume: int
    trading_value: int
    price_source: str | None = None
    investor_flow_scope: str = "unknown"
    investor_flow: dict[str, int] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "MarketDay":
        required = ("trade_date", "open", "high", "low", "close", "volume", "trading_value")
        missing = [key for key in required if value.get(key) is None]
        if missing:
            raise TradingError(f"시장 데이터 필드가 누락되었습니다: {', '.join(missing)}")
        day = cls(
            trade_date=str(value["trade_date"]),
            open=int(value["open"]), high=int(value["high"]),
            low=int(value["low"]), close=int(value["close"]),
            volume=int(value["volume"]), trading_value=int(value["trading_value"]),
            price_source=(str(value["price_source"]) if value.get("price_source") else None),
            investor_flow_scope=str(value.get("investor_flow_scope") or "unknown"),
            investor_flow={k: int(v) for k, v in (value.get("investor_flow") or {}).items()},
            events=list(value.get("events") or []),
        )
        if min(day.open, day.high, day.low, day.close, day.volume, day.trading_value) <= 0:
            raise TradingError("가격, 거래량, 거래대금은 0보다 커야 합니다.")
        if day.low > min(day.open, day.close) or day.high < max(day.open, day.close):
            raise TradingError(f"OHLC 범위가 올바르지 않습니다: {day.trade_date}")
        return day


@dataclass
class Persona:
    persona_id: str
    group: str
    strategy: str
    capital: int
    risk_tolerance: float
    trend_sensitivity: float
    event_sensitivity: float
    flow_sensitivity: float
    cash: int = 0
    quantity: int = 0
    average_price: int = 0
    realized_pnl: int = 0
    platforms: list[str] = field(default_factory=list)
    social_influence: float = 0.0


DEFAULT_PERSONA_COUNTS = {
    "retail": 20,
    "foreign": 8,
    "institution": 8,
    "pension": 4,
}

GROUP_STRATEGIES = {
    "retail": ("momentum", "news_reactive", "loss_averse", "value"),
    "foreign": ("foreign_institution_macro", "fx_sensitive", "global_large_cap"),
    "institution": ("active_fund", "short_term_flow", "fundamental"),
    "pension": ("long_horizon", "rebalancing", "low_volatility"),
}


def build_personas(counts: dict[str, int] | None, seed: str,
                   initial_price: int | None = None) -> list[Persona]:
    requested = {**DEFAULT_PERSONA_COUNTS, **(counts or {})}
    unknown = set(requested) - set(INVESTOR_GROUPS)
    if unknown:
        raise TradingError(f"지원하지 않는 투자자 그룹입니다: {', '.join(sorted(unknown))}")
    if any(not isinstance(v, int) or v < 0 or v > 500 for v in requested.values()):
        raise TradingError("그룹별 페르소나 수는 0~500의 정수여야 합니다.")
    if sum(requested.values()) == 0:
        raise TradingError("페르소나는 최소 1명 이상이어야 합니다.")

    rng = random.Random(seed)
    result: list[Persona] = []
    base_capital = {"retail": 100_000_000, "foreign": 30_000_000_000,
                    "institution": 20_000_000_000, "pension": 50_000_000_000}
    for group in INVESTOR_GROUPS:
        for index in range(requested[group]):
            capital = int(base_capital[group] * rng.uniform(0.65, 1.35))
            allocation = {"retail": .25, "foreign": .35, "institution": .45, "pension": .60}[group]
            initial_quantity = int(capital * allocation / initial_price) if initial_price else 0
            platform_pool = {
                "retail": (("reddit", "x"), ("x",), ("reddit",)),
                "foreign": (("x",), ("reddit", "x"), ()),
                "institution": (("x",), (), ("reddit", "x")),
                "pension": ((), (), ("x",)),
            }[group]
            platforms = list(rng.choice(platform_pool))
            result.append(Persona(
                persona_id=f"{group}_{index + 1:03d}", group=group,
                strategy=rng.choice(GROUP_STRATEGIES[group]),
                capital=capital,
                risk_tolerance=round(rng.uniform(0.2, 0.9), 3),
                trend_sensitivity=round(rng.uniform(0.2, 1.0), 3),
                event_sensitivity=round(rng.uniform(0.2, 1.0), 3),
                flow_sensitivity=round(rng.uniform(0.2, 1.0), 3),
                cash=capital - initial_quantity * (initial_price or 0),
                quantity=initial_quantity,
                average_price=initial_price or 0,
                platforms=platforms,
                social_influence=round(rng.uniform(.35, .9), 3) if platforms else 0.0,
            ))
    return result


def new_game(ticker: str, name: str, market_days: list[dict[str, Any]], *,
             previous_close: int | None = None,
             impact_history: list[dict[str, Any]] | None = None,
             initial_cash: int = 100_000_000,
             persona_counts: dict[str, int] | None = None,
             fee_rate: float = 0.00015, sell_tax_rate: float = 0.0018,
             slippage_bps: float = 5.0,
             llm_enabled: bool = False) -> dict[str, Any]:
    ticker = str(ticker).zfill(6)
    if not ticker.isdigit() or len(ticker) != 6:
        raise TradingError("KOSPI 종목 코드는 6자리 숫자여야 합니다.")
    if initial_cash <= 0:
        raise TradingError("초기 자본은 0원보다 커야 합니다.")
    days = [MarketDay.from_dict(item) for item in market_days]
    if not days:
        raise TradingError("거래일 데이터가 최소 1개 필요합니다.")
    if previous_close is None or int(previous_close) <= 0:
        raise TradingError("시작일 이전 거래일의 종가(previous_close)가 필요합니다.")
    if [d.trade_date for d in days] != sorted({d.trade_date for d in days}):
        raise TradingError("거래일은 중복 없이 오름차순이어야 합니다.")
    for rate, label in ((fee_rate, "수수료율"), (sell_tax_rate, "매도세율")):
        if not 0 <= rate < 0.1:
            raise TradingError(f"{label} 범위가 올바르지 않습니다.")
    if not 0 <= slippage_bps <= 1_000:
        raise TradingError("슬리피지는 0~1,000bp 범위여야 합니다.")

    game_id = f"kospi_{uuid.uuid4().hex[:12]}"
    personas = build_personas(persona_counts, game_id, int(previous_close))
    impact_model = calibrate_impact_model(impact_history or [])
    now = datetime.now().isoformat()
    return {
        "game_id": game_id, "market": "KOSPI", "ticker": ticker, "name": name,
        "status": "ready", "created_at": now, "updated_at": now,
        "initial_reference_price": int(previous_close),
        "current_day_index": 0, "initial_cash": int(initial_cash),
        "cash": int(initial_cash), "position": {"quantity": 0, "average_price": 0},
        "realized_pnl": 0, "pending_orders": [], "fills": [], "daily_results": [],
        "social_signals": {}, "llm_market_rounds": {}, "llm_persona_decisions": {},
        "market_days": [asdict(day) for day in days],
        "personas": [asdict(p) for p in personas],
        "impact_model": impact_model,
        "settings": {"fee_rate": fee_rate, "sell_tax_rate": sell_tax_rate,
                     "slippage_bps": slippage_bps,
                     "llm_enabled": bool(llm_enabled),
                     "context_mode": "integrated"},
    }


def calibrate_impact_model(history: list[dict[str, Any]]) -> dict[str, Any]:
    """Calibrate price response from sessions strictly before the game starts."""
    closes = []
    dates = []
    for day in history:
        try:
            close = int(day["close"])
        except (KeyError, TypeError, ValueError):
            continue
        if close > 0:
            closes.append(close)
            dates.append(str(day.get("trade_date") or ""))
    returns = [(closes[index] / closes[index - 1] - 1) * 100
               for index in range(1, len(closes)) if closes[index - 1] > 0]
    if not returns:
        return {"method": "historical_return_unavailable", "sample_days": len(closes),
                "daily_rms_pct": 0.0, "absolute_return_p90_pct": 0.0,
                "history_start": dates[0] if dates else None,
                "history_end": dates[-1] if dates else None}
    rms = math.sqrt(sum(value * value for value in returns) / len(returns))
    ordered = sorted(abs(value) for value in returns)
    p90 = ordered[min(len(ordered) - 1, math.ceil(len(ordered) * .9) - 1)]
    return {"method": "historical_rms_x_order_imbalance",
            "sample_days": len(closes), "return_samples": len(returns),
            "daily_rms_pct": round(rms, 4),
            "absolute_return_p90_pct": round(p90, 4),
            "return_distribution_pct": [round(value, 6) for value in sorted(returns)],
            "history_start": dates[0], "history_end": dates[-1]}


def public_game(game: dict[str, Any], include_market_days: bool = False) -> dict[str, Any]:
    result = {k: v for k, v in game.items() if k != "market_days"}
    index = game["current_day_index"]
    days = game["market_days"]
    result["current_day"] = decision_snapshot(game) if index < len(days) else None
    result["total_days"] = len(days)
    result["persona_summary"] = {
        group: sum(1 for p in game["personas"] if p["group"] == group)
        for group in INVESTOR_GROUPS
    }
    if include_market_days:
        result["market_days"] = days
    mark = (game["daily_results"][-1]["simulated_close"] if game["daily_results"]
            else game["initial_reference_price"])
    result["portfolio"] = portfolio_snapshot(game, mark)
    return result


def decision_snapshot(game: dict[str, Any]) -> dict[str, Any] | None:
    """Return only information available before the current session opens."""
    index = game["current_day_index"]
    if index >= len(game["market_days"]):
        return None
    day = game["market_days"][index]
    previous_close = (game["daily_results"][-1]["simulated_close"]
                      if game["daily_results"] else game["initial_reference_price"])
    return {
        "trade_date": day["trade_date"],
        "previous_close": previous_close,
        "events": [event for event in day.get("events", [])
                   if event.get("available_before_open") is True],
        "social_signals": game.get("social_signals", {}).get(day["trade_date"], {}),
        "information_phase": "pre_open",
    }


def submit_order(game: dict[str, Any], side: str, quantity: int,
                 rationale: str = "", confidence: int | None = None) -> dict[str, Any]:
    if game["status"] == "completed":
        raise TradingError("완료된 게임에는 주문할 수 없습니다.")
    side = str(side).upper()
    if side not in ("BUY", "SELL"):
        raise TradingError("주문 방향은 BUY 또는 SELL이어야 합니다.")
    if not isinstance(quantity, int) or quantity <= 0:
        raise TradingError("주문 수량은 1주 이상의 정수여야 합니다.")
    if side == "SELL":
        pending_sell = sum(o["quantity"] for o in game["pending_orders"] if o["side"] == "SELL")
        if quantity + pending_sell > game["position"]["quantity"]:
            raise TradingError("보유 수량을 초과하여 매도할 수 없습니다.")
    rationale = str(rationale or "").strip()
    if len(rationale) > 500:
        raise TradingError("판단 근거는 500자 이하여야 합니다.")
    if confidence is not None and (not isinstance(confidence, int) or not 0 <= confidence <= 100):
        raise TradingError("확신도는 0~100의 정수여야 합니다.")
    order = {"order_id": f"ord_{uuid.uuid4().hex[:10]}", "side": side,
             "quantity": quantity, "status": "pending",
             "rationale": rationale, "confidence": confidence,
             "submitted_at": datetime.now().isoformat()}
    game["pending_orders"].append(order)
    game["updated_at"] = datetime.now().isoformat()
    return order


def set_social_signals(game: dict[str, Any], trade_date: str,
                       observations: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate normalized Reddit/X observations for an upcoming game day."""
    current = game["market_days"][game["current_day_index"]] if game["current_day_index"] < len(game["market_days"]) else None
    if not current or trade_date != current["trade_date"]:
        raise TradingError("소셜 심리는 현재 진행할 거래일에만 등록할 수 있습니다.")
    totals = {group: {"weighted": 0.0, "weight": 0.0, "mentions": 0,
                      "platforms": {"reddit": 0, "x": 0}} for group in INVESTOR_GROUPS}
    for item in observations:
        group = item.get("investor_group")
        platform = str(item.get("platform", "")).lower()
        if group not in INVESTOR_GROUPS:
            raise TradingError(f"지원하지 않는 투자자 그룹입니다: {group}")
        if platform not in ("reddit", "x"):
            raise TradingError("소셜 플랫폼은 reddit 또는 x여야 합니다.")
        sentiment = float(item.get("sentiment", 0))
        engagement = max(1.0, min(float(item.get("engagement", 1)), 10_000.0))
        if not -1 <= sentiment <= 1:
            raise TradingError("감성 점수는 -1.0~1.0이어야 합니다.")
        weight = 1 + math.log10(engagement)
        totals[group]["weighted"] += sentiment * weight
        totals[group]["weight"] += weight
        totals[group]["mentions"] += 1
        totals[group]["platforms"][platform] += 1
    summary = {}
    for group, values in totals.items():
        summary[group] = {"sentiment": round(values["weighted"] / values["weight"], 4) if values["weight"] else 0.0,
                          "mentions": values["mentions"], "platforms": values["platforms"]}
    game.setdefault("social_signals", {})[trade_date] = summary
    game["updated_at"] = datetime.now().isoformat()
    return summary


def inject_scenario_event(game: dict[str, Any], trade_date: str, title: str,
                          impact: float = 0.0, reveal_phase: str = "pre_open",
                          description: str = "") -> dict[str, Any]:
    """Add a known scenario event without changing already completed history."""
    title, description = str(title or "").strip(), str(description or "").strip()
    if not title or len(title) > 200 or len(description) > 1_000:
        raise TradingError("이벤트 제목은 1~200자, 설명은 1,000자 이하여야 합니다.")
    impact = float(impact)
    if not -1 <= impact <= 1:
        raise TradingError("이벤트 영향도는 -1.0~1.0이어야 합니다.")
    if reveal_phase not in ("pre_open", "after_close"):
        raise TradingError("공개 시점은 pre_open 또는 after_close여야 합니다.")
    target_index = next((index for index, day in enumerate(game["market_days"])
                         if day["trade_date"] == trade_date), None)
    if target_index is None:
        raise TradingError("게임 기간에 포함되지 않은 거래일입니다.")
    if target_index < game["current_day_index"]:
        raise TradingError("이미 완료된 거래일에는 이벤트를 추가할 수 없습니다.")
    event = {"event_id": f"evt_{uuid.uuid4().hex[:10]}", "title": title,
             "description": description, "impact": impact, "source": "scenario",
             "reveal_phase": reveal_phase,
             "available_before_open": reveal_phase == "pre_open"}
    game["market_days"][target_index].setdefault("events", []).append(event)
    game["updated_at"] = datetime.now().isoformat()
    return event


def _persona_orders(game: dict[str, Any], day: dict[str, Any]) -> list[dict[str, Any]]:
    seed = hashlib.sha256(f'{game["game_id"]}:{day["trade_date"]}'.encode()).hexdigest()
    rng = random.Random(seed)
    results = game["daily_results"]
    if len(results) >= 2:
        recent, prior = results[-1]["simulated_close"], results[-2]["simulated_close"]
        trend = max(-1.0, min(1.0, (recent - prior) / max(prior, 1) * 20))
    else:
        trend = 0.0
    known_events = [event for event in day.get("events", [])
                    if event.get("available_before_open") is True]
    event_score = sum(float(event.get("impact", 0)) for event in known_events)
    llm_decisions = game.get("llm_persona_decisions", {}).get(day["trade_date"], {})
    output = []
    for persona in game["personas"]:
        # Old saved games are upgraded lazily when first advanced.
        if "cash" not in persona:
            persona.update({"cash": persona["capital"], "quantity": 0,
                            "average_price": 0, "realized_pnl": 0,
                            "platforms": [], "social_influence": 0.0})
        social = game.get("social_signals", {}).get(day["trade_date"], {}).get(persona["group"], {})
        social_score = float(social.get("sentiment", 0)) if persona.get("platforms") else 0.0
        llm_decision = llm_decisions.get(persona["persona_id"])
        if llm_decision:
            side = llm_decision["side"]
            confidence = int(llm_decision.get("confidence", 50))
            score = (confidence / 100) * (1 if side == "BUY" else -1 if side == "SELL" else 0)
            allocation = float(llm_decision.get("allocation_pct", 0))
            base_amount = (persona["cash"] if side == "BUY"
                           else persona["quantity"] * day["open"] if side == "SELL" else 0)
            desired = int(base_amount * allocation)
            decision_source = "llm"
            rationale = str(llm_decision.get("rationale") or "")
        else:
            score = (trend * persona["trend_sensitivity"] +
                     event_score * persona["event_sensitivity"] +
                     social_score * persona.get("social_influence", 0.0) + rng.uniform(-0.35, 0.35))
            side = "BUY" if score > 0.2 else "SELL" if score < -0.2 else "HOLD"
            participation = min(0.015, 0.001 + abs(score) * 0.004 * persona["risk_tolerance"])
            desired = 0 if side == "HOLD" else int(persona["capital"] * participation)
            decision_source = "rules"
            rationale = ""
        if side == "BUY":
            quantity = min(int(desired / day["open"]), int(persona["cash"] / day["open"]))
        elif side == "SELL":
            quantity = min(int(desired / day["open"]), int(persona["quantity"]))
        else:
            quantity = 0
        if quantity <= 0:
            side = "HOLD"
        notional = quantity * day["open"]
        output.append({"persona_id": persona["persona_id"], "group": persona["group"],
                       "strategy": persona["strategy"], "side": side,
                       "decision_source": decision_source, "rationale": rationale,
                       "platforms": persona.get("platforms", []),
                       "social_sentiment": round(social_score, 4),
                       "quantity": quantity, "notional": notional, "score": round(score, 4)})
    return output


def _execute_persona_orders(game: dict[str, Any], orders: list[dict[str, Any]], price: int) -> None:
    by_id = {persona["persona_id"]: persona for persona in game["personas"]}
    for order in orders:
        if order["side"] == "HOLD" or order["quantity"] <= 0:
            continue
        persona = by_id[order["persona_id"]]
        quantity = order["quantity"]
        gross = quantity * price
        if order["side"] == "BUY":
            quantity = min(quantity, persona["cash"] // price)
            if quantity <= 0:
                continue
            gross = quantity * price
            old_cost = persona["quantity"] * persona["average_price"]
            persona["quantity"] += quantity
            persona["cash"] -= gross
            persona["average_price"] = round((old_cost + gross) / persona["quantity"])
        else:
            quantity = min(quantity, persona["quantity"])
            gross = quantity * price
            persona["cash"] += gross
            persona["realized_pnl"] += (price - persona["average_price"]) * quantity
            persona["quantity"] -= quantity
            if persona["quantity"] == 0:
                persona["average_price"] = 0
        order["filled_quantity"] = quantity
        order["fill_price"] = price


def _execute_user_orders(game: dict[str, Any], day: dict[str, Any]) -> list[dict[str, Any]]:
    settings = game["settings"]
    fills = []
    for order in list(game["pending_orders"]):
        direction = 1 if order["side"] == "BUY" else -1
        price = round_to_krx_tick(
            day["open"] * (1 + direction * settings["slippage_bps"] / 10_000))
        gross = price * order["quantity"]
        fee = round(gross * settings["fee_rate"])
        tax = round(gross * settings["sell_tax_rate"]) if direction < 0 else 0
        fill_pnl = 0
        if direction > 0:
            total = gross + fee
            if total > game["cash"]:
                order["status"] = "rejected"
                order["reason"] = "insufficient_cash"
                continue
            old_qty = game["position"]["quantity"]
            old_cost = old_qty * game["position"]["average_price"]
            new_qty = old_qty + order["quantity"]
            game["cash"] -= total
            game["position"] = {"quantity": new_qty,
                                "average_price": round((old_cost + gross) / new_qty)}
        else:
            if order["quantity"] > game["position"]["quantity"]:
                order["status"] = "rejected"
                order["reason"] = "insufficient_position"
                continue
            average = game["position"]["average_price"]
            game["cash"] += gross - fee - tax
            fill_pnl = (price - average) * order["quantity"] - fee - tax
            game["realized_pnl"] += fill_pnl
            remaining = game["position"]["quantity"] - order["quantity"]
            game["position"] = {"quantity": remaining,
                                "average_price": average if remaining else 0}
        order["status"] = "filled"
        fill = {**order, "trade_date": day["trade_date"], "price": price,
                "gross_amount": gross, "fee": fee, "tax": tax}
        fill["realized_pnl"] = fill_pnl
        fills.append(fill)
        game["fills"].append(fill)
    game["pending_orders"] = []
    return fills


def advance_one_day(game: dict[str, Any]) -> dict[str, Any]:
    index = game["current_day_index"]
    if index >= len(game["market_days"]):
        raise TradingError("모든 거래일이 이미 처리되었습니다.")
    day = game["market_days"][index]
    ontology_context = _day_ontology_context(game, day["trade_date"])
    persona_orders = _persona_orders(game, day)
    buy = sum(o["notional"] for o in persona_orders if o["side"] == "BUY")
    sell = sum(o["notional"] for o in persona_orders if o["side"] == "SELL")
    net = buy - sell
    gross = buy + sell
    imbalance = net / gross if gross else 0.0
    impact_model = game.get("impact_model") or {}
    market_context = standardize_market_context(
        game.get("ontology_snapshot") or {}, day["trade_date"])
    historical_rms = float(impact_model.get("daily_rms_pct", 0))
    historical_p90 = float(impact_model.get("absolute_return_p90_pct", 0))
    raw_impact = imbalance * historical_rms
    order_impact_pct = max(-historical_p90, min(historical_p90, raw_impact)) if historical_p90 else 0.0
    impact_pct = order_impact_pct + market_context["price_return_contribution_pct"]
    simulated_close = round_to_krx_tick(day["close"] * (1 + impact_pct / 100))
    _execute_persona_orders(game, persona_orders, simulated_close)
    fills = _execute_user_orders(game, day)
    portfolio = portfolio_snapshot(game, simulated_close)
    group_summary = {}
    for group in INVESTOR_GROUPS:
        selected = [o for o in persona_orders if o["group"] == group]
        group_summary[group] = {
            "buy_notional": sum(o["notional"] for o in selected if o["side"] == "BUY"),
            "sell_notional": sum(o["notional"] for o in selected if o["side"] == "SELL"),
            "buy_count": sum(o["side"] == "BUY" for o in selected),
            "sell_count": sum(o["side"] == "SELL" for o in selected),
            "hold_count": sum(o["side"] == "HOLD" for o in selected),
        }
    result = {"trade_date": day["trade_date"], "reference_ohlc": {
                  key: day[key] for key in ("open", "high", "low", "close")},
              "simulated_close": simulated_close, "price_impact_pct": round(impact_pct, 4),
              "price_impact_components": {"persona_order": round(order_impact_pct, 4),
                                           "market_context": market_context},
              "context_mode": game.get("settings", {}).get("context_mode", "integrated"),
              "price_impact_model": {**impact_model,
                                     "buy_notional": buy, "sell_notional": sell,
                                     "order_imbalance": round(imbalance, 6)},
              "persona_net_order": net, "persona_groups": group_summary,
              "persona_orders": persona_orders, "user_fills": fills,
              "released_investor_flow": day.get("investor_flow", {}),
              "released_investor_flow_scope": day.get("investor_flow_scope", "unknown"),
              "information_audit": {
                  "decision_phase": "pre_open",
                  "known_previous_close": (game["daily_results"][-1]["simulated_close"]
                                           if game["daily_results"] else game["initial_reference_price"]),
                  "known_events": [event for event in day.get("events", [])
                                   if event.get("available_before_open") is True],
                  "hidden_until_close": ["open", "high", "low", "close", "volume",
                                         "trading_value", "investor_flow"],
              },
              "social_signals": game.get("social_signals", {}).get(day["trade_date"], {}),
              "ontology_market_context": ontology_context,
              "events": day.get("events", []), "portfolio": portfolio}
    game["daily_results"].append(result)
    game["current_day_index"] += 1
    game["status"] = "completed" if game["current_day_index"] >= len(game["market_days"]) else "ready"
    game["updated_at"] = datetime.now().isoformat()
    return result


def _day_ontology_context(game: dict[str, Any], trade_date: str) -> dict[str, Any]:
    snapshot = game.get("ontology_snapshot") or {}
    return {
        "indices": [row for row in snapshot.get("index_observations", [])
                    if row.get("trade_date") == trade_date][-4:],
        "macro": [row for row in snapshot.get("macro_observations", [])
                  if row.get("trade_date") == trade_date][:12],
        "foreign_holding": [row for row in snapshot.get("foreign_holdings", [])
                             if row.get("trade_date") == trade_date][-1:],
        "coverage": game.get("ontology_coverage", {}),
    }


def portfolio_snapshot(game: dict[str, Any], mark_price: int) -> dict[str, Any]:
    quantity = game["position"]["quantity"]
    market_value = quantity * mark_price
    equity = game["cash"] + market_value
    unrealized = (mark_price - game["position"]["average_price"]) * quantity
    return {"cash": game["cash"], "quantity": quantity,
            "average_price": game["position"]["average_price"], "mark_price": mark_price,
            "market_value": market_value, "equity": equity,
            "realized_pnl": game["realized_pnl"], "unrealized_pnl": unrealized,
            "total_return_pct": round((equity / game["initial_cash"] - 1) * 100, 4)}
