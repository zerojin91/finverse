# Market collector

`collectors/market_ingest.py` ingests Korean market data — indices, sector indices, listed stocks, and foreign/institutional investor flows — into the Finverse JSONL data lake. It covers the **시장** domain of the FINVERSE ontology.

## Data collected

Five record types share one store, distinguished by `record_type`:

| `record_type` | Contents | Coverage |
| --- | --- | --- |
| `market_index_daily` | Index and **sector index** daily OHLCV, trading value, market cap | KRX 2010-01-04+ / Naver 1990+ |
| `market_price_daily` | Stock daily open/high/low/close/volume, trading value, market cap, listed shares | KRX 2010-01-04+ / Naver 1990+ |
| `market_security` | Security master: ISIN, ticker, listing date, share type, par value | current snapshot |
| `market_investor_flow_daily` | Foreign and institutional net buying | 2005+ |
| `market_foreign_holding_daily` | Foreign-held shares and ownership percentage | 2005+ |

Sector indices are not a separate endpoint. KRX delivers them inside the KOSPI and KOSDAQ index series, so collecting indices also collects sectors (`KRX 반도체`, `코스피 200 금융`, `KRX 건설`, and about 111 series in total).

### Two sources, kept side by side

`source` is part of every record's identity, so the two sources never overwrite each other.

| Source | Basis | Range | Supplies |
| --- | --- | --- | --- |
| `krx_open_api` | **unadjusted** prices | 2010-01-04+ | trading value, market cap, listed shares, sector indices |
| `naver_finance` | **adjusted** prices | 1990+ | investor flows, which KRX does not offer at all |

They disagree by design. Samsung Electronics on 2018-04-25 is 2,520,000 KRW under KRX and 50,400 KRW under Naver — exactly 1/50, because of the 50:1 split that took effect on 2018-05-04. From that date onward the two agree exactly. Across the 7.99M overlapping rows, 60.9% match and the 38.6% that differ are all securities with split or merger history.

Choose by purpose:

- **returns, volatility, event detection** → `naver_finance`. Unadjusted prices produce a fake -98% crash on every split date.
- **trading value, market cap, listed shares** → `krx_open_api`. Naver does not provide them.

One more unit trap: market-wide investor flows are denominated in **KRW** (`net_value_krw`), per-stock flows in **shares** (`net_volume`). Do not sum them together.

## APIs and environment variables

### KRX Open API — official, primary

```
host        https://data-dbg.krx.co.kr/svc/apis     (not the openapi.krx.co.kr portal)
auth        request header  AUTH_KEY: <key>
parameter   basDd=YYYYMMDD                          (one business day per call)
```

| Variable | Required | Notes |
| --- | --- | --- |
| `KRX_AUTH_KEY` | yes | Issued at <https://openapi.krx.co.kr/>. Free. **Valid for one year.** |

The key alone is not enough. Each content type needs its own "API 이용신청" filed in the KRX service list, otherwise that endpoint returns `{"respMsg":"Unauthorized API Call"}` even with a valid key. Required entries:

- 지수 → KOSPI 시리즈, KOSDAQ 시리즈, KRX 시리즈
- 주식 → 유가증권·코스닥 일별매매정보, 유가증권·코스닥 종목기본정보
- optional → 코넥스 일별매매정보·종목기본정보 (thin trading; safe to skip)

Unapproved endpoints are skipped and reported under `unapproved_endpoints` in the run summary; the rest of the run continues. If nothing at all is approved the run exits 2, which distinguishes a bad key from a missing content subscription.

### Naver Finance — secondary

No key required. Used for two reasons: the KRX Open API does not publish investor-by-type trading at all, and its history starts in 2010 while Naver reaches back to 1990, which brings the 1997 IMF crisis, the 2000 dot-com collapse, and the 2008 financial crisis into range.

Keep real environment files out of Git. `.env.example` documents the variables.

## Backfill

Collects historical data from the source's earliest available date up to today.

```bash
# KRX, full history (2010-01-04 onwards)
python3 collectors/market_ingest.py backfill --source krx

# Naver, full history (1990 onwards)
python3 collectors/market_ingest.py backfill --source naver

# both
python3 collectors/market_ingest.py backfill --source all

# a bounded window
python3 collectors/market_ingest.py backfill --source krx \
  --start 2024-01-01 --end 2024-12-31

# prices only, skipping investor flows
python3 collectors/market_ingest.py backfill --source naver --no-flows
```

KRX backfill is slow for a structural reason: the API answers one `basDd` per call, so 4,331 business days across five endpoints is roughly 21,600 requests, about six to seven hours. Naver's `siseJson` returns a symbol's entire history in one call, so its price backfill is one request per ticker and finishes in about 30 minutes; its per-stock investor flows are paginated at 20 sessions per page and take considerably longer.

Backfill is resumable. Progress is recorded in `data/market/ingest_state.json`, so rerunning the same command continues from where it stopped. Use `--no-resume` to start over.

`--flow-universe N` limits per-stock investor flows to the first N tickers (default 350). Collecting flows for all ~3,900 listed securities would require roughly 720,000 requests.

## Update

Collects the newest sessions and re-reads recent history so that late exchange revisions land.

```bash
python3 collectors/market_ingest.py update --source krx                    # last 7 days
python3 collectors/market_ingest.py update --source krx --lookback-days 30
python3 collectors/market_ingest.py update --source all
```

Update deliberately ignores the resume state and re-reads days it already holds; otherwise a corrected close would never be noticed. Duplicates are discarded by the store, so a wide correction window costs requests but not disk.

A KRX update covers five to seven business days across five endpoints — about 30 requests, well under a minute, suitable for a daily cron. A Naver update re-reads the whole ticker universe and takes 20 minutes or more, so weekly is more appropriate.

```cron
0 19 * * 1-5  cd /home/ubuntu/finverse && python3 collectors/market_ingest.py update --source krx >> logs/market_ingest.log 2>&1
0 3 * * 0     cd /home/ubuntu/finverse && python3 collectors/market_ingest.py update --source naver --lookback-days 30 >> logs/market_ingest.log 2>&1
```

## Output and data format

The collector writes JSONL under `data/market/` through the indexed store, which keeps per-record memory constant — necessary because a full backfill produces more than 20 million records.

- `records.jsonl` — append-only normalized record versions.
- `latest.jsonl` — one current record per identity.
- `changes.jsonl` — insert/change audit entries with previous and current hashes.
- `runs.jsonl`, `state.json`, `index.sqlite3`, and `raw/` — run provenance and the queryable index.
- `ingest_state.json` — which business days and tickers are already collected, for resume.

A price record:

```json
{
  "record_id": "b41c…", "record_type": "market_price_daily",
  "source": "krx_open_api", "price_basis": "unadjusted",
  "bas_dd": "20260803", "ticker": "000020", "name": "동화약품", "market": "KOSPI",
  "open": 4680.0, "high": 4840.0, "low": 4640.0, "close": 4760.0,
  "volume": 145621, "trading_value": 692273060,
  "market_cap": 132953797200, "listed_shares": 27931470, "change_pct": 1.71,
  "schema_version": "1.0", "collected_at": "…", "record_hash": "…"
}
```

`record_id` is a SHA-256 over the business key, which always includes the source:

| `record_type` | Business key |
| --- | --- |
| `market_price_daily` | source + `bas_dd` + ticker |
| `market_index_daily` | source + `bas_dd` + `idx_class` + `idx_name` |
| `market_security` | source + ISIN |
| `market_investor_flow_daily` | source + `bas_dd` + `target_type` + target + investor |
| `market_foreign_holding_daily` | source + `bas_dd` + ticker |

Repeated runs over the same dates do not create duplicates. When the exchange revises a value, the identity is unchanged but the hash differs, so the record gains a new version in `records.jsonl` and an audit entry in `changes.jsonl` recording both hashes. Values are never silently overwritten.

Each run prints a single JSON line:

```json
{"mode": "update", "sources": ["krx"], "start": "2026-08-03", "end": "2026-08-10",
 "unapproved_endpoints": ["knx_bydd_trd", "knx_isu_base_info"],
 "inserted": 0, "changed": 0, "unchanged": 17233}
```

Two guards worth knowing about. Querying a market holiday can echo the previous session's data; records whose `BAS_DD` does not match the requested day are dropped so the trading calendar stays clean. And a network outage would otherwise burn through the whole ticker universe reporting success with nothing collected, so five consecutive failures abort the run with `aborted` in the summary.

## Running on another computer

Install Python 3.12 or newer and clone the repository:

```bash
git clone https://github.com/zerojin91/finverse.git
cd finverse
cp .env.example .env      # then fill in KRX_AUTH_KEY
python3 collectors/market_ingest.py update --source krx
```

The collector uses only the standard library, so no extra packages are needed.

Bring the existing `data/market/` folder from the collection server to retain lineage and duplicate history; data-lake outputs are intentionally ignored by Git. Without it the new machine starts from an empty store and a backfill is required.

`KRX_AUTH_KEY` expires one year after issue. On expiry every endpoint returns 401 at once, which surfaces as an `errors` entry and exit code 2 rather than a partial `unapproved_endpoints` list.
