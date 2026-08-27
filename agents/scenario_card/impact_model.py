"""Pure functions for scenario-card impact weights, blending, and path construction."""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import median
from typing import Literal, Sequence

Tone = Literal["up", "down", "neutral"]

TV_RATIO_QUIET = 0.75
TV_RATIO_HOT = 1.35
W_QUANT_BASE = 0.18
W_QUANT_SPAN = 0.32
W_NEWS_BASE = 0.42
W_NEWS_SPAN = 0.22

EVIDENCE_MIN_ANALOG = 2
EVIDENCE_MIN_CONFIDENCE = 0.55
NEWS_ABS_CAP_PCT = 4.0
MONOTONICITY_EPS_PCT = 0.3
DEFAULT_NEUTRAL_CAP_PCT = 5.0


@dataclass(frozen=True)
class ChannelWeights:
    quant: float
    news: float
    analyst: float

    def as_dict(self) -> dict[str, float]:
        return {"quant": self.quant, "news": self.news, "analyst": self.analyst}


@dataclass(frozen=True)
class VolumeRegime:
    tv_ratio: float
    activity_score: float
    regime_label: str
    weights: ChannelWeights
    trading_value_20d_avg: float | None
    trading_value_240d_median: float | None
    backfill_applied: bool = False
    limitations: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {
            "tv_ratio": round(self.tv_ratio, 4),
            "activity_score": round(self.activity_score, 4),
            "regime_label": self.regime_label,
            "weights": self.weights.as_dict(),
            "trading_value_20d_avg": self.trading_value_20d_avg,
            "trading_value_240d_median": self.trading_value_240d_median,
            "backfill_applied": self.backfill_applied,
            "limitations": list(self.limitations),
        }


@dataclass
class EventChannelInput:
    event_key: str
    I_quant_pct: float
    I_analyst_pct: float
    channel_confidence: float = 1.0
    n_analog: int = 0
    I_news_pct: float | None = None


@dataclass
class WebNewsFallback:
    I_web_direction_pct: float
    narrative_strength: float = 1.0


@dataclass
class EventMeta:
    event_key: str
    week: str
    category: str
    title: str
    body: str


@dataclass(frozen=True)
class ImpactEventResult:
    event_key: str
    week: str
    category: str
    title: str
    body: str
    quant_pct: float
    analyst_pct: float
    news_pct: float
    news_fallback_used: bool
    impact_pct: float
    cumulative_impact_pct: float
    index_level: float
    impact_formula: str


@dataclass(frozen=True)
class ImpactModelResult:
    scenario_id: str
    base_index: float
    tone: Tone
    weights: ChannelWeights
    events: tuple[ImpactEventResult, ...]
    path: tuple[float, ...]
    forecast_pct: float
    forecast: str
    band_low_pct: float | None = None
    band_high_pct: float | None = None
    limitations: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {
            "scenario_id": self.scenario_id,
            "base_index": self.base_index,
            "tone": self.tone,
            "weights": self.weights.as_dict(),
            "weight_source": "volume_regime",
            "events": [
                {
                    "event_key": e.event_key,
                    "week": e.week,
                    "category": e.category,
                    "title": e.title,
                    "body": e.body,
                    "channels": {
                        "quant_pct": round(e.quant_pct, 2),
                        "analyst_pct": round(e.analyst_pct, 2),
                        "news_pct": round(e.news_pct, 2),
                        "news_fallback_used": e.news_fallback_used,
                    },
                    "impact_pct": round(e.impact_pct, 2),
                    "impact_formula": e.impact_formula,
                    "cumulative_impact_pct": round(e.cumulative_impact_pct, 2),
                    "index_level": round(e.index_level, 2),
                }
                for e in self.events
            ],
            "path": [round(v, 2) for v in self.path],
            "forecast": self.forecast,
            "forecast_pct": round(self.forecast_pct, 2),
            "band": (
                {
                    "low_pct": round(self.band_low_pct, 2),
                    "high_pct": round(self.band_high_pct, 2),
                    "low_index": round(self.base_index * (1 + self.band_low_pct / 100), 2),
                    "high_index": round(self.base_index * (1 + self.band_high_pct / 100), 2),
                }
                if self.band_low_pct is not None and self.band_high_pct is not None
                else None
            ),
            "limitations": list(self.limitations),
        }


def clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def backfill_series(values: Sequence[float | None]) -> tuple[list[float], bool]:
    """Forward-fill, then backward-fill missing/non-positive values."""
    if not values:
        return [], False

    out: list[float | None] = [None if v is None or v <= 0 else float(v) for v in values]
    applied = any(v is None for v in out) or any(v <= 0 for v in values if v is not None)

    last: float | None = None
    for i, v in enumerate(out):
        if v is not None:
            last = v
        elif last is not None:
            out[i] = last

    last = None
    for i in range(len(out) - 1, -1, -1):
        v = out[i]
        if v is not None:
            last = v
        elif last is not None:
            out[i] = last

    valid = [v for v in out if v is not None and v > 0]
    if not valid:
        return [1.0] * len(values), True

    fallback = median(valid)
    filled = [float(v if v is not None and v > 0 else fallback) for v in out]
    return filled, applied or any(v is None for v in out)


def activity_from_tv_ratio(tv_ratio: float) -> float:
    span = TV_RATIO_HOT - TV_RATIO_QUIET
    return clip((tv_ratio - TV_RATIO_QUIET) / span, 0.0, 1.0)


def weights_from_activity(activity: float) -> ChannelWeights:
    quant = W_QUANT_BASE + W_QUANT_SPAN * activity
    news = W_NEWS_BASE - W_NEWS_SPAN * activity
    analyst = 1.0 - quant - news
    return ChannelWeights(quant=quant, news=news, analyst=analyst)


def regime_label_from_activity(activity: float) -> str:
    if activity <= 0.05:
        return "quiet"
    if activity < 0.45:
        return "normal"
    if activity < 0.85:
        return "elevated"
    return "hot"


def compute_volume_regime(
    trading_values: Sequence[float | None],
    *,
    short_window: int = 20,
    long_window: int = 240,
) -> VolumeRegime:
    """Compute volume-adaptive channel weights from trading value series (oldest→newest)."""
    limitations: list[str] = []
    filled, backfill = backfill_series(trading_values)
    if backfill:
        limitations.append("trading_value backfill applied")

    if len(filled) < short_window:
        limitations.append(f"insufficient history (<{short_window} days); using defaults")
        weights = weights_from_activity(0.42)
        return VolumeRegime(
            tv_ratio=1.0,
            activity_score=0.42,
            regime_label="normal",
            weights=weights,
            trading_value_20d_avg=None,
            trading_value_240d_median=None,
            backfill_applied=backfill,
            limitations=tuple(limitations),
        )

    short = filled[-short_window:]
    long_slice = filled[-long_window:] if len(filled) >= long_window else filled
    tv_20 = sum(short) / len(short)
    tv_240 = median(long_slice)
    tv_ratio = tv_20 / tv_240 if tv_240 > 0 else 1.0
    activity = activity_from_tv_ratio(tv_ratio)
    return VolumeRegime(
        tv_ratio=tv_ratio,
        activity_score=activity,
        regime_label=regime_label_from_activity(activity),
        weights=weights_from_activity(activity),
        trading_value_20d_avg=tv_20,
        trading_value_240d_median=tv_240,
        backfill_applied=backfill,
        limitations=tuple(limitations),
    )


def evidence_sufficient(n_analog: int, channel_confidence: float) -> bool:
    return n_analog >= EVIDENCE_MIN_ANALOG and channel_confidence >= EVIDENCE_MIN_CONFIDENCE


def compute_news_channel(
    *,
    tone: Tone,
    I_quant: float,
    I_analyst: float,
    n_analog: int,
    channel_confidence: float,
    web: WebNewsFallback | None,
) -> tuple[float, bool]:
    if evidence_sufficient(n_analog, channel_confidence):
        return 0.0, False
    if web is None:
        return 0.0, False

    cap = min(0.5 * abs(I_quant) + 0.5 * abs(I_analyst), NEWS_ABS_CAP_PCT)
    if n_analog == 0:
        cap = min(cap, NEWS_ABS_CAP_PCT)

    magnitude = min(abs(web.I_web_direction_pct) * web.narrative_strength, cap)
    raw_sign = 1.0 if web.I_web_direction_pct >= 0 else -1.0

    if tone == "up":
        sign = raw_sign
    elif tone == "down":
        sign = -raw_sign
    else:
        sign = raw_sign
        magnitude = min(magnitude, DEFAULT_NEUTRAL_CAP_PCT)

    return sign * magnitude, True


def blend_event_impact(
    weights: ChannelWeights,
    I_quant: float,
    I_analyst: float,
    I_news: float,
) -> tuple[float, str]:
    impact = weights.quant * I_quant + weights.analyst * I_analyst + weights.news * I_news
    formula = (
        f"{weights.quant:.2f}*{I_quant:.1f} + "
        f"{weights.analyst:.2f}*{I_analyst:.1f} + "
        f"{weights.news:.2f}*{I_news:.1f}"
    )
    return impact, formula


def format_impact_pct(cumulative_pct: float) -> str:
    sign = "+" if cumulative_pct >= 0 else ""
    return f"{sign}{cumulative_pct:.1f}%"


def format_forecast(forecast_pct: float, target: str = "KOSPI") -> str:
    sign = "+" if forecast_pct >= 0 else ""
    return f"{target} {sign}{forecast_pct:.1f}%"


def enforce_monotonicity(
    increments: list[float],
    tone: Tone,
    *,
    eps: float = MONOTONICITY_EPS_PCT,
) -> list[float]:
    """Adjust event increments to respect cumulative tone constraints."""
    if not increments:
        return increments

    adjusted = list(increments)
    cumulative = 0.0
    cumulatives: list[float] = []

    for inc in adjusted:
        cumulative += inc
        cumulatives.append(cumulative)

    if tone == "up":
        for i in range(1, len(cumulatives)):
            if cumulatives[i] + eps < cumulatives[i - 1]:
                delta = cumulatives[i - 1] - cumulatives[i]
                adjusted[i] += delta + eps
                cumulatives[i] = cumulatives[i - 1] + eps
    elif tone == "down":
        for i in range(1, len(cumulatives)):
            if cumulatives[i] - eps > cumulatives[i - 1]:
                delta = cumulatives[i] - cumulatives[i - 1]
                adjusted[i] -= delta + eps
                cumulatives[i] = cumulatives[i - 1] - eps
    else:
        cap = DEFAULT_NEUTRAL_CAP_PCT
        if abs(cumulatives[-1]) > cap:
            scale = cap / abs(cumulatives[-1])
            adjusted = [v * scale for v in adjusted]

    return adjusted


def build_path(
    base_index: float,
    index_levels: Sequence[float],
    *,
    path_points: int = 12,
    horizon_trading_days: int = 22,
) -> tuple[float, ...]:
    """Linear interpolation across start + three event anchor levels."""
    if path_points < 2:
        raise ValueError("path_points must be at least 2")

    anchors_x = [0.0]
    anchors_y = [base_index]
    if len(index_levels) >= 3:
        for k, level in enumerate(index_levels[:3], start=1):
            anchors_x.append(k * horizon_trading_days / 3)
            anchors_y.append(level)
    else:
        for k, level in enumerate(index_levels, start=1):
            anchors_x.append(k * horizon_trading_days / max(len(index_levels), 1))
            anchors_y.append(level)

    path: list[float] = []
    for i in range(path_points):
        t = i * horizon_trading_days / (path_points - 1)
        if t <= anchors_x[0]:
            path.append(anchors_y[0])
            continue
        if t >= anchors_x[-1]:
            path.append(anchors_y[-1])
            continue
        for j in range(len(anchors_x) - 1):
            x0, x1 = anchors_x[j], anchors_x[j + 1]
            if x0 <= t <= x1:
                y0, y1 = anchors_y[j], anchors_y[j + 1]
                if math.isclose(x1, x0):
                    path.append(y1)
                else:
                    frac = (t - x0) / (x1 - x0)
                    path.append(y0 + frac * (y1 - y0))
                break

    path[0] = base_index
    return tuple(path)


def build_impact_model(
    *,
    scenario_id: str,
    base_index: float,
    tone: Tone,
    weights: ChannelWeights,
    channel_inputs: Sequence[EventChannelInput],
    event_meta: Sequence[EventMeta],
    web_fallbacks: dict[str, WebNewsFallback] | None = None,
    horizon_trading_days: int = 22,
    path_points: int = 12,
    band_low_pct: float | None = None,
    band_high_pct: float | None = None,
    limitations: Sequence[str] = (),
) -> ImpactModelResult:
    """Compose full impact model from channel estimates and metadata."""
    if len(channel_inputs) != 3 or len(event_meta) != 3:
        raise ValueError("expected exactly 3 events")

    web_fallbacks = web_fallbacks or {}
    meta_by_key = {m.event_key: m for m in event_meta}
    raw_increments: list[float] = []
    event_results: list[ImpactEventResult] = []

    for ch in channel_inputs:
        meta = meta_by_key[ch.event_key]
        web = web_fallbacks.get(ch.event_key)
        I_news, news_used = compute_news_channel(
            tone=tone,
            I_quant=ch.I_quant_pct,
            I_analyst=ch.I_analyst_pct,
            n_analog=ch.n_analog,
            channel_confidence=ch.channel_confidence,
            web=web,
        )
        if ch.I_news_pct is not None and not evidence_sufficient(ch.n_analog, ch.channel_confidence):
            I_news = ch.I_news_pct
            news_used = True

        impact, formula = blend_event_impact(weights, ch.I_quant_pct, ch.I_analyst_pct, I_news)
        raw_increments.append(impact)

    adjusted = enforce_monotonicity(raw_increments, tone)
    cumulative = 0.0
    index_levels: list[float] = []

    for ch, inc in zip(channel_inputs, adjusted):
        meta = meta_by_key[ch.event_key]
        cumulative += inc
        level = base_index * (1 + cumulative / 100)
        index_levels.append(level)

        web = web_fallbacks.get(ch.event_key)
        I_news, news_used = compute_news_channel(
            tone=tone,
            I_quant=ch.I_quant_pct,
            I_analyst=ch.I_analyst_pct,
            n_analog=ch.n_analog,
            channel_confidence=ch.channel_confidence,
            web=web,
        )
        if ch.I_news_pct is not None and not evidence_sufficient(ch.n_analog, ch.channel_confidence):
            I_news = ch.I_news_pct
            news_used = True
        _, formula = blend_event_impact(weights, ch.I_quant_pct, ch.I_analyst_pct, I_news)

        event_results.append(
            ImpactEventResult(
                event_key=ch.event_key,
                week=meta.week,
                category=meta.category,
                title=meta.title,
                body=meta.body,
                quant_pct=ch.I_quant_pct,
                analyst_pct=ch.I_analyst_pct,
                news_pct=I_news,
                news_fallback_used=news_used,
                impact_pct=inc,
                cumulative_impact_pct=cumulative,
                index_level=level,
                impact_formula=formula,
            )
        )

    path = build_path(base_index, index_levels, path_points=path_points, horizon_trading_days=horizon_trading_days)
    forecast_pct = (path[-1] / base_index - 1) * 100

    return ImpactModelResult(
        scenario_id=scenario_id,
        base_index=base_index,
        tone=tone,
        weights=weights,
        events=tuple(event_results),
        path=path,
        forecast_pct=forecast_pct,
        forecast=format_forecast(forecast_pct),
        band_low_pct=band_low_pct,
        band_high_pct=band_high_pct,
        limitations=tuple(limitations),
    )
