"""Grounded chat for a running FINVERSE MiroFish scenario.

The original MiroFish interaction agent expects its own Flask application and
report folders.  FINVERSE keeps every run in an isolated job workspace, so
this adapter supplies the same kind of grounded conversation from that
workspace: Evidence documents, the Neo4j export, and live OASIS actions.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from typing import Any

from agents.mirofish_pipeline import (
    EVIDENCE_FILES,
    _configure_mirofish_env,
    _load_dotenv,
    _resolve_source_root,
)


def _keywords(*values: str) -> set[str]:
    words: set[str] = set()
    for value in values:
        for token in re.findall(r"[0-9A-Za-z가-힣]+", value.lower()):
            if len(token) >= 2:
                words.add(token)
    return words


def _select_evidence(path: Path, terms: set[str], limit: int = 2_400) -> str:
    if not path.exists():
        return ""
    content = path.read_text(encoding="utf-8", errors="replace")
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    scored: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines):
        normalized = line.lower()
        score = sum(1 for term in terms if term in normalized)
        if line.startswith("#"):
            score += 1
        scored.append((score, -index, line))
    selected = [line for score, _, line in sorted(scored, reverse=True) if score > 0][:36]
    if not selected:
        selected = lines[:28]
    return "\n".join(selected)[:limit]


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError, TypeError):
        return {}


def _graph_summary(workspace: Path, terms: set[str]) -> str:
    graph = _load_json(workspace / "mirofish" / "graph.json")
    raw_nodes = [item for item in graph.get("nodes", []) if isinstance(item, dict)]
    raw_edges = [item for item in graph.get("edges", []) if isinstance(item, dict)]
    names: dict[str, str] = {}
    ranked_nodes: list[tuple[int, str]] = []
    for node in raw_nodes:
        node_id = str(node.get("uuid") or node.get("id") or "")
        name = str(node.get("name") or node.get("label") or "").strip()
        if not node_id or not name:
            continue
        names[node_id] = name
        node_type = str((node.get("labels") or [node.get("type") or "Entity"])[0])
        score = sum(1 for term in terms if term in name.lower())
        ranked_nodes.append((score, f"- {name} ({node_type})"))
    node_lines = [line for _, line in sorted(ranked_nodes, key=lambda item: item[0], reverse=True)[:45]]

    ranked_edges: list[tuple[int, str]] = []
    for edge in raw_edges:
        source_id = str(edge.get("source_node_uuid") or edge.get("source") or "")
        target_id = str(edge.get("target_node_uuid") or edge.get("target") or "")
        source = names.get(source_id, source_id)
        target = names.get(target_id, target_id)
        relation = str(edge.get("name") or edge.get("label") or "RELATED_TO")
        fact = str(edge.get("fact") or "").strip()
        line = f"- {source} —[{relation}]→ {target}"
        if fact:
            line += f": {fact[:240]}"
        score = sum(1 for term in terms if term in line.lower())
        ranked_edges.append((score, line))
    edge_lines = [line for _, line in sorted(ranked_edges, key=lambda item: item[0], reverse=True)[:55]]
    return (
        f"노드 {len(raw_nodes)}개 / 관계 {len(raw_edges)}개\n"
        + "[주요 노드]\n"
        + "\n".join(node_lines)
        + "\n[주요 관계]\n"
        + "\n".join(edge_lines)
    )[:10_000]


def _action_text(action: dict[str, Any]) -> str:
    args = action.get("action_args") if isinstance(action.get("action_args"), dict) else {}
    content = next(
        (
            str(args.get(key)).strip()
            for key in ("content", "text", "body", "query", "comment")
            if args.get(key)
        ),
        "",
    )
    agent_name = str(action.get("agent_name") or f"Agent {action.get('agent_id', 0)}")
    return (
        f"- round {action.get('round_num', 0)} · {action.get('platform', 'simulation')} · "
        f"{agent_name} · "
        f"{action.get('action_type', 'ACTION')}"
        + (f": {content[:360]}" if content else "")
    )


def build_context(
    input_dir: Path,
    query: str,
    period: str,
    message: str,
    runtime: dict[str, Any] | None,
) -> tuple[str, list[str]]:
    """Build a bounded, auditable prompt context from one scenario job."""
    input_dir = input_dir.resolve()
    terms = _keywords(query, message)
    sections = [
        "[시나리오 질문]\n" + query,
        "[예측 기간]\n" + period,
    ]
    sources: list[str] = []
    for filename in EVIDENCE_FILES:
        snippet = _select_evidence(input_dir / filename, terms)
        if snippet:
            sections.append(f"[{filename}]\n{snippet}")
            sources.append(filename)

    graph = _graph_summary(input_dir, terms)
    if graph.strip():
        sections.append("[Neo4j 지식그래프]\n" + graph)
        sources.append("Neo4j knowledge graph")

    runtime = runtime or {}
    actions = [item for item in runtime.get("recent_actions", []) if isinstance(item, dict)]
    runtime_summary = {
        key: runtime.get(key)
        for key in (
            "runner_status",
            "current_round",
            "total_rounds",
            "progress_percent",
            "total_actions_count",
            "twitter_actions_count",
            "reddit_actions_count",
            "env_alive",
        )
    }
    sections.append("[현재 실행 상태]\n" + json.dumps(runtime_summary, ensure_ascii=False))
    if actions:
        sections.append("[최근 시뮬레이션 행동]\n" + "\n".join(_action_text(item) for item in actions[:60]))
        sources.append("OASIS live simulation actions")
    return "\n\n".join(sections)[:28_000], sources


def chat(
    input_dir: Path,
    query: str,
    period: str,
    message: str,
    history: list[dict[str, str]] | None = None,
    runtime: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Answer one question with FINVERSE Evidence and simulation state."""
    _load_dotenv()
    _configure_mirofish_env()
    _resolve_source_root()
    from agents.mirofish_openrouter import enable_openrouter_safe_responses

    enable_openrouter_safe_responses()
    from app.utils.llm_client import LLMClient

    context, sources = build_context(input_dir, query, period, message, runtime)
    system_prompt = """당신은 FINVERSE 시나리오 분석가입니다.
사용자가 보고 있는 시장 시뮬레이션의 실제 수집 근거, Neo4j 관계, OASIS 에이전트 행동만 사용해 한국어로 답하세요.

응답 원칙:
1. 실제 시장 Evidence와 가상 시뮬레이션 행동을 반드시 구분합니다.
2. 시뮬레이션 결과를 미래의 확정 사실처럼 표현하지 않습니다.
3. 근거가 부족하면 부족하다고 말하고, 확인할 지표를 제안합니다.
4. 짧은 제목과 불릿을 사용한 읽기 쉬운 마크다운으로 답합니다.
5. 숨겨진 추론 과정은 출력하지 않고 결론과 근거만 제시합니다.
6. 제공된 컨텍스트 밖의 수치나 출처를 만들어내지 않습니다.

다음은 이번 세션의 컨텍스트입니다.
""" + context
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for item in (history or [])[-8:]:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content[:4_000]})
    messages.append({"role": "user", "content": message})
    response = LLMClient(timeout=60.0).chat(
        messages=messages,
        temperature=0.35,
        max_tokens=1_500,
    )
    return {
        "response": response,
        "sources": sources,
        "model": os.environ.get("LLM_MODEL_NAME", ""),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


__all__ = ["build_context", "chat"]
