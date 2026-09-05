#!/usr/bin/env python3
"""Import exports from apify/instagram-comment-scraper or xquik/x-tweet-scraper.

This reads local JSON/JSONL only; it never runs an Actor or calls PostgreSQL.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from typing import Any, Iterable, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

try:
    from ._indexed_jsonl_store import IndexedJsonlStore
    from ._jsonl_store import canonical_json, load_dotenv, sha256, utc_now
except ImportError:
    from _indexed_jsonl_store import IndexedJsonlStore
    from _jsonl_store import canonical_json, load_dotenv, sha256, utc_now


ROOT = Path(__file__).resolve().parents[1]
ACTORS = {
    "instagram": "apify/instagram-comment-scraper",
    "x": "xquik/x-tweet-scraper",
}
ACTOR_IDS = {
    "instagram": "SbK00X0JYCPblD2wp",
    "x": "wAusCMrm284Voaw86",
}
APIFY_API_ROOT = "https://api.apify.com/v2"
TERMINAL_RUN_STATES = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}
# Keep the YouTube privacy rules without importing its write-on-import global stores.
EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)")
IP_RE = re.compile(r"(?<!\d)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?!\d)")
MENTION_RE = re.compile(r"(?<!\w)@[A-Za-z0-9_.]+")


def private_id(platform: str, kind: str, value: str, salt: str) -> str:
    digest = hmac.new(salt.encode(), f"{platform}:{kind}\0{value}".encode(), hashlib.sha256)
    return f"hmac-sha256:{digest.hexdigest()}"


def identifier(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value).strip()
    return text if re.fullmatch(r"[0-9]+", text) and text.strip("0") else None


def post_source(platform: str, value: Any) -> tuple[str, str] | None:
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        host = url.hostname
    except ValueError:
        return None
    if url.scheme not in {"http", "https"} or url.username or url.password:
        return None
    if platform == "instagram" and host in {"instagram.com", "www.instagram.com"}:
        match = re.match(r"^/(p|reel|tv)/([A-Za-z0-9_-]+)(?:/|$)", url.path)
        if match:
            return f"https://www.instagram.com/{match[1]}/{match[2]}/", match[2]
    if platform == "x" and host in {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}:
        match = re.fullmatch(r"/(?:[A-Za-z0-9_]+|i/web)/status/([0-9]+)/?", url.path)
        if match and identifier(match[1]):
            return f"https://x.com/i/status/{match[1]}", match[1]
    return None


def published_time(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("missing_date")
    try:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            parsed = parsedate_to_datetime(value)
        return (parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)).isoformat()
    except (ValueError, TypeError, OverflowError):
        raise ValueError("invalid_date") from None


def metric(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not re.fullmatch(r"[0-9]+", str(value)):
        raise ValueError("invalid_metric")
    return int(value)


def export_rows(path: Path, errors: Counter[str]) -> Iterator[Any]:
    with path.open(encoding="utf-8-sig") as handle:
        if path.suffix.lower() in {".jsonl", ".ndjson"}:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    errors["invalid_json_line"] += 1
        else:
            try:
                payload = json.load(handle)
            except json.JSONDecodeError:
                raise ValueError("Invalid JSON export; use .jsonl or .ndjson for line-delimited input") from None
            yield from payload if isinstance(payload, list) else [payload]


def normalize_comment(
    item: Any, *, platform: str, salt: str, refreshed_at: str,
    source: tuple[str, str] | None = None, parent_id: str | None = None,
    thread_id: str | None = None,
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        raise ValueError("invalid_row")
    if item.get("error") or item.get("result.error") or (isinstance(item.get("result"), dict) and item["result"].get("error")):
        raise ValueError("actor_error")
    raw_id = identifier(item.get("id"))
    if not raw_id:
        raise ValueError("missing_or_invalid_id")
    if platform == "x":
        if item.get("type", "tweet") not in ("tweet", "reply") or item.get("isRetweet") is True:
            return None
        parent_id = identifier(item.get("inReplyToId"))
        if item.get("isReply") is not True and not parent_id:
            return None
        if item.get("inReplyToId") is not None and item.get("inReplyToId") != "" and parent_id is None:
            raise ValueError("invalid_parent_id")
        conversation = identifier(item.get("conversationId"))
        if conversation == raw_id or (source and source[1] == raw_id):
            return None
        if conversation:
            if source and source[1] != conversation:
                raise ValueError("source_mismatch")
            source = (f"https://x.com/i/status/{conversation}", conversation)
        thread_id = source[1] if source else None
    else:
        supplied = post_source(platform, item.get("postUrl")) or post_source(platform, item.get("url"))
        if supplied and source and supplied[1] != source[1]:
            raise ValueError("source_mismatch")
        source = supplied or source
        thread_id = thread_id or raw_id
        if item.get("replies") is not None and not isinstance(item["replies"], list):
            raise ValueError("invalid_replies")
    if source is None:
        raise ValueError("missing_post_source")
    text = item.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("missing_text")
    text = EMAIL_RE.sub("[REDACTED_EMAIL]", text.strip())
    text = PHONE_RE.sub("[REDACTED_PHONE]", text)
    text = IP_RE.sub("[REDACTED_IP]", text)
    text = MENTION_RE.sub("[REDACTED_MENTION]", text)
    published = published_time(item.get("timestamp" if platform == "instagram" else "createdAt"))
    identity = private_id(platform, "comment", raw_id, salt)
    return {
        "record_id": f"{platform}:comment:{identity}",
        "record_type": f"{platform}_comment", "source": "apify",
        "category": "community_v2", "tags": {"source": platform},
        "actor_id": ACTORS[platform], "comment_id": identity,
        "parent_comment_id": private_id(platform, "comment", parent_id, salt) if parent_id else None,
        "thread_id": private_id(platform, "thread", thread_id, salt) if thread_id else None,
        "post_id": (identifier(item.get("postId")) or source[1]) if platform == "instagram" else source[1],
        "source_url": source[0], "text": text,
        "like_count": metric(item.get("likesCount" if platform == "instagram" else "likeCount")),
        "reply_count": metric(item.get("repliesCount" if platform == "instagram" else "replyCount")),
        "published_at": published, "updated_at": published, "is_deleted": False,
        "refreshed_at": refreshed_at,
        "expires_at": (datetime.fromisoformat(refreshed_at) + timedelta(days=29)).isoformat(),
    }


def selected_company(path: Path, stock_code: str | None) -> dict[str, str] | None:
    if stock_code is None:
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        companies = payload["companies"]
        matches = [row for row in companies if row.get("stock_code") == stock_code]
        company = matches[0] if len(matches) == 1 else {}
        name = company.get("company_name")
        query = company.get("search_query") or name
        if not re.fullmatch(r"[0-9]{6}", stock_code) or not isinstance(name, str) or not name.strip() or not isinstance(query, str) or not query.strip():
            raise ValueError
    except (KeyError, TypeError, AttributeError, ValueError):
        raise ValueError("--stock-code must identify exactly one valid company in --company-file") from None
    return {"company_name": name.strip(), "stock_code": stock_code, "search_query": query.strip()}


def preserve_context(record: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    if record["record_type"] == "instagram_comment" and not record["parent_comment_id"] and previous.get("parent_comment_id"):
        record["parent_comment_id"] = previous["parent_comment_id"]
        record["thread_id"] = previous["thread_id"]
    for field in ("search_tags", "search_matches"):
        values = {canonical_json(value): value for value in [*previous.get(field, []), *record.get(field, [])]}
        if values:
            record[field] = [values[key] for key in sorted(values)]
    return record


def top_comments(records: Iterable[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Select this export's top comments without changing earlier stored records."""
    posts: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        posts.setdefault(record["source_url"], []).append(record)
    selected = []
    for candidates in posts.values():
        ranked = sorted(candidates, key=lambda row: (
            row["like_count"], row["published_at"], row["record_id"],
        ), reverse=True)
        selected.extend(
            {**row, "top5_only": limit == 5, "selection_scope": "collected_comments",
             "post_like_rank": rank, "comments_per_post": limit}
            for rank, row in enumerate(ranked[:limit], 1)
        )
    return selected


def check_salt(output_root: Path, salt: str, *, write: bool) -> None:
    path = output_root / "salt_fingerprint.json"
    expected = {"fingerprint": sha256({"community_id_hash_salt": salt})}
    if path.exists():
        if json.loads(path.read_text(encoding="utf-8")) != expected:
            raise ValueError("ID hash salt differs from the salt used by existing Apify data")
    elif write:
        output_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            check_salt(output_root, salt, write=False)
        else:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(canonical_json(expected) + "\n")


def import_export(
    input_path: Path, *, platform: str, output_root: Path, salt: str,
    post_url: str | None = None, search_tags: Iterable[str] = (),
    company: dict[str, str] | None = None, dry_run: bool = False,
    comments_per_post: int = 5, run_mode: str | None = None,
) -> dict[str, Any]:
    if platform not in ACTORS:
        raise ValueError("Unsupported platform")
    if len(salt) < 32:
        raise ValueError("COMMUNITY_ID_HASH_SALT or YOUTUBE_ID_HASH_SALT must contain at least 32 characters")
    if isinstance(comments_per_post, bool) or not isinstance(comments_per_post, int) or not 1 <= comments_per_post <= 5:
        raise ValueError("--comments-per-post must be between 1 and 5")
    source = post_source(platform, post_url)
    if post_url is not None and source is None:
        raise ValueError("--post-url must be a public post URL for the selected platform")
    check_salt(output_root, salt, write=False)
    errors: Counter[str] = Counter()
    stats: Counter[str] = Counter(input_rows=0, processed_rows=0, skipped_originals=0, duplicate_rows=0)
    records: dict[str, dict[str, Any]] = {}
    refreshed_at = utc_now()
    search_tags = list(search_tags)
    # ponytail: one export is held in memory to deduplicate nested replies; stream to a staging DB for huge exports.
    for row in export_rows(input_path, errors):
        stats["input_rows"] += 1
        stack = [(row, source, None, None)]
        while stack:
            item, parent_source, parent, thread = stack.pop()
            stats["processed_rows"] += 1
            try:
                record = normalize_comment(item, platform=platform, salt=salt, refreshed_at=refreshed_at, source=parent_source, parent_id=parent, thread_id=thread)
            except ValueError as exc:
                errors[str(exc)] += 1
                continue
            if record is None:
                stats["skipped_originals"] += 1
                continue
            tags = [tag.strip() for tag in search_tags if tag.strip()]
            if company:
                tags.append(company["company_name"])
                record["search_matches"] = [company]
            if tags:
                record["search_tags"] = sorted(set(tags))
            identity = record["record_id"]
            if identity in records:
                stats["duplicate_rows"] += 1
                record = preserve_context(record, records[identity])
            records[identity] = record
            if platform == "instagram":
                child_source = post_source(platform, record["source_url"])
                raw_id = identifier(item["id"])
                stack.extend((reply, child_source, raw_id, thread or raw_id) for reply in reversed(item.get("replies") or []))
    selected = top_comments(records.values(), comments_per_post)
    summary: dict[str, Any] = {
        "platform": platform, "dry_run": dry_run, **stats,
        "valid_records": len(records), "invalid_records": sum(errors.values()),
        "errors": dict(sorted(errors.items())),
        "selected_records": len(selected), "outside_top_records": len(records) - len(selected),
        "comments_per_post": comments_per_post, "selection_scope": "collected_comments",
    }
    if records and not dry_run:
        check_salt(output_root, salt, write=True)
        store = IndexedJsonlStore(output_root)
        # Repeated company-specific exports can overlap; retain known search matches.
        def incoming() -> Iterator[dict[str, Any]]:
            for record in selected:
                previous = store.get_latest(record["record_id"])
                yield preserve_context(record, previous) if previous else record
        operation = run_mode or f"import_{platform}"
        summary.update(store.merge(incoming(), collector="apify_comment_ingest", mode=operation, volatile_fields=("refreshed_at", "expires_at"), refresh_unchanged=True, log_run=False, materialize=False))
        summary["pruned"] = store.prune_expired(materialize=False)
        store.record_run(
            {"collector": "apify_comment_ingest", "mode": operation,
             "status": "partial" if errors else "success", **summary},
            materialize=False,
        )
        store.materialize(invalidate_on_failure=any(summary["pruned"].values()))
    return summary


def apify_json(
    path: str, *, token: str, method: str = "GET", body: dict[str, Any] | None = None,
) -> Any:
    data = None if body is None else json.dumps(body).encode()
    request = Request(
        f"{APIFY_API_ROOT}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=70) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f"Apify API {method} {path.split('?')[0]} failed: HTTP {exc.code}") from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Apify API {method} {path.split('?')[0]} failed: {type(exc).__name__}") from exc


def run_actor(
    platform: str, actor_input: dict[str, Any], *, token: str,
    max_cost_usd: float, timeout_seconds: int,
) -> list[dict[str, Any]]:
    if not 0 < max_cost_usd <= 5:
        raise ValueError("Actor maximum cost must be greater than 0 and at most $5")
    query = urlencode({
        "timeout": timeout_seconds,
        "waitForFinish": 60,
        "maxTotalChargeUsd": f"{max_cost_usd:.2f}",
    })
    payload = apify_json(
        f"/acts/{ACTOR_IDS[platform]}/runs?{query}", token=token,
        method="POST", body=actor_input,
    )
    run = payload.get("data", {}) if isinstance(payload, dict) else {}
    run_id = run.get("id")
    if not isinstance(run_id, str) or not run_id:
        raise RuntimeError(f"Apify {platform} Actor response has no run id")
    deadline = time.monotonic() + timeout_seconds + 30
    while run.get("status") not in TERMINAL_RUN_STATES and time.monotonic() < deadline:
        time.sleep(2)
        payload = apify_json(f"/actor-runs/{run_id}", token=token)
        run = payload.get("data", {}) if isinstance(payload, dict) else {}
    if run.get("status") != "SUCCEEDED":
        raise RuntimeError(f"Apify {platform} Actor ended with status {run.get('status', 'UNKNOWN')}")
    dataset_id = run.get("defaultDatasetId")
    if not isinstance(dataset_id, str) or not dataset_id:
        raise RuntimeError(f"Apify {platform} Actor response has no dataset id")
    rows = apify_json(f"/datasets/{dataset_id}/items?clean=true&format=json", token=token)
    if not isinstance(rows, list):
        raise RuntimeError(f"Apify {platform} dataset is not a JSON array")
    return [row for row in rows if isinstance(row, dict)]


def load_targets(path: Path, company_file: Path) -> dict[str, list[dict[str, Any]]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid targets file: {path}") from exc
    result: dict[str, list[dict[str, Any]]] = {"instagram": [], "x": []}
    for platform in result:
        rows = payload.get(platform) if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise ValueError(f"Targets file must contain a {platform} array")
        for row in rows:
            source = post_source(platform, row.get("url") if isinstance(row, dict) else None)
            codes = row.get("stock_codes") if isinstance(row, dict) else None
            if source is None or not isinstance(codes, list) or not codes:
                raise ValueError(f"Invalid {platform} target")
            companies = [selected_company(company_file, str(code)) for code in codes]
            result[platform].append({"source": source, "companies": companies})
    return result


def safe_export_row(platform: str, row: dict[str, Any]) -> dict[str, Any]:
    fields = (
        ("id", "text", "timestamp", "likesCount", "repliesCount", "postUrl")
        if platform == "instagram" else
        ("id", "text", "createdAt", "likeCount", "replyCount", "isReply",
         "inReplyToId", "conversationId", "type", "isRetweet")
    )
    safe = {field: row.get(field) for field in fields}
    text = safe.get("text")
    if isinstance(text, str):
        safe["text"] = MENTION_RE.sub(
            "[REDACTED_MENTION]",
            IP_RE.sub("[REDACTED_IP]", PHONE_RE.sub("[REDACTED_PHONE]", EMAIL_RE.sub("[REDACTED_EMAIL]", text))),
        )
    return safe


def collect_api(
    *, mode: str, targets_file: Path, company_file: Path, output_root: Path,
    salt: str, token: str, platforms: Iterable[str], instagram_limit: int,
    x_limit: int, instagram_max_cost_usd: float, x_max_cost_usd: float,
    timeout_seconds: int, dry_run: bool,
) -> dict[str, Any]:
    targets = load_targets(targets_file, company_file)
    selected_platforms = list(platforms)
    if dry_run:
        return {"mode": mode, "dry_run": True, "platforms": {
            platform: {"posts": len(targets[platform]),
                       "company_links": sum(len(row["companies"]) for row in targets[platform])}
            for platform in selected_platforms
        }}
    if len(token) < 20:
        raise ValueError("APIFY_TOKEN is missing or invalid")
    summaries: dict[str, Any] = {}
    for platform in selected_platforms:
        platform_targets = targets[platform]
        if platform == "instagram":
            actor_input = {
                "directUrls": [row["source"][0] for row in platform_targets],
                "resultsLimit": instagram_limit,
                "includeNestedComments": False,
            }
            max_cost = instagram_max_cost_usd
        else:
            actor_input = {
                "mode": "replies",
                "replyTweetIds": [row["source"][1] for row in platform_targets],
                "maxItems": len(platform_targets) * x_limit,
                "maxItemsPerTarget": x_limit,
                "outputVariant": "legacy",
            }
            max_cost = x_max_cost_usd
        rows = run_actor(
            platform, actor_input, token=token, max_cost_usd=max_cost,
            timeout_seconds=timeout_seconds,
        )
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            if platform == "instagram":
                source = post_source(platform, row.get("postUrl"))
            else:
                conversation = identifier(row.get("conversationId"))
                source = (f"https://x.com/i/status/{conversation}", conversation) if conversation else None
            if source:
                grouped.setdefault(source[1], []).append(safe_export_row(platform, row))
        platform_summary: dict[str, Any] = {
            "api_rows": len(rows), "posts_requested": len(platform_targets),
            "posts_with_comments": 0, "selected_records": 0,
            "missing_posts": [],
        }
        for target in platform_targets:
            source = target["source"]
            candidates = grouped.get(source[1], [])
            if not candidates:
                platform_summary["missing_posts"].append(source[0])
                continue
            platform_summary["posts_with_comments"] += 1
            with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as handle:
                json.dump(candidates, handle, ensure_ascii=False)
                input_path = Path(handle.name)
            try:
                first = True
                for company in target["companies"]:
                    summary = import_export(
                        input_path, platform=platform, output_root=output_root,
                        salt=salt, post_url=source[0], company=company,
                        comments_per_post=5, run_mode=mode,
                    )
                    if summary["invalid_records"]:
                        raise RuntimeError(f"{platform} export contains invalid rows")
                    if first:
                        platform_summary["selected_records"] += summary["selected_records"]
                        first = False
            finally:
                input_path.unlink(missing_ok=True)
        summaries[platform] = platform_summary
    return {"mode": mode, "dry_run": False, "platforms": summaries}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("import", "backfill", "update"), default="import")
    parser.add_argument("--platform", choices=(*ACTORS, "all"), default="all")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output-root", type=Path, default=ROOT / "data" / "apify_comments")
    parser.add_argument("--post-url", help="Original post URL, required when the export omits its source")
    parser.add_argument("--search-tag", action="append", default=[])
    parser.add_argument("--company-file", type=Path, default=ROOT / "config" / "youtube_companies.json")
    parser.add_argument("--stock-code", help="Tag this single-company export with exactly one configured stock")
    parser.add_argument("--comments-per-post", type=int, choices=range(1, 6), default=5,
                        help="Select up to this many top-liked comments per original post in the export (default: 5)")
    parser.add_argument("--targets-file", type=Path, default=ROOT / "config" / "apify_community_targets.json")
    parser.add_argument("--instagram-limit", type=int, default=15)
    parser.add_argument("--x-limit", type=int, default=20)
    parser.add_argument("--instagram-max-cost-usd", type=float, default=0.50)
    parser.add_argument("--x-max-cost-usd", type=float, default=0.10)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--dry-run", action="store_true", help="Validate and count without writing any output files")
    args = parser.parse_args(argv)
    load_dotenv(ROOT)
    salt = os.getenv("COMMUNITY_ID_HASH_SALT", "").strip() or os.getenv("YOUTUBE_ID_HASH_SALT", "").strip()
    try:
        if args.command == "import":
            if args.input is None or args.platform not in ACTORS:
                raise ValueError("import requires --input and --platform instagram|x")
            summary = import_export(args.input, platform=args.platform, output_root=args.output_root, salt=salt, post_url=args.post_url, search_tags=args.search_tag, company=selected_company(args.company_file, args.stock_code), dry_run=args.dry_run, comments_per_post=args.comments_per_post)
        else:
            if not 1 <= args.instagram_limit <= 15 or not 1 <= args.x_limit <= 100:
                raise ValueError("limits must be instagram 1..15 and x 1..100")
            platforms = tuple(ACTORS) if args.platform == "all" else (args.platform,)
            summary = collect_api(
                mode=args.command, targets_file=args.targets_file,
                company_file=args.company_file, output_root=args.output_root,
                salt=salt, token=os.getenv("APIFY_TOKEN", "").strip(),
                platforms=platforms, instagram_limit=args.instagram_limit,
                x_limit=args.x_limit,
                instagram_max_cost_usd=args.instagram_max_cost_usd,
                x_max_cost_usd=args.x_max_cost_usd,
                timeout_seconds=args.timeout_seconds, dry_run=args.dry_run,
            )
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"Apify collection failed: {exc}", file=sys.stderr)
        return 2
    print(canonical_json(summary))
    if args.command == "import":
        return 2 if summary["invalid_records"] or not summary["valid_records"] else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
