#!/usr/bin/env bash
# Cron-safe wrapper around scripts/ingest_all.py.
#
# A backfill runs for hours -- the Naver per-stock flow backfill alone is days --
# so the next cron tick must not start a second run writing into the same store.
#
# One global lock turned out to be too coarse. A market backfill also blocked the
# nightly ECOS/KOSIS/RSS run, which touches nothing under data/market, and every
# skipped run left no trace at all. Locks are now per scope:
#
#   data/.ingest_all.lock    market_ingest   (path kept: a running backfill holds it)
#   data/.ingest_other.lock  every other collector
#
# A run that cannot take its lock logs one line and exits 0. The previous version
# exited 1 with no output, so a day of skipped runs left logs/cron.log at zero
# bytes and cron sent no mail -- the failure was invisible.
#
#   scripts/run_ingest.sh update --only market_ingest --load
#   scripts/run_ingest.sh update --skip market_ingest --load
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

MARKET_JOB=market_ingest
MARKET_LOCK=data/.ingest_all.lock
OTHER_LOCK=data/.ingest_other.lock
CONFLICT=99   # flock -E: distinguishes "lock busy" from the command's own exit 1

# Which locks does this invocation need? Mirrors ingest_all.py's selection:
# --only narrows the set, --skip removes from it.
ONLY=()
SKIP=()
argv=("$@")
i=0
while (( i < ${#argv[@]} )); do
  case "${argv[i]}" in
    --only)   ONLY+=("${argv[i+1]:-}"); (( i += 2 )); continue ;;
    --only=*) ONLY+=("${argv[i]#--only=}") ;;
    --skip)   SKIP+=("${argv[i+1]:-}"); (( i += 2 )); continue ;;
    --skip=*) SKIP+=("${argv[i]#--skip=}") ;;
  esac
  (( i += 1 ))
done

has_element() {
  local needle=$1 element
  shift
  for element in "$@"; do
    if [[ "$element" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

needs_market=1
needs_other=1
if (( ${#ONLY[@]} > 0 )); then
  needs_market=0
  needs_other=0
  if has_element "$MARKET_JOB" "${ONLY[@]}"; then
    needs_market=1
  fi
  for entry in "${ONLY[@]}"; do
    if [[ "$entry" != "$MARKET_JOB" ]]; then
      needs_other=1
    fi
  done
fi
if (( ${#SKIP[@]} > 0 )) && has_element "$MARKET_JOB" "${SKIP[@]}"; then
  needs_market=0
fi

CMD=("${RUNNER[@]}" "$@")

if ! command -v flock >/dev/null 2>&1; then
  exec "${CMD[@]}"
fi

# -n: give up rather than queue behind a multi-hour backfill. Nesting two flocks
# is safe here precisely because both are non-blocking -- neither can deadlock.
set +e
if (( needs_market && needs_other )); then
  flock -n -E "$CONFLICT" "$MARKET_LOCK" \
    flock -n -E "$CONFLICT" "$OTHER_LOCK" "${CMD[@]}"
elif (( needs_market )); then
  flock -n -E "$CONFLICT" "$MARKET_LOCK" "${CMD[@]}"
elif (( needs_other )); then
  flock -n -E "$CONFLICT" "$OTHER_LOCK" "${CMD[@]}"
else
  echo "[$(date -u +%FT%TZ)] run_ingest: no collector selected; nothing to do"
  exit 0
fi
rc=$?
set -e

if (( rc == CONFLICT )); then
  echo "[$(date -u +%FT%TZ)] run_ingest: skipped, another run holds the lock" \
       "(needs market=$needs_market other=$needs_other) -- args: $*"
  exit 0
fi
exit "$rc"
