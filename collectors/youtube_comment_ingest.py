#!/usr/bin/env python3
"""Collect public comments for a fixed set of Korean stock YouTube channels."""

from __future__ import annotations

import argparse
from contextlib import closing
from datetime import UTC, date, datetime, time as wall_time, timedelta
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from typing import Any, Iterable, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from ._indexed_jsonl_store import IndexedJsonlStore
    from ._jsonl_store import canonical_json, load_dotenv, sha256
except ImportError:
    from _indexed_jsonl_store import IndexedJsonlStore
    from _jsonl_store import canonical_json, load_dotenv, sha256


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "data" / "youtube_comments"
WORK_ROOT = OUTPUT_ROOT / "work"
MANIFEST_PATH = OUTPUT_ROOT / "channel_manifest.json"
CANDIDATE_PATH = OUTPUT_ROOT / "channel_candidates.json"
THREAD_PAGE_PATH = WORK_ROOT / "thread_page.json"
SALT_FINGERPRINT_PATH = WORK_ROOT / "salt_fingerprint.json"
STORE = IndexedJsonlStore(OUTPUT_ROOT)
API_ROOT = "https://www.googleapis.com/youtube/v3"
DEFAULT_QUERY = "국내주식|코스피|코스닥|한국증시"
RETENTION_DAYS = 29
REFRESH_CYCLE_DAYS = 28

SEARCH_FIELDS = "nextPageToken,items(id/channelId,snippet/channelId)"
CHANNEL_FIELDS = (
    "items(id,snippet(title,country),contentDetails/relatedPlaylists/uploads,"
    "statistics(viewCount,subscriberCount,hiddenSubscriberCount,videoCount))"
)
PLAYLIST_FIELDS = (
    "nextPageToken,items(contentDetails(videoId,videoPublishedAt),"
    "snippet(title),status/privacyStatus)"
)
THREAD_FIELDS = (
    "nextPageToken,items(etag,id,snippet(videoId,totalReplyCount,"
    "topLevelComment(etag,id,snippet(textDisplay,likeCount,publishedAt,updatedAt))))"
)
REPLY_FIELDS = (
    "nextPageToken,items(etag,id,snippet(parentId,textDisplay,likeCount,publishedAt,updatedAt))"
)

EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)")
IP_RE = re.compile(
    r"(?<!\d)(?:25[0-5]|2[0-4]\d|1?\d?\d)"
    r"(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?!\d)"
)

VOLATILE_FIELDS = (
    "refreshed_at",
    "expires_at",
    "last_full_comment_scan_at",
    "comment_scan_status",
    "missing_scan_count",
    "last_missing_scan_at",
    "last_missing_scan_id",
)


class ApiError(RuntimeError):
    def __init__(self, status: int, reason: str):
        self.status = status
        self.reason = reason
        super().__init__(f"YouTube API error {status}: {reason}")


class BudgetReached(RuntimeError):
    pass


class YouTubeClient:
    def __init__(self, api_key: str, max_calls: int, timeout: int = 30):
        self.api_key = api_key
        self.max_calls = max_calls
        self.timeout = timeout
        self.calls = 0

    def get(self, resource: str, params: dict[str, Any]) -> dict[str, Any]:
        url = f"{API_ROOT}/{resource}?{urlencode(params)}"
        last_error: Exception | None = None
        for attempt in range(3):
            if self.calls >= self.max_calls:
                raise BudgetReached(f"API call budget reached: {self.calls}/{self.max_calls}")
            self.calls += 1
            request = Request(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": os.getenv(
                        "FINVERSE_COLLECTOR_USER_AGENT", "FinverseCollector/1.0"
                    ),
                    "X-Goog-Api-Key": self.api_key,
                },
            )
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read())
                if not isinstance(payload, dict):
                    raise ApiError(200, "invalidResponse")
                return payload
            except HTTPError as exc:
                reason = api_error_reason(exc.read())
                if (exc.code == 429 or exc.code >= 500) and attempt < 2:
                    last_error = exc
                    time.sleep(2**attempt)
                    continue
                raise ApiError(exc.code, reason) from None
            except (URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(2**attempt)
                    continue
        raise RuntimeError(f"YouTube request failed: {type(last_error).__name__}") from last_error


def api_error_reason(body: bytes) -> str:
    try:
        payload = json.loads(body)
        errors = payload.get("error", {}).get("errors", [])
        return str(errors[0].get("reason", "httpError")) if errors else "httpError"
    except (json.JSONDecodeError, AttributeError, IndexError, TypeError):
        return "httpError"


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except ValueError:
        return None


def expires_at(refreshed_at: str) -> str:
    return (datetime.fromisoformat(refreshed_at) + timedelta(days=RETENTION_DAYS)).isoformat()


def timestamped(record: dict[str, Any], refreshed_at: str | None = None) -> dict[str, Any]:
    refreshed_at = refreshed_at or now_iso()
    return {**record, "refreshed_at": refreshed_at, "expires_at": expires_at(refreshed_at)}


def date_bounds(start: date | None, end: date) -> tuple[str | None, str]:
    lower = (
        datetime.combine(start, wall_time.min, tzinfo=UTC).isoformat() if start else None
    )
    upper = datetime.combine(end, wall_time.max, tzinfo=UTC).isoformat()
    return lower, upper


def video_in_range(record: dict[str, Any], start: date | None, end: date) -> bool:
    published = parse_time(record.get("published_at"))
    if published is None:
        return start is None
    return published.date() <= end and (start is None or published.date() >= start)


def redact_personal_data(text: str) -> str:
    text = EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    text = PHONE_RE.sub("[REDACTED_PHONE]", text)
    return IP_RE.sub("[REDACTED_IP]", text)


def private_id(kind: str, raw_id: str, salt: str) -> str:
    digest = hmac.new(
        salt.encode("utf-8"), f"{kind}\0{raw_id}".encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"hmac-sha256:{digest}"


def channel_id(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", value):
        raise argparse.ArgumentTypeError(f"invalid YouTube channel ID: {value}")
    return value


def chunks(values: Iterable[Any], size: int = 500) -> Iterator[list[Any]]:
    block: list[Any] = []
    for value in values:
        block.append(value)
        if len(block) == size:
            yield block
            block = []
    if block:
        yield block


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, mode)
    os.replace(temporary, path)


def unlink_thread_page() -> None:
    THREAD_PAGE_PATH.unlink(missing_ok=True)


class WorkState:
    """Small resumable state machine stored beside the on-disk latest index."""

    def __init__(self, path: Path):
        self.path = path
        self._initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=60)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA secure_delete=ON")
        return connection

    def _initialize(self) -> None:
        with closing(self.connect()) as connection, connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS youtube_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS youtube_channel_queue (
                    position INTEGER PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    uploads_playlist_id TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS youtube_upload_seen (
                    channel_id TEXT NOT NULL,
                    video_id TEXT NOT NULL,
                    PRIMARY KEY (channel_id, video_id)
                );
                CREATE TABLE IF NOT EXISTS youtube_video_queue (
                    video_id TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    position INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS youtube_video_queue_order
                    ON youtube_video_queue(priority, position);
                CREATE TABLE IF NOT EXISTS youtube_comment_seen (
                    record_id TEXT PRIMARY KEY
                );
                """
            )

    def operation(self) -> dict[str, Any]:
        with closing(self.connect()) as connection, connection:
            row = connection.execute(
                "SELECT value FROM youtube_state WHERE key = 'operation'"
            ).fetchone()
        return json.loads(row["value"]) if row else {}

    def save_operation(self, operation: dict[str, Any]) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute(
                "INSERT INTO youtube_state(key, value) VALUES('operation', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (canonical_json(operation),),
            )

    def reset(self) -> None:
        with closing(self.connect()) as connection, connection:
            for table in (
                "youtube_state",
                "youtube_channel_queue",
                "youtube_upload_seen",
                "youtube_video_queue",
                "youtube_comment_seen",
            ):
                connection.execute(f"DELETE FROM {table}")
        unlink_thread_page()

    def set_channels(self, channels: list[dict[str, Any]]) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute("DELETE FROM youtube_channel_queue")
            connection.executemany(
                "INSERT INTO youtube_channel_queue(position, channel_id, uploads_playlist_id) "
                "VALUES(?, ?, ?)",
                [
                    (index, row["channel_id"], row["uploads_playlist_id"])
                    for index, row in enumerate(channels)
                ],
            )

    def channel_at(self, position: int) -> dict[str, str] | None:
        with closing(self.connect()) as connection, connection:
            row = connection.execute(
                "SELECT channel_id, uploads_playlist_id FROM youtube_channel_queue "
                "WHERE position = ?",
                (position,),
            ).fetchone()
        return dict(row) if row else None

    def clear_upload_seen(self, channel: str) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute(
                "DELETE FROM youtube_upload_seen WHERE channel_id = ?", (channel,)
            )

    def mark_upload_seen(self, channel: str, video_ids: Iterable[str]) -> None:
        with closing(self.connect()) as connection, connection:
            connection.executemany(
                "INSERT OR IGNORE INTO youtube_upload_seen(channel_id, video_id) VALUES(?, ?)",
                ((channel, identity) for identity in video_ids),
            )

    def unseen_videos(
        self, channel: str, start: date | None, end: date
    ) -> Iterator[dict[str, Any]]:
        lower, upper = date_bounds(start, end)
        conditions = [
            "l.record_type = 'youtube_video'",
            "l.channel_id = ?",
            "l.is_deleted = 0",
            "l.published_at <= ?",
            "NOT EXISTS (SELECT 1 FROM youtube_upload_seen s "
            "WHERE s.channel_id = l.channel_id AND s.video_id = l.video_id)",
        ]
        values: list[Any] = [channel, upper]
        if lower:
            conditions.append("l.published_at >= ?")
            values.append(lower)
        query = "SELECT l.record_json FROM latest l WHERE " + " AND ".join(conditions)
        with closing(self.connect()) as connection, connection:
            cursor = connection.execute(query, values)
            for row in cursor:
                yield json.loads(row["record_json"])

    def fill_video_queue(
        self,
        command: str,
        start: date | None,
        end: date,
        stale_before: str,
    ) -> int:
        lower, upper = date_bounds(start, end)
        conditions = [
            "record_type = 'youtube_video'",
            "is_deleted = 0",
            "published_at <= ?",
        ]
        values: list[Any] = [upper]
        if lower:
            conditions.append("published_at >= ?")
            values.append(lower)
        if command == "backfill":
            conditions.append(
                "(last_full_comment_scan_at IS NULL OR last_full_comment_scan_at < ?)"
            )
            values.append(stale_before)
        query = (
            "SELECT video_id, channel_id FROM latest WHERE "
            + " AND ".join(conditions)
            + " ORDER BY CASE WHEN last_full_comment_scan_at IS NULL THEN 0 ELSE 1 END, "
            "last_full_comment_scan_at, published_at DESC, video_id"
        )
        count = 0
        with closing(self.connect()) as connection, connection:
            connection.execute("DELETE FROM youtube_video_queue")
            for count, row in enumerate(connection.execute(query, values), 1):
                connection.execute(
                    "INSERT INTO youtube_video_queue(video_id, channel_id, priority, position) "
                    "VALUES(?, ?, 1, ?)",
                    (row["video_id"], row["channel_id"], count),
                )
        return count

    def add_priority_video(self, video_id: str, channel: str) -> None:
        with closing(self.connect()) as connection, connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 AS position "
                "FROM youtube_video_queue WHERE priority = 0"
            ).fetchone()
            connection.execute(
                "INSERT INTO youtube_video_queue(video_id, channel_id, priority, position) "
                "VALUES(?, ?, 0, ?) ON CONFLICT(video_id) DO NOTHING",
                (video_id, channel, int(row["position"])),
            )

    def next_video(self, current_video_id: str | None = None) -> dict[str, str] | None:
        with closing(self.connect()) as connection, connection:
            if current_video_id:
                row = connection.execute(
                    "SELECT video_id, channel_id FROM youtube_video_queue WHERE video_id = ?",
                    (current_video_id,),
                ).fetchone()
                if row:
                    return dict(row)
            row = connection.execute(
                "SELECT video_id, channel_id FROM youtube_video_queue "
                "ORDER BY priority, position LIMIT 1"
            ).fetchone()
        return dict(row) if row else None

    def complete_video(self, video_id: str) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute("DELETE FROM youtube_video_queue WHERE video_id = ?", (video_id,))

    def remaining_videos(self) -> int:
        with closing(self.connect()) as connection, connection:
            return int(
                connection.execute("SELECT COUNT(*) FROM youtube_video_queue").fetchone()[0]
            )

    def clear_comment_seen(self) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute("DELETE FROM youtube_comment_seen")

    def mark_comment_seen(self, record_ids: Iterable[str]) -> None:
        with closing(self.connect()) as connection, connection:
            connection.executemany(
                "INSERT OR IGNORE INTO youtube_comment_seen(record_id) VALUES(?)",
                ((identity,) for identity in record_ids),
            )

    def preserve_thread(self, video_id: str, thread_id: str) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute(
                "INSERT OR IGNORE INTO youtube_comment_seen(record_id) "
                "SELECT record_id FROM latest WHERE record_type = 'youtube_comment' "
                "AND video_id = ? AND thread_id = ? AND is_deleted = 0",
                (video_id, thread_id),
            )

    def unseen_comments(self, video_id: str) -> Iterator[dict[str, Any]]:
        with closing(self.connect()) as connection, connection:
            cursor = connection.execute(
                "SELECT l.record_json FROM latest l WHERE l.record_type = 'youtube_comment' "
                "AND l.video_id = ? AND l.is_deleted = 0 AND NOT EXISTS "
                "(SELECT 1 FROM youtube_comment_seen s WHERE s.record_id = l.record_id)",
                (video_id,),
            )
            for row in cursor:
                yield json.loads(row["record_json"])

    def comments_for_video(self, video_id: str) -> Iterator[dict[str, Any]]:
        with closing(self.connect()) as connection, connection:
            cursor = connection.execute(
                "SELECT record_json FROM latest WHERE record_type = 'youtube_comment' "
                "AND video_id = ? AND is_deleted = 0",
                (video_id,),
            )
            for row in cursor:
                yield json.loads(row["record_json"])

    def stale_video_count(self, start: date | None, end: date, cutoff: str) -> int:
        lower, upper = date_bounds(start, end)
        conditions = [
            "record_type = 'youtube_video'",
            "is_deleted = 0",
            "published_at <= ?",
            "(last_full_comment_scan_at IS NULL OR last_full_comment_scan_at < ?)",
        ]
        values: list[Any] = [upper, cutoff]
        if lower:
            conditions.append("published_at >= ?")
            values.append(lower)
        with closing(self.connect()) as connection, connection:
            return int(
                connection.execute(
                    "SELECT COUNT(*) FROM latest WHERE " + " AND ".join(conditions),
                    values,
                ).fetchone()[0]
            )


STATE = WorkState(STORE.index_path)


def merge_rows(
    records: Iterable[dict[str, Any]], mode: str, totals: dict[str, int]
) -> dict[str, int]:
    summary = STORE.merge(
        records,
        collector="youtube_comment_ingest",
        mode=mode,
        volatile_fields=VOLATILE_FIELDS,
        refresh_unchanged=True,
        prefer_newer_field="refreshed_at",
        log_run=False,
        materialize=False,
    )
    for key in ("inserted", "changed", "unchanged"):
        totals[key] = totals.get(key, 0) + int(summary.get(key, 0))
    totals["stale"] = totals.get("stale", 0) + int(summary.get("skipped_older", 0))
    return summary


def record_without_store_fields(record: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in record.items()
        if key not in {"schema_version", "collected_at", "record_hash"}
    }


def mark_missing(record: dict[str, Any], scan_id: str) -> dict[str, Any]:
    return record_without_store_fields(record) | {
        "missing_scan_count": int(record.get("missing_scan_count", 0)) + 1,
        "last_missing_scan_at": now_iso(),
        "last_missing_scan_id": scan_id,
    }


def tombstone(record: dict[str, Any], reason: str) -> dict[str, Any]:
    refreshed_at = now_iso()
    return timestamped(
        {
            "record_id": record["record_id"],
            "record_type": record.get("record_type"),
            "source": "youtube_data_api",
            "channel_id": record.get("channel_id"),
            "video_id": record.get("video_id"),
            "comment_id": record.get("comment_id"),
            "parent_comment_id": record.get("parent_comment_id"),
            "thread_id": record.get("thread_id"),
            "is_deleted": True,
            "deletion_reason": reason,
            "deleted_at": refreshed_at,
        },
        refreshed_at,
    )


def apply_absence(
    records: Iterable[dict[str, Any]],
    reason: str,
    mode: str,
    totals: dict[str, int],
    scan_id: str,
) -> list[dict[str, Any]]:
    deleted: list[dict[str, Any]] = []
    for block in chunks(records):
        updates: list[dict[str, Any]] = []
        deleted_block: list[dict[str, Any]] = []
        for record in block:
            if record.get("last_missing_scan_id") == scan_id:
                continue
            if int(record.get("missing_scan_count", 0)) >= 1:
                item = tombstone(record, reason)
                updates.append(item)
                deleted_block.append(item)
            else:
                updates.append(mark_missing(record, scan_id))
        if updates:
            merge_rows(updates, mode, totals)
        if deleted_block:
            STORE.purge_versions(
                (row["record_id"] for row in deleted_block), materialize=False
            )
            deleted.extend(deleted_block)
    return deleted


def load_channel_ids(path: Path) -> list[str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"cannot read channel file {path}: {exc}") from None
    values = payload.get("channel_ids") if isinstance(payload, dict) else payload
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise SystemExit("channel file must be a JSON list or an object with channel_ids")
    try:
        return [channel_id(value) for value in values]
    except argparse.ArgumentTypeError as exc:
        raise SystemExit(str(exc)) from None


def read_manifest() -> dict[str, Any]:
    manifest = read_json(MANIFEST_PATH, {})
    expiry = parse_time(manifest.get("expires_at")) if isinstance(manifest, dict) else None
    if expiry and expiry > datetime.now(UTC):
        return manifest
    MANIFEST_PATH.unlink(missing_ok=True)
    return {}


def prune_candidate_file() -> None:
    payload = read_json(CANDIDATE_PATH, {})
    expiry = parse_time(payload.get("expires_at")) if isinstance(payload, dict) else None
    if expiry and expiry <= datetime.now(UTC):
        CANDIDATE_PATH.unlink(missing_ok=True)


def save_manifest(channel_ids: list[str], method: str, query: str | None) -> None:
    refreshed_at = now_iso()
    write_json(
        MANIFEST_PATH,
        {
            "channel_ids": channel_ids,
            "selection_method": method,
            "selection_query": query,
            "refreshed_at": refreshed_at,
            "expires_at": expires_at(refreshed_at),
        },
    )


def candidate_channel_ids(client: YouTubeClient, query: str, pages: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    page_token: str | None = None
    for _ in range(pages):
        params: dict[str, Any] = {
            "part": "snippet",
            "type": "channel",
            "q": query,
            "order": "viewCount",
            "maxResults": 50,
            "regionCode": "KR",
            "relevanceLanguage": "ko",
            "safeSearch": "moderate",
            "fields": SEARCH_FIELDS,
        }
        if page_token:
            params["pageToken"] = page_token
        payload = client.get("search", params)
        for item in payload.get("items", []):
            candidate = str(
                item.get("id", {}).get("channelId")
                or item.get("snippet", {}).get("channelId")
                or ""
            )
            if candidate and candidate not in seen:
                seen.add(candidate)
                result.append(candidate)
        page_token = payload.get("nextPageToken")
        if not page_token:
            break
    return result


def fetch_channel_details(
    client: YouTubeClient, channel_ids: list[str]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for block in chunks(channel_ids, 50):
        payload = client.get(
            "channels",
            {
                "part": "snippet,statistics,contentDetails",
                "id": ",".join(block),
                "maxResults": 50,
                "fields": CHANNEL_FIELDS,
            },
        )
        for item in payload.get("items", []):
            statistics = item.get("statistics", {})
            uploads = str(
                item.get("contentDetails", {})
                .get("relatedPlaylists", {})
                .get("uploads", "")
            )
            if not uploads:
                continue
            snippet = item.get("snippet", {})
            rows.append(
                {
                    "channel_id": str(item.get("id", "")),
                    "channel_title": str(snippet.get("title", "")),
                    "country": snippet.get("country"),
                    "view_count": int(statistics.get("viewCount", 0)),
                    "subscriber_count": (
                        None
                        if statistics.get("hiddenSubscriberCount")
                        else int(statistics.get("subscriberCount", 0))
                    ),
                    "video_count": int(statistics.get("videoCount", 0)),
                    "uploads_playlist_id": uploads,
                }
            )
    return rows


def ranked_channel_candidates(
    client: YouTubeClient, query: str, pages: int, count: int
) -> list[dict[str, Any]]:
    identities = candidate_channel_ids(client, query, pages)
    if len(identities) < count:
        raise SystemExit(
            f"channel search found {len(identities)} unique IDs; expected at least {count}"
        )
    details = fetch_channel_details(client, identities)
    ranked = sorted(
        details, key=lambda row: (-int(row["view_count"]), row["channel_id"])
    )[:count]
    if len(ranked) != count:
        raise SystemExit(
            f"only {len(ranked)} accessible channels found; expected {count}"
        )
    return [{**row, "rank": rank} for rank, row in enumerate(ranked, 1)]


def discover(args: argparse.Namespace) -> int:
    load_dotenv(ROOT)
    pruned = STORE.prune_expired(materialize=False)
    purge_deleted_versions()
    read_manifest()
    prune_candidate_file()
    operation = STATE.operation()
    started = parse_time(operation.get("started_at"))
    if started and started <= datetime.now(UTC) - timedelta(days=RETENTION_DAYS):
        STATE.reset()
    STORE.materialize(invalidate_on_failure=any(pruned.values()))
    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("YOUTUBE_API_KEY is missing from the environment or repository .env")
    client = YouTubeClient(api_key, args.quota_budget, args.timeout)
    try:
        channels = ranked_channel_candidates(
            client, args.query, args.candidate_pages, args.channel_count
        )
    except BudgetReached:
        print(
            json.dumps(
                {
                    "collector": "youtube_comment_ingest",
                    "mode": "discover",
                    "status": "paused",
                    "reason": "api_call_budget_reached",
                    "api_calls": client.calls,
                },
                sort_keys=True,
            )
        )
        return 75
    except ApiError as exc:
        print(
            json.dumps(
                {
                    "collector": "youtube_comment_ingest",
                    "mode": "discover",
                    "status": "failed",
                    "reason": exc.reason,
                    "api_calls": client.calls,
                },
                sort_keys=True,
            )
        )
        return 1
    refreshed_at = now_iso()
    write_json(
        CANDIDATE_PATH,
        {
            "channel_ids": [row["channel_id"] for row in channels],
            "channels": [
                {
                    **row,
                    "source_url": f"https://www.youtube.com/channel/{row['channel_id']}",
                }
                for row in channels
            ],
            "selection_method": "search_candidates_ranked_by_channel_view_count",
            "selection_query": args.query,
            "refreshed_at": refreshed_at,
            "expires_at": expires_at(refreshed_at),
        },
    )
    print(
        json.dumps(
            {
                "collector": "youtube_comment_ingest",
                "mode": "discover",
                "status": "success",
                "channel_count": len(channels),
                "api_calls": client.calls,
                "output": output_path(CANDIDATE_PATH),
            },
            sort_keys=True,
        )
    )
    return 0


def select_channels(
    client: YouTubeClient, args: argparse.Namespace
) -> tuple[list[dict[str, Any]], set[str], str, str | None]:
    old_manifest = read_manifest()
    old_ids = set(old_manifest.get("channel_ids", []))
    supplied: list[str] | None = args.channel_id
    method = "manual_channel_ids"
    query: str | None = None
    if args.channel_file:
        supplied = load_channel_ids(args.channel_file)
    if supplied:
        selected_ids = list(dict.fromkeys(supplied))
    elif old_manifest:
        selected_ids = list(old_manifest["channel_ids"])
        method = str(old_manifest.get("selection_method", "fixed_manifest"))
        query = old_manifest.get("selection_query")
    elif args.command == "update":
        raise SystemExit("no fixed channel manifest; run backfill or pass --channel-file")
    else:
        raise SystemExit(
            "no reviewed channel list; run discover, review channel_candidates.json, "
            "then pass --channel-file"
        )
    unique_count = len(set(selected_ids))
    if method == "search_candidates_ranked_by_channel_view_count":
        valid_count = unique_count >= args.channel_count
        expected = f"at least {args.channel_count}"
    else:
        valid_count = unique_count == args.channel_count
        expected = str(args.channel_count)
    if not valid_count:
        raise SystemExit(
            f"channel source has {unique_count} unique IDs; expected {expected}"
        )
    details = fetch_channel_details(client, selected_ids)
    ranked = sorted(
        details, key=lambda row: (-int(row["view_count"]), row["channel_id"])
    )[: args.channel_count]
    if len(ranked) != args.channel_count:
        raise SystemExit(
            f"only {len(ranked)} accessible channels found; expected {args.channel_count}"
        )
    refreshed_at = now_iso()
    records = [
        timestamped(
            {
                "record_id": f"youtube:channel:{row['channel_id']}",
                "record_type": "youtube_channel",
                "source": "youtube_data_api",
                **row,
                "rank": rank,
                "selection_method": method,
                "selection_query": query,
                "source_url": f"https://www.youtube.com/channel/{row['channel_id']}",
                "is_deleted": False,
            },
            refreshed_at,
        )
        for rank, row in enumerate(ranked, 1)
    ]
    return records, old_ids, method, query


def normalize_video(
    item: dict[str, Any], channel: dict[str, Any], start: date | None, end: date
) -> dict[str, Any] | None:
    details = item.get("contentDetails", {})
    snippet = item.get("snippet", {})
    identity = str(details.get("videoId", ""))
    published_raw = str(details.get("videoPublishedAt") or snippet.get("publishedAt") or "")
    published = parse_time(published_raw)
    if not identity or item.get("status", {}).get("privacyStatus") not in {None, "public"}:
        return None
    if published and (published.date() > end or (start and published.date() < start)):
        return None
    if not published and start:
        return None
    previous = STORE.get_latest(f"youtube:video:{identity}") or {}
    refreshed_at = now_iso()
    return timestamped(
        {
            "record_id": f"youtube:video:{identity}",
            "record_type": "youtube_video",
            "source": "youtube_data_api",
            "video_id": identity,
            "channel_id": channel["channel_id"],
            "channel_title": channel["channel_title"],
            "title": str(snippet.get("title", "")),
            "published_at": published.isoformat() if published else None,
            "last_full_comment_scan_at": previous.get("last_full_comment_scan_at"),
            "comment_scan_status": previous.get("comment_scan_status"),
            "source_url": f"https://www.youtube.com/watch?v={identity}",
            "is_deleted": False,
        },
        refreshed_at,
    )


def fetch_upload_page(
    client: YouTubeClient,
    channel: dict[str, Any],
    page_token: str | None,
    start: date | None,
    end: date,
) -> tuple[list[dict[str, Any]], str | None]:
    params: dict[str, Any] = {
        "part": "snippet,contentDetails,status",
        "playlistId": channel["uploads_playlist_id"],
        "maxResults": 50,
        "fields": PLAYLIST_FIELDS,
    }
    if page_token:
        params["pageToken"] = page_token
    try:
        payload = client.get("playlistItems", params)
    except ApiError as exc:
        if (
            exc.reason == "playlistNotFound"
            and int(channel.get("video_count", -1)) == 0
        ):
            return [], None
        raise
    rows = [
        record
        for item in payload.get("items", [])
        if (record := normalize_video(item, channel, start, end)) is not None
    ]
    return rows, payload.get("nextPageToken")


def normalize_comment(
    item: dict[str, Any],
    *,
    channel: str,
    video_id: str,
    thread_raw_id: str,
    parent_raw_id: str | None,
    reply_count: int | None,
    salt: str,
    refreshed_at: str,
) -> dict[str, Any] | None:
    snippet = item.get("snippet", {})
    raw_id = str(item.get("id", ""))
    text = redact_personal_data(str(snippet.get("textDisplay", "")).strip())
    if not raw_id or not text:
        return None
    comment_identity = private_id("comment", raw_id, salt)
    return timestamped(
        {
            "record_id": f"youtube:comment:{comment_identity}",
            "record_type": "youtube_comment",
            "source": "youtube_data_api",
            "comment_id": comment_identity,
            "parent_comment_id": (
                private_id("comment", parent_raw_id, salt) if parent_raw_id else None
            ),
            "thread_id": private_id("thread", thread_raw_id, salt),
            "channel_id": channel,
            "video_id": video_id,
            "text": text,
            "like_count": int(snippet.get("likeCount", 0)),
            "reply_count": reply_count,
            "published_at": snippet.get("publishedAt"),
            "updated_at": snippet.get("updatedAt") or snippet.get("publishedAt"),
            "etag": item.get("etag"),
            "is_deleted": False,
            "source_url": f"https://www.youtube.com/watch?v={video_id}",
        },
        refreshed_at,
    )


def comment_record_id(raw_id: str, salt: str) -> str:
    return f"youtube:comment:{private_id('comment', raw_id, salt)}"


def operation_signature(
    args: argparse.Namespace, channel_ids: list[str]
) -> str:
    return sha256(
        {
            "command": args.command,
            "start": args.start.isoformat() if args.start else None,
            "end": args.end.isoformat(),
            "channel_ids": sorted(channel_ids),
        }
    )


def resolve_effective_end(args: argparse.Namespace) -> None:
    args.end_was_default = args.end is None
    if args.end is not None:
        return
    operation = STATE.operation()
    saved = operation.get("effective_end") if not args.restart else None
    args.end = date.fromisoformat(str(saved)) if saved else date.today()


def quick_update_end(args: argparse.Namespace) -> date:
    if args.command == "update" and getattr(args, "end_was_default", False):
        return date.today()
    return args.end


def begin_or_resume_operation(
    args: argparse.Namespace, channels: list[dict[str, Any]]
) -> dict[str, Any]:
    signature = operation_signature(args, [row["channel_id"] for row in channels])
    operation = STATE.operation()
    started = parse_time(operation.get("started_at"))
    expired = started and started <= datetime.now(UTC) - timedelta(days=RETENTION_DAYS)
    if expired:
        STATE.reset()
        operation = {}
    if args.restart and operation:
        STATE.reset()
        operation = {}
    if operation and operation.get("signature") != signature:
        raise SystemExit(
            "an unfinished collection has different parameters; resume it or pass --restart"
        )
    if operation:
        return operation
    STATE.reset()
    STATE.set_channels(channels)
    operation = {
        "operation_id": sha256({"signature": signature, "started_at": now_iso()}),
        "signature": signature,
        "command": args.command,
        "effective_end": args.end.isoformat(),
        "phase": "uploads",
        "started_at": now_iso(),
        "upload_position": 0,
        "upload_page_token": None,
        "upload_started": False,
        "upload_failed_page_token": None,
        "upload_scan_id": None,
        "current_video_id": None,
        "current_channel_id": None,
        "video_started": False,
        "thread_page_token": None,
        "thread_index": 0,
        "reply_page_token": None,
        "thread_failed_page_token": None,
        "video_scan_id": None,
        "reply_failed_page_token": None,
    }
    STATE.save_operation(operation)
    return operation


def channel_map(channels: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {row["channel_id"]: row for row in channels}


def remove_replaced_channels(
    selected_ids: set[str], old_ids: set[str], mode: str, totals: dict[str, int]
) -> None:
    removed = old_ids - selected_ids
    if not removed:
        return
    for block in chunks(
        (
            row
            for row in STORE.iter_latest(is_deleted=False)
            if row.get("channel_id") in removed
        )
    ):
        tombstones = [tombstone(row, "channel_manifest_replaced") for row in block]
        merge_rows(tombstones, mode, totals)
        STORE.purge_versions(
            (row["record_id"] for row in tombstones), materialize=False
        )


def finalize_missing_video(
    video: dict[str, Any], mode: str, totals: dict[str, int], scan_id: str
) -> None:
    will_delete = (
        int(video.get("missing_scan_count", 0)) >= 1
        and video.get("last_missing_scan_id") != scan_id
    )
    if will_delete:
        for block in chunks(STATE.comments_for_video(str(video["video_id"]))):
            tombstones = [tombstone(row, "parent_video_deleted") for row in block]
            merge_rows(tombstones, mode, totals)
            STORE.purge_versions(
                (row["record_id"] for row in tombstones), materialize=False
            )
    deleted = apply_absence(
        [video], "not_returned_by_uploads_playlist", mode, totals, scan_id
    )
    if will_delete and not deleted:
        raise RuntimeError("confirmed missing video was not tombstoned")


def run_upload_phase(
    client: YouTubeClient,
    args: argparse.Namespace,
    channels: dict[str, dict[str, Any]],
    totals: dict[str, int],
) -> dict[str, Any]:
    operation = STATE.operation()
    while operation.get("phase") == "uploads":
        current = STATE.channel_at(int(operation["upload_position"]))
        if current is None:
            cutoff = (datetime.now(UTC) - timedelta(days=args.refresh_cycle_days)).isoformat()
            STATE.fill_video_queue(args.command, args.start, args.end, cutoff)
            operation |= {
                "phase": "comments",
                "current_video_id": None,
                "current_channel_id": None,
                "video_started": False,
            }
            STATE.save_operation(operation)
            return operation
        channel = channels[current["channel_id"]]
        if not operation.get("upload_started"):
            STATE.clear_upload_seen(channel["channel_id"])
            operation |= {
                "upload_started": True,
                "upload_page_token": None,
                "upload_failed_page_token": None,
                "upload_scan_id": sha256(
                    {
                        "operation_id": operation["operation_id"],
                        "channel_id": channel["channel_id"],
                        "started_at": now_iso(),
                    }
                ),
            }
            STATE.save_operation(operation)
        requested_token = operation.get("upload_page_token")
        try:
            rows, next_page = fetch_upload_page(
                client,
                channel,
                operation.get("upload_page_token"),
                args.start,
                args.end,
            )
        except ApiError as exc:
            failed_token = str(requested_token or "__first_page__")
            if (
                exc.reason == "invalidPageToken"
                and operation.get("upload_failed_page_token") != failed_token
            ):
                STATE.clear_upload_seen(channel["channel_id"])
                operation["upload_page_token"] = None
                operation["upload_failed_page_token"] = failed_token
                STATE.save_operation(operation)
                continue
            raise
        if operation.get("upload_failed_page_token") == str(
            requested_token or "__first_page__"
        ):
            operation["upload_failed_page_token"] = None
        merge_rows(rows, f"{args.command}_uploads", totals)
        STATE.mark_upload_seen(channel["channel_id"], (row["video_id"] for row in rows))
        if next_page:
            if str(next_page) == operation.get("upload_page_token"):
                raise ApiError(500, "repeatedPageToken")
            operation["upload_page_token"] = str(next_page)
            STATE.save_operation(operation)
            continue
        for video in STATE.unseen_videos(channel["channel_id"], args.start, args.end):
            finalize_missing_video(
                video,
                f"{args.command}_uploads",
                totals,
                str(operation["upload_scan_id"]),
            )
        STATE.clear_upload_seen(channel["channel_id"])
        operation["upload_position"] += 1
        operation["upload_page_token"] = None
        operation["upload_started"] = False
        operation["upload_failed_page_token"] = None
        operation["upload_scan_id"] = None
        STATE.save_operation(operation)
    return operation


def quick_update(
    client: YouTubeClient,
    args: argparse.Namespace,
    channels: list[dict[str, Any]],
    salt: str,
    totals: dict[str, int],
) -> None:
    if args.command != "update" or args.quick_pages == 0:
        return
    operation = STATE.operation()
    current_end = quick_update_end(args)
    for channel in channels:
        page_token: str | None = None
        for _ in range(args.quick_pages):
            rows, page_token = fetch_upload_page(
                client, channel, page_token, args.start, current_end
            )
            priority_ids = [
                row["video_id"]
                for row in rows
                if (
                    (previous := STORE.get_latest(row["record_id"])) is None
                    or previous.get("is_deleted")
                    or previous.get("last_full_comment_scan_at") is None
                )
            ]
            merge_rows(rows, "update_quick_uploads", totals)
            if operation.get("phase") == "comments":
                for identity in priority_ids:
                    STATE.add_priority_video(identity, channel["channel_id"])
            if not page_token:
                break
        params: dict[str, Any] = {
            "part": "snippet",
            "allThreadsRelatedToChannelId": channel["channel_id"],
            "maxResults": 100,
            "order": "time",
            "textFormat": "plainText",
            "fields": THREAD_FIELDS,
        }
        try:
            payload = client.get("commentThreads", params)
        except ApiError as exc:
            if exc.reason in {"commentsDisabled", "forbidden"}:
                continue
            raise
        refreshed_at = now_iso()
        comments: list[dict[str, Any]] = []
        for thread in payload.get("items", []):
            snippet = thread.get("snippet", {})
            video_id = str(snippet.get("videoId", ""))
            video = STORE.get_latest(f"youtube:video:{video_id}")
            if not video or not video_in_range(video, args.start, current_end):
                continue
            top = snippet.get("topLevelComment", {})
            record = normalize_comment(
                top,
                channel=channel["channel_id"],
                video_id=video_id,
                thread_raw_id=str(thread.get("id", "")),
                parent_raw_id=None,
                reply_count=int(snippet.get("totalReplyCount", 0)),
                salt=salt,
                refreshed_at=refreshed_at,
            )
            if record:
                comments.append(record)
        merge_rows(comments, "update_quick_comments", totals)


def reset_current_video(operation: dict[str, Any]) -> dict[str, Any]:
    STATE.clear_comment_seen()
    unlink_thread_page()
    operation |= {
        "current_video_id": None,
        "current_channel_id": None,
        "video_started": False,
        "thread_page_token": None,
        "thread_index": 0,
        "reply_page_token": None,
        "thread_failed_page_token": None,
        "reply_failed_page_token": None,
        "video_scan_id": None,
    }
    return operation


def begin_video(operation: dict[str, Any], video: dict[str, str]) -> dict[str, Any]:
    STATE.clear_comment_seen()
    unlink_thread_page()
    operation |= {
        "current_video_id": video["video_id"],
        "current_channel_id": video["channel_id"],
        "video_started": True,
        "thread_page_token": None,
        "thread_index": 0,
        "reply_page_token": None,
        "thread_failed_page_token": None,
        "reply_failed_page_token": None,
        "video_scan_id": sha256(
            {
                "operation_id": operation["operation_id"],
                "video_id": video["video_id"],
                "started_at": now_iso(),
            }
        ),
    }
    STATE.save_operation(operation)
    return operation


def stage_thread_page(
    client: YouTubeClient, operation: dict[str, Any]
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "part": "snippet",
        "videoId": operation["current_video_id"],
        "maxResults": 100,
        "order": "time",
        "textFormat": "plainText",
        "fields": THREAD_FIELDS,
    }
    if operation.get("thread_page_token"):
        params["pageToken"] = operation["thread_page_token"]
    requested_token = operation.get("thread_page_token")
    payload = client.get("commentThreads", params)
    if operation.get("thread_failed_page_token") == str(
        requested_token or "__first_page__"
    ):
        operation["thread_failed_page_token"] = None
    page = {
        "fetched_at": now_iso(),
        "items": payload.get("items", []),
        "next_page_token": payload.get("nextPageToken"),
    }
    write_json(THREAD_PAGE_PATH, page)
    operation["thread_index"] = 0
    operation["reply_page_token"] = None
    operation["reply_failed_page_token"] = None
    STATE.save_operation(operation)
    return page


def process_reply_pages(
    client: YouTubeClient,
    operation: dict[str, Any],
    thread: dict[str, Any],
    salt: str,
    totals: dict[str, int],
    mode: str,
) -> bool:
    snippet = thread.get("snippet", {})
    top = snippet.get("topLevelComment", {})
    raw_parent = str(top.get("id", ""))
    raw_thread = str(thread.get("id", ""))
    if not raw_parent:
        return True
    while True:
        params: dict[str, Any] = {
            "part": "snippet",
            "parentId": raw_parent,
            "maxResults": 100,
            "textFormat": "plainText",
            "fields": REPLY_FIELDS,
        }
        if operation.get("reply_page_token"):
            params["pageToken"] = operation["reply_page_token"]
        requested_token = operation.get("reply_page_token")
        try:
            payload = client.get("comments", params)
        except ApiError as exc:
            failed_token = str(requested_token or "__first_page__")
            if (
                exc.reason == "invalidPageToken"
                and operation.get("reply_failed_page_token") != failed_token
            ):
                operation["reply_page_token"] = None
                operation["reply_failed_page_token"] = failed_token
                STATE.save_operation(operation)
                continue
            if exc.reason in {"commentNotFound", "forbidden"}:
                STATE.preserve_thread(
                    operation["current_video_id"], private_id("thread", raw_thread, salt)
                )
                operation["reply_page_token"] = None
                operation["reply_failed_page_token"] = None
                STATE.save_operation(operation)
                return True
            raise
        if operation.get("reply_failed_page_token") == str(
            requested_token or "__first_page__"
        ):
            operation["reply_failed_page_token"] = None
        refreshed_at = now_iso()
        rows: list[dict[str, Any]] = []
        seen: list[str] = []
        for item in payload.get("items", []):
            raw_id = str(item.get("id", ""))
            if raw_id:
                seen.append(comment_record_id(raw_id, salt))
            record = normalize_comment(
                item,
                channel=operation["current_channel_id"],
                video_id=operation["current_video_id"],
                thread_raw_id=raw_thread,
                parent_raw_id=raw_parent,
                reply_count=None,
                salt=salt,
                refreshed_at=refreshed_at,
            )
            if record:
                rows.append(record)
        merge_rows(rows, mode, totals)
        STATE.mark_comment_seen(seen)
        next_page = payload.get("nextPageToken")
        if next_page and str(next_page) == operation.get("reply_page_token"):
            raise ApiError(500, "repeatedPageToken")
        operation["reply_page_token"] = str(next_page) if next_page else None
        STATE.save_operation(operation)
        if not next_page:
            return True


def complete_video_scan(
    operation: dict[str, Any], mode: str, totals: dict[str, int], status: str
) -> dict[str, Any]:
    video_id = str(operation["current_video_id"])
    if status == "complete":
        apply_absence(
            STATE.unseen_comments(video_id),
            "not_returned_by_complete_video_scan",
            mode,
            totals,
            str(operation["video_scan_id"]),
        )
    video = STORE.get_latest(f"youtube:video:{video_id}")
    if video:
        updated = record_without_store_fields(video) | {
            "last_full_comment_scan_at": now_iso(),
            "comment_scan_status": status,
        }
        merge_rows([updated], mode, totals)
    STATE.complete_video(video_id)
    operation = reset_current_video(operation)
    STATE.save_operation(operation)
    return operation


def run_comment_phase(
    client: YouTubeClient,
    args: argparse.Namespace,
    salt: str,
    totals: dict[str, int],
) -> tuple[dict[str, Any], bool]:
    operation = STATE.operation()
    while operation.get("phase") == "comments":
        video = STATE.next_video(operation.get("current_video_id"))
        if video is None:
            cutoff = (datetime.now(UTC) - timedelta(days=args.refresh_cycle_days)).isoformat()
            stale = STATE.stale_video_count(args.start, args.end, cutoff)
            if stale:
                queued = STATE.fill_video_queue(
                    "backfill", args.start, args.end, cutoff
                )
                operation = reset_current_video(operation)
                STATE.save_operation(operation)
                if queued:
                    continue
                return operation, False
            STATE.reset()
            return {}, True
        if (
            operation.get("current_video_id")
            and video["video_id"] != operation.get("current_video_id")
        ):
            operation = reset_current_video(operation)
            STATE.save_operation(operation)
        if not operation.get("video_started"):
            operation = begin_video(operation, video)
        page = read_json(THREAD_PAGE_PATH, {})
        if not page:
            try:
                page = stage_thread_page(client, operation)
            except ApiError as exc:
                if exc.reason in {"commentsDisabled", "forbidden", "videoNotFound"}:
                    operation = complete_video_scan(
                        operation, f"{args.command}_comments", totals, "unavailable"
                    )
                    continue
                if (
                    exc.reason == "invalidPageToken"
                    and operation.get("thread_failed_page_token")
                    != str(operation.get("thread_page_token") or "__first_page__")
                ):
                    STATE.clear_comment_seen()
                    unlink_thread_page()
                    operation["thread_failed_page_token"] = str(
                        operation.get("thread_page_token") or "__first_page__"
                    )
                    operation["thread_page_token"] = None
                    operation["thread_index"] = 0
                    operation["reply_page_token"] = None
                    operation["reply_failed_page_token"] = None
                    STATE.save_operation(operation)
                    continue
                raise
        items = page.get("items", [])
        index = int(operation.get("thread_index", 0))
        if index >= len(items):
            next_page = page.get("next_page_token")
            unlink_thread_page()
            if next_page:
                if str(next_page) == operation.get("thread_page_token"):
                    raise ApiError(500, "repeatedPageToken")
                operation["thread_page_token"] = str(next_page)
                operation["thread_index"] = 0
                operation["reply_page_token"] = None
                operation["reply_failed_page_token"] = None
                STATE.save_operation(operation)
                continue
            operation = complete_video_scan(
                operation, f"{args.command}_comments", totals, "complete"
            )
            continue
        thread = items[index]
        snippet = thread.get("snippet", {})
        top = snippet.get("topLevelComment", {})
        raw_top_id = str(top.get("id", ""))
        raw_thread_id = str(thread.get("id", ""))
        if raw_top_id:
            STATE.mark_comment_seen([comment_record_id(raw_top_id, salt)])
        record = normalize_comment(
            top,
            channel=operation["current_channel_id"],
            video_id=operation["current_video_id"],
            thread_raw_id=raw_thread_id,
            parent_raw_id=None,
            reply_count=int(snippet.get("totalReplyCount", 0)),
            salt=salt,
            refreshed_at=str(page["fetched_at"]),
        )
        if record:
            merge_rows([record], f"{args.command}_comments", totals)
        if int(snippet.get("totalReplyCount", 0)) > 0:
            process_reply_pages(
                client,
                operation,
                thread,
                salt,
                totals,
                f"{args.command}_comments",
            )
        operation["thread_index"] = index + 1
        operation["reply_page_token"] = None
        operation["reply_failed_page_token"] = None
        STATE.save_operation(operation)
    return operation, False


def output_path(path: Path = OUTPUT_ROOT) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def ensure_salt_fingerprint(salt: str) -> None:
    fingerprint = sha256({"youtube_id_hash_salt": salt})
    existing = read_json(SALT_FINGERPRINT_PATH, {})
    if existing and existing.get("fingerprint") != fingerprint:
        raise SystemExit(
            "YOUTUBE_ID_HASH_SALT differs from the salt used by existing data"
        )
    if not existing:
        write_json(SALT_FINGERPRINT_PATH, {"fingerprint": fingerprint})


def purge_deleted_versions() -> None:
    for block in chunks(STORE.iter_latest(is_deleted=True)):
        STORE.purge_versions(
            (row["record_id"] for row in block), materialize=False
        )


def collect(args: argparse.Namespace) -> int:
    load_dotenv(ROOT)
    pruned = STORE.prune_expired(materialize=False)
    purge_deleted_versions()
    read_manifest()
    prune_candidate_file()
    operation = STATE.operation()
    started = parse_time(operation.get("started_at"))
    if started and started <= datetime.now(UTC) - timedelta(days=RETENTION_DAYS):
        STATE.reset()
    resolve_effective_end(args)
    STORE.materialize(invalidate_on_failure=any(pruned.values()))

    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    salt = os.getenv("YOUTUBE_ID_HASH_SALT", "").strip()
    if not api_key:
        raise SystemExit("YOUTUBE_API_KEY is missing from the environment or repository .env")
    if len(salt) < 32:
        raise SystemExit("YOUTUBE_ID_HASH_SALT must contain at least 32 characters")
    ensure_salt_fingerprint(salt)
    if args.start and args.start > args.end:
        raise SystemExit("--start cannot be later than --end")

    client = YouTubeClient(api_key, args.quota_budget, args.timeout)
    totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}
    status = "success"
    reason: str | None = None
    failures: list[str] = []
    completed = False

    try:
        channels, old_ids, method, query = select_channels(client, args)
        selected_ids = {row["channel_id"] for row in channels}
        operation = begin_or_resume_operation(args, channels)
        save_manifest([row["channel_id"] for row in channels], method, query)
        merge_rows(channels, f"{args.command}_channels", totals)
        remove_replaced_channels(
            selected_ids, old_ids, f"{args.command}_channels", totals
        )
        quick_update(client, args, channels, salt, totals)
        operation = run_upload_phase(client, args, channel_map(channels), totals)
        if operation.get("phase") == "comments":
            _, completed = run_comment_phase(client, args, salt, totals)
        if not completed:
            status = "paused"
            reason = "refresh_cycle_incomplete"
    except BudgetReached:
        status = "paused"
        reason = "api_call_budget_reached"
    except ApiError as exc:
        if exc.reason in {"quotaExceeded", "dailyLimitExceeded"}:
            status = "paused"
            reason = exc.reason
        else:
            status = "failed"
            failures.append(exc.reason)
    except SystemExit:
        status = "failed"
        reason = "configuration_error"
        failures.append("SystemExit")
        raise
    except KeyboardInterrupt:
        status = "failed"
        reason = "interrupted"
        failures.append("KeyboardInterrupt")
        raise
    except Exception as exc:
        status = "failed"
        reason = "internal_error"
        failures.append(type(exc).__name__)
        raise
    finally:
        result = {
            "collector": "youtube_comment_ingest",
            "mode": args.command,
            "status": status,
            "reason": reason,
            "api_calls": client.calls,
            "quota_budget": client.max_calls,
            "remaining_video_scans": STATE.remaining_videos(),
            **totals,
            "failures": failures,
            "output": output_path(),
        }
        STORE.record_run(result, materialize=False)
        STORE.materialize()

    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 75 if status == "paused" else (1 if status == "failed" else 0)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    discovery = subparsers.add_parser("discover")
    discovery.add_argument("--channel-count", type=int, default=30)
    discovery.add_argument("--query", default=DEFAULT_QUERY)
    discovery.add_argument("--candidate-pages", type=int, default=10)
    discovery.add_argument("--quota-budget", type=int, default=9000)
    discovery.add_argument("--timeout", type=int, default=30)
    for command in ("backfill", "update"):
        child = subparsers.add_parser(command)
        child.add_argument(
            "--start", type=date.fromisoformat, help="optional video publish-date floor"
        )
        child.add_argument("--end", type=date.fromisoformat)
        child.add_argument("--channel-count", type=int, default=30)
        source = child.add_mutually_exclusive_group()
        source.add_argument("--channel-id", action="append", type=channel_id)
        source.add_argument("--channel-file", type=Path)
        child.add_argument("--restart", action="store_true")
        child.add_argument("--query", default=DEFAULT_QUERY)
        child.add_argument("--candidate-pages", type=int, default=10)
        child.add_argument("--quota-budget", type=int, default=9000)
        child.add_argument("--quick-pages", type=int, default=1)
        child.add_argument("--refresh-cycle-days", type=int, default=REFRESH_CYCLE_DAYS)
        child.add_argument("--timeout", type=int, default=30)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not 1 <= args.channel_count <= 50:
        raise SystemExit("--channel-count must be between 1 and 50")
    if not 1 <= args.candidate_pages <= 10:
        raise SystemExit("--candidate-pages must be between 1 and 10")
    if args.quota_budget < 1 or args.timeout < 1:
        raise SystemExit("quota budget and timeout must be positive")
    if args.command == "discover":
        return discover(args)
    if not 0 <= args.quick_pages <= 10:
        raise SystemExit("--quick-pages must be between 0 and 10")
    if not 1 <= args.refresh_cycle_days < RETENTION_DAYS:
        raise SystemExit(f"--refresh-cycle-days must be between 1 and {RETENTION_DAYS - 1}")
    return collect(args)


if __name__ == "__main__":
    sys.exit(main())
