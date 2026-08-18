"""CHECK 제약에서 어휘를 되읽는 정규식 테스트 — DB 없이 도는 단위 테스트.

어휘를 파이썬에 다시 적지 않는 설계의 핵심이 이 파싱이라, 여기가 조용히 깨지면
화면이 "어휘 0종"으로 멀쩡해 보이면서 비어버린다.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fin_api.services.graph_service import _ARRAY_ITEM  # noqa: E402


def parse(definition: str) -> list[str]:
    return [m.group(1).replace("''", "'") for m in _ARRAY_ITEM.finditer(definition)]


def test_parses_node_label_constraint() -> None:
    # pg_get_constraintdef가 실제로 돌려주는 형태
    definition = (
        "CHECK ((label = ANY (ARRAY['Market'::text, 'Index'::text, "
        "'Sector'::text, 'MarketMove'::text])))"
    )
    assert parse(definition) == ["Market", "Index", "Sector", "MarketMove"]


def test_parses_edge_type_constraint() -> None:
    definition = "CHECK ((type = ANY (ARRAY['LISTED_ON'::text, 'IN_SECTOR'::text])))"
    assert parse(definition) == ["LISTED_ON", "IN_SECTOR"]


def test_parses_derived_constraint_with_negation() -> None:
    # 파생 엣지 제약은 <> ALL 형태다 — 목록만 뽑으면 되므로 부정과 무관하다.
    definition = (
        "CHECK (((type <> ALL (ARRAY['INFLUENCED'::text, 'CO_MOVES_WITH'::text])) "
        "OR ((props ? 'method'::text) AND (props ? 'computed_at'::text))))"
    )
    assert parse(definition)[:2] == ["INFLUENCED", "CO_MOVES_WITH"]


def test_unescapes_doubled_quotes() -> None:
    assert parse("ARRAY['it''s'::text]") == ["it's"]


def test_no_match_returns_empty() -> None:
    # 제약이 사라졌거나 이름이 바뀌면 빈 목록 — 예외로 API 전체를 죽이지 않는다.
    assert parse("CHECK ((label IS NOT NULL))") == []
