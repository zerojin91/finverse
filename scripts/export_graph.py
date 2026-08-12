#!/usr/bin/env python3
"""Export the ontology graph as one JSON file a viewer can open without a server.

The frontend in this repo builds for Cloudflare/Vercel edge, and Postgres is
bound to loopback on the collector host, so a browser page cannot query the
database directly. A snapshot export sidesteps that: the viewer stays a static
file and can be regenerated whenever the projection runs.

    scripts/export_graph.py                    # -> data/graph-export.json
    scripts/export_graph.py --out /tmp/g.json

What it does NOT export: the instance graph in full. 2,763 securities in one
force layout is a hairball, and MarketMove over sixteen years of index history
is far more than a page should carry. Securities are capped per sector and
MarketMove is summarised by year, with the caps reported in `limits` so a
reader can tell what was left out.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "graph-export.json"
SECURITIES_PER_SECTOR = 12


def load_dotenv(root: Path) -> None:
    path = root / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def query(sql: str):
    """Run one query and return its rows as parsed JSON."""
    if not shutil.which("docker"):
        raise SystemExit("docker not found")
    user = os.environ.get("POSTGRES_USER", "finverse")
    database = os.environ.get("POSTGRES_DB", "finverse")
    wrapped = f"SELECT coalesce(json_agg(t), '[]') FROM ({sql}) t;"
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "psql", "-U", user, "-d", database,
         "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-qtA", "-c", wrapped],
        capture_output=True, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(f"psql failed: {result.stderr.decode('utf-8', 'replace').strip()}")
    return json.loads(result.stdout.decode("utf-8", "replace").strip() or "[]")


SCHEMA_LABELS = """
    SELECT label, count(*)::int AS n
    FROM graph.node GROUP BY label ORDER BY n DESC
"""

SCHEMA_EDGES = """
    SELECT e.type,
           count(*)::int AS n,
           min(s.label) AS src_label,
           min(d.label) AS dst_label,
           bool_or(t.type IS NOT NULL) AS derived
    FROM graph.edge e
    JOIN graph.node s ON s.uid = e.src_uid
    JOIN graph.node d ON d.uid = e.dst_uid
    LEFT JOIN graph.derived_edge_type t ON t.type = e.type
    GROUP BY e.type ORDER BY n DESC
"""

# 스펙에 선언된 것 전부. 실제로 0건인 엣지도 화면에 남겨야 "아직 안 만든 연결"이
# 보인다 -- 있는 것만 그리면 온톨로지가 실제보다 완성돼 보인다.
SPEC_EDGES = """
    SELECT x.type, x.src_label, x.dst_label,
           coalesce(c.n, 0)::int AS n,
           (t.type IS NOT NULL) AS derived
    FROM graph.edge_spec x
    LEFT JOIN graph.derived_edge_type t ON t.type = x.type
    LEFT JOIN (
        SELECT e.type, s.label AS sl, d.label AS dl, count(*)::int AS n
        FROM graph.edge e
        JOIN graph.node s ON s.uid = e.src_uid
        JOIN graph.node d ON d.uid = e.dst_uid
        GROUP BY 1, 2, 3
    ) c ON c.type = x.type AND c.sl = x.src_label AND c.dl = x.dst_label
    ORDER BY x.type, x.src_label, x.dst_label
"""

# 섹터마다 앞 N개 종목만 싣는다. 2,763개를 한 화면에 풀면 그림이 아니라 털뭉치다.
CAPPED = f"""
    capped AS (
        SELECT uid FROM (
            SELECT e.src_uid AS uid,
                   row_number() OVER (PARTITION BY e.dst_uid ORDER BY e.src_uid) AS rn
            FROM graph.edge e WHERE e.type = 'IN_SECTOR'
        ) r WHERE rn <= {SECURITIES_PER_SECTOR}
    ),
    shown AS (
        SELECT uid FROM graph.node
        WHERE label IN ('Market', 'Index', 'Sector', 'Indicator')
        UNION SELECT uid FROM capped
    )
"""

INSTANCE_NODES = f"""
    WITH {CAPPED}
    SELECT n.uid, n.label,
           coalesce(n.props->>'name', n.props->>'idx_name', n.props->>'short_name',
                    n.props->>'series_name', n.props->>'title', n.uid) AS name,
           n.props->>'kind'   AS kind,
           n.props->>'scheme' AS scheme,
           n.props->>'ticker' AS ticker
    FROM graph.node n
    WHERE n.uid IN (SELECT uid FROM shown)
"""

# 양 끝이 모두 실린 엣지만. 안 그러면 잘라낸 종목으로 향하는 끊긴 선이 남는다.
INSTANCE_EDGES = f"""
    WITH {CAPPED}
    SELECT e.type, e.src_uid, e.dst_uid,
           e.props->>'universe' AS universe
    FROM graph.edge e
    WHERE e.type IN ('LISTED_ON', 'TRACKS', 'SECTOR_INDEX_OF', 'IN_SECTOR')
      AND e.src_uid IN (SELECT uid FROM shown)
      AND e.dst_uid IN (SELECT uid FROM shown)
"""

MOVES_BY_YEAR = """
    SELECT left(props->>'bas_dd', 4) AS year,
           props->>'target_label' AS target_label,
           props->>'kind' AS kind,
           count(*)::int AS n
    FROM graph.node WHERE label = 'MarketMove'
    GROUP BY 1, 2, 3 ORDER BY 1
"""

BIGGEST_MOVES = """
    SELECT n.props->>'bas_dd' AS bas_dd,
           n.props->>'kind' AS kind,
           (n.props->>'magnitude')::numeric AS magnitude,
           n.props->>'target_label' AS target_label,
           coalesce(t.props->>'idx_name', t.props->>'name', n.props->>'target_uid') AS target,
           n.props->>'detected_by' AS detected_by
    FROM graph.node n
    LEFT JOIN graph.node t ON t.uid = n.props->>'target_uid'
    WHERE n.label = 'MarketMove'
    ORDER BY abs((n.props->>'magnitude')::numeric) DESC
    LIMIT 25
"""

GAPS = """
    SELECT x.type, x.src_label, x.dst_label
    FROM graph.edge_spec x
    WHERE NOT EXISTS (SELECT 1 FROM graph.edge e WHERE e.type = x.type)
    ORDER BY 1, 2, 3
"""


def main() -> int:
    load_dotenv(ROOT)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    export = {
        "labels": query(SCHEMA_LABELS),
        "edge_types": query(SCHEMA_EDGES),
        "spec": query(SPEC_EDGES),
        "nodes": query(INSTANCE_NODES),
        "edges": query(INSTANCE_EDGES),
        "moves_by_year": query(MOVES_BY_YEAR),
        "biggest_moves": query(BIGGEST_MOVES),
        "unrealised_edges": query(GAPS),
        "limits": {
            "securities_per_sector": SECURITIES_PER_SECTOR,
            "note": ("Security nodes are capped per sector and MarketMove is "
                     "summarised by year; totals in `labels` are the real counts."),
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(export, ensure_ascii=False), encoding="utf-8")

    print(json.dumps({
        "out": str(args.out),
        "bytes": args.out.stat().st_size,
        "nodes_exported": len(export["nodes"]),
        "edges_exported": len(export["edges"]),
        "labels": {row["label"]: row["n"] for row in export["labels"]},
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
