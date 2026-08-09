#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if command -v uv >/dev/null 2>&1; then
  RUNNER=(uv run python collectors/youtube_comment_ingest.py)
else
  RUNNER=(python3 collectors/youtube_comment_ingest.py)
fi

mkdir -p data/youtube_comments
if command -v flock >/dev/null 2>&1; then
  exec flock -n data/youtube_comments/.collector.lock "${RUNNER[@]}" "$@"
fi

exec "${RUNNER[@]}" "$@"
