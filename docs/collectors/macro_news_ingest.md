# Macro news collector

`collectors/macro_news_ingest.py` collects public macroeconomic news and official announcements relevant to Korea and the United States. It is a metadata-first data lake: title, publication time, source URL, taxonomy, and a content fingerprint are stored; publisher article bodies are not copied.

## Data collected

The collector reads public RSS/Atom feeds from the Federal Reserve, Bank of Korea, Korea's Ministry of Economy and Finance, BBC Business, Yonhap News, and MarketWatch. It can also query Google News RSS for US macro, Korean macro, and geopolitical-risk searches.

Each normalized record includes `record_id`, `published_at`, `country`, `event_types`, `impact_targets`, `source`, `title`, `url`, and `importance`.

RSS feeds retain a limited recent history. `backfill` requests the prior year and filters by date, but historical coverage depends on what each publisher or Google News still exposes; it is not a licensed archive of all publisher articles.

## APIs and environment variables

No API key is required: all configured inputs are public RSS feeds. Optional variables in `finverse/.env` are:

```dotenv
FINVERSE_COLLECTOR_USER_AGENT=FinverseCollector/1.0 (personal research contact: replace-me)
HTTP_PROXY=
HTTPS_PROXY=
```

Create the local file from `.env.example`; never commit the real `.env` file.

## Backfill

Run a one-year collection from the repository root:

```bash
python3 collectors/macro_news_ingest.py backfill
```

Set an explicit interval or restrict sources:

```bash
python3 collectors/macro_news_ingest.py backfill \
  --start 2025-08-09 --end 2026-08-09 \
  --sources fed_press bok_press google_us_macro google_kr_macro
```

## Update

The daily update re-reads a rolling 30-day window by default, allowing late RSS publication, corrections, and changed metadata to be captured.

```bash
python3 collectors/macro_news_ingest.py update
python3 collectors/macro_news_ingest.py update --lookback-days 90
```

## Output and data format

Output is local JSONL under `data/macro_news/`:

- `records.jsonl` — append-only normalized versions.
- `latest.jsonl` — current version of every logical record.
- `changes.jsonl` — inserts and changed versions, including before/after hashes.
- `runs.jsonl`, `state.json`, and `raw/` — run metadata, checkpoint, and fetched feed snapshots.

Identical records are not appended twice. A changed source record creates a new version and audit entry instead of overwriting history.

## Running on another computer

Install Python 3.12 or newer, clone the repository, and copy secure runtime variables separately:

```bash
git clone https://github.com/zerojin91/finverse.git
cd finverse
cp .env.example .env
python3 collectors/macro_news_ingest.py update
```

For a continuation on another machine, synchronize the existing `data/macro_news/` directory first. Without it, the script safely creates a new local history and checkpoint.
