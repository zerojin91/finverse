from datetime import UTC, date, datetime

from services.paper_trading.finverse_market_data import assign_news_session


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
