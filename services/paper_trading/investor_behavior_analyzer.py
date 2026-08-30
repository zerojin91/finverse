"""Explainable investor-style assessment from paper-trading behavior."""

from __future__ import annotations

from typing import Any


def analyze_investor(game: dict[str, Any]) -> dict[str, Any]:
    fills = game.get("fills", [])
    results = game.get("daily_results", [])
    total_days = max(len(results), 1)
    gross_traded = sum(int(fill.get("gross_amount", 0)) for fill in fills)
    turnover = gross_traded / max(game["initial_cash"], 1)
    buys = [fill for fill in fills if fill["side"] == "BUY"]
    sells = [fill for fill in fills if fill["side"] == "SELL"]
    winning_sells = sum(fill.get("realized_pnl", 0) > 0 for fill in sells)
    losing_sells = sum(fill.get("realized_pnl", 0) < 0 for fill in sells)
    event_days = {row["trade_date"] for row in results if row.get("events")}
    event_trades = sum(fill["trade_date"] in event_days for fill in fills)
    rising_days = {row["trade_date"] for row in results
                   if row["reference_ohlc"]["close"] > row["reference_ohlc"]["open"]}
    falling_days = {row["trade_date"] for row in results
                    if row["reference_ohlc"]["close"] < row["reference_ohlc"]["open"]}
    chase_buys = sum(fill["trade_date"] in rising_days for fill in buys)
    panic_sells = sum(fill["trade_date"] in falling_days for fill in sells)
    last_portfolio = (results[-1]["portfolio"] if results else {
        "cash": game["cash"], "equity": game["initial_cash"], "total_return_pct": 0,
    })
    cash_ratio = last_portfolio["cash"] / max(last_portfolio["equity"], 1)
    activity = len(fills) / total_days
    rationales = [fill.get("rationale", "").strip() for fill in fills]
    confidences = [fill["confidence"] for fill in fills if fill.get("confidence") is not None]

    risk_score = min(100, round(
        turnover * 18 + activity * 12 + (1 - cash_ratio) * 35 +
        (chase_buys / max(len(buys), 1)) * 15))
    if risk_score >= 70:
        style = "공격적 고회전형"
    elif risk_score >= 45:
        style = "중위험 적극형"
    elif risk_score >= 20:
        style = "균형형"
    else:
        style = "신중한 현금중심형"

    metrics = {
        "trade_count": len(fills), "buy_count": len(buys), "sell_count": len(sells),
        "turnover_ratio": round(turnover, 4), "trades_per_day": round(activity, 3),
        "cash_ratio": round(cash_ratio, 4), "event_trade_ratio": round(event_trades / max(len(fills), 1), 4),
        "chase_buy_ratio": round(chase_buys / max(len(buys), 1), 4),
        "panic_sell_ratio": round(panic_sells / max(len(sells), 1), 4),
        "winning_sells": winning_sells, "losing_sells": losing_sells,
        "total_return_pct": last_portfolio.get("total_return_pct", 0),
        "rationale_coverage": round(sum(bool(item) for item in rationales) / max(len(fills), 1), 4),
        "average_confidence": round(sum(confidences) / len(confidences), 1) if confidences else None,
    }
    findings, lessons = [], []
    if len(fills) < 3:
        findings.append("판단하기 위한 거래 표본이 아직 적습니다.")
        lessons.append({"topic": "기록의 중요성", "message": "최소 5~10회의 의사결정을 쌓은 뒤 성향을 다시 비교해 보세요."})
    if turnover > 1.5:
        findings.append(f"초기자본 대비 누적 거래대금이 {turnover:.1f}배로 회전율이 높습니다.")
        lessons.append({"topic": "과도한 매매", "message": "진입 전에 보유 기간과 청산 조건을 적으면 불필요한 회전과 비용을 줄일 수 있습니다."})
    if metrics["chase_buy_ratio"] >= .5 and buys:
        findings.append(f"매수 중 {metrics['chase_buy_ratio'] * 100:.0f}%가 당일 상승 구간에서 발생했습니다.")
        lessons.append({"topic": "추격 매수", "message": "상승 이유와 적정 가격을 분리하고 한 번에 전액을 투입하지 않는 분할 접근을 연습하세요."})
    if metrics["panic_sell_ratio"] >= .5 and sells:
        findings.append(f"매도 중 {metrics['panic_sell_ratio'] * 100:.0f}%가 당일 하락 구간에서 발생했습니다.")
        lessons.append({"topic": "공포 매도", "message": "가격 하락 자체보다 처음 세운 투자 전제가 깨졌는지를 먼저 확인하세요."})
    if cash_ratio < .1:
        findings.append("현금 비중이 10% 미만이라 새로운 상황에 대응할 여유가 작습니다.")
        lessons.append({"topic": "포지션 크기", "message": "단일 시나리오의 불확실성을 고려해 대응 가능한 현금 완충을 남겨두세요."})
    if metrics["event_trade_ratio"] > .6 and fills:
        findings.append("거래의 대부분이 뉴스·이벤트가 있는 날에 집중됐습니다.")
        lessons.append({"topic": "이벤트 과잉반응", "message": "뉴스의 사실, 시장 기대, 이미 가격에 반영된 정도를 나눠 확인하세요."})
    if fills and metrics["rationale_coverage"] < .5:
        findings.append("절반 이상의 주문에 판단 근거가 기록되지 않았습니다.")
        lessons.append({"topic": "투자 일지", "message": "주문 전에 근거와 반증 조건을 한 문장씩 남기면 결과가 아닌 의사결정 품질을 복기할 수 있습니다."})
    if metrics["average_confidence"] is not None and metrics["average_confidence"] >= 80:
        findings.append(f"평균 확신도가 {metrics['average_confidence']:.0f}점으로 높습니다.")
        lessons.append({"topic": "과신 점검", "message": "높은 확신을 가진 주문일수록 반대 시나리오와 최대 손실 범위를 함께 적어보세요."})
    if not lessons:
        lessons.append({"topic": "투자 원칙", "message": "현재처럼 주문 이유와 결과를 함께 기록하고 여러 시나리오에서 일관성을 확인하세요."})
    return {"style": style, "risk_score": risk_score, "metrics": metrics,
            "findings": findings, "lessons": lessons,
            "disclaimer": "모의투자 행동을 바탕으로 한 교육용 분석이며 투자 권유나 적합성 판정이 아닙니다."}
