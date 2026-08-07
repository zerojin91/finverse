#!/usr/bin/env python3
"""Synchronize the active Finverse data lake with a private Cloudflare R2 bucket.

The script uploads only canonical lake layers (Bronze, Silver, warehouse, and
configuration). Historical recovery archives and UI staging files are local
only and deliberately excluded. Credentials are read exclusively from ignored
environment variables; they are never written to manifests or Git.

Example:
  set -a; source .env.r2; set +a
  uv run python tools/r2_sync.py push
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
from botocore.exceptions import ClientError


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LAKE_ROOT = ROOT / "data-lake"
SYNC_DIRECTORIES = ("bronze", "silver", "warehouse", "config")
TRANSFER_CONFIG = TransferConfig(multipart_threshold=16 * 1024 * 1024, multipart_chunksize=16 * 1024 * 1024)


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def r2_client():
    return boto3.client(
        "s3",
        endpoint_url=required("R2_ENDPOINT_URL"),
        aws_access_key_id=required("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=required("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        config=Config(s3={"addressing_style": "path"}),
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def active_files(lake_root: Path, includes: list[str]) -> Iterator[Path]:
    roots = [lake_root / item for item in includes] if includes else [lake_root / directory for directory in SYNC_DIRECTORIES]
    for root in roots:
        root = root.resolve()
        if lake_root not in (root, *root.parents):
            raise ValueError(f"--include must remain inside lake root: {root}")
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.name != ".DS_Store":
                yield path


def content_type(path: Path) -> str:
    if path.suffix == ".parquet":
        return "application/vnd.apache.parquet"
    if path.suffix == ".gz":
        return "application/gzip"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def object_key(prefix: str, lake_root: Path, path: Path) -> str:
    return f"{prefix.strip('/')}/{path.relative_to(lake_root).as_posix()}"


def remote_hash(client: Any, bucket: str, key: str) -> str | None:
    try:
        metadata = client.head_object(Bucket=bucket, Key=key).get("Metadata", {})
        return metadata.get("sha256")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise


def remote_keys(client: Any, bucket: str, prefix: str) -> set[str]:
    keys: set[str] = set()
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"{prefix.strip('/')}/"):
        keys.update(item["Key"] for item in page.get("Contents", []))
    return keys


def push(
    lake_root: Path, bucket: str, prefix: str, dry_run: bool, workers: int,
    includes: list[str], offset: int, limit: int | None, write_manifest: bool, manifest_only: bool = False,
) -> int:
    client = r2_client()
    existing_keys = remote_keys(client, bucket, prefix)
    entries: list[dict[str, Any]] = []
    pending: list[tuple[Path, str, str]] = []
    skipped = 0
    selected = list(active_files(lake_root, includes))
    if offset:
        selected = selected[offset:]
    if limit is not None:
        selected = selected[:limit]
    for path in selected:
        checksum = sha256_file(path)
        key = object_key(prefix, lake_root, path)
        entry = {"key": key, "sha256": checksum, "size": path.stat().st_size}
        entries.append(entry)
        if key in existing_keys and remote_hash(client, bucket, key) == checksum:
            skipped += 1
            continue
        pending.append((path, key, checksum))

    def upload(item: tuple[Path, str, str]) -> None:
        path, key, checksum = item
        client.upload_file(
            str(path), bucket, key,
            ExtraArgs={"ContentType": content_type(path), "Metadata": {"sha256": checksum}},
            Config=TRANSFER_CONFIG,
        )

    uploaded = 0
    if not dry_run and not manifest_only:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(upload, item) for item in pending]
            for future in as_completed(futures):
                future.result()
                uploaded += 1
                if uploaded % 100 == 0:
                    print(f"uploaded={uploaded} skipped={skipped}", flush=True)
    else:
        uploaded = len(pending)

    manifest = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "lake_prefix": prefix.strip("/"),
        "files": entries,
    }
    manifest_key = f"{prefix.strip('/')}/manifests/latest.json"
    if not dry_run and write_manifest:
        client.put_object(
            Bucket=bucket,
            Key=manifest_key,
            Body=json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
    print(f"files={len(entries)} uploaded={uploaded} skipped={skipped} manifest={manifest_key} dry_run={dry_run} wrote_manifest={write_manifest}", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("push", "manifest"))
    parser.add_argument("--lake-root", type=Path, default=DEFAULT_LAKE_ROOT)
    parser.add_argument("--bucket", default=os.getenv("R2_BUCKET"))
    parser.add_argument("--prefix", default="data-lake")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--workers", type=int, default=16, help="Concurrent object uploads (default: 16)")
    parser.add_argument("--include", action="append", default=[], help="Relative lake path to sync; repeatable")
    parser.add_argument("--offset", type=int, default=0, help="Skip this many selected files")
    parser.add_argument("--limit", type=int, help="Maximum selected files to sync")
    parser.add_argument("--no-manifest", action="store_true", help="Do not update the remote manifest for a partial batch")
    args = parser.parse_args()
    if not args.bucket:
        raise ValueError("Missing R2_BUCKET or --bucket")
    if args.workers < 1 or args.offset < 0 or (args.limit is not None and args.limit < 1):
        raise ValueError("workers must be positive; offset non-negative; limit positive")
    if args.command == "manifest":
        args.dry_run = False
        args.limit = None
        args.offset = 0
        return push(args.lake_root.resolve(), args.bucket, args.prefix, False, args.workers, [], 0, None, True, True)
    return push(args.lake_root.resolve(), args.bucket, args.prefix, args.dry_run, args.workers, args.include, args.offset, args.limit, not args.no_manifest)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ClientError, OSError, ValueError) as error:
        print(f"r2-sync: {error}", file=sys.stderr)
        raise SystemExit(1)
