#!/usr/bin/env bash
# Cron-safe wrapper around scripts/ingest_all.py.
#
# A backfill runs for hours. Without a lock the next cron tick would start a
# second run writing into the same store, so this exits quietly when one is
# already in flight -- the same pattern scripts/youtube_comment_ingest.sh uses.
#
#   scripts/run_ingest.sh update --only market_ingest --load
#   scripts/run_ingest.sh backfill
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

mkdir -p logs data

if command -v uv >/dev/null 2>&1; then
  RUNNER=(uv run python scripts/ingest_all.py)
else
  RUNNER=(python3 scripts/ingest_all.py)
fi

LOCK=data/.ingest_all.lock

if command -v flock >/dev/null 2>&1; then
  # -n: give up rather than queue behind a multi-hour backfill.
  exec flock -n "$LOCK" "${RUNNER[@]}" "$@"
fi

exec "${RUNNER[@]}" "$@"
