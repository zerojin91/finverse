"""GET /api/graph/* — GraphPayload는 프론트 공용 계약."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import get_conn
from ..schemas.graph import GraphPayload, NodeDetail, SeriesResponse
from ..services import graph_service

router = APIRouter(prefix="/api/graph", tags=["graph"])


def _csv(value: str | None) -> list[str] | None:
    if not value:
        return None
    items = [v.strip() for v in value.split(",") if v.strip()]
    return items or None


@router.get("/overview", response_model=GraphPayload)
def overview(
    labels: str | None = Query(default=None, description="쉼표 구분 라벨 필터"),
    per_label: int = Query(default=60, ge=1, le=500),
    conn: psycopg.Connection = Depends(get_conn),
):
    return graph_service.overview(conn, _csv(labels), per_label)


@router.get("/neighbors", response_model=GraphPayload)
def neighbors(
    node_id: str,
    depth: int = Query(default=1, ge=1, le=2),
    edge_types: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    conn: psycopg.Connection = Depends(get_conn),
):
    return graph_service.neighbors(
        conn, node_id, depth=depth, edge_types=_csv(edge_types), limit=limit
    )


@router.get("/series", response_model=SeriesResponse)
def series(
    node_id: str,
    source: str | None = None,
    start: str | None = Query(default=None, description="YYYYMMDD 이상"),
    end: str | None = Query(default=None, description="YYYYMMDD 이하"),
    limit: int = Query(default=500, ge=1, le=20000),
    conn: psycopg.Connection = Depends(get_conn),
):
    """한 노드의 시계열. 그래프에는 없고, 물어볼 때 lake 에서 읽는다.

    쿼리 파라미터로 받는다(경로가 아니라) -- uid 에 슬래시·물음표가 들어가는 노드가
    있어서 경로에 넣으면 인코딩이 계속 문제가 된다.
    """
    result = graph_service.series(conn, node_id, source=source, start=start,
                                  end=end, limit=limit)
    if result is None:
        raise HTTPException(status_code=404, detail=f"unknown uid: {node_id}")
    return result


@router.get("/node/{node_id:path}", response_model=NodeDetail)
def node(node_id: str, conn: psycopg.Connection = Depends(get_conn)):
    # uid에 슬래시가 들어간다(Event uid = 기사 URL) — :path 컨버터가 필요한 이유.
    # 이 라우트는 마지막에 둔다: :path 가 /series 까지 삼켜버리기 때문이다.
    detail = graph_service.node_detail(conn, node_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"unknown uid: {node_id}")
    return detail
