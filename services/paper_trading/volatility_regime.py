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
VIX_BOUNDS = (.75, 1.75)
VIX_SYMBOL = "^VIX"


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
    expected = baseline * regime
    if expected <= 0:
        return float(state["level"])
    surprise = (realised_return_pct / expected) ** 2
    level = float(state["level"])
    blended = CLUSTER_MEMORY * level ** 2 + (1 - CLUSTER_MEMORY) * surprise
    level = math.sqrt(max(blended, 1e-6))
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
