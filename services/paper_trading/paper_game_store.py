"""Atomic JSON persistence for paper-trading games."""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import threading
from typing import Any
from collections.abc import Callable

from .config import Config


class PaperGameStore:
    _lock = threading.RLock()

    def __init__(self, root: str | None = None):
        self.root = Path(root or os.path.join(Config.UPLOAD_FOLDER, "paper_games"))
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, game_id: str) -> Path:
        if not game_id.startswith(("kospi_", "scenario_")) or not game_id.replace("_", "").isalnum():
            raise ValueError("올바르지 않은 게임 ID입니다.")
        return self.root / f"{game_id}.json"

    def save(self, game: dict[str, Any]) -> None:
        target = self._path(game["game_id"])
        with self._lock:
            fd, temporary = tempfile.mkstemp(prefix=f".{game['game_id']}.", suffix=".tmp", dir=self.root)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(game, handle, ensure_ascii=False, indent=2)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)

    def get(self, game_id: str) -> dict[str, Any] | None:
        target = self._path(game_id)
        if not target.exists():
            return None
        with self._lock, target.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        games = []
        with self._lock:
            paths = sorted([*self.root.glob("kospi_*.json"), *self.root.glob("scenario_*.json")],
                           key=lambda p: p.stat().st_mtime, reverse=True)
            for path in paths[:max(1, min(limit, 100))]:
                with path.open("r", encoding="utf-8") as handle:
                    games.append(json.load(handle))
        return games

    def update(self, game_id: str, operation: Callable[[dict[str, Any]], Any]) -> tuple[dict[str, Any], Any] | None:
        """Load, mutate and atomically persist a game under one process lock."""
        with self._lock:
            game = self.get(game_id)
            if game is None:
                return None
            result = operation(game)
            self.save(game)
            return game, result
