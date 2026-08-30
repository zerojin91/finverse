"""Educational assessment for event-driven investment decisions."""

from __future__ import annotations

from typing import Any

from .scenario_trading import scenario_portfolio


def analyze_scenario_investor(game: dict[str, Any]) -> dict[str, Any]:
    fills = game.get("fills", [])
    pre = [fill for fill in fills if fill.get("phase") == "pre_event_decision"]
    post = [fill for fill in fills if fill.get("phase") == "post_event_decision"]
    equity = scenario_portfolio(game)
    prices = [row["price"] for row in game.get("price_history", [])]
    peak, max_drawdown = prices[0] if prices else 0, 0.0
    for price in prices:
        peak = max(peak, price)
        if peak:
            max_drawdown = min(max_drawdown, (price / peak - 1) * 100)
    turnover = sum(fill["gross_amount"] for fill in fills) / max(game["initial_cash"], 1)
    confidence_values = [fill["confidence"] for fill in fills if fill.get("confidence") is not None]
    completed_events = len({row["event_id"] for row in game.get("decision_log", [])})
    autonomous_market_days = sum(
        row.get("phase") == "inter_event" for row in game.get("agent_rounds", []))
    psychology_history = game.get("psychology_history", [])
    max_abs_sentiment = max((abs(row.get("aggregate_sentiment", 0))
                             for row in psychology_history), default=0.0)
    post_chases = sum(fill["side"] == "BUY" for fill in post)
    post_sells = sum(fill["side"] == "SELL" for fill in post)
    findings, lessons = [], []
    if post_chases:
        findings.append(f"이벤트 공개 후 추가 매수가 {post_chases}회 있었습니다.")
        lessons.append({"topic": "이벤트 추격 점검", "message": "공개 직후에는 사건의 사실과 이미 가격에 반영된 기대를 분리해 확인하세요."})
    if post_sells:
        findings.append(f"이벤트 공개 후 매도가 {post_sells}회 있었습니다.")
        lessons.append({"topic": "사후 매도 점검", "message": "가격 반응 자체보다 기존 투자 전제가 훼손됐는지 먼저 기록해 보세요."})
    if not fills:
        findings.append("아직 기록된 사용자 주문이 없습니다.")
    if not lessons:
        lessons.append({"topic": "사전·사후 비교", "message": "이벤트 전 예상과 공개 후 판단이 왜 달라졌는지 투자 일지에 비교해 보세요."})
    style = "이벤트 반응 관찰형"
    if turnover > 1.5:
        style = "이벤트 고회전형"
    elif post_chases > len(pre):
        style = "이벤트 추종형"
    elif len(pre) > len(post):
        style = "사전 포지셔닝형"
    return {
        "style": style,
        "metrics": {"completed_events": completed_events, "trade_count": len(fills),
                    "pre_event_trades": len(pre), "post_event_trades": len(post),
                    "autonomous_market_days": autonomous_market_days,
                    "max_abs_market_sentiment": round(max_abs_sentiment, 4),
                    "turnover_ratio": round(turnover, 4),
                    "total_return_pct": equity["total_return_pct"],
                    "max_price_drawdown_pct": round(max_drawdown, 4),
                    "average_confidence": (round(sum(confidence_values) / len(confidence_values), 1)
                                           if confidence_values else None)},
        "findings": findings, "lessons": lessons,
        "event_decisions": game.get("decision_log", []),
        "disclaimer": "가상 시나리오에서의 행동을 바탕으로 한 교육용 분석이며 투자 권유가 아닙니다.",
    }
