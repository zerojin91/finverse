#!/usr/bin/env python3
"""Personal macro-event data lake collector.

The collector deliberately keeps the ingestion boundary independent from
Fincept's desktop caches. It stores immutable raw responses (Bronze),
normalizes a canonical model in MySQL, and exports each run to Parquet
(Silver). DuckDB remains available only as the legacy migration source.

Examples:
  MACRO_LAKE_DATABASE_URL=mysql://user:password@127.0.0.1:3306/finverse_macro \
    uv run python tools/macro_lake.py init
  MACRO_LAKE_DATABASE_URL=... uv run python tools/macro_lake.py mysql-migrate
  uv run python tools/macro_lake.py rss
  FRED_API_KEY=... uv run python tools/macro_lake.py fred --series GDP,UNRATE
  uv run python tools/macro_lake.py status
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import json
import os
import re
import sys
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

import duckdb
import pymysql
import pyarrow as pa
import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LAKE_ROOT = ROOT / "data-lake"
USER_AGENT = "FinverseMacroLake/0.1 (personal research; metadata collector)"


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS source_registry (
  source_id VARCHAR PRIMARY KEY,
  source_type VARCHAR NOT NULL,
  publisher VARCHAR NOT NULL,
  base_url VARCHAR,
  trust_tier INTEGER,
  license_note VARCHAR,
  enabled BOOLEAN NOT NULL DEFAULT true,
  registered_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_run (
  run_id VARCHAR PRIMARY KEY,
  collector VARCHAR NOT NULL,
  mode VARCHAR NOT NULL,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status VARCHAR NOT NULL,
  code_version VARCHAR NOT NULL,
  detail_json VARCHAR
);

CREATE TABLE IF NOT EXISTS raw_object (
  raw_id VARCHAR PRIMARY KEY,
  run_id VARCHAR NOT NULL,
  source_id VARCHAR NOT NULL,
  entity_type VARCHAR NOT NULL,
  request_fingerprint VARCHAR NOT NULL,
  storage_uri VARCHAR NOT NULL,
  content_sha256 VARCHAR NOT NULL,
  content_type VARCHAR,
  http_status INTEGER,
  retrieved_at TIMESTAMPTZ NOT NULL,
  parser_version VARCHAR NOT NULL,
  record_count INTEGER,
  UNIQUE(run_id, source_id, entity_type, request_fingerprint)
);

CREATE TABLE IF NOT EXISTS data_quality_issue (
  issue_id VARCHAR PRIMARY KEY,
  run_id VARCHAR NOT NULL,
  raw_id VARCHAR,
  severity VARCHAR NOT NULL,
  rule_id VARCHAR NOT NULL,
  entity_key VARCHAR,
  detail VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS news_article (
  article_id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL,
  canonical_url VARCHAR,
  title VARCHAR NOT NULL,
  summary VARCHAR,
  published_at_utc TIMESTAMPTZ,
  published_at_raw VARCHAR,
  language VARCHAR,
  origin_publisher VARCHAR,
  origin_url VARCHAR,
  country_codes_json VARCHAR NOT NULL,
  topic_codes_json VARCHAR NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  content_hash VARCHAR NOT NULL,
  raw_id VARCHAR NOT NULL,
  id_confidence VARCHAR NOT NULL,
  selection_score INTEGER NOT NULL DEFAULT 0,
  selection_reasons_json VARCHAR NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS news_article_version (
  article_id VARCHAR NOT NULL,
  content_hash VARCHAR NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  title VARCHAR NOT NULL,
  summary VARCHAR,
  raw_id VARCHAR NOT NULL,
  PRIMARY KEY(article_id, content_hash)
);

CREATE TABLE IF NOT EXISTS indicator_definition (
  indicator_id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL,
  native_series_id VARCHAR NOT NULL,
  name VARCHAR,
  country_code VARCHAR,
  frequency VARCHAR,
  unit VARCHAR,
  seasonal_adjustment VARCHAR,
  source_url VARCHAR,
  UNIQUE(source_id, native_series_id)
);

CREATE TABLE IF NOT EXISTS indicator_observation (
  indicator_id VARCHAR NOT NULL,
  observation_period DATE NOT NULL,
  vintage_at TIMESTAMPTZ NOT NULL,
  value DOUBLE,
  value_raw VARCHAR NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  raw_id VARCHAR NOT NULL,
  is_latest BOOLEAN NOT NULL,
  PRIMARY KEY(indicator_id, observation_period, vintage_at)
);

CREATE TABLE IF NOT EXISTS macro_event (
  event_id VARCHAR PRIMARY KEY,
  event_family VARCHAR NOT NULL,
  event_name VARCHAR NOT NULL,
  country_code VARCHAR,
  currency VARCHAR,
  agency VARCHAR,
  frequency VARCHAR,
  scheduled_at_utc TIMESTAMPTZ,
  scheduled_at_local VARCHAR,
  timezone VARCHAR,
  importance INTEGER,
  source_id VARCHAR NOT NULL,
  source_event_key VARCHAR,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  status VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS macro_release (
  release_id VARCHAR PRIMARY KEY,
  event_id VARCHAR NOT NULL,
  release_at_utc TIMESTAMPTZ,
  period_start DATE,
  period_end DATE,
  reference_period_label VARCHAR,
  actual_raw VARCHAR,
  actual_value DOUBLE,
  forecast_raw VARCHAR,
  forecast_value DOUBLE,
  previous_raw VARCHAR,
  previous_value DOUBLE,
  unit VARCHAR,
  revision_of_release_id VARCHAR,
  is_revision BOOLEAN NOT NULL DEFAULT false,
  raw_id VARCHAR NOT NULL,
  published_at TIMESTAMPTZ NOT NULL
);
"""


# MySQL is the operating catalog. Timestamps are persisted as UTC DATETIME(6)
# values: MySQL's TIMESTAMP type silently converts through the server timezone,
# which is undesirable for a cross-market event lake.
MYSQL_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS source_registry (
  source_id VARCHAR(191) PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  publisher VARCHAR(255) NOT NULL,
  base_url TEXT,
  trust_tier INT,
  license_note TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  registered_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ingestion_run (
  run_id CHAR(36) PRIMARY KEY,
  collector VARCHAR(64) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  window_start DATETIME(6),
  window_end DATETIME(6),
  started_at DATETIME(6) NOT NULL,
  finished_at DATETIME(6),
  status VARCHAR(32) NOT NULL,
  code_version VARCHAR(32) NOT NULL,
  detail_json JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_ingestion_run_started_at ON ingestion_run (started_at);

CREATE TABLE IF NOT EXISTS raw_object (
  raw_id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  storage_uri TEXT NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  content_type VARCHAR(255),
  http_status INT,
  retrieved_at DATETIME(6) NOT NULL,
  parser_version VARCHAR(32) NOT NULL,
  record_count INT,
  UNIQUE KEY uq_raw_request (run_id, source_id, entity_type, request_fingerprint),
  KEY idx_raw_run (run_id),
  KEY idx_raw_source_retrieved (source_id, retrieved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS data_quality_issue (
  issue_id CHAR(36) PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  raw_id CHAR(36),
  severity VARCHAR(16) NOT NULL,
  rule_id VARCHAR(128) NOT NULL,
  entity_key VARCHAR(255),
  detail TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_quality_run_rule (run_id, rule_id),
  KEY idx_quality_raw (raw_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS news_article (
  article_id CHAR(64) PRIMARY KEY,
  source_id VARCHAR(191) NOT NULL,
  canonical_url TEXT,
  title TEXT NOT NULL,
  summary MEDIUMTEXT,
  published_at_utc DATETIME(6),
  published_at_raw VARCHAR(255),
  language VARCHAR(16),
  origin_publisher VARCHAR(255),
  origin_url TEXT,
  country_codes_json JSON NOT NULL,
  topic_codes_json JSON NOT NULL,
  first_seen_at DATETIME(6) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  raw_id CHAR(36) NOT NULL,
  id_confidence VARCHAR(16) NOT NULL,
  selection_score INT NOT NULL DEFAULT 0,
  selection_reasons_json JSON NOT NULL,
  KEY idx_news_published (published_at_utc),
  KEY idx_news_source_published (source_id, published_at_utc),
  KEY idx_news_origin_publisher (origin_publisher),
  KEY idx_news_raw (raw_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS news_article_version (
  article_id CHAR(64) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  observed_at DATETIME(6) NOT NULL,
  title TEXT NOT NULL,
  summary MEDIUMTEXT,
  raw_id CHAR(36) NOT NULL,
  PRIMARY KEY(article_id, content_hash),
  KEY idx_news_version_observed (observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS indicator_definition (
  indicator_id VARCHAR(191) PRIMARY KEY,
  source_id VARCHAR(191) NOT NULL,
  native_series_id VARCHAR(191) NOT NULL,
  name VARCHAR(512),
  country_code VARCHAR(8),
  frequency VARCHAR(64),
  unit VARCHAR(128),
  seasonal_adjustment VARCHAR(128),
  source_url TEXT,
  UNIQUE KEY uq_indicator_native (source_id, native_series_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS indicator_observation (
  indicator_id VARCHAR(191) NOT NULL,
  observation_period DATE NOT NULL,
  vintage_at DATETIME(6) NOT NULL,
  value DOUBLE,
  value_raw VARCHAR(255) NOT NULL,
  retrieved_at DATETIME(6) NOT NULL,
  raw_id CHAR(36) NOT NULL,
  is_latest BOOLEAN NOT NULL,
  PRIMARY KEY(indicator_id, observation_period, vintage_at),
  KEY idx_indicator_latest (indicator_id, observation_period, is_latest)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS macro_event (
  event_id CHAR(64) PRIMARY KEY,
  event_family VARCHAR(64) NOT NULL,
  event_name VARCHAR(512) NOT NULL,
  country_code VARCHAR(8),
  currency VARCHAR(8),
  agency VARCHAR(255),
  frequency VARCHAR(64),
  scheduled_at_utc DATETIME(6),
  scheduled_at_local VARCHAR(128),
  timezone VARCHAR(64),
  importance INT,
  source_id VARCHAR(191) NOT NULL,
  source_event_key VARCHAR(255),
  first_seen_at DATETIME(6) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  status VARCHAR(32) NOT NULL,
  KEY idx_event_schedule (scheduled_at_utc),
  KEY idx_event_country_family (country_code, event_family)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS macro_release (
  release_id CHAR(64) PRIMARY KEY,
  event_id CHAR(64) NOT NULL,
  release_at_utc DATETIME(6),
  period_start DATE,
  period_end DATE,
  reference_period_label VARCHAR(128),
  actual_raw VARCHAR(255),
  actual_value DOUBLE,
  forecast_raw VARCHAR(255),
  forecast_value DOUBLE,
  previous_raw VARCHAR(255),
  previous_value DOUBLE,
  unit VARCHAR(128),
  revision_of_release_id CHAR(64),
  is_revision BOOLEAN NOT NULL DEFAULT FALSE,
  raw_id CHAR(36) NOT NULL,
  published_at DATETIME(6) NOT NULL,
  KEY idx_release_event_time (event_id, release_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
"""


@dataclass(frozen=True)
class RawResponse:
    body: bytes
    status: int
    content_type: str
    url: str


@dataclass(frozen=True)
class SelectionDecision:
    include: bool
    score: int
    reasons: list[str]


def now() -> datetime:
    return datetime.now(UTC)


def iso_timestamp(value: datetime | None = None) -> str:
    return (value or now()).isoformat()


def json_compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def canonical_url(url: str) -> str:
    """Remove fragments and analytics query parameters without changing identity."""
    if not url:
        return ""
    parsed = urlparse(url.strip())
    kept_query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith(("utm_", "fbclid", "gclid", "mc_"))
    ]
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, "", urlencode(kept_query), ""))


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    no_tags = re.sub(r"<[^>]+>", " ", value)
    return " ".join(html.unescape(no_tags).split())


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        parsed = parsedate_to_datetime(value)
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except (TypeError, ValueError, IndexError):
        pass
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except ValueError:
        return None


def element_text(item: ET.Element, names: Iterable[str]) -> str:
    wanted = set(names)
    for child in item.iter():
        local_name = child.tag.rsplit("}", 1)[-1]
        if local_name in wanted and (child.text or "").strip():
            return clean_text(child.text)
    return ""


def element_link(item: ET.Element) -> str:
    for child in item.iter():
        if child.tag.rsplit("}", 1)[-1] != "link":
            continue
        href = child.attrib.get("href", "").strip()
        relation = child.attrib.get("rel", "alternate")
        if href and relation in ("", "alternate"):
            return canonical_url(href)
        if (child.text or "").strip():
            return canonical_url(child.text or "")
    return ""


def element_source(item: ET.Element) -> tuple[str | None, str | None]:
    """Return an RSS item's attributed publisher and publisher homepage, if any."""
    for child in item.iter():
        if child.tag.rsplit("}", 1)[-1] != "source":
            continue
        name = clean_text(child.text) or None
        url = canonical_url(child.attrib.get("url", "")) or None
        return name, url
    return None, None


def parse_feed(xml: bytes, source: dict[str, Any]) -> list[dict[str, Any]]:
    root = ET.fromstring(xml)
    items = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1] in {"item", "entry"}]
    articles: list[dict[str, Any]] = []
    for item in items:
        title = element_text(item, ("title",))
        if not title:
            continue
        summary = element_text(item, ("description", "summary", "encoded", "content"))
        published_raw = element_text(item, ("pubDate", "published", "updated", "date"))
        published = parse_datetime(published_raw)
        url = element_link(item)
        origin_publisher, origin_url = element_source(item)
        if url:
            # Multiple topical Google News feeds can return the same article.
            # A shared namespace deduplicates those discovery paths while
            # leaving direct-publisher feeds independent.
            identity_namespace = source.get("identity_namespace", source["source_id"])
            stable_seed = f"{identity_namespace}|{url}"
            confidence = "high"
        else:
            stable_seed = f"{source['source_id']}|{title.casefold()}|{published.isoformat() if published else ''}"
            confidence = "low"
        articles.append(
            {
                "article_id": sha256_text(stable_seed),
                "source_id": source["source_id"],
                "canonical_url": url or None,
                "title": title,
                "summary": summary or None,
                "published_at_utc": iso_timestamp(published) if published else None,
                "published_at_raw": published_raw or None,
                "language": "en",
                "origin_publisher": origin_publisher or source.get("publisher"),
                "origin_url": origin_url,
                "country_codes_json": json_compact([source.get("country_code")]) if source.get("country_code") else "[]",
                "topic_codes_json": json_compact(source.get("topic_codes", [])),
                "content_hash": sha256_text(f"{title}|{summary}"),
                "id_confidence": confidence,
            }
        )
    return articles


def phrase_hits(text: str, groups: dict[str, list[str]]) -> list[str]:
    return [label for label, phrases in groups.items() if any(phrase.casefold() in text for phrase in phrases)]


def select_article(article: dict[str, Any], source: dict[str, Any], policy: dict[str, Any]) -> SelectionDecision:
    """Score Korea/US macro relevance and retain an auditable decision.

    Geopolitical content receives a lower score threshold, but it must still
    connect to Korea/US or to financial-market, semiconductor, or FX impact.
    """
    text = f"{article['title']} {article.get('summary') or ''}".casefold()
    target_codes = set(policy["target_country_codes"])
    country_terms = [term.casefold() for term in policy["target_country_terms"]]
    source_country_match = source.get("country_code") in target_codes
    text_country_match = any(term in text for term in country_terms)
    event_hits = phrase_hits(text, policy["event_terms"])
    impact_hits = phrase_hits(text, policy["impact_terms"])
    is_geopolitical = "GEOPOLITICAL" in event_hits
    trust_tier = int(article.get("trust_tier_override", source.get("trust_tier", 4)))

    score = 0
    reasons: list[str] = []
    if source_country_match:
        score += 2
        reasons.append(f"source_country:{source['country_code']}")
    if text_country_match:
        score += 2
        reasons.append("target_country_mentioned")
    if event_hits:
        score += min(2, len(event_hits))
        reasons.extend(f"event:{item}" for item in event_hits)
    if impact_hits:
        score += min(2, len(impact_hits))
        reasons.extend(f"impact:{item}" for item in impact_hits)
    if trust_tier <= policy["high_trust_tier_max"]:
        score += 1
        reasons.append(f"trust_tier:{trust_tier}")
    if is_geopolitical:
        score += 1
        reasons.append("geopolitical_expanded_scope")

    # An official tier-1 Korea/US release is a primary record once it matches
    # one of the requested event families; ordinary news still needs the full
    # score threshold.
    primary_official_release = source_country_match and trust_tier == 1 and bool(event_hits)
    if is_geopolitical:
        geo_connected = source_country_match or text_country_match or bool(impact_hits)
        include = (
            geo_connected
            and trust_tier <= policy["geopolitical_trust_tier_max"]
            and score >= policy["geopolitical_minimum_score"]
        )
    else:
        include = primary_official_release or (bool(event_hits) and score >= policy["minimum_score"])
    return SelectionDecision(include=include, score=score, reasons=reasons)


class DuckDBLake:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        (root / "warehouse").mkdir(parents=True, exist_ok=True)
        self.con = duckdb.connect(str(root / "warehouse" / "macro.duckdb"))

    def close(self) -> None:
        self.con.close()

    def initialize(self, sources: list[dict[str, Any]]) -> None:
        for folder in ("bronze", "silver", "warehouse"):
            (self.root / folder).mkdir(parents=True, exist_ok=True)
        self.con.execute(SCHEMA_SQL)
        # Additive migration for catalogs created before relevance decisions
        # became part of the article lineage.
        # DuckDB's additive ALTER does not support adding constraints. Fresh
        # catalogs get the NOT NULL defaults from SCHEMA_SQL; existing local
        # catalogs get nullable equivalents and all new writes populate them.
        self.con.execute("ALTER TABLE news_article ADD COLUMN IF NOT EXISTS selection_score INTEGER")
        self.con.execute("ALTER TABLE news_article ADD COLUMN IF NOT EXISTS selection_reasons_json VARCHAR")
        self.con.execute("ALTER TABLE news_article ADD COLUMN IF NOT EXISTS origin_publisher VARCHAR")
        self.con.execute("ALTER TABLE news_article ADD COLUMN IF NOT EXISTS origin_url VARCHAR")
        registered_at = now()
        for source in sources:
            url = source.get("base_url") or source.get("url")
            self.con.execute(
                """
                INSERT INTO source_registry
                (source_id, source_type, publisher, base_url, trust_tier, license_note, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET
                  source_type = excluded.source_type,
                  publisher = excluded.publisher,
                  base_url = excluded.base_url,
                  trust_tier = excluded.trust_tier,
                  license_note = excluded.license_note
                """,
                [
                    source["source_id"],
                    source["source_type"],
                    source["publisher"],
                    url,
                    source.get("trust_tier"),
                    source.get("license_note"),
                    registered_at,
                ],
            )

    def begin_run(self, collector: str, window_start: datetime | None, window_end: datetime | None) -> str:
        run_id = str(uuid.uuid4())
        self.con.execute(
            """INSERT INTO ingestion_run
               (run_id, collector, mode, window_start, window_end, started_at, status, code_version, detail_json)
               VALUES (?, ?, 'incremental', ?, ?, ?, 'running', '0.1.0', '{}')""",
            [run_id, collector, window_start, window_end, now()],
        )
        return run_id

    def finish_run(self, run_id: str, status: str, detail: dict[str, Any]) -> None:
        self.con.execute(
            "UPDATE ingestion_run SET finished_at = ?, status = ?, detail_json = ? WHERE run_id = ?",
            [now(), status, json_compact(detail), run_id],
        )

    def issue(self, run_id: str, severity: str, rule_id: str, detail: str, raw_id: str | None = None) -> None:
        self.con.execute(
            """INSERT INTO data_quality_issue
               (issue_id, run_id, raw_id, severity, rule_id, detail, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [str(uuid.uuid4()), run_id, raw_id, severity, rule_id, detail, now()],
        )

    def save_raw(
        self,
        run_id: str,
        source_id: str,
        entity_type: str,
        request_fingerprint: str,
        body: bytes,
        extension: str,
        content_type: str,
        status: int,
        record_count: int,
    ) -> str:
        raw_id = str(uuid.uuid4())
        ingested_day = now().date().isoformat()
        # A backfill can issue many requests to the same source in one run.
        # Keep every response immutable rather than overwriting the prior
        # payload under the shared run directory.
        relative_dir = (
            Path("bronze")
            / f"source={source_id}"
            / f"entity={entity_type}"
            / f"ingested_date={ingested_day}"
            / f"run={run_id}"
            / f"request={request_fingerprint}"
        )
        raw_dir = self.root / relative_dir
        raw_dir.mkdir(parents=True, exist_ok=True)
        filename = f"payload.{extension}.gz"
        payload_path = raw_dir / filename
        with gzip.open(payload_path, "wb") as target:
            target.write(body)
        checksum = sha256_text(body)
        manifest = {
            "raw_id": raw_id,
            "run_id": run_id,
            "source_id": source_id,
            "entity_type": entity_type,
            "request_fingerprint": request_fingerprint,
            "storage_uri": str(relative_dir / filename),
            "content_sha256": checksum,
            "content_type": content_type,
            "http_status": status,
            "retrieved_at": iso_timestamp(),
            "parser_version": "0.1.0",
            "record_count": record_count,
        }
        (raw_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        self.con.execute(
            """INSERT INTO raw_object
              (raw_id, run_id, source_id, entity_type, request_fingerprint, storage_uri, content_sha256,
               content_type, http_status, retrieved_at, parser_version, record_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0.1.0', ?)""",
            [
                raw_id,
                run_id,
                source_id,
                entity_type,
                request_fingerprint,
                str(relative_dir / filename),
                checksum,
                content_type,
                status,
                now(),
                record_count,
            ],
        )
        return raw_id

    def write_news(self, raw_id: str, articles: list[dict[str, Any]]) -> None:
        observed_at = now()
        for article in articles:
            existing = self.con.execute(
                "SELECT content_hash FROM news_article WHERE article_id = ?", [article["article_id"]]
            ).fetchone()
            if existing is None:
                self.con.execute(
                    """INSERT INTO news_article
                       (article_id, source_id, canonical_url, title, summary, published_at_utc, published_at_raw,
                        language, origin_publisher, origin_url, country_codes_json, topic_codes_json, first_seen_at, last_seen_at, content_hash,
                        raw_id, id_confidence, selection_score, selection_reasons_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [
                        article["article_id"], article["source_id"], article["canonical_url"], article["title"],
                        article["summary"], article["published_at_utc"], article["published_at_raw"],
                        article["language"], article["origin_publisher"], article["origin_url"], article["country_codes_json"], article["topic_codes_json"],
                        observed_at, observed_at, article["content_hash"], raw_id, article["id_confidence"],
                        article["selection_score"], article["selection_reasons_json"],
                    ],
                )
            else:
                self.con.execute(
                    """UPDATE news_article
                       SET last_seen_at = ?, raw_id = ?, selection_score = ?, selection_reasons_json = ?
                       WHERE article_id = ?""",
                    [
                        observed_at, raw_id, article["selection_score"], article["selection_reasons_json"],
                        article["article_id"],
                    ],
                )
            self.con.execute(
                """INSERT INTO news_article_version
                   (article_id, content_hash, observed_at, title, summary, raw_id)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(article_id, content_hash) DO NOTHING""",
                [article["article_id"], article["content_hash"], observed_at, article["title"], article["summary"], raw_id],
            )

    def upsert_fred(
        self, run_id: str, raw_id: str, series_id: str, metadata: dict[str, Any], observations: list[dict[str, Any]]
    ) -> None:
        indicator_id = f"fred:{series_id}"
        self.con.execute(
            """INSERT INTO indicator_definition
              (indicator_id, source_id, native_series_id, name, country_code, frequency, unit,
               seasonal_adjustment, source_url)
              VALUES (?, 'fred', ?, ?, 'US', ?, ?, ?, ?)
              ON CONFLICT(indicator_id) DO UPDATE SET
                name = excluded.name, frequency = excluded.frequency, unit = excluded.unit,
                seasonal_adjustment = excluded.seasonal_adjustment, source_url = excluded.source_url""",
            [
                indicator_id, series_id, metadata.get("title"), metadata.get("frequency"), metadata.get("units"),
                metadata.get("seasonal_adjustment"), f"https://fred.stlouisfed.org/series/{series_id}",
            ],
        )
        vintage = now()
        for row in observations:
            value_raw = row.get("value", ".")
            if value_raw in ("", ".", None):
                continue
            try:
                value = float(value_raw)
            except (TypeError, ValueError):
                self.issue(run_id, "warning", "fred_value_parse", f"{series_id} {row.get('date')}: {value_raw}", raw_id)
                continue
            observation_period = date.fromisoformat(row["date"])
            self.con.execute(
                "UPDATE indicator_observation SET is_latest = false WHERE indicator_id = ? AND observation_period = ?",
                [indicator_id, observation_period],
            )
            self.con.execute(
                """INSERT INTO indicator_observation
                   (indicator_id, observation_period, vintage_at, value, value_raw, retrieved_at, raw_id, is_latest)
                   VALUES (?, ?, ?, ?, ?, ?, ?, true)""",
                [indicator_id, observation_period, vintage, value, str(value_raw), vintage, raw_id],
            )

    def export_silver(self, table: str, run_id: str, partition_name: str) -> Path:
        destination = self.root / "silver" / table / f"{partition_name}={now().date().isoformat()}"
        destination.mkdir(parents=True, exist_ok=True)
        output = destination / f"run={run_id}.parquet"
        escaped = str(output).replace("'", "''")
        if table == "news_articles":
            query = "SELECT * FROM news_article WHERE raw_id IN (SELECT raw_id FROM raw_object WHERE run_id = ?)"
        elif table == "indicator_observations":
            query = "SELECT * FROM indicator_observation WHERE raw_id IN (SELECT raw_id FROM raw_object WHERE run_id = ?)"
        else:
            raise ValueError(f"Unsupported silver export: {table}")
        self.con.execute(f"COPY ({query.replace('?', repr(run_id))}) TO '{escaped}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        return output


class MySQLConnection:
    """Tiny DB-API adapter that preserves the collector's qmark SQL calls."""

    def __init__(self, database_url: str) -> None:
        parsed = urlparse(database_url)
        if parsed.scheme not in {"mysql", "mysql+pymysql"}:
            raise ValueError("MACRO_LAKE_DATABASE_URL must start with mysql://")
        database = unquote(parsed.path.lstrip("/"))
        if not database:
            raise ValueError("MACRO_LAKE_DATABASE_URL must include a database name")
        self.connection = pymysql.connect(
            host=parsed.hostname or "127.0.0.1",
            port=parsed.port or 3306,
            user=unquote(parsed.username or ""),
            password=unquote(parsed.password or ""),
            database=database,
            charset="utf8mb4",
            autocommit=True,
        )

    @staticmethod
    def _value(value: Any) -> Any:
        if isinstance(value, datetime):
            return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value
        if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$", value):
            parsed = parse_datetime(value)
            return parsed.replace(tzinfo=None) if parsed else value
        return value

    @staticmethod
    def _sql(sql: str) -> str:
        return sql.replace("?", "%s")

    def execute(self, sql: str, params: Iterable[Any] | None = None):
        cursor = self.connection.cursor()
        cursor.execute(self._sql(sql), tuple(self._value(value) for value in (params or [])))
        return cursor

    def executemany(self, sql: str, rows: Iterable[Iterable[Any]]) -> None:
        cursor = self.connection.cursor()
        cursor.executemany(self._sql(sql), [tuple(self._value(value) for value in row) for row in rows])
        cursor.close()

    def close(self) -> None:
        self.connection.close()


class MySQLLake(DuckDBLake):
    """MySQL 8 operating catalog; Bronze and Silver remain filesystem layers."""

    def __init__(self, root: Path, database_url: str) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        (root / "warehouse").mkdir(parents=True, exist_ok=True)
        self.con = MySQLConnection(database_url)

    def initialize(self, sources: list[dict[str, Any]]) -> None:
        for folder in ("bronze", "silver", "warehouse"):
            (self.root / folder).mkdir(parents=True, exist_ok=True)
        for statement in (item.strip() for item in MYSQL_SCHEMA_SQL.split(";") if item.strip()):
            try:
                self.con.execute(statement)
            except pymysql.MySQLError as error:
                # Index creation is intentionally idempotent for repeated init.
                if getattr(error, "args", [None])[0] != 1061:
                    raise
        registered_at = now()
        for source in sources:
            url = source.get("base_url") or source.get("url")
            self.con.execute(
                """INSERT INTO source_registry
                (source_id, source_type, publisher, base_url, trust_tier, license_note, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  source_type = VALUES(source_type), publisher = VALUES(publisher),
                  base_url = VALUES(base_url), trust_tier = VALUES(trust_tier),
                  license_note = VALUES(license_note)""",
                [source["source_id"], source["source_type"], source["publisher"], url,
                 source.get("trust_tier"), source.get("license_note"), registered_at],
            )

    def write_news(self, raw_id: str, articles: list[dict[str, Any]]) -> None:
        observed_at = now()
        for article in articles:
            existing = self.con.execute(
                "SELECT content_hash FROM news_article WHERE article_id = ?", [article["article_id"]]
            ).fetchone()
            if existing is None:
                self.con.execute(
                    """INSERT INTO news_article
                       (article_id, source_id, canonical_url, title, summary, published_at_utc, published_at_raw,
                        language, origin_publisher, origin_url, country_codes_json, topic_codes_json, first_seen_at, last_seen_at, content_hash,
                        raw_id, id_confidence, selection_score, selection_reasons_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [article["article_id"], article["source_id"], article["canonical_url"], article["title"],
                     article["summary"], article["published_at_utc"], article["published_at_raw"], article["language"],
                     article["origin_publisher"], article["origin_url"], article["country_codes_json"], article["topic_codes_json"],
                     observed_at, observed_at, article["content_hash"], raw_id, article["id_confidence"],
                     article["selection_score"], article["selection_reasons_json"]],
                )
            else:
                self.con.execute(
                    """UPDATE news_article
                       SET last_seen_at = ?, raw_id = ?, selection_score = ?, selection_reasons_json = ?
                       WHERE article_id = ?""",
                    [observed_at, raw_id, article["selection_score"], article["selection_reasons_json"], article["article_id"]],
                )
            self.con.execute(
                """INSERT IGNORE INTO news_article_version
                   (article_id, content_hash, observed_at, title, summary, raw_id) VALUES (?, ?, ?, ?, ?, ?)""",
                [article["article_id"], article["content_hash"], observed_at, article["title"], article["summary"], raw_id],
            )

    def upsert_fred(
        self, run_id: str, raw_id: str, series_id: str, metadata: dict[str, Any], observations: list[dict[str, Any]]
    ) -> None:
        indicator_id = f"fred:{series_id}"
        self.con.execute(
            """INSERT INTO indicator_definition
              (indicator_id, source_id, native_series_id, name, country_code, frequency, unit, seasonal_adjustment, source_url)
              VALUES (?, 'fred', ?, ?, 'US', ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE name = VALUES(name), frequency = VALUES(frequency), unit = VALUES(unit),
                seasonal_adjustment = VALUES(seasonal_adjustment), source_url = VALUES(source_url)""",
            [indicator_id, series_id, metadata.get("title"), metadata.get("frequency"), metadata.get("units"),
             metadata.get("seasonal_adjustment"), f"https://fred.stlouisfed.org/series/{series_id}"],
        )
        vintage = now()
        for row in observations:
            value_raw = row.get("value", ".")
            if value_raw in ("", ".", None):
                continue
            try:
                value = float(value_raw)
            except (TypeError, ValueError):
                self.issue(run_id, "warning", "fred_value_parse", f"{series_id} {row.get('date')}: {value_raw}", raw_id)
                continue
            observation_period = date.fromisoformat(row["date"])
            self.con.execute(
                "UPDATE indicator_observation SET is_latest = false WHERE indicator_id = ? AND observation_period = ?",
                [indicator_id, observation_period],
            )
            self.con.execute(
                """INSERT INTO indicator_observation
                   (indicator_id, observation_period, vintage_at, value, value_raw, retrieved_at, raw_id, is_latest)
                   VALUES (?, ?, ?, ?, ?, ?, ?, true)""",
                [indicator_id, observation_period, vintage, value, str(value_raw), vintage, raw_id],
            )

    def export_silver(self, table: str, run_id: str, partition_name: str) -> Path:
        destination = self.root / "silver" / table / f"{partition_name}={now().date().isoformat()}"
        destination.mkdir(parents=True, exist_ok=True)
        output = destination / f"run={run_id}.parquet"
        if table == "news_articles":
            query = "SELECT * FROM news_article WHERE raw_id IN (SELECT raw_id FROM raw_object WHERE run_id = ?)"
        elif table == "indicator_observations":
            query = "SELECT * FROM indicator_observation WHERE raw_id IN (SELECT raw_id FROM raw_object WHERE run_id = ?)"
        else:
            raise ValueError(f"Unsupported silver export: {table}")
        cursor = self.con.execute(query, [run_id])
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
        arrow = pa.Table.from_pylist(rows) if rows else pa.Table.from_pydict({column: [] for column in columns})
        pq.write_table(arrow, output, compression="zstd")
        return output


def load_catalog(lake_root: Path) -> dict[str, Any]:
    path = lake_root / "config" / "sources.json"
    if not path.exists():
        raise FileNotFoundError(f"Source catalog not found: {path}")
    catalog = json.loads(path.read_text(encoding="utf-8"))
    sources = catalog.get("sources", [])
    if not isinstance(sources, list):
        raise ValueError("sources.json must contain a sources array")
    if not isinstance(catalog.get("selection_policy"), dict):
        raise ValueError("sources.json must contain a selection_policy object")
    return catalog


def fetch(url: str) -> RawResponse:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1"})
    try:
        with urlopen(request, timeout=30) as response:
            return RawResponse(response.read(), response.status, response.headers.get_content_type(), response.url)
    except HTTPError as error:
        return RawResponse(error.read(), error.code, error.headers.get_content_type(), url)
    except URLError as error:
        raise RuntimeError(f"Network error for {url}: {error.reason}") from error


def rss_command(
    lake: Lake,
    sources: list[dict[str, Any]],
    policy: dict[str, Any],
    requested: str | None,
    start: str,
    end: str,
) -> int:
    selected_ids = set(requested.split(",")) if requested else {
        source["source_id"] for source in sources if source["source_type"] == "rss"
    }
    selected = [source for source in sources if source["source_id"] in selected_ids and source["source_type"] == "rss"]
    missing = selected_ids - {source["source_id"] for source in selected}
    if missing:
        raise ValueError(f"Unknown/non-RSS source IDs: {', '.join(sorted(missing))}")
    window_start = datetime.fromisoformat(start).replace(tzinfo=UTC)
    window_end = datetime.fromisoformat(end).replace(tzinfo=UTC) + timedelta(days=1) - timedelta(microseconds=1)
    if window_end < window_start:
        raise ValueError("rss --end must not precede --start")
    run_id = lake.begin_run("rss", window_start, window_end)
    successes = 0
    failures: list[str] = []
    try:
        for source in selected:
            try:
                response = fetch(source["url"])
                if response.status != 200:
                    raw_id = lake.save_raw(run_id, source["source_id"], "news_article", sha256_text(source["url"]), response.body, "xml", response.content_type, response.status, 0)
                    lake.issue(run_id, "error", "http_status", f"{source['source_id']} returned HTTP {response.status}", raw_id)
                    failures.append(source["source_id"])
                    continue
                parsed_articles = parse_feed(response.body, source)
                articles: list[dict[str, Any]] = []
                skipped_outside_window = 0
                skipped_undated = 0
                for article in parsed_articles:
                    published = parse_datetime(article.get("published_at_utc"))
                    if published is None:
                        skipped_undated += 1
                        continue
                    if not window_start <= published <= window_end:
                        skipped_outside_window += 1
                        continue
                    decision = select_article(article, source, policy)
                    if decision.include:
                        article["selection_score"] = decision.score
                        article["selection_reasons_json"] = json_compact(decision.reasons)
                        articles.append(article)
                # The whole RSS document necessarily contains unselected items.
                # Keep it in memory only; Bronze receives selected source
                # records and the original response hash for lineage.
                selected_payload = {
                    "source_url": response.url,
                    "source_response_sha256": sha256_text(response.body),
                    "retrieved_at": iso_timestamp(),
                    "selected_items": articles,
                }
                raw_id = lake.save_raw(
                    run_id,
                    source["source_id"],
                    "news_article",
                    sha256_text(response.url),
                    json_compact(selected_payload).encode("utf-8"),
                    "json",
                    "application/json",
                    response.status,
                    len(articles),
                )
                lake.write_news(raw_id, articles)
                if not articles:
                    lake.issue(
                        run_id,
                        "warning",
                        "empty_selection",
                        f"{source['source_id']} parsed {len(parsed_articles)}, windowed {len(parsed_articles) - skipped_outside_window - skipped_undated}, selected zero",
                        raw_id,
                    )
                successes += 1
                print(
                    f"rss {source['source_id']}: {len(parsed_articles)} parsed, "
                    f"{skipped_outside_window} outside window, {skipped_undated} undated, {len(articles)} selected"
                )
            except (ET.ParseError, RuntimeError) as error:
                failures.append(source["source_id"])
                lake.issue(run_id, "error", "rss_fetch_or_parse", f"{source['source_id']}: {error}")
                print(f"rss {source['source_id']}: failed: {error}", file=sys.stderr)
        output = lake.export_silver("news_articles", run_id, "published_date")
        status = "success" if not failures else "partial"
        lake.finish_run(run_id, status, {"sources_ok": successes, "sources_failed": failures, "silver": str(output)})
        print(f"run {run_id}: {status}; silver={output}")
        return 0 if successes else 1
    except Exception as error:
        lake.finish_run(run_id, "failed", {"error": str(error)})
        raise


def google_news_url_for_window(url: str, start: date, end_exclusive: date) -> str:
    """Add Google News' inclusive/exclusive date constraints to an RSS query."""
    parsed = urlparse(url)
    query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
    scoped_pairs: list[tuple[str, str]] = []
    found_query = False
    for key, value in query_pairs:
        if key == "q":
            # Google News ignores after/before when a relative `when:` window
            # remains in the same query. The RSS sources use `when:1y` for
            # incremental reads, so strip it before performing an archival
            # date slice.
            value = re.sub(r"\s+when:\S+", "", value, flags=re.IGNORECASE)
            value = f"{value} after:{start.isoformat()} before:{end_exclusive.isoformat()}"
            found_query = True
        scoped_pairs.append((key, value))
    if not found_query:
        raise ValueError(f"Google News source is missing query parameter: {url}")
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, urlencode(scoped_pairs), parsed.fragment))


def google_backfill_command(
    lake: Lake,
    sources: list[dict[str, Any]],
    policy: dict[str, Any],
    requested: str | None,
    start: str,
    end: str,
    chunk_days: int,
) -> int:
    """Backfill configured Google News RSS queries in bounded date slices.

    Google News limits a single feed to a finite result set. Slicing its
    documented personal-use RSS feed by date avoids silently treating the
    newest/relevance-ranked 100 items as a one-year archive.
    """
    if chunk_days < 1 or chunk_days > 31:
        raise ValueError("google-backfill --chunk-days must be between 1 and 31")
    selected_ids = set(requested.split(",")) if requested else {
        source["source_id"] for source in sources if source["source_id"].startswith("google_news_")
    }
    selected = [source for source in sources if source["source_id"] in selected_ids and source["source_id"].startswith("google_news_")]
    missing = selected_ids - {source["source_id"] for source in selected}
    if missing:
        raise ValueError(f"Unknown/non-Google-News source IDs: {', '.join(sorted(missing))}")
    start_day = date.fromisoformat(start)
    end_day = date.fromisoformat(end)
    if end_day < start_day:
        raise ValueError("google-backfill --end must not precede --start")
    window_start = datetime.combine(start_day, datetime.min.time(), tzinfo=UTC)
    window_end = datetime.combine(end_day + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    run_id = lake.begin_run("google_news_backfill", window_start, window_end)
    successes = 0
    failures: list[str] = []
    capped_windows = 0
    try:
        for source in selected:
            cursor = start_day
            while cursor <= end_day:
                next_day = min(cursor + timedelta(days=chunk_days), end_day + timedelta(days=1))
                scoped_source = dict(source)
                scoped_source["url"] = google_news_url_for_window(source["url"], cursor, next_day)
                try:
                    response = fetch(scoped_source["url"])
                    fingerprint = sha256_text(scoped_source["url"])
                    if response.status != 200:
                        raw_id = lake.save_raw(run_id, source["source_id"], "news_article", fingerprint, response.body, "xml", response.content_type, response.status, 0)
                        lake.issue(run_id, "error", "http_status", f"{source['source_id']} {cursor} returned HTTP {response.status}", raw_id)
                        failures.append(f"{source['source_id']}:{cursor}")
                        cursor = next_day
                        continue
                    parsed_articles = parse_feed(response.body, scoped_source)
                    articles: list[dict[str, Any]] = []
                    for article in parsed_articles:
                        published = parse_datetime(article.get("published_at_utc"))
                        if published is None or not window_start <= published < window_end:
                            continue
                        decision = select_article(article, scoped_source, policy)
                        if decision.include:
                            article["selection_score"] = decision.score
                            article["selection_reasons_json"] = json_compact(decision.reasons)
                            articles.append(article)
                    selected_payload = {
                        "source_url": response.url,
                        "source_response_sha256": sha256_text(response.body),
                        "query_window": {"start": cursor.isoformat(), "end_exclusive": next_day.isoformat()},
                        "retrieved_at": iso_timestamp(),
                        "selected_items": articles,
                    }
                    raw_id = lake.save_raw(run_id, source["source_id"], "news_article", fingerprint, json_compact(selected_payload).encode("utf-8"), "json", "application/json", response.status, len(articles))
                    lake.write_news(raw_id, articles)
                    if len(parsed_articles) >= 100:
                        capped_windows += 1
                        lake.issue(run_id, "warning", "google_news_result_cap", f"{source['source_id']} {cursor} returned {len(parsed_articles)} items; reduce --chunk-days for exhaustive coverage", raw_id)
                    successes += 1
                    print(f"google {source['source_id']} {cursor}..{next_day}: {len(parsed_articles)} parsed, {len(articles)} selected")
                except (ET.ParseError, RuntimeError) as error:
                    failures.append(f"{source['source_id']}:{cursor}")
                    lake.issue(run_id, "error", "google_news_fetch_or_parse", f"{source['source_id']} {cursor}: {error}")
                    print(f"google {source['source_id']} {cursor}: failed: {error}", file=sys.stderr)
                cursor = next_day
        output = lake.export_silver("news_articles", run_id, "published_date")
        status = "success" if not failures else "partial"
        lake.finish_run(run_id, status, {"windows_ok": successes, "windows_failed": failures, "result_capped_windows": capped_windows, "silver": str(output)})
        print(f"run {run_id}: {status}; capped_windows={capped_windows}; silver={output}")
        return 0 if successes else 1
    except Exception as error:
        lake.finish_run(run_id, "failed", {"error": str(error)})
        raise


def saveticker_trust_tier(upstream_source: str) -> int:
    normalized = upstream_source.casefold()
    if "로이터" in normalized or "reuters" in normalized:
        return 2
    if "save pick" in normalized:
        return 3
    if "파이낸셜주스" in normalized or "financial juice" in normalized:
        return 3
    return 4


def saveticker_import_command(
    lake: Lake,
    sources: list[dict[str, Any]],
    policy: dict[str, Any],
    input_path: Path,
) -> int:
    """Ingest a snapshot captured from the public SaveTicker /news UI.

    The collector never calls SaveTicker's /api routes.  A browser-capture
    step supplies public card metadata, then this command applies the same
    auditable selection and storage rules as the RSS collectors.
    """
    source = next((item for item in sources if item["source_id"] == "saveticker_news_ui"), None)
    if source is None:
        raise ValueError("Source catalog is missing saveticker_news_ui")
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    captured_at = parse_datetime(payload.get("captured_at")) or now()
    items = payload.get("articles")
    if not isinstance(items, list):
        raise ValueError("SaveTicker snapshot must contain an articles array")
    run_id = lake.begin_run("saveticker_ui", captured_at, captured_at)
    try:
        articles: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = clean_text(str(item.get("title", "")))
            if not title:
                continue
            upstream_source = clean_text(str(item.get("upstream_source", ""))) or "SaveTicker"
            category = clean_text(str(item.get("category", "")))
            tickers = [clean_text(str(ticker)).upper() for ticker in item.get("tickers", []) if clean_text(str(ticker))]
            published = parse_datetime(item.get("published_at_utc"))
            published_raw = clean_text(str(item.get("published_display", ""))) or None
            # The UI presents relative timestamps for fresh cards, so their
            # exact minute changes between snapshots.  Day-level identity
            # keeps repeat captures idempotent while still separating a
            # genuinely new same-title item on a later day.
            identity_day = published.date().isoformat() if published else published_raw or ""
            stable_seed = "|".join(
                ["saveticker", upstream_source.casefold(), title.casefold(), identity_day, ",".join(tickers)]
            )
            summary_parts = [part for part in (category, " ".join(tickers)) if part]
            article = {
                "article_id": sha256_text(stable_seed),
                "source_id": source["source_id"],
                "canonical_url": None,
                "title": title,
                "summary": " | ".join(summary_parts) or None,
                "published_at_utc": iso_timestamp(published) if published else None,
                "published_at_raw": published_raw,
                "language": "ko",
                "origin_publisher": upstream_source,
                "origin_url": None,
                "country_codes_json": "[]",
                "topic_codes_json": json_compact(["MARKET_NEWS", category] if category else ["MARKET_NEWS"]),
                "content_hash": sha256_text(json_compact({"title": title, "source": upstream_source, "category": category, "tickers": tickers, "displayed_at": published_raw})),
                "id_confidence": "medium",
                "trust_tier_override": saveticker_trust_tier(upstream_source),
            }
            decision = select_article(article, source, policy)
            if decision.include:
                article["selection_score"] = decision.score
                article["selection_reasons_json"] = json_compact(decision.reasons)
                articles.append(article)
        selected_payload = {
            "captured_at": iso_timestamp(captured_at),
            "capture_method": "public_saveticker_news_ui",
            "source_page": "https://www.saveticker.com/news",
            "input_sha256": sha256_text(input_path.read_bytes()),
            "selected_items": articles,
        }
        raw_id = lake.save_raw(
            run_id,
            source["source_id"],
            "news_article",
            sha256_text(f"saveticker-ui:{payload.get('captured_at')}:{input_path.name}"),
            json_compact(selected_payload).encode("utf-8"),
            "json",
            "application/json",
            200,
            len(articles),
        )
        lake.write_news(raw_id, articles)
        if not articles:
            lake.issue(run_id, "warning", "empty_selection", f"SaveTicker UI snapshot contained {len(items)} cards but selected zero", raw_id)
        output = lake.export_silver("news_articles", run_id, "published_date")
        lake.finish_run(run_id, "success", {"cards_observed": len(items), "selected": len(articles), "silver": str(output)})
        print(f"saveticker-ui: {len(items)} observed, {len(articles)} selected; silver={output}")
        return 0
    except Exception as error:
        lake.finish_run(run_id, "failed", {"error": str(error)})
        raise


def fred_command(lake: Lake, series: list[str], start: str, end: str) -> int:
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise RuntimeError("FRED_API_KEY is required. Set it only in your shell; it is never written to the lake.")
    run_id = lake.begin_run("fred", datetime.fromisoformat(start).replace(tzinfo=UTC), datetime.fromisoformat(end).replace(tzinfo=UTC))
    successes = 0
    failures: list[str] = []
    try:
        for series_id in series:
            params = urlencode({"series_id": series_id, "observation_start": start, "observation_end": end, "api_key": api_key, "file_type": "json"})
            response = fetch(f"https://api.stlouisfed.org/fred/series/observations?{params}")
            safe_fingerprint = sha256_text(f"fred:observations:{series_id}:{start}:{end}")
            if response.status != 200:
                raw_id = lake.save_raw(run_id, "fred", "indicator_observation", safe_fingerprint, response.body, "json", response.content_type, response.status, 0)
                lake.issue(run_id, "error", "fred_http_status", f"{series_id} returned HTTP {response.status}", raw_id)
                failures.append(series_id)
                continue
            payload = json.loads(response.body)
            metadata_response = fetch(f"https://api.stlouisfed.org/fred/series?{urlencode({'series_id': series_id, 'api_key': api_key, 'file_type': 'json'})}")
            metadata_payload = json.loads(metadata_response.body) if metadata_response.status == 200 else {}
            combined = {"observations": payload, "metadata": metadata_payload}
            raw_id = lake.save_raw(run_id, "fred", "indicator_observation", safe_fingerprint, json_compact(combined).encode(), "json", "application/json", 200, len(payload.get("observations", [])))
            metadata = (metadata_payload.get("seriess") or [{}])[0]
            lake.upsert_fred(run_id, raw_id, series_id, metadata, payload.get("observations", []))
            successes += 1
            print(f"fred {series_id}: {len(payload.get('observations', []))} observations")
        output = lake.export_silver("indicator_observations", run_id, "source")
        status = "success" if not failures else "partial"
        lake.finish_run(run_id, status, {"series_ok": successes, "series_failed": failures, "silver": str(output)})
        print(f"run {run_id}: {status}; silver={output}")
        return 0 if successes else 1
    except Exception as error:
        lake.finish_run(run_id, "failed", {"error": str(error)})
        raise


def migrate_duckdb_to_mysql(lake: MySQLLake, source_path: Path) -> None:
    """Copy the legacy catalog without modifying it; safe to rerun with INSERT IGNORE."""
    if not source_path.exists():
        raise FileNotFoundError(f"Legacy DuckDB catalog not found: {source_path}")
    source = duckdb.connect(str(source_path), read_only=True)
    tables = (
        "source_registry", "ingestion_run", "raw_object", "data_quality_issue", "news_article",
        "news_article_version", "indicator_definition", "indicator_observation", "macro_event", "macro_release",
    )
    try:
        for table in tables:
            columns = source.execute(f"PRAGMA table_info('{table}')").fetchall()
            if not columns:
                continue
            names = [row[1] for row in columns]
            # DuckDB otherwise materializes TIMESTAMPTZ with pytz, which is not
            # part of this collector's runtime. MySQLConnection normalizes the
            # resulting ISO strings to UTC DATETIME values.
            expressions = [
                f"CAST(\"{name}\" AS VARCHAR) AS \"{name}\"" if "TIMESTAMP" in row[2].upper() else f'"{name}"'
                for name, row in zip(names, columns, strict=True)
            ]
            cursor = source.execute(f"SELECT {', '.join(expressions)} FROM \"{table}\"")
            statement = (
                f"INSERT IGNORE INTO `{table}` ({', '.join(f'`{name}`' for name in names)}) "
                f"VALUES ({', '.join('?' for _ in names)})"
            )
            copied = 0
            while batch := cursor.fetchmany(1_000):
                lake.con.executemany(statement, batch)
                copied += len(batch)
            print(f"mysql-migrate {table}: {copied}")
    finally:
        source.close()


def status_command(lake: Any) -> None:
    for label, table in (("sources", "source_registry"), ("runs", "ingestion_run"), ("raw objects", "raw_object"), ("news articles", "news_article"), ("indicator observations", "indicator_observation"), ("quality issues", "data_quality_issue")):
        count = lake.con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        print(f"{label}: {count}")
    timestamp = "CAST(started_at AS CHAR)" if isinstance(lake, MySQLLake) else "CAST(started_at AS VARCHAR)"
    rows = lake.con.execute(f"SELECT collector, status, {timestamp} FROM ingestion_run ORDER BY started_at DESC LIMIT 10").fetchall()
    for collector, status, started_at in rows:
        print(f"  {started_at}  {collector:<8} {status}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lake-root", type=Path, default=DEFAULT_LAKE_ROOT, help="Lake root (default: repository data-lake)")
    parser.add_argument(
        "--backend", choices=("mysql", "duckdb"), default=os.getenv("MACRO_LAKE_BACKEND", "mysql"),
        help="Catalog backend (default: mysql; DuckDB is retained only for legacy inspection/migration)",
    )
    parser.add_argument(
        "--database-url", default=os.getenv("MACRO_LAKE_DATABASE_URL"),
        help="MySQL URL, e.g. mysql://finverse:password@127.0.0.1:3306/finverse_macro",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Create the configured catalog and lake directories")
    mysql_migrate = sub.add_parser("mysql-migrate", help="Copy the legacy DuckDB catalog into the configured MySQL database")
    mysql_migrate.add_argument("--from-duckdb", type=Path, help="Legacy catalog path (default: <lake-root>/warehouse/macro.duckdb)")
    rss = sub.add_parser("rss", help="Collect configured official RSS feeds")
    rss.add_argument("--sources", help="Comma-separated RSS source IDs; defaults to all configured central banks")
    rss.add_argument("--start", default=(date.today() - timedelta(days=365)).isoformat(), help="Inclusive publication date (YYYY-MM-DD)")
    rss.add_argument("--end", default=date.today().isoformat(), help="Inclusive publication date (YYYY-MM-DD)")
    google_backfill = sub.add_parser("google-backfill", help="Backfill configured personal-use Google News RSS queries by date")
    google_backfill.add_argument("--sources", help="Comma-separated Google News source IDs; defaults to all configured Google News sources")
    google_backfill.add_argument("--start", default=(date.today() - timedelta(days=365)).isoformat())
    google_backfill.add_argument("--end", default=date.today().isoformat())
    google_backfill.add_argument("--chunk-days", type=int, default=7, help="Date slice size; use a smaller value when result-cap warnings occur")
    saveticker = sub.add_parser("saveticker-ui", help="Ingest a public /news UI snapshot; does not call SaveTicker APIs")
    saveticker.add_argument("--input", required=True, type=Path, help="Captured SaveTicker public-card JSON")
    fred = sub.add_parser("fred", help="Collect FRED observations; requires FRED_API_KEY")
    fred.add_argument("--series", required=True, help="Comma-separated FRED IDs, e.g. GDP,UNRATE,CPIAUCSL")
    fred.add_argument("--start", default=(date.today() - timedelta(days=365)).isoformat())
    fred.add_argument("--end", default=date.today().isoformat())
    sub.add_parser("status", help="Show catalog counts and recent runs")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    lake_root: Path = args.lake_root.resolve()
    catalog = load_catalog(lake_root)
    sources = catalog["sources"]
    if args.backend == "mysql":
        if not args.database_url:
            raise ValueError("MySQL is the default backend; set MACRO_LAKE_DATABASE_URL or pass --database-url")
        lake: Any = MySQLLake(lake_root, args.database_url)
    else:
        lake = DuckDBLake(lake_root)
    try:
        lake.initialize(sources)
        if args.command == "init":
            print(f"initialized {lake_root}")
            return 0
        if args.command == "mysql-migrate":
            if not isinstance(lake, MySQLLake):
                raise ValueError("mysql-migrate requires --backend mysql")
            source = (args.from_duckdb or (lake_root / "warehouse" / "macro.duckdb")).resolve()
            migrate_duckdb_to_mysql(lake, source)
            print(f"migrated {source} to MySQL")
            return 0
        if args.command == "rss":
            return rss_command(lake, sources, catalog["selection_policy"], args.sources, args.start, args.end)
        if args.command == "google-backfill":
            return google_backfill_command(lake, sources, catalog["selection_policy"], args.sources, args.start, args.end, args.chunk_days)
        if args.command == "saveticker-ui":
            return saveticker_import_command(lake, sources, catalog["selection_policy"], args.input)
        if args.command == "fred":
            series = [item.strip().upper() for item in args.series.split(",") if item.strip()]
            return fred_command(lake, series, args.start, args.end)
        status_command(lake)
        return 0
    finally:
        lake.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, RuntimeError, ValueError, duckdb.Error, pymysql.MySQLError) as error:
        print(f"macro-lake: {error}", file=sys.stderr)
        raise SystemExit(1)
