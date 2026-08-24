#!/usr/bin/env bash
set -euo pipefail

project_root="${1:-/home/ubuntu/finverse-simulation}"
container_name="finverse-simulation-api"
log_dir="${project_root}/log"
log_file="${log_dir}/finverse-simulation-cutover.log"

mkdir -p "${log_dir}"
cd "${project_root}"

has_active_pipeline() {
  docker top "${container_name}" -eo pid,cmd 2>/dev/null \
    | grep -q '[a]gents.mirofish_pipeline'
}

{
  echo "$(date --iso-8601=seconds) | cutover_wait_started"
  while has_active_pipeline; do
    echo "$(date --iso-8601=seconds) | active_pipeline_detected"
    sleep 30
  done

  # Give the API worker time to persist the subprocess result, then guard
  # against a new job entering during the handoff window.
  sleep 10
  while has_active_pipeline; do
    echo "$(date --iso-8601=seconds) | new_pipeline_detected"
    sleep 30
  done

  echo "$(date --iso-8601=seconds) | cutover_start"
  docker compose \
    --env-file deploy/finverse-simulation.env \
    -f deploy/finverse-simulation.compose.yml \
    up -d --no-deps finverse-simulation-api
  echo "$(date --iso-8601=seconds) | cutover_complete"
} >>"${log_file}" 2>&1
