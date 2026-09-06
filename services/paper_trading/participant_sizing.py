"""Historical representative sizing for World-mode market participants.

Each persona still makes an independent decision.  This module only answers a
different question: how much market notional should a group represent when a
small synthetic population stands in for the real market?  The answer is
calibrated from the selected security's historical trading value and, when
available, its investor-flow observations.
"""

from __future__ import annotations

from statistics import median
from typing import Any


INVESTOR_GROUPS = ("retail", "foreign", "institution", "pension")
# Used only when a security has no usable investor-flow observations.  It is a
# fallback, not a claim about the security's actual investor composition.
DEFAULT_GROUP_WEIGHTS = {
    "retail": 0.55,
    "foreign": 0.20,
    "institution": 0.20,
    "pension": 0.05,
}
REPRESENTATIVE_PARTICIPATION_RATE = 0.35
MAX_PERSONA_CAPITAL_SCALE = 250.0


def _positive_number(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number > 0 else 0.0


def _total_trading_value(day: dict[str, Any]) -> float:
    trading_value = _positive_number(day.get("trading_value"))
    if trading_value:
        return trading_value
    return _positive_number(day.get("volume")) * _positive_number(day.get("close"))


def _normalize(values: dict[str, float], fallback: dict[str, float]) -> dict[str, float]:
    total = sum(max(0.0, values.get(group, 0.0)) for group in INVESTOR_GROUPS)
    if total <= 0:
        return dict(fallback)
    return {group: max(0.0, values.get(group, 0.0)) / total for group in INVESTOR_GROUPS}


def _observed_group_weights(day: dict[str, Any]) -> tuple[dict[str, float] | None, str | None]:
    """Return normalized group-flow weights and the quality of their source.

    Current Finverse market rows expose net investor value, not gross buy and
    sell value.  Absolute net flow is therefore intentionally treated as a
    composition proxy, while total trading value supplies the gross scale.
    """
    explicit = day.get("investor_trading_value") or day.get("group_trading_value")
    flow = explicit if isinstance(explicit, dict) else day.get("investor_flow")
    if not isinstance(flow, dict):
        return None, None
    values = {}
    for group in INVESTOR_GROUPS:
        value = flow.get(group)
        try:
            values[group] = abs(float(value)) if value is not None else 0.0
        except (TypeError, ValueError):
            values[group] = 0.0
    if sum(values.values()) <= 0:
        return None, None
    scope = str(day.get("investor_flow_scope") or "unknown")
    return _normalize(values, DEFAULT_GROUP_WEIGHTS), scope


def calibrate_participant_sizing(history: list[dict[str, Any]]) -> dict[str, Any]:
    """Build a deterministic historical notional plan for World rounds."""
    references: list[dict[str, Any]] = []
    weight_samples: list[tuple[dict[str, float], float]] = []
    stock_flow_days = 0
    fallback_flow_days = 0

    for day in history:
        total = _total_trading_value(day)
        if total <= 0:
            continue
        observed, scope = _observed_group_weights(day)
        reference_weights = observed or DEFAULT_GROUP_WEIGHTS
        if observed:
            # Stock-specific flow is strong evidence.  Market-level fallback
            # still helps when the stock feed is incomplete, but is deliberately
            # blended more conservatively with the fallback composition.
            confidence = 1.0 if scope == "stock" else 0.5
            if scope == "stock":
                stock_flow_days += 1
            elif scope == "kospi_market_fallback":
                fallback_flow_days += 1
            blended = {
                group: confidence * 0.75 * observed[group]
                + (1 - confidence * 0.75) * DEFAULT_GROUP_WEIGHTS[group]
                for group in INVESTOR_GROUPS
            }
            reference_weights = _normalize(blended, DEFAULT_GROUP_WEIGHTS)
            weight_samples.append((reference_weights, confidence))
        else:
            weight_samples.append((dict(DEFAULT_GROUP_WEIGHTS), 0.0))

        references.append({
            "total_notional": round(total),
            "group_notional": {
                group: round(total * REPRESENTATIVE_PARTICIPATION_RATE * (
                    reference_weights[group]
                )) for group in INVESTOR_GROUPS
            },
        })

    if not references:
        return {
            "method": "fallback_no_trading_value",
            "sample_days": 0,
            "flow_coverage_days": 0,
            "market_flow_fallback_days": 0,
            "target_participation_rate": REPRESENTATIVE_PARTICIPATION_RATE,
            "group_weights": dict(DEFAULT_GROUP_WEIGHTS),
            "group_median_notional": {group: 0 for group in INVESTOR_GROUPS},
            "daily_references": [],
        }

    weighted_weights = {}
    for group in INVESTOR_GROUPS:
        values = [sample[group] * (1.0 if confidence else 0.5)
                  for sample, confidence in weight_samples]
        weights = [1.0 if confidence else 0.5 for _, confidence in weight_samples]
        weighted_weights[group] = (sum(value for value in values) / sum(weights)
                                   if sum(weights) else DEFAULT_GROUP_WEIGHTS[group])
    group_weights = _normalize(weighted_weights, DEFAULT_GROUP_WEIGHTS)

    # Keep the most recent 60 sessions for a compact persisted game payload.
    references = references[-60:]
    group_median_notional = {
        group: round(median(row["total_notional"] * REPRESENTATIVE_PARTICIPATION_RATE
                            * group_weights[group] for row in references))
        for group in INVESTOR_GROUPS
    }
    return {
        "method": "historical_trading_value_with_flow_proxy",
        "sample_days": len(references),
        "flow_coverage_days": stock_flow_days,
        "market_flow_fallback_days": fallback_flow_days,
        "target_participation_rate": REPRESENTATIVE_PARTICIPATION_RATE,
        "group_weights": {group: round(group_weights[group], 6) for group in INVESTOR_GROUPS},
        "group_median_notional": group_median_notional,
        "daily_references": references,
    }


def group_targets_for_round(sizing: dict[str, Any], round_number: int) -> dict[str, int]:
    """Select a stable historical reference for a simulated trading day."""
    references = sizing.get("daily_references") or []
    if references:
        row = references[max(0, int(round_number) - 1) % len(references)]
        return {group: max(0, int((row.get("group_notional") or {}).get(group, 0)))
                for group in INVESTOR_GROUPS}
    return {group: max(0, int((sizing.get("group_median_notional") or {}).get(group, 0)))
            for group in INVESTOR_GROUPS}


def scale_personas_to_representative_capacity(
    personas: list[dict[str, Any]], sizing: dict[str, Any],
    *, max_allocation_rate: float = 0.05,
) -> list[dict[str, Any]]:
    """Give synthetic agents enough virtual capacity to represent their group.

    The user's portfolio is never touched.  Only the hidden market-participant
    ledgers are scaled, keeping the original profile proportions and average
    price while preventing a 40-agent retail crowd from being capped by a few
    million won of aggregate synthetic capital.
    """
    targets = sizing.get("group_median_notional") or {}
    result = personas
    for group in INVESTOR_GROUPS:
        members = [persona for persona in result if persona.get("group") == group]
        if not members:
            continue
        current_capacity = sum(
            max(0.0, float(persona.get("capital") or 0)) for persona in members
        ) * max(0.001, float(max_allocation_rate))
        target = max(0.0, float(targets.get(group) or 0))
        factor = 1.0 if current_capacity <= 0 else max(1.0, target / current_capacity)
        factor = min(MAX_PERSONA_CAPITAL_SCALE, factor)
        for persona in members:
            for key in ("capital", "cash", "quantity"):
                try:
                    persona[key] = int(round(float(persona.get(key) or 0) * factor))
                except (TypeError, ValueError):
                    persona[key] = 0
            persona["representative_capital_scale"] = round(factor, 4)
            persona["representative_group_target_notional"] = round(target)
    return result
