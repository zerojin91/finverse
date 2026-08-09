# SaveTicker collector

`collectors/saveticker_ingest.py` imports approved SaveTicker news-listing snapshots into the Finverse JSONL data lake. It intentionally imports captured listing metadata rather than scraping undocumented APIs or publisher article bodies.

## Data collected

The input is one JSON snapshot or a directory of JSON snapshots exported from the SaveTicker news listing. The accepted top-level shape is an array of articles, or an object with `articles` or `items` containing that array.

For each article the collector stores title, URL, publication time, displayed source/publisher, summary, tags, country/event taxonomy when present, and the name of the imported snapshot. It creates deterministic IDs from the source URL, or stable metadata when no URL is supplied.

## APIs and environment variables

This collector does not call a SaveTicker API and requires no API key. It is a local importer for snapshots already captured in accordance with SaveTicker's terms and the source site's access rules.

Keep real environment files out of Git. `.env.example` documents standard collector variables; this local importer itself needs none.

## Backfill

Place historical JSON listing snapshots in a local directory, then import the last year:

```bash
python3 collectors/saveticker_ingest.py backfill \
  --input /secure/saveticker-snapshots \
  --start 2025-08-09 --end 2026-08-09
```

The collector can backfill only the dates represented in its input snapshots; it does not claim to reconstruct historical entries not captured by the source.

## Update

After obtaining the newest snapshot, import it with the default 30-day correction window:

```bash
python3 collectors/saveticker_ingest.py update \
  --input /secure/saveticker-snapshots/latest.json
```

For late corrections or reclassified listing entries:

```bash
python3 collectors/saveticker_ingest.py update \
  --input /secure/saveticker-snapshots --lookback-days 90
```

## Output and data format

The importer writes JSONL under `data/saveticker/`:

- `records.jsonl` — append-only normalized article versions.
- `latest.jsonl` — one current record per SaveTicker item.
- `changes.jsonl` — insert/change audit entries and hashes.
- `runs.jsonl`, `state.json`, and `raw/` — import provenance and snapshots.

Repeated imports of identical items do not create duplicates. A changed title, tag, summary, or metadata field creates a new version and audit entry.

## Running on another computer

Install Python 3.12 or newer and clone the repository:

```bash
git clone https://github.com/zerojin91/finverse.git
cd finverse
python3 collectors/saveticker_ingest.py update --input /path/to/latest.json
```

Bring approved snapshot files and the existing `data/saveticker/` folder from the collection server to retain lineage and duplicate history. Snapshots and data-lake outputs are intentionally ignored by Git.
