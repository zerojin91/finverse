#!/usr/bin/env python3
"""Ingest SaveTicker public-news UI snapshots into the FINVERSE JSONL lake.

SaveTicker is collected only from public card metadata.  The collector never
calls private/disallowed APIs and does not retain article body text.
"""

from __future__ import annotations

import argparse
from datetime import UTC, date, datetime, timedelta
import json
from pathlib import Path
import sys
from typing import Any

from _jsonl_store import JsonlStore, load_dotenv, sha256


ROOT = Path(__file__).resolve().parents[1]
STORE = JsonlStore(ROOT / "data" / "saveticker")


def parse_time(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)).isoformat()
    except ValueError:
        return None


def value(item: dict[str, Any], *keys: str) -> str:
    for key in keys:
        candidate = item.get(key)
        if candidate is not None:
            return str(candidate).strip()
    return ""


def normalize(snapshot: Any, start: date, end: date) -> list[dict[str, Any]]:
    if isinstance(snapshot, list):
        cards = snapshot
    elif isinstance(snapshot, dict):
        cards = snapshot.get("articles") or snapshot.get("items")
    else:
        cards = None
    if not isinstance(cards, list):
        raise ValueError("snapshot must contain an 'articles' or 'items' array")
    records = []
    for item in cards:
        if not isinstance(item, dict):
            continue
        title = value(item, "title", "headline")
        if not title:
            continue
        published_raw = value(item, "published_at", "publishedAt", "displayed_at", "time", "date")
        published_at = parse_time(published_raw)
        if published_at and not (start <= datetime.fromisoformat(published_at).date() <= end):
            continue
        publisher = value(item, "source", "publisher", "media") or "SaveTicker"
        url = value(item, "url", "link")
        category = value(item, "category", "section")
        tickers = item.get("tickers") or item.get("symbols") or []
        if isinstance(tickers, str):
            tickers = [tickers]
        tickers = [str(ticker).upper() for ticker in tickers if str(ticker).strip()]
        record_id = sha256(
            {"publisher": publisher.casefold(), "url": url}
            if url
            else {"publisher": publisher.casefold(), "title": title.casefold(), "published": published_at or published_raw, "tickers": tickers}
        )
        records.append({
            "record_id": record_id, "record_type": "news_article", "source": "saveticker_public_ui",
            "external_id": url or None, "title": title, "summary": None, "published_at": published_at,
            "published_at_raw": published_raw or None, "origin_publisher": publisher, "url": url or None,
            "category": category or None, "tickers": tickers, "country_codes": ["KR", "US"],
            "event_types": ["MARKET_NEWS"],
        })
    return records


def snapshots(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(candidate for candidate in path.glob("*.json") if candidate.is_file())


def collect(mode: str, input_path: Path, start: date, end: date) -> int:
    records = []
    failures = []
    for path in snapshots(input_path):
        try:
            body = path.read_bytes()
            snapshot = json.loads(body)
            if not isinstance(snapshot, (dict, list)):
                raise ValueError("top-level JSON must be an object or array")
            raw_path = STORE.save_raw("saveticker_public_ui", sha256({"file": path.name, "body": sha256(body.decode('utf-8', errors='replace'))})[:16], body, "application/json")
            for record in normalize(snapshot, start, end):
                record["raw_path"] = raw_path
                records.append(record)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            failures.append(f"{path}: {exc}")
    summary = STORE.merge(records, collector="saveticker_ingest", mode=mode)
    print(json.dumps({"mode": mode, "input": str(input_path), "failures": failures, **summary}, ensure_ascii=False))
    return 1 if failures and not records else 0


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("backfill", "update"):
        child = sub.add_parser(command)
        child.add_argument("--input", type=Path, required=True, help="snapshot JSON file or directory")
        child.add_argument("--start", type=date.fromisoformat)
        child.add_argument("--end", type=date.fromisoformat, default=date.today())
        child.add_argument("--revision-lookback-days", "--lookback-days", dest="revision_lookback_days", type=int, default=30)
    args = parser.parse_args()
    start = args.start or (args.end - timedelta(days=365 if args.command == "backfill" else args.revision_lookback_days))
    return collect(args.command, args.input, start, args.end)


if __name__ == "__main__":
    sys.exit(main())
