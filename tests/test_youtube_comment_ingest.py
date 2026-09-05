from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
from contextlib import redirect_stdout
from datetime import UTC, date, datetime, timedelta
import json
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from collectors._indexed_jsonl_store import IndexedJsonlStore
from collectors import youtube_comment_ingest as youtube


def channel_id(number: int) -> str:
    return "UC" + f"{number:022d}"


def collector_args(command: str = "backfill", **overrides: object) -> argparse.Namespace:
    values: dict[str, object] = {
        "command": command,
        "start": None,
        "end": date(2026, 1, 1),
        "channel_count": 30,
        "channel_id": None,
        "channel_file": None,
        "company_file": None,
        "restart": False,
        "query": "국내주식",
        "candidate_pages": 1,
        "quota_budget": 100,
        "quick_pages": 0,
        "search_pages_per_company": 1,
        "search_order": "date",
        "comments_per_video": 5,
        "video_filter": "all",
        "refresh_cycle_days": 28,
        "timeout": 1,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


@contextmanager
def isolated_collector(root: Path):
    output = root / "data" / "youtube_comments"
    work = output / "work"
    store = IndexedJsonlStore(output)
    state = youtube.WorkState(store.index_path)
    company_state = youtube.WorkState(store.index_path, "youtube_company")
    names = {
        "ROOT": root,
        "OUTPUT_ROOT": output,
        "WORK_ROOT": work,
        "MANIFEST_PATH": output / "channel_manifest.json",
        "CANDIDATE_PATH": output / "channel_candidates.json",
        "CHANNEL_THREAD_PAGE_PATH": work / "thread_page.json",
        "COMPANY_THREAD_PAGE_PATH": work / "company_thread_page.json",
        "THREAD_PAGE_PATH": work / "thread_page.json",
        "SALT_FINGERPRINT_PATH": work / "salt_fingerprint.json",
        "STORE": store,
        "CHANNEL_STATE": state,
        "COMPANY_STATE": company_state,
        "STATE": state,
    }
    previous = {name: getattr(youtube, name) for name in names}
    for name, value in names.items():
        setattr(youtube, name, value)
    try:
        yield store, state
    finally:
        for name, value in previous.items():
            setattr(youtube, name, value)


class CandidateClient:
    def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
        if resource == "search":
            return {
                "items": [
                    {"id": {"channelId": channel_id(number)}}
                    for number in range(31)
                ]
            }
        if resource == "channels":
            identities = str(params["id"]).split(",")
            return {
                "items": [
                    {
                        "id": identity,
                        "snippet": {"title": f"channel-{int(identity[2:])}"},
                        "statistics": {
                            "viewCount": str(int(identity[2:])),
                            "subscriberCount": "1",
                            "videoCount": "2",
                        },
                        "contentDetails": {
                            "relatedPlaylists": {"uploads": "UU" + identity[2:]}
                        },
                    }
                    for identity in identities
                ]
            }
        raise AssertionError(resource)


class UploadClient:
    def __init__(self, max_calls: int):
        self.max_calls = max_calls
        self.calls = 0
        self.tokens: list[str | None] = []

    def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
        if self.calls >= self.max_calls:
            raise youtube.BudgetReached
        self.calls += 1
        self.assert_resource(resource)
        token = params.get("pageToken")
        self.tokens.append(str(token) if token else None)
        if token == "uploads-2":
            return {"items": [self.video("video000002", "2025-01-02T00:00:00Z")]}
        return {
            "nextPageToken": "uploads-2",
            "items": [self.video("video000001", "2025-01-01T00:00:00Z")],
        }

    def assert_resource(self, resource: str) -> None:
        if resource != "playlistItems":
            raise AssertionError(resource)

    @staticmethod
    def video(identity: str, published_at: str) -> dict[str, object]:
        return {
            "contentDetails": {"videoId": identity, "videoPublishedAt": published_at},
            "snippet": {"title": identity},
            "status": {"privacyStatus": "public"},
        }


class CommentClient:
    def __init__(self, max_calls: int):
        self.max_calls = max_calls
        self.calls = 0
        self.resources: list[tuple[str, str | None]] = []

    def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
        if self.calls >= self.max_calls:
            raise youtube.BudgetReached
        self.calls += 1
        token = params.get("pageToken")
        self.resources.append((resource, str(token) if token else None))
        if resource == "commentThreads":
            return {"items": [self.thread()]}
        if resource == "comments" and token == "replies-2":
            return {"items": [self.reply("raw-reply-2")]}
        if resource == "comments":
            return {
                "nextPageToken": "replies-2",
                "items": [self.reply("raw-reply-1")],
            }
        raise AssertionError(resource)

    @staticmethod
    def thread() -> dict[str, object]:
        return {
            "id": "raw-thread",
            "snippet": {
                "videoId": "video000001",
                "totalReplyCount": 2,
                "topLevelComment": {
                    "id": "raw-top",
                    "etag": "etag-top",
                    "snippet": {
                        "textDisplay": "top",
                        "likeCount": 1,
                        "publishedAt": "2025-01-01T00:00:00Z",
                        "updatedAt": "2025-01-01T00:00:00Z",
                    },
                },
            },
        }

    @staticmethod
    def reply(identity: str) -> dict[str, object]:
        return {
            "id": identity,
            "etag": f"etag-{identity}",
            "snippet": {
                "parentId": "raw-top",
                "textDisplay": identity,
                "likeCount": 0,
                "publishedAt": "2025-01-01T00:00:00Z",
                "updatedAt": "2025-01-01T00:00:00Z",
            },
        }


class EndToEndClient:
    def __init__(self, api_key: str, max_calls: int, timeout: int):
        self.api_key = api_key
        self.max_calls = max_calls
        self.timeout = timeout
        self.calls = 0

    def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
        self.calls += 1
        if resource == "channels":
            identity = str(params["id"])
            return {
                "items": [
                    {
                        "id": identity,
                        "snippet": {"title": "private-log-title"},
                        "statistics": {
                            "viewCount": "100",
                            "subscriberCount": "10",
                            "videoCount": "1",
                        },
                        "contentDetails": {
                            "relatedPlaylists": {"uploads": "UU" + identity[2:]}
                        },
                    }
                ]
            }
        if resource == "playlistItems":
            return {
                "items": [UploadClient.video("video000001", "2025-01-01T00:00:00Z")]
            }
        if resource == "commentThreads":
            thread = CommentClient.thread()
            thread["snippet"]["totalReplyCount"] = 0
            return {"items": [thread]}
        raise AssertionError(resource)


class CompanySearchClient:
    queries: list[str] = []

    def __init__(self, api_key: str, max_calls: int, timeout: int):
        self.api_key = api_key
        self.max_calls = max_calls
        self.timeout = timeout
        self.calls = 0

    def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
        self.calls += 1
        if resource == "search":
            self.queries.append(str(params["q"]))
            return {
                "items": [
                    {
                        "id": {"videoId": "video000001"},
                        "snippet": {
                            "channelId": channel_id(9),
                            "channelTitle": "stock channel",
                            "title": "삼성전자와 SK하이닉스 전망",
                            "publishedAt": "2025-01-01T00:00:00Z",
                        },
                    }
                ]
            }
        if resource == "commentThreads":
            thread = CommentClient.thread()
            thread["snippet"]["totalReplyCount"] = 0
            return {"items": [thread]}
        raise AssertionError(resource)


class YouTubeCollectorTest(unittest.TestCase):
    def test_selects_top_30_channels_from_31_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ):
            records = youtube.ranked_channel_candidates(
                CandidateClient(), "국내주식", 1, 30
            )

        self.assertEqual(30, len(records))
        self.assertEqual(30, records[0]["view_count"])
        self.assertEqual(1, records[-1]["view_count"])
        self.assertEqual(1, records[0]["rank"])
        self.assertEqual(30, records[-1]["rank"])

    def test_upload_page_checkpoint_resumes_without_restarting(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, state):
            args = collector_args(channel_count=1)
            channel = youtube.timestamped(
                {
                    "record_id": f"youtube:channel:{channel_id(1)}",
                    "record_type": "youtube_channel",
                    "channel_id": channel_id(1),
                    "channel_title": "channel",
                    "uploads_playlist_id": "UU" + channel_id(1)[2:],
                    "is_deleted": False,
                }
            )
            youtube.begin_or_resume_operation(args, [channel])
            totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}

            first = UploadClient(max_calls=1)
            with self.assertRaises(youtube.BudgetReached):
                youtube.run_upload_phase(
                    first, args, {channel_id(1): channel}, totals
                )
            self.assertEqual("uploads-2", state.operation()["upload_page_token"])
            self.assertIsNotNone(store.get_latest("youtube:video:video000001"))

            second = UploadClient(max_calls=1)
            operation = youtube.run_upload_phase(
                second, args, {channel_id(1): channel}, totals
            )
            self.assertEqual(["uploads-2"], second.tokens)
            self.assertEqual("comments", operation["phase"])
            self.assertIsNotNone(store.get_latest("youtube:video:video000002"))
            self.assertEqual(2, state.remaining_videos())

    def test_semiconductor_filter_uses_video_title_description_and_tags(self) -> None:
        class FilterClient:
            def __init__(self) -> None:
                self.resources: list[str] = []

            def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
                self.resources.append(resource)
                if resource == "playlistItems":
                    return {
                        "items": [
                            UploadClient.video(
                                "video000001", "2025-01-01T00:00:00Z"
                            ),
                            UploadClient.video(
                                "video000002", "2025-01-02T00:00:00Z"
                            ),
                            UploadClient.video(
                                "video000003", "2025-01-03T00:00:00Z"
                            ),
                            UploadClient.video(
                                "video000004", "2025-01-04T00:00:00Z"
                            ),
                        ]
                    }
                if resource == "videos":
                    self.assert_video_ids(params)
                    return {
                        "items": [
                            {
                                "id": "video000001",
                                "snippet": {
                                    "title": "반도체 산업 전망",
                                    "description": "수요와 공급을 분석합니다.",
                                    "tags": [],
                                },
                            },
                            {
                                "id": "video000002",
                                "snippet": {
                                    "title": "오늘의 산업 전망",
                                    "description": "HBM 수요와 공급을 분석합니다.",
                                    "tags": [],
                                },
                            },
                            {
                                "id": "video000003",
                                "snippet": {
                                    "title": "기술주 전망",
                                    "description": "기업 실적 분석",
                                    "tags": ["GPU"],
                                },
                            },
                            {
                                "id": "video000004",
                                "snippet": {
                                    "title": "배당주 전망",
                                    "description": "은행 업종 basic 분석",
                                    "tags": ["금융"],
                                },
                            },
                        ]
                    }
                raise AssertionError(resource)

            @staticmethod
            def assert_video_ids(params: dict[str, object]) -> None:
                expected = ",".join(f"video00000{number}" for number in range(1, 5))
                if params.get("id") != expected:
                    raise AssertionError(params)

        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ):
            client = FilterClient()
            rows, _ = youtube.fetch_upload_page(
                client,
                {
                    "channel_id": channel_id(1),
                    "channel_title": "channel",
                    "uploads_playlist_id": "UU" + channel_id(1)[2:],
                },
                None,
                None,
                date(2026, 1, 1),
                "semiconductor",
            )

        self.assertEqual(["playlistItems", "videos"], client.resources)
        self.assertEqual(
            ["video000001", "video000002", "video000003"],
            [row["video_id"] for row in rows],
        )
        self.assertTrue(all(row["video_filter"] == "semiconductor" for row in rows))
        self.assertEqual(
            [["반도체"], ["hbm"], ["gpu"]],
            [row["video_filter_terms"] for row in rows],
        )

    def test_semiconductor_queue_excludes_legacy_unfiltered_videos(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (_, state):
            records = [
                youtube.timestamped(
                    {
                        "record_id": f"youtube:video:video00000{number}",
                        "record_type": "youtube_video",
                        "video_id": f"video00000{number}",
                        "channel_id": channel_id(1),
                        "published_at": f"2025-01-0{number}T00:00:00Z",
                        "video_filter": filter_name,
                        "is_deleted": False,
                    }
                )
                for number, filter_name in ((1, "semiconductor"), (2, None))
            ]
            totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}
            youtube.merge_rows(records, "seed", totals)

            queued = state.fill_video_queue(
                "update",
                None,
                date(2026, 1, 1),
                youtube.now_iso(),
                "semiconductor",
            )

            self.assertEqual(1, queued)
            self.assertEqual("video000001", state.next_video()["video_id"])

    def test_video_filter_is_part_of_resume_signature(self) -> None:
        args = collector_args(video_filter="all")
        all_signature = youtube.operation_signature(args, [channel_id(1)])
        args.video_filter = "semiconductor"

        self.assertNotEqual(
            all_signature, youtube.operation_signature(args, [channel_id(1)])
        )

    def test_comment_limit_is_part_of_resume_signatures(self) -> None:
        args = collector_args(comments_per_video=5)
        channel_signature = youtube.operation_signature(args, [channel_id(1)])
        company_signature = youtube.company_operation_signature(
            args,
            [
                {
                    "company_name": "삼성전자",
                    "stock_code": "005930",
                    "search_query": "삼성전자 주식",
                }
            ],
        )
        args.comments_per_video = 10

        self.assertNotEqual(
            channel_signature, youtube.operation_signature(args, [channel_id(1)])
        )
        self.assertNotEqual(
            company_signature,
            youtube.company_operation_signature(
                args,
                [
                    {
                        "company_name": "삼성전자",
                        "stock_code": "005930",
                        "search_query": "삼성전자 주식",
                    }
                ],
            ),
        )

    def test_missing_playlist_is_empty_only_for_zero_video_channel(self) -> None:
        class MissingPlaylistClient:
            def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
                raise youtube.ApiError(404, "playlistNotFound")

        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (_, state):
            args = collector_args(channel_count=1)
            channel = youtube.timestamped(
                {
                    "record_id": f"youtube:channel:{channel_id(1)}",
                    "record_type": "youtube_channel",
                    "channel_id": channel_id(1),
                    "channel_title": "empty channel",
                    "uploads_playlist_id": "UU" + channel_id(1)[2:],
                    "video_count": 0,
                    "is_deleted": False,
                }
            )
            youtube.begin_or_resume_operation(args, [channel])
            totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}

            operation = youtube.run_upload_phase(
                MissingPlaylistClient(), args, {channel_id(1): channel}, totals
            )

            self.assertEqual("comments", operation["phase"])
            self.assertEqual(0, state.remaining_videos())

            with self.assertRaises(youtube.ApiError):
                youtube.fetch_upload_page(
                    MissingPlaylistClient(),
                    {**channel, "video_count": 1},
                    None,
                    args.start,
                    args.end,
                )

    def test_reply_page_checkpoint_resumes_at_second_reply_page(self) -> None:
        salt = "s" * 32
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, state):
            args = collector_args(channel_count=1)
            video = youtube.timestamped(
                {
                    "record_id": "youtube:video:video000001",
                    "record_type": "youtube_video",
                    "video_id": "video000001",
                    "channel_id": channel_id(1),
                    "title": "video",
                    "published_at": "2025-01-01T00:00:00+00:00",
                    "is_deleted": False,
                }
            )
            totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}
            youtube.merge_rows([video], "seed", totals)
            operation = {
                "operation_id": "operation",
                "signature": "signature",
                "command": "backfill",
                "phase": "comments",
                "started_at": youtube.now_iso(),
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
            state.save_operation(operation)
            state.fill_video_queue(
                "backfill",
                None,
                args.end,
                (datetime.now(UTC) - timedelta(days=28)).isoformat(),
            )

            first = CommentClient(max_calls=2)
            with self.assertRaises(youtube.BudgetReached):
                youtube.run_comment_phase(first, args, salt, totals)
            self.assertEqual("replies-2", state.operation()["reply_page_token"])
            self.assertTrue(youtube.THREAD_PAGE_PATH.exists())

            second = CommentClient(max_calls=1)
            _, completed = youtube.run_comment_phase(second, args, salt, totals)
            self.assertTrue(completed)
            self.assertEqual([("comments", "replies-2")], second.resources)
            self.assertEqual(0, state.remaining_videos())

            comment_rows = list(
                store.iter_latest(record_type="youtube_comment", is_deleted=False)
            )
            self.assertEqual(3, len(comment_rows))
            for row in comment_rows:
                identifiers = json.dumps(
                    {
                        "record_id": row["record_id"],
                        "comment_id": row["comment_id"],
                        "parent_comment_id": row["parent_comment_id"],
                        "thread_id": row["thread_id"],
                        "source_url": row["source_url"],
                    }
                )
                self.assertNotIn("raw-top", identifiers)
                self.assertNotIn("raw-reply", identifiers)
                self.assertNotIn("&lc=", identifiers)

    def test_expired_reply_token_restarts_once_and_makes_progress(self) -> None:
        class ExpiringReplyClient:
            def __init__(self) -> None:
                self.tokens: list[str | None] = []

            def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
                token = params.get("pageToken")
                self.tokens.append(str(token) if token else None)
                call = len(self.tokens)
                if call == 2:
                    raise youtube.ApiError(400, "invalidPageToken")
                if call in {1, 3}:
                    return {
                        "nextPageToken": "replies-2",
                        "items": [CommentClient.reply("raw-reply-1")],
                    }
                return {"items": [CommentClient.reply("raw-reply-2")]}

        salt = "s" * 32
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, state):
            operation = {
                "current_video_id": "video000001",
                "current_channel_id": channel_id(1),
                "reply_page_token": None,
                "reply_failed_page_token": None,
            }
            state.save_operation(operation)
            totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}
            client = ExpiringReplyClient()

            completed = youtube.process_reply_pages(
                client,
                operation,
                CommentClient.thread(),
                salt,
                totals,
                "test",
            )

            self.assertTrue(completed)
            self.assertEqual([None, "replies-2", None, "replies-2"], client.tokens)
            self.assertEqual(
                2, len(list(store.iter_latest(record_type="youtube_comment")))
            )

    def test_default_end_resumes_with_original_effective_date(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (_, state):
            state.save_operation({"effective_end": "2026-01-02"})
            args = collector_args(end=None)

            youtube.resolve_effective_end(args)

            self.assertEqual(date(2026, 1, 2), args.end)

    def test_paused_update_still_prioritizes_todays_new_video(self) -> None:
        class QuickClient:
            def get(self, resource: str, params: dict[str, object]) -> dict[str, object]:
                if resource == "playlistItems":
                    return {
                        "items": [
                            UploadClient.video(
                                "video000009",
                                datetime.now(UTC).strftime("%Y-%m-%dT00:00:00Z"),
                            )
                        ]
                    }
                if resource == "commentThreads":
                    return {"items": []}
                raise AssertionError(resource)

        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, state):
            args = collector_args(
                command="update",
                channel_count=1,
                end=date.today() - timedelta(days=1),
                quick_pages=1,
            )
            args.end_was_default = True
            channel = youtube.timestamped(
                {
                    "record_id": f"youtube:channel:{channel_id(1)}",
                    "record_type": "youtube_channel",
                    "channel_id": channel_id(1),
                    "channel_title": "channel",
                    "uploads_playlist_id": "UU" + channel_id(1)[2:],
                }
            )
            state.save_operation({"phase": "comments"})
            totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}

            youtube.quick_update(QuickClient(), args, [channel], "s" * 32, totals)

            self.assertIsNotNone(store.get_latest("youtube:video:video000009"))
            self.assertEqual(1, state.remaining_videos())

    def test_restart_resets_even_when_parameters_match(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (_, state):
            args = collector_args(channel_count=1)
            channel = youtube.timestamped(
                {
                    "record_id": f"youtube:channel:{channel_id(1)}",
                    "record_type": "youtube_channel",
                    "channel_id": channel_id(1),
                    "uploads_playlist_id": "UU" + channel_id(1)[2:],
                }
            )
            first = youtube.begin_or_resume_operation(args, [channel])
            first["phase"] = "comments"
            state.save_operation(first)
            args.restart = True

            restarted = youtube.begin_or_resume_operation(args, [channel])

            self.assertEqual("uploads", restarted["phase"])
            self.assertNotEqual(first["operation_id"], restarted["operation_id"])

    def test_older_observation_never_overwrites_newer_latest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = IndexedJsonlStore(Path(directory))
            newer = {
                "record_id": "youtube:comment:1",
                "text": "new",
                "refreshed_at": "2026-01-02T00:00:00+00:00",
                "expires_at": "2026-01-31T00:00:00+00:00",
            }
            older = {
                **newer,
                "text": "old",
                "refreshed_at": "2026-01-01T00:00:00+00:00",
                "expires_at": "2026-01-30T00:00:00+00:00",
            }
            options = {
                "collector": "test",
                "mode": "update",
                "prefer_newer_field": "refreshed_at",
                "materialize": False,
            }
            store.merge([newer], **options)
            summary = store.merge([older], **options)

            self.assertEqual(1, summary["skipped_older"])
            self.assertEqual("new", store.get_latest(newer["record_id"])["text"])

    def test_absence_requires_two_distinct_complete_scans(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, _):
            record = youtube.timestamped(
                {
                    "record_id": "youtube:comment:one",
                    "record_type": "youtube_comment",
                    "comment_id": "one",
                    "video_id": "video",
                    "channel_id": channel_id(1),
                    "text": "body",
                    "is_deleted": False,
                }
            )
            totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}
            youtube.merge_rows([record], "seed", totals)

            youtube.apply_absence([record], "missing", "scan", totals, "scan-1")
            first = store.get_latest(record["record_id"])
            youtube.apply_absence([first], "missing", "scan", totals, "scan-1")
            retry = store.get_latest(record["record_id"])
            self.assertEqual(1, retry["missing_scan_count"])
            self.assertFalse(retry.get("is_deleted", False))

            youtube.apply_absence([retry], "missing", "scan", totals, "scan-2")
            deleted = store.get_latest(record["record_id"])
            self.assertTrue(deleted["is_deleted"])
            self.assertEqual("community_v2", deleted["category"])
            self.assertEqual({"source": "youtube"}, deleted["tags"])
            with closing(store.connect()) as connection, connection:
                versions = connection.execute(
                    "SELECT COUNT(*) FROM versions WHERE record_id = ?",
                    (record["record_id"],),
                ).fetchone()[0]
            self.assertEqual(1, versions)

    def test_comment_limit_keeps_five_highest_likes_per_video(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, state):
            records = []
            for number, likes in enumerate((1, 9, 5, 9, 2, 8, 7), 1):
                records.append(
                    youtube.timestamped(
                        {
                            "record_id": f"youtube:comment:{number}",
                            "record_type": "youtube_comment",
                            "comment_id": str(number),
                            "video_id": "video",
                            "channel_id": channel_id(1),
                            "text": str(number),
                            "like_count": likes,
                            "published_at": f"2025-01-{number:02d}T00:00:00Z",
                            "is_deleted": False,
                        }
                    )
                )
            totals = {"inserted": 0, "changed": 0, "unchanged": 0, "stale": 0}
            youtube.merge_rows(records, "seed", totals)
            state.mark_comment_seen(row["record_id"] for row in records)

            youtube.apply_comment_limit("video", 5, "scan", totals)

            active = list(
                store.iter_latest(
                    record_type="youtube_comment", video_id="video", is_deleted=False
                )
            )
            deleted = list(
                store.iter_latest(
                    record_type="youtube_comment", video_id="video", is_deleted=True
                )
            )
            self.assertEqual([5, 7, 8, 9, 9], sorted(row["like_count"] for row in active))
            self.assertEqual([1, 2, 3, 4, 5], sorted(row["video_like_rank"] for row in active))
            self.assertEqual(
                ["4", "2", "6", "7", "3"],
                [row["text"] for row in sorted(active, key=lambda row: row["video_like_rank"])],
            )
            self.assertTrue(all(row["comments_per_video"] == 5 for row in active))
            self.assertEqual(2, len(deleted))
            self.assertTrue(
                all(row["deletion_reason"] == "outside_top_liked_comments" for row in deleted)
            )
            self.assertEqual(2, totals["limited_comments"])

    def test_redacts_personal_data_and_pseudonymizes_comment_ids(self) -> None:
        record = youtube.normalize_comment(
            {
                "id": "raw-comment",
                "snippet": {
                    "textDisplay": "mail me@example.com or 010-1234-5678 from 192.168.0.1",
                    "publishedAt": "2025-01-01T00:00:00Z",
                },
            },
            channel=channel_id(1),
            video_id="video000001",
            thread_raw_id="raw-thread",
            parent_raw_id=None,
            reply_count=0,
            salt="s" * 32,
            refreshed_at=youtube.now_iso(),
        )
        self.assertIsNotNone(record)
        self.assertNotIn("raw-comment", json.dumps(record))
        self.assertNotIn("raw-thread", json.dumps(record))
        self.assertEqual(
            "mail [REDACTED_EMAIL] or [REDACTED_PHONE] from [REDACTED_IP]",
            record["text"],
        )

    def test_expired_data_is_pruned_without_an_api_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, _):
            expired = {
                "record_id": "youtube:comment:expired",
                "record_type": "youtube_comment",
                "refreshed_at": "2025-01-01T00:00:00+00:00",
                "expires_at": "2025-01-30T00:00:00+00:00",
            }
            store.merge(
                [expired],
                collector="test",
                mode="seed",
                materialize=False,
            )
            with patch.dict(
                os.environ,
                {"YOUTUBE_API_KEY": "", "YOUTUBE_ID_HASH_SALT": ""},
            ):
                with self.assertRaises(SystemExit):
                    youtube.collect(collector_args(channel_count=1))
            self.assertIsNone(store.get_latest(expired["record_id"]))

    def test_configuration_error_is_never_recorded_as_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, _):
            with (
                patch.dict(
                    os.environ,
                    {
                        "YOUTUBE_API_KEY": "test-key",
                        "YOUTUBE_ID_HASH_SALT": "s" * 32,
                    },
                ),
                patch.object(youtube, "YouTubeClient", EndToEndClient),
                self.assertRaises(SystemExit),
            ):
                youtube.collect(collector_args(channel_count=1))

            with closing(store.connect()) as connection, connection:
                run = json.loads(
                    connection.execute(
                        "SELECT run_json FROM runs ORDER BY seq DESC LIMIT 1"
                    ).fetchone()[0]
                )
                last_success = connection.execute(
                    "SELECT value_json FROM state WHERE key = 'last_success_at'"
                ).fetchone()
            self.assertEqual("failed", run["status"])
            self.assertEqual("configuration_error", run["reason"])
            self.assertIsNone(last_success)

    def test_small_backfill_runs_end_to_end_and_materializes_jsonl(self) -> None:
        identity = channel_id(1)
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, _):
            args = collector_args(channel_count=1, channel_id=[identity])
            stream = io.StringIO()
            with (
                patch.dict(
                    os.environ,
                    {
                        "YOUTUBE_API_KEY": "test-key",
                        "YOUTUBE_ID_HASH_SALT": "s" * 32,
                    },
                ),
                patch.object(youtube, "YouTubeClient", EndToEndClient),
                redirect_stdout(stream),
            ):
                exit_code = youtube.collect(args)

            self.assertEqual(0, exit_code)
            result = json.loads(stream.getvalue().splitlines()[-1])
            self.assertEqual("success", result["status"])
            self.assertNotIn(identity, stream.getvalue())
            self.assertNotIn("private-log-title", stream.getvalue())
            self.assertTrue(store.latest_path.exists())
            self.assertEqual(
                1,
                len(list(store.iter_latest(record_type="youtube_comment"))),
            )

    def test_company_search_tags_duplicate_video_and_comment_once(self) -> None:
        CompanySearchClient.queries = []
        with tempfile.TemporaryDirectory() as directory, isolated_collector(
            Path(directory)
        ) as (store, channel_state):
            channel_state.save_operation({"sentinel": "channel-checkpoint"})
            company_file = Path(directory) / "companies.json"
            company_file.write_text(
                json.dumps(
                    {
                        "companies": [
                            {
                                "company_name": "삼성전자",
                                "stock_code": "005930",
                                "search_query": "삼성전자 주식",
                            },
                            {
                                "company_name": "SK하이닉스",
                                "stock_code": "000660",
                                "search_query": "SK하이닉스 주식",
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            args = collector_args(company_file=company_file)
            with (
                patch.dict(
                    os.environ,
                    {
                        "YOUTUBE_API_KEY": "test-key",
                        "YOUTUBE_ID_HASH_SALT": "s" * 32,
                    },
                ),
                patch.object(youtube, "YouTubeClient", CompanySearchClient),
                redirect_stdout(io.StringIO()),
            ):
                exit_code = youtube.collect(args)

            video = store.get_latest("youtube:video:video000001")
            comments = list(
                store.iter_latest(record_type="youtube_comment", is_deleted=False)
            )
            channel_operation = channel_state.operation()

        self.assertEqual(0, exit_code)
        self.assertEqual("channel-checkpoint", channel_operation["sentinel"])
        self.assertEqual(["삼성전자 주식", "SK하이닉스 주식"], CompanySearchClient.queries)
        self.assertEqual(["SK하이닉스", "삼성전자"], video["search_tags"])
        self.assertEqual("community_v2", video["category"])
        self.assertEqual({"source": "youtube"}, video["tags"])
        self.assertEqual(1, len(comments))
        self.assertEqual("community_v2", comments[0]["category"])
        self.assertEqual({"source": "youtube"}, comments[0]["tags"])
        self.assertEqual(video["search_tags"], comments[0]["search_tags"])
        self.assertEqual(
            ["000660", "005930"],
            [match["stock_code"] for match in comments[0]["search_matches"]],
        )

    def test_materialize_failure_keeps_previous_atomic_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = IndexedJsonlStore(Path(directory))
            store.merge(
                [{"record_id": "row", "value": "old"}],
                collector="test",
                mode="seed",
            )
            old_export = store.latest_path.read_text(encoding="utf-8")
            store.merge(
                [{"record_id": "row", "value": "new"}],
                collector="test",
                mode="update",
                materialize=False,
            )

            with patch.object(
                IndexedJsonlStore,
                "_write_state",
                side_effect=OSError("simulated disk full"),
            ):
                with self.assertRaises(OSError):
                    store.materialize()

            self.assertEqual(old_export, store.latest_path.read_text(encoding="utf-8"))
            self.assertEqual(
                1,
                len([path for path in store.generations_root.iterdir() if path.is_dir()]),
            )

    def test_retention_failure_removes_exports_that_still_contain_expired_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = IndexedJsonlStore(Path(directory))
            store.merge(
                [
                    {
                        "record_id": "expired",
                        "value": "must disappear",
                        "expires_at": "2025-01-01T00:00:00+00:00",
                    }
                ],
                collector="test",
                mode="seed",
            )
            store.prune_expired("2026-01-01T00:00:00+00:00", materialize=False)

            with patch.object(
                IndexedJsonlStore,
                "_write_state",
                side_effect=OSError("simulated disk full"),
            ):
                with self.assertRaises(OSError):
                    store.materialize(invalidate_on_failure=True)

            self.assertFalse(store.latest_path.exists())
            self.assertFalse(store.current_generation_path.exists())
            self.assertEqual([], list(store.generations_root.iterdir()))

    def test_import_does_not_let_stale_latest_override_newer_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            newer = {
                "record_id": "row",
                "value": "new",
                "refreshed_at": "2026-01-02T00:00:00+00:00",
            }
            older = {
                "record_id": "row",
                "value": "old",
                "refreshed_at": "2026-01-01T00:00:00+00:00",
            }
            (root / "records.jsonl").write_text(
                json.dumps(newer) + "\n", encoding="utf-8"
            )
            (root / "latest.jsonl").write_text(
                json.dumps(older) + "\n", encoding="utf-8"
            )

            store = IndexedJsonlStore(root)

            self.assertEqual("new", store.get_latest("row")["value"])


if __name__ == "__main__":
    unittest.main()
