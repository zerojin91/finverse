"""Tests for scenario card impact_model."""

import pytest

from agents.scenario_card.impact_model import (
    EventChannelInput,
    EventMeta,
    WebNewsFallback,
    backfill_series,
    build_impact_model,
    compute_volume_regime,
    format_impact_pct,
    weights_from_activity,
    compute_news_channel,
)


def test_backfill_series_forward_backward():
    values = [None, 100.0, None, 120.0, None]
    filled, applied = backfill_series(values)
    assert applied
    assert filled == [100.0, 100.0, 100.0, 120.0, 120.0]


def test_volume_regime_hot_market():
    # rising trading values → high activity
    tvs = [800.0] * 200 + [1200.0] * 44
    regime = compute_volume_regime(tvs)
    assert regime.weights.quant > regime.weights.news
    assert abs(regime.weights.quant + regime.weights.news + regime.weights.analyst - 1.0) < 1e-9


def test_weights_from_activity_bounds():
    quiet = weights_from_activity(0.0)
    hot = weights_from_activity(1.0)
    assert quiet.quant == pytest.approx(0.18)
    assert hot.quant == pytest.approx(0.50)
    assert quiet.news == pytest.approx(0.42)
    assert hot.news == pytest.approx(0.20)


def test_build_impact_model_up_monotonic():
    weights = weights_from_activity(0.5)
    channels = [
        EventChannelInput("e1", 5.0, 6.0, n_analog=3, channel_confidence=0.8),
        EventChannelInput("e2", 4.0, 5.0, n_analog=3, channel_confidence=0.8),
        EventChannelInput("e3", 3.0, 4.0, n_analog=3, channel_confidence=0.8),
    ]
    meta = [
        EventMeta("e1", "8/4 전후", "수급", "t1", "b1"),
        EventMeta("e2", "8/11 전후", "AI", "t2", "b2"),
        EventMeta("e3", "8/28 전후", "분기", "t3", "b3"),
    ]
    result = build_impact_model(
        scenario_id="test-up",
        base_index=6000.0,
        tone="up",
        weights=weights,
        channel_inputs=channels,
        event_meta=meta,
    )
    assert len(result.path) == 12
    assert result.path[0] == 6000.0
    assert result.path[-1] >= result.path[0]
    cum = [e.cumulative_impact_pct for e in result.events]
    assert cum[0] <= cum[1] <= cum[2]
    assert format_impact_pct(cum[-1]).startswith("+")


def test_web_fallback_when_evidence_insufficient():
    weights = weights_from_activity(0.0)
    channels = [
        EventChannelInput("e1", 2.0, 2.0, n_analog=0, channel_confidence=0.2),
        EventChannelInput("e2", 1.0, 1.0, n_analog=0, channel_confidence=0.2),
        EventChannelInput("e3", 1.0, 1.0, n_analog=0, channel_confidence=0.2),
    ]
    meta = [
        EventMeta("e1", "w1", "c", "t", "b"),
        EventMeta("e2", "w2", "c", "t", "b"),
        EventMeta("e3", "w3", "c", "t", "b"),
    ]
    result = build_impact_model(
        scenario_id="test-fallback",
        base_index=6000.0,
        tone="up",
        weights=weights,
        channel_inputs=channels,
        event_meta=meta,
        web_fallbacks={"e1": WebNewsFallback(I_web_direction_pct=3.0, narrative_strength=0.8)},
    )
    assert result.events[0].news_fallback_used


def test_downside_web_fallback_is_negative_even_with_signed_input():
    impact, used = compute_news_channel(
        tone="down",
        I_quant=-2.0,
        I_analyst=-2.0,
        n_analog=0,
        channel_confidence=0.2,
        web=WebNewsFallback(I_web_direction_pct=-3.0, narrative_strength=0.8),
    )

    assert used
    assert impact == pytest.approx(-2.0)


def test_impact_model_formats_the_requested_target_name():
    weights = weights_from_activity(0.5)
    channels = [
        EventChannelInput("e1", 1.0, 1.0),
        EventChannelInput("e2", 1.0, 1.0),
        EventChannelInput("e3", 1.0, 1.0),
    ]
    meta = [
        EventMeta("e1", "w1", "c", "t1", "b1"),
        EventMeta("e2", "w2", "c", "t2", "b2"),
        EventMeta("e3", "w3", "c", "t3", "b3"),
    ]

    result = build_impact_model(
        scenario_id="target-name",
        base_index=1000.0,
        tone="up",
        weights=weights,
        channel_inputs=channels,
        event_meta=meta,
        target_name="KOSDAQ",
    )

    assert result.forecast.startswith("KOSDAQ +")
    assert result.as_dict()["target"] == "KOSDAQ"
