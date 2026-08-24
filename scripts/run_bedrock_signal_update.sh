#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

mkdir -p data logs
if [[ -x .venv/bin/python ]]; then
  RUNNER=(.venv/bin/python scripts/bedrock_signal_update.py)
elif command -v uv >/dev/null 2>&1; then
  RUNNER=(uv run python scripts/bedrock_signal_update.py)
else
  RUNNER=(python3 scripts/bedrock_signal_update.py)
fi

LOCK=data/.openrouter_signal_update.lock
if command -v flock >/dev/null 2>&1; then
  exec flock -n "$LOCK" "${RUNNER[@]}" "$@"
fi

exec "${RUNNER[@]}" "$@"
