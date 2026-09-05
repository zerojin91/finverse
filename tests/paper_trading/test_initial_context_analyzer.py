from services.paper_trading.config import Config
from services.paper_trading.initial_context_analyzer import (
    _mark_direct_event_evidence,
    _normalize,
    clear_initial_context_cache,
    get_initial_context_documents,
)


def _history():
    return {
        "ticker": "005930",
        "name": "삼성전자",
        "start_date": "2026-08-01",
        "end_date": "2026-09-01",
        "market_days": [
            {
                "trade_date": "2026-08-28", "open": 100, "high": 110, "low": 98,
                "close": 108, "volume": 1200, "investor_flow": {"foreign": 1000},
                "events": [{"title": "반도체 수요 전망 발표", "summary": "수요 회복 기대", "scope": "market", "event_types": ["news"], "source_score": 6}],
            },
            {
                "trade_date": "2026-09-01", "open": 108, "high": 112, "low": 105,
                "close": 110, "volume": 1500, "investor_flow": {"foreign": 1200}, "events": [],
            },
        ],
        "macro_observations": [{"trade_date": "2026-08-28", "series_name": "한국은행 기준금리", "value": 3.0, "unit": "%", "source": "bok"}],
        "social_signals": [{"trade_date": "2026-08-28", "sentiment": 0.2, "post_count": 30, "engagement": 90}],
        "quality": {},
    }


def test_document_preparation_returns_four_target_evidence_previews(tmp_path, monkeypatch):
    monkeypatch.setattr(Config, "UPLOAD_FOLDER", str(tmp_path))

    result = get_initial_context_documents(_history())

    assert result["context_id"].startswith("ctx_")
    assert set(result["source_summary"]["document_previews"]) == {"market", "economy", "events", "community"}
    assert (tmp_path / "market_cache" / f"initial-context-{result['context_id'][4:]}" / "market-evidence.md").is_file()


def test_clear_initial_context_cache_removes_only_the_selected_snapshot(tmp_path, monkeypatch):
    monkeypatch.setattr(Config, "UPLOAD_FOLDER", str(tmp_path))
    prepared = get_initial_context_documents(_history())
    cache_root = tmp_path / "market_cache"
    analysis_path = cache_root / f"initial-context-{prepared['context_id'][4:]}.json"
    analysis_path.write_text("{}", encoding="utf-8")

    result = clear_initial_context_cache(_history())

    assert result["analysis_removed"] is True
    assert result["documents_removed"] is True
    assert not analysis_path.exists()
    assert not (cache_root / f"initial-context-{prepared['context_id'][4:]}").exists()


def test_event_sequence_is_normalized_and_preserves_evidence_basis():
    result = _normalize({
        "summary": "요약",
        "event_sequence": [
            {"date": "2026-08-28", "title": "실제 사건", "description": "근거", "domain": "사건", "market_reaction": "거래량 증가", "basis": "observed"},
            {"date": "2026-08-29", "title": "문서 종합", "basis": "unknown"},
            {"date": "2026-08-30"},
        ],
    })

    assert [item["title"] for item in result["event_sequence"]] == ["실제 사건", "문서 종합"]
    assert result["event_sequence"][0]["basis"] == "observed"
    assert result["event_sequence"][1]["basis"] == "inferred"


def test_summary_points_are_limited_to_five_without_list_marker():
    result = _normalize({
        "summary": "요약",
        "summary_points": ["- 첫째임", "둘째임", "셋째임", "넷째임", "다섯째임", "여섯째임"],
    })

    assert result["summary_points"] == ["첫째임", "둘째임", "셋째임", "넷째임", "다섯째임"]


def test_summary_points_keep_full_sentence_detail():
    point = "최근 30거래일 종가가 하락했고 외국인 수급 변화가 함께 관측돼 단기 변동성을 계속 살필 필요 있음"
    result = _normalize({"summary": "요약", "summary_points": [point] * 5})

    assert result["summary_points"][0] == point


def test_source_news_marks_matching_inferred_timeline_item_as_observed():
    analysis = _normalize({
        "summary": "요약",
        "event_sequence": [{
            "date": "2026-08-26",
            "title": "미국 연준 위원장 잭슨홀 연설 앞두고 채권시장 불안",
            "basis": "inferred",
        }],
    })

    _mark_direct_event_evidence(analysis, [{
        "date": "2026-08-26",
        "title": "미국 연준 위원장 잭슨홀 연설 앞두고 채권시장 불안",
    }])

    assert analysis["event_sequence"][0]["basis"] == "observed"
