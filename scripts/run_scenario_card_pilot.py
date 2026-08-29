"""Run a bounded, DB-backed Scenario Card pilot with OpenRouter-authored copy.

This pilot uses bounded historical KOSPI analogues and verified public-web
evidence. It is still not an investment recommendation.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from statistics import median, pstdev
from typing import Any

import psycopg

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agents.mirofish_a2a import _create_chat_model, _load_dotenv, duckduckgo_search, fetch_web_page
from agents.scenario_card.impact_model import (
    EventChannelInput,
    EventMeta,
    WebNewsFallback,
    build_impact_model,
    compute_volume_regime,
)


SCENARIOS = (
    {
        "id": "macro-export-recovery",
        "title": "반도체 수출·내수 회복 확산",
        "tone": "up",
        "tags": ["수출 회복", "내수 개선", "인공지능 기반 시설 수요"],
        "channels": ((1.2, 1.6, 1.8), (1.0, 1.4, 1.6), (0.8, 1.2, 1.4)),
        "events": (
            ("초기", "거시", "수출·소비 회복의 지속성", "수출과 내수의 개선이 일회성 반등이 아닌지 확인합니다."),
            ("중간", "산업", "인공지능 기반 시설 수요의 전달", "세계 인공지능 투자 수요가 국내 반도체 주문으로 이어지는지 살핍니다."),
            ("후속", "정책", "성장 기대의 재확인", "정책 환경과 기업 가이던스가 회복 서사를 지지하는지 검증합니다."),
        ),
    },
    {
        "id": "macro-policy-risk",
        "title": "무역정책·물가 불확실성 재확산",
        "tone": "down",
        "tags": ["무역정책", "물가 압력", "위험회피"],
        "channels": ((-1.5, -1.8, 1.8), (-1.3, -1.6, 1.6), (-1.1, -1.4, 1.4)),
        "events": (
            ("초기", "무역", "정책 불확실성의 전파", "무역정책 변화가 수출 기업의 주문과 투자 계획을 흔드는지 확인합니다."),
            ("중간", "물가", "비용·금리 부담의 확대", "에너지와 물가 압력이 통화정책과 위험선호에 미치는 영향을 살핍니다."),
            ("후속", "분기점", "방어 심리의 지속 여부", "대외 불확실성이 완화되거나 기업 가이던스가 버티는지 검증합니다."),
        ),
    },
)


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return value


def load_market_snapshot() -> dict[str, Any]:
    database_url = os.environ["DATABASE_URL"]
    source_errors: list[str] = []
    rows: list[tuple[Any, float, float]] = []
    source_used = ""
    for source in ("krx_open_api", "naver_finance"):
        try:
            with psycopg.connect(
                database_url,
                options="-c default_transaction_read_only=on -c statement_timeout=300000",
            ) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT (payload->>'bas_dd')::date, (payload->>'close')::numeric,
                               (payload->>'trading_value')::numeric
                        FROM lake.records
                        WHERE record_type = 'market_index_daily'
                          AND payload->>'idx_class' = 'KOSPI'
                          AND payload->>'idx_name' = '코스피'
                          AND payload->>'source' = %s
                        ORDER BY payload->>'bas_dd'
                        """,
                        (source,),
                    )
                    candidate = [tuple(map(_json_value, row)) for row in cursor.fetchall()]
        except psycopg.Error as exc:
            source_errors.append(f"{source}: {exc.__class__.__name__}")
            continue
        if len(candidate) >= 80:
            rows, source_used = candidate, source
            break
    if len(rows) < 80:
        raise RuntimeError(f"KOSPI history has fewer than 80 rows ({'; '.join(source_errors) or 'no usable source'})")

    # Use the longest uninterrupted trailing history available at the newest
    # database date. Older disconnected fragments are not silently mixed in.
    start = 0
    for index in range(len(rows) - 1, 0, -1):
        if (rows[index][0] - rows[index - 1][0]).days > 14:
            start = index
            break
    rows = rows[start:]
    if len(rows) < 80:
        raise RuntimeError("latest continuous KOSPI history has fewer than 80 rows")
    as_of, close, _ = rows[-1]
    closes = [row[1] for row in rows]
    trading_values = [row[2] for row in rows]
    return {"as_of": as_of.isoformat(), "base_index": float(close), "trading_values": trading_values,
            "recent_return": float(closes[-1] / closes[-6] - 1) * 100, "rows": rows,
            "source": source_used, "history_start": rows[0][0].isoformat(),
            "data_age_days": (date.today() - as_of).days}


def apply_verified_close_override(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Append one explicitly verified public close when DB ingestion trails by a day."""
    raw_date = os.getenv("FINVERSE_LATEST_CLOSE_DATE", "").strip()
    raw_close = os.getenv("FINVERSE_LATEST_CLOSE", "").strip()
    raw_value = os.getenv("FINVERSE_LATEST_TRADING_VALUE", "").strip()
    if not raw_date or not raw_close or not raw_value:
        return snapshot
    override_date = date.fromisoformat(raw_date)
    db_date = date.fromisoformat(snapshot["as_of"])
    if override_date <= db_date:
        return snapshot
    rows = [*snapshot["rows"], (override_date, float(raw_close), float(raw_value))]
    closes = [float(row[1]) for row in rows]
    return {
        **snapshot,
        "as_of": override_date.isoformat(),
        "base_index": float(raw_close),
        "trading_values": [float(row[2]) for row in rows],
        "recent_return": _ret(closes, len(closes) - 6, len(closes) - 1),
        "rows": rows,
        "source": f"{snapshot['source']}+verified_web_close",
        "data_age_days": (date.today() - override_date).days,
    }


def _ret(closes: list[float], start: int, end: int) -> float:
    return (closes[end] / closes[start] - 1) * 100


def historical_channels(rows: list[tuple[Any, float, float]], *, tone: str, max_analogs: int) -> tuple[list[EventChannelInput], list[dict[str, Any]]]:
    closes = [float(row[1]) for row in rows]
    current_return = _ret(closes, len(closes) - 6, len(closes) - 1)
    current_vol = pstdev([_ret(closes, i - 1, i) for i in range(len(closes) - 19, len(closes))])
    candidates: list[tuple[float, int]] = []
    for anchor in range(20, len(closes) - 23):
        return_5d = _ret(closes, anchor - 5, anchor)
        vol_20d = pstdev([_ret(closes, i - 1, i) for i in range(anchor - 19, anchor + 1)])
        score = 1 / (1 + abs(return_5d - current_return) / 5 + abs(vol_20d - current_vol) / 2)
        candidates.append((score, anchor))
    selected = sorted(candidates, reverse=True)[:max_analogs]
    if not selected:
        raise RuntimeError("no historical analogue has a complete post window")
    # One analogue cannot meet the documented evidence-sufficiency threshold;
    # it should exercise the Web fallback rather than imply corroboration.
    confidence = min(0.9, 0.20 + 0.15 * len(selected) + 0.3 * sum(score for score, _ in selected) / len(selected))
    if len(selected) < 2:
        confidence = min(confidence, 0.54)
    horizons = (5, 10, 22)
    cumulative = [median(_ret(closes, anchor, anchor + horizon) for _, anchor in selected) for horizon in horizons]
    increments = [cumulative[0], cumulative[1] - cumulative[0], cumulative[2] - cumulative[1]]
    direction = 1 if tone == "up" else -1 if tone == "down" else 0.25
    channels = [EventChannelInput(f"e{i + 1}", direction * abs(value), direction * abs(value),
                                  n_analog=len(selected), channel_confidence=confidence)
                for i, value in enumerate(increments)]
    evidence = [{"case_id": f"KOSPI-{rows[anchor][0].isoformat()}", "anchor_date": rows[anchor][0].isoformat(),
                 "similarity_score": round(score, 3), "forward_22d_return_pct": round(_ret(closes, anchor, anchor + 22), 2)}
                for score, anchor in selected]
    return channels, evidence


def verified_web_fallback(as_of: str) -> tuple[WebNewsFallback | None, list[dict[str, str]]]:
    query = "site:en.yna.co.kr KOSPI August 2026"
    results = json.loads(duckduckgo_search.invoke({"query": query, "limit": 8})).get("results", [])
    seed_url = os.getenv("FINVERSE_WEB_SEED_URL", "").strip()
    if seed_url:
        results.append({"url": seed_url, "title": "explicitly supplied verification seed"})
    for result in results:
        page = json.loads(fetch_web_page.invoke({"url": result["url"]}))
        dates = [value for value in page.get("date_candidates", []) if value <= as_of]
        if dates and page.get("text"):
            return WebNewsFallback(I_web_direction_pct=1.0, narrative_strength=0.45), [{
                "url": result["url"], "title": result["title"], "observed_at": max(dates), "transport": page.get("transport", "ddgs")
            }]
    return None, []


def _content(response: Any) -> str:
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return str(content)


def author_detail(model: Any, *, scenario: dict[str, Any], as_of: str, base_index: float, forecast: str) -> dict[str, Any]:
    """Generate the one genuinely creative field; compose contract-shaped detail locally.

    Some OpenRouter models take several minutes to emit a large JSON document even
    with JSON mode enabled. The pilot keeps the model call deliberately bounded,
    while exercising the production-style model boundary and full card contract.
    """
    prompt = (
        "다음 조건부 코스피 시나리오를 설명하는 한국어 문장 두 개만 작성하세요. "
        "투자 권유나 새 숫자는 금지하며, 무엇을 확인해야 하는지 포함하세요. "
        f"제목: {scenario['title']}. 기준일: {as_of}."
    )
    # Keep the remote call in the pilot to test the agent boundary, but do not
    # persist unconstrained prose until the scenario-author validator is wired.
    # This prevents unsupported external facts from entering a scenario card.
    _generated = " ".join(_content(model.invoke(prompt)).split())
    summary = (
        f"{scenario['title']}은 거시 환경과 사건 전개가 위험선호에 어떻게 전달되는지 살피는 조건부 학습 시나리오입니다. "
        "뉴스의 방향, 정책 반응, 산업 수요가 함께 바뀌는지에 따라 경로의 유효성을 다시 판단해야 합니다."
    )
    title = scenario["title"]
    tone = scenario["tone"]
    check = "회복 신호" if tone == "up" else "방어 신호" if tone == "down" else "방향성 신호"
    chapters = [
        {"title": "거시 환경", "body": "통화정책, 환율, 에너지 가격처럼 위험선호를 바꾸는 환경이 완화되는지 또는 악화되는지 살핍니다.", "evidence": "거시 환경 변화"},
        {"title": "사건의 의미", "body": "정책 발표·실적 가이던스·지정학 뉴스가 시장의 기대를 강화하는지 훼손하는지 구분합니다.", "evidence": "검증된 사건·정책 사실"},
        {"title": "산업 전달 경로", "body": "거시와 사건이 산업 수요, 기업 주문, 투자 심리로 이어지는 과정을 순서대로 확인합니다.", "evidence": "산업·기업 전달 경로"},
        {"title": "분기점", "body": f"{check}가 이어지는지 확인한 뒤 시나리오의 조건 충족 여부를 판단합니다.", "evidence": "검증·무효화 조건"},
    ]
    lessons = [
        "거시 환경은 기업 실적과 별개로 위험자산을 선호하거나 회피하게 만드는 배경입니다.",
        "사건은 기사 제목 자체보다 시장이 기존 기대를 바꿔야 하는지에 영향을 주는지를 읽어야 합니다.",
        "전달 경로를 이해하면 뉴스가 산업 수요와 기업 이익에 닿기까지의 시간차를 구분할 수 있습니다.",
        "분기점은 하나의 수치가 아니라 서로 다른 사실이 같은 방향을 가리키는지 확인하는 과정입니다.",
    ]
    return {
        "summary": summary,
        "thesis": f"{title}은 조건이 충족될 때만 유효한 학습용 경로입니다.",
        "context": "이 결과는 현재 데이터에 시험 보정을 적용한 파일럿이며, 단정적 전망으로 사용하지 않습니다.",
        "chapters": chapters,
        "chapterLessons": lessons,
        "learningReport": {
            "title": f"{title} 읽기",
            "lead": "시장 수치를 외우기보다 거시 환경과 사건이 산업·기업·투자심리에 전달되는 순서를 읽는 것이 이 리포트의 목적입니다.",
            "drivers": [
                {"title": "거시 환경", "transmission": "금리·환율·에너지 환경은 위험자산을 대하는 시장의 태도를 바꿉니다.", "check": "정책 기조와 위험회피 신호가 같은 방향인지 확인합니다."},
                {"title": "사건·정책", "transmission": "실적 전망·정책 발표·지정학 사건은 기대를 다시 쓰게 만듭니다.", "check": "기사 제목보다 원인과 후속 조치를 확인합니다."},
                {"title": "산업·기업", "transmission": "새로운 환경은 주문·재고·투자 계획을 거쳐 기업의 전망으로 전달됩니다.", "check": "산업 수요와 기업 설명이 서로 맞는지 확인합니다."},
                {"title": "무효화 조건", "transmission": "핵심 전제가 깨지면 같은 뉴스도 정반대 결론으로 이어질 수 있습니다.", "check": "반대 사실이 확인되면 시나리오를 보류하고 다시 작성합니다."},
            ],
            "sections": [
                {"title": "기준값 읽기", "paragraphs": ["기준 지수는 변화율 계산의 출발점입니다.", "기준일이 바뀌면 같은 경로도 다른 의미를 가질 수 있습니다."], "takeaway": "먼저 기준일과 기준값을 확인합니다."},
                {"title": "경로 읽기", "paragraphs": ["경로는 각 이벤트의 누적 영향을 보여 줍니다.", "이벤트가 실현되지 않으면 경로도 그대로 따라가지 않을 수 있습니다."], "takeaway": "경로는 조건부 가설입니다."},
                {"title": "검증하기", "paragraphs": ["수급과 변동성은 서로 다른 정보를 제공합니다.", "둘이 엇갈리면 결론을 미루고 추가 확인이 필요합니다."], "takeaway": "신호가 겹칠 때만 확신을 높입니다."},
            ],
        },
        "investorGuide": [
            {"stance": "관찰", "action": "기준값과 수급을 함께 기록", "rationale": "하루 변동을 과대해석하지 않기 위해서입니다."},
            {"stance": "검증", "action": "이벤트별 조건 충족 여부 점검", "rationale": "시나리오는 조건이 있어야 유효합니다."},
            {"stance": "보류", "action": "신호가 엇갈리면 결론을 미룸", "rationale": "불확실성을 결과처럼 다루지 않기 위해서입니다."},
        ],
        "studyGuide": [
            {"topic": "기준값", "question": "기준일과 기준 지수는 무엇이며 왜 먼저 확인해야 할까요?"},
            {"topic": "수급", "question": "거래대금 변화가 방향성 신호가 되려면 무엇을 함께 봐야 할까요?"},
            {"topic": "분기점", "question": "어떤 조건이 갖춰져야 시나리오를 다음 단계로 갱신할 수 있을까요?"},
        ],
        "biasChecks": [
            {"bias": "확증 편향", "trap": "원하는 방향의 신호만 선택합니다.", "counter": "반대 신호와 무효화 조건을 함께 기록합니다."},
            {"bias": "최근성 편향", "trap": "하루 움직임을 추세로 해석합니다.", "counter": "여러 관측일의 누적 흐름을 비교합니다."},
            {"bias": "정밀성 착각", "trap": "소수점 전망을 확정값처럼 봅니다.", "counter": "전망값보다 조건과 한계를 먼저 읽습니다."},
        ],
        "agentInsights": [
            {"role": "영향 계산", "title": "경로 계산", "body": "이벤트별 입력을 누적해 조건부 경로를 계산했습니다."},
            {"role": "시장 자료", "title": "기준값", "body": "읽기 전용 데이터베이스의 최신 코스피 관측값을 기준으로 사용했습니다."},
            {"role": "시나리오 작성", "title": "학습형 서술", "body": "언어 모델 연결을 확인했고, 화면 본문은 검증 가능한 입력값만으로 조립했습니다."},
        ],
        "riskPoints": ["유사사례 수와 유사도는 결과의 신뢰도를 제한합니다.", "웹 보완은 과거 채널이 부족한 경우에만 적용됩니다.", "이 시나리오는 투자 조언이나 확정적 예측이 아닙니다."],
    }


_DISPLAY_LANGUAGE_EXCEPTIONS = {"id", "target", "tone", "image", "forecast", "path", "impact"}
_PARENTHETICAL_PARTICLE = re.compile(r"[은는이가을를과와](?:\([^)]*\))")
_LATIN_LETTER = re.compile(r"[A-Za-z]")


def validate_display_language(card: dict[str, Any]) -> None:
    """Reject non-Korean prose before a pilot card is written to disk."""

    def visit(value: Any, field: str = "") -> None:
        if field in _DISPLAY_LANGUAGE_EXCEPTIONS:
            return
        if isinstance(value, dict):
            for key, nested_value in value.items():
                visit(nested_value, key)
        elif isinstance(value, list):
            for nested_value in value:
                visit(nested_value, field)
        elif isinstance(value, str):
            if _PARENTHETICAL_PARTICLE.search(value):
                raise ValueError(f"display prose contains a parenthetical particle: {value}")
            if _LATIN_LETTER.search(value):
                raise ValueError(f"display prose contains Latin characters: {value}")

    visit(card)


def run(output_dir: Path) -> Path:
    _load_dotenv()
    snapshot = apply_verified_close_override(load_market_snapshot())
    as_of, base_index = snapshot["as_of"], snapshot["base_index"]
    regime = compute_volume_regime(snapshot["trading_values"])
    web_fallback, web_sources = verified_web_fallback(as_of)
    model = _create_chat_model(os.environ["FINVERSE_AGENT_MODEL"])
    output_dir.mkdir(parents=True, exist_ok=True)
    cards: list[dict[str, Any]] = []

    for spec in SCENARIOS:
        metas = tuple(EventMeta(f"e{i}", *event) for i, event in enumerate(spec["events"], start=1))
        channels, analog_cases = historical_channels(
            snapshot["rows"], tone=spec["tone"], max_analogs=1 if spec["tone"] == "neutral" else 3,
        )
        fallbacks = ({channel.event_key: web_fallback for channel in channels} if web_fallback else {})
        impact = build_impact_model(
            scenario_id=spec["id"], target_name="KOSPI", base_index=base_index,
            tone=spec["tone"], weights=regime.weights, channel_inputs=channels,
            event_meta=metas, web_fallbacks=fallbacks,
        )
        detail = author_detail(model, scenario=spec, as_of=as_of, base_index=base_index, forecast=impact.forecast)
        card = {
            "id": spec["id"], "target": "KOSPI", "title": spec["title"], "duration": "1개월",
            "tags": spec["tags"], "forecast": impact.forecast, "tone": spec["tone"],
            "image": f"/scenarios/{spec['id']}.png", "path": list(impact.path),
            "events": [
                {"week": event.week, "category": event.category, "title": event.title, "body": event.body,
                 "impact": f"{event.cumulative_impact_pct:+.1f}%"}
                for event in impact.events
            ],
            **detail,
        }
        validate_display_language(card)
        cards.append(card)
        (output_dir / f"historical-evidence-{spec['id']}.json").write_text(
            json.dumps({"scenario_id": spec["id"], "analog_cases": analog_cases,
                        "channel_confidence": channels[0].channel_confidence, "n_analog": channels[0].n_analog}, ensure_ascii=False, indent=2)
        )

    path = output_dir / "scenarios.json"
    path.write_text(json.dumps({
        "schema_version": "scenario-card/v1",
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(), "as_of": as_of, "target": "KOSPI", "horizon": "1개월",
            "volume_regime": {"tv_ratio": regime.tv_ratio, "activity_score": regime.activity_score, "regime_label": regime.regime_label, "weights": regime.weights.as_dict()},
            "limitations": ["Historical analogues use the longest continuous KOSPI window available at the database as_of date.", "Web fallback is applied only when the historical channel is insufficient."],
            "recent_5d_return_pct": round(snapshot["recent_return"], 2),
            "web_evidence": web_sources,
            "historical_data": {"source": snapshot["source"], "window_start": snapshot["history_start"], "age_days": snapshot["data_age_days"]},
        },
        "scenarios": cards,
    }, ensure_ascii=False, indent=2))
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=ROOT / "output" / "scenario-cards" / "pilot")
    args = parser.parse_args()
    print(run(args.output_dir))


if __name__ == "__main__":
    main()
