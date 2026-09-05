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
CREATE SCHEMA IF NOT EXISTS psychology;

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
CREATE INDEX IF NOT EXISTS records_type_collected_idx
    ON lake.records (record_type, collected_at DESC NULLS LAST);
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
-- Community psychology views (온톨로지 4. 사람들의 심리)
--
-- YouTube comments are stored as source records.  These views expose a
-- read-only, date-indexed analysis surface without copying or modifying the
-- original comment payloads.  Sentiment is a transparent keyword proxy, not
-- an LLM-generated label; consumers must use it as an auxiliary signal only.

CREATE OR REPLACE VIEW psychology.youtube_comment AS
SELECT
    nullif(c.payload->>'published_at', '')::timestamptz AS published_at,
    nullif(c.payload->>'updated_at', '')::timestamptz   AS updated_at,
    c.payload->>'channel_id'                            AS channel_id,
    c.payload->>'video_id'                              AS video_id,
    c.payload->>'text'                                  AS comment_text,
    coalesce(nullif(c.payload->>'like_count', '')::integer, 0) AS like_count,
    coalesce(nullif(c.payload->>'reply_count', '')::integer, 0) AS reply_count,
    c.payload->>'source_url'                            AS source_url,
    c.collected_at,
    c.record_id,
    v.payload->>'title'                                 AS video_title,
    v.payload->'video_filter_terms'                     AS video_filter_terms,
    v.payload->'search_tags'                            AS search_tags,
    v.payload->'search_matches'                         AS search_matches
FROM lake.records AS c
JOIN lake.records AS v
  ON v.record_type = 'youtube_video'
 AND v.payload->>'video_id' = c.payload->>'video_id'
 AND (v.payload->>'video_filter' = 'semiconductor' OR v.payload ? 'search_tags')
 AND coalesce(nullif(v.payload->>'is_deleted', '')::boolean, false) = false
WHERE c.record_type = 'youtube_comment'
  AND coalesce(nullif(c.payload->>'is_deleted', '')::boolean, false) = false
  AND nullif(c.payload->>'published_at', '') IS NOT NULL
  AND nullif(c.payload->>'text', '') IS NOT NULL;

CREATE OR REPLACE VIEW psychology.sentiment_daily AS
WITH classified AS (
    SELECT
        published_at::date AS sentiment_date,
        comment_text,
        like_count,
        reply_count,
        CASE
            WHEN comment_text ~* '상승|반등|매수|매집|호재|돌파|신고가|강세|오르' THEN 1
            WHEN comment_text ~* '하락|폭락|매도|손절|악재|붕괴|공포|약세|떨어' THEN -1
            ELSE 0
        END AS sentiment_proxy
    FROM psychology.youtube_comment
)
SELECT
    sentiment_date,
    count(*) AS comment_count,
    count(*) FILTER (WHERE sentiment_proxy = 1) AS bullish_count,
    count(*) FILTER (WHERE sentiment_proxy = -1) AS bearish_count,
    count(*) FILTER (WHERE sentiment_proxy = 0) AS neutral_count,
    round(avg(sentiment_proxy)::numeric, 4) AS sentiment_score,
    sum(like_count + reply_count) AS engagement_count
FROM classified
GROUP BY sentiment_date;

CREATE OR REPLACE VIEW psychology.narratives AS
WITH classified AS (
    SELECT
        published_at::date AS narrative_date,
        CASE
            WHEN comment_text ~* '반도체|삼성전자|삼성|하이닉스|HBM|메모리' THEN '반도체 투자심리'
            WHEN comment_text ~* '코스피|국장|외국인|증시|주식시장|수급|환율' THEN '국내 증시 신뢰·수급'
            WHEN comment_text ~* '매수|매도|손절|물타기|풀매수|현금|포트폴리오' THEN '개인 투자 행동'
        END AS narrative_topic,
        comment_text,
        like_count,
        reply_count,
        source_url,
        published_at
    FROM psychology.youtube_comment
)
SELECT
    narrative_date,
    narrative_topic,
    count(*) AS mention_count,
    sum(like_count + reply_count) AS engagement_count,
    (array_agg(comment_text ORDER BY like_count DESC, reply_count DESC, published_at DESC))[1] AS representative_comment,
    (array_agg(source_url ORDER BY like_count DESC, reply_count DESC, published_at DESC))[1] AS representative_source_url
FROM classified
WHERE narrative_topic IS NOT NULL
GROUP BY narrative_date, narrative_topic;

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
