"""Read-only adapter from the finverse PostgreSQL lake to paper trading."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import html
import re
from bisect import bisect_right
from datetime import date, datetime, time, timedelta
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
from zoneinfo import ZoneInfo
from typing import Any, Iterator

from .config import Config

from .kospi_paper_trading import TradingError
from .news_impact_analyzer import deduplicate_and_score
from .ontology import build_coverage_report, build_market_snapshot, preflight_simulation


INVESTOR_MAP = {
    "개인": "retail",
    "외국인": "foreign",
    "기관계": "institution",
    "기관": "institution",
    "연기금등": "pension",
    "연기금": "pension",
}


class FinverseUnavailable(TradingError):
    """Raised when the configured finverse lake cannot be reached."""


# selection_score 3점대는 시장과 무관한 기사가 대부분이라 걷어낸다.
# (분포: 7점 10건, 6점 9건, 5점 142건, 4점 590건, 3점 354건)
MIN_NEWS_SCORE = 4
# 조회 창을 지정하지 않으면 이 일수만큼 거슬러 올라간다. 가격 충격 모델을
# 보정하려면 100거래일 이상이 필요해서 달력 기준으로 넉넉히 잡는다.
DEFAULT_HISTORY_DAYS = 240
# lake.records는 2,500만 행이라 콜드 캐시에서 한 번 훑는 데 30초까지 걸린다.
# 같은 종목·기간을 다시 부를 때 그 값을 다시 치르지 않도록 디스크에 남긴다.
HISTORY_CACHE_TTL_SECONDS = 12 * 60 * 60
# 뉴스 분류 규칙이 바뀌면 이전의 전체-뉴스 캐시를 재사용하면 안 된다.
HISTORY_CACHE_SCHEMA_VERSION = "targeted-news-community-v4"

# ``events.news``에는 종목 ticker 태그가 비어 있는 경우가 많다. 따라서 선택
# 종목명으로 직접 확인되는 기사와 명백한 시장 전체 기사만 시나리오에 넣는다.
# 개별 타사 기사(예: HD현대건설기계 제재)는 삼성전자 시나리오의 근거가 될 수 없다.
MARKET_WIDE_NEWS_TERMS = (
    "한국은행", "기준금리", "통화정책", "연준", "fomc", "금리", "국채", "채권",
    "환율", "원화", "달러", "인플레이", "물가", "고용", "경기", "gdp",
    "유가", "wti", "opec", "코스피", "kospi", "코스닥", "kosdaq", "증시",
    "주가지수", "관세", "무역 분쟁", "제재", "지정학", "전쟁", "반도체 업황",
)


def plain_text(value: str | None, limit: int = 600) -> str:
    """Strip markup from a summary.

    Central bank press releases arrive as raw HTML fragments (inline styles and
    all), which would otherwise be handed to the LLM verbatim.
    """
    text = html.unescape(re.sub(r"<[^>]+>", " ", str(value or "")))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def security_name_aliases(name: str | None, english_name: str | None) -> tuple[str, ...]:
    """Return stable company-name aliases for untagged news matching."""
    aliases: list[str] = []
    for raw in (name, english_name):
        value = re.sub(r"(보통주|우선주|\(주\)|주식회사)$", "", str(raw or "")).strip()
        if len(value) >= 2:
            aliases.append(value.casefold())
        words = re.findall(r"[A-Z][a-z]+|[가-힣]+", value)
        if len(words) > 1 and len(words[0]) >= 4:
            aliases.append(words[0].casefold())
    return tuple(dict.fromkeys(aliases))


def scenario_news_scope(title: str, summary: str, aliases: tuple[str, ...]) -> str | None:
    """Classify news as target-security, market-wide, or irrelevant."""
    haystack = f"{title} {summary}".casefold()
    if any(alias in haystack for alias in aliases):
        return "security"
    if any(term.casefold() in haystack for term in MARKET_WIDE_NEWS_TERMS):
        return "market"
    return None


def assign_news_session(published: datetime, trading_dates: list[date]) -> tuple[date | None, bool]:
    """Map publication time to its first usable KOSPI decision/session."""
    if published.tzinfo is None:
        published = published.replace(tzinfo=ZoneInfo("UTC"))
    local = published.astimezone(ZoneInfo("Asia/Seoul"))
    local_date = local.date()
    if local_date in trading_dates and local.time() <= time(15, 30):
        return local_date, local.time() < time(9, 0)
    next_index = bisect_right(trading_dates, local_date)
    return (trading_dates[next_index], True) if next_index < len(trading_dates) else (None, False)


class FinverseMarketData:
    def __init__(self, database_url: str | None):
        self.database_url = (database_url or "").strip()

    @contextmanager
    def _connection(self, statement_timeout: str = "30s") -> Iterator[Any]:
        if not self.database_url:
            raise FinverseUnavailable("FINVERSE_DATABASE_URL이 설정되지 않았습니다.")
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise FinverseUnavailable("finverse DB 연결용 psycopg 패키지가 설치되지 않았습니다.") from exc
        # 예전에는 SET LOCAL로 타임아웃을 걸었는데, 폴백 경로의 rollback()이
        # 트랜잭션을 끝내면서 설정이 함께 사라졌다. 그 상태에서 콜드 스캔에
        # 걸리면 클라이언트가 무한정 매달린다(실측 107초 뒤 폴백).
        # 접속 옵션으로 넣으면 세션 전체에 처음부터 적용된다.
        options = (f"-c statement_timeout={statement_timeout} "
                   f"-c default_transaction_read_only=on "
                   f"-c idle_in_transaction_session_timeout=15s")
        try:
            with psycopg.connect(self.database_url, row_factory=dict_row,
                                 connect_timeout=8, autocommit=True,
                                 options=options) as connection:
                yield connection
        except FinverseUnavailable:
            raise
        except Exception as exc:
            raise FinverseUnavailable(f"finverse PostgreSQL 연결에 실패했습니다: {exc}") from exc

    def _fetch(self, sql: str, params: tuple, statement_timeout: str) -> list[dict[str, Any]]:
        """Run one read-only query on its own connection."""
        try:
            with self._connection(statement_timeout) as connection, connection.cursor() as cursor:
                cursor.execute(sql, params)
                return [dict(row) for row in cursor.fetchall()]
        except FinverseUnavailable as exc:
            # SSH 터널 접속 성공 뒤 서버 쿼리 제한에 걸린 경우까지 연결 실패로
            # 보이면 사용자가 PEM/네트워크를 잘못 진단하게 된다.
            if "statement timeout" in str(exc):
                raise FinverseUnavailable(
                    "finverse PostgreSQL 데이터 조회 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.") from exc
            raise

    def _fetch_parallel(self, queries: dict[str, tuple[str, tuple]],
                        statement_timeout: str = "40s") -> dict[str, Any]:
        """Run independent queries concurrently, one connection each.

        The link to finverse is a ~210ms hop and a cold pass over the 25M-row
        lake can take half a minute. Run sequentially that is well over a
        minute; run together it costs the slowest single query.

        Each entry comes back as a row list, or as the exception it raised so
        the caller can decide which datasets are optional.
        """
        results: dict[str, Any] = {}
        with ThreadPoolExecutor(max_workers=min(len(queries), 8)) as pool:
            submitted = {
                name: pool.submit(self._fetch, sql, params, statement_timeout)
                for name, (sql, params) in queries.items()
            }
            for name, future in submitted.items():
                try:
                    results[name] = future.result()
                except Exception as exc:  # noqa: BLE001 - 호출자가 필수/선택을 판단한다
                    results[name] = exc
        return results

    def list_kospi_securities(self, query: str = "", limit: int = 30) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 100))
        pattern = f"%{query.strip()}%"
        sql = """
            SELECT DISTINCT ON (ticker)
                ticker, coalesce(short_name, name) AS name, share_type, listed_on
            FROM market.security
            WHERE market = 'KOSPI'
              AND (%s = '%%' OR ticker ILIKE %s OR name ILIKE %s OR short_name ILIKE %s)
            ORDER BY ticker, (source = 'krx_open_api') DESC, listed_on DESC NULLS LAST
            LIMIT %s
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(sql, (pattern, pattern, pattern, pattern, limit))
            return [dict(row) for row in cursor.fetchall()]

    def load_recent_candles(self, ticker: str, limit: int = 36) -> list[dict[str, Any]]:
        """Return a small, read-only OHLC window for the security picker."""
        ticker = str(ticker).zfill(6)
        limit = max(12, min(int(limit), 60))
        sql = """
            WITH chosen AS (
              SELECT DISTINCT ON (payload->>'bas_dd')
                to_date(payload->>'bas_dd', 'YYYYMMDD') AS trade_date,
                (payload->>'open')::numeric AS open,
                (payload->>'high')::numeric AS high,
                (payload->>'low')::numeric AS low,
                (payload->>'close')::numeric AS close,
                coalesce(NULLIF(payload->>'volume', '')::bigint, 0) AS volume
              FROM lake.records
              WHERE record_type = 'market_price_daily'
                AND payload @> jsonb_build_object('ticker', %s::text, 'market', 'KOSPI')
                AND payload->>'bas_dd' >= to_char(current_date - interval '180 days', 'YYYYMMDD')
              ORDER BY payload->>'bas_dd',
                       (payload->>'source' = 'krx_open_api') DESC, payload->>'source'
            ), recent AS (
              SELECT * FROM chosen ORDER BY trade_date DESC LIMIT %s
            )
            SELECT trade_date, open, high, low, close, volume
            FROM recent
            ORDER BY trade_date
        """
        rows = self._fetch(sql, (ticker, limit), "45s")
        return [{
            "market_date": row["trade_date"].isoformat(),
            "open": int(row["open"]), "high": int(row["high"]),
            "low": int(row["low"]), "close": int(row["close"]),
            "volume": int(row["volume"] or 0), "real": True,
        } for row in rows]

    def collect_scenario_context(self, ticker: str) -> dict[str, Any]:
        """Load the four evidence domains used by a paper-trading scenario.

        This deliberately reuses ``load_game_data``: the picker warms the same
        local history cache that scenario creation consumes, without starting
        an LLM, ontology, or MiroFish run.
        """
        history = self.load_game_data(ticker, "", "")
        market_days = history["market_days"]
        latest_market_day = market_days[-1]["trade_date"] if market_days else None
        event_count = sum(len(day.get("events") or []) for day in market_days)

        def latest(rows: list[dict[str, Any]], field: str = "trade_date") -> str | None:
            values = [str(row[field]) for row in rows if row.get(field)]
            return max(values) if values else None

        sources = [
            {
                "key": "market", "label": "시장", "status": "ready" if market_days else "missing",
                "count": len(market_days), "unit": "거래일", "updated_at": latest_market_day,
                "detail": "종목 시세·거래량·투자자 수급",
            },
            {
                "key": "economy", "label": "경제", "status": "ready" if history["macro_observations"] else "missing",
                "count": len(history["macro_observations"]), "unit": "지표", "updated_at": latest(history["macro_observations"]),
                "detail": "금리·환율·국채 등 거시 지표",
            },
            {
                "key": "events", "label": "사건", "status": "ready" if event_count else "missing",
                "count": event_count, "unit": "건", "updated_at": latest_market_day,
                "detail": "종목·시장 관련 뉴스와 이벤트",
            },
            {
                "key": "community", "label": "커뮤니티",
                "status": "ready" if (history["social_signals"] or history.get("community_comments")) else "missing",
                "count": len(history.get("community_comments") or history["social_signals"]),
                "unit": "댓글" if history.get("community_comments") else "일",
                "updated_at": latest(history.get("community_comments") or history["social_signals"], "published_at" if history.get("community_comments") else "trade_date"),
                "detail": "종목 영상의 고반응 댓글과 온라인 언급 추이",
            },
        ]
        return {"ticker": history["ticker"], "name": history["name"], "sources": sources}

    def healthcheck(self) -> dict[str, Any]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT current_database() AS database, current_user AS user, now() AS checked_at")
            row = dict(cursor.fetchone())
            row["checked_at"] = row["checked_at"].isoformat()
            return {"connected": True, **row}

    @staticmethod
    def _history_window(start_date: str, end_date: str) -> tuple[date, date]:
        """Resolve the lookback window, filling in a default when omitted.

        The scenario UI only asks the user for a ticker; it has no reason to
        know how much history the impact model needs. An empty string used to
        raise here, which made every ticker except the cached one fail outright.
        """
        try:
            end = (date.fromisoformat(end_date.strip())
                   if str(end_date or "").strip() else date.today())
            start = (date.fromisoformat(start_date.strip())
                     if str(start_date or "").strip()
                     else end - timedelta(days=DEFAULT_HISTORY_DAYS))
        except (AttributeError, TypeError, ValueError) as exc:
            raise TradingError("시작일과 종료일은 YYYY-MM-DD 형식이어야 합니다.") from exc
        if start > end:
            raise TradingError("시작일은 종료일보다 늦을 수 없습니다.")
        if (end - start).days > 366:
            raise TradingError("단일 종목 POC의 조회 기간은 최대 366일입니다.")
        return start, end

    @staticmethod
    def _cache_path(ticker: str, start: date, end: date) -> Path:
        key = hashlib.sha256(
            f"{HISTORY_CACHE_SCHEMA_VERSION}|{ticker}|{start}|{end}".encode("utf-8")
        ).hexdigest()[:16]
        root = Path(Config.UPLOAD_FOLDER) / "market_cache"
        root.mkdir(parents=True, exist_ok=True)
        return root / f"{ticker}_{key}.json"

    def _cached_history(self, path: Path) -> dict[str, Any] | None:
        try:
            # datetime.time을 이미 임포트해서 time 모듈을 못 쓴다.
            age = datetime.now().timestamp() - path.stat().st_mtime
            if age > HISTORY_CACHE_TTL_SECONDS:
                return None
            with path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    @staticmethod
    def _store_history(path: Path, payload: dict[str, Any]) -> None:
        """Persist atomically so a crashed write never leaves a half file."""
        try:
            descriptor, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False)
            os.replace(temporary, path)
        except OSError:
            pass  # 캐시는 가속용이다. 못 써도 조회 자체는 성공했다.

    def load_game_data(self, ticker: str, start_date: str, end_date: str) -> dict[str, Any]:
        ticker = str(ticker).zfill(6)
        start, end = self._history_window(start_date, end_date)
        cache_path = self._cache_path(ticker, start, end)
        cached = self._cached_history(cache_path)
        if cached is not None:
            return cached

        security_sql = """
            SELECT DISTINCT ON (ticker) ticker, coalesce(short_name, name) AS name,
                   english_name
            FROM market.security
            WHERE market = 'KOSPI' AND ticker = %s
            ORDER BY ticker, (source = 'krx_open_api') DESC
        """
        lake_price_sql = """
            SELECT trade_date, open, high, low, close, volume, trading_value,
                   market_cap, listed_shares, record_id, source
            FROM (
              SELECT DISTINCT ON (payload->>'bas_dd')
                to_date(payload->>'bas_dd', 'YYYYMMDD') AS trade_date,
                (payload->>'open')::numeric AS open, (payload->>'high')::numeric AS high,
                (payload->>'low')::numeric AS low, (payload->>'close')::numeric AS close,
                (payload->>'volume')::bigint AS volume,
                (payload->>'trading_value')::bigint AS trading_value,
                NULLIF(payload->>'market_cap', '')::bigint AS market_cap,
                NULLIF(payload->>'listed_shares', '')::bigint AS listed_shares,
                coalesce(payload->>'record_id', record_id) AS record_id,
                payload->>'source' AS source
              FROM lake.records
              WHERE record_type = 'market_price_daily'
                AND payload @> jsonb_build_object('ticker', %s::text)
                AND payload->>'market' = 'KOSPI'
                AND payload->>'bas_dd' BETWEEN %s AND %s
              ORDER BY payload->>'bas_dd',
                       (payload->>'source' = 'krx_open_api') DESC, payload->>'source'
            ) chosen ORDER BY trade_date
        """
        lake_previous_close_sql = """
            SELECT (payload->>'close')::numeric AS close
            FROM lake.records
            WHERE record_type = 'market_price_daily'
              AND payload @> jsonb_build_object('ticker', %s::text)
              AND payload->>'market' = 'KOSPI'
              AND payload->>'bas_dd' < %s
            ORDER BY payload->>'bas_dd' DESC,
                     (payload->>'source' = 'krx_open_api') DESC
            LIMIT 1
        """
        lake_flow_sql = """
            SELECT trade_date, investor, net_volume, net_value_krw, source
            FROM (
                SELECT DISTINCT ON (payload->>'bas_dd', payload->>'investor')
                    to_date(payload->>'bas_dd', 'YYYYMMDD') AS trade_date,
                    payload->>'investor' AS investor,
                    NULLIF(payload->>'net_volume', '')::bigint AS net_volume,
                    NULLIF(payload->>'net_value_krw', '')::bigint AS net_value_krw,
                    payload->>'source' AS source
                FROM lake.records
                WHERE record_type = 'market_investor_flow_daily'
                  AND payload @> jsonb_build_object('target', %s::text, 'target_type', 'STOCK')
                  AND payload->>'bas_dd' BETWEEN %s AND %s
                  AND payload->>'investor' = ANY(%s)
                ORDER BY payload->>'bas_dd', payload->>'investor',
                         (payload->>'source' = 'naver_finance') DESC, payload->>'source'
            ) chosen ORDER BY trade_date, investor
        """
        lake_market_flow_sql = """
            SELECT trade_date, investor, net_value_krw
            FROM (
                SELECT DISTINCT ON (payload->>'bas_dd', payload->>'investor')
                    to_date(payload->>'bas_dd', 'YYYYMMDD') AS trade_date,
                    payload->>'investor' AS investor,
                    NULLIF(payload->>'net_value_krw', '')::bigint AS net_value_krw,
                    payload->>'source' AS source
                FROM lake.records
                WHERE record_type = 'market_investor_flow_daily'
                  AND payload @> jsonb_build_object('target', 'KOSPI', 'target_type', 'MARKET')
                  AND payload->>'bas_dd' BETWEEN %s AND %s
                  AND payload->>'investor' = ANY(%s)
                ORDER BY payload->>'bas_dd', payload->>'investor',
                         (payload->>'source' = 'naver_finance') DESC, payload->>'source'
            ) chosen ORDER BY trade_date, investor
        """
        lake_holding_sql = """
            SELECT trade_date, held_shares, held_pct
            FROM (
                SELECT DISTINCT ON (payload->>'bas_dd')
                    to_date(payload->>'bas_dd', 'YYYYMMDD') AS trade_date,
                    NULLIF(payload->>'held_shares', '')::bigint AS held_shares,
                    NULLIF(payload->>'held_pct', '')::numeric AS held_pct,
                    payload->>'source' AS source
                FROM lake.records
                WHERE record_type = 'market_foreign_holding_daily'
                  AND payload @> jsonb_build_object('ticker', %s::text)
                  AND payload->>'bas_dd' BETWEEN %s AND %s
                ORDER BY payload->>'bas_dd',
                         (payload->>'source' = 'krx_open_api') DESC, payload->>'source'
            ) chosen ORDER BY trade_date
        """
        # 지수는 core.index_daily 실테이블에 이미 적재돼 있다(51만 행, 인덱스 보유).
        # market.index_daily 뷰를 거치면 같은 데이터를 lake에서 다시 파싱한다.
        core_index_sql = """
            SELECT trade_date, idx_class, idx_name, close, change_pct,
                   volume, trading_value, market_cap, source
            FROM (
                SELECT DISTINCT ON (bas_dd, idx_name) bas_dd AS trade_date, idx_class,
                       idx_name, close, change_pct, volume, trading_value,
                       market_cap, source
                FROM core.index_daily
                WHERE idx_name IN ('코스피', '코스닥', 'KOSPI', 'KOSDAQ')
                  AND bas_dd BETWEEN %s AND %s
                ORDER BY bas_dd, idx_name, (source = 'krx_open_api') DESC, source
            ) chosen ORDER BY trade_date, idx_name
        """
        # core.economic_observation은 비어 있다(적재 파이프라인이 채우지 않는다).
        # 실제 ECOS/KOSIS 관측치는 economy.observation 뷰에 들어 있고, 기준금리와
        # 원달러환율은 일별로 최신까지 이어진다.
        macro_sql = """
            SELECT series_id AS series_code, series_name, period_start, value, unit,
                   source, cycle, record_id
            FROM economy.observation
            WHERE period_start BETWEEN %s AND %s
            ORDER BY period_start, series_name
        """
        # 섹터는 온톨로지 그래프에 있다. 환율 같은 매크로 사건이 이 종목에
        # 순풍인지 역풍인지는 수출 성격에 달려 있어서 필요하다.
        sector_sql = """
            SELECT sec.props->>'name' AS sector
            FROM graph.node s
            JOIN graph.edge e ON e.src_uid = s.uid AND e.type = 'IN_SECTOR'
            JOIN graph.node sec ON sec.uid = e.dst_uid
            WHERE s.label = 'Security' AND s.props->>'ticker' = %s
            LIMIT 1
        """
        sentiment_sql = """
            SELECT sentiment_date, comment_count, bullish_count, bearish_count,
                   neutral_count, sentiment_score, engagement_count
            FROM psychology.sentiment_daily
            WHERE sentiment_date BETWEEN %s AND %s
            ORDER BY sentiment_date
        """
        # 종목 태그가 일치하는 YouTube 댓글을 전체 보존한다.
        # 일별 감성 집계만으로는 어떤 논점이 실제로 고반응을 얻었는지 알 수
        # 없으므로, 종목 태그가 일치하는 원문을 초기 맥락 문서에도 함께 준다.
        # youtube_video는 댓글 payload에 없는 제목을 보완하기 위한 선택적 조인이다.
        community_comments_sql = """
            SELECT c.payload->>'published_at' AS published_at,
                   c.payload->>'text' AS text,
                   COALESCE(NULLIF(c.payload->>'like_count', '')::int, 0) AS like_count,
                   COALESCE(NULLIF(c.payload->>'reply_count', '')::int, 0) AS reply_count,
                   NULLIF(c.payload->>'video_like_rank', '')::int AS video_like_rank,
                   c.payload->>'video_id' AS video_id,
                   c.payload->>'source_url' AS source_url,
                   v.payload->>'title' AS video_title,
                   c.payload->'search_tags' AS search_tags
            FROM lake.records c
            LEFT JOIN lake.records v
              ON v.record_type = 'youtube_video'
             AND v.payload->>'video_id' = c.payload->>'video_id'
             AND COALESCE(NULLIF(v.payload->>'is_deleted', '')::boolean, false) = false
            WHERE c.record_type = 'youtube_comment'
              AND c.payload->>'category' = 'community_v2'
              AND c.payload->'tags'->>'source' = 'youtube'
              AND COALESCE(NULLIF(c.payload->>'is_deleted', '')::boolean, false) = false
              AND c.payload->'search_matches' @> jsonb_build_array(jsonb_build_object('stock_code', %s::text))
              AND (c.payload->>'published_at')::timestamptz >= %s::timestamptz
              AND (c.payload->>'published_at')::timestamptz < %s::timestamptz
            ORDER BY COALESCE(NULLIF(c.payload->>'video_like_rank', '')::int, 999),
                     COALESCE(NULLIF(c.payload->>'like_count', '')::int, 0) DESC,
                     COALESCE(NULLIF(c.payload->>'reply_count', '')::int, 0) DESC,
                     (c.payload->>'published_at')::timestamptz DESC
        """
        # 기사 ticker 태그는 비어 있는 경우가 많아 SQL에서 종목으로 거르지 않는다.
        # 대신 아래에서 선택 종목명 또는 명백한 거시·시장 키워드로 좁힌다.
        news_sql = """
            SELECT published_at::date AS trade_date, published_at, title, summary,
                   publisher, feed, event_types, url, coalesce(selection_score, 0) AS score
            FROM events.news
            WHERE published_at::date BETWEEN %s AND %s
              AND coalesce(selection_score, 0) >= %s
            ORDER BY published_at, selection_score DESC NULLS LAST
        """
        start_ymd, end_ymd = start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
        investors = list(INVESTOR_MAP)

        # 가격·수급·외인보유는 lake.records를 직접 읽는다. market.* 는 같은
        # lake 위의 뷰인데, trade_date를 date로 캐스팅하는 탓에 bas_dd 표현식
        # 인덱스를 못 쓰고 2,500만 행을 훑는다(실측 107초 뒤 타임아웃).
        # 지수와 거시지표만 core 실테이블에 적재돼 있어 그쪽을 쓴다.
        queries = {
            "security": (security_sql, (ticker,)),
            "previous": (lake_previous_close_sql, (ticker, start_ymd)),
            "prices": (lake_price_sql, (ticker, start_ymd, end_ymd)),
            "flows": (lake_flow_sql, (ticker, start_ymd, end_ymd, investors)),
            "market_flows": (lake_market_flow_sql, (start_ymd, end_ymd, investors)),
            "holdings": (lake_holding_sql, (ticker, start_ymd, end_ymd)),
            "indices": (core_index_sql, (start, end)),
            "macro": (macro_sql, (start, end)),
            "sector": (sector_sql, (ticker,)),
            "sentiment": (sentiment_sql, (start, end)),
            "community_comments": (
                community_comments_sql,
                (ticker, start.isoformat(), (end + timedelta(days=1)).isoformat()),
            ),
            "news": (news_sql, (start - timedelta(days=7), end, MIN_NEWS_SCORE)),
        }
        fetched = self._fetch_parallel(queries)

        def required(name: str) -> list[dict[str, Any]]:
            value = fetched[name]
            if isinstance(value, Exception):
                raise FinverseUnavailable(
                    f"finverse 조회에 실패했습니다({name}): {value}") from value
            return value

        def optional(name: str) -> list[dict[str, Any]]:
            """Context datasets. Their absence degrades signal, not the run."""
            value = fetched[name]
            return [] if isinstance(value, Exception) else value

        security_rows = required("security")
        if not security_rows:
            raise TradingError(f"KOSPI 상장 종목을 찾을 수 없습니다: {ticker}")
        security = security_rows[0]
        aliases = security_name_aliases(security.get("name"), security.get("english_name"))
        previous_rows = required("previous")
        if not previous_rows:
            raise TradingError(f"시작일 이전 종가 데이터가 없습니다: {ticker}")
        previous = previous_rows[0]
        prices = required("prices")
        flows = optional("flows")
        market_flows = optional("market_flows")
        holdings = optional("holdings")
        indices = optional("indices")
        macro_observations = optional("macro")
        social_signals = optional("sentiment")
        community_comments = optional("community_comments")
        sector_rows = optional("sector")
        news = optional("news")

        if not prices:
            raise TradingError(f"선택한 기간에 가격 데이터가 없습니다: {ticker}")
        flow_by_day: dict[str, dict[str, int]] = {}
        price_by_day = {str(row["trade_date"]): int(row["close"]) for row in prices
                        if row.get("close") is not None}
        for row in flows:
            day = str(row["trade_date"])
            group = INVESTOR_MAP.get(row["investor"])
            if group and row["net_volume"] is not None:
                converted = int(row["net_volume"]) * price_by_day.get(day, 0)
                flow_by_day.setdefault(day, {})[group] = flow_by_day.setdefault(day, {}).get(group, 0) + converted
        market_flow_by_day: dict[str, dict[str, int]] = {}
        for row in market_flows:
            day = str(row["trade_date"])
            group = INVESTOR_MAP.get(row["investor"])
            if group and row["net_value_krw"] is not None:
                market_flow_by_day.setdefault(day, {})[group] = int(row["net_value_krw"])
        news_by_day: dict[str, list[dict[str, Any]]] = {}
        duplicate_news = 0
        trading_dates = sorted(row["trade_date"] for row in prices)
        for row in news:
            published = row.get("published_at")
            if not published:
                continue
            title = plain_text(row["title"], 300)
            summary = plain_text(row.get("summary"))
            scope = scenario_news_scope(title, summary, aliases)
            if scope is None:
                continue
            target_date, available_before_open = assign_news_session(published, trading_dates)
            if target_date is None:
                continue
            day = str(target_date)
            news_by_day.setdefault(day, []).append({
                "title": title,
                "summary": summary,
                "scope": scope,
                "publisher": row["publisher"], "feed": row.get("feed"),
                "event_types": row.get("event_types") or [], "url": row["url"],
                "published_at": published.isoformat() if published else None,
                "available_before_open": available_before_open,
                "source_score": float(row["score"] or 0),
            })
        for day, events in list(news_by_day.items()):
            scored, removed = deduplicate_and_score(events)
            # 하루치는 10건으로 잘리므로 중요한 것부터 남긴다.
            scored.sort(key=lambda item: (abs(item.get("impact", 0)),
                                          item.get("source_score", 0)), reverse=True)
            news_by_day[day] = scored
            duplicate_news += removed
        warnings = []
        market_days = []
        for row in prices:
            try:
                numeric = {key: int(row[key]) for key in
                           ("open", "high", "low", "close", "volume", "trading_value")}
            except (TypeError, ValueError):
                warnings.append(f"필수 가격 필드 누락: {row['trade_date']}")
                continue
            if min(numeric.values()) <= 0 or numeric["low"] > min(numeric["open"], numeric["close"]) or numeric["high"] < max(numeric["open"], numeric["close"]):
                warnings.append(f"비정상 OHLCV 제외: {row['trade_date']}")
                continue
            market_days.append({
                "trade_date": str(row["trade_date"]),
                **numeric, "price_source": row.get("source"),
                "market_cap": int(row["market_cap"]) if row.get("market_cap") is not None else None,
                "listed_shares": int(row["listed_shares"]) if row.get("listed_shares") is not None else None,
                "price_record_id": row.get("record_id"),
                "investor_flow": (flow_by_day.get(str(row["trade_date"])) or
                                  market_flow_by_day.get(str(row["trade_date"]), {})),
                "investor_flow_scope": ("stock" if flow_by_day.get(str(row["trade_date"]))
                                        else "kospi_market_fallback" if market_flow_by_day.get(str(row["trade_date"]))
                                        else "missing"),
                "events": news_by_day.get(str(row["trade_date"]), [])[:10],
            })
        if not market_days:
            raise TradingError("정제 후 사용할 수 있는 거래일 데이터가 없습니다.")
        result = {"ticker": ticker, "name": security["name"],
                  "english_name": security.get("english_name"), "market": "KOSPI",
                "previous_close": int(previous["close"]),
                "start_date": str(start), "end_date": str(end), "market_days": market_days,
                "quality": {"trading_days": len(market_days), "warnings": warnings,
                            "duplicate_news_removed": duplicate_news,
                            "missing_flow_days": sum(not day["investor_flow"] for day in market_days),
                            "market_flow_fallback_days": sum(day["investor_flow_scope"] == "kospi_market_fallback" for day in market_days)}}
        result["foreign_holdings"] = [
            {"trade_date": str(row["trade_date"]), "held_shares": int(row["held_shares"]) if row.get("held_shares") is not None else None,
             "held_pct": float(row["held_pct"]) if row.get("held_pct") is not None else None,
             "quality_status": "verified"}
            for row in holdings
        ]
        result["indices"] = [
            {"trade_date": str(row["trade_date"]), "index_id": f"krx:{row['idx_name']}",
             "idx_class": row.get("idx_class"), "name": row.get("idx_name"),
             "close": float(row["close"]) if row.get("close") is not None else None,
             "change_pct": float(row["change_pct"]) if row.get("change_pct") is not None else None,
             "volume": int(row["volume"]) if row.get("volume") is not None else None,
             "trading_value": int(row["trading_value"]) if row.get("trading_value") is not None else None,
             "market_cap": int(row["market_cap"]) if row.get("market_cap") is not None else None,
             "source": row.get("source"), "quality_status": "verified"}
            for row in indices
        ]
        result["sector"] = (sector_rows[0]["sector"] if sector_rows else None)
        result["macro_observations"] = [
            {"series_code": row.get("series_code"),
             "series_name": row.get("series_name"), "cycle": row.get("cycle"),
             "trade_date": str(row["period_start"]),
             "value": float(row["value"]) if row.get("value") is not None else None,
             "unit": row.get("unit"), "source": row.get("source"),
             "source_record_id": row.get("record_id"), "quality_status": "verified"}
            for row in macro_observations
        ]
        result["social_signals"] = [
            {"trade_date": str(row["sentiment_date"]), "platform": "youtube_aggregate",
             "post_count": int(row["comment_count"] or 0),
             "sentiment": float(row["sentiment_score"]) if row.get("sentiment_score") is not None else None,
             "engagement": int(row["engagement_count"] or 0), "quality_status": "provisional"}
            for row in social_signals
        ]
        result["community_comments"] = [
            {
                "published_at": str(row.get("published_at") or ""),
                "trade_date": str(row.get("published_at") or "")[:10],
                "text": plain_text(row.get("text"), 500),
                "like_count": int(row.get("like_count") or 0),
                "reply_count": int(row.get("reply_count") or 0),
                "video_like_rank": int(row["video_like_rank"]) if row.get("video_like_rank") is not None else None,
                "video_id": row.get("video_id"),
                "video_title": plain_text(row.get("video_title"), 180),
                "source_url": row.get("source_url"),
                "search_tags": row.get("search_tags") or [],
                "quality_status": "target_tagged_top_liked",
            }
            for row in community_comments
            if plain_text(row.get("text"), 500)
        ]
        result["ontology_snapshot"] = build_market_snapshot(result)
        result["ontology_coverage"] = build_coverage_report(result["ontology_snapshot"])
        result["ontology_preflight"] = preflight_simulation(result["ontology_snapshot"])
        self._store_history(cache_path, result)
        return result
