#!/usr/bin/env bash
# lake -> core -> graph 동기화. 크론에서 매일 이걸 부른다.
#
# graph 는 lake 에서 계산해 만든 파생물이라, 수집이 늘어도 다시 계산하지 않으면
# 그대로다. 이 단계가 크론에 없어서 8/19 상태로 굳어 있었다.
#
# 시장 락을 잡는다. 수집기가 store 를 쓰는 동안 돌 이유가 없고, 락을 못 잡으면
# 조용히 성공한 척하지 않고 그 사실을 남기고 종료한다.
set -uo pipefail
cd /home/ubuntu/finverse
LOG=logs/sync_ontology.log
P=(docker compose exec -T db psql -U finverse -d finverse -v ON_ERROR_STOP=1 --no-psqlrc -qtA)
stamp() { date -u +%FT%TZ; }

exec >> "$LOG" 2>&1
echo "===== $(stamp) sync_ontology ====="

# fd 로 잡아 스크립트가 끝날 때까지 유지한다. `flock -n <file> <cmd>` 형태로 쓰면
# 명령 하나마다 락이 풀렸다 잡히므로 중간에 수집이 끼어들 수 있다.
exec 9>> data/.ingest_all.lock
if ! flock -n 9; then
  echo "[$(stamp)] 수집이 락을 잡고 있어 건너뜀 (다음 회차에 따라잡는다)"
  exit 0
fi

# 1) core.index_daily -- derive 의 250일 이동 통계는 전체 이력이 필요하다.
#    시세(2,286만 행)는 채우지 않는다: 그래프에 값을 넣지 않는다는 방침대로
#    시계열은 API 가 lake 에서 직접 읽는다.
START=$(date -u +%s)
"${P[@]}" -c "
INSERT INTO core.index_daily AS i (
    bas_dd, idx_class, idx_name, source, price_basis,
    open, high, low, close, volume, trading_value, market_cap, change_pct, record_id)
SELECT (payload->>'bas_dd')::date, payload->>'idx_class', payload->>'idx_name',
       payload->>'source', coalesce(payload->>'price_basis', 'unadjusted'),
       (payload->>'open')::numeric, (payload->>'high')::numeric,
       (payload->>'low')::numeric, (payload->>'close')::numeric,
       (payload->>'volume')::bigint, (payload->>'trading_value')::numeric,
       (payload->>'market_cap')::numeric, (payload->>'change_pct')::numeric,
       record_id
FROM lake.records
WHERE record_type = 'market_index_daily'
  AND nullif(payload->>'bas_dd', '') IS NOT NULL
ON CONFLICT (bas_dd, idx_class, idx_name, source) DO UPDATE
    SET close = excluded.close, open = excluded.open, high = excluded.high,
        low = excluded.low, volume = excluded.volume,
        trading_value = excluded.trading_value, market_cap = excluded.market_cap,
        change_pct = excluded.change_pct, record_id = excluded.record_id;"
echo "[$(stamp)] core.index_daily $(( $(date -u +%s) - START ))초, 최신 $("${P[@]}" -c 'select max(bas_dd) from core.index_daily')"

# 2) graph.rebuild() + derive.run(). --apply 로 스키마를 먼저 맞춘다.
START=$(date -u +%s)
python3 scripts/project_ontology.py --apply --derive
RC=$?
echo "[$(stamp)] 투영 exit=$RC, $(( $(date -u +%s) - START ))초"

echo "[$(stamp)] 노드 $("${P[@]}" -c 'select count(*) from graph.node') / 엣지 $("${P[@]}" -c 'select count(*) from graph.edge')"
echo "[$(stamp)] MarketMove 최신 $("${P[@]}" -c "select max(props->>'bas_dd') from graph.node where label='MarketMove'")"
exit $RC
