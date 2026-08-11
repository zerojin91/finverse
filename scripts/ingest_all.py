#!/usr/bin/env python3
"""Run every FINVERSE collector, then load the result into PostgreSQL.

One entry point for the whole pipeline so a cron job or a fresh machine does not
need to know each collector's flags.

    python3 scripts/ingest_all.py update                 # daily
    python3 scripts/ingest_all.py backfill                # first run, long
    python3 scripts/ingest_all.py update --load           # also load into Postgres
    python3 scripts/ingest_all.py update --only market_ingest
    python3 scripts/ingest_all.py backfill --dry-run      # print the plan only

Collectors that hit different providers run in parallel; collectors sharing a
provider run one after another.  Rate limits are enforced per provider, so
overlapping two collectors against the same API risks a block and makes it
harder to attribute -- but ECOS and an RSS feed have nothing to do with KRX.
Pass --serial to force the old one-at-a-time behaviour.

A collector that fails does not stop the others; its error is reported and the
exit code becomes non-zero.  Collectors whose required environment variables are
absent are skipped rather than failed, so a partially configured machine still
collects what it can.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
COLLECTORS_DIR = ROOT / "collectors"
LOG_DIR = ROOT / "logs"


class Job:
    """One collector invocation.

    provider groups jobs that talk to the same upstream API. Jobs in a group are
    run in order; groups run concurrently.
    """

    def __init__(self, name: str, script: str, *, provider: str,
                 requires: tuple[str, ...] = (),
                 backfill: tuple[str, ...] = (), update: tuple[str, ...] = (),
                 note: str = "", needs_input: bool = False,
                 lake_collector: str | None = None):
        self.name = name
        self.script = script
        self.provider = provider
        self.requires = requires
        self.backfill = backfill
        self.update = update
        self.note = note
        self.needs_input = needs_input
        # The name load_postgres.py knows this output by, which is the data/
        # directory it lands in rather than the job. Two jobs can share one
        # directory, and asking to load a job name that is not a directory is
        # rejected outright.
        self.lake_collector = lake_collector or name

    def args(self, mode: str) -> tuple[str, ...]:
        return self.backfill if mode == "backfill" else self.update


# Ordered by ontology domain: 시장 -> 경제 -> 외부 사건 -> 심리.
JOBS = [
    Job("market_ingest", "market_ingest.py",
        provider="krx_naver",
        requires=("KRX_AUTH_KEY",),
        backfill=("--source", "all"),
        update=("--source", "krx"),
        note="시장. KRX backfill takes 6-7h; Naver adds prices back to 1990."),
    Job("economic_ingest", "economic_ingest.py",
        provider="ecos_kosis",
        requires=("ECOS_API_KEY",),
        backfill=("--source", "ecos", "--series", "all"),
        update=("--source", "ecos", "--series", "all"),
        note="경제. Bank of Korea ECOS."),
    Job("economic_ingest_kosis", "economic_ingest.py",
        provider="ecos_kosis",
        requires=("KOSIS_API_KEY",),
        backfill=("--source", "kosis", "--series", "all"),
        update=("--source", "kosis", "--series", "all"),
        lake_collector="economic_ingest",
        note="경제. KOSIS. Shares the collector with ECOS, so runs after it."),
    Job("macro_news_ingest", "macro_news_ingest.py",
        provider="rss",
        note="외부 사건. Public RSS; no key required."),
    Job("fincept_event_ingest", "fincept_event_ingest.py",
        provider="fincept",
        requires=("FINCEPT_API_KEY",),
        note="외부 사건. Macro calendar."),
    Job("saveticker_ingest", "saveticker_ingest.py",
        provider="saveticker", needs_input=True,
        note="외부 사건. Local importer; needs --input snapshots, so it is not "
             "run automatically."),
    Job("youtube_comment_ingest", "youtube_comment_ingest.py",
        provider="youtube",
        requires=("YOUTUBE_API_KEY",),
        note="심리. Quota limited; a full backfill spans several days."),
]


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


def missing_env(job: Job) -> list[str]:
    return [name for name in job.requires if not os.environ.get(name)]


def run_job(job: Job, mode: str, *, timeout: int | None) -> dict:
    script = COLLECTORS_DIR / job.script
    command = [sys.executable, str(script), mode, *job.args(mode)]
    started = time.monotonic()
    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / f"{job.name}.log"

    result: dict = {"collector": job.name, "mode": mode,
                    "command": " ".join(command[1:])}
    try:
        with log_path.open("a", encoding="utf-8") as log:
            log.write(f"\n===== {datetime.now(UTC).isoformat()} {mode} =====\n")
            log.flush()
            completed = subprocess.run(
                command, cwd=ROOT, timeout=timeout,
                stdout=subprocess.PIPE, stderr=log, text=True)
        result["exit_code"] = completed.returncode
        tail = (completed.stdout or "").strip().splitlines()
        # Every collector prints a single JSON summary line.
        if tail:
            try:
                result["summary"] = json.loads(tail[-1])
            except json.JSONDecodeError:
                result["output"] = tail[-1][:400]
    except subprocess.TimeoutExpired:
        result["exit_code"] = 124
        result["error"] = f"timed out after {timeout}s"
    except OSError as exc:
        result["exit_code"] = 127
        result["error"] = str(exc)

    result["seconds"] = round(time.monotonic() - started, 1)
    result["log"] = str(log_path.relative_to(ROOT))
    return result


def load_into_postgres(collectors: list[str]) -> dict:
    """Load only what this run collected.

    Loading is a full re-read of each collector's latest.jsonl, and the market
    one is 5.9 GB -- close to an hour of COPY and promotion. Asking for --all
    made the nightly ECOS/RSS job, which collects a few hundred rows, drag the
    entire market lake through Postgres behind it.
    """
    if not collectors:
        return {"skipped": "no collector produced output"}
    command = [sys.executable, str(ROOT / "scripts" / "load_postgres.py")]
    for name in collectors:
        command += ["--collector", name]
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    report: dict = {"exit_code": completed.returncode}
    output = (completed.stdout or "").strip().splitlines()
    if output:
        try:
            report["result"] = json.loads(output[-1])
        except json.JSONDecodeError:
            report["output"] = output[-1][:400]
    if completed.returncode != 0:
        report["error"] = (completed.stderr or "").strip()[:400]
    return report


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=["backfill", "update"])
    parser.add_argument("--only", action="append",
                        choices=[job.name for job in JOBS],
                        help="run just these collectors; repeatable")
    parser.add_argument("--skip", action="append",
                        choices=[job.name for job in JOBS], default=[])
    parser.add_argument("--load", action="store_true",
                        help="load into PostgreSQL after collecting")
    parser.add_argument("--timeout", type=int, default=None,
                        help="per-collector timeout in seconds (default: none)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the plan without running anything")
    parser.add_argument("--serial", action="store_true",
                        help="run one collector at a time instead of one per provider")
    args = parser.parse_args()

    selected = [job for job in JOBS
                if (not args.only or job.name in args.only)
                and job.name not in args.skip]

    plan, results = [], []
    status = 0
    for job in selected:
        if job.needs_input and not args.only:
            plan.append({"collector": job.name, "skipped": "needs --input; run manually"})
            continue
        absent = missing_env(job)
        if absent:
            plan.append({"collector": job.name,
                         "skipped": f"missing env: {', '.join(absent)}"})
            continue
        plan.append({"collector": job.name, "mode": args.mode,
                     "provider": job.provider,
                     "args": list(job.args(args.mode)), "note": job.note})

    if args.dry_run:
        print(json.dumps({"mode": args.mode, "plan": plan}, ensure_ascii=False, indent=2))
        return 0

    started = time.monotonic()
    runnable = [e for e in plan if "skipped" not in e]
    results.extend(e for e in plan if "skipped" in e)
    by_name = {j.name: j for j in selected}

    # One worker per provider. Jobs sharing a provider stay in order inside a
    # worker, so nothing hammers the same API twice at once.
    groups: dict[str, list[dict]] = {}
    for entry in runnable:
        groups.setdefault(by_name[entry["collector"]].provider, []).append(entry)

    lock = threading.Lock()

    def run_group(entries: list[dict]) -> None:
        nonlocal status
        for entry in entries:
            outcome = run_job(by_name[entry["collector"]], args.mode,
                              timeout=args.timeout)
            with lock:
                if outcome.get("exit_code"):
                    status = 1
                results.append(outcome)

    if args.serial or len(groups) <= 1:
        for entries in groups.values():
            run_group(entries)
    else:
        threads = [threading.Thread(target=run_group, args=(e,), daemon=False)
                   for e in groups.values()]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

    report = {"mode": args.mode,
              "parallel_providers": 1 if args.serial else len(groups),
              "finished_at": datetime.now(UTC).isoformat(),
              "seconds": round(time.monotonic() - started, 1),
              "collectors": results}
    if args.load:
        # A collector that exited non-zero still wrote whatever it got before
        # failing, and loading is idempotent, so its output is loaded too.
        collected = sorted({by_name[entry["collector"]].lake_collector
                            for entry in results if "skipped" not in entry})
        report["postgres"] = load_into_postgres(collected)
        if report["postgres"].get("exit_code"):
            status = 1

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return status


if __name__ == "__main__":
    sys.exit(main())
