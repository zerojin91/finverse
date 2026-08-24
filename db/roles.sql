-- Per-person database roles.
--
-- The bootstrap `finverse` superuser must not be shared: a shared password
-- cannot be revoked for one person, leaves no audit trail, and lets anyone
-- DROP the lake. This file creates group roles once; individual logins are
-- added with scripts/db_user.sh and inherit from a group.
--
--   docker compose exec -T db psql -U finverse -d finverse < db/roles.sql
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Group roles. NOLOGIN: they carry privileges, people log in as themselves.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finverse_read') THEN
        CREATE ROLE finverse_read NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finverse_write') THEN
        CREATE ROLE finverse_write NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finverse_loader') THEN
        CREATE ROLE finverse_loader NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finverse_admin') THEN
        CREATE ROLE finverse_admin NOLOGIN;
    END IF;
END
$$;

-- Nobody creates objects in public by default.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- --- read: analysts and the web app ----------------------------------------
GRANT CONNECT ON DATABASE finverse TO finverse_read;
GRANT USAGE ON SCHEMA lake, market, events, economy, psychology TO finverse_read;
GRANT SELECT ON ALL TABLES IN SCHEMA lake, market, events, economy, psychology TO finverse_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA lake, market, events, economy, psychology
    GRANT SELECT ON TABLES TO finverse_read;

-- Staging tables are load scratch space; keep them out of the read surface.
REVOKE ALL ON lake.staging_records, lake.staging_changes FROM finverse_read;

-- --- write: people who may correct data ------------------------------------
GRANT finverse_read TO finverse_write;
GRANT INSERT, UPDATE ON lake.records, lake.changes, lake.runs TO finverse_write;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA lake TO finverse_write;
ALTER DEFAULT PRIVILEGES IN SCHEMA lake GRANT USAGE ON SEQUENCES TO finverse_write;

-- --- loader: the ingestion pipeline ----------------------------------------
-- Needs TRUNCATE on staging and EXECUTE on the promote functions. Deliberately
-- cannot DROP anything.
GRANT finverse_write TO finverse_loader;
GRANT TRUNCATE, INSERT, SELECT ON lake.staging_records, lake.staging_changes
    TO finverse_loader;
GRANT EXECUTE ON FUNCTION lake.promote_records(text) TO finverse_loader;
GRANT EXECUTE ON FUNCTION lake.promote_changes(text) TO finverse_loader;
GRANT DELETE ON lake.records, lake.changes TO finverse_loader;

-- ---------------------------------------------------------------------------
-- Guard rails.
--
-- NOTE: ALTER ROLE ... SET does not inherit through group membership. Setting
-- these on finverse_read has no effect on a person who merely belongs to it,
-- so scripts/db_user.sh applies them to each read login directly. They are
-- repeated here only so a role that logs in as finverse_read itself is safe.
ALTER ROLE finverse_read SET default_transaction_read_only = on;
ALTER ROLE finverse_read SET statement_timeout = '10min';
ALTER ROLE finverse_read SET idle_in_transaction_session_timeout = '5min';

-- --- admin: schema changes and user management -----------------------------
-- Everything the loader can do, plus DDL and the ability to add or revoke
-- people. Deliberately not a superuser: it cannot disable auditing, read
-- other databases, or write to the server filesystem.
GRANT finverse_loader TO finverse_admin;
GRANT ALL ON SCHEMA lake, market, events, economy, psychology TO finverse_admin;
GRANT ALL ON ALL TABLES IN SCHEMA lake, market, events, economy, psychology TO finverse_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA lake TO finverse_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA lake, market, events, economy, psychology GRANT ALL ON TABLES TO finverse_admin;
