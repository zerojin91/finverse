"""Minimal Deep Agents prototype for FINVERSE ontology collection.

Run:
    uv run python -m agents.ontology_a2a "오늘 이후 코스피가 어떻게 변할까?"

The prototype keeps the LLM responsible for interpretation and writing while
keeping database access behind small, read-only domain tools.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import logging
import os
import re
import time
import traceback
from pathlib import Path
from typing import Any, Callable

from deepagents import create_deep_agent
from langchain.tools import tool

from agents.mirofish_a2a import _create_chat_model, _read_query


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

# Every view that has a comparable business date is queried with a recent
# window and newest-first ordering. This prevents LIMIT from returning an
# arbitrary old slice of the data lake.
VIEW_DATE_COLUMNS = {
    "market.index_daily": "trade_date",
    "market.price_daily": "trade_date",
    "market.investor_flow_daily": "trade_date",
    "market.foreign_holding_daily": "trade_date",
    "economy.observation": "period_start",
    "economy.series": "last_period",
    "events.news": "published_at",
    "events.news_daily": "publish_date",
}
DEFAULT_FRESHNESS_DAYS = 730

LOGGER = logging.getLogger("finverse.ontology_a2a")
LOGGER.addHandler(logging.NullHandler())


def _log(message: str, **fields: Any) -> None:
    if fields:
        message = f"{message} | {json.dumps(fields, ensure_ascii=False, default=str)}"
    LOGGER.info(message)


def _configure_logging(output_dir: Path) -> None:
    """Write progress to both the terminal and output_dir/run.log."""
    output_dir.mkdir(parents=True, exist_ok=True)
    LOGGER.handlers.clear()
    LOGGER.setLevel(logging.INFO)
    LOGGER.propagate = False
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    file_handler = logging.FileHandler(output_dir / "run.log", encoding="utf-8")
    file_handler.setFormatter(formatter)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    LOGGER.addHandler(file_handler)
    LOGGER.addHandler(console_handler)


def _close_logging() -> None:
    for handler in list(LOGGER.handlers):
        handler.flush()
        handler.close()
        LOGGER.removeHandler(handler)


def _view_query(view: str, limit: int) -> tuple[str, tuple[int, ...]]:
    """Build a bounded newest-first query for an approved view only."""
    direct_market_queries = {
        "market.index_daily": (
            "SELECT (r.payload->>'bas_dd')::date AS trade_date, "
            "r.payload->>'idx_class' AS idx_class, "
            "r.payload->>'idx_name' AS idx_name, "
            "r.payload->>'source' AS source, "
            "(r.payload->>'open')::numeric AS open, "
            "(r.payload->>'high')::numeric AS high, "
            "(r.payload->>'low')::numeric AS low, "
            "(r.payload->>'close')::numeric AS close, "
            "(r.payload->>'change_pct')::numeric AS change_pct, "
            "(r.payload->>'volume')::bigint AS volume, "
            "(r.payload->>'trading_value')::bigint AS trading_value, "
            "(r.payload->>'market_cap')::bigint AS market_cap, r.record_id "
            "FROM lake.records AS r "
            "WHERE r.record_type = 'market_index_daily' "
            "AND r.payload ? 'bas_dd' "
            "AND r.payload->>'bas_dd' >= ((CURRENT_DATE - INTERVAL '730 days')::date)::text "
            "ORDER BY r.payload->>'bas_dd' DESC LIMIT %s"
        ),
        "market.price_daily": (
            "SELECT (r.payload->>'bas_dd')::date AS trade_date, "
            "r.payload->>'ticker' AS ticker, r.payload->>'name' AS name, "
            "r.payload->>'market' AS market, r.payload->>'source' AS source, "
            "r.payload->>'price_basis' AS price_basis, "
            "(r.payload->>'open')::numeric AS open, "
            "(r.payload->>'high')::numeric AS high, "
            "(r.payload->>'low')::numeric AS low, "
            "(r.payload->>'close')::numeric AS close, "
            "(r.payload->>'change_pct')::numeric AS change_pct, "
            "(r.payload->>'volume')::bigint AS volume, "
            "(r.payload->>'trading_value')::bigint AS trading_value, "
            "(r.payload->>'market_cap')::bigint AS market_cap, "
            "r.record_id FROM lake.records AS r "
            "WHERE r.record_type = 'market_price_daily' "
            "AND r.payload ? 'bas_dd' "
            "AND r.payload->>'bas_dd' >= ((CURRENT_DATE - INTERVAL '730 days')::date)::text "
            "ORDER BY r.payload->>'bas_dd' DESC LIMIT %s"
        ),
        "market.investor_flow_daily": (
            "SELECT (r.payload->>'bas_dd')::date AS trade_date, "
            "r.payload->>'target_type' AS target_type, "
            "r.payload->>'target' AS target, r.payload->>'investor' AS investor, "
            "(r.payload->>'net_value_krw')::bigint AS net_value_krw, "
            "(r.payload->>'net_volume')::bigint AS net_volume, "
            "r.payload->>'source' AS source, r.record_id "
            "FROM lake.records AS r "
            "WHERE r.record_type = 'market_investor_flow_daily' "
            "AND r.payload ? 'bas_dd' "
            "AND r.payload->>'bas_dd' >= ((CURRENT_DATE - INTERVAL '730 days')::date)::text "
            "ORDER BY r.payload->>'bas_dd' DESC LIMIT %s"
        ),
        "market.foreign_holding_daily": (
            "SELECT (r.payload->>'bas_dd')::date AS trade_date, "
            "r.payload->>'ticker' AS ticker, "
            "(r.payload->>'held_shares')::bigint AS held_shares, "
            "(r.payload->>'held_pct')::numeric AS held_pct, "
            "r.payload->>'source' AS source, r.record_id "
            "FROM lake.records AS r "
            "WHERE r.record_type = 'market_foreign_holding_daily' "
            "AND r.payload ? 'bas_dd' "
            "AND r.payload->>'bas_dd' >= ((CURRENT_DATE - INTERVAL '730 days')::date)::text "
            "ORDER BY r.payload->>'bas_dd' DESC LIMIT %s"
        ),
    }
    if view in direct_market_queries:
        # Query the indexed landing table directly. Sorting the JSON-cast view
        # can force a full scan, while bas_dd has a dedicated expression index.
        return direct_market_queries[view], (limit,)
    date_column = VIEW_DATE_COLUMNS.get(view)
    if not date_column:
        return f"SELECT * FROM {view} LIMIT %s", (limit,)
    return (
        f"SELECT * FROM {view} "
        f"WHERE {date_column} >= CURRENT_DATE - INTERVAL '{DEFAULT_FRESHNESS_DAYS} days' "
        f"ORDER BY {date_column} DESC NULLS LAST LIMIT %s",
        (limit,),
    )


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
    safe_limit = max(1, min(limit, 100))
    result: dict[str, Any] = {"domain": domain, "views": {}}
    _log("database_query_start", domain=domain, limit=safe_limit)
    for view in DOMAIN_VIEWS[domain]:
        started = time.perf_counter()
        _log("database_view_start", domain=domain, view=view)
        try:
            sql, params = _view_query(view, safe_limit)
            _log(
                "database_sql",
                domain=domain,
                view=view,
                sql=sql,
                params=params,
                freshness_days=DEFAULT_FRESHNESS_DAYS if view in VIEW_DATE_COLUMNS else None,
            )
            rows = _read_query(sql, params)
            result["views"][view] = rows
            _log(
                "database_view_complete",
                domain=domain,
                view=view,
                rows=len(rows),
                elapsed_seconds=round(time.perf_counter() - started, 2),
            )
        except Exception as exc:  # noqa: BLE001 - preserve per-view evidence gaps.
            message = str(exc).splitlines()[0]
            result["views"][view] = {"unavailable": message}
            _log(
                "database_view_error",
                domain=domain,
                view=view,
                error=f"{type(exc).__name__}: {message}",
                traceback=traceback.format_exc(),
            )
    _log("database_query_complete", domain=domain, views=len(result["views"]))
    return result


def _make_query_tool(domain: str):
    @tool(f"query_{domain}_data")
    def query_data(limit: int = 25) -> str:
        """Query approved PostgreSQL views for this ontology domain."""
        _log("tool_query_start", domain=domain, limit=limit)
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
        _log("evidence_saved", domain=domain, path=str(target), bytes=target.stat().st_size)
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
        _log(
            "evidence_read",
            files={filename: value != "MISSING" for filename, value in documents.items()},
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
    system_prompt = f"""
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
""".strip()
    _log("prompt_subagent", domain=domain, prompt=system_prompt)
    return {
        "name": f"{domain}-agent",
        "description": f"Collects PostgreSQL evidence for the FINVERSE {labels[domain]} ontology domain.",
        "tools": [_make_query_tool(domain), _make_save_tool(output_dir, domain)],
        "system_prompt": system_prompt,
    }


def build_agent(output_dir: Path | None = None):
    """Build the Moderator Deep Agent and its four domain subagents."""
    output_dir = output_dir or DEFAULT_OUTPUT_DIR
    model_setting = os.environ.get("FINVERSE_AGENT_MODEL", "anthropic:claude-sonnet-4-6")
    model = (
        _create_chat_model(model_setting)
        if model_setting.startswith(("bedrock:", "openai:"))
        else model_setting
    )
    _log("agent_build_start", output_dir=str(output_dir), model=model_setting, domains=list(DOMAIN_FILES))
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
    _log("prompt_moderator", prompt=moderator_prompt)
    agent = create_deep_agent(
        model=model,
        system_prompt=moderator_prompt,
        tools=[_make_read_tool(output_dir)],
        subagents=subagents,
    )
    _log("agent_build_complete", output_dir=str(output_dir))
    return agent


def run(query: str, output_dir: Path | None = None) -> dict[str, Any]:
    """Run one ontology collection request and return the agent result."""
    _load_dotenv()
    base_output_dir = output_dir or DEFAULT_OUTPUT_DIR / _slug(query)
    run_id = datetime.now().strftime("run-%Y%m%d-%H%M%S-%f")
    output_dir = base_output_dir / run_id
    _configure_logging(output_dir)
    started = time.perf_counter()
    _log(
        "run_start",
        query=query,
        base_output_dir=str(base_output_dir),
        output_dir=str(output_dir),
        run_id=run_id,
    )
    try:
        agent = build_agent(output_dir)
        user_prompt = query
        _log("prompt_user", prompt=user_prompt)
        _log("agent_invoke_start", prompt=user_prompt)
        result = agent.invoke({"messages": [{"role": "user", "content": user_prompt}]})
        _log("agent_invoke_complete", elapsed_seconds=round(time.perf_counter() - started, 2))
        return {"output_dir": str(output_dir), "result": result}
    except Exception as exc:  # noqa: BLE001 - log the exact stage before propagating.
        _log(
            "run_error",
            error=f"{type(exc).__name__}: {exc}",
            traceback=traceback.format_exc(),
        )
        raise
    finally:
        _log("run_end", elapsed_seconds=round(time.perf_counter() - started, 2))
        _close_logging()


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
