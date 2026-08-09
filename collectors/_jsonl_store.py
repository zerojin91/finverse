"""Small JSONL persistence layer shared by FINVERSE collectors.

PostgreSQL is intentionally not a dependency yet.  The store keeps an
append-only history, a materialised latest view, and a change stream per
collector so a future database loader has a deterministic hand-off point.
"""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def load_dotenv(root: Path) -> None:
    """Load repository-local .env without overriding the process environment."""
    import os

    path = root / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


class JsonlStore:
    """Versioned JSONL store keyed by a collector-provided ``record_id``."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.raw_root = root / "raw"
        self.history_path = root / "records.jsonl"
        self.latest_path = root / "latest.jsonl"
        self.changes_path = root / "changes.jsonl"
        self.runs_path = root / "runs.jsonl"
        self.state_path = root / "state.json"
        self.root.mkdir(parents=True, exist_ok=True)
        self.raw_root.mkdir(exist_ok=True)

    @staticmethod
    def _read_jsonl(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        rows: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
        return rows

    @staticmethod
    def _append(path: Path, rows: Iterable[dict[str, Any]]) -> None:
        with path.open("a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(canonical_json(row) + "\n")

    def _latest(self) -> dict[str, dict[str, Any]]:
        return {row["record_id"]: row for row in self._read_jsonl(self.latest_path)}

    def save_raw(self, source: str, request_id: str, body: bytes, content_type: str) -> str:
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        path = self.raw_root / f"{stamp}_{source}_{request_id}.json"
        payload = {
            "source": source,
            "request_id": request_id,
            "retrieved_at": utc_now(),
            "content_type": content_type,
            "body": body.decode("utf-8", errors="replace"),
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return str(path.relative_to(self.root))

    def merge(self, records: Iterable[dict[str, Any]], *, collector: str, mode: str) -> dict[str, int]:
        latest = self._latest()
        history: list[dict[str, Any]] = []
        changes: list[dict[str, Any]] = []
        inserted = changed = unchanged = 0
        observed_at = utc_now()

        for record in records:
            record = dict(record)
            record.setdefault("schema_version", "1.0")
            record["collected_at"] = observed_at
            identity = record["record_id"]
            comparable = {key: value for key, value in record.items() if key not in {"collected_at", "record_hash"}}
            record["record_hash"] = sha256(comparable)
            previous = latest.get(identity)
            if previous and previous.get("record_hash") == record["record_hash"]:
                unchanged += 1
                continue

            change_type = "insert" if previous is None else "update"
            if previous is None:
                inserted += 1
            else:
                changed += 1
            history.append(record)
            changes.append(
                {
                    "schema_version": "1.0",
                    "collector": collector,
                    "mode": mode,
                    "change_type": change_type,
                    "record_id": identity,
                    "previous_record_hash": previous.get("record_hash") if previous else None,
                    "record_hash": record["record_hash"],
                    "observed_at": observed_at,
                }
            )
            latest[identity] = record

        self._append(self.history_path, history)
        self._append(self.changes_path, changes)
        ordered = [latest[key] for key in sorted(latest)]
        self.latest_path.write_text(
            "".join(canonical_json(row) + "\n" for row in ordered), encoding="utf-8"
        )
        summary = {"inserted": inserted, "changed": changed, "unchanged": unchanged}
        self._append(
            self.runs_path,
            [{"collector": collector, "mode": mode, "finished_at": observed_at, **summary}],
        )
        self.state_path.write_text(
            json.dumps({"last_success_at": observed_at, "last_mode": mode}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return summary
