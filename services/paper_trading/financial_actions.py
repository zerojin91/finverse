"""FINVERSE-specific financial actions for individual market agents.

OASIS social actions describe posts and replies.  A stock-market participant
needs bounded portfolio intents instead.  The LLM may choose an allowed intent;
the deterministic market engine owns quantity, cash and price impact checks.
"""

from __future__ import annotations

from typing import Any


ACTION_RULES: dict[str, dict[str, Any]] = {
    "HOLD": {"side": "HOLD", "max_allocation": 0.0},
    "WAIT_FOR_CONFIRMATION": {"side": "HOLD", "max_allocation": 0.0},
    "BUILD_POSITION": {"side": "BUY", "max_allocation": .05},
    "CHASE_MOMENTUM": {"side": "BUY", "max_allocation": .04},
    "AVERAGE_DOWN": {"side": "BUY", "max_allocation": .035},
    "REDUCE_POSITION": {"side": "SELL", "max_allocation": .05},
    "EXIT_POSITION": {"side": "SELL", "max_allocation": .08},
    "PANIC_EXIT": {"side": "SELL", "max_allocation": .06},
    "MACRO_ROTATE": {"side": "BUY", "max_allocation": .05},
    "FX_HEDGE": {"side": "SELL", "max_allocation": .035},
    "RISK_OFF": {"side": "SELL", "max_allocation": .06},
    "REBALANCE": {"side": "HOLD", "max_allocation": .04},
    "SECTOR_ROTATE": {"side": "BUY", "max_allocation": .04},
    "ETF_FLOW_SYNC": {"side": "BUY", "max_allocation": .04},
    "HEDGE_RISK": {"side": "SELL", "max_allocation": .035},
    "STRATEGIC_REBALANCE": {"side": "HOLD", "max_allocation": .025},
    "VOLATILITY_DELEVERAGE": {"side": "SELL", "max_allocation": .05},
}


def allowed_actions_for(persona: dict[str, Any]) -> list[str]:
    values = persona.get("allowed_actions")
    if isinstance(values, list):
        known = [str(value) for value in values if str(value) in ACTION_RULES]
        if known:
            return known
    return ["HOLD", "BUILD_POSITION", "REDUCE_POSITION", "EXIT_POSITION"]


def normalize_financial_action(raw: Any, persona: dict[str, Any]) -> dict[str, Any]:
    """Normalize one model decision to an order-safe action intent."""
    value = raw if isinstance(raw, dict) else {}
    allowed = allowed_actions_for(persona)
    action_type = str(value.get("action_type") or "HOLD").upper()
    if action_type not in allowed:
        action_type = "HOLD"
    rule = ACTION_RULES[action_type]
    requested_side = str(value.get("side") or rule["side"]).upper()
    side = requested_side if requested_side in ("BUY", "SELL", "HOLD") else rule["side"]
    if rule["side"] != "HOLD":
        side = rule["side"]
    elif action_type in ("REBALANCE", "STRATEGIC_REBALANCE"):
        # 리밸런싱은 모델이 매수·매도 중 어느 쪽인지만 고르게 한다.
        side = requested_side if requested_side in ("BUY", "SELL") else "HOLD"
    else:
        side = "HOLD"
    try:
        allocation = float(value.get("allocation_pct") or 0)
    except (TypeError, ValueError):
        allocation = 0.0
    allocation = max(0.0, min(float(rule["max_allocation"]), allocation))
    if side == "HOLD":
        allocation = 0.0
    try:
        confidence = int(float(value.get("confidence") or 0))
    except (TypeError, ValueError):
        confidence = 0
    try:
        sentiment = float(value.get("sentiment") or 0)
    except (TypeError, ValueError):
        sentiment = 0.0
    return {
        "persona_id": persona["persona_id"],
        "action_type": action_type,
        "side": side,
        "allocation_pct": round(allocation, 5),
        "confidence": max(0, min(100, confidence)),
        "sentiment": round(max(-1.0, min(1.0, sentiment)), 4),
        "rationale": str(value.get("rationale") or "공개된 시장 정보와 개별 프로필을 기준으로 관망합니다.").strip()[:500],
        "memory_note": str(value.get("memory_note") or "").strip()[:500],
        "allowed_actions": allowed,
    }
