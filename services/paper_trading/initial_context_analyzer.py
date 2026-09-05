"""Create and cache an LLM-grounded initial market context for a scenario."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
from typing import Any

from .config import Config
from .evidence_documents import build_target_documents
from .kospi_paper_trading import TradingError
from .llm_client import LLMClient


CONTEXT_SCHEMA_VERSION = "initial-context-v9"
CONTEXT_CACHE_TTL_SECONDS = 12 * 60 * 60


class InitialContextUnavailable(TradingError):
    """Raised when the initial context cannot be generated."""


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))


def _cache_path(cache_key: str) -> Path:
    root = Path(Config.UPLOAD_FOLDER) / "market_cache"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"initial-context-{cache_key}.json"


def _read_cache(path: Path) -> dict[str, Any] | None:
    try:
        if (time.time() - path.stat().st_mtime) > CONTEXT_CACHE_TTL_SECONDS:
            return None
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def _write_cache(path: Path, value: dict[str, Any]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".initial-context-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
        Path(temporary).replace(path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _pct(start: float, end: float) -> float:
    return round((end / start - 1) * 100, 2) if start else 0.0


def _compact_input(history: dict[str, Any]) -> dict[str, Any]:
    market_days = history.get("market_days") or []
    recent_days = market_days[-30:]
    first_close = float(recent_days[0].get("close") or 0) if recent_days else 0
    last_close = float(recent_days[-1].get("close") or 0) if recent_days else 0
    closes = [float(row.get("close") or 0) for row in recent_days if row.get("close")]
    returns = [_pct(closes[index - 1], closes[index]) for index in range(1, len(closes)) if closes[index - 1]]
    flow_totals: dict[str, int] = {}
    for day in recent_days:
        for group, value in (day.get("investor_flow") or {}).items():
            flow_totals[group] = flow_totals.get(group, 0) + int(value or 0)

    events = []
    for day in market_days:
        for event in day.get("events") or []:
            events.append({
                "date": str(day.get("trade_date") or ""),
                "title": event.get("title", ""),
                "summary": event.get("summary", ""),
                "scope": event.get("scope", "market"),
                "event_types": event.get("event_types") or [],
                "source_score": event.get("source_score", 0),
            })
    events.sort(key=lambda row: (float(row.get("source_score") or 0), row["date"]), reverse=True)

    macro = history.get("macro_observations") or []
    macro_recent = macro[-40:]
    social = history.get("social_signals") or []
    social_recent = social[-30:]
    sentiment_values = [float(row["sentiment"]) for row in social_recent if row.get("sentiment") is not None]

    return {
        "ticker": history.get("ticker"),
        "name": history.get("name"),
        "period": {"start": history.get("start_date"), "end": history.get("end_date")},
        "market": {
            "observed_days": len(market_days),
            "recent_days": [{key: row.get(key) for key in ("trade_date", "open", "high", "low", "close", "volume")}
                            for row in recent_days],
            "recent_change_pct": _pct(first_close, last_close),
            "recent_return_samples_pct": returns,
            "investor_flow_totals_krw": flow_totals,
            "quality": history.get("quality", {}),
        },
        "economy": {
            "observation_count": len(macro),
            "recent_observations": [{key: row.get(key) for key in ("trade_date", "series_name", "value", "unit", "source")}
                                    for row in macro_recent],
        },
        "events": {
            "event_count": len(events),
            "recent_events": events[:30],
        },
        "community": {
            "observed_days": len(social),
            "recent_days": social_recent,
            "average_sentiment": round(sum(sentiment_values) / len(sentiment_values), 4) if sentiment_values else None,
            "total_comments": sum(int(row.get("post_count") or 0) for row in social_recent),
            "total_engagement": sum(int(row.get("engagement") or 0) for row in social_recent),
        },
        "provenance": {
            "history_start": history.get("start_date"),
            "history_end": history.get("end_date"),
            "latest_market_date": market_days[-1].get("trade_date") if market_days else None,
            "quality": history.get("quality", {}),
        },
    }


def _messages(source: dict[str, Any], evidence_documents: dict[str, str]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": """당신은 한국 주식 모의투자의 초기 시장 맥락 분석가다.
제공된 시장·경제·사건·커뮤니티 관측값만 근거로 선택 종목의 현재 상황을 분석한다.
실제 관측값과 LLM의 해석을 구분하고, 미래 사건이나 가격을 사실처럼 예측하지 않는다.
앞으로의 내용은 반드시 불확실성·가능성·시뮬레이션 전제로 표현한다.
반드시 한국어 JSON 객체 하나만 반환한다.""",
        },
        {
            "role": "user",
            "content": f"""다음은 {source.get('name')}({source.get('ticker')})의 초기 시나리오 근거 문서 4종이다.
각 문서는 실제 PostgreSQL 관측값에서 생성됐다. 반드시 아래 문서의 내용만 근거로
초기 시나리오 시작 전에 사용자가 읽을 종합 맥락을 작성하라. 문서에 없는 수치·사건·인과관계는 만들지 않는다.

{_json({"market_evidence": evidence_documents.get("market", ""), "economic_evidence": evidence_documents.get("economy", ""), "event_evidence": evidence_documents.get("events", ""), "community_evidence": evidence_documents.get("community", "")})}

반환 형식:
{{
  "summary": "초기 상황을 설명하는 짧은 문단",
  "summary_points": ["수치·사건·의미를 함께 담은 읽기 쉬운 음슴체 1문장 요약"],
  "market": {{"trend": "상승|하락|횡보|혼조", "assessment": "시장·가격·수급 해석", "signals": ["근거"]}},
  "economy": {{"condition": "우호적|중립|부담|혼조", "assessment": "거시 환경 해석", "signals": ["근거"]}},
  "events": {{"assessment": "최근 사건 흐름 해석", "themes": ["주요 이슈"], "signals": ["근거"]}},
  "community": {{"sentiment": "긍정|중립|부정|혼조|데이터 부족", "assessment": "커뮤니티 흐름 해석", "signals": ["근거"]}},
  "positive_factors": ["긍정 요인"],
  "risk_factors": ["위험 요인"],
  "tensions": ["시장이 충돌하는 지점"],
  "uncertainties": ["미래 시뮬레이션에서 열어둘 불확실성"],
  "watch_points": ["사용자가 시뮬레이션에서 관찰할 포인트"],
  "event_sequence": [
    {{
      "date": "문서에서 확인되는 YYYY-MM-DD",
      "title": "최근 한 달 내 실제 주요 이벤트 제목",
      "description": "이벤트 흐름과 종목 맥락을 설명하는 1~2문장",
      "domain": "시장|경제|사건|커뮤니티",
      "market_reaction": "문서에서 확인되는 가격·거래량·수급·심리 반응, 없으면 직접 확인 불가",
      "basis": "observed|inferred"
    }}
  ]
}}

이벤트 시퀀스는 최근 한 달 내 문서로 확인되는 실제 흐름 3~6개만 날짜순으로 반환한다.
`summary_points`는 정확히 5개를 반환한다. 각 줄은 55~105자의 한국어 음슴체 1문장으로 쓰고, 시장·경제·사건·커뮤니티·향후 관찰 지점을 각각 하나씩 다룬다. 각 줄에는 문서에서 확인되는 수치·사건·영향 중 최소 두 가지를 자연스럽게 넣는다. 앞에 `-` 기호는 붙이지 않는다.
`observed`는 문서에 직접 기록된 사건·수치이고, `inferred`는 여러 문서 근거를 묶은 해석이다.
미래 사건이나 미래 가격은 이벤트 시퀀스에 절대 넣지 않는다.""",
        },
    ]


def _normalize(value: dict[str, Any]) -> dict[str, Any]:
    def text(key: str, fallback: str = "") -> str:
        return str(value.get(key) or fallback).strip()

    def section(key: str) -> dict[str, Any]:
        raw = value.get(key)
        return raw if isinstance(raw, dict) else {}

    def items(container: dict[str, Any], key: str) -> list[str]:
        raw = container.get(key)
        return [str(item).strip() for item in raw if str(item).strip()] if isinstance(raw, list) else []

    normalized: dict[str, Any] = {
        "summary": text("summary", "수집된 맥락을 바탕으로 초기 시장 상황을 분석하고 있습니다."),
    }
    for key in ("market", "economy", "events", "community"):
        raw = section(key)
        normalized[key] = {field: text(field) for field in ("trend", "condition", "assessment", "sentiment") if field in raw}
        for field in ("signals", "themes"):
            if field in raw:
                normalized[key][field] = items(raw, field)
        if key == "market" and not normalized[key].get("trend"):
            normalized[key]["trend"] = "혼조"
        if key == "economy" and not normalized[key].get("condition"):
            normalized[key]["condition"] = "혼조"
        if key == "community" and not normalized[key].get("sentiment"):
            normalized[key]["sentiment"] = "데이터 부족"
        if not normalized[key].get("assessment"):
            signals = normalized[key].get("signals") or []
            normalized[key]["assessment"] = signals[0] if signals else "관측된 자료가 충분하지 않습니다."
    for key in ("positive_factors", "risk_factors", "tensions", "uncertainties", "watch_points"):
        normalized[key] = items(value, key)
    summary_points = items(value, "summary_points")[:5]
    if not summary_points:
        summary_points = [
            normalized["summary"],
            normalized["market"].get("assessment", ""),
            normalized["economy"].get("assessment", ""),
            normalized["events"].get("assessment", ""),
            normalized["community"].get("assessment", ""),
        ]
    normalized["summary_points"] = [point.removeprefix("-").strip() for point in summary_points if point.strip()][:5]
    sequence = value.get("event_sequence")
    normalized["event_sequence"] = []
    if isinstance(sequence, list):
        for item in sequence[:6]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            basis = str(item.get("basis") or "inferred").strip().lower()
            normalized["event_sequence"].append({
                "date": str(item.get("date") or "").strip(),
                "title": title,
                "description": str(item.get("description") or "").strip(),
                "domain": str(item.get("domain") or "사건").strip(),
                "market_reaction": str(item.get("market_reaction") or "직접 확인 불가").strip(),
                "basis": "observed" if basis == "observed" else "inferred",
            })
    return normalized


def _event_title_key(value: Any) -> str:
    """Compare source headlines despite spaces and punctuation differences."""
    return re.sub(r"[^0-9a-z가-힣]", "", str(value or "").lower())


def _mark_direct_event_evidence(analysis: dict[str, Any], events: list[dict[str, Any]]) -> None:
    """Source news beats an LLM's conservative inferred label for the event itself."""
    direct_events = [
        (str(event.get("date") or ""), _event_title_key(event.get("title")))
        for event in events
        if event.get("title")
    ]
    for item in analysis.get("event_sequence") or []:
        item_date = str(item.get("date") or "")
        item_title = _event_title_key(item.get("title"))
        if not item_date or len(item_title) < 6:
            continue
        if any(
            source_date == item_date
            and (source_title == item_title or source_title in item_title or item_title in source_title)
            for source_date, source_title in direct_events
        ):
            item["basis"] = "observed"


def _document_preview(content: str) -> str:
    """Return a short readable excerpt without exposing Markdown table noise."""
    key_section = content.split("## Key Findings", 1)[-1].split("\n## ", 1)[0]
    lines = [line.strip().removeprefix("- ") for line in key_section.splitlines() if line.strip() and not line.startswith("#")]
    return " ".join(lines)[:280].rstrip() + ("…" if len(" ".join(lines)) > 280 else "")


def prepare_initial_context_documents(history: dict[str, Any]) -> dict[str, Any]:
    """Build the four auditable documents before any LLM call."""
    source = _compact_input(history)
    fingerprint = hashlib.sha256(_json({"schema": CONTEXT_SCHEMA_VERSION, "source": source}).encode()).hexdigest()[:24]
    path = _cache_path(fingerprint)
    document_dir = path.parent / f"initial-context-{fingerprint}"
    document_files = build_target_documents(history, document_dir)
    return {
        "context_id": f"ctx_{fingerprint}",
        "schema_version": CONTEXT_SCHEMA_VERSION,
        "source": source,
        "document_dir": document_dir,
        "document_files": document_files,
        "source_summary": {
            "ticker": source["ticker"],
            "name": source["name"],
            "period": source["period"],
            "market_days": source["market"]["observed_days"],
            "macro_observations": source["economy"]["observation_count"],
            "events": source["events"]["event_count"],
            "community_days": source["community"]["observed_days"],
            "as_of": source["provenance"],
            "documents": list(document_files.values()),
            "document_previews": {
                key: _document_preview((document_dir / filename).read_text(encoding="utf-8"))
                for key, filename in document_files.items()
            },
        },
    }


def get_initial_context_documents(history: dict[str, Any]) -> dict[str, Any]:
    """Return document metadata without starting the aggregate LLM analysis."""
    prepared = prepare_initial_context_documents(history)
    return {
        "context_id": prepared["context_id"],
        "schema_version": prepared["schema_version"],
        "source_summary": prepared["source_summary"],
    }


def get_initial_context(history: dict[str, Any]) -> dict[str, Any]:
    """Return the aggregate analysis after the four Evidence documents exist."""
    prepared = prepare_initial_context_documents(history)
    context_id = prepared["context_id"]
    fingerprint = context_id.removeprefix("ctx_")
    path = _cache_path(fingerprint)
    source = prepared["source"]
    document_dir = prepared["document_dir"]
    document_files = prepared["document_files"]
    evidence_documents = {
        key: (document_dir / filename).read_text(encoding="utf-8")[:16_000]
        for key, filename in document_files.items()
    }
    cached = _read_cache(path)
    if cached:
        return {**cached, "context_id": context_id, "cached": True}

    try:
        analysis = _normalize(LLMClient().chat_json(_messages(source, evidence_documents), temperature=.25, max_tokens=3800))
        _mark_direct_event_evidence(analysis, source["events"]["recent_events"])
    except Exception as exc:  # noqa: BLE001 - API 계층에서 사용자용 503으로 변환한다.
        raise InitialContextUnavailable("초기 시장 맥락 분석을 생성하지 못했습니다.") from exc

    result = {
        "context_id": context_id,
        "schema_version": CONTEXT_SCHEMA_VERSION,
        "analysis": analysis,
        "source_summary": prepared["source_summary"],
    }
    _write_cache(path, result)
    return {**result, "cached": False}
