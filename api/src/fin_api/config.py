"""설정 — DSN은 환경변수 전용. 비밀은 코드에 두지 않는다 (.env는 커밋 금지)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

API_VERSION = "0.1.0"

# 로컬 개발 기본값: SSH 터널(scripts/dev_ui.sh)이 여는 포트.
# 서버 Postgres는 tailscale 주소에만 바인딩돼 있어 맥에서 직접 닿지 않는다.
DEFAULT_DSN = "postgresql://finverse@127.0.0.1:15432/finverse"


def _load_dotenv(root: Path) -> None:
    """리포 루트의 .env를 os.environ에 채운다 (이미 있는 값은 유지)."""
    path = root / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "docs" / "ontology" / "scenario-ontology.md").exists():
            return parent
    return Path.cwd()


@dataclass(frozen=True)
class Settings:
    dsn: str
    statement_timeout: str
    cors_origins: tuple[str, ...]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_dotenv(repo_root())
    # FINVERSE_API_DSN이 우선. DATABASE_URL은 수집기·적재기가 이미 쓰는 이름이라
    # 서버에서 그대로 재사용된다 (그쪽은 tailscale 주소, 여기는 터널 주소).
    dsn = os.environ.get("FINVERSE_API_DSN") or os.environ.get("DATABASE_URL") or DEFAULT_DSN
    origins = os.environ.get("FINVERSE_CORS_ORIGINS")
    return Settings(
        dsn=dsn,
        statement_timeout=os.environ.get("FINVERSE_STATEMENT_TIMEOUT", "15s"),
        # 웹 dev 서버는 5174 고정(vite.config.ts). 5173은 hi-universe가 쓰고 있어
        # 두 프로젝트를 같이 띄워도 안 부딪히게 비켜 두었다.
        cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip())
        if origins
        else ("http://localhost:5174", "http://127.0.0.1:5174"),
    )
