# Database

PostgreSQL holds the loaded data lake. Collectors keep writing versioned JSONL;
`scripts/load_postgres.py` moves it into the database, which is the hand-off
point the JSONL store was designed for.

## Starting it

```bash
cp .env.example .env      # then set POSTGRES_PASSWORD
docker compose up -d db
docker compose ps
```

`db/schema.sql` is applied automatically the first time the volume is created.
On an existing volume, apply it by hand:

```bash
docker compose exec -T db psql -U finverse -d finverse < db/schema.sql
docker compose exec -T db psql -U finverse -d finverse < db/roles.sql
```

Data lives in the named volume `finverse-pgdata` and survives `docker compose
down`. `docker compose down -v` deletes it.

## Network access

The database is **not** exposed on the public internet. `POSTGRES_BIND` decides
which interface it listens on:

| Value | Reachable from |
| --- | --- |
| `127.0.0.1` | the host only |
| a Tailscale address such as `100.89.226.42` | devices on the tailnet |
| `0.0.0.0` | anywhere the firewall allows — avoid |

The collector server uses its Tailscale address. Everyone connects over the
tailnet, so a changing home or office IP does not matter and no security-group
rule has to be edited. Verify the binding after any change:

```bash
docker compose ps --format '{{.Name}} {{.Ports}}'   # expect the tailnet IP, not 0.0.0.0
```

Publishing on `0.0.0.0` invites credential-stuffing within hours. If it is ever
necessary, restrict the port to known source addresses in the AWS security group
first and require TLS.

## Accounts

The bootstrap `finverse` superuser is for administration only. It must not be
shared: a shared password cannot be revoked for one person, leaves no audit
trail, and can drop the lake.

Three group roles carry the privileges; people log in as themselves and inherit
from a group.

| Group | Can | Cannot |
| --- | --- | --- |
| `finverse_read` | `SELECT` on `lake` and `market` | write anything; read staging tables |
| `finverse_write` | the above, plus correct records | truncate staging, run promote functions |
| `finverse_loader` | the above, plus the load pipeline | `DROP` anything |

`finverse_read` sessions are forced read-only, time out after 10 minutes, and
are disconnected after 5 minutes idle in a transaction, so one runaway analytic
query cannot block the loader.

```bash
scripts/db_user.sh add jinwoo write     # prints the password and URL once
scripts/db_user.sh add minsu read
scripts/db_user.sh list
scripts/db_user.sh passwd minsu         # rotate
scripts/db_user.sh revoke minsu         # disable login, kill live sessions
```

`revoke` keeps the role so object ownership stays intact and only stops the
login. Passwords are shown once and never stored by the script.

## Connecting

```bash
psql "postgresql://<user>:<password>@100.89.226.42:5432/finverse"
```

GUI clients take the same details: host `100.89.226.42` (or
`finverse-collector.taila68873.ts.net`), port 5432, database `finverse`.

## Loading

```bash
python3 scripts/load_postgres.py --all
python3 scripts/load_postgres.py --collector market_ingest
python3 scripts/load_postgres.py --all --dry-run
```

Loading is idempotent. Records are keyed by `record_id` and only rewritten when
`record_hash` differs, so re-running changes nothing. A revised value updates the
row and appends to `lake.changes` with both hashes, and nothing is silently
overwritten.

Rows are streamed into a staging table with `COPY` through the `psql` binary in
the container, so no Python database driver is needed and the repository stays
on the standard library.

**A collector that is still running has not materialised its JSONL yet.** Large
collectors commit to SQLite in batches and rewrite `latest.jsonl` only at the
end, so load after a run finishes, not during one.

## Schema

`lake.records` holds the current version of every record from every collector
with a common envelope and a `jsonb` payload; `lake.changes` is the audit
stream; `lake.runs` is one row per collector run.

Per-domain shape is exposed as views, so a payload change does not require a
migration:

| View | Contents |
| --- | --- |
| `market.price_daily` | stock daily OHLCV, trading value, market cap, listed shares |
| `market.index_daily` | index and sector index daily OHLCV |
| `market.security` | security master |
| `market.investor_flow_daily` | foreign and institutional net buying |
| `market.foreign_holding_daily` | foreign ownership |
| `lake.coverage` | rows, first and last day per collector, type and source |

```sql
SELECT * FROM lake.coverage ORDER BY record_type;
```

`source` is present in every market view on purpose. KRX prices are unadjusted
and Naver prices are adjusted, so the two disagree on any security with a split.
Filter deliberately — see
[`docs/collectors/market_ingest.md`](collectors/market_ingest.md).

## Sizing

The collector server has 4GB and runs collectors alongside the database, so
`docker-compose.yml` caps the container at 2GB with `shared_buffers=512MB` and
`work_mem=24MB`. `work_mem` is per sort or hash node rather than per connection,
so a single analytic query can use several at once; raise it only if the
database moves to its own host.
