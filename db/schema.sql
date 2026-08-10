-- FINVERSE data lake schema.
--
-- The collectors write versioned JSONL; this is the hand-off point the store
-- was designed for. Every collector produces records with the same envelope
-- (record_id, record_type, source, collected_at, record_hash), so the landing
-- tables are generic and the per-domain shape is exposed through views.
--
-- Applied automatically by docker-compose on first start of an empty volume.
-- Re-applying by hand is safe: everything is IF NOT EXISTS / OR REPLACE.

CREATE SCHEMA IF NOT EXISTS lake;
CREATE SCHEMA IF NOT EXISTS market;

-- ---------------------------------------------------------------------------
-- Landing tables

-- Current version of every record, keyed by the collector's record_id.
CREATE TABLE IF NOT EXISTS lake.records (
    record_id       text PRIMARY KEY,
    collector       text NOT NULL,
    record_type     text NOT NULL,
    source          text,
    schema_version  text,
    record_hash     text NOT NULL,
    collected_at    timestamptz,
    payload         jsonb NOT NULL,
    loaded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS records_type_idx   ON lake.records (record_type);
CREATE INDEX IF NOT EXISTS records_source_idx ON lake.records (source);
-- Most queries filter by business date, which lives inside the payload.
CREATE INDEX IF NOT EXISTS records_basdd_idx
    ON lake.records ((payload->>'bas_dd')) WHERE payload ? 'bas_dd';
CREATE INDEX IF NOT EXISTS records_payload_idx ON lake.records USING gin (payload);

-- Audit stream: what changed and when. Mirrors changes.jsonl.
CREATE TABLE IF NOT EXISTS lake.changes (
    id                    bigserial PRIMARY KEY,
    record_id             text NOT NULL,
    collector             text NOT NULL,
    mode                  text,
    change_type           text NOT NULL,
    previous_record_hash  text,
    record_hash           text NOT NULL,
    observed_at           timestamptz,
    loaded_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (record_id, record_hash, observed_at)
);

CREATE INDEX IF NOT EXISTS changes_record_idx ON lake.changes (record_id, observed_at DESC);

-- One row per collector run.
CREATE TABLE IF NOT EXISTS lake.runs (
    id           bigserial PRIMARY KEY,
    collector    text NOT NULL,
    mode         text,
    finished_at  timestamptz,
    inserted     integer,
    changed      integer,
    unchanged    integer,
    detail       jsonb,
    loaded_at    timestamptz NOT NULL DEFAULT now()
);

-- Staging target for COPY. Truncated at the start of every load.
CREATE UNLOGGED TABLE IF NOT EXISTS lake.staging_records (doc jsonb);
CREATE UNLOGGED TABLE IF NOT EXISTS lake.staging_changes (doc jsonb);

-- ---------------------------------------------------------------------------
-- Promotion from staging

-- Idempotent: re-loading the same JSONL changes nothing. A revised value has
-- the same record_id but a different record_hash, so it updates in place while
-- lake.changes keeps the previous hash.
CREATE OR REPLACE FUNCTION lake.promote_records(p_collector text)
RETURNS TABLE (inserted bigint, updated bigint) AS $$
DECLARE
    before_count bigint;
    affected     bigint;
BEGIN
    SELECT count(*) INTO before_count FROM lake.records WHERE collector = p_collector;

    INSERT INTO lake.records AS r (
        record_id, collector, record_type, source, schema_version,
        record_hash, collected_at, payload
    )
    SELECT
        doc->>'record_id',
        p_collector,
        coalesce(doc->>'record_type', 'unknown'),
        doc->>'source',
        doc->>'schema_version',
        doc->>'record_hash',
        nullif(doc->>'collected_at', '')::timestamptz,
        doc
    FROM lake.staging_records
    WHERE doc ? 'record_id' AND doc ? 'record_hash'
    ON CONFLICT (record_id) DO UPDATE
        SET record_type    = excluded.record_type,
            source         = excluded.source,
            schema_version = excluded.schema_version,
            record_hash    = excluded.record_hash,
            collected_at   = excluded.collected_at,
            payload        = excluded.payload,
            loaded_at      = now()
        WHERE r.record_hash IS DISTINCT FROM excluded.record_hash;

    GET DIAGNOSTICS affected = ROW_COUNT;
    inserted := (SELECT count(*) FROM lake.records WHERE collector = p_collector) - before_count;
    updated  := affected - inserted;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lake.promote_changes(p_collector text)
RETURNS bigint AS $$
DECLARE
    affected bigint;
BEGIN
    INSERT INTO lake.changes (
        record_id, collector, mode, change_type,
        previous_record_hash, record_hash, observed_at
    )
    SELECT
        doc->>'record_id',
        coalesce(doc->>'collector', p_collector),
        doc->>'mode',
        coalesce(doc->>'change_type', 'unknown'),
        doc->>'previous_record_hash',
        doc->>'record_hash',
        nullif(doc->>'observed_at', '')::timestamptz
    FROM lake.staging_changes
    WHERE doc ? 'record_id' AND doc ? 'record_hash'
    ON CONFLICT (record_id, record_hash, observed_at) DO NOTHING;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Market views
--
-- source stays in every view: KRX is unadjusted and Naver is adjusted, so the
-- two disagree on any security with a split. Filter by source deliberately.
-- See docs/collectors/market_ingest.md.

CREATE OR REPLACE VIEW market.price_daily AS
SELECT
    (payload->>'bas_dd')::date            AS trade_date,
    payload->>'ticker'                    AS ticker,
    payload->>'name'                      AS name,
    payload->>'market'                    AS market,
    payload->>'source'                    AS source,
    payload->>'price_basis'               AS price_basis,
    (payload->>'open')::numeric           AS open,
    (payload->>'high')::numeric           AS high,
    (payload->>'low')::numeric            AS low,
    (payload->>'close')::numeric          AS close,
    (payload->>'change_pct')::numeric     AS change_pct,
    (payload->>'volume')::bigint          AS volume,
    (payload->>'trading_value')::bigint   AS trading_value,
    (payload->>'market_cap')::bigint      AS market_cap,
    (payload->>'listed_shares')::bigint   AS listed_shares,
    record_id
FROM lake.records
WHERE record_type = 'market_price_daily';

CREATE OR REPLACE VIEW market.index_daily AS
SELECT
    (payload->>'bas_dd')::date            AS trade_date,
    payload->>'idx_class'                 AS idx_class,
    payload->>'idx_name'                  AS idx_name,
    payload->>'source'                    AS source,
    (payload->>'open')::numeric           AS open,
    (payload->>'high')::numeric           AS high,
    (payload->>'low')::numeric            AS low,
    (payload->>'close')::numeric          AS close,
    (payload->>'change_pct')::numeric     AS change_pct,
    (payload->>'volume')::bigint          AS volume,
    (payload->>'trading_value')::bigint   AS trading_value,
    (payload->>'market_cap')::bigint      AS market_cap,
    record_id
FROM lake.records
WHERE record_type = 'market_index_daily';

CREATE OR REPLACE VIEW market.security AS
SELECT
    payload->>'isin'                      AS isin,
    payload->>'ticker'                    AS ticker,
    payload->>'name'                      AS name,
    payload->>'short_name'                AS short_name,
    payload->>'english_name'              AS english_name,
    payload->>'market'                    AS market,
    payload->>'share_type'                AS share_type,
    nullif(payload->>'listed_on','')::date AS listed_on,
    (payload->>'listed_shares')::bigint   AS listed_shares,
    payload->>'source'                    AS source,
    record_id
FROM lake.records
WHERE record_type = 'market_security';

-- net_value_krw is market-wide (KRW); net_volume is per stock (shares).
-- They are different units -- never sum them together.
CREATE OR REPLACE VIEW market.investor_flow_daily AS
SELECT
    (payload->>'bas_dd')::date            AS trade_date,
    payload->>'target_type'               AS target_type,
    payload->>'target'                    AS target,
    payload->>'investor'                  AS investor,
    (payload->>'net_value_krw')::bigint   AS net_value_krw,
    (payload->>'net_volume')::bigint      AS net_volume,
    payload->>'source'                    AS source,
    record_id
FROM lake.records
WHERE record_type = 'market_investor_flow_daily';

CREATE OR REPLACE VIEW market.foreign_holding_daily AS
SELECT
    (payload->>'bas_dd')::date            AS trade_date,
    payload->>'ticker'                    AS ticker,
    (payload->>'held_shares')::bigint     AS held_shares,
    (payload->>'held_pct')::numeric       AS held_pct,
    payload->>'source'                    AS source,
    record_id
FROM lake.records
WHERE record_type = 'market_foreign_holding_daily';

-- ---------------------------------------------------------------------------
-- Coverage summary, for checking what actually landed.

CREATE OR REPLACE VIEW lake.coverage AS
SELECT
    collector,
    record_type,
    source,
    count(*)                              AS records,
    min(payload->>'bas_dd')               AS first_day,
    max(payload->>'bas_dd')               AS last_day,
    max(loaded_at)                        AS last_loaded_at
FROM lake.records
GROUP BY collector, record_type, source;
