"""SQLite-indexed, versioned JSONL persistence for large collectors.

SQLite is the transactional source of truth.  The JSONL files remain the
portable public outputs and are materialised from SQLite with bounded memory.
"""

from __future__ import annotations

from contextlib import closing
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Iterable, Iterator
import uuid

try:
    from ._jsonl_store import canonical_json, sha256, utc_now
except ImportError:
    from _jsonl_store import canonical_json, sha256, utc_now


SEARCH_COLUMNS = (
    "record_type",
    "channel_id",
    "video_id",
    "thread_id",
    "published_at",
    "last_full_comment_scan_at",
    "is_deleted",
    "refreshed_at",
    "expires_at",
)
TIME_COLUMNS = {
    "published_at",
    "last_full_comment_scan_at",
    "refreshed_at",
    "expires_at",
}


class IndexedJsonlStore:
    """Versioned JSONL store backed by a queryable SQLite index."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.raw_root = root / "raw"
        self.history_path = root / "records.jsonl"
        self.latest_path = root / "latest.jsonl"
        self.changes_path = root / "changes.jsonl"
        self.runs_path = root / "runs.jsonl"
        self.state_path = root / "state.json"
        self.index_path = root / "index.sqlite3"
        self.generations_root = root / ".jsonl-generations"
        self.current_generation_path = root / ".jsonl-current"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.raw_root.mkdir(exist_ok=True, mode=0o700)
        self.generations_root.mkdir(exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        self._initialize()
        os.chmod(self.index_path, 0o600)
        self._import_existing_if_empty()

    def connect(self) -> sqlite3.Connection:
        """Return a configured public connection; callers must close it."""
        connection = sqlite3.connect(self.index_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 30000")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("PRAGMA secure_delete = ON")
        return connection

    def _initialize(self) -> None:
        with closing(self.connect()) as connection, connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS latest (
                    record_id TEXT PRIMARY KEY,
                    record_hash TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    record_type TEXT,
                    channel_id TEXT,
                    video_id TEXT,
                    thread_id TEXT,
                    published_at TEXT,
                    last_full_comment_scan_at TEXT,
                    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
                    refreshed_at TEXT,
                    expires_at TEXT
                );

                CREATE TABLE IF NOT EXISTS versions (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    record_id TEXT NOT NULL,
                    record_hash TEXT NOT NULL,
                    collected_at TEXT,
                    expires_at TEXT,
                    record_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS changes (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    record_id TEXT NOT NULL,
                    change_type TEXT NOT NULL,
                    observed_at TEXT,
                    expires_at TEXT,
                    change_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runs (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    finished_at TEXT,
                    run_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS state (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_latest_record_type ON latest(record_type);
                CREATE INDEX IF NOT EXISTS idx_latest_channel_id ON latest(channel_id);
                CREATE INDEX IF NOT EXISTS idx_latest_video_id ON latest(video_id);
                CREATE INDEX IF NOT EXISTS idx_latest_thread_id ON latest(thread_id);
                CREATE INDEX IF NOT EXISTS idx_latest_published_at ON latest(published_at);
                CREATE INDEX IF NOT EXISTS idx_latest_full_scan
                    ON latest(last_full_comment_scan_at);
                CREATE INDEX IF NOT EXISTS idx_latest_is_deleted ON latest(is_deleted);
                CREATE INDEX IF NOT EXISTS idx_latest_refreshed_at ON latest(refreshed_at);
                CREATE INDEX IF NOT EXISTS idx_latest_expires_at ON latest(expires_at);
                CREATE INDEX IF NOT EXISTS idx_versions_record_id ON versions(record_id);
                CREATE INDEX IF NOT EXISTS idx_versions_expires_at ON versions(expires_at);
                CREATE INDEX IF NOT EXISTS idx_changes_expires_at ON changes(expires_at);
                """
            )
            connection.execute("PRAGMA user_version = 1")

    @staticmethod
    def _normalise_time(value: Any) -> str | None:
        if value is None or value == "":
            return None
        text = str(value)
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return text
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()

    @classmethod
    def _index_values(cls, record: dict[str, Any]) -> tuple[Any, ...]:
        def text(name: str) -> str | None:
            value = record.get(name)
            return None if value is None else str(value)

        return (
            text("record_type"),
            text("channel_id"),
            text("video_id"),
            text("thread_id"),
            cls._normalise_time(record.get("published_at")),
            cls._normalise_time(record.get("last_full_comment_scan_at")),
            int(bool(record.get("is_deleted", False))),
            cls._normalise_time(record.get("refreshed_at")),
            cls._normalise_time(record.get("expires_at")),
        )

    @staticmethod
    def _record_id(record: dict[str, Any]) -> str:
        identity = record.get("record_id")
        if not isinstance(identity, str) or not identity:
            raise ValueError("record_id must be a non-empty string")
        return identity

    @staticmethod
    def _iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
        if not path.exists():
            return
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"invalid JSONL at {path}:{line_number}") from exc
                if not isinstance(row, dict):
                    raise ValueError(f"expected JSON object at {path}:{line_number}")
                yield row

    @staticmethod
    def _database_empty(connection: sqlite3.Connection) -> bool:
        return not any(
            connection.execute(f"SELECT EXISTS(SELECT 1 FROM {table} LIMIT 1)").fetchone()[0]
            for table in ("latest", "versions", "changes", "runs")
        )

    @classmethod
    def _hash_imported_record(cls, record: dict[str, Any]) -> str:
        existing = record.get("record_hash")
        if existing:
            return str(existing)
        comparable = {
            key: value
            for key, value in record.items()
            if key not in {"collected_at", "record_hash"}
        }
        return sha256(comparable)

    def _insert_version(
        self, connection: sqlite3.Connection, record: dict[str, Any]
    ) -> None:
        identity = self._record_id(record)
        record_hash = self._hash_imported_record(record)
        record["record_hash"] = record_hash
        connection.execute(
            """
            INSERT INTO versions(record_id, record_hash, collected_at, expires_at, record_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                identity,
                record_hash,
                self._normalise_time(record.get("collected_at")),
                self._normalise_time(record.get("expires_at")),
                canonical_json(record),
            ),
        )

    def _upsert_latest(
        self, connection: sqlite3.Connection, record: dict[str, Any]
    ) -> None:
        identity = self._record_id(record)
        record_hash = self._hash_imported_record(record)
        record["record_hash"] = record_hash
        connection.execute(
            """
            INSERT INTO latest(
                record_id, record_hash, record_json, record_type, channel_id,
                video_id, thread_id, published_at, last_full_comment_scan_at,
                is_deleted, refreshed_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(record_id) DO UPDATE SET
                record_hash=excluded.record_hash,
                record_json=excluded.record_json,
                record_type=excluded.record_type,
                channel_id=excluded.channel_id,
                video_id=excluded.video_id,
                thread_id=excluded.thread_id,
                published_at=excluded.published_at,
                last_full_comment_scan_at=excluded.last_full_comment_scan_at,
                is_deleted=excluded.is_deleted,
                refreshed_at=excluded.refreshed_at,
                expires_at=excluded.expires_at
            """,
            (identity, record_hash, canonical_json(record), *self._index_values(record)),
        )

    def _import_existing_if_empty(self) -> None:
        paths = (
            self.history_path,
            self.latest_path,
            self.changes_path,
            self.runs_path,
            self.state_path,
        )
        if not any(path.exists() for path in paths):
            return

        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if not self._database_empty(connection):
                connection.rollback()
                return

            for record in self._iter_jsonl(self.history_path):
                self._insert_version(connection, record)
                self._upsert_latest(connection, record)

            for record in self._iter_jsonl(self.latest_path):
                identity = self._record_id(record)
                record_hash = self._hash_imported_record(record)
                previous_row = connection.execute(
                    "SELECT record_json FROM latest WHERE record_id = ?", (identity,)
                ).fetchone()
                if previous_row:
                    previous = json.loads(previous_row["record_json"])
                    incoming_time = self._normalise_time(
                        record.get("refreshed_at") or record.get("collected_at")
                    ) or ""
                    previous_time = self._normalise_time(
                        previous.get("refreshed_at") or previous.get("collected_at")
                    ) or ""
                    if incoming_time <= previous_time:
                        continue
                self._upsert_latest(connection, record)
                exists = connection.execute(
                    """
                    SELECT EXISTS(
                        SELECT 1 FROM versions WHERE record_id = ? AND record_hash = ?
                    )
                    """,
                    (identity, record_hash),
                ).fetchone()[0]
                if not exists:
                    self._insert_version(connection, record)

            for change in self._iter_jsonl(self.changes_path):
                connection.execute(
                    """
                    INSERT INTO changes(
                        record_id, change_type, observed_at, expires_at, change_json
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        str(change.get("record_id", "")),
                        str(change.get("change_type", "update")),
                        self._normalise_time(change.get("observed_at")),
                        self._normalise_time(change.get("expires_at")),
                        canonical_json(change),
                    ),
                )

            for run in self._iter_jsonl(self.runs_path):
                connection.execute(
                    "INSERT INTO runs(finished_at, run_json) VALUES (?, ?)",
                    (
                        self._normalise_time(run.get("finished_at")),
                        canonical_json(run),
                    ),
                )

            if self.state_path.exists():
                state = json.loads(self.state_path.read_text(encoding="utf-8"))
                if not isinstance(state, dict):
                    raise ValueError(f"expected JSON object at {self.state_path}")
                for key, value in state.items():
                    connection.execute(
                        "INSERT OR REPLACE INTO state(key, value_json) VALUES (?, ?)",
                        (str(key), canonical_json(value)),
                    )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _is_older(incoming: Any, previous: Any) -> bool:
        if previous is None:
            return False
        if incoming is None:
            return True
        if isinstance(incoming, (int, float)) and isinstance(previous, (int, float)):
            return incoming < previous
        incoming_time = IndexedJsonlStore._normalise_time(incoming)
        previous_time = IndexedJsonlStore._normalise_time(previous)
        return str(incoming_time) < str(previous_time)

    def merge(
        self,
        records: Iterable[dict[str, Any]],
        *,
        collector: str,
        mode: str,
        volatile_fields: Iterable[str] = (),
        refresh_unchanged: bool = False,
        prefer_newer_field: str | None = None,
        log_run: bool = True,
        materialize: bool = True,
    ) -> dict[str, int]:
        """Merge a record stream atomically with constant per-record memory."""
        ignored = {"collected_at", "record_hash", *volatile_fields}
        observed_at = utc_now()
        summary = {"inserted": 0, "changed": 0, "unchanged": 0, "skipped_older": 0}

        with closing(self.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            for source_record in records:
                record = dict(source_record)
                record.setdefault("schema_version", "1.0")
                record["collected_at"] = observed_at
                identity = self._record_id(record)
                comparable = {
                    key: value for key, value in record.items() if key not in ignored
                }
                record["record_hash"] = sha256(comparable)
                previous_row = connection.execute(
                    "SELECT record_hash, record_json FROM latest WHERE record_id = ?",
                    (identity,),
                ).fetchone()
                previous = json.loads(previous_row["record_json"]) if previous_row else None

                if (
                    previous is not None
                    and prefer_newer_field
                    and self._is_older(
                        record.get(prefer_newer_field), previous.get(prefer_newer_field)
                    )
                ):
                    summary["skipped_older"] += 1
                    continue

                if previous_row and previous_row["record_hash"] == record["record_hash"]:
                    summary["unchanged"] += 1
                    if refresh_unchanged:
                        self._upsert_latest(connection, record)
                    continue

                change_type = "insert" if previous_row is None else "update"
                summary["inserted" if previous_row is None else "changed"] += 1
                self._insert_version(connection, record)
                self._upsert_latest(connection, record)
                change = {
                    "schema_version": "1.0",
                    "collector": collector,
                    "mode": mode,
                    "change_type": change_type,
                    "record_id": identity,
                    "previous_record_hash": (
                        previous_row["record_hash"] if previous_row else None
                    ),
                    "record_hash": record["record_hash"],
                    "observed_at": observed_at,
                }
                if record.get("expires_at"):
                    change["expires_at"] = record["expires_at"]
                connection.execute(
                    """
                    INSERT INTO changes(
                        record_id, change_type, observed_at, expires_at, change_json
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        identity,
                        change_type,
                        self._normalise_time(observed_at),
                        self._normalise_time(change.get("expires_at")),
                        canonical_json(change),
                    ),
                )

            if log_run:
                self._insert_run(connection, {"collector": collector, "mode": mode, **summary})

        if materialize:
            self.materialize()
        return summary

    def _insert_run(
        self, connection: sqlite3.Connection, run: dict[str, Any]
    ) -> None:
        finished_at = str(run.get("finished_at") or utc_now())
        payload = {**run, "finished_at": finished_at}
        connection.execute(
            "INSERT INTO runs(finished_at, run_json) VALUES (?, ?)",
            (self._normalise_time(finished_at), canonical_json(payload)),
        )
        state_values = [
            ("last_run_at", finished_at),
            ("last_mode", payload.get("mode")),
            ("last_status", payload.get("status")),
        ]
        if payload.get("status") in {None, "success"}:
            state_values.append(("last_success_at", finished_at))
        for key, value in state_values:
            if value is None:
                continue
            connection.execute(
                """
                INSERT INTO state(key, value_json) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json
                """,
                (key, canonical_json(value)),
            )

    def record_run(self, run: dict[str, Any], *, materialize: bool = True) -> None:
        """Append one collector invocation summary."""
        with closing(self.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            self._insert_run(connection, run)
        if materialize:
            self.materialize()

    def get_latest(self, record_id: str) -> dict[str, Any] | None:
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT record_json FROM latest WHERE record_id = ?", (record_id,)
            ).fetchone()
        return json.loads(row["record_json"]) if row else None

    def iter_latest(
        self,
        *,
        record_type: str | None = None,
        channel_id: str | None = None,
        video_id: str | None = None,
        thread_id: str | None = None,
        published_at: str | None = None,
        last_full_comment_scan_at: str | None = None,
        is_deleted: bool | None = None,
        refreshed_at: str | None = None,
        expires_at: str | None = None,
        order_by: str = "record_id",
        descending: bool = False,
    ) -> Iterator[dict[str, Any]]:
        """Stream latest rows using exact-match indexed filters."""
        if order_by not in {"record_id", *SEARCH_COLUMNS}:
            raise ValueError(f"unsupported order_by: {order_by}")
        supplied: dict[str, Any] = {
            "record_type": record_type,
            "channel_id": channel_id,
            "video_id": video_id,
            "thread_id": thread_id,
            "published_at": published_at,
            "last_full_comment_scan_at": last_full_comment_scan_at,
            "is_deleted": is_deleted,
            "refreshed_at": refreshed_at,
            "expires_at": expires_at,
        }
        clauses: list[str] = []
        values: list[Any] = []
        for name, value in supplied.items():
            if value is None:
                continue
            clauses.append(f"{name} = ?")
            if name == "is_deleted":
                values.append(int(bool(value)))
            elif name in TIME_COLUMNS:
                values.append(self._normalise_time(value))
            else:
                values.append(value)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        direction = " DESC" if descending else ""
        query = f"SELECT record_json FROM latest{where} ORDER BY {order_by}{direction}"

        connection = self.connect()
        try:
            for row in connection.execute(query, values):
                yield json.loads(row["record_json"])
        finally:
            connection.close()

    def prune_expired(
        self, now: str | datetime | None = None, *, materialize: bool = True
    ) -> dict[str, int]:
        """Delete expired current data, versions and change events in SQL."""
        cutoff = self._normalise_time(now or datetime.now(UTC))
        summary: dict[str, int] = {}
        with closing(self.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            for table in ("latest", "versions", "changes"):
                cursor = connection.execute(
                    f"DELETE FROM {table} WHERE expires_at IS NOT NULL AND expires_at <= ?",
                    (cutoff,),
                )
                summary[table] = cursor.rowcount
        if materialize:
            self.materialize()
        return summary

    def purge_versions(
        self,
        record_ids: Iterable[str],
        *,
        keep_latest: bool = True,
        materialize: bool = True,
    ) -> dict[str, int]:
        """Remove historical bodies, optionally retaining one current version.

        ``latest`` itself is never deleted.  With ``keep_latest=True``, one copy
        of its current representation is restored to ``versions`` after purge.
        """
        purged = kept = 0
        with closing(self.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            for record_id in record_ids:
                if not isinstance(record_id, str) or not record_id:
                    raise ValueError("record_ids must contain non-empty strings")
                latest = connection.execute(
                    "SELECT record_json FROM latest WHERE record_id = ?", (record_id,)
                ).fetchone()
                existing_current = 0
                if latest and keep_latest:
                    latest_record = json.loads(latest["record_json"])
                    existing_current = connection.execute(
                        """
                        SELECT EXISTS(
                            SELECT 1 FROM versions
                            WHERE record_id = ? AND record_hash = ?
                        )
                        """,
                        (record_id, latest_record.get("record_hash")),
                    ).fetchone()[0]
                cursor = connection.execute(
                    "DELETE FROM versions WHERE record_id = ?", (record_id,)
                )
                removed = cursor.rowcount
                if latest and keep_latest:
                    self._insert_version(connection, latest_record)
                    kept += 1
                purged += max(0, removed - int(bool(existing_current)))
        if materialize:
            self.materialize()
        return {"purged": purged, "kept": kept}

    @staticmethod
    def _write_jsonl(
        connection: sqlite3.Connection, path: Path, query: str
    ) -> None:
        with path.open("x", encoding="utf-8") as handle:
            for row in connection.execute(query):
                handle.write(row[0] + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(path, 0o600)

    @staticmethod
    def _write_state(connection: sqlite3.Connection, path: Path) -> None:
        with path.open("x", encoding="utf-8") as handle:
            handle.write("{")
            first = True
            for key, value_json in connection.execute(
                "SELECT key, value_json FROM state ORDER BY key"
            ):
                if not first:
                    handle.write(",")
                first = False
                handle.write(json.dumps(key, ensure_ascii=False) + ":" + value_json)
            handle.write("}\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(path, 0o600)

    def _public_export_links_ready(self) -> bool:
        return all(
            path.is_symlink()
            and os.readlink(path) == f".jsonl-current/{path.name}"
            for path in (
                self.history_path,
                self.latest_path,
                self.changes_path,
                self.runs_path,
                self.state_path,
            )
        )

    def _install_public_export_links(self) -> None:
        for path in (
            self.history_path,
            self.latest_path,
            self.changes_path,
            self.runs_path,
            self.state_path,
        ):
            expected = f".jsonl-current/{path.name}"
            if path.is_symlink() and os.readlink(path) == expected:
                continue
            temporary = self.root / f".{path.name}.{os.getpid()}.link"
            temporary.unlink(missing_ok=True)
            try:
                os.symlink(expected, temporary)
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)

    def _publish_generation(self, generation: Path) -> None:
        temporary = self.root / f".jsonl-current.{os.getpid()}.link"
        temporary.unlink(missing_ok=True)
        target = generation.relative_to(self.root)
        try:
            os.symlink(str(target), temporary)
            os.replace(temporary, self.current_generation_path)
        finally:
            temporary.unlink(missing_ok=True)

    def _remove_generation(self, generation: Path) -> None:
        for name in (
            "records.jsonl",
            "latest.jsonl",
            "changes.jsonl",
            "runs.jsonl",
            "state.json",
        ):
            (generation / name).unlink(missing_ok=True)
        try:
            generation.rmdir()
        except OSError:
            pass

    def _cleanup_old_generations(self, current: Path) -> None:
        for generation in self.generations_root.iterdir():
            if generation.is_dir() and generation != current:
                self._remove_generation(generation)

    def _invalidate_public_exports(self) -> None:
        generation: Path | None = None
        if self.current_generation_path.is_symlink():
            candidate = self.root / os.readlink(self.current_generation_path)
            try:
                candidate.resolve().relative_to(self.generations_root.resolve())
                generation = candidate
            except ValueError:
                generation = None
        self.current_generation_path.unlink(missing_ok=True)
        for path in (
            self.history_path,
            self.latest_path,
            self.changes_path,
            self.runs_path,
            self.state_path,
        ):
            path.unlink(missing_ok=True)
        if generation is not None:
            self._remove_generation(generation)

    def materialize(self, *, invalidate_on_failure: bool = False) -> None:
        """Atomically publish one SQLite snapshot as portable JSONL outputs."""
        connection = self.connect()
        generation = self.generations_root / f"generation-{uuid.uuid4().hex}"
        published = False
        try:
            connection.execute("BEGIN IMMEDIATE")
            generation.mkdir(mode=0o700)
            self._write_jsonl(
                connection,
                generation / "records.jsonl",
                "SELECT record_json FROM versions ORDER BY seq",
            )
            self._write_jsonl(
                connection,
                generation / "latest.jsonl",
                "SELECT record_json FROM latest ORDER BY record_id",
            )
            self._write_jsonl(
                connection,
                generation / "changes.jsonl",
                "SELECT change_json FROM changes ORDER BY seq",
            )
            self._write_jsonl(
                connection,
                generation / "runs.jsonl",
                "SELECT run_json FROM runs ORDER BY seq",
            )
            self._write_state(connection, generation / "state.json")

            legacy_exports = not self.current_generation_path.is_symlink()
            if not legacy_exports:
                self._install_public_export_links()
            self._publish_generation(generation)
            published = True
            if legacy_exports or not self._public_export_links_ready():
                self._install_public_export_links()
            connection.commit()
            self._cleanup_old_generations(generation)
        except Exception:
            connection.rollback()
            if invalidate_on_failure:
                self._invalidate_public_exports()
            raise
        finally:
            if not published:
                self._remove_generation(generation)
            connection.close()
