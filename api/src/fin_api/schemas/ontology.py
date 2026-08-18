"""온톨로지 어휘 스키마 — 정의된 어휘와 실제 적재량을 한 화면에서 대조하기 위한 것."""
from __future__ import annotations

from pydantic import BaseModel


class LabelEntry(BaseModel):
    label: str
    count: int  # 실제 graph.node 행수 (0이면 "정의만 되고 아직 안 만들어진 것")


class EdgeTypeEntry(BaseModel):
    type: str
    count: int
    derived: bool  # 파생 엣지 = method/computed_at/pipeline_version을 요구받는 타입


class VocabularyResponse(BaseModel):
    """DB CHECK 제약에서 읽은 허용 어휘 + 실제 행수.

    어휘를 API에 하드코딩하지 않고 `db/ontology.sql`이 만든 제약에서 되읽는다.
    문서 → SQL → API 순서가 지켜졌는지 화면에서 바로 드러난다.
    """

    labels: list[LabelEntry]
    edge_types: list[EdgeTypeEntry]
    node_total: int
    edge_total: int


class HealthResponse(BaseModel):
    status: str
    database: str
    node_count: int | None = None
    edge_count: int | None = None
    detail: str | None = None
