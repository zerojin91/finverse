#!/usr/bin/env python3
"""Fold a graph export into the viewer template to make one self-contained page.

The viewer has to work with no server behind it -- Postgres is on loopback and
the frontend builds for the edge -- so the snapshot is inlined rather than
fetched. That also makes the output a single file anyone can open or host.

    scripts/export_graph.py
    scripts/build_viewer.py                     # -> data/ontology-viewer.html
    scripts/build_viewer.py --out /tmp/v.html
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "docs" / "ontology" / "viewer.template.html"
EXPORT = ROOT / "data" / "graph-export.json"
DEFAULT_OUT = ROOT / "data" / "ontology-viewer.html"
TOKEN = "__GRAPH_JSON__"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, default=TEMPLATE)
    parser.add_argument("--export", type=Path, default=EXPORT)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    for path in (args.template, args.export):
        if not path.exists():
            raise SystemExit(f"missing {path}")

    template = args.template.read_text(encoding="utf-8")
    if TOKEN not in template:
        raise SystemExit(f"template has no {TOKEN} placeholder")

    data = json.loads(args.export.read_text(encoding="utf-8"))
    # Inlined inside <script type="application/json">, so the only sequence that
    # can break out is a literal </script>. Escaping the slash keeps the JSON
    # valid and the parser inside the tag.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")) \
                  .replace("</", "<\\/")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(template.replace(TOKEN, payload), encoding="utf-8")

    print(json.dumps({"out": str(args.out), "bytes": args.out.stat().st_size},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
