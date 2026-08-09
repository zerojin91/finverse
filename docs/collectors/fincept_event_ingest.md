# Fincept event collector

`collectors/fincept_event_ingest.py` imports macroeconomic calendar events from a Fincept-compatible API into the local JSONL data lake.

## Data collected

The collector requests a date range from the configured macro-events endpoint and normalizes event name, country, scheduled time, actual/forecast/previous values, unit, importance, URL, and the original provider identifier. A deterministic record ID is based on the provider ID when present; otherwise it uses stable identifying fields.

The default endpoint is `/macro/upcoming-events`. For a full one-year backfill, the configured Fincept deployment must expose a range-capable endpoint that returns historical events when given `start` and `end` query parameters.

## APIs and environment variables

Add connection details only to the collector server's `finverse/.env`:

```dotenv
FINCEPT_API_BASE_URL=https://api.fincept.in
FINCEPT_EVENTS_ENDPOINT=/macro/upcoming-events
FINCEPT_API_KEY=
FINCEPT_SESSION_TOKEN=
FINVERSE_COLLECTOR_USER_AGENT=FinverseCollector/1.0 (personal research contact: replace-me)
HTTP_PROXY=
HTTPS_PROXY=
```

`FINCEPT_API_KEY` and `FINCEPT_SESSION_TOKEN` are optional and sent only when present. `FINCEPT_EVENTS_ENDPOINT` can be changed for the endpoint exposed by the deployed Fincept server. Do not commit the real `.env` file.

## Backfill

Run the default one-year backfill:

```bash
python3 collectors/fincept_event_ingest.py backfill
```

Or provide an exact period and page size:

```bash
python3 collectors/fincept_event_ingest.py backfill \
  --start 2025-08-09 --end 2026-08-09 --limit 1000
```

Confirm the endpoint actually returns historical events before treating the run as complete; some calendar endpoints expose upcoming events only.

## Update

The daily update requests the preceding 30 days through today, so revised actuals and calendar changes are captured:

```bash
python3 collectors/fincept_event_ingest.py update
python3 collectors/fincept_event_ingest.py update --lookback-days 90
```

## Output and data format

Files are stored in `data/fincept_events/` as JSONL:

- `records.jsonl` — append-only event versions.
- `latest.jsonl` — current version for each event ID.
- `changes.jsonl` — insert/change audit log with content hashes.
- `runs.jsonl`, `state.json`, and `raw/` — run checkpoint and exact API payloads.

The collector ignores identical repeats. Changed actual values, forecasts, timestamps, or other normalized fields result in a new version and audit record while earlier versions remain available.

## Running on another computer

Install Python 3.12 or newer, clone the repo, and securely copy deployment configuration rather than committing credentials:

```bash
git clone https://github.com/zerojin91/finverse.git
cd finverse
cp .env.example .env
# Populate the Fincept variables in .env from your secret manager.
python3 collectors/fincept_event_ingest.py update
```

To retain history and avoid re-importing versions on a new machine, synchronize the existing `data/fincept_events/` directory from the collection server.
