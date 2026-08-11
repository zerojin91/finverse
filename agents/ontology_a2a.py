"""Minimal Deep Agents prototype for FINVERSE ontology collection.

Run:
    uv run python -m agents.ontology_a2a "오늘 이후 코스피가 어떻게 변할까?"

The prototype keeps the LLM responsible for interpretation and writing while
keeping database access behind small, read-only domain tools.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any, Callable

import psycopg
from psycopg.rows import dict_row
from deepagents import create_deep_agent
from langchain.tools import tool


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "output"

DOMAIN_FILES = {
    "market": "market-evidence.md",
    "economy": "economic-evidence.md",
    "events": "external-event-evidence.md",
    "psychology": "psychology-evidence.md",
}

DOMAIN_VIEWS = {
    "market": (
        "market.index_daily",
        "market.price_daily",
        "market.investor_flow_daily",
        "market.foreign_holding_daily",
    ),
    "economy": ("economy.observation", "economy.series"),
    "events": ("events.news", "events.news_daily"),
    # These views are the planned interface. The tool returns a useful gap
    # message until the YouTube collector is loaded into PostgreSQL.
    "psychology": (
        "psychology.sentiment_daily",
        "psychology.narratives",
    ),
}


def _load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _query_views(domain: str, limit: int = 25) -> dict[str, Any]:
    """Read a small, bounded sample from the domain's approved PostgreSQL views."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        return {"error": "DATABASE_URL is not configured", "domain": domain}

    safe_limit = max(1, min(limit, 100))
    result: dict[str, Any] = {"domain": domain, "views": {}}
    try:
        with psycopg.connect(database_url, row_factory=dict_row) as connection:
            for view in DOMAIN_VIEWS[domain]:
                try:
                    with connection.cursor() as cursor:
                        cursor.execute(f"SELECT * FROM {view} LIMIT %s", (safe_limit,))
                        result["views"][view] = cursor.fetchall()
                except psycopg.Error as exc:
                    connection.rollback()
                    result["views"][view] = {"unavailable": str(exc).splitlines()[0]}
    except psycopg.Error as exc:
        return {"error": str(exc).splitlines()[0], "domain": domain}
    return result


def _make_query_tool(domain: str):
    @tool(f"query_{domain}_data")
    def query_data(limit: int = 25) -> str:
        """Query approved PostgreSQL views for this ontology domain."""
        return json.dumps(_query_views(domain, limit), ensure_ascii=False, default=str)

    return query_data


def _make_save_tool(output_dir: Path, domain: str):
    filename = DOMAIN_FILES[domain]

    @tool(f"save_{domain}_evidence")
    def save_evidence(markdown: str) -> str:
        """Save the completed Evidence Markdown document for this domain."""
        target = output_dir / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(markdown.strip() + "\n", encoding="utf-8")
        return f"saved {target}"

    return save_evidence


def _make_read_tool(output_dir: Path):
    @tool("read_evidence_documents")
    def read_evidence_documents() -> str:
        """Read the Evidence Markdown files already written by subagents."""
        documents = {}
        for filename in DOMAIN_FILES.values():
            path = output_dir / filename
            documents[filename] = (
                path.read_text(encoding="utf-8") if path.exists() else "MISSING"
            )
        return json.dumps(documents, ensure_ascii=False)

    return read_evidence_documents


def _subagent(domain: str, output_dir: Path) -> dict[str, Any]:
    labels = {
        "market": "시장",
        "economy": "경제",
        "events": "외부 사건",
        "psychology": "사람들의 심리",
    }
    return {
        "name": f"{domain}-agent",
        "description": f"Collects PostgreSQL evidence for the FINVERSE {labels[domain]} ontology domain.",
        "tools": [_make_query_tool(domain), _make_save_tool(output_dir, domain)],
        "system_prompt": f"""
너는 FINVERSE의 {labels[domain]} Agent다.
사용자 질문에 답을 예측하지 말고, PostgreSQL의 승인된 view만 조회해 Evidence 문서를 만든다.
먼저 query_{domain}_data 도구를 사용한다.
관측된 사실, 해석, 후보 관계, 불확실성, 부족한 데이터를 분리한다.
아래 형식의 Markdown 문서를 작성한 뒤 save_{domain}_evidence 도구로 저장한다.

# {labels[domain]} Evidence
## Current State
## Main Factors
## Relation Candidates
## Uncertainties
## Limitations

데이터가 없으면 추측하지 말고 해당 항목을 부족한 데이터로 기록한다.
""".strip(),
    }


def build_agent(output_dir: Path | None = None):
    """Build the Moderator Deep Agent and its four domain subagents."""
    output_dir = output_dir or DEFAULT_OUTPUT_DIR
    model = os.environ.get("FINVERSE_AGENT_MODEL", "anthropic:claude-sonnet-4-6")
    subagents = [_subagent(domain, output_dir) for domain in DOMAIN_FILES]
    moderator_prompt = """
너는 FINVERSE Moderator Agent다.
사용자 질문을 분석하고 네 개의 Domain Agent에 작업을 위임한다.
각 Agent가 자기 Evidence Markdown 파일을 저장했는지 확인한다.
네 문서를 읽고 기준 시각, 대상, 사실/해석 구분, 출처, 누락을 검토한다.
부족한 내용이 있으면 같은 Agent에 구체적인 재수집 요청을 보내 최대 1회 보완한다.
최종적으로 네 개의 Evidence 문서가 준비되었다는 짧은 실행 요약만 반환한다.
확정적인 시장 예측이나 투자 추천을 만들지 않는다.
""".strip()
    return create_deep_agent(
        model=model,
        system_prompt=moderator_prompt,
        tools=[_make_read_tool(output_dir)],
        subagents=subagents,
    )


def run(query: str, output_dir: Path | None = None) -> dict[str, Any]:
    """Run one ontology collection request and return the agent result."""
    _load_dotenv()
    output_dir = output_dir or DEFAULT_OUTPUT_DIR / _slug(query)
    agent = build_agent(output_dir)
    result = agent.invoke({"messages": [{"role": "user", "content": query}]})
    return {"output_dir": str(output_dir), "result": result}


def _slug(value: str) -> str:
    value = re.sub(r"[^\w가-힣]+", "-", value, flags=re.UNICODE).strip("-").lower()
    return value[:80] or "ontology-run"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run FINVERSE ontology A2A agents")
    parser.add_argument("query", help="User scenario query")
    parser.add_argument("--output-dir", type=Path, default=None)
    args = parser.parse_args()
    result = run(args.query, args.output_dir)
    print(json.dumps({"output_dir": result["output_dir"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
