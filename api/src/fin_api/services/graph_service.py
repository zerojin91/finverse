"""graph.node / graph.edge 조회.

hi-universe는 AGE(Cypher)로 traverse하지만 finverse의 그래프는 평범한 두 테이블이라
전부 SQL이다. 계약(GraphPayload)은 같게 유지한다 — 프론트가 그래프 저장소를 몰라도
되게 하려는 것이고, 나중에 AGE로 바꾸더라도 이 파일만 바뀐다.
"""
from __future__ import annotations

import re
from typing import Any

import psycopg
from psycopg.rows import dict_row

from ..schemas.graph import (
    DegreeEntry,
    GraphEdge,
    GraphMeta,
    GraphNode,
    GraphPayload,
    NodeDetail,
    SearchHit,
    SearchResponse,
)
from ..schemas.ontology import EdgeTypeEntry, LabelEntry, VocabularyResponse

# 표시 이름 — 라벨마다 이름을 담는 속성이 다르다 (scenario-ontology.md §1).
# Event만 제목이 없을 수 있어 fact 앞부분을 잘라 쓴다.
NAME_SQL = """
coalesce(
    nullif(n.props->>'name', ''),
    nullif(n.props->>'idx_name', ''),
    nullif(n.props->>'series_name', ''),
    nullif(n.props->>'title', ''),
    left(nullif(n.props->>'fact', ''), 120),
    n.uid
)
"""


def _node(row: dict[str, Any]) -> GraphNode:
    return GraphNode(
        id=row["uid"],
        label=row["label"],
        name=row["name"],
        properties=row["props"] or {},
        evidence_count=row.get("evidence_count") or 0,
    )


def _edge(row: dict[str, Any]) -> GraphEdge:
    return GraphEdge(
        id=f"{row['type']}:{row['src_uid']}->{row['dst_uid']}",
        source=row["src_uid"],
        target=row["dst_uid"],
        label=row["type"],
        properties=row["props"] or {},
    )


def _edges_among(cur: psycopg.Cursor, uids: list[str]) -> list[GraphEdge]:
    """양 끝점이 모두 선택 집합 안에 있는 엣지만 — 화면 밖으로 나가는 선을 만들지 않는다."""
    if not uids:
        return []
    cur.execute(
        """
        SELECT type, src_uid, dst_uid, props
        FROM graph.edge
        WHERE src_uid = ANY(%(uids)s) AND dst_uid = ANY(%(uids)s)
        """,
        {"uids": uids},
    )
    return [_edge(r) for r in cur.fetchall()]


def overview(
    conn: psycopg.Connection,
    labels: list[str] | None,
    per_label: int,
) -> GraphPayload:
    """라벨별 표본 + 그 사이의 엣지.

    라벨별로 끊어 뽑는 이유는 Security가 2,763개라 전체 상한만 걸면 화면이 종목으로
    가득 차고 나머지 라벨이 한 개도 안 보이기 때문이다.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            SELECT uid, label, name, props, evidence_count
            FROM (
                SELECT n.uid,
                       n.label,
                       {NAME_SQL} AS name,
                       n.props,
                       cardinality(n.evidence) AS evidence_count,
                       row_number() OVER (PARTITION BY n.label ORDER BY n.uid) AS rn
                FROM graph.node n
                WHERE %(labels)s::text[] IS NULL OR n.label = ANY(%(labels)s)
            ) t
            WHERE rn <= %(per_label)s
            ORDER BY label, uid
            """,
            {"labels": labels, "per_label": per_label},
        )
        rows = cur.fetchall()
        nodes = [_node(r) for r in rows]
        edges = _edges_among(cur, [r["uid"] for r in rows])

        cur.execute(
            """
            SELECT count(*) AS total FROM graph.node
            WHERE %(labels)s::text[] IS NULL OR label = ANY(%(labels)s)
            """,
            {"labels": labels},
        )
        total = cur.fetchone()["total"]

    return GraphPayload(
        nodes=nodes,
        edges=edges,
        meta=GraphMeta(
            node_count=len(nodes), edge_count=len(edges), truncated=len(nodes) < total
        ),
    )


def neighbors(
    conn: psycopg.Connection,
    node_id: str,
    *,
    depth: int,
    edge_types: list[str] | None,
    limit: int,
) -> GraphPayload:
    """uid에서 depth홉 이내 이웃. 방향 무시(-[]-) — 온톨로지 엣지는 방향이 의미를
    갖지만 탐색에서는 양쪽 다 보여야 한다."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            WITH RECURSIVE walk(uid, depth) AS (
                SELECT %(uid)s::text, 0
                UNION
                SELECT CASE WHEN e.src_uid = w.uid THEN e.dst_uid ELSE e.src_uid END,
                       w.depth + 1
                FROM walk w
                JOIN graph.edge e ON e.src_uid = w.uid OR e.dst_uid = w.uid
                WHERE w.depth < %(depth)s
                  AND (%(types)s::text[] IS NULL OR e.type = ANY(%(types)s))
            ),
            ranked AS (
                SELECT uid, min(depth) AS depth FROM walk GROUP BY uid
            )
            SELECT n.uid,
                   n.label,
                   {NAME_SQL} AS name,
                   n.props,
                   cardinality(n.evidence) AS evidence_count,
                   r.depth
            FROM ranked r
            JOIN graph.node n ON n.uid = r.uid
            ORDER BY r.depth, n.uid
            LIMIT %(limit)s
            """,
            {"uid": node_id, "depth": depth, "types": edge_types, "limit": limit + 1},
        )
        rows = cur.fetchall()
        truncated = len(rows) > limit
        rows = rows[:limit]
        nodes = [_node(r) for r in rows]
        edges = _edges_among(cur, [r["uid"] for r in rows])
        if edge_types:
            edges = [e for e in edges if e.label in edge_types]

    return GraphPayload(
        nodes=nodes,
        edges=edges,
        meta=GraphMeta(node_count=len(nodes), edge_count=len(edges), truncated=truncated),
    )


def node_detail(conn: psycopg.Connection, node_id: str) -> NodeDetail | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            SELECT n.uid,
                   n.label,
                   {NAME_SQL} AS name,
                   n.props,
                   n.evidence,
                   n.projected_at
            FROM graph.node n
            WHERE n.uid = %(uid)s
            """,
            {"uid": node_id},
        )
        row = cur.fetchone()
        if row is None:
            return None

        cur.execute(
            """
            SELECT type, 'out' AS direction, count(*) AS count
            FROM graph.edge WHERE src_uid = %(uid)s GROUP BY type
            UNION ALL
            SELECT type, 'in', count(*)
            FROM graph.edge WHERE dst_uid = %(uid)s GROUP BY type
            ORDER BY count DESC
            """,
            {"uid": node_id},
        )
        degrees = [DegreeEntry(**d) for d in cur.fetchall()]

    evidence = list(row["evidence"] or [])
    return NodeDetail(
        id=row["uid"],
        label=row["label"],
        name=row["name"],
        properties=row["props"] or {},
        # 증거는 수만 건이 될 수 있다 — 화면에는 앞쪽만, 전체 수는 따로 준다.
        evidence=evidence[:50],
        evidence_count=len(evidence),
        degrees=degrees,
        projected_at=row["projected_at"].isoformat() if row["projected_at"] else None,
    )


def search(
    conn: psycopg.Connection,
    query: str,
    *,
    label: str | None,
    limit: int,
) -> SearchResponse:
    """이름·uid·ticker 부분일치. 노드가 수천 개 규모라 순차 스캔으로 충분하다."""
    pattern = f"%{query}%"
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""
            SELECT n.uid,
                   n.label,
                   {NAME_SQL} AS name,
                   CASE
                       WHEN {NAME_SQL} ILIKE %(pattern)s THEN 'name'
                       WHEN n.props->>'ticker' ILIKE %(pattern)s THEN 'ticker'
                       ELSE 'uid'
                   END AS matched_on
            FROM graph.node n
            WHERE (%(label)s::text IS NULL OR n.label = %(label)s)
              AND (
                    {NAME_SQL} ILIKE %(pattern)s
                 OR n.uid ILIKE %(pattern)s
                 OR n.props->>'ticker' ILIKE %(pattern)s
              )
            ORDER BY length({NAME_SQL}), n.uid
            LIMIT %(limit)s
            """,
            {"pattern": pattern, "label": label, "limit": limit + 1},
        )
        rows = cur.fetchall()

    truncated = len(rows) > limit
    hits = [
        SearchHit(id=r["uid"], label=r["label"], name=r["name"], matched_on=r["matched_on"])
        for r in rows[:limit]
    ]
    return SearchResponse(query=query, hits=hits, truncated=truncated)


# --- 어휘 -------------------------------------------------------------------

_ARRAY_ITEM = re.compile(r"'((?:[^']|'')*)'::text")


def _allowed_from_constraint(cur: psycopg.Cursor, table: str, constraint: str) -> list[str]:
    """CHECK 제약 정의에서 허용 값 목록을 되읽는다.

    어휘를 파이썬에 다시 적지 않기 위해서다. 문서(scenario-ontology.md)가 진실이고
    db/ontology.sql이 그것을 강제하므로, API는 강제된 것을 그대로 보여주면 된다.
    """
    cur.execute(
        """
        SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = t.relnamespace
        WHERE ns.nspname = 'graph' AND t.relname = %(table)s AND c.conname = %(constraint)s
        """,
        {"table": table, "constraint": constraint},
    )
    row = cur.fetchone()
    if not row:
        return []
    definition = row[0] if isinstance(row, tuple) else row["def"]
    return [m.group(1).replace("''", "'") for m in _ARRAY_ITEM.finditer(definition)]


def vocabulary(conn: psycopg.Connection) -> VocabularyResponse:
    with conn.cursor() as cur:
        allowed_labels = _allowed_from_constraint(cur, "node", "node_label_known")
        allowed_types = _allowed_from_constraint(cur, "edge", "edge_type_known")
        derived_types = set(
            _allowed_from_constraint(cur, "edge", "derived_edge_declares_method")
        )

        cur.execute("SELECT label, count(*) FROM graph.node GROUP BY 1")
        node_counts = dict(cur.fetchall())
        cur.execute("SELECT type, count(*) FROM graph.edge GROUP BY 1")
        edge_counts = dict(cur.fetchall())

    # 제약에 없는데 적재된 라벨은 원리상 없지만, 제약이 바뀌는 중일 수 있어 합집합으로 둔다.
    labels = sorted(set(allowed_labels) | set(node_counts))
    types = sorted(set(allowed_types) | set(edge_counts))
    return VocabularyResponse(
        labels=[LabelEntry(label=l, count=node_counts.get(l, 0)) for l in labels],
        edge_types=[
            EdgeTypeEntry(type=t, count=edge_counts.get(t, 0), derived=t in derived_types)
            for t in types
        ],
        node_total=sum(node_counts.values()),
        edge_total=sum(edge_counts.values()),
    )
