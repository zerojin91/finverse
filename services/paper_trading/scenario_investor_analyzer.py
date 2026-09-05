"""Educational assessment for event-driven investment decisions."""

from __future__ import annotations

from typing import Any

from .scenario_trading import scenario_portfolio


def analyze_scenario_investor(game: dict[str, Any]) -> dict[str, Any]:
    fills = game.get("fills", [])
    pre = [fill for fill in fills if fill.get("phase") == "pre_event_decision"]
    post = [fill for fill in fills if fill.get("phase") == "post_event_decision"]
    world_decisions = [fill for fill in fills if fill.get("phase") == "world_decision"]
    daily_reflections = game.get("daily_reflections", [])
    equity = scenario_portfolio(game)
    prices = [row["price"] for row in game.get("price_history", [])]
    peak, max_drawdown = prices[0] if prices else 0, 0.0
    for price in prices:
        peak = max(peak, price)
        if peak:
            max_drawdown = min(max_drawdown, (price / peak - 1) * 100)
    turnover = sum(fill["gross_amount"] for fill in fills) / max(
        game.get("initial_equity", game["initial_cash"]), 1)
    confidence_values = [fill["confidence"] for fill in fills if fill.get("confidence") is not None]
    completed_events = len({row["event_id"] for row in game.get("decision_log", [])})
    autonomous_market_days = sum(
        row.get("phase") == "inter_event" for row in game.get("agent_rounds", []))
    psychology_history = game.get("psychology_history", [])
    max_abs_sentiment = max((abs(row.get("aggregate_sentiment", 0))
                             for row in psychology_history), default=0.0)
    post_chases = sum(fill["side"] == "BUY" for fill in post)
    post_sells = sum(fill["side"] == "SELL" for fill in post)
    high_confidence = [fill for fill in (world_decisions or fills)
                       if float(fill.get("confidence") or 0) >= 80]
    loss_avoidance_sells = [fill for fill in world_decisions
                            if fill.get("side") == "SELL" and float(fill.get("realized_pnl") or 0) < 0]
    daily_buy_bias = sum(row.get("stance") == "BUY_WATCH" for row in daily_reflections)
    daily_sell_bias = sum(row.get("stance") == "SELL_WATCH" for row in daily_reflections)
    findings, lessons = [], []
    if post_chases:
        findings.append(f"이벤트 공개 후 추가 매수가 {post_chases}회 있었습니다.")
        lessons.append({"topic": "이벤트 추격 점검", "message": "공개 직후에는 사건의 사실과 이미 가격에 반영된 기대를 분리해 확인하세요."})
    if post_sells:
        findings.append(f"이벤트 공개 후 매도가 {post_sells}회 있었습니다.")
        lessons.append({"topic": "사후 매도 점검", "message": "가격 반응 자체보다 기존 투자 전제가 훼손됐는지 먼저 기록해 보세요."})
    if world_decisions:
        findings.append(f"중요 사건 판단 게이트에서 사용자 주문이 {len(world_decisions)}회 기록됐습니다.")
        lessons.append({"topic": "사건 판단 기록", "message": "사건의 첫 인상, 실제 근거, 주문 이유를 분리해 다음 판단과 비교해 보세요."})
    if daily_reflections:
        findings.append(f"평상시 거래일 판단을 {len(daily_reflections)}회 기록했습니다.")
        if daily_buy_bias or daily_sell_bias:
            lessons.append({"topic": "일일 방향성 점검", "message": "매수·매도 고려를 남긴 날의 다음 거래일 반응을 비교해, 추세 추종과 성급한 반전 기대를 구분해 보세요."})
    if high_confidence:
        findings.append(f"확신도 80% 이상으로 기록한 주문이 {len(high_confidence)}회 있습니다.")
    if loss_avoidance_sells:
        findings.append(f"손실이 확정된 매도가 {len(loss_avoidance_sells)}회 있습니다.")
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
                    "world_decision_trades": len(world_decisions),
                    "daily_reflection_count": len(daily_reflections),
                    "daily_buy_watch_count": daily_buy_bias,
                    "daily_sell_watch_count": daily_sell_bias,
                    "high_confidence_trade_count": len(high_confidence),
                    "loss_avoidance_sell_count": len(loss_avoidance_sells),
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
