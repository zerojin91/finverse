#!/usr/bin/env python3
"""Collect Korea/US macro-relevant RSS news into a versioned JSONL lake.

Examples:
  python collectors/macro_news_ingest.py backfill --start 2025-08-01 --end 2026-08-01
  python collectors/macro_news_ingest.py update
"""

from __future__ import annotations

import argparse
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
import html
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from _jsonl_store import JsonlStore, load_dotenv, sha256


ROOT = Path(__file__).resolve().parents[1]
STORE = JsonlStore(ROOT / "data" / "macro_news")

SOURCES = {
    "fed_press": {"url": "https://www.federalreserve.gov/feeds/press_all.xml", "country": "US", "tier": 1},
    "bok_press": {"url": "https://www.bok.or.kr/eng/bbs/E0000634/news.rss?menuNo=400069", "country": "KR", "tier": 1},
    "moef_press": {"url": "https://english.moef.go.kr/pc/engmosfrss.do?boardCd=N0001", "country": "KR", "tier": 1},
    "bbc_business": {"url": "https://feeds.bbci.co.uk/news/business/rss.xml", "country": "GB", "tier": 2},
    "yonhap": {"url": "https://en.yna.co.kr/RSS/news.xml", "country": "KR", "tier": 2},
    "marketwatch": {"url": "https://feeds.content.dowjones.io/public/rss/mw_topstories", "country": "US", "tier": 2},
}
GOOGLE_QUERIES = {
    "google_us_macro": '("Federal Reserve" OR FOMC OR "U.S. economy") (interest rate OR inflation OR CPI OR payroll OR GDP)',
    "google_kr_macro": '("South Korea" OR "Bank of Korea") (interest rate OR inflation OR CPI OR GDP OR exports OR exchange rate)',
    "google_geopolitics": '(North Korea OR Taiwan OR China OR "Middle East") (war OR conflict OR sanction OR "export control") (Korea OR "United States" OR semiconductor OR market)',
}
EVENT_TERMS = {
    "INTEREST_RATES": ("interest rate", "rate hike", "rate cut", "fomc", "monetary", "yield", "금리", "기준금리"),
    "REAL_ECONOMY": ("inflation", "cpi", "ppi", "gdp", "employment", "payroll", "pmi", "물가", "고용", "성장률"),
    "FOREIGN_EXCHANGE": ("exchange rate", "foreign exchange", "currency", "won", "krw", "usd", "환율", "외환"),
    "POLICY": ("tariff", "sanction", "regulation", "subsidy", "export control", "관세", "제재", "규제", "보조금"),
    "GEOPOLITICAL": ("war", "conflict", "missile", "taiwan", "north korea", "middle east", "전쟁", "분쟁", "미사일", "대만", "북한", "중동"),
}
IMPACT_TERMS = ("kospi", "nasdaq", "s&p 500", "semiconductor", "chip", "hbm", "ai", "data center", "외국인", "수급", "반도체", "코스피", "환율")


def clean(value: str | None) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value or "")).split())


def parse_time(value: str) -> str | None:
    try:
        parsed = parsedate_to_datetime(value)
        return (parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)).isoformat()
    except (TypeError, ValueError, IndexError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return (parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)).isoformat()
        except ValueError:
            return None


def local_text(node: ET.Element, names: set[str]) -> str:
    for child in node.iter():
        if child.tag.rsplit("}", 1)[-1] in names and (child.text or "").strip():
            return clean(child.text)
    return ""


def item_url(node: ET.Element) -> str:
    for child in node.iter():
        if child.tag.rsplit("}", 1)[-1] != "link":
            continue
        candidate = child.attrib.get("href") or child.text or ""
        if candidate.strip():
            parts = urlsplit(candidate.strip())
            return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, parts.query, ""))
    return ""


def classify(title: str, summary: str, tier: int, country: str) -> tuple[list[str], int]:
    text = f"{title} {summary}".casefold()
    events = [name for name, terms in EVENT_TERMS.items() if any(term in text for term in terms)]
    impacts = [term for term in IMPACT_TERMS if term in text]
    score = (2 if country in {"KR", "US"} else 0) + min(2, len(events)) + min(2, len(impacts)) + (1 if tier <= 2 else 0)
    include = bool(events) and (score >= 4 or ("GEOPOLITICAL" in events and score >= 3))
    return events, score if include else 0


def fetch(url: str) -> tuple[bytes, str]:
    user_agent = os.getenv("FINVERSE_COLLECTOR_USER_AGENT", "FinverseCollector/1.0")
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "application/rss+xml, application/xml, text/xml"})
    try:
        with urlopen(request, timeout=30) as response:
            return response.read(), response.headers.get_content_type()
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"{url}: {exc}") from exc


def source_urls(selected: list[str], start: date, end: date) -> list[tuple[str, dict[str, object]]]:
    rows: list[tuple[str, dict[str, object]]] = []
    for source in selected:
        if source in SOURCES:
            rows.append((source, SOURCES[source]))
        elif source in GOOGLE_QUERIES:
            query = f"{GOOGLE_QUERIES[source]} after:{start.isoformat()} before:{(end + timedelta(days=1)).isoformat()}"
            rows.append((source, {"url": f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en", "country": "US", "tier": 3}))
        else:
            raise ValueError(f"Unknown source: {source}")
    return rows


def collect(mode: str, start: date, end: date, selected: list[str]) -> int:
    records = []
    failures = []
    for source_id, source in source_urls(selected, start, end):
        try:
            body, content_type = fetch(str(source["url"]))
            raw_path = STORE.save_raw(source_id, sha256({"url": source["url"], "start": str(start), "end": str(end)})[:16], body, content_type)
            root = ET.fromstring(body)
            for item in [node for node in root.iter() if node.tag.rsplit("}", 1)[-1] in {"item", "entry"}]:
                title = local_text(item, {"title"})
                if not title:
                    continue
                summary = local_text(item, {"description", "summary", "encoded", "content"})
                published_raw = local_text(item, {"pubDate", "published", "updated", "date"})
                published_at = parse_time(published_raw)
                if published_at and not (start <= datetime.fromisoformat(published_at).date() <= end):
                    continue
                events, score = classify(title, summary, int(source["tier"]), str(source["country"]))
                if not score:
                    continue
                url = item_url(item)
                record_id = sha256(
                    {"source": source_id, "url": url}
                    if url
                    else {"source": source_id, "title": title.casefold(), "published": published_at or published_raw}
                )
                records.append({
                    "record_id": record_id, "record_type": "news_article", "source": source_id,
                    "external_id": url or None, "title": title, "summary": summary or None,
                    "published_at": published_at, "published_at_raw": published_raw or None,
                    "country_codes": [source["country"]], "event_types": events, "selection_score": score,
                    "url": url or None, "raw_path": raw_path,
                })
        except (ET.ParseError, RuntimeError) as exc:
            failures.append(f"{source_id}: {exc}")
    summary = STORE.merge(records, collector="macro_news_ingest", mode=mode)
    print(json_dump({"mode": mode, "window": [str(start), str(end)], "failures": failures, **summary}))
    return 1 if failures and not records else 0


def json_dump(value: object) -> str:
    import json
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("backfill", "update"):
        child = sub.add_parser(command)
        child.add_argument("--start", type=date.fromisoformat)
        child.add_argument("--end", type=date.fromisoformat, default=date.today())
        child.add_argument("--sources", nargs="+", choices=[*SOURCES, *GOOGLE_QUERIES], default=[*SOURCES, *GOOGLE_QUERIES])
        child.add_argument("--revision-lookback-days", "--lookback-days", dest="revision_lookback_days", type=int, default=30)
    args = parser.parse_args()
    start = args.start or (args.end - timedelta(days=365 if args.command == "backfill" else args.revision_lookback_days))
    return collect(args.command, start, args.end, args.sources)


if __name__ == "__main__":
    sys.exit(main())
