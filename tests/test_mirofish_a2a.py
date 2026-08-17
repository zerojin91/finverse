import json
import re
from datetime import date

import pytest

from agents import mirofish_a2a


def _web_evidence(observed_at: str, locator: str = "https://example.com/source") -> str:
    return f"""# Web Search Evidence
## Analysis Context
- as_of: 2026-08-01
## Verified External Facts
- 검증된 사실
## Known Upcoming Events
- 없음
## Similar Historical Cases
- 충분한 사례 없음
## Relation Candidates
- 조건부 관계
## Uncertainties
- 제한
## Evidence Register
| evidence_id | claim | observed_at | source | record_id_or_url |
|---|---|---|---|---|
| WEB-001 | 검증된 사실 | {observed_at} | Example | {locator} |
## Limitations
- 제한
"""


def test_mirofish_contract_matches_agent_plan() -> None:
    assert mirofish_a2a.SPECIALISTS == ("market", "economy", "events", "web_search")
    assert mirofish_a2a.EVIDENCE_FILES == {
        "market": "market-evidence.md",
        "economy": "economic-evidence.md",
        "events": "external-event-evidence.md",
        "web_search": "web-search-evidence.md",
    }
    assert mirofish_a2a.FINAL_FILE == "mirofish-input.md"
    assert mirofish_a2a.DEFAULT_HORIZON == "365d"
    assert mirofish_a2a.DEFAULT_MODEL == "openai:gpt-5.6-terra"
    assert mirofish_a2a.DEFAULT_REASONING_EFFORT == "medium"
    assert "read_specialist_evidence" in mirofish_a2a.ORCHESTRATOR_PROMPT
    assert "최대 1회" in mirofish_a2a.ORCHESTRATOR_PROMPT
    assert "save_mirofish_markdown" in mirofish_a2a.ORCHESTRATOR_PROMPT
    assert "scenario_signature" in mirofish_a2a.ORCHESTRATOR_PROMPT
    assert "look-ahead selection" in mirofish_a2a.ORCHESTRATOR_PROMPT
    assert "Top-K=3" in mirofish_a2a.ORCHESTRATOR_PROMPT
    assert "similarity_score" in mirofish_a2a.HISTORICAL_ATTENTION_PROTOCOL


def test_market_prompt_requires_raw_time_series_for_quantitative_analysis() -> None:
    prompt = mirofish_a2a.SPECIALIST_PROMPTS["market"]
    assert "## Raw Time Series" in prompt
    assert "원시 행을 전부 조회" in prompt
    assert "요약치로 대체하지 않는다" in prompt
    assert "계산식과 분모" in prompt


def test_dates_and_slug() -> None:
    assert mirofish_a2a._date("2026-08-01", "test") == date(2026, 8, 1)
    assert mirofish_a2a._slug("KOSPI / 반도체") == "kospi-반도체"


def test_database_timeout_configuration(monkeypatch) -> None:
    monkeypatch.delenv("FINVERSE_DB_STATEMENT_TIMEOUT_MS", raising=False)
    assert mirofish_a2a._statement_timeout_ms() == 60_000
    monkeypatch.setenv("FINVERSE_DB_STATEMENT_TIMEOUT_MS", "120000")
    assert mirofish_a2a._statement_timeout_ms() == 120_000
    monkeypatch.setenv("FINVERSE_DB_STATEMENT_TIMEOUT_MS", "999999")
    with pytest.raises(ValueError, match="between 1000"):
        mirofish_a2a._statement_timeout_ms()


def test_database_timeout_becomes_retryable_tool_result(monkeypatch) -> None:
    def timeout(_sql, _params):
        raise mirofish_a2a.DatabaseQueryTimeoutError("database query exceeded 60s")

    monkeypatch.setattr(mirofish_a2a, "_read_query", timeout)
    result = json.loads(mirofish_a2a._read_query_payload({"dataset": "index_daily"}, "SELECT 1", ()))
    assert result["rows"] == []
    assert result["retryable"] is True
    assert "shorter" in result["retry_hint"]


def test_database_tools_build_valid_bounded_queries(monkeypatch) -> None:
    calls = []

    def capture(sql, params):
        assert len(re.findall(r"(?<!%)%s", sql)) == len(params)
        calls.append(sql)
        return []

    monkeypatch.setattr(mirofish_a2a, "_read_query", capture)
    for dataset in mirofish_a2a.MARKET_SQL:
        result = json.loads(mirofish_a2a.query_market.invoke({
            "dataset": dataset,
            "start_date": "2025-01-01",
            "end_date": "2026-01-01",
            "tickers": ["005930"],
            "name_filter": "KOSPI",
            "limit": 3,
        }))
        assert result["rows"] == []
    mirofish_a2a.query_economy.invoke({"keyword": "금리", "limit": 3})
    mirofish_a2a.query_events.invoke({"keyword": "반도체", "ticker": "005930", "limit": 3})
    assert len(calls) == 7
    assert all("FROM lake.records AS r" in sql for sql in calls)
    assert all("EXISTS (" not in sql for sql in calls)


def test_web_fetch_rejects_local_targets() -> None:
    with pytest.raises(ValueError, match="local URLs"):
        mirofish_a2a._validate_public_url("http://localhost:8000/private")


def test_web_evidence_rejects_future_dates(tmp_path) -> None:
    save = mirofish_a2a._save_evidence_tool(tmp_path, "web_search", date(2026, 8, 1))
    result = save.invoke({"markdown": _web_evidence("2026-08-02")})
    assert "is after as_of 2026-08-01" in result
    assert not (tmp_path / "web-search-evidence.md").exists()


@pytest.mark.parametrize(
    ("raw_date", "expected"),
    [
        ("2026-08-01T14:20:00+09:00", "2026-08-01"),
        ("20260801", "2026-08-01"),
        ("2026/8/1", "2026-08-01"),
        ("2026.08.01", "2026-08-01"),
    ],
)
def test_evidence_dates_are_normalized(tmp_path, raw_date, expected) -> None:
    save = mirofish_a2a._save_evidence_tool(tmp_path, "web_search", date(2026, 8, 1))
    result = save.invoke({"markdown": _web_evidence(raw_date)})
    assert result.startswith("saved web-search-evidence.md")
    saved = (tmp_path / "web-search-evidence.md").read_text(encoding="utf-8")
    assert f"| {expected} |" in saved


def test_invalid_evidence_date_is_returned_to_agent(tmp_path) -> None:
    save = mirofish_a2a._save_evidence_tool(tmp_path, "web_search", date(2026, 8, 1))
    result = save.invoke({"markdown": _web_evidence("N/A")})
    assert "observed_at must contain an exact YYYY-MM-DD" in result
    assert not (tmp_path / "web-search-evidence.md").exists()


def test_empty_evidence_register_is_saved_as_data_gap(tmp_path) -> None:
    markdown = _web_evidence("2026-08-01").replace(
        "| WEB-001 | 검증된 사실 | 2026-08-01 | Example | https://example.com/source |\n",
        "",
    )
    save = mirofish_a2a._save_evidence_tool(tmp_path, "web_search", date(2026, 8, 1))
    result = save.invoke({"markdown": markdown})
    assert "evidence_rows=0; data_gap=true" in result
    saved = (tmp_path / "web-search-evidence.md").read_text(encoding="utf-8")
    assert "no verified Evidence Register rows" in saved


def test_evidence_parser_tolerates_missing_outer_pipes_and_claim_pipes(tmp_path) -> None:
    markdown = _web_evidence("2026-08-01").replace(
        "| WEB-001 | 검증된 사실 | 2026-08-01 | Example | https://example.com/source |",
        "WEB-001 | 공급 | 수요 변화 | 2026/08/01 | Example | https://example.com/source",
    )
    save = mirofish_a2a._save_evidence_tool(tmp_path, "web_search", date(2026, 8, 1))
    result = save.invoke({"markdown": markdown})
    assert "evidence_rows=1; data_gap=false" in result
    rows = mirofish_a2a._evidence_rows(
        (tmp_path / "web-search-evidence.md").read_text(encoding="utf-8")
    )
    assert rows[0][1] == "공급 | 수요 변화"
    assert rows[0][2] == "2026-08-01"


def test_evidence_allows_only_one_revision(tmp_path) -> None:
    save = mirofish_a2a._save_evidence_tool(tmp_path, "web_search", date(2026, 8, 1))
    save.invoke({"markdown": _web_evidence("2026-08-01")})
    save.invoke({"markdown": _web_evidence("2026-08-01", "https://example.com/revised")})
    result = save.invoke({"markdown": _web_evidence("2026-08-01", "https://example.com/third")})
    assert "single allowed revision" in result


def test_specialists_are_compiled_langchain_agents(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-placeholder")
    subagent = mirofish_a2a._specialist(
        "market", tmp_path, date(2026, 8, 1), "openai:gpt-5.6-terra"
    )
    assert subagent["name"] == "market_agent"
    assert subagent["runnable"].name == "market_graph"


def test_openai_model_uses_responses_api(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-placeholder")
    monkeypatch.setenv("FINVERSE_AGENT_REASONING_EFFORT", "low")
    model = mirofish_a2a._create_chat_model("openai:gpt-5.6-terra")
    assert model.model_name == "gpt-5.6-terra"
    assert model.use_responses_api is True
    assert model.reasoning_effort == "low"


def test_reader_reports_cross_domain_duplicate_locators(tmp_path) -> None:
    row = "| E-001 | 동일 사실 | 2026-08-01 | source | shared-record-id |"
    for filename in ("market-evidence.md", "economic-evidence.md"):
        (tmp_path / filename).write_text(
            "# Evidence\n## Evidence Register\n"
            "| evidence_id | claim | observed_at | source | record_id_or_url |\n"
            "|---|---|---|---|---|\n" + row + "\n",
            encoding="utf-8",
        )
    result = json.loads(mirofish_a2a._read_evidence_tool(tmp_path).invoke({}))
    assert result["cross_domain_duplicates"]["shared-record-id"] == ["market", "economy"]


def test_final_document_rejects_duplicate_evidence_locators(tmp_path) -> None:
    markdown = """# Test Scenario
## 분석 기준
## 현재 시장 상황 온톨로지
## 엔터티 목록
## 영향 관계
## 유사 과거 국면과 Attention 근거
## 가정된 미래 시나리오
### 상승 경로
### 기준 경로
### 하락 경로
## 불확실성
## 부족한 데이터
## Evidence Register
| id | 주장 | 출처 | 기준일 | 담당 에이전트 | record_id 또는 URL |
|---|---|---|---|---|---|
| E-1 | 사실 1 | source | 2026-08-01 | market | same-id |
| E-2 | 사실 2 | source | 2026-08-01 | economy | same-id |
"""
    with pytest.raises(ValueError, match="duplicate record_id_or_url"):
        mirofish_a2a._save_final_tool(tmp_path).invoke({"markdown": markdown})
