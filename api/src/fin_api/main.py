"""FINVERSE API — 온톨로지 그래프 조회.

`docs/ontology/scenario-ontology.md`가 어휘의 단일 진실이고, `db/ontology.sql`이
그것을 CHECK 제약으로 강제하며, `graph.rebuild()`가 유일한 작성자다. 이 API는
읽기만 한다 (deps.py에서 커넥션 자체를 read-only로 고정).
"""
from __future__ import annotations

from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from psycopg_pool import PoolTimeout

from .config import API_VERSION, get_settings
from .deps import pools
from .routers import graph, ontology, search
from .schemas.ontology import HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    pools.open()
    yield
    pools.close()


app = FastAPI(title="FINVERSE API", version=API_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_settings().cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_api_version_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-FINVERSE-API-Version"] = API_VERSION
    return response


app.include_router(graph.router)
app.include_router(ontology.router)
app.include_router(search.router)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """DB가 죽어 있어도 200으로 답하고 상태를 본문에 담는다 — 프런트가 사유를 보여줄 수 있게."""
    if pools.main is None:
        return HealthResponse(status="degraded", database="pool not opened")
    try:
        # timeout을 주지 않으면 DB가 죽었을 때 풀 기본값(30초)만큼 매달린다 —
        # 상태를 알려주려는 엔드포인트가 상태 때문에 멈추면 쓸모가 없다.
        with pools.main.connection(timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM graph.node")
                nodes = cur.fetchone()[0]
                cur.execute("SELECT count(*) FROM graph.edge")
                edges = cur.fetchone()[0]
    except (psycopg.Error, PoolTimeout, RuntimeError) as exc:
        return HealthResponse(status="degraded", database="unreachable", detail=str(exc))
    return HealthResponse(status="ok", database="ok", node_count=nodes, edge_count=edges)
