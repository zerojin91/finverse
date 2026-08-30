from services.paper_trading.news_impact_analyzer import deduplicate_and_score, score_event


def test_news_impact_is_bounded_and_explainable():
    event = score_event({"title": "어닝 서프라이즈와 자사주 매입 발표",
                         "publisher": "기업 IR", "source_score": 7})
    assert 0 < event["impact"] <= .7
    assert event["impact_confidence"] > .5
    assert event["impact_reasons"]
    assert event["impact_duration_days"] >= 1


def test_duplicate_urls_are_collapsed_and_unknown_direction_is_neutral():
    events, removed = deduplicate_and_score([
        {"title": "기사 A", "url": "https://example.com/a?utm_source=x", "source_score": 1},
        {"title": "기사 A 재송고", "url": "https://example.com/a", "source_score": 5},
    ])
    assert len(events) == 1
    assert removed == 1
    assert events[0]["impact"] == 0
