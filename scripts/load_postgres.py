#!/usr/bin/env python3
"""Load collector JSONL output into the PostgreSQL data lake.

The collectors write versioned JSONL; this moves it into the database the
store was designed to hand off to.  Loading is idempotent: records are keyed by
``record_id`` and only rewritten when ``record_hash`` differs, so re-running the
same load changes nothing.

No Python database driver is required.  The rows are streamed into a staging
table with ``COPY`` through the ``psql`` binary inside the compose service,
which keeps this repository on the standard library like every collector.

    docker compose up -d db
    python3 scripts/load_postgres.py --all
    python3 scripts/load_postgres.py --collector market_ingest
    python3 scripts/load_postgres.py --all --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "data"

# data/<dir> -> collector name recorded in lake.records.collector
COLLECTOR_DIRS = {
    "market": "market_ingest",
    "economic": "economic_ingest",
    "macro_news": "macro_news_ingest",
    "fincept_events": "fincept_event_ingest",
    "saveticker": "saveticker_ingest",
    "youtube_comments": "youtube_comment_ingest",
}


def load_dotenv(root: Path) -> None:
    path = root / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def compose_command() -> list[str]:
    if shutil.which("docker"):
        return ["docker", "compose"]
    raise SystemExit("docker not found; start the database with docker compose first")


def psql(sql: str, *, stdin: bytes | None = None, quiet: bool = False) -> str:
    """Run SQL inside the db service.  -T keeps stdin usable for COPY.

    -tA returns bare values: without it psql prints a header and separator row
    and every parsed number comes back as the column name instead.
    """
    user = os.environ.get("POSTGRES_USER", "finverse")
    database = os.environ.get("POSTGRES_DB", "finverse")
    command = [*compose_command(), "exec", "-T", "db",
               "psql", "-U", user, "-d", database,
               "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-qtA", "-c", sql]
    result = subprocess.run(command, input=stdin, capture_output=True, cwd=ROOT)
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise SystemExit(f"psql failed: {message}")
    if not quiet and result.stderr:
        sys.stderr.write(result.stderr.decode("utf-8", "replace"))
    return result.stdout.decode("utf-8", "replace")


def stream_jsonl(path: Path) -> bytes:
    """Re-emit JSONL as a single-column COPY payload.

    COPY splits on tabs and newlines, so any that appear inside the JSON must be
    escaped or the row will be cut in half.
    """
    chunks: list[bytes] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                json.loads(line)
            except json.JSONDecodeError:
                continue          # skip a torn trailing line rather than abort
            escaped = (line.replace("\\", "\\\\")
                           .replace("\t", "\\t")
                           .replace("\n", "\\n")
                           .replace("\r", "\\r"))
            chunks.append(escaped.encode("utf-8") + b"\n")
    return b"".join(chunks)


def count_lines(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("rb") as handle:
        return sum(1 for line in handle if line.strip())


def load_collector(directory: str, collector: str, *, dry_run: bool) -> dict:
    root = DATA_ROOT / directory
    latest = root / "latest.jsonl"
    changes = root / "changes.jsonl"
    report = {"collector": collector, "directory": directory,
              "latest_lines": count_lines(latest),
              "changes_lines": count_lines(changes)}

    if not latest.exists():
        report["skipped"] = "no latest.jsonl"
        return report
    if dry_run:
        return report

    psql("TRUNCATE lake.staging_records; TRUNCATE lake.staging_changes;", quiet=True)

    payload = stream_jsonl(latest)
    if payload:
        psql("COPY lake.staging_records (doc) FROM STDIN", stdin=payload, quiet=True)
    if changes.exists():
        change_payload = stream_jsonl(changes)
        if change_payload:
            psql("COPY lake.staging_changes (doc) FROM STDIN",
                 stdin=change_payload, quiet=True)

    promoted = psql(
        f"SELECT inserted, updated FROM lake.promote_records({sql_literal(collector)});",
        quiet=True).strip()
    inserted, _, updated = promoted.partition("|")
    report["inserted"] = int(inserted or 0)
    report["updated"] = int(updated or 0)

    audit = psql(f"SELECT lake.promote_changes({sql_literal(collector)});",
                 quiet=True).strip()
    report["changes_loaded"] = int(audit or 0)

    psql("TRUNCATE lake.staging_records; TRUNCATE lake.staging_changes;", quiet=True)
    return report


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def ensure_schema() -> None:
    """The schema file is applied by compose only on a fresh volume."""
    existing = psql(
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_schema = 'lake' AND table_name = 'records';", quiet=True).strip()
    if existing == "0":
        raise SystemExit(
            "lake schema is missing. Apply it once with:\n"
            "  docker compose exec -T db psql -U finverse -d finverse < db/schema.sql")


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collector", action="append",
                        choices=sorted(COLLECTOR_DIRS.values()),
                        help="load one collector; repeatable")
    parser.add_argument("--all", action="store_true", help="load every collector")
    parser.add_argument("--dry-run", action="store_true",
                        help="report what would be loaded without touching the database")
    args = parser.parse_args()

    if not args.all and not args.collector:
        parser.error("pass --all or --collector")

    wanted = set(args.collector or COLLECTOR_DIRS.values())
    if not args.dry_run:
        ensure_schema()

    reports = []
    for directory, collector in COLLECTOR_DIRS.items():
        if collector not in wanted:
            continue
        reports.append(load_collector(directory, collector, dry_run=args.dry_run))

    print(json.dumps({"dry_run": args.dry_run, "loaded": reports}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
