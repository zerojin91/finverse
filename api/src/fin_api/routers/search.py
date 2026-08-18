"""GET /api/search — 노드 이름·uid·티커 부분일치."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, Query

from ..deps import get_conn
from ..schemas.graph import SearchResponse
from ..services import graph_service

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search", response_model=SearchResponse)
def search(
    q: str = Query(min_length=1),
    label: str | None = None,
    limit: int = Query(default=30, ge=1, le=200),
    conn: psycopg.Connection = Depends(get_conn),
):
    return graph_service.search(conn, q, label=label, limit=limit)
