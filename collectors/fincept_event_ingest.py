#!/usr/bin/env python3
"""Collect macro-calendar events from a Fincept API deployment into JSONL."""

from __future__ import annotations

import argparse
from datetime import UTC, date, datetime, timedelta
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from _jsonl_store import JsonlStore, load_dotenv, sha256


ROOT = Path(__file__).resolve().parents[1]
STORE = JsonlStore(ROOT / "data" / "fincept_events")


def parse_time(value: object) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return (parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)).isoformat()
    except ValueError:
        return None


def fetch(start: date, end: date, limit: int) -> tuple[bytes, str, str]:
    base = os.getenv("FINCEPT_API_BASE_URL", "https://api.fincept.in").rstrip("/")
    endpoint = os.getenv("FINCEPT_EVENTS_ENDPOINT", "/macro/upcoming-events")
    query = urlencode({"start": start.isoformat(), "end": end.isoformat(), "limit": limit})
    url = f"{base}{endpoint}?{query}"
    headers = {"Accept": "application/json", "User-Agent": os.getenv("FINVERSE_COLLECTOR_USER_AGENT", "FinverseCollector/1.0")}
    if os.getenv("FINCEPT_API_KEY"):
        headers["X-API-Key"] = os.environ["FINCEPT_API_KEY"]
    if os.getenv("FINCEPT_SESSION_TOKEN"):
        headers["X-Session-Token"] = os.environ["FINCEPT_SESSION_TOKEN"]
    try:
        with urlopen(Request(url, headers=headers), timeout=30) as response:
            return response.read(), response.headers.get_content_type(), url
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"Fincept event API request failed: {exc}") from exc


def normalize(payload: object, raw_path: str) -> list[dict[str, object]]:
    if isinstance(payload, dict):
        items = payload.get("events") or payload.get("data") or payload.get("results") or []
    else:
        items = payload
    if not isinstance(items, list):
        raise ValueError("Fincept response must contain an events/data/results array")
    records = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("event") or item.get("name") or "").strip()
        if not name:
            continue
        country = str(item.get("country") or item.get("country_code") or "").upper() or None
        scheduled = parse_time(item.get("date") or item.get("scheduled_at") or item.get("datetime"))
        external_id = str(item.get("id") or item.get("event_id") or "").strip() or None
        record_id = sha256(
            {"external_id": external_id}
            if external_id
            else {"name": name.casefold(), "country": country, "scheduled": scheduled}
        )
        records.append({
            "record_id": record_id, "record_type": "macro_event", "source": "fincept_api",
            "external_id": external_id, "event_name": name, "country_code": country,
            "currency": item.get("currency"), "scheduled_at": scheduled,
            "importance": item.get("importance"), "actual": item.get("actual"),
            "forecast": item.get("forecast"), "previous": item.get("previous"),
            "unit": item.get("unit"), "status": item.get("status"), "raw_path": raw_path,
        })
    return records


def collect(mode: str, start: date, end: date, limit: int) -> int:
    body, content_type, url = fetch(start, end, limit)
    raw_path = STORE.save_raw("fincept_api", sha256({"url": url})[:16], body, content_type)
    records = normalize(json.loads(body), raw_path)
    summary = STORE.merge(records, collector="fincept_event_ingest", mode=mode)
    print(json.dumps({"mode": mode, "window": [str(start), str(end)], **summary}, ensure_ascii=False))
    return 0


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("backfill", "update"):
        child = sub.add_parser(command)
        child.add_argument("--start", type=date.fromisoformat)
        child.add_argument("--end", type=date.fromisoformat, default=date.today())
        child.add_argument("--revision-lookback-days", "--lookback-days", dest="revision_lookback_days", type=int, default=30)
        child.add_argument("--limit", type=int, default=1000)
    args = parser.parse_args()
    start = args.start or (args.end - timedelta(days=365 if args.command == "backfill" else args.revision_lookback_days))
    return collect(args.command, start, args.end, args.limit)


if __name__ == "__main__":
    sys.exit(main())
