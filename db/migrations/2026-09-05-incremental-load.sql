-- Incremental loading: watermark table and per-collector promotion.
--
-- This is the database half of scripts/load_postgres.py's incremental path.
-- It ships as a migration rather than an edit to db/schema.sql because that
-- file only ever runs on an empty volume, and the database this needs to reach
-- has 26M rows in it.
--
--   docker compose exec -T db psql -U finverse -d finverse -f - < this file
--
-- Re-runnable: every statement is IF NOT EXISTS, DROP IF EXISTS, or REPLACE.

-- ---------------------------------------------------------------------------
-- Watermark
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
-- ambiguous.
DROP FUNCTION IF EXISTS lake.promote_records(text);
DROP FUNCTION IF EXISTS lake.promote_changes(text);

-- p_staging names the table to promote from, so concurrent loads of different
-- collectors never share one. Two cron jobs sharing lake.staging_records is how
-- 585,835 market rows were silently lost in August: the nightly job truncated
-- staging out from under a load that had not promoted yet, and the load
-- reported "inserted: 0" with exit code 0.
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
