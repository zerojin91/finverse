"""GET /api/ontology/* — 정의된 어휘와 실제 적재량."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends

from ..deps import get_conn
from ..schemas.ontology import VocabularyResponse
from ..services import graph_service

router = APIRouter(prefix="/api/ontology", tags=["ontology"])


@router.get("/vocabulary", response_model=VocabularyResponse)
def vocabulary(conn: psycopg.Connection = Depends(get_conn)):
    return graph_service.vocabulary(conn)
