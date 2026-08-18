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
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS economy;

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

-- Staging target for COPY.
--
-- One shared pair of tables used to be enough, because loads were assumed to be
-- short and serial. They are not: the market load ran for 14 hours while the
-- nightly economy/news load started at 20:30 and truncated the very table the
-- market load was still filling. The market promotion then found an empty
-- staging table, reported "inserted: 0", and exited 0 -- silently dropping five
-- days and 585,835 rows on the floor. The two cron jobs hold separate file
-- locks so their collectors do not block each other, but nothing guarded these.
--
-- load_postgres.py now gives every collector its own staging pair, derived from
-- the collector name, and only ever truncates its own. These two remain as the
-- template the per-collector tables are created from (LIKE), and for any older
-- caller that still names them directly.
CREATE UNLOGGED TABLE IF NOT EXISTS lake.staging_records (doc jsonb);
CREATE UNLOGGED TABLE IF NOT EXISTS lake.staging_changes (doc jsonb);

-- How far each collector's store has been loaded.
--
-- The store's `changes` table has a monotonic INTEGER PRIMARY KEY `seq`, so
-- "everything new since last time" is a rowid seek rather than a full scan.
-- Keeping the watermark here, next to the rows it describes, means it commits
-- with them: a load that fails leaves the watermark where it was and the next
-- run picks the same work up again.
CREATE TABLE IF NOT EXISTS lake.load_state (
    collector   text PRIMARY KEY,
    last_seq    bigint NOT NULL DEFAULT 0,
    loaded_rows bigint NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Promotion from staging

-- Idempotent: re-loading the same JSONL changes nothing. A revised value has
-- the same record_id but a different record_hash, so it updates in place while
-- lake.changes keeps the previous hash.
-- The single-argument versions must go before the two-argument ones are
-- created. CREATE OR REPLACE only replaces a function of the same signature;
-- adding a parameter overloads instead, and since the new parameter has a
-- default, the old one-argument call would then match both and fail as
-- ambiguous. Dropping first keeps this file re-runnable on an existing
-- database, which is the only way it is ever applied.
DROP FUNCTION IF EXISTS lake.promote_records(text);
DROP FUNCTION IF EXISTS lake.promote_changes(text);

-- p_staging names the table to promote from, so concurrent loads of different
-- collectors never share one. It defaults to the old shared table.
--
-- inserted/updated used to be derived by counting lake.records before and after
-- -- two sequential counts over 25M rows, minutes each, to produce two numbers
-- for a log line. `xmax = 0` is true exactly for tuples this statement inserted
-- rather than updated, so RETURNING gives the same split for free.
CREATE OR REPLACE FUNCTION lake.promote_records(
    p_collector text,
    p_staging   text DEFAULT 'lake.staging_records'
)
RETURNS TABLE (inserted bigint, updated bigint) AS $$
BEGIN
    RETURN QUERY EXECUTE format($fmt$
        WITH promoted AS (
            INSERT INTO lake.records AS r (
                record_id, collector, record_type, source, schema_version,
                record_hash, collected_at, payload
            )
            SELECT
                doc->>'record_id',
                %L,
                coalesce(doc->>'record_type', 'unknown'),
                doc->>'source',
                doc->>'schema_version',
                doc->>'record_hash',
                nullif(doc->>'collected_at', '')::timestamptz,
                doc
            FROM %s
            WHERE doc ? 'record_id' AND doc ? 'record_hash'
            ON CONFLICT (record_id) DO UPDATE
                SET record_type    = excluded.record_type,
                    source         = excluded.source,
                    schema_version = excluded.schema_version,
                    record_hash    = excluded.record_hash,
                    collected_at   = excluded.collected_at,
                    payload        = excluded.payload,
                    loaded_at      = now()
                WHERE r.record_hash IS DISTINCT FROM excluded.record_hash
            RETURNING (xmax = 0) AS was_insert
        )
        SELECT count(*) FILTER (WHERE was_insert),
               count(*) FILTER (WHERE NOT was_insert)
        FROM promoted
    $fmt$, p_collector, p_staging);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lake.promote_changes(
    p_collector text,
    p_staging   text DEFAULT 'lake.staging_changes'
)
RETURNS bigint AS $$
DECLARE
    affected bigint;
BEGIN
    EXECUTE format($fmt$
        INSERT INTO lake.changes (
            record_id, collector, mode, change_type,
            previous_record_hash, record_hash, observed_at
        )
        SELECT
            doc->>'record_id',
            coalesce(doc->>'collector', %L),
            doc->>'mode',
            coalesce(doc->>'change_type', 'unknown'),
            doc->>'previous_record_hash',
            doc->>'record_hash',
            nullif(doc->>'observed_at', '')::timestamptz
        FROM %s
        WHERE doc ? 'record_id' AND doc ? 'record_hash'
        ON CONFLICT (record_id, record_hash, observed_at) DO NOTHING
    $fmt$, p_collector, p_staging);

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
-- External-event views (온톨로지 3. 외부 사건)

-- One row per article. country_codes and event_types are arrays in the payload,
-- exposed as text[] so they can be filtered with the && / = ANY operators.
CREATE OR REPLACE VIEW events.news AS
SELECT
    (payload->>'published_at')::timestamptz  AS published_at,
    payload->>'title'                        AS title,
    payload->>'summary'                      AS summary,
    payload->>'url'                          AS url,
    payload->>'source'                       AS feed,
    payload->>'origin_publisher'             AS publisher,
    ARRAY(SELECT jsonb_array_elements_text(payload->'country_codes'))  AS country_codes,
    ARRAY(SELECT jsonb_array_elements_text(payload->'event_types'))    AS event_types,
    ARRAY(SELECT jsonb_array_elements_text(coalesce(payload->'tickers', '[]'::jsonb))) AS tickers,
    (payload->>'selection_score')::numeric   AS selection_score,
    collected_at,
    record_id
FROM lake.records
WHERE record_type = 'news_article';

-- Daily article counts per feed and event type; useful for spotting a news
-- burst around a market move.
CREATE OR REPLACE VIEW events.news_daily AS
SELECT
    published_at::date        AS publish_date,
    feed,
    unnest(event_types)       AS event_type,
    count(*)                  AS articles
FROM events.news
WHERE published_at IS NOT NULL
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- Economy views (온톨로지 2. 경제)
--
-- One row per (series, period). period_start is the comparable date across
-- cycles: ECOS reports quarterly series as '2006Q3' and monthly ones as
-- '200607', so ordering on period text alone would interleave them wrongly.

CREATE OR REPLACE VIEW economy.observation AS
SELECT
    payload->>'source'                       AS source,
    payload->>'series_name'                  AS series_name,
    payload->>'external_series_id'           AS series_id,
    payload->>'stat_code'                    AS stat_code,
    payload->>'cycle'                        AS cycle,
    payload->>'period'                       AS period,
    nullif(payload->>'period_start','')::date AS period_start,
    (payload->>'value')::numeric             AS value,
    payload->>'unit'                         AS unit,
    collected_at,
    record_id
FROM lake.records
WHERE record_type = 'economic_observation';

-- What series exist and how far back they go.
CREATE OR REPLACE VIEW economy.series AS
SELECT
    source, series_name, series_id, cycle, unit,
    count(*)          AS observations,
    min(period_start) AS first_period,
    max(period_start) AS last_period
FROM economy.observation
GROUP BY source, series_name, series_id, cycle, unit;

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
