"""Post-close daily market explanation for World Agent games.

The trading engine settles the 59 independent orders first.  This module then
turns that settled result into a learner-facing explanation.  It is a
description of the simulated day, not a price forecast or an extra market
participant, so a summary failure must never invalidate the round.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

from .llm_client import LLMClient


GROUP_LABELS = {
    "retail": "개인 투자자",
    "foreign": "외국인",
    "institution": "기관",
    "pension": "연기금",
}


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _pct(value: Any) -> str:
    return f"{_number(value):+.2f}%"


def _won(value: float) -> str:
    return f"{round(value):,.0f}원"


def _aggregate_orders(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Aggregate settled orders while retaining a few representative reasons."""
    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "agent_count": 0,
        "buy_count": 0,
        "sell_count": 0,
        "hold_count": 0,
        "buy_quantity": 0,
        "sell_quantity": 0,
        "buy_notional": 0.0,
        "sell_notional": 0.0,
        "rationales": [],
    })
    for order in result.get("persona_orders") or []:
        if not isinstance(order, dict):
            continue
        group = str(order.get("group") or "unknown")
        row = grouped[group]
        row["agent_count"] += 1
        side = str(order.get("side") or "HOLD").upper()
        quantity = int(_number(order.get("filled_quantity", order.get("quantity"))))
        notional = _number(order.get("notional"))
        if notional <= 0 and quantity:
            notional = quantity * _number(order.get("fill_price", result.get("price")))
        if side == "BUY":
            row["buy_count"] += 1
            row["buy_quantity"] += quantity
            row["buy_notional"] += notional
        elif side == "SELL":
            row["sell_count"] += 1
            row["sell_quantity"] += quantity
            row["sell_notional"] += notional
        else:
            row["hold_count"] += 1
        rationale = str(order.get("rationale") or "").strip()
        if rationale and len(row["rationales"]) < 3:
            row["rationales"].append(rationale[:180])
    return dict(grouped)


def _prompt_payload(
    game: dict[str, Any], result: dict[str, Any],
    information: dict[str, Any], event: dict[str, Any] | None,
) -> dict[str, Any]:
    grouped = _aggregate_orders(result)
    groups = {}
    for group in GROUP_LABELS:
        row = grouped.get(group, {})
        groups[group] = {
            "label": GROUP_LABELS[group],
            "agent_count": row.get("agent_count", 0),
            "buy_count": row.get("buy_count", 0),
            "sell_count": row.get("sell_count", 0),
            "hold_count": row.get("hold_count", 0),
            "buy_quantity": row.get("buy_quantity", 0),
            "sell_quantity": row.get("sell_quantity", 0),
            "buy_notional": round(row.get("buy_notional", 0)),
            "sell_notional": round(row.get("sell_notional", 0)),
            "representative_reasons": row.get("rationales", []),
        }
    public_event = None
    if event:
        public_event = {
            "title": str(event.get("title") or "")[:160],
            "description": str(event.get("description") or event.get("public_signal") or "")[:500],
        }
    state = (information.get("world_state") or {}) if isinstance(information, dict) else {}
    return {
        "stock": f"{game.get('name', '')}({game.get('ticker', '')})",
        "market_date": result.get("market_date"),
        "previous_price": result.get("previous_price"),
        "closing_price": result.get("price"),
        "return_pct": result.get("return_pct"),
        "price_components_pct": result.get("return_components_pct", {}),
        "total_buy_notional": round(_number(result.get("buy_notional"))),
        "total_sell_notional": round(_number(result.get("sell_notional"))),
        "groups": groups,
        "public_event": public_event,
        "world_state": {
            key: state.get(key) for key in
            ("momentum", "volatility", "liquidity", "risk_appetite", "community_sentiment", "macro_regime")
            if key in state
        },
    }


def _parse_json(raw: str) -> dict[str, Any]:
    text = str(raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE).strip()
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("일일 시장 요약이 JSON 객체가 아닙니다.")
    return parsed


def _fallback_detail(payload: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
    """Keep the learner-facing panel useful when OpenRouter is unavailable."""
    return_pct = _number(payload.get("return_pct"))
    direction = "상승" if return_pct > 0 else "하락" if return_pct < 0 else "보합"
    groups = payload.get("groups") or {}
    group_actions: dict[str, str] = {}
    for group, label in GROUP_LABELS.items():
        row = groups.get(group) or {}
        group_actions[group] = (
            f"매수 {int(row.get('buy_count', 0))}명·매도 {int(row.get('sell_count', 0))}명·"
            f"관망 {int(row.get('hold_count', 0))}명. "
            f"매수 {_won(_number(row.get('buy_notional')))}, "
            f"매도 {_won(_number(row.get('sell_notional')))}"
        )
    components = payload.get("price_components_pct") or {}
    drivers = [
        f"수급 { _pct(components.get('flow'))}",
        f"시장 맥락 { _pct(components.get('market_context'))}",
        f"심리·환경 { _pct(_number(components.get('persistent_sentiment')) + _number(components.get('event_regime')))}",
    ]
    detail = {
        "summary": (
            f"{payload.get('stock', '선택 종목')}은(는) 오늘 {direction} 마감함 "
            f"(전일 대비 {_pct(return_pct)}). 4개 수급 주체의 주문 방향과 공개된 환경을 함께 반영한 "
            f"시뮬레이션 결과임."
        ),
        "group_actions": group_actions,
        "price_reason": f"주가 변동에 반영된 주요 요인은 {', '.join(drivers)}임.",
        "uncertainties": ["규칙 기반 설명이며 실제 시장의 모든 원인을 포함하지 않음."],
        "source": "rule_fallback",
    }
    if reason:
        detail["uncertainties"].append("요약 모델을 사용할 수 없어 집계 결과로 표시함.")
    return detail


def generate_daily_market_summary(
    game: dict[str, Any], result: dict[str, Any],
    information: dict[str, Any], event: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate a post-close explanation from the settled round."""
    payload = _prompt_payload(game, result, information, event)
    messages = [
        {
            "role": "system",
            "content": (
                "한국 주식 교육용 모의투자의 장 마감 해설자다. 실제 시장 예측이나 투자 권유를 하지 말고, "
                "제공된 시뮬레이션 집계만 근거로 오늘의 결과를 설명한다. 반드시 JSON 객체만 반환한다. "
                "그룹 키는 retail, foreign, institution, pension을 그대로 사용한다."
            ),
        },
        {
            "role": "user",
            "content": f"""다음은 {payload['stock']}의 {payload['market_date']} 거래일이 체결된 뒤의 집계다.
개인·외국인·기관·연기금이 어떤 방향으로 행동했는지 각각 설명하고, 그 주문 흐름·가격 구성요소·공개 이벤트·환경을 바탕으로 주가가 왜 변했는지 추론하라. 확인되지 않은 원인을 사실처럼 단정하지 말고 '추론'으로 표현하라.

{json.dumps(payload, ensure_ascii=False)}

반환 형식:
{{"summary":"오늘 시장 전체를 3~4문장으로 설명",
"group_actions":{{"retail":"개인 행동 요약","foreign":"외국인 행동 요약","institution":"기관 행동 요약","pension":"연기금 행동 요약"}},
"price_reason":"주가 변동 이유에 대한 데이터 기반 추론",
"uncertainties":["남아 있는 불확실성"],
"source":"openrouter"}}""",
        },
    ]
    try:
        raw = LLMClient().chat(
            messages, temperature=.25, max_tokens=1200,
            response_format={"type": "json_object"},
        )
        parsed = _parse_json(raw)
        summary = str(parsed.get("summary") or "").strip()
        if not summary:
            raise ValueError("일일 시장 요약의 본문이 비어 있습니다.")
        group_actions = parsed.get("group_actions")
        if not isinstance(group_actions, dict):
            group_actions = {}
        normalized_groups = {
            group: str(group_actions.get(group) or _fallback_detail(payload)["group_actions"][group]).strip()
            for group in GROUP_LABELS
        }
        uncertainties = parsed.get("uncertainties")
        if not isinstance(uncertainties, list):
            uncertainties = []
        return {
            "summary": summary[:1400],
            "group_actions": normalized_groups,
            "price_reason": str(parsed.get("price_reason") or "제공된 수급과 가격 구성요소를 바탕으로 해석함.")[:1000],
            "uncertainties": [str(item)[:240] for item in uncertainties[:4]],
            "source": "openrouter",
        }
    except Exception:  # noqa: BLE001 - 요약 실패가 거래일 체결을 막으면 안 됨
        return _fallback_detail(payload, reason="llm_unavailable")
