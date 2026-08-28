"""Standardize normalized market observations into simulation signals."""

from __future__ import annotations

import math
from typing import Any


# Initial conservative coefficients. They are configuration, not hidden magic:
# validation can replace them after the historical event benchmark is built.
CONTEXT_IMPACT_COEFFICIENTS = {
    "benchmark_return": 0.65,
    "foreign_holding_delta": 0.20,
    "macro_change": 0.25,
    "social_sentiment": 0.15,
}


def _clip(value: float, lower: float = -1.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, float(value)))


def _as_float(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _prior_value(rows: list[dict[str, Any]], date_key: str, field: str) -> float | None:
    prior = [(_as_float(row.get(field)), str(row.get("trade_date") or ""))
             for row in rows if str(row.get("trade_date") or "") < date_key]
    prior = [item for item in prior if item[0] is not None]
    return prior[-1][0] if prior else None


def standardize_market_context(snapshot: dict[str, Any], trade_date: str) -> dict[str, Any]:
    """Create bounded, auditable signals for one point-in-time session.

    Missing observations remain explicit in ``availability`` and contribute
    zero to the price signal. No future row is consulted.
    """
    indices = [row for row in snapshot.get("index_observations", [])
               if str(row.get("trade_date")) == trade_date]
    benchmark = [(_as_float(row.get("change_pct")), row.get("name")) for row in indices]
    benchmark = [value for value, name in benchmark if value is not None and
                 str(name or "").lower() in ("kospi", "코스피")]
    benchmark_pct = sum(benchmark) / len(benchmark) if benchmark else 0.0

    holdings = [row for row in snapshot.get("foreign_holdings", [])
                if str(row.get("trade_date")) <= trade_date]
    holdings.sort(key=lambda row: str(row.get("trade_date") or ""))
    current_holding = _as_float(holdings[-1].get("held_pct")) if holdings else None
    previous_holding = _as_float(holdings[-2].get("held_pct")) if len(holdings) > 1 else None
    holding_delta = (current_holding - previous_holding) if current_holding is not None and previous_holding is not None else 0.0

    macro_rows = [row for row in snapshot.get("macro_observations", [])
                  if str(row.get("trade_date")) == trade_date]
    macro_changes = []
    all_macro = snapshot.get("macro_observations", [])
    for row in macro_rows:
        value = _as_float(row.get("value"))
        series = row.get("series_code")
        prior = _prior_value([candidate for candidate in all_macro
                              if candidate.get("series_code") == series], trade_date, "value")
        if value is not None and prior not in (None, 0):
            macro_changes.append(_clip((value - prior) / abs(prior)))
    macro_signal = sum(macro_changes) / len(macro_changes) if macro_changes else 0.0

    social_rows = [row for row in snapshot.get("social_signals", [])
                   if str(row.get("trade_date")) == trade_date]
    social_values = [_as_float(row.get("sentiment")) for row in social_rows]
    social_values = [value for value in social_values if value is not None]
    social_signal = sum(social_values) / len(social_values) if social_values else 0.0

    normalized = {
        "benchmark_return_pct": round(_clip(benchmark_pct / 8.0) * 8.0, 6),
        "foreign_holding_delta_pct_point": round(_clip(holding_delta / 1.0), 6),
        "macro_change_signal": round(_clip(macro_signal), 6),
        "social_sentiment_signal": round(_clip(social_signal), 6),
    }
    normalized["price_return_contribution_pct"] = round(
        CONTEXT_IMPACT_COEFFICIENTS["benchmark_return"] * normalized["benchmark_return_pct"]
        + CONTEXT_IMPACT_COEFFICIENTS["foreign_holding_delta"] * normalized["foreign_holding_delta_pct_point"]
        + CONTEXT_IMPACT_COEFFICIENTS["macro_change"] * normalized["macro_change_signal"]
        + CONTEXT_IMPACT_COEFFICIENTS["social_sentiment"] * normalized["social_sentiment_signal"], 6)
    normalized["availability"] = {
        "benchmark": bool(benchmark), "foreign_holding": current_holding is not None,
        "macro": bool(macro_changes), "social": bool(social_values),
    }
    normalized["coefficients"] = dict(CONTEXT_IMPACT_COEFFICIENTS)
    return normalized
