"""Global market drivers, and which way each one cuts for a sector.

The lake holds Korean policy series. These are the offshore ones that move a
KOSPI name without appearing anywhere in its own filings: the US long rate
that sets the discount on every valuation, crude that is a cost for a
chemical maker and revenue for a refiner, and the dollar that decides whether
an exporter's shipment is worth more or less in won.

Fetched at scenario creation and handed to the same event detector the
domestic series use, so an offshore move becomes a dated event like any other.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any


# yfinance 심볼 → 엔진이 쓰는 시리즈 이름.
GLOBAL_SERIES = {
    "^TNX": "미국 10년물 국채금리",
    "CL=F": "WTI 유가",
    "DX-Y.NYB": "달러 인덱스",
}

# 업종별 민감도. 기본값에서 벗어나는 업종만 적는다.
# 양수는 그 지표가 오를 때 순풍, 음수는 역풍이라는 뜻이다.
US_YIELD_SENSITIVITY = {
    # 금리 상승은 할인율을 올려 대체로 역풍이지만, 예대마진이 붙는 금융은 반대다.
    "default": -1.0,
    "은행": .7, "증권": .3, "생명보험": .8, "손해보험": .6, "카드": .2,
    # 멀리 있는 이익으로 평가받는 업종일수록 더 크게 눌린다.
    "소프트웨어": -1.3, "게임엔터테인먼트": -1.3, "생물공학": -1.4, "제약": -1.2,
    "인터넷과카탈로그소매": -1.3, "양방향미디어와서비스": -1.3, "창업투자": -1.4,
    "건설": -1.2, "부동산": -1.3, "전기유틸리티": -1.1, "가스유틸리티": -1.1,
}
OIL_SENSITIVITY = {
    # 유가는 대부분에게 비용이다. 파는 쪽에게만 매출이다.
    "default": -.3,
    "석유와가스": 1.2, "에너지장비및서비스": 1.0, "조선": .5, "해운사": .3,
    "화학": -1.1, "항공사": -1.3, "항공화물운송과물류": -1.0, "도로와철도운송": -.8,
    "타이어": -.9, "포장재": -.7, "식품": -.5, "전기유틸리티": -.8, "철강": -.6,
}
DOLLAR_SENSITIVITY = {
    # 달러 강세는 원화 약세와 같은 방향이다. 파는 쪽이 유리하다.
    "default": -.3,
    "반도체와반도체장비": .9, "자동차": .9, "자동차부품": .8, "조선": .8,
    "전자장비와기기": .7, "디스플레이패널": .7, "디스플레이장비및부품": .7,
    "화학": .5, "철강": .5, "기계": .6, "전기제품": .6, "핸드셋": .7,
    "항공사": -1.0, "식품": -.6, "판매업체": -.6, "백화점과일반상점": -.6,
    "은행": -.4, "건설": -.4,
}
SENSITIVITY = {
    "미국 10년물 국채금리": US_YIELD_SENSITIVITY,
    "WTI 유가": OIL_SENSITIVITY,
    "달러 인덱스": DOLLAR_SENSITIVITY,
}


def sector_sensitivity(series_name: str, sector: str | None) -> float:
    """How hard this series hits this sector, and in which direction."""
    table = SENSITIVITY.get(series_name)
    if not table:
        return 0.0
    return float(table.get(sector or "", table["default"]))


def fetch_global_observations(start: str, end: str) -> list[dict[str, Any]]:
    """Daily closes for the offshore drivers, shaped like the lake's rows.

    Returns an empty list when the quotes cannot be reached — the scenario
    still has the domestic series to build events from.
    """
    try:
        import yfinance
    except Exception:  # noqa: BLE001 - 패키지가 없으면 국내 지표만 쓴다
        return []
    try:
        begin = date.fromisoformat(start) - timedelta(days=7)
        finish = date.fromisoformat(end) + timedelta(days=1)
    except (TypeError, ValueError):
        return []

    rows: list[dict[str, Any]] = []
    for symbol, series_name in GLOBAL_SERIES.items():
        try:
            frame = yfinance.Ticker(symbol).history(
                start=begin.isoformat(), end=finish.isoformat(), interval="1d")
        except Exception:  # noqa: BLE001 - 한 종목 실패가 나머지를 막지 않는다
            continue
        for stamp, value in zip(frame.index, frame["Close"].tolist()):
            if value != value:  # NaN
                continue
            rows.append({
                "series_name": series_name,
                "trade_date": stamp.date().isoformat(),
                "value": float(value),
                "source": f"yfinance:{symbol}",
                "cycle": "D",
            })
    return rows
