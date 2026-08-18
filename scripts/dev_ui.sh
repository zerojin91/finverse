#!/usr/bin/env bash
# 온톨로지 UI 로컬 기동 — DB 터널 → API → Web.
#
# 서버 Postgres는 tailscale 주소(POSTGRES_BIND)에만 바인딩돼 있어 맥에서 바로 닿지
# 않는다. tailscale이 켜져 있으면 그 주소를 그대로 쓰면 되지만, 꺼져 있어도 되게
# 수집 서버를 경유하는 SSH 포워딩을 기본 경로로 둔다 (로컬 15432 → 서버가 대신 접속).
#
#   scripts/dev_ui.sh          기동
#   scripts/dev_ui.sh --stop   종료
#
# 로그는 .dev-logs/ 에 나뉘어 쌓인다.
set -uo pipefail
cd "$(dirname "$0")/.."

SSH_HOST=${FINVERSE_SSH_HOST:-ubuntu@44.206.56.75}
SSH_KEY=${FINVERSE_SSH_KEY:-$HOME/DEV/finverse/finverse_key.pem}
DB_REMOTE=${FINVERSE_DB_REMOTE:-100.89.226.42:5432}
TUNNEL_PORT=${FINVERSE_TUNNEL_PORT:-15432}
API_PORT=${FINVERSE_API_PORT:-8030}
WEB_PORT=${FINVERSE_WEB_PORT:-5174}
LOG_DIR=.dev-logs

stop() {
  pkill -f "fin_api.main:app" 2>/dev/null && echo "API 종료"
  pkill -f "vite.*${WEB_PORT}" 2>/dev/null
  pkill -f "ssh -f -N .*${TUNNEL_PORT}:${DB_REMOTE}" 2>/dev/null && echo "터널 종료"
  return 0
}

if [[ ${1:-} == "--stop" ]]; then
  stop
  exit 0
fi

mkdir -p "$LOG_DIR"

# 1) DB 터널 — 이미 열려 있으면 그대로 쓴다
if nc -z 127.0.0.1 "$TUNNEL_PORT" 2>/dev/null; then
  echo "터널 이미 열림 (127.0.0.1:${TUNNEL_PORT})"
else
  ssh -f -N -i "$SSH_KEY" -o ExitOnForwardFailure=yes \
      -L "${TUNNEL_PORT}:${DB_REMOTE}" "$SSH_HOST" \
    && echo "터널 열림 127.0.0.1:${TUNNEL_PORT} → ${DB_REMOTE}" \
    || { echo "터널 실패 — SSH 키/호스트를 확인하세요"; exit 1; }
fi

# 2) API
if [[ ! -f .env ]]; then
  echo ".env 없음 — FINVERSE_API_DSN을 넣어야 API가 DB에 붙습니다" >&2
fi
pkill -f "fin_api.main:app" 2>/dev/null
(cd api && uv run --quiet --python 3.12 \
    --with fastapi --with uvicorn --with "psycopg[binary]" --with psycopg-pool \
    python -m uvicorn --app-dir src fin_api.main:app \
    --host 127.0.0.1 --port "$API_PORT" --reload \
    > "../$LOG_DIR/api.log" 2>&1 &)

for _ in $(seq 1 15); do
  sleep 1
  if curl -sf -m 2 "http://127.0.0.1:${API_PORT}/api/health" > /dev/null; then
    echo "API 기동 http://127.0.0.1:${API_PORT}/docs"
    break
  fi
done

# 3) Web
if [[ ! -d web/node_modules ]]; then
  echo "web 의존성 설치 중…"
  (cd web && npm install --silent)
fi
echo "Web 기동 http://127.0.0.1:${WEB_PORT}  (Ctrl+C로 종료, 나머지는 --stop)"
cd web && npm run dev
