"""FINVERSE DeepAgents A2A pipeline for MiroFish scenario input."""

from __future__ import annotations

import argparse
from html import unescape
import ipaddress
import json
import os
import re
import socket
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import psycopg
from ddgs import DDGS
from deepagents import CompiledSubAgent, create_deep_agent
from langchain.agents import create_agent
from langchain.chat_models import init_chat_model
from langchain.tools import tool
from langchain_core.tools import ToolException
from langchain_aws import ChatBedrockConverse
from langchain_openai import ChatOpenAI
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "output" / "mirofish"
SPECIALISTS = ("market", "economy", "events", "web_search")
EVIDENCE_FILES = {
    "market": "market-evidence.md",
    "economy": "economic-evidence.md",
    "events": "external-event-evidence.md",
    "web_search": "web-search-evidence.md",
}
FINAL_FILE = "mirofish-input.md"
MAX_ROWS = 100
DEFAULT_DB_STATEMENT_TIMEOUT_MS = 60_000
MAX_DB_STATEMENT_TIMEOUT_MS = 300_000
DEFAULT_HORIZON = "365d"
DEFAULT_BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0"
DEFAULT_BEDROCK_MAX_TOKENS = 4096
DEFAULT_BEDROCK_TIMEOUT_SECONDS = 3600
DEFAULT_MODEL = f"bedrock:{DEFAULT_BEDROCK_MODEL_ID}"
DEFAULT_REASONING_EFFORT = "medium"
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_APP_NAME = "FINVERSE"
DEFAULT_OPENROUTER_REASONING_EFFORT = "high"

REQUIRED_EVIDENCE_HEADINGS = {
    "market": ("# Market Evidence", "## Scenario-Aligned Retrieval Plan", "## Current State", "## Raw Time Series", "## Investor Flow", "## Similar Historical Cases", "## Feedback and Scope Gaps", "## Relation Candidates", "## Evidence Register", "## Limitations"),
    "economy": ("# Economic Evidence", "## Scenario-Aligned Retrieval Plan", "## Current Macro State", "## Recent Changes", "## Similar Historical Cases", "## Feedback and Scope Gaps", "## Relation Candidates", "## Evidence Register", "## Limitations"),
    "events": ("# External Event Evidence", "## Scenario-Aligned Retrieval Plan", "## Event Clusters", "## Similar Historical Cases", "## Feedback and Scope Gaps", "## Relation Candidates", "## Evidence Register", "## Limitations"),
    "web_search": ("# Web Search Evidence", "## Scenario-Aligned Retrieval Plan", "## Verified External Facts", "## Similar Historical Cases", "## Feedback and Scope Gaps", "## Relation Candidates", "## Evidence Register", "## Limitations"),
}


def _load_dotenv() -> None:
    """Load .env without replacing environment values."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _date(value: str, field: str) -> date | None:
    if not value.strip():
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} must be YYYY-MM-DD") from exc


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


class DatabaseQueryTimeoutError(RuntimeError):
    """Raised when PostgreSQL cancels a bounded read after the app timeout."""


def _statement_timeout_ms() -> int:
    raw = os.environ.get(
        "FINVERSE_DB_STATEMENT_TIMEOUT_MS",
        str(DEFAULT_DB_STATEMENT_TIMEOUT_MS),
    )
    try:
        timeout_ms = int(raw)
    except ValueError as exc:
        raise ValueError("FINVERSE_DB_STATEMENT_TIMEOUT_MS must be an integer") from exc
    if not 1_000 <= timeout_ms <= MAX_DB_STATEMENT_TIMEOUT_MS:
        raise ValueError(
            "FINVERSE_DB_STATEMENT_TIMEOUT_MS must be between 1000 and "
            f"{MAX_DB_STATEMENT_TIMEOUT_MS}"
        )
    return timeout_ms


def _environment_int(name: str, default: int, *, minimum: int = 1) -> int:
    """Read a positive integer model setting without silently accepting bad config."""
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _environment_float(name: str, default: float) -> float:
    """Read a model temperature in the Bedrock-supported 0-1 range."""
    try:
        value = float(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc
    if not 0 <= value <= 1:
        raise ValueError(f"{name} must be between 0 and 1")
    return value


def _create_chat_model(model_id: str):
    """Create a Bedrock, OpenRouter, or OpenAI chat model from its provider prefix."""
    if model_id.startswith("bedrock:"):
        bedrock_model_id = model_id.split(":", 1)[1] or os.environ.get(
            "BEDROCK_MODEL_ID", DEFAULT_BEDROCK_MODEL_ID
        )
        region_name = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
        if not region_name:
            raise RuntimeError("AWS_REGION or AWS_DEFAULT_REGION is required for Bedrock")
        kwargs: dict[str, Any] = {
            "model": bedrock_model_id,
            "region_name": region_name,
            "max_tokens": _environment_int(
                "FINVERSE_BEDROCK_MAX_TOKENS", DEFAULT_BEDROCK_MAX_TOKENS
            ),
            "temperature": _environment_float("FINVERSE_BEDROCK_TEMPERATURE", 0.0),
            "timeout": _environment_int(
                "FINVERSE_BEDROCK_TIMEOUT_SECONDS", DEFAULT_BEDROCK_TIMEOUT_SECONDS
            ),
            "max_retries": _environment_int("FINVERSE_BEDROCK_MAX_RETRIES", 3),
        }
        if profile_name := os.environ.get("AWS_PROFILE"):
            kwargs["credentials_profile_name"] = profile_name
        return ChatBedrockConverse(**kwargs)
    if model_id.startswith("openrouter:"):
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required for OpenRouter")

        headers = {"X-Title": os.environ.get("OPENROUTER_APP_NAME", DEFAULT_OPENROUTER_APP_NAME)}
        if referer := os.environ.get("OPENROUTER_HTTP_REFERER"):
            headers["HTTP-Referer"] = referer

        return ChatOpenAI(
            model=model_id.split(":", 1)[1],
            api_key=api_key,
            base_url=os.environ.get("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE_URL),
            max_tokens=_environment_int("FINVERSE_OPENROUTER_MAX_TOKENS", 8192),
            max_retries=_environment_int("FINVERSE_OPENROUTER_MAX_RETRIES", 3),
            timeout=_environment_int("FINVERSE_OPENROUTER_TIMEOUT_SECONDS", 3600),
            reasoning_effort=os.environ.get(
                "FINVERSE_OPENROUTER_REASONING_EFFORT",
                DEFAULT_OPENROUTER_REASONING_EFFORT,
            ),
            default_headers=headers,
            use_responses_api=False,
        )
    if model_id.startswith("openai:"):
        reasoning_effort = os.environ.get(
            "FINVERSE_AGENT_REASONING_EFFORT",
            DEFAULT_REASONING_EFFORT,
        )
        return ChatOpenAI(
            model=model_id.split(":", 1)[1],
            use_responses_api=True,
            reasoning_effort=reasoning_effort,
        )
    return init_chat_model(model_id)


def _read_query(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    """Run an approved parameterized SELECT in a read-only short transaction."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    timeout_ms = _statement_timeout_ms()
    try:
        with psycopg.connect(
            database_url,
            row_factory=dict_row,
            options=(
                "-c default_transaction_read_only=on "
                f"-c statement_timeout={timeout_ms}"
            ),
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                return cursor.fetchall()
    except psycopg.Error as exc:
        if exc.sqlstate == "57014":
            raise DatabaseQueryTimeoutError(
                f"database query exceeded {timeout_ms / 1000:g}s"
            ) from exc
        raise RuntimeError(f"database query failed: {str(exc).splitlines()[0]}") from exc


def _read_query_payload(
    context: dict[str, Any],
    sql: str,
    params: tuple[Any, ...],
) -> str:
    """Return a tool-friendly timeout payload so one slow read does not abort A2A."""
    try:
        rows = _read_query(sql, params)
    except DatabaseQueryTimeoutError as exc:
        return _json({
            **context,
            "rows": [],
            "error": str(exc),
            "retryable": True,
            "retry_hint": (
                "Retry once with a shorter start_date/end_date range and a specific "
                "ticker, index name, or keyword. If it still times out, record the gap "
                "in Limitations instead of retrying again."
            ),
        })
    return _json({**context, "rows": rows})


MARKET_SQL = {
    "price_daily": """
        SELECT (r.payload->>'bas_dd')::date AS trade_date,
               r.payload->>'ticker' AS ticker, r.payload->>'name' AS name,
               r.payload->>'market' AS market, r.payload->>'source' AS source,
               r.payload->>'price_basis' AS price_basis,
               (r.payload->>'open')::numeric AS open,
               (r.payload->>'high')::numeric AS high,
               (r.payload->>'low')::numeric AS low,
               (r.payload->>'close')::numeric AS close,
               (r.payload->>'change_pct')::numeric AS change_pct,
               (r.payload->>'volume')::bigint AS volume,
               (r.payload->>'trading_value')::bigint AS trading_value,
               (r.payload->>'market_cap')::bigint AS market_cap,
               r.record_id
        FROM lake.records AS r
        WHERE r.record_type = 'market_price_daily'
          AND r.payload ? 'bas_dd'
          AND (%s::text IS NULL OR r.payload->>'bas_dd' >= %s::text)
          AND (%s::text IS NULL OR r.payload->>'bas_dd' <= %s::text)
          AND (cardinality(%s::text[]) = 0 OR r.payload->>'ticker' = ANY(%s::text[]))
          AND (%s::date IS NULL OR r.collected_at < %s::date + INTERVAL '1 day')
        ORDER BY r.payload->>'bas_dd' DESC
        LIMIT %s
    """,
    "index_daily": """
        SELECT (r.payload->>'bas_dd')::date AS trade_date,
               r.payload->>'idx_class' AS idx_class, r.payload->>'idx_name' AS idx_name,
               r.payload->>'source' AS source,
               (r.payload->>'open')::numeric AS open,
               (r.payload->>'high')::numeric AS high,
               (r.payload->>'low')::numeric AS low,
               (r.payload->>'close')::numeric AS close,
               (r.payload->>'change_pct')::numeric AS change_pct,
               (r.payload->>'volume')::bigint AS volume,
               (r.payload->>'trading_value')::bigint AS trading_value,
               (r.payload->>'market_cap')::bigint AS market_cap,
               r.record_id
        FROM lake.records AS r
        WHERE r.record_type = 'market_index_daily'
          AND r.payload ? 'bas_dd'
          AND (%s::text IS NULL OR r.payload->>'bas_dd' >= %s::text)
          AND (%s::text IS NULL OR r.payload->>'bas_dd' <= %s::text)
          AND (%s = '' OR r.payload->>'idx_name' ILIKE '%%' || %s || '%%')
          AND (%s::date IS NULL OR r.collected_at < %s::date + INTERVAL '1 day')
        ORDER BY r.payload->>'bas_dd' DESC
        LIMIT %s
    """,
    "investor_flow_daily": """
        SELECT (r.payload->>'bas_dd')::date AS trade_date,
               r.payload->>'target_type' AS target_type, r.payload->>'target' AS target,
               r.payload->>'investor' AS investor,
               (r.payload->>'net_value_krw')::bigint AS net_value_krw,
               (r.payload->>'net_volume')::bigint AS net_volume,
               r.payload->>'source' AS source, r.record_id
        FROM lake.records AS r
        WHERE r.record_type = 'market_investor_flow_daily'
          AND r.payload ? 'bas_dd'
          AND (%s::text IS NULL OR r.payload->>'bas_dd' >= %s::text)
          AND (%s::text IS NULL OR r.payload->>'bas_dd' <= %s::text)
          AND (%s = '' OR r.payload->>'target' ILIKE '%%' || %s || '%%')
          AND (%s::date IS NULL OR r.collected_at < %s::date + INTERVAL '1 day')
        ORDER BY r.payload->>'bas_dd' DESC
        LIMIT %s
    """,
    "foreign_holding_daily": """
        SELECT (r.payload->>'bas_dd')::date AS trade_date,
               r.payload->>'ticker' AS ticker,
               (r.payload->>'held_shares')::bigint AS held_shares,
               (r.payload->>'held_pct')::numeric AS held_pct,
               r.payload->>'source' AS source, r.record_id
        FROM lake.records AS r
        WHERE r.record_type = 'market_foreign_holding_daily'
          AND r.payload ? 'bas_dd'
          AND (%s::text IS NULL OR r.payload->>'bas_dd' >= %s::text)
          AND (%s::text IS NULL OR r.payload->>'bas_dd' <= %s::text)
          AND (cardinality(%s::text[]) = 0 OR r.payload->>'ticker' = ANY(%s::text[]))
          AND (%s::date IS NULL OR r.collected_at < %s::date + INTERVAL '1 day')
        ORDER BY r.payload->>'bas_dd' DESC
        LIMIT %s
    """,
    "security": """
        SELECT r.payload->>'isin' AS isin, r.payload->>'ticker' AS ticker,
               r.payload->>'name' AS name, r.payload->>'short_name' AS short_name,
               r.payload->>'english_name' AS english_name, r.payload->>'market' AS market,
               r.payload->>'share_type' AS share_type,
               nullif(r.payload->>'listed_on', '')::date AS listed_on,
               (r.payload->>'listed_shares')::bigint AS listed_shares,
               r.payload->>'source' AS source, r.record_id
        FROM lake.records AS r
        WHERE r.record_type = 'market_security'
          AND (%s = '' OR r.payload->>'name' ILIKE '%%' || %s || '%%'
             OR r.payload->>'short_name' ILIKE '%%' || %s || '%%'
             OR r.payload->>'ticker' = %s)
          AND (%s::date IS NULL OR nullif(r.payload->>'listed_on', '') IS NULL
               OR nullif(r.payload->>'listed_on', '')::date <= %s::date)
          AND (%s::date IS NULL OR r.collected_at < %s::date + INTERVAL '1 day')
        LIMIT %s
    """,
}


@tool
def query_market(
    dataset: Literal["price_daily", "index_daily", "investor_flow_daily", "foreign_holding_daily", "security"],
    start_date: str = "",
    end_date: str = "",
    tickers: list[str] | None = None,
    name_filter: str = "",
    limit: int = 50,
) -> str:
    """Read bounded historical market data. SQL text is never accepted."""
    start, end = _date(start_date, "start_date"), _date(end_date, "end_date")
    if start and end and start > end:
        raise ValueError("start_date must not be after end_date")
    safe_limit = max(1, min(limit, MAX_ROWS))
    symbols = [ticker.strip() for ticker in (tickers or []) if ticker.strip()]
    start_key = start.strftime("%Y%m%d") if start else None
    end_key = end.strftime("%Y%m%d") if end else None
    if dataset in {"price_daily", "foreign_holding_daily"}:
        params: tuple[Any, ...] = (
            start_key, start_key, end_key, end_key, symbols, symbols, end, end, safe_limit,
        )
    elif dataset == "security":
        params = (name_filter, name_filter, name_filter, name_filter, end, end, end, end, safe_limit)
    else:
        params = (
            start_key, start_key, end_key, end_key, name_filter, name_filter, end, end, safe_limit,
        )
    return _read_query_payload({"dataset": dataset}, MARKET_SQL[dataset], params)


@tool
def query_economy(keyword: str = "", start_date: str = "", end_date: str = "", limit: int = 50) -> str:
    """Read historical macroeconomic observations. SQL text is never accepted."""
    start, end = _date(start_date, "start_date"), _date(end_date, "end_date")
    if start and end and start > end:
        raise ValueError("start_date must not be after end_date")
    sql = """
        SELECT r.payload->>'source' AS source, r.payload->>'series_name' AS series_name,
               r.payload->>'external_series_id' AS series_id,
               r.payload->>'stat_code' AS stat_code, r.payload->>'cycle' AS cycle,
               r.payload->>'period' AS period,
               nullif(r.payload->>'period_start', '')::date AS period_start,
               (r.payload->>'value')::numeric AS value, r.payload->>'unit' AS unit,
               r.collected_at, r.record_id
        FROM lake.records AS r
        WHERE r.record_type = 'economic_observation'
          AND (%s = '' OR r.payload->>'series_name' ILIKE '%%' || %s || '%%'
             OR r.payload->>'external_series_id' ILIKE '%%' || %s || '%%'
             OR r.payload->>'stat_code' ILIKE '%%' || %s || '%%')
          AND (%s::text IS NULL OR r.payload->>'period_start' >= %s::text)
          AND (%s::text IS NULL OR r.payload->>'period_start' <= %s::text)
          AND (%s::date IS NULL OR r.collected_at < %s::date + INTERVAL '1 day')
        ORDER BY r.payload->>'period_start' DESC
        LIMIT %s
    """
    start_key = start.isoformat() if start else None
    end_key = end.isoformat() if end else None
    return _read_query_payload(
        {"keyword": keyword},
        sql,
        (keyword, keyword, keyword, keyword, start_key, start_key, end_key, end_key, end, end,
         max(1, min(limit, MAX_ROWS))),
    )


@tool
def query_events(
    keyword: str = "", start_date: str = "", end_date: str = "", ticker: str = "", limit: int = 50
) -> str:
    """Read historical Finverse news/event rows. SQL text is never accepted."""
    start, end = _date(start_date, "start_date"), _date(end_date, "end_date")
    if start and end and start > end:
        raise ValueError("start_date must not be after end_date")
    sql = """
        SELECT (r.payload->>'published_at')::timestamptz AS published_at,
               r.payload->>'title' AS title, r.payload->>'summary' AS summary,
               r.payload->>'url' AS url, r.payload->>'source' AS feed,
               r.payload->>'origin_publisher' AS publisher,
               ARRAY(SELECT jsonb_array_elements_text(r.payload->'country_codes')) AS country_codes,
               ARRAY(SELECT jsonb_array_elements_text(r.payload->'event_types')) AS event_types,
               ARRAY(SELECT jsonb_array_elements_text(coalesce(r.payload->'tickers', '[]'::jsonb))) AS tickers,
               (r.payload->>'selection_score')::numeric AS selection_score,
               r.collected_at, r.record_id
        FROM lake.records AS r
        WHERE r.record_type = 'news_article'
          AND (%s::text IS NULL OR r.payload->>'published_at' >= %s::text)
          AND (%s::text IS NULL OR r.payload->>'published_at' < %s::text)
          AND (%s = '' OR r.payload->>'title' ILIKE '%%' || %s || '%%'
               OR r.payload->>'summary' ILIKE '%%' || %s || '%%')
          AND (%s = '' OR coalesce(r.payload->'tickers', '[]'::jsonb) ? %s)
          AND (%s::date IS NULL OR r.collected_at < %s::date + INTERVAL '1 day')
        ORDER BY r.payload->>'published_at' DESC
        LIMIT %s
    """
    start_key = start.isoformat() if start else None
    end_exclusive = (end + timedelta(days=1)).isoformat() if end else None
    return _read_query_payload(
        {"keyword": keyword, "ticker": ticker},
        sql,
        (start_key, start_key, end_exclusive, end_exclusive,
         keyword, keyword, keyword, ticker, ticker, end, end,
         max(1, min(limit, MAX_ROWS))),
    )


@tool
def duckduckgo_search(query: str, limit: int = 8) -> str:
    """Search the DuckDuckGo backend. Fetch a result page before citing it."""
    if not query.strip():
        raise ValueError("query is required")
    safe_limit = max(1, min(limit, 10))
    raw_results: list[dict[str, str]] = []
    errors: list[str] = []
    selected_region = ""
    for region in ("kr-kr", "wt-wt", "us-en"):
        try:
            raw_results = DDGS(timeout=15).text(
                query=query,
                region=region,
                safesearch="off",
                max_results=safe_limit,
                backend="duckduckgo",
            )
        except Exception as exc:  # The client normalizes backend/network failures inconsistently.
            errors.append(f"{region}: {exc}")
            continue
        if raw_results:
            selected_region = region
            break
    results = [
        {"title": item.get("title", ""), "url": item.get("href", ""), "snippet": item.get("body", "")}
        for item in raw_results
        if item.get("href")
    ]
    response: dict[str, Any] = {"query": query, "region": selected_region, "results": results}
    if not results:
        response["error"] = "DuckDuckGo search failed: " + "; ".join(errors or ["no results"])
    return _json(response)


def _validate_public_url(url: str) -> None:
    """Reject local, private, link-local, multicast, and reserved fetch targets."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("url must be an absolute HTTP(S) URL")
    if parsed.hostname.lower() == "localhost" or parsed.hostname.lower().endswith(".local"):
        raise ValueError("local URLs are not allowed")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except socket.gaierror as exc:
        raise ValueError("url hostname could not be resolved") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("url must resolve only to public IP addresses")


@tool
def fetch_web_page(url: str) -> str:
    """Fetch one HTTP(S) page to verify its content and publication-date candidates."""
    try:
        _validate_public_url(url)
    except ValueError as exc:
        return _json({
            "url": url,
            "error": f"page request skipped: {exc}",
            "retryable": False,
        })
    try:
        extracted = DDGS(timeout=15).extract(url, fmt="text_plain")
    except Exception as exc:  # Keep source failures as evidence gaps rather than aborting the run.
        try:
            text = _fetch_public_page_text(url)
        except Exception as fallback_exc:
            return _json({"url": url, "error": f"page request failed: {exc}; fallback failed: {fallback_exc}"})
        return _json({
            "url": url,
            "date_candidates": _publication_date_candidates(text),
            "text": text,
            "transport": "urllib_fallback",
        })
    text = str(extracted.get("content", ""))[:10_000]
    return _json({
        "url": url,
        "date_candidates": _publication_date_candidates(text),
        "text": text,
    })


def _fetch_public_page_text(url: str) -> str:
    """Small verified-source fallback when DDGS extraction cannot negotiate TLS."""
    request = Request(url, headers={"User-Agent": "FINVERSE evidence verifier/1.0"})
    with urlopen(request, timeout=15) as response:  # noqa: S310 - URL passed _validate_public_url above.
        raw = response.read(1_000_000).decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    without_script = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.IGNORECASE | re.DOTALL)
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", without_script)).split())[:10_000]


def _publication_date_candidates(text: str) -> list[str]:
    """Return normalized ISO dates found in numeric or common English article formats."""
    candidates = re.findall(r"\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b", text)
    month_names = (
        "January|February|March|April|May|June|July|August|September|October|November|December|"
        "Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?"
    )
    for raw in re.findall(rf"\b(?:{month_names})\s+\d{{1,2}},\s+20\d{{2}}\b", text, flags=re.IGNORECASE):
        cleaned = raw.replace(".", "")
        for pattern in ("%B %d, %Y", "%b %d, %Y"):
            try:
                candidates.append(datetime.strptime(cleaned, pattern).date().isoformat())
                break
            except ValueError:
                continue
    normalized: list[str] = []
    for candidate in candidates:
        parsed = _normalized_evidence_date(candidate)
        value = parsed.isoformat() if parsed else candidate
        if value not in normalized:
            normalized.append(value)
    return normalized[:10]


class EvidenceDateValidationError(ValueError):
    """Raised when an evidence date cannot be normalized without fabrication."""


def _normalized_evidence_date(value: str) -> date | None:
    """Parse common tool and model date renderings into an exact date."""
    text = value.strip().strip("`'")
    separated = re.search(
        r"(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)",
        text,
    )
    compact = re.search(r"(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)", text)
    match = separated or compact
    if not match:
        return None
    try:
        return date(*(int(part) for part in match.groups()))
    except ValueError:
        return None


def _markdown_evidence_cells(raw_line: str) -> list[str] | None:
    """Parse a five-column evidence row, tolerating outer pipes and pipes in claims."""
    line = raw_line.strip()
    if "|" not in line:
        return None
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    cells = [cell.strip().replace(r"\|", "|") for cell in re.split(r"(?<!\\)\|", line)]
    if len(cells) < 5:
        return None
    if len(cells) > 5:
        cells = [cells[0], " | ".join(cells[1:-3]), *cells[-3:]]
    return cells


def _is_evidence_table_metadata(cells: list[str]) -> bool:
    first = cells[0].strip().lower()
    observed_header = cells[2].strip().lower()
    return (
        first in {"evidence_id", "evidence id", "id", "증거_id", "증거 id"}
        or observed_header in {"observed_at", "observed at", "date", "관측일", "기준일"}
        or set(first) <= {"-", ":"}
    )


def _normalize_evidence_register_dates(markdown: str, as_of_date: date) -> str:
    """Canonicalize Evidence Register dates and reject only unrecoverable rows."""
    lines = markdown.splitlines()
    in_register = False
    for index, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        if stripped == "## Evidence Register":
            in_register = True
            continue
        if in_register and stripped.startswith("## "):
            break
        if not in_register:
            continue
        cells = _markdown_evidence_cells(stripped)
        if cells is None or _is_evidence_table_metadata(cells):
            continue
        evidence_id, claim, observed_at, source, locator = cells
        observed_date = _normalized_evidence_date(observed_at)
        if observed_date is None:
            observed_date = _normalized_evidence_date(claim)
        if observed_date is None:
            raise EvidenceDateValidationError(
                f"{evidence_id}: observed_at must contain an exact YYYY-MM-DD date "
                "from the tool result; do not use N/A, a month, quarter, or relative date"
            )
        if observed_date > as_of_date:
            raise EvidenceDateValidationError(
                f"{evidence_id}: observed_at {observed_date.isoformat()} is after "
                f"as_of {as_of_date.isoformat()}"
            )
        lines[index] = (
            f"| {evidence_id} | {claim} | {observed_date.isoformat()} | {source} | {locator} |"
        )
    return "\n".join(lines)


def _save_evidence_tool(output_dir: Path, agent_name: str, as_of_date: date):
    @tool(f"save_{agent_name}_evidence")
    def save_evidence(markdown: str) -> str:
        """Validate and save this domain's Evidence Markdown; one revision is allowed."""
        missing = [heading for heading in REQUIRED_EVIDENCE_HEADINGS[agent_name] if heading not in markdown]
        if missing:
            raise ToolException(f"missing Evidence Markdown headings: {', '.join(missing)}")
        try:
            markdown = _normalize_evidence_register_dates(markdown, as_of_date)
        except EvidenceDateValidationError as exc:
            raise ToolException(str(exc)) from exc
        rows = _evidence_rows(markdown)
        data_gap = not rows
        if data_gap:
            marker = (
                f"- Data gap: {agent_name} produced no verified Evidence Register rows; "
                "no unsupported evidence was synthesized.\n"
            )
            markdown = markdown.replace("## Limitations", "## Limitations\n" + marker, 1)
        seen_ids: set[str] = set()
        for evidence_id, _claim, observed_at, _source, locator in rows:
            if evidence_id in seen_ids:
                raise ToolException(f"duplicate evidence_id in document: {evidence_id}")
            seen_ids.add(evidence_id)
            observed_date = _normalized_evidence_date(observed_at)
            if observed_date is None or observed_date > as_of_date:
                raise ToolException("every evidence row needs an observed_at on or before as_of_date")
            if not locator:
                raise ToolException("every evidence row needs a record_id_or_url")
        path = output_dir / EVIDENCE_FILES[agent_name]
        path.parent.mkdir(parents=True, exist_ok=True)
        revision_file = output_dir / ".revision-counts.json"
        revisions = json.loads(revision_file.read_text(encoding="utf-8")) if revision_file.exists() else {}
        if path.exists():
            revision_count = int(revisions.get(agent_name, 0))
            if revision_count >= 1:
                raise ToolException(f"{agent_name} evidence already used its single allowed revision")
            history = output_dir / ".history" / f"{agent_name}-initial.md"
            history.parent.mkdir(parents=True, exist_ok=True)
            history.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
            revisions[agent_name] = revision_count + 1
            revision_file.write_text(json.dumps(revisions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        path.write_text(markdown.strip() + "\n", encoding="utf-8")
        return (
            f"saved {path.name}; revision={int(revisions.get(agent_name, 0))}; "
            f"evidence_rows={len(rows)}; data_gap={str(data_gap).lower()}"
        )
    save_evidence.handle_tool_error = True
    return save_evidence


def _evidence_rows(markdown: str) -> list[tuple[str, str, str, str, str]]:
    """Parse the canonical five-column Evidence Register table."""
    section = markdown.split("## Evidence Register", 1)
    if len(section) != 2:
        return []
    rows: list[tuple[str, str, str, str, str]] = []
    for raw_line in section[1].splitlines():
        line = raw_line.strip()
        if line.startswith("## "):
            break
        cells = _markdown_evidence_cells(line)
        if cells is None or _is_evidence_table_metadata(cells):
            continue
        rows.append(tuple(cells))
    return rows


def _bounded_database_tools(agent_name: str, as_of_date: date):
    """Provide specialist tools that cannot read records after the requested cutoff."""
    cutoff = as_of_date.isoformat()
    if agent_name == "market":
        @tool("query_market")
        def bounded_market(
            dataset: Literal["price_daily", "index_daily", "investor_flow_daily", "foreign_holding_daily", "security"],
            start_date: str = "", end_date: str = "", tickers: list[str] | None = None,
            name_filter: str = "", limit: int = 50,
        ) -> str:
            """Read market data on or before the scenario information cutoff."""
            requested_end = _date(end_date, "end_date")
            if requested_end and requested_end > as_of_date:
                raise ValueError("end_date must not be after the scenario as_of_date")
            return query_market.invoke({"dataset": dataset, "start_date": start_date, "end_date": end_date or cutoff,
                                        "tickers": tickers, "name_filter": name_filter, "limit": limit})
        return [bounded_market]
    if agent_name == "economy":
        @tool("query_economy")
        def bounded_economy(keyword: str = "", start_date: str = "", end_date: str = "", limit: int = 50) -> str:
            """Read economic data on or before the scenario information cutoff."""
            requested_end = _date(end_date, "end_date")
            if requested_end and requested_end > as_of_date:
                raise ValueError("end_date must not be after the scenario as_of_date")
            return query_economy.invoke({"keyword": keyword, "start_date": start_date, "end_date": end_date or cutoff, "limit": limit})
        return [bounded_economy]
    if agent_name == "events":
        @tool("query_events")
        def bounded_events(keyword: str = "", start_date: str = "", end_date: str = "", ticker: str = "", limit: int = 50) -> str:
            """Read event/news data on or before the scenario information cutoff."""
            requested_end = _date(end_date, "end_date")
            if requested_end and requested_end > as_of_date:
                raise ValueError("end_date must not be after the scenario as_of_date")
            return query_events.invoke({"keyword": keyword, "start_date": start_date, "end_date": end_date or cutoff,
                                        "ticker": ticker, "limit": limit})
        return [bounded_events]
    return [duckduckgo_search, fetch_web_page]


def _read_evidence_tool(output_dir: Path):
    @tool("read_specialist_evidence")
    def read_specialist_evidence() -> str:
        """Read all Evidence Markdown and report duplicate record IDs or URLs."""
        documents: dict[str, str] = {}
        data_gaps: dict[str, bool] = {}
        owners: dict[str, list[str]] = {}
        for name, filename in EVIDENCE_FILES.items():
            path = output_dir / filename
            if not path.exists():
                documents[name] = "MISSING"
                data_gaps[name] = True
                continue
            markdown = path.read_text(encoding="utf-8")
            documents[name] = markdown
            rows = _evidence_rows(markdown)
            data_gaps[name] = not rows
            for _evidence_id, _claim, _observed_at, _source, locator in rows:
                owners.setdefault(locator, []).append(name)
        duplicates = {key: domains for key, domains in owners.items() if len(set(domains)) > 1}
        return _json({
            "documents": documents,
            "data_gaps": data_gaps,
            "cross_domain_duplicates": duplicates,
        })
    return read_specialist_evidence


def _save_final_tool(output_dir: Path):
    @tool("save_mirofish_markdown")
    def save_mirofish_markdown(markdown: str) -> str:
        """Save final MiroFish Markdown. This tool is available only to the orchestrator."""
        required = (
            "# ", "## 분석 기준", "## 현재 시장 상황 온톨로지", "## 엔터티 목록",
            "## 영향 관계", "## 유사 과거 국면과 Attention 근거", "## 가정된 미래 시나리오", "### 상승 경로", "### 기준 경로",
            "### 하락 경로", "## 불확실성", "## 부족한 데이터", "## Evidence Register",
        )
        missing = [heading for heading in required[1:] if heading not in markdown]
        if not markdown.lstrip().startswith("# "):
            missing.insert(0, "# <시나리오 제목>")
        if missing:
            raise ValueError(f"missing MiroFish Markdown headings: {', '.join(missing)}")
        locators: set[str] = set()
        in_register = False
        for raw_line in markdown.splitlines():
            if raw_line.strip() == "## Evidence Register":
                in_register = True
                continue
            if in_register and raw_line.startswith("## "):
                break
            if not in_register or not raw_line.strip().startswith("|"):
                continue
            cells = [cell.strip() for cell in raw_line.strip().strip("|").split("|")]
            if len(cells) != 6 or cells[0].lower() in {"id", "evidence_id"} or set(cells[0]) <= {"-", ":"}:
                continue
            locator = cells[-1]
            if locator in locators:
                raise ValueError(f"duplicate record_id_or_url in final Evidence Register: {locator}")
            locators.add(locator)
        if not locators:
            raise ValueError("final Evidence Register must contain at least one evidence row")
        path = output_dir / FINAL_FILE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(markdown.strip() + "\n", encoding="utf-8")
        return f"saved {path}"
    return save_mirofish_markdown


HISTORICAL_ATTENTION_PROTOCOL = """
과거 유사 사례 Attention 프로토콜:
1. 전달받은 scenario_signature와 attention_dimensions를 현재 시나리오의 검색 기준으로 사용한다.
2. 후보 사례는 최소 5개를 넓게 탐색하되, 사례 선택 시점에는 해당 과거 기준일(anchor_date)까지 관측된 정보만 사용한다.
   이후 결과를 먼저 보고 닮은 사례를 고르는 look-ahead selection을 금지한다.
3. 각 후보의 similarity_score를 0~100으로 계산하고 차원별 점수 근거를 남긴다. 기본 가중치는 다음과 같으며,
   Moderator가 다른 가중치를 주면 그 값을 우선한다.
   - 대상·노출 구조 일치 25
   - 충격 유형·전달 메커니즘 일치 25
   - 당시 시장·거시 regime 일치 20
   - 방향·강도·전개 경로 일치 15
   - horizon 및 데이터 완결성 10
   - 출처 품질 5
4. 점수 상위 3개를 Top-K 유사 사례로 선택한다. 점수만 제시하지 말고 matched_features와 mismatches를 함께 설명한다.
5. Top-K 선정이 끝난 뒤에만 각 사례의 anchor_date 이후 horizon 구간을 조회한다. 전체 사후 구간의 종료일은 as_of 이하여야 한다.
6. Top-K와 다른 결과를 보인 반례 또는 낮은 유사도 사례를 최소 1개 포함해 선택 편향을 점검한다.
7. 유사 사례는 예측값이 아니다. 현재 시나리오에서 재현될 조건, 깨지는 조건, 구조적 차이를 명시한다.
8. 충분히 유사한 사례가 없으면 억지로 선정하지 말고 data gap으로 기록한다.
9. Evidence Register의 observed_at은 도구 결과에서 확인한 정확한 날짜를 YYYY-MM-DD로 복사한다.
   N/A, 연월만 있는 값, 분기, '최근' 같은 상대 날짜를 observed_at에 쓰지 않는다.
10. timeout, 빈 조회, 원문 검증 실패로 채택 가능한 증거가 하나도 없으면 사실을 만들지 않는다.
    Evidence Register 본문을 빈 상태로 두고 Limitations에 조회 조건과 실패 원인을 data gap으로 기록한다.

Similar Historical Cases 내부 표 형식:
| rank | historical_case | anchor_date | similarity_score | matched_features | mismatches | forward_window | observed_follow_up | evidence_ids |
|---|---|---|---:|---|---|---|---|---|
"""


DATABASE_TIMEOUT_PROTOCOL = """

DB 조회 복구 규칙:
- 도구 결과에 retryable=true와 timeout error가 있으면 같은 범위로 반복 호출하지 않는다.
- 날짜 범위를 줄이고 ticker, index name 또는 keyword를 구체화해 최대 1회만 재조회한다.
- 재조회도 실패하면 해당 사실을 만들지 말고 Limitations와 data gap에 기록한 뒤 작업을 계속한다.
"""


KOREAN_OUTPUT_PROTOCOL = """

출력 언어 규칙:
- 저장하는 Evidence Markdown에서 시스템 계약상 요구되는 영문 섹션 헤딩을 제외한 모든 제목, 본문, 표의 주장·설명·요약은 자연스러운 한국어로 쓴다.
- 도구 결과가 영어여도 영어 제목·snippet·문장을 그대로 복사하거나 길게 인용하지 않는다. 사실 의미를 바꾸지 않는 한국어 번역·요약으로만 기록한다.
- URL, record_id, ticker, 수치 단위, 공식 고유명사·약어는 증거 식별을 위해 원문 표기를 유지할 수 있다.
"""


RETRIEVAL_FEEDBACK_PROTOCOL = """

Moderator-Subagent 조사·피드백 루프:
1. Moderator가 제공한 scenario_scheme, similarity_dimensions, historical_retrieval_plan, web_evidence_window를 1차 조회 경계로 사용한다. 임의로 최근 데이터나 넓은 과거를 기본값으로 삼지 않는다.
2. 첫 Evidence에는 ## Scenario-Aligned Retrieval Plan을 작성한다. 이 표에는 case_id, anchor_date 또는 후보 기간, scenario_scheme과의 일치 근거, 조회할 사전·사후 구간, 데이터 가용성, 제외 사유를 기록한다.
3. ## Feedback and Scope Gaps에는 Moderator에게 필요한 판단 요청만 구조화해 기록한다. 형식은 | request_type | affected_case_or_scope | evidence | requested_decision | 이다. request_type은 CASE_SELECTION, RANGE_EXPAND, RANGE_NARROW, RAW_SERIES_MISSING, DUPLICATE_OWNERSHIP 중 하나다. 요청이 없으면 '없음'을 기록한다.
4. Moderator가 FEEDBACK_REQUEST를 보내면 1회에 한해 Evidence를 보완한다. 피드백에는 type, affected_case_or_scope, reason, required_action, prohibited_action이 포함된다. 보완본의 Feedback and Scope Gaps에 적용 여부와 남은 gap을 기록한다.
5. 사례 선택과 범위 조정은 anchor_date 당시의 특징·자료·scenario_scheme만으로 한다. 사후 수익률, 사후 사건, 사후 기사 결과가 좋았다는 이유로 사례를 채택·제외·확대하는 것은 금지한다.
6. 반복할 수 없는 범위 확장, 데이터 부재, 도메인 소유권 충돌은 Limitations에도 남긴다.
"""


SPECIALIST_PROMPTS = {
    "market": """당신은 FINVERSE Market Agent다.
PostgreSQL의 market.* 데이터만 사용해 Market Evidence Markdown을 작성한다.
Moderator가 준 query, target, as_of, horizon, assigned_scope, already_covered를 작업 경계로 삼는다.

필수 작업:
- query_market으로 지수·가격·수급·외국인 보유·종목 마스터를 필요한 범위만 조회한다.
- 정량 판단에 앞서, target과 직접 비교할 핵심 시계열을 식별한다. 지수는 index_daily, 종목은 price_daily를 우선 사용하며 수급·외국인 보유는 보조 시계열로만 사용한다.
- 기본 정량 시계열은 as_of까지 최근 60거래일을 사용한다. 이를 단기=최근 20거래일, 중기=최근 60거래일로 분리하고, 사용 가능한 관측치가 부족하면 각 창의 실제 행 수와 부족 사유를 기록한다. 사용자가 더 긴 기간을 명시해도 Market Agent는 60거래일 창을 넘는 원시 시계열을 추가 조회하지 않고 Limitations에 기록한다.
- 현재 구간은 case_id=CURRENT, anchor_date=as_of로 취급한다. 과거 시계열은 Moderator의 historical_retrieval_plan에 맞춰 선정된 Top-K와 반례의 각 anchor_date를 기준으로 조회한다. CURRENT만 조회하고 과거 사례의 같은 정렬 창을 생략하지 않는다.
- 단일 도구 호출은 최대 100행이므로 60거래일 원시 행을 한 번의 좁은 요청으로 조회한다. timeout이면 DATABASE_TIMEOUT_PROTOCOL을 따르고, 누락 행을 추정하거나 보간하지 않는다.
- 원시 행을 조회한 뒤에만 단기·중기 변화, 변동성, 거래대금, 주요 섹터, 수급, 과거 유사 구간을 정리한다. 5거래일만을 독립 분석 창 또는 원시 시계열의 대체물로 사용하지 않는다.
- ## Raw Time Series에는 정량 판단에 사용한 관측치를 날짜 오름차순으로 그대로 기록한다. 표 형식은 | case_id | anchor_date | window | series_id | trade_date | field | value | unit_or_price_basis | source | record_id | 이다. CURRENT와 선택된 과거 사례마다 60거래일 원시 행을 기준 시계열로 보존하고, 단기 20일은 같은 case_id 시계열의 정확한 끝부분 범위로 참조한다. 각 series_id마다 조회 시작일·종료일·행 수·누락/비거래일·도구의 dataset을 바로 위에 적는다.
- Raw Time Series의 값은 기간 수익률·평균·변동성·최대 낙폭·누적 수급 등 요약치로 대체하지 않는다. 이 요약치는 원시 행을 보조하는 계산 결과로만 Current State 또는 Investor Flow에 쓴다.
- Current State에 단기 20일·중기 60일별 수익률, 변동성, 최대 낙폭을 구분해 제시한다. 모든 계산에는 사용한 series_id, 시작·종료 관측일, 행 수, 계산식과 분모를 함께 적는다. 예: 단순수익률=(종료 close/시작 close-1)*100. 서로 다른 price_basis·단위·빈도가 섞인 행은 계산하지 않는다.
- 이동평균은 같은 close·price_basis의 원시 행만으로 계산한다. MA20과 MA60만 제시하고, 해당 이동평균에 필요한 관측치가 부족하면 값을 만들지 말고 data gap으로 기록한다. 각 MA에는 계산 기준일과 포함 행 수를 적는다.
- 유사 구간의 사후 경로를 정량 비교할 때도, Top-K를 고른 뒤 anchor_date 전 60거래일과 확정된 사후 horizon의 원시 가격/지수 행을 동일한 방식으로 Raw Time Series에 기록한다.
- 유사 구간은 추세·변동성·거래대금·수급 방향·섹터 주도력·외국인 보유 변화의 조합을 중심으로 비교한다.
- 관측 사실과 해석을 분리하고 관계는 확정 인과가 아닌 후보 관계로 쓴다.
- KRX/Naver price_basis 차이, 단위 차이, 누락 데이터를 명시한다.
- economy/events/web_search 소유 사실과 already_covered 항목은 다시 서술하지 않는다.
- 미래 가격 예측과 투자 추천을 하지 않는다.
- 완성 문서를 반드시 save_market_evidence로 저장한다.

문서 형식:
# Market Evidence
## Analysis Context
## Scenario-Aligned Retrieval Plan
## Current State
## Raw Time Series
## Dominant Sectors
## Investor Flow
## Similar Historical Cases
## Feedback and Scope Gaps
## Relation Candidates
## Uncertainties
## Evidence Register
| evidence_id | claim | observed_at | source | record_id_or_url |
|---|---|---|---|---|
## Limitations

Evidence Register의 observed_at은 YYYY-MM-DD이며 as_of 이하여야 한다.
""" + KOREAN_OUTPUT_PROTOCOL + RETRIEVAL_FEEDBACK_PROTOCOL + DATABASE_TIMEOUT_PROTOCOL + HISTORICAL_ATTENTION_PROTOCOL,

    "economy": """당신은 FINVERSE Economy Agent다.
PostgreSQL의 economy.* 데이터만 사용해 Economic Evidence Markdown을 작성한다.
Moderator가 준 query, target, as_of, horizon, assigned_scope, already_covered를 작업 경계로 삼는다.

필수 작업:
- query_economy로 관련 series를 찾아 금리·환율·물가·고용·산업생산·GDP 등 필요한 관측치를 조회한다.
- 현재 거시 상태, 최근 1/3개월 변화, 과거 평균과의 차이를 데이터가 허용하는 범위에서 정리한다.
- 유사 국면은 금리·물가·환율·성장·고용의 수준뿐 아니라 변화 방향과 경기 순환 위치의 조합을 중심으로 비교한다.
- 관측 기간·발표 기간·단위·수정 가능성을 기록한다.
- 시장 수치와 뉴스 사실을 중복하지 않고, 상관관계를 인과로 단정하지 않는다.
- 미래 전망이나 예상값을 사실로 만들지 않는다.
- 완성 문서를 반드시 save_economy_evidence로 저장한다.

문서 형식:
# Economic Evidence
## Analysis Context
## Scenario-Aligned Retrieval Plan
## Current Macro State
## Recent Changes
## Known Upcoming Indicators
## Similar Historical Cases
## Feedback and Scope Gaps
## Relation Candidates
## Uncertainties
## Evidence Register
| evidence_id | claim | observed_at | source | record_id_or_url |
|---|---|---|---|---|
## Limitations

Evidence Register의 observed_at은 YYYY-MM-DD이며 as_of 이하여야 한다.
""" + KOREAN_OUTPUT_PROTOCOL + RETRIEVAL_FEEDBACK_PROTOCOL + DATABASE_TIMEOUT_PROTOCOL + HISTORICAL_ATTENTION_PROTOCOL,

    "events": """당신은 FINVERSE External Event Agent다.
PostgreSQL의 events.* 데이터만 사용해 External Event Evidence Markdown을 작성한다.
Moderator가 준 query, target, as_of, horizon, assigned_scope, already_covered를 작업 경계로 삼는다.

필수 작업:
- query_events로 as_of까지 공개된 뉴스·정책·실적 관련 이벤트를 조회한다.
- 동일 사건의 기사를 하나의 사건 클러스터로 묶고 대표 record_id/URL을 고른다.
- 유사 사건은 사건 유형·행위자·영향 대상·정책/지정학 맥락·충격 강도·전달 경로의 조합을 중심으로 비교한다.
- 확인된 사실, 당시 해석, 당시 시장 반응, 영향 후보, 반증 조건을 분리한다.
- Market/Economy가 소유한 수치를 복제하지 않는다.
- as_of 이후 발생 사실을 사용하지 않는다.
- 완성 문서를 반드시 save_events_evidence로 저장한다.

문서 형식:
# External Event Evidence
## Analysis Context
## Scenario-Aligned Retrieval Plan
## Event Clusters
## Known Upcoming Events
## Similar Historical Cases
## Feedback and Scope Gaps
## Relation Candidates
## Uncertainties
## Evidence Register
| evidence_id | claim | observed_at | source | record_id_or_url |
|---|---|---|---|---|
## Limitations

Evidence Register의 observed_at은 YYYY-MM-DD이며 as_of 이하여야 한다.
""" + KOREAN_OUTPUT_PROTOCOL + RETRIEVAL_FEEDBACK_PROTOCOL + DATABASE_TIMEOUT_PROTOCOL + HISTORICAL_ATTENTION_PROTOCOL,

    "web_search": """당신은 FINVERSE Web Search Agent다.
DuckDuckGo와 원문 페이지를 이용해 세 DB Agent가 채우지 못한 과거 공개정보만 보강한다.
Moderator가 준 query, target, as_of, horizon, assigned_scope, already_covered를 작업 경계로 삼는다.

필수 작업:
- 한국어 검색어를 먼저 사용하고, 한국어로 작성된 공식기관·공시·기업·언론 출처를 우선 채택한다. 영어 검색은 한국어 1차 출처가 없을 때의 보조 수단으로만 사용한다.
- duckduckgo_search로 검색하고 fetch_web_page로 원문·발행일을 검증한다.
- 검색결과 snippet만 증거로 사용하지 않는다.
- 영어 원문만 확인 가능한 사실은 의미·수치·날짜를 보존해 한국어로 번역·요약한다. 최종 Markdown에는 영어 제목, 영어 snippet, 영어 문장 또는 영어 직접 인용을 쓰지 않는다. 원문 URL과 식별자는 유지한다.
- Moderator가 준 web_evidence_window의 primary 범위와 scenario_scheme에 직접 연결되는 자료를 우선한다. 검색의 편의성, 유명도, 단순 키워드 일치만으로 너무 먼 과거 자료를 채택하지 않는다.
- primary 범위 밖의 자료는 제도·정책·산업 구조가 지속되고 현재 전달 경로와 동일하다는 근거가 있을 때만 secondary로 확장한다. 확장 자료마다 Retrieval Plan에 날짜 범위, 확장 사유, 현재 scenario_scheme과의 연결고리, 대체 가능한 더 최근 자료의 부재를 기록한다.
- 1차 조사본에서 자료가 부족하거나 범위가 과도하면 Feedback and Scope Gaps에 RANGE_EXPAND 또는 RANGE_NARROW를 요청한다. Moderator 승인 전에는 임의로 범위를 넓혀 일반론을 채우지 않는다.
- 외부 유사 사례는 충격 유형·관련 기관/기업·지역·정책 환경·공급망/산업 전달 경로를 중심으로 비교한다.
- 공식기관·공시·기업·국제기구 등 1차 출처를 우선한다.
- DB Agent의 record_id/주장과 중복되는 사실은 제외한다.
- as_of 이후 공개된 자료와 출처 불명 자료는 사용하지 않는다.
- 완성 문서를 반드시 save_web_search_evidence로 저장한다.

문서 형식:
# Web Search Evidence
## Analysis Context
## Scenario-Aligned Retrieval Plan
## Verified External Facts
## Known Upcoming Events
## Similar Historical Cases
## Feedback and Scope Gaps
## Relation Candidates
## Uncertainties
## Evidence Register
| evidence_id | claim | observed_at | source | record_id_or_url |
|---|---|---|---|---|
## Limitations

Evidence Register의 observed_at은 원문의 발행일 YYYY-MM-DD이며 as_of 이하여야 한다.
""" + KOREAN_OUTPUT_PROTOCOL + RETRIEVAL_FEEDBACK_PROTOCOL + HISTORICAL_ATTENTION_PROTOCOL,
}


def _specialist(name: str, output_dir: Path, as_of_date: date, model: Any) -> CompiledSubAgent:
    """Compile one standalone LangChain domain agent and wrap it for DeepAgents."""
    graph = create_agent(
        model=model,
        tools=[
            *_bounded_database_tools(name, as_of_date),
            _save_evidence_tool(output_dir, name, as_of_date),
        ],
        system_prompt=SPECIALIST_PROMPTS[name],
        name=f"{name}_graph",
    )
    return CompiledSubAgent(
        name=f"{name}_agent",
        description=(
            f"FINVERSE {name} specialist. Writes {EVIDENCE_FILES[name]}, "
            "ranks historical analogues by scenario similarity and separates observations, "
            "interpretations, relations, uncertainty, and missing data. Market output retains "
            "the raw dated observations used for quantitative analysis."
        ),
        runnable=graph,
    )


ORCHESTRATOR_PROMPT = """당신은 FINVERSE Moderator Agent다.
사용자 scenario request를 네 개 Domain Agent의 독립 조사 작업으로 분해하고 Evidence Markdown을 검토한 뒤,
MiroFish가 사용할 현재 시장 상황 온톨로지와 조건부 미래 시나리오를 만든다.

언어 규칙:
- 최종 MiroFish Markdown의 제목, 본문, 표, Evidence Register의 주장과 출처 설명은 한국어로 쓴다.
- 영어 원문·검색결과는 사실 관계를 보존한 한국어 요약으로 바꾸며, 영어 제목·snippet·직접 인용을 최종 문서에 남기지 않는다.
- URL, record_id, ticker, 수치 단위, 공식 고유명사·약어만 원문 표기를 허용한다.

실행 순서:
1. query, target, as_of, horizon을 확인하고 내부 작업 명세를 만든다.
2. 사용자 시나리오를 다음 scenario_signature로 구조화한다.
   - entities: 국가·시장·섹터·종목·기관
   - shock_type: 정책·거시·실적·수급·공급망·지정학 등 충격 유형
   - direction_and_magnitude: 변화 방향과 알려진 강도
   - transmission_channels: 시장으로 전달될 수 있는 경로
   - market_regime: 추세·변동성·유동성·수급 환경
   - macro_regime: 성장·물가·금리·환율 환경
   - event_context: 당시 정책·산업·지정학 맥락
   - horizon: 비교할 사후 관측 구간
3. scenario_signature를 바탕으로 attention_plan을 만든다. 비교 차원별 가중치, Top-K=3,
   최소 후보 수=5, 반례 수=1을 명시한다. 가중치 합은 100이어야 한다.
4. attention_plan을 historical_retrieval_plan으로 구체화한다.
   - scenario_scheme: 충격·전달 경로·대상·시장/거시 regime의 결합
   - candidate_case_rules: 사례 후보의 anchor_date 조건과 제외 조건
   - case_windows: CURRENT와 과거 사례 각각의 사전 20/60거래일, Top-K 선정 후의 사후 horizon
   - web_evidence_window: primary 조사 범위, secondary 확장 조건, 오래된 자료를 허용할 구조적 지속성 기준
   이 계획은 과거 결과가 아니라 anchor_date 당시 알 수 있었던 정보로 만든다.
5. 소유권을 먼저 배정한다.
   - market_agent: 시장 가격·지수·섹터·수급·외국인 보유 및 정량 판단에 쓴 원시 일별 시계열
   - economy_agent: 거시경제 시계열
   - events_agent: FINVERSE DB 뉴스·정책·실적 사건
   - web_search_agent: 위 세 영역에 없는 검증된 외부 공개정보
6. 각 작업에 query, target, as_of, horizon, assigned_scope, already_covered,
   scenario_signature, attention_dimensions, attention_weights, top_k, counterexample_requirement,
   historical_retrieval_plan, web_evidence_window를 명시한다.
   market_agent의 assigned_scope에는 정량 판단에 필요한 대상·필드·CURRENT와 사례별 단기 20일·중기 60일 조회와 MA20/MA60, 원시 시계열 보존을 명시한다.
7. 네 Agent를 1차 조사 단계로 호출해 후보 사례·조회 범위·data gap을 포함한 Evidence 초안을 저장하게 한다.
8. read_specialist_evidence를 호출해 다음을 검토한다.
   - 기준 시점이 같은가
   - 사실·해석·관계 후보가 구분됐는가
   - market Evidence의 Raw Time Series가 실제 조회한 날짜별 원시 행, source, record_id를 보존하며 요약치의 재계산 근거가 되는가
   - market Evidence가 단기 20일·중기 60일의 원시 관측치와 MA20/MA60을 각각 구분했는가
   - 영어 원문을 그대로 복사하지 않고 모든 Agent Evidence와 최종 문서가 한국어로 작성됐는가
   - 각 Evidence의 Feedback and Scope Gaps에 범위·사례·소유권 판단 요청이 있는가
   - web Evidence가 primary 범위 밖의 자료를 채택했다면 구조적 지속성·현재 연결고리·더 최근 대체자료 부재를 설명했는가
   - 핵심 주장에 출처와 record_id/URL이 있는가
   - cross_domain_duplicates가 비어 있는가
   - 유사 사례가 결과를 보기 전에 scenario_signature만으로 선정됐는가
   - similarity_score의 차원별 근거, 일치점, 차이점이 있는가
   - Top-K 사후 관측 종료일이 as_of 이하인가
   - 반례가 포함됐으며 구조적 차이가 설명됐는가
   - 상승·기준·하락 경로를 구성할 증거가 있는가
   - 누락 또는 충돌이 있는가
9. 정말 필요한 경우에만 해당 Agent에 아래 형식의 FEEDBACK_REQUEST를 보내 보완을 요청한다. Agent별 보완은 최대 1회다.
   | type | affected_case_or_scope | reason | required_action | prohibited_action |
   type은 CASE_SELECTION, RANGE_EXPAND, RANGE_NARROW, RAW_SERIES_MISSING, DUPLICATE_OWNERSHIP 중 하나다.
   사후 결과가 좋거나 나빴다는 이유의 사례 선택·제외·범위 변경은 prohibited_action으로 명시한다.
10. 보완 Agent는 Feedback and Scope Gaps에 피드백 적용 여부를 남기고 같은 Evidence를 1회 수정한다.
11. 다시 read_specialist_evidence를 호출해 최종 네 문서를 읽는다.
12. 도메인별 Top-K를 그대로 합산하지 않는다. 현재 scenario_signature와의 관련성, 출처 품질,
    도메인 간 독립성을 기준으로 evidence attention을 재조정해 최종 MiroFish Markdown을 작성한다.

통제 원칙:
- as_of 이후 공개되거나 발생한 사실은 사용하지 않는다.
- 미래를 확정 예측하지 않는다. as_of까지 이용 가능했던 정보에 근거해 horizon의 가정된 시나리오를 조건부로 설명한다.
- 동일 record_id, URL, 엔터티·날짜·주장 의미의 사실은 한 번만 채택한다.
- 과거 사례는 anchor_date 당시 알 수 있었던 특징만으로 먼저 선정한다. 사후 결과를 보고 사례를 고르는 look-ahead selection을 금지한다.
- 유사 사례의 사후 결과는 anchor_date 이후 horizon 종료일이 as_of 이하일 때만 사용한다.
- similarity_score가 높아도 차이점이 크거나 전달 메커니즘이 다르면 attention weight를 낮춘다.
- 유사 사례의 반복을 전제로 하지 않으며, 반례와 시나리오가 깨지는 조건을 함께 제시한다.
- 충돌하는 근거는 삭제하지 말고 불확실성에 기록한다.
- 확정적 가격 전망과 투자 추천을 금지한다.
- 최종 문서는 반드시 save_mirofish_markdown으로 저장한다.

최종 형식:
# 시나리오 제목
## 분석 기준
## 현재 시장 상황 온톨로지
## 엔터티 목록
## 영향 관계
## 유사 과거 국면과 Attention 근거
| 순위 | 과거 국면 | 기준일 | 종합 유사도 | 핵심 일치점 | 핵심 차이점 | 관측된 사후 경로 | 현재 적용 조건 |
|---|---|---|---:|---|---|---|---|
## 가정된 미래 시나리오
### 상승 경로
### 기준 경로
### 하락 경로
## 불확실성
## 부족한 데이터
## Evidence Register
| id | 주장 | 출처 | 기준일 | 담당 에이전트 | record_id 또는 URL |
|---|---|---|---|---|---|
"""


def build_agent(output_dir: Path, as_of_date: date):
    """Build the Moderator from four independently compiled domain agents."""
    model_id = os.environ.get("FINVERSE_AGENT_MODEL", DEFAULT_MODEL)
    model = _create_chat_model(model_id)
    subagents = [_specialist(name, output_dir, as_of_date, model) for name in SPECIALISTS]
    return create_deep_agent(
        model=model,
        system_prompt=ORCHESTRATOR_PROMPT,
        tools=[_read_evidence_tool(output_dir), _save_final_tool(output_dir)],
        subagents=subagents,
        name="mirofish_moderator",
    )

def _slug(value: str) -> str:
    return re.sub(r"[^\w가-힣]+", "-", value, flags=re.UNICODE).strip("-").lower()[:70] or "scenario"


def run(query: str, as_of_date: date, horizon: str, target: str, output_dir: Path | None = None) -> Path:
    """Run one scenario and return its artifact directory."""
    _load_dotenv()
    if not query.strip():
        raise ValueError("query is required")
    path = output_dir or OUTPUT_ROOT / f"{_slug(query)}-asof-{as_of_date.isoformat()}"
    path.mkdir(parents=True, exist_ok=True)
    context = {
        "query_id": _slug(query),
        "query": query,
        "target": target or "KOSPI",
        "as_of": as_of_date.isoformat(),
        "horizon": horizon,
        "required_agents": list(SPECIALISTS),
        "already_covered": [],
        "output_language": "ko",
    }
    build_agent(path, as_of_date).invoke({"messages": [{"role": "user", "content": "다음 컨텍스트로 시나리오 입력 문서를 생성해줘.\n" + _json(context)}]})
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Create MiroFish scenario input with FINVERSE A2A agents.")
    parser.add_argument("query", help="Scenario question")
    parser.add_argument("--as-of", default=date.today().isoformat(), help="Information cutoff date, YYYY-MM-DD")
    parser.add_argument(
        "--horizon",
        default=DEFAULT_HORIZON,
        help=f"Assumed scenario horizon (default: {DEFAULT_HORIZON})",
    )
    parser.add_argument("--target", "--market-scope", dest="target", default="KOSPI", help="Analysis target")
    parser.add_argument("--output-dir", type=Path, default=None)
    args = parser.parse_args()
    as_of_date = _date(args.as_of, "--as-of") or date.today()
    output_dir = run(args.query, as_of_date, args.horizon, args.target, args.output_dir)
    print(_json({"output_dir": str(output_dir), "mirofish_markdown": str(output_dir / FINAL_FILE)}))


if __name__ == "__main__":
    main()
