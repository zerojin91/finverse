"""How wide a session's unexplained move should be.

Two things set it. The security's own recent behaviour — big days cluster,
so a violent week should stay violent for a while rather than snapping back
to average. And the market's fear gauge, so a scenario built while VIX sits
at 30 does not trade like one built at 13.
"""

from __future__ import annotations

import math
from typing import Any


# 직전 변동성이 다음 날로 이어지는 정도. 1에 가까울수록 오래 간다.
CLUSTER_MEMORY = .82
# 한 종목의 변동성이 평시 대비 오갈 수 있는 범위.
CLUSTER_BOUNDS = (.55, 2.4)
# VIX 백분위를 배수로 옮기는 구간. 공포가 낮은 장은 좁고, 높은 장은 넓다.
# VIX가 낮다고 시장이 멈추지는 않는다. 하한을 올려 평시에도 하루가 움직이게 한다.
VIX_BOUNDS = (.9, 1.9)
VIX_SYMBOL = "^VIX"
# 하루 변동 중 설명되지 않고 남는 몫. 기대 폭 계산과 잔차 추출이 같은 값을 써야
# 레벨이 1 근처에 머문다. 한쪽에만 넣으면 그 비율만큼 레벨이 끌려 내려간다.
IDIOSYNCRATIC_SHARE = .95
# 정규분포에서 E[|X|] = sigma * sqrt(2/pi).
MEAN_ABSOLUTE_FACTOR = math.sqrt(2 / math.pi)


def update_cluster_level(game: dict[str, Any], realised_return_pct: float) -> float:
    """Fold the session that just settled into the running volatility level.

    Two details decide whether this tracks or drifts. It averages squared
    returns, because averaging absolute ones sits below sigma by a constant
    and walks the level down a little every session. And it measures the move
    against what this session was expected to be worth, not against the raw
    baseline — otherwise a calm-VIX scenario keeps reading its own narrower
    days as surprisingly quiet and talks itself into the floor.
    """
    baseline = float(game.get("impact_model", {}).get("daily_rms_pct") or 0)
    state = game.setdefault("volatility_state", {"level": 1.0})
    regime = float((game.get("volatility_regime") or {}).get("multiplier", 1.0))
    level = float(state["level"])
    # 기대 폭에는 현재 레벨도 들어가야 한다. 빼면 레벨이 1 아래로 내려가는 순간
    # 실현값이 기대보다 작아지고, 그래서 레벨이 더 내려가고, 다시 더 작아지는
    # 하강 나선이 돈다(실측: 0.79에서 다섯 세션 만에 바닥 0.55).
    # 레벨을 포함하면 모델이 맞을 때 놀람이 1 근처에 머물러 레벨이 안정된다.
    expected = baseline * regime * level * IDIOSYNCRATIC_SHARE
    if expected <= 0:
        return level
    # 분산으로 평균낸 뒤 제곱근을 취하면 E[sqrt(X)] < sqrt(E[X]) 때문에 레벨이
    # 계속 1보다 낮게 앉는다(실측 0.82). 절대값을 정규분포의 평균절대편차
    # sqrt(2/pi)로 나눠 선형으로 평균내면 편향 없이 1에 머문다.
    surprise = abs(realised_return_pct) / (expected * MEAN_ABSOLUTE_FACTOR)
    level = CLUSTER_MEMORY * level + (1 - CLUSTER_MEMORY) * surprise
    state["level"] = round(max(CLUSTER_BOUNDS[0], min(CLUSTER_BOUNDS[1], level)), 6)
    return float(state["level"])


def session_multiplier(game: dict[str, Any]) -> float:
    """Combined width for the next session."""
    level = float((game.get("volatility_state") or {}).get("level", 1.0))
    regime = float((game.get("volatility_regime") or {}).get("multiplier", 1.0))
    return max(CLUSTER_BOUNDS[0], min(CLUSTER_BOUNDS[1] * 1.5, level * regime))


def fetch_vix_regime(lookback: str = "1y") -> dict[str, Any]:
    """Where the fear gauge sits inside its own recent range.

    A percentile rather than a level, because what counts as a calm VIX
    drifts over the years. Returns a neutral regime when the quote cannot be
    reached — a scenario should still start without a network round trip.
    """
    try:
        import yfinance
        history = yfinance.Ticker(VIX_SYMBOL).history(period=lookback, interval="1d")
        closes = [float(value) for value in history["Close"].tolist() if value == value]
    except Exception as error:  # noqa: BLE001 - 지수 하나 때문에 시나리오를 막지 않는다
        return {"source": "unavailable", "reason": str(error)[:120], "multiplier": 1.0}
    if len(closes) < 30:
        return {"source": "insufficient", "samples": len(closes), "multiplier": 1.0}
    latest = closes[-1]
    percentile = sum(1 for value in closes if value <= latest) / len(closes)
    low, high = VIX_BOUNDS
    return {
        "source": "yfinance:^VIX", "level": round(latest, 2),
        "percentile": round(percentile, 4), "samples": len(closes),
        "multiplier": round(low + (high - low) * percentile, 4),
    }
