"""그래프 응답 스키마 — GraphPayload는 프론트 공용 계약.

`label`/`type`을 Literal로 고정하지 않는다. 어휘의 단일 진실은
`docs/ontology/scenario-ontology.md`이고 그것을 강제하는 곳은 `db/ontology.sql`의
CHECK 제약이다. 스키마에 라벨을 한 번 더 적으면 진실이 세 곳이 된다.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class GraphNode(BaseModel):
    id: str  # = graph.node.uid
    label: str
    name: str
    properties: dict[str, Any]
    evidence_count: int = 0


class GraphEdge(BaseModel):
    id: str  # "{TYPE}:{source}->{target}"
    source: str
    target: str
    label: str  # = graph.edge.type
    properties: dict[str, Any]


class GraphMeta(BaseModel):
    node_count: int
    edge_count: int
    truncated: bool


class GraphPayload(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    meta: GraphMeta


class DegreeEntry(BaseModel):
    type: str
    direction: str  # out | in
    count: int


class NodeDetail(BaseModel):
    id: str
    label: str
    name: str
    properties: dict[str, Any]
    evidence: list[str]  # lake.records.record_id — 프로비넌스
    evidence_count: int
    degrees: list[DegreeEntry]
    projected_at: str | None = None


class SearchHit(BaseModel):
    id: str
    label: str
    name: str
    matched_on: str


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]
    truncated: bool


class SeriesPoint(BaseModel):
    bas_dd: str
    close: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    volume: float | None = None


class SeriesResponse(BaseModel):
    """One node's time series, fetched on demand.

    The series is not in the graph and not copied into a projection table. The
    ontology keeps values out of the graph (§0: a single price table is already
    22.8M rows), so a node carries the identity and this reads the lake when
    something actually asks. Warm, that is about 350 ms per security.
    """

    id: str
    label: str
    kind: str                 # price | index | indicator
    source: str | None        # which source these points came from
    sources: list[str]        # every source holding a series for this node
    points: list[SeriesPoint]
    truncated: bool
