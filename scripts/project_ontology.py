#!/usr/bin/env python3
"""Project the FINVERSE ontology from lake.records into core and graph.

docs/ontology/scenario-ontology.md is the single source of truth. db/ontology.sql
holds the constraints that enforce it and db/projection.sql the functions that
fill it; this is only the driver that applies them in order and refuses to
declare success while the graph violates its own rules.

    scripts/project_ontology.py --apply         # (re)install schema + functions
    scripts/project_ontology.py                 # rebuild the graph
    scripts/project_ontology.py --timeseries    # also refill core.* time series
    scripts/project_ontology.py --check         # report violations only

The rebuild is idempotent: the graph is dropped and rebuilt from core and lake
every time.  Scenario nodes survive because they are reprojected from the
core.scenario_* ledger rather than from the graph itself.

No Python database driver, matching load_postgres.py -- SQL goes through the
psql binary inside the compose service.
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
SCHEMA_FILES = ("db/ontology.sql", "db/projection.sql")


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


def psql(sql: str | None = None, *, stdin: bytes | None = None) -> str:
    if not shutil.which("docker"):
        raise SystemExit("docker not found; start the database with docker compose first")
    user = os.environ.get("POSTGRES_USER", "finverse")
    database = os.environ.get("POSTGRES_DB", "finverse")
    command = ["docker", "compose", "exec", "-T", "db",
               "psql", "-U", user, "-d", database,
               "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-qtA"]
    if sql is not None:
        command += ["-c", sql]
    result = subprocess.run(command, input=stdin, capture_output=True, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(f"psql failed: {result.stderr.decode('utf-8', 'replace').strip()}")
    return result.stdout.decode("utf-8", "replace").strip()


def apply_schema() -> None:
    for name in SCHEMA_FILES:
        path = ROOT / name
        if not path.exists():
            raise SystemExit(f"missing {name}")
        psql(stdin=path.read_bytes())
        print(f"applied {name}", file=sys.stderr)


def violations() -> list[dict]:
    raw = psql("SELECT coalesce(json_agg(row_to_json(v)), '[]') FROM graph.violations() v;")
    return json.loads(raw or "[]")


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true",
                        help="install db/ontology.sql and db/projection.sql first")
    parser.add_argument("--timeseries", action="store_true",
                        help="also refill core.* from lake (expensive: ~9.7M price rows)")
    parser.add_argument("--check", action="store_true",
                        help="report violations without rebuilding")
    args = parser.parse_args()

    report: dict = {}

    if args.apply:
        apply_schema()

    if args.check:
        report["violations"] = violations()
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if report["violations"] else 0

    if args.timeseries:
        report["core"] = json.loads(psql("SELECT core.rebuild_timeseries();"))

    report["graph"] = json.loads(psql("SELECT graph.rebuild();"))

    # A projection that leaves the graph inconsistent is a failed projection,
    # not a warning. Report the offending rows rather than only the count so
    # the next run has something to act on.
    found = violations()
    report["violations"] = found
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
