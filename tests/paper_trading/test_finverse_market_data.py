from datetime import UTC, date, datetime

from services.paper_trading.finverse_market_data import (
    assign_news_session,
    scenario_news_scope,
    security_name_aliases,
)


DATES = [date(2026, 8, 21), date(2026, 8, 24), date(2026, 8, 25)]


def test_news_before_open_is_visible_same_session():
    target, visible = assign_news_session(datetime(2026, 8, 20, 23, 30, tzinfo=UTC), DATES)
    assert target == date(2026, 8, 21)
    assert visible is True


def test_intraday_news_is_hidden_until_close():
    target, visible = assign_news_session(datetime(2026, 8, 21, 3, 0, tzinfo=UTC), DATES)
    assert target == date(2026, 8, 21)
    assert visible is False


def test_after_close_and_weekend_news_moves_to_next_session():
    target, visible = assign_news_session(datetime(2026, 8, 21, 8, 0, tzinfo=UTC), DATES)
    assert (target, visible) == (date(2026, 8, 24), True)
    target, visible = assign_news_session(datetime(2026, 8, 23, 5, 0, tzinfo=UTC), DATES)
    assert (target, visible) == (date(2026, 8, 24), True)


def test_scenario_news_keeps_target_and_macro_but_excludes_another_company():
    aliases = security_name_aliases("삼성전자", "Samsung Electronics")

    assert scenario_news_scope("삼성전자, AI 메모리 수요 전망", "", aliases) == "security"
    assert scenario_news_scope("한국은행 기준금리 동결", "거시 환경 변화", aliases) == "market"
    assert scenario_news_scope("HD현대건설기계, 외환거래 오류 과태료", "", aliases) is None
