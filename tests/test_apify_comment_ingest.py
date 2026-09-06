from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from collectors import apify_comment_ingest as apify


SALT = "test-only-community-salt-at-least-32-characters"
POST = "https://www.instagram.com/p/ExamplePost/"
ROOT_TWEET = "1880000000000000000"


def instagram(**overrides):
    return {
        "id": "17949788698583607", "text": "반도체 전망", "timestamp": "2026-09-05T10:54:13.000Z",
        "likesCount": 12, "repliesCount": 0, "replies": [], "postUrl": POST,
        **overrides,
    }


def tweet(**overrides):
    return {
        "type": "tweet", "id": "1880000000000000001", "text": "삼성전자 전망",
        "createdAt": "Fri Nov 24 17:49:36 +0000 2023", "likeCount": 2,
        "replyCount": 1, "isReply": True, "inReplyToId": ROOT_TWEET,
        "conversationId": ROOT_TWEET, **overrides,
    }


class ApifyCommentImportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.input = self.root / "input.json"
        self.output = self.root / "output"

    def run_import(self, rows, platform="instagram", **kwargs):
        self.input.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        return apify.import_export(self.input, platform=platform, output_root=self.output, salt=SALT, **kwargs)

    def latest(self):
        return [json.loads(line) for line in (self.output / "latest.jsonl").read_text().splitlines()]

    def test_nested_replies_deduplicate_and_private_fields_never_persist(self):
        reply = instagram(id="17891234567890123", ownerUsername="private_author", ownerId="99999999999999999", text="@private_author mail@example.org 010-1234-5678 192.168.0.1")
        top = instagram(repliesCount=1, replies=[reply], ownerUsername="another_author")
        summary = self.run_import([top, reply], search_tags=["반도체", "반도체"])
        self.assertEqual(summary["inserted"], 2)
        self.assertEqual(summary["duplicate_rows"], 1)
        records = {row["comment_id"]: row for row in self.latest()}
        top_id = apify.private_id("instagram", "comment", top["id"], SALT)
        row = records[apify.private_id("instagram", "comment", reply["id"], SALT)]
        self.assertEqual(row["parent_comment_id"], top_id)
        self.assertEqual(row["thread_id"], records[top_id]["thread_id"])
        self.assertEqual(row["category"], "community_v2")
        self.assertEqual(row["tags"], {"source": "instagram"})
        self.assertEqual(row["source"], "apify")
        self.assertEqual(row["record_type"], "instagram_comment")
        self.assertEqual(row["source_url"], POST)
        self.assertEqual(row["published_at"], "2026-09-05T10:54:13+00:00")
        self.assertEqual(datetime.fromisoformat(row["expires_at"]) - datetime.fromisoformat(row["refreshed_at"]), timedelta(days=29))
        stored = "\n".join(path.read_text() for path in self.output.glob("*.jsonl"))
        for private in [top["id"], reply["id"], "private_author", "another_author", "99999999999999999", "mail@example.org", "010-1234-5678", "192.168.0.1"]:
            self.assertNotIn(private, stored)
        self.assertEqual(list((self.output / "raw").iterdir()), [])

    def test_x_originals_retweets_and_unproven_replies_are_excluded(self):
        rows = [
            tweet(id=ROOT_TWEET, isReply=False, inReplyToId=None),
            tweet(id="1880000000000000002", isReply="true", inReplyToId=None),
            tweet(id="1880000000000000003", isRetweet=True),
            tweet(url="https://x.com/private_author/status/1880000000000000001", author={"id": "123", "userName": "private_author"}),
            tweet(id="1880000000000000004", inReplyToId="1880000000000000001"),
        ]
        summary = self.run_import(rows, platform="x")
        self.assertEqual(summary["skipped_originals"], 3)
        self.assertEqual(summary["valid_records"], 2)
        latest = self.latest()
        self.assertEqual({row["record_type"] for row in latest}, {"x_comment"})
        for row in latest:
            self.assertEqual(row["tags"], {"source": "x"})
            self.assertEqual(row["actor_id"], "xquik/x-tweet-scraper")
            self.assertEqual(row["source_url"], f"https://x.com/i/status/{ROOT_TWEET}")
            self.assertEqual(row["published_at"], "2023-11-24T17:49:36+00:00")
            self.assertNotIn("author", row)
        first = next(row for row in latest if row["text"] == "삼성전자 전망" and row["parent_comment_id"] == apify.private_id("x", "comment", ROOT_TWEET, SALT))
        second = next(row for row in latest if row["parent_comment_id"] == first["comment_id"])
        self.assertEqual(first["thread_id"], second["thread_id"])
        self.assertNotEqual(apify.private_id("x", "comment", "123", SALT), apify.private_id("instagram", "comment", "123", SALT))

    def test_instagram_export_with_uncollected_replies_accepts_null(self):
        result = self.run_import([instagram(replies=None, repliesCount=None)])
        self.assertEqual(result["valid_records"], 1)
        self.assertEqual(result["invalid_records"], 0)
        self.assertEqual(result["inserted"], 1)
        self.assertEqual(self.latest()[0]["reply_count"], 0)

    def test_x_reply_mode_type_requires_reply_evidence(self):
        actual_shape = {
            "type": "reply", "resultType": "tweet", "engagementMode": "replies",
            "depth": 1, "isDirectReply": True,
        }
        result = self.run_import([
            tweet(**actual_shape),
            tweet(**actual_shape, id="1880000000000000002", isReply=None, inReplyToId=None),
        ], platform="x")
        self.assertEqual(result["valid_records"], 1)
        self.assertEqual(result["skipped_originals"], 1)
        self.assertEqual(self.latest()[0]["record_type"], "x_comment")

    def test_repeat_is_unchanged_and_changed_content_adds_one_version(self):
        self.run_import([instagram()], search_tags=["삼성전자"])
        second = self.run_import([instagram()], search_tags=["삼성전자"])
        self.assertEqual(second["unchanged"], 1)
        self.assertEqual(second["changed"], 0)
        third = self.run_import([instagram(text="전망 수정", likesCount=15)], search_tags=["반도체"])
        self.assertEqual(third["changed"], 1)
        self.assertEqual(len((self.output / "records.jsonl").read_text().splitlines()), 2)
        self.assertEqual(self.latest()[0]["search_tags"], ["반도체", "삼성전자"])
        self.assertEqual(self.latest()[0]["text"], "전망 수정")

    def test_top_five_per_post_has_stable_order_and_selection_scope(self):
        rows = [instagram(id=str(17949788698583600 + number), likesCount=number)
                for number in range(1, 9)]
        other = "https://www.instagram.com/p/AnotherPost/"
        rows += [instagram(id=str(17891234567890120 + number), likesCount=10, postUrl=other)
                 for number in range(3)]
        result = self.run_import(rows, dry_run=True)
        self.assertEqual(result["valid_records"], 11)
        self.assertEqual(result["selected_records"], 8)
        self.assertEqual(result["outside_top_records"], 3)
        self.assertFalse(self.output.exists())
        self.run_import(rows)
        first = sorted((row for row in self.latest() if row["source_url"] == POST), key=lambda row: row["post_like_rank"])
        self.assertEqual([row["like_count"] for row in first], [8, 7, 6, 5, 4])
        self.assertEqual([row["post_like_rank"] for row in first], [1, 2, 3, 4, 5])
        tied = sorted((row for row in self.latest() if row["source_url"] == other), key=lambda row: row["post_like_rank"])
        self.assertEqual([row["record_id"] for row in tied], sorted((row["record_id"] for row in tied), reverse=True))
        for row in self.latest():
            self.assertTrue(row["top5_only"])
            self.assertEqual(row["comments_per_post"], 5)
            self.assertEqual(row["selection_scope"], "collected_comments")

    def test_top_five_new_export_preserves_earlier_records_and_history(self):
        self.run_import([instagram(id=str(17949788698583600 + number), likesCount=number)
                         for number in range(5)])
        before = {row["record_id"]: row for row in self.latest()}
        rows = [instagram(id=str(17891234567890120 + number), likesCount=100 + number)
                for number in range(6)]
        result = self.run_import([*rows, instagram(id=None)])
        self.assertEqual(result["selected_records"], 5)
        self.assertEqual(result["invalid_records"], 1)
        self.assertEqual(result["inserted"], 5)
        after = {row["record_id"]: row for row in self.latest()}
        self.assertEqual(len(after), 10)
        for identity, previous in before.items():
            self.assertEqual(after[identity], previous)
        self.assertTrue(all(not row["is_deleted"] for row in after.values()))
        self.assertEqual(len((self.output / "records.jsonl").read_text().splitlines()), 10)
        with self.assertRaisesRegex(ValueError, "between 1 and 5"):
            self.run_import(rows, comments_per_post=6, dry_run=True)

    def test_invalid_jsonl_and_actor_errors_are_counted_without_raw_content(self):
        path = self.root / "input.jsonl"
        bad = [
            instagram(id=None), instagram(text=""), instagram(timestamp=None),
            instagram(timestamp="private invalid date"), instagram(likesCount={}),
            instagram(result={"error": "private actor error"}), instagram(error="failure"),
            instagram(**{"result.error": "failure"}), "private invalid row",
        ]
        path.write_text("\n".join(json.dumps(row) for row in [instagram(), *bad]) + "\n{private invalid json\n")
        result = apify.import_export(path, platform="instagram", output_root=self.output, salt=SALT)
        self.assertEqual(result["valid_records"], 1)
        self.assertEqual(result["invalid_records"], 10)
        self.assertEqual(result["errors"]["actor_error"], 3)
        self.assertEqual(result["errors"]["invalid_json_line"], 1)
        self.assertNotIn("private", json.dumps(result))

    def test_source_fallback_validation_and_missing_source(self):
        row = instagram()
        del row["postUrl"]
        result = self.run_import([row], dry_run=True)
        self.assertEqual(result["errors"], {"missing_post_source": 1})
        result = self.run_import([row], post_url=POST + "?igsh=tracking", dry_run=True)
        self.assertEqual(result["valid_records"], 1)
        self.assertFalse(self.output.exists())
        with self.assertRaisesRegex(ValueError, "public post URL"):
            self.run_import([row], post_url="https://instagram.com.evil.test/p/test/", dry_run=True)
        result = self.run_import([instagram()], post_url="https://www.instagram.com/p/Different/", dry_run=True)
        self.assertEqual(result["errors"], {"source_mismatch": 1})
        row = tweet(conversationId=None)
        result = self.run_import([row], platform="x", post_url=f"https://twitter.com/example/status/{ROOT_TWEET}", dry_run=True)
        self.assertEqual(result["valid_records"], 1)

    def test_single_company_tags_and_salt_change_are_safe(self):
        company = apify.selected_company(apify.ROOT / "config" / "youtube_companies.json", "005930")
        self.run_import([instagram()], company=company)
        row = self.latest()[0]
        self.assertEqual(row["search_tags"], ["삼성전자"])
        self.assertEqual(row["search_matches"], [{"company_name": "삼성전자", "stock_code": "005930", "search_query": "삼성전자 주식"}])
        self.assertIsNone(apify.selected_company(self.root / "missing", None))
        with self.assertRaisesRegex(ValueError, "exactly one"):
            apify.selected_company(apify.ROOT / "config" / "youtube_companies.json", "invalid")
        with self.assertRaisesRegex(ValueError, "salt differs"):
            apify.import_export(self.input, platform="instagram", output_root=self.output, salt="a different salt at least 32 characters", dry_run=True)

    def test_cli_dry_run_and_partial_exit_codes(self):
        self.input.write_text(json.dumps([instagram(), instagram(id=None)]))
        out = io.StringIO()
        with patch.dict(os.environ, {"COMMUNITY_ID_HASH_SALT": SALT}), redirect_stdout(out):
            code = apify.main(["--platform", "instagram", "--input", str(self.input), "--output-root", str(self.output), "--stock-code", "005930", "--dry-run"])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(out.getvalue())["valid_records"], 1)
        self.assertFalse(self.output.exists())
        with patch.dict(os.environ, {"COMMUNITY_ID_HASH_SALT": "", "YOUTUBE_ID_HASH_SALT": ""}), patch.object(apify, "load_dotenv"), redirect_stderr(io.StringIO()):
            self.assertEqual(apify.main(["--platform", "instagram", "--input", str(self.input), "--dry-run"]), 2)

    def test_api_update_plan_and_export_redaction(self):
        targets = self.root / "targets.json"
        targets.write_text(json.dumps({
            "instagram": [{"url": POST, "stock_codes": ["005930"]}],
            "x": [{"url": f"https://x.com/i/status/{ROOT_TWEET}", "stock_codes": ["000660"]}],
        }))
        out = io.StringIO()
        with patch.dict(os.environ, {"COMMUNITY_ID_HASH_SALT": SALT, "APIFY_TOKEN": ""}), redirect_stdout(out):
            code = apify.main(["update", "--targets-file", str(targets), "--dry-run"])
        self.assertEqual(code, 0)
        plan = json.loads(out.getvalue())
        self.assertEqual(plan["platforms"]["instagram"], {"company_links": 1, "posts": 1})
        self.assertEqual(plan["platforms"]["x"], {"company_links": 1, "posts": 1})
        safe = apify.safe_export_row("x", tweet(
            text="@person mail@example.org 010-1234-5678 192.168.0.1",
            author={"username": "private"}, url="https://x.com/private/status/1",
        ))
        self.assertNotIn("author", safe)
        self.assertNotIn("url", safe)
        self.assertEqual(
            safe["text"],
            "[REDACTED_MENTION] [REDACTED_EMAIL] [REDACTED_PHONE] [REDACTED_IP]",
        )

    @patch.object(apify.time, "sleep")
    @patch.object(apify, "apify_json")
    def test_actor_run_uses_cost_cap_and_downloads_its_dataset(self, api_json, _sleep):
        api_json.side_effect = [
            {"data": {"id": "run-1", "status": "RUNNING"}},
            {"data": {"id": "run-1", "status": "SUCCEEDED", "defaultDatasetId": "set-1"}},
            [{"id": "comment-1"}],
        ]
        rows = apify.run_actor(
            "instagram", {"directUrls": [POST]}, token="secret-token",
            max_cost_usd=0.5, timeout_seconds=30,
        )
        self.assertEqual(rows, [{"id": "comment-1"}])
        start_path = api_json.call_args_list[0].args[0]
        self.assertIn("maxTotalChargeUsd=0.50", start_path)
        self.assertEqual(api_json.call_args_list[1].args[0], "/actor-runs/run-1")
        self.assertEqual(
            api_json.call_args_list[2].args[0],
            "/datasets/set-1/items?clean=true&format=json",
        )

        api_json.reset_mock(side_effect=True)
        api_json.return_value = {"data": {"status": "READY"}}
        with self.assertRaisesRegex(RuntimeError, "no run id"):
            apify.run_actor(
                "x", {}, token="secret-token", max_cost_usd=0.1,
                timeout_seconds=30,
            )


if __name__ == "__main__":
    unittest.main()
