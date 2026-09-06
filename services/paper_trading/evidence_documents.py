"""Build grounded, target-specific Evidence Markdown for paper trading.

Each domain document keeps its raw PostgreSQL observations, then adds a small
LLM interpretation.  The interpretation is deliberately bounded to the
evidence IDs supplied in the prompt: it is a scenario starting point, not a
price forecast or an invented news summary.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from typing import Any

from .community_selection import select_representative_comments
from .llm_client import LLMClient


DOCUMENT_FILES = {
    "market": "market-evidence.md",
    "economy": "economic-evidence.md",
    "events": "external-event-evidence.md",
    "community": "community-evidence.md",
}

DOMAIN_TITLES = {
    "market": "Market Evidence",
    "economy": "Economic Evidence",
    "events": "External Event Evidence",
    "community": "Community Evidence",
}

DOMAIN_GUIDANCE = {
    "market": (
        "가격 경로·변동성·거래량·투자자 수급을 분리해서 읽어라. 수급은 순매수/순매도라는 "
        "관측일 뿐 가격 원인으로 단정하지 말고, 다음 거래일에 에이전트가 주목할 조건을 제시하라."
    ),
    "economy": (
        "환율·금리·채권 등 거시 지표가 이 종목과 섹터에 전달될 수 있는 경로를 가능성으로만 설명하라. "
        "지표가 종목 가격을 움직였다고 단정하지 말고, 확인해야 할 연결 고리를 밝혀라."
    ),
    "events": (
        "개별 종목 직접 사건과 시장 전체 사건을 구분하라. 사건의 사실, 종목 관련성, 잠재 전달 경로를 "
        "분리하고 관련성이 약한 시장 전체 사건은 과장하지 말라."
    ),
    "community": (
        "일별 집계 심리·게시량·참여도와 종목 태그가 일치한 YouTube 영상의 고반응 댓글을 함께 읽어라. "
        "댓글은 일부 고반응 참여자의 질적 논점일 뿐 전체 투자자 의견이나 실제 매매 의도가 아니다. "
        "댓글에서 반복되는 논점은 사실과 분리해 '언급된 관점'으로만 정리하고, 심리가 가격과 충돌할 때 확인할 신호를 제시하라."
    ),
}


def _line(value: Any) -> str:
    return str(value if value is not None else "").replace("|", "\\|").replace("\n", " ").strip()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


def _evidence_row(index: int, claim: str, observed_at: Any, source: str, reference: Any = None) -> str:
    return f"| {source.upper()}-{index:03d} | {_line(claim)} | {_line(observed_at)} | {_line(source)} | {_line(reference or 'paper-trading-history')} |"


def _change_pct(start: Any, end: Any) -> str:
    try:
        first, last = float(start), float(end)
        return f"{(last / first - 1) * 100:+.2f}%" if first else "계산 불가"
    except (TypeError, ValueError, ZeroDivisionError):
        return "계산 불가"


def _header(title: str, history: dict[str, Any]) -> list[str]:
    return [
        f"# {title}",
        "## Analysis Context",
        f"- 대상: {_line(history.get('name'))} ({_line(history.get('ticker'))})",
        f"- 섹터: {_line(history.get('sector') or '확인되지 않음')}",
        f"- 관측 기간: {_line(history.get('start_date'))} ~ {_line(history.get('end_date'))}",
        "- 원자료: finverse PostgreSQL 수집 이력. AI 해석과 관측 사실을 구분해 기록한다.",
    ]


def _compact_market(history: dict[str, Any]) -> dict[str, Any]:
    days = (history.get("market_days") or [])[-30:]
    return {
        "recent_change_pct": _change_pct(days[0].get("close"), days[-1].get("close")) if days else "관측값 부족",
        "high": max((day.get("high") or 0) for day in days) if days else None,
        "low": min((day.get("low") or 0) for day in days) if days else None,
        "last_close": days[-1].get("close") if days else None,
        "days": [{key: day.get(key) for key in ("trade_date", "open", "high", "low", "close", "volume", "investor_flow", "investor_flow_scope")} for day in days],
    }


def _domain_input(domain: str, history: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    market = _compact_market(history)
    common = {
        "target": {"name": history.get("name"), "ticker": history.get("ticker"), "sector": history.get("sector")},
        "observation_period": {"start": history.get("start_date"), "end": history.get("end_date")},
        "target_market_snapshot": {key: market[key] for key in ("recent_change_pct", "high", "low", "last_close")},
    }
    if domain == "market":
        rows = market["days"]
        return {**common, "observations": rows, "data_quality": history.get("quality") or {}}, rows
    if domain == "economy":
        rows = (history.get("macro_observations") or [])[-40:]
        return {**common, "observations": rows}, rows
    if domain == "events":
        rows = [
            {**event, "trade_date": day.get("trade_date")}
            for day in history.get("market_days") or []
            for event in day.get("events") or []
        ]
        rows = sorted(rows, key=lambda item: str(item.get("trade_date") or ""), reverse=True)[:40]
        return {**common, "observations": rows}, rows
    aggregate_rows = [
        {**row, "evidence_kind": "daily_aggregate"}
        for row in (history.get("social_signals") or [])[-30:]
    ]
    comment_rows = [
        {**row, "evidence_kind": "target_top_comment"}
        for row in select_representative_comments(history.get("community_comments") or [])
    ]
    rows = aggregate_rows + comment_rows
    return {
        **common,
        "observations": rows,
        "community_scope": (
            "daily aggregate signals plus top-liked comments collected from "
            "YouTube videos matched to the selected ticker"
        ),
    }, rows


def _source_id(domain: str, index: int) -> str:
    return f"{domain.upper()}-{index:03d}"


def _messages(domain: str, payload: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": """당신은 한국 개별 종목 모의투자의 근거 문서 분석가다.
당신의 결과는 World Agent, 시장 참여 에이전트, 학습자 판단의 초기 조건으로 사용된다.
입력에 있는 관측값과 evidence_id만 근거로 한국어 JSON 객체 하나를 반환한다.
미래 가격·미래 사건·보이지 않는 원인·투자 권유를 만들지 않는다. 인과는 '가능성', '점검 필요'처럼 표현한다.
관측 사실과 해석을 섞지 말고, 모든 관측 주장에는 입력의 evidence_id를 연결한다.
입력 근거로 작성할 수 없는 항목은 빈 배열로 두며, 분석 실패·재시도·추가 근거 요구를 알리는 문구는 절대 출력하지 않는다.""",
        },
        {
            "role": "user",
            "content": f"""도메인: {domain}
도메인 지침: {DOMAIN_GUIDANCE[domain]}

아래는 실제 PostgreSQL 관측값이다. observations의 배열 순서가 evidence_id 순서이며 첫 행은 {domain.upper()}-001이다.
{_json(payload)}

반환 형식:
{{
  "headline": "현재 상태를 한 문장으로 요약",
  "key_findings": [
    {{"fact": "관측된 수치·사건을 포함한 사실", "interpretation": "종목 시나리오에서의 제한된 해석", "evidence_ids": ["{domain.upper()}-001"]}}
  ],
  "transmission_paths": ["이 도메인이 종목·수급·심리에 연결될 수 있는 경로"],
  "agent_focus": ["시뮬레이션에서 시장 참여자가 주목할 조건"],
  "uncertainties": ["현재 자료로 직접 확인할 수 없는 점"],
  "data_gaps": ["자료 품질 또는 범위의 제한"]
}}

key_findings는 근거가 있는 항목만 최대 3개, 나머지 배열도 근거가 있는 항목만 최대 3개로 작성하라. evidence_ids에는 실제 존재하는 ID만 넣어라.
관측 근거가 충분하지 않은 항목은 억지로 채우지 말고 해당 배열을 빈 배열로 반환하라.
`근거가 필요합니다`, `AI 해석을 준비하지 못했습니다`, `다시 생성하면`, `관측값 부족`처럼 분석 실패나 추가 작업을 알리는 문구는 어느 필드에도 쓰지 마라.
빈 수치를 채우거나, 입력 밖 사실·원인·전망을 만들지 마라.""",
        },
    ]


def _list(value: Any, limit: int = 3) -> list[str]:
    return [str(item).strip() for item in value if str(item).strip()][:limit] if isinstance(value, list) else []


def _analysis(domain: str, payload: dict[str, Any], row_count: int) -> dict[str, Any]:
    if not row_count:
        return {
            "headline": "",
            "key_findings": [],
            "transmission_paths": [],
            "agent_focus": [],
            "uncertainties": [],
            "data_gaps": [],
            "mode": "raw_fallback",
        }
    try:
        raw = LLMClient().chat_json(_messages(domain, payload), temperature=.15, max_tokens=1_250)
        findings = []
        valid_ids = {_source_id(domain, index) for index in range(1, row_count + 1)}
        for item in raw.get("key_findings") if isinstance(raw.get("key_findings"), list) else []:
            if not isinstance(item, dict):
                continue
            fact, interpretation = _line(item.get("fact")), _line(item.get("interpretation"))
            if not fact:
                continue
            ids = [str(value) for value in item.get("evidence_ids", []) if str(value) in valid_ids]
            if not ids:
                continue
            findings.append({"fact": fact, "interpretation": interpretation, "evidence_ids": ids})
        return {
            "headline": _line(raw.get("headline")) or "관측 자료를 바탕으로 초기 상황을 정리했습니다.",
            "key_findings": findings[:3],
            "transmission_paths": _list(raw.get("transmission_paths")),
            "agent_focus": _list(raw.get("agent_focus")),
            "uncertainties": _list(raw.get("uncertainties")),
            "data_gaps": _list(raw.get("data_gaps")),
            "mode": "llm_grounded",
        }
    except Exception:
        # 초기 설정 화면이 OpenRouter 일시 장애로 막히지 않게 관측 원문은 계속 제공한다.
        return {
            "headline": "",
            "key_findings": [],
            "transmission_paths": [],
            "agent_focus": [],
            "uncertainties": [],
            "data_gaps": [],
            "mode": "raw_fallback",
        }


def _analysis_lines(analysis: dict[str, Any]) -> list[str]:
    # LLM이 실패하거나 실제 관측값이 없을 때에는 실패 안내 문구를 문서에
    # 남기지 않는다. 이 문서는 원시 관측 근거만으로도 감사 가능해야 한다.
    if analysis.get("mode") != "llm_grounded":
        return []

    lines = ["## AI Interpretation"]
    if analysis.get("headline"):
        lines.append(f"- 상태: {analysis['headline']}")
    findings = analysis.get("key_findings") or []
    if findings:
        lines.append("## Key Findings")
    for item in findings:
        ids = ", ".join(item["evidence_ids"]) or "근거 ID 미연결"
        suffix = f" — {item['interpretation']}" if item["interpretation"] else ""
        lines.append(f"- {item['fact']}{suffix} (근거: {ids})")
    for heading, key in (("Transmission Paths", "transmission_paths"), ("Agent Focus", "agent_focus"), ("Uncertainty", "uncertainties"), ("Data Gaps", "data_gaps")):
        items = analysis.get(key) or []
        if items:
            lines.append(f"## {heading}")
            lines.extend(f"- {item}" for item in items)
    return lines


def _render(domain: str, history: dict[str, Any], rows: list[dict[str, Any]], analysis: dict[str, Any]) -> str:
    lines = _header(DOMAIN_TITLES[domain], history) + _analysis_lines(analysis)
    if domain == "market":
        lines += ["## Raw Time Series", "| trade_date | open | high | low | close | volume | investor_flow |", "|---|---:|---:|---:|---:|---:|---|"]
        lines += ["| " + " | ".join(_line(row.get(key)) for key in ("trade_date", "open", "high", "low", "close", "volume")) + f" | {_line(row.get('investor_flow'))} |" for row in rows]
        claims = [f"{row.get('trade_date')} 종가 {_line(row.get('close'))}" for row in rows]
    elif domain == "economy":
        lines += ["## Raw Macro Observations", "| trade_date | series_name | value | unit | source |", "|---|---|---:|---|---|"]
        lines += ["| " + " | ".join(_line(row.get(key)) for key in ("trade_date", "series_name", "value", "unit", "source")) + " |" for row in rows]
        claims = [f"{row.get('series_name')} = {_line(row.get('value'))} {_line(row.get('unit'))}" for row in rows]
    elif domain == "events":
        lines += ["## Raw Event Observations", "| date | scope | title | summary |", "|---|---|---|---|"]
        lines += ["| " + " | ".join(_line(row.get(key)) for key in ("trade_date", "scope", "title", "summary")) + " |" for row in rows]
        claims = [_line(row.get("title") or "실제 적재 이벤트") for row in rows]
    else:
        aggregate_rows = [row for row in rows if row.get("evidence_kind") == "daily_aggregate"]
        comment_rows = [row for row in rows if row.get("evidence_kind") == "target_top_comment"]
        lines += ["## Raw Community Signals", "| trade_date | sentiment | post_count | engagement |", "|---|---:|---:|---:|"]
        lines += ["| " + " | ".join(_line(row.get(key)) for key in ("trade_date", "sentiment", "post_count", "engagement")) + " |" for row in aggregate_rows]
        if not aggregate_rows:
            lines += ["| 관측값 없음 | - | - | - |"]
        lines += ["## Target Video Comments", "- 선택 종목 태그로 수집한 영상별 좋아요 상위 댓글이다. 고반응 댓글은 전체 투자자 의견을 대표하지 않는다.", "| published_at | video_title | likes | replies | comment |", "|---|---|---:|---:|---|"]
        lines += ["| " + " | ".join(_line(row.get(key)) for key in ("published_at", "video_title", "like_count", "reply_count", "text")) + " |" for row in comment_rows]
        if not comment_rows:
            lines += ["| 관측값 없음 | - | - | - | - |"]
        claims = []
        for row in rows:
            if row.get("evidence_kind") == "target_top_comment":
                title = _line(row.get("video_title") or "종목 검색 영상")
                claims.append(f"{title}의 고반응 댓글(좋아요 {_line(row.get('like_count'))}): {_line(row.get('text'))}")
            else:
                claims.append(f"일별 커뮤니티 감성 {_line(row.get('sentiment'))}, 게시물 {_line(row.get('post_count'))}개")
    references = [row.get("source_url") or row.get("url") for row in rows]
    lines += ["## Evidence Register", "| evidence_id | claim | observed_at | source | record_id_or_url |", "|---|---|---|---|---|"]
    lines += [
        _evidence_row(
            index,
            claim,
            evidence_row.get("published_at") or evidence_row.get("trade_date"),
            domain,
            references[index - 1],
        )
        for index, (evidence_row, claim) in enumerate(zip(rows, claims), 1)
    ]
    lines += ["## Limitations", "- 이 문서의 AI 해석은 관측 원자료를 정리한 시나리오 입력이며, 미래 가격이나 사건의 예측이 아니다."]
    return "\n".join(lines) + "\n"


def build_target_documents(history: dict[str, Any], output_dir: Path) -> dict[str, str]:
    """Write four raw-evidence + domain-analysis Markdown documents.

    Four independent prompts are run in parallel so a slow domain does not
    serially block the setup flow.  Each rendered MD retains the full compact
    source table and evidence register for auditability.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    prepared = {domain: _domain_input(domain, history) for domain in DOCUMENT_FILES}
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            domain: executor.submit(_analysis, domain, payload, len(rows))
            for domain, (payload, rows) in prepared.items()
        }
        analyses = {domain: future.result() for domain, future in futures.items()}
    for domain, filename in DOCUMENT_FILES.items():
        _, rows = prepared[domain]
        (output_dir / filename).write_text(_render(domain, history, rows, analyses[domain]), encoding="utf-8")
    return dict(DOCUMENT_FILES)
