"""Persistent in-process background jobs for slow LLM scenario actions."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from typing import Any, Callable
import uuid

from .kospi_paper_trading import TradingError


class ScenarioJobManager:
    _executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="scenario-llm")
    _lock = threading.RLock()
    _active_by_game: dict[str, str] = {}
    _STALE_JOB_SECONDS = 8 * 60

    def __init__(self, game_root: str):
        self.root = Path(game_root) / "jobs"
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, job_id: str) -> Path:
        if not job_id.startswith("job_") or not job_id.replace("_", "").isalnum():
            raise TradingError("올바르지 않은 작업 ID입니다.")
        return self.root / f"{job_id}.json"

    def _save(self, job: dict[str, Any]) -> None:
        target = self._path(job["job_id"])
        last_error: OSError | None = None
        for attempt in range(6):
            fd, temporary = tempfile.mkstemp(prefix=f".{job['job_id']}.", suffix=".tmp", dir=self.root)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(job, handle, ensure_ascii=False, indent=2)
                    handle.flush()
                    os.fsync(handle.fileno())
                try:
                    os.replace(temporary, target)
                    return
                except PermissionError as exc:
                    last_error = exc
                    if attempt < 5:
                        time.sleep(.1 * (attempt + 1))
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        if last_error:
            raise last_error

    def get(self, job_id: str) -> dict[str, Any] | None:
        path = self._path(job_id)
        if not path.exists():
            return None
        try:
            with self._lock, path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    def submit(self, game_id: str, kind: str,
               operation: Callable[[Callable[[int, str], None]], Any]) -> dict[str, Any]:
        with self._lock:
            active_id = self._active_by_game.get(game_id)
            if active_id:
                active = self.get(active_id)
                if active and active["status"] in ("queued", "running"):
                    updated_at = str(active.get("updated_at") or "")
                    try:
                        stale = time.time() - datetime.fromisoformat(updated_at).timestamp() > self._STALE_JOB_SECONDS
                    except (TypeError, ValueError, OverflowError):
                        stale = False
                    if stale:
                        active.update({"status": "failed", "message": "작업이 응답하지 않아 재실행이 필요합니다.", "error": "백그라운드 작업이 제한 시간 동안 진행되지 않았습니다.", "updated_at": datetime.now().isoformat()})
                        self._save(active)
                        self._active_by_game.pop(game_id, None)
                    else:
                        # 브라우저 재렌더링·네트워크 재시도는 같은 논리 작업을 두 번
                    # 시작하면 안 된다. 진행 중인 작업을 그대로 돌려주면 호출자는
                    # 같은 job_id를 폴링해 완료 결과를 화면에 복구할 수 있다.
                        return active
            now = datetime.now().isoformat()
            job = {"job_id": f"job_{uuid.uuid4().hex[:12]}", "game_id": game_id,
                   "kind": kind, "status": "queued", "progress": 0,
                   "message": "작업 대기 중", "error": None,
                   "created_at": now, "updated_at": now}
            self._active_by_game[game_id] = job["job_id"]
            self._save(job)

        def run():
            def report(progress: int, message: str):
                with self._lock:
                    current = self.get(job["job_id"]) or job
                    current.update({"status": "running", "progress": max(0, min(99, int(progress))),
                                    "message": str(message)[:300],
                                    "updated_at": datetime.now().isoformat()})
                    self._save(current)
            try:
                report(2, "LLM 작업 시작")
                operation(report)
                with self._lock:
                    current = self.get(job["job_id"]) or job
                    current.update({"status": "completed", "progress": 100,
                                    "message": "완료", "updated_at": datetime.now().isoformat()})
                    self._save(current)
            except Exception as exc:
                with self._lock:
                    current = self.get(job["job_id"]) or job
                    current.update({"status": "failed", "message": "작업 실패",
                                    "error": str(exc)[:1000],
                                    "updated_at": datetime.now().isoformat()})
                    self._save(current)
            finally:
                with self._lock:
                    if self._active_by_game.get(game_id) == job["job_id"]:
                        self._active_by_game.pop(game_id, None)

        self._executor.submit(run)
        return job
