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
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "data"

# How much COPY payload to hand psql per write. Large enough that the pipe is
# not the bottleneck, small enough that peak memory stays flat regardless of how
# big the JSONL grows.
COPY_BLOCK_BYTES = 4 * 1024 * 1024

# Collectors that predate the shared store write their own JSONL without a
# record envelope. Give them one here rather than rewriting a working collector
# and invalidating its existing output: (record_type, natural key fields).
IDENTITY_FALLBACK = {
    "economic_ingest": ("economic_observation",
                        ("source", "external_series_id", "period")),
}


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


def _drain(stream, sink: list[bytes]) -> None:
    """Read a child pipe to EOF so the child never blocks writing to it."""
    try:
        for chunk in iter(lambda: stream.read(65536), b""):
            sink.append(chunk)
    finally:
        stream.close()


def psql(sql: str, *, stdin=None, quiet: bool = False) -> str:
    """Run SQL inside the db service.  -T keeps stdin usable for COPY.

    -tA returns bare values: without it psql prints a header and separator row
    and every parsed number comes back as the column name instead.

    ``stdin`` is either bytes or an iterable of byte blocks.  An iterable is fed
    to psql as it is produced, so a COPY never has to exist in memory all at
    once.  It used to: the loader joined every escaped line into one bytes
    object and passed it as ``input=``, which on data/market/latest.jsonl (5.9
    GB) reached 3.1 GB of RSS on a 3.7 GB host with no swap and was OOM-killed
    every single run.  That is why lake.records held only the small collectors.
    """
    user = os.environ.get("POSTGRES_USER", "finverse")
    database = os.environ.get("POSTGRES_DB", "finverse")
    command = [*compose_command(), "exec", "-T", "db",
               "psql", "-U", user, "-d", database,
               "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-qtA", "-c", sql]

    if stdin is None or isinstance(stdin, (bytes, bytearray)):
        result = subprocess.run(command, input=stdin, capture_output=True, cwd=ROOT)
        returncode, out, err = result.returncode, result.stdout, result.stderr
    else:
        process = subprocess.Popen(command, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   cwd=ROOT)
        out_chunks: list[bytes] = []
        err_chunks: list[bytes] = []
        # Drain both output pipes on their own threads. Without this a chatty
        # psql could fill its stdout buffer and stop reading our COPY, and the
        # two processes would wait on each other forever.
        readers = [threading.Thread(target=_drain, args=(process.stdout, out_chunks)),
                   threading.Thread(target=_drain, args=(process.stderr, err_chunks))]
        for reader in readers:
            reader.start()
        try:
            for block in stdin:
                process.stdin.write(block)
        except BrokenPipeError:
            pass              # psql died; its stderr below says why
        finally:
            try:
                process.stdin.close()
            except BrokenPipeError:
                pass
        returncode = process.wait()
        for reader in readers:
            reader.join()
        out, err = b"".join(out_chunks), b"".join(err_chunks)

    if returncode != 0:
        raise SystemExit(f"psql failed: {err.decode('utf-8', 'replace').strip()}")
    if not quiet and err:
        sys.stderr.write(err.decode("utf-8", "replace"))
    return out.decode("utf-8", "replace")


def add_identity(record: dict, collector: str) -> dict | None:
    """Give a record the envelope the lake expects, if it lacks one."""
    if record.get("record_id"):
        return record
    spec = IDENTITY_FALLBACK.get(collector)
    if not spec:
        return None               # no key to build from; skip rather than guess
    record_type, key_fields = spec
    key = "|".join(str(record.get(f, "")) for f in key_fields)
    record["record_id"] = hashlib.sha256(key.encode("utf-8")).hexdigest()
    record.setdefault("record_type", record_type)
    if not record.get("record_hash"):
        body = {k: v for k, v in record.items()
                if k not in ("collected_at", "record_hash")}
        record["record_hash"] = hashlib.sha256(
            json.dumps(body, ensure_ascii=False, sort_keys=True,
                       default=str).encode("utf-8")).hexdigest()
    return record


def stream_jsonl(path: Path, collector: str, stats: dict):
    """Yield JSONL re-emitted as single-column COPY payload blocks.

    A generator rather than one joined buffer, so peak memory is one block no
    matter how large the file is.  ``stats`` is filled in as a side effect --
    a generator's return value is not reachable through iteration.

    COPY splits on tabs and newlines, so any that appear inside the JSON must be
    escaped or the row will be cut in half.
    """
    block = bytearray()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                stats["skipped"] += 1   # skip a torn trailing line rather than abort
                continue
            record = add_identity(record, collector)
            if record is None:
                stats["skipped"] += 1
                continue
            encoded = json.dumps(record, ensure_ascii=False, default=str)
            escaped = (encoded.replace("\\", "\\\\")
                              .replace("\t", "\\t")
                              .replace("\n", "\\n")
                              .replace("\r", "\\r"))
            block += escaped.encode("utf-8") + b"\n"
            stats["rows"] += 1
            if len(block) >= COPY_BLOCK_BYTES:
                yield bytes(block)
                block.clear()
    if block:
        yield bytes(block)


def count_lines(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("rb") as handle:
        return sum(1 for line in handle if line.strip())


def load_collector(directory: str, collector: str, *, dry_run: bool) -> dict:
    root = DATA_ROOT / directory
    latest = root / "latest.jsonl"
    changes = root / "changes.jsonl"
    report = {"collector": collector, "directory": directory}

    if not latest.exists():
        report["skipped"] = "no latest.jsonl"
        return report
    if dry_run:
        # Only a dry run pays for counting: on the market lake that is a full
        # pass over 9 GB, and a real load already counts as it streams.
        report["latest_lines"] = count_lines(latest)
        report["changes_lines"] = count_lines(changes)
        return report

    psql("TRUNCATE lake.staging_records; TRUNCATE lake.staging_changes;", quiet=True)

    stats = {"rows": 0, "skipped": 0}
    psql("COPY lake.staging_records (doc) FROM STDIN",
         stdin=stream_jsonl(latest, collector, stats), quiet=True)
    report["latest_lines"] = stats["rows"]
    if stats["skipped"]:
        report["skipped_rows"] = stats["skipped"]
    if changes.exists():
        change_stats = {"rows": 0, "skipped": 0}
        psql("COPY lake.staging_changes (doc) FROM STDIN",
             stdin=stream_jsonl(changes, collector, change_stats), quiet=True)
        report["changes_lines"] = change_stats["rows"]

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
