from __future__ import annotations

from services.paper_trading import agent_profiles
from services.paper_trading.config import Config


def _context() -> dict:
    return {
        "context_id": "ctx_1234567890abcdef",
        "analysis": {
            "summary_points": ["시장 관측", "경제 관측"],
            "risk_factors": ["변동성"], "watch_points": ["수급"],
            "event_sequence": [],
        },
        "source_summary": {"document_previews": {"market": "실제 가격 이력"}},
    }


def test_profile_generation_keeps_59_independent_specs_and_caches(tmp_path, monkeypatch):
    monkeypatch.setattr(Config, "UPLOAD_FOLDER", str(tmp_path))
    calls: list[str] = []

    def fake_generate(context, spec):
        calls.append(spec["persona_id"])
        return {**spec, "profile": agent_profiles._fallback_profile(spec),
                "profile_source": "test", "profile_error": None}

    monkeypatch.setattr(agent_profiles, "_generate_one", fake_generate)
    progress: list[tuple[int, int, str]] = []
    payload = agent_profiles.generate_agent_profiles(
        _context(), initial_price=70_000,
        progress=lambda done, total, agent_id: progress.append((done, total, agent_id)),
    )

    assert len(payload["profiles"]) == 59
    assert payload["counts"] == {"retail": 40, "foreign": 6, "institution": 12, "pension": 1}
    assert len(calls) == 59
    assert progress[-1][:2] == (59, 59)
    assert {row["persona_id"] for row in payload["profiles"]} == set(calls)

    cached = agent_profiles.generate_agent_profiles(_context(), initial_price=70_000)
    assert cached["cached"] is True
    assert len(calls) == 59
