"""커넥션 풀 — 읽기 전용.

`scenario-ontology.md`의 불변식과 같은 계약이다: **그래프의 유일한 작성자는
projection(`graph.rebuild()`)이고 API는 그래프에 쓰지 않는다.** 규칙을 문서로만
두면 언젠가 깨지므로 커넥션 자체를 read-only로 고정한다 — 실수로 INSERT를 짜도
DB가 거부한다. 폭주 쿼리는 statement_timeout으로 유계.
"""
from __future__ import annotations

from collections.abc import Iterator

import psycopg
from psycopg_pool import ConnectionPool

from .config import get_settings


def _configure(conn: psycopg.Connection) -> None:
    settings = get_settings()
    with conn.cursor() as cur:
        cur.execute("SET default_transaction_read_only = on")
        # SET은 파라미터 바인딩을 받지 않는다 — set_config로 값을 넘긴다.
        cur.execute(
            "SELECT set_config('statement_timeout', %s, false)",
            (settings.statement_timeout,),
        )
    conn.commit()


class Pools:
    def __init__(self) -> None:
        self.main: ConnectionPool | None = None

    def open(self) -> None:
        settings = get_settings()
        self.main = ConnectionPool(
            settings.dsn,
            min_size=1,
            max_size=5,
            configure=_configure,
            open=False,
            name="fin-main",
        )
        # wait=False: DB가 아직 안 떠 있어도 앱은 뜬다 (/api/health가 상태를 알려준다)
        self.main.open(wait=False)

    def close(self) -> None:
        if self.main is not None:
            self.main.close()
            self.main = None


pools = Pools()


def get_conn() -> Iterator[psycopg.Connection]:
    assert pools.main is not None, "pools not opened (lifespan)"
    with pools.main.connection() as conn:
        yield conn
