"""Build compact, target-specific Evidence Markdown for paper trading."""

from __future__ import annotations

from pathlib import Path
from typing import Any


DOCUMENT_FILES = {
    "market": "market-evidence.md",
    "economy": "economic-evidence.md",
    "events": "external-event-evidence.md",
    "community": "community-evidence.md",
}


def _line(value: Any) -> str:
    return str(value if value is not None else "").replace("|", "\\|").replace("\n", " ").strip()


def _evidence_row(index: int, claim: str, observed_at: Any, source: str) -> str:
    return f"| {source.upper()}-{index:03d} | {_line(claim)} | {_line(observed_at)} | {_line(source)} | paper-trading-history |"


def _header(title: str, history: dict[str, Any]) -> list[str]:
    return [
        f"# {title}",
        "## Analysis Context",
        f"- 대상: {_line(history.get('name'))} ({_line(history.get('ticker'))})",
        f"- 관측 기간: {_line(history.get('start_date'))} ~ {_line(history.get('end_date'))}",
        "- 이 문서는 선택 종목의 실제 PostgreSQL 이력을 초기 시나리오 맥락으로 정리한 것이다.",
    ]


def build_target_documents(history: dict[str, Any], output_dir: Path) -> dict[str, str]:
    """Write four auditable Markdown documents and return their relative names."""
    output_dir.mkdir(parents=True, exist_ok=True)
    market_days = history.get("market_days") or []
    recent = market_days[-30:]
    macro = (history.get("macro_observations") or [])[-40:]
    social = (history.get("social_signals") or [])[-30:]
    events = [
        {**event, "trade_date": day.get("trade_date")}
        for day in market_days for event in (day.get("events") or [])
    ]
    events = sorted(events, key=lambda item: str(item.get("trade_date") or ""), reverse=True)[:40]

    market_lines = _header("Market Evidence", history) + [
        "## Scenario-Aligned Retrieval Plan",
        "- 선택 종목의 실제 가격·거래량·수급 이력과 최근 30거래일을 초기 맥락 분석 대상으로 삼는다.",
        "## Current State",
        f"- 관측 거래일: {len(market_days)}일",
        f"- 최근 30거래일 원시 행: {len(recent)}개",
        "## Raw Time Series",
        "| trade_date | open | high | low | close | volume | investor_flow |",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    for day in recent:
        market_lines.append("| " + " | ".join(_line(day.get(key)) for key in ("trade_date", "open", "high", "low", "close", "volume")) + f" | {_line(day.get('investor_flow'))} |")
    market_lines += ["## Investor Flow", "- 수급 값은 원자료의 범위와 단위를 유지하며, 인과관계로 단정하지 않는다.", "## Evidence Register", "| evidence_id | claim | observed_at | source | record_id_or_url |", "|---|---|---|---|---|"]
    market_lines += [_evidence_row(i, f"{day.get('trade_date')} 종가 {_line(day.get('close'))}", day.get("trade_date"), "market") for i, day in enumerate(recent, 1)]
    market_lines += ["## Limitations", "- 이 문서의 해석은 별도 LLM 분석 결과가 아니며, 위 원시 관측값에 대한 후속 분석 입력이다."]

    economy_lines = _header("Economic Evidence", history) + [
        "## Scenario-Aligned Retrieval Plan", "- 선택 종목 시나리오 기간과 겹치는 실제 거시경제 관측치를 정리한다.",
        "## Current Macro State", "| trade_date | series_name | value | unit | source |", "|---|---|---:|---|---|",
    ]
    for row in macro:
        economy_lines.append("| " + " | ".join(_line(row.get(key)) for key in ("trade_date", "series_name", "value", "unit", "source")) + " |")
    economy_lines += ["## Recent Changes", f"- 확인된 경제 관측치: {len(history.get('macro_observations') or [])}개", "## Evidence Register", "| evidence_id | claim | observed_at | source | record_id_or_url |", "|---|---|---|---|---|"]
    economy_lines += [_evidence_row(i, f"{row.get('series_name')} = {_line(row.get('value'))} {_line(row.get('unit'))}", row.get("trade_date"), "economy") for i, row in enumerate(macro, 1)]
    economy_lines += ["## Limitations", "- 경제지표의 종목 영향은 상관관계와 가능성으로만 해석한다."]

    event_lines = _header("External Event Evidence", history) + [
        "## Scenario-Aligned Retrieval Plan", "- 실제 적재 뉴스·정책·시장 이벤트 중 선택 종목 시나리오의 최근 맥락과 관련된 자료를 정리한다.",
        "## Event Clusters", "| date | title | summary | scope | event_types |", "|---|---|---|---|---|",
    ]
    for event in events:
        event_lines.append("| " + " | ".join(_line(event.get(key)) for key in ("trade_date", "title", "summary", "scope", "event_types")) + " |")
    event_lines += ["## Evidence Register", "| evidence_id | claim | observed_at | source | record_id_or_url |", "|---|---|---|---|---|"]
    event_lines += [_evidence_row(i, event.get("title", "실제 적재 이벤트"), event.get("trade_date"), "events") for i, event in enumerate(events, 1)]
    event_lines += ["## Limitations", "- 이벤트는 시장 전체 또는 산업 단위 자료일 수 있으며 종목 영향은 확정하지 않는다."]

    community_lines = _header("Community Evidence", history) + [
        "## Scenario-Aligned Retrieval Plan", "- 실제 일별 커뮤니티 심리·게시량·참여 지표를 보조 맥락으로 정리한다.",
        "## Community Signals", "| trade_date | sentiment | post_count | engagement |", "|---|---:|---:|---:|",
    ]
    for row in social:
        community_lines.append("| " + " | ".join(_line(row.get(key)) for key in ("trade_date", "sentiment", "post_count", "engagement")) + " |")
    community_lines += ["## Evidence Register", "| evidence_id | claim | observed_at | source | record_id_or_url |", "|---|---|---|---|---|"]
    community_lines += [_evidence_row(i, f"일별 커뮤니티 감성 {_line(row.get('sentiment'))}, 게시물 {_line(row.get('post_count'))}개", row.get("trade_date"), "community") for i, row in enumerate(social, 1)]
    community_lines += ["## Limitations", "- 커뮤니티 지표는 투자자 심리의 보조 관측값이며 시장 방향의 원인으로 단정하지 않는다."]

    documents = {
        "market": "\n".join(market_lines) + "\n",
        "economy": "\n".join(economy_lines) + "\n",
        "events": "\n".join(event_lines) + "\n",
        "community": "\n".join(community_lines) + "\n",
    }
    for key, content in documents.items():
        (output_dir / DOCUMENT_FILES[key]).write_text(content, encoding="utf-8")
    return {key: DOCUMENT_FILES[key] for key in documents}
