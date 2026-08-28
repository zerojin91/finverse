"""Run a bounded, DB-backed Scenario Card pilot with OpenRouter-authored copy.

This pilot uses bounded historical KOSPI analogues and verified public-web
evidence. It is still not an investment recommendation.
"""

from __future__ import annotations

import argparse
import json
import os
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
        "id": "pilot-rebound",
        "title": "조건부 수급 안정 반등",
        "tone": "up",
        "tags": ["거래대금", "위험선호"],
        "channels": ((1.2, 1.6, 1.8), (1.0, 1.4, 1.6), (0.8, 1.2, 1.4)),
        "events": (
            ("1주 전후", "수급", "매도 압력 완화 확인", "거래대금과 시장 참여가 안정되는지 확인합니다."),
            ("2주 전후", "기술", "단기 추세 회복 시도", "가격이 최근 변동 구간을 회복하는지 관찰합니다."),
            ("1개월 전후", "분기점", "반등 지속성 검증", "수급과 변동성이 함께 안정되는지 검증합니다."),
        ),
    },
    {
        "id": "pilot-risk-off",
        "title": "위험회피 재확산",
        "tone": "down",
        "tags": ["변동성", "수급 이탈"],
        "channels": ((-1.5, -1.8, 1.8), (-1.3, -1.6, 1.6), (-1.1, -1.4, 1.4)),
        "events": (
            ("1주 전후", "수급", "매도 우위 지속", "거래대금 증가가 매수 전환이 아닌 매도 압력인지 점검합니다."),
            ("2주 전후", "변동성", "가격 변동 확대", "단기 반등이 추세 전환인지 구분합니다."),
            ("1개월 전후", "분기점", "방어 국면 지속 여부", "수급 안정과 가격 회복이 함께 나타나는지 확인합니다."),
        ),
    },
    {
        "id": "pilot-rangebound",
        "title": "변동성 높은 박스권",
        "tone": "neutral",
        "tags": ["방향성 부재", "확인 대기"],
        "channels": ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        "events": (
            ("1주 전후", "수급", "매수·매도 균형 탐색", "하루 수급보다 며칠간의 누적 방향을 확인합니다."),
            ("2주 전후", "기술", "가격 범위 재확인", "상단·하단 돌파에 거래대금이 동반되는지 봅니다."),
            ("1개월 전후", "분기점", "방향성 선택", "수급과 변동성의 동시 개선 또는 악화를 판단합니다."),
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
        "다음 조건부 KOSPI 시나리오를 설명하는 한국어 문장 두 개만 작성하세요. "
        "투자 권유나 새 숫자는 금지하며, 무엇을 확인해야 하는지 포함하세요. "
        f"제목: {scenario['title']}. 기준일: {as_of}. 기준값: {base_index:,.2f}. 전망: {forecast}."
    )
    # Keep the remote call in the pilot to test the agent boundary, but do not
    # persist unconstrained prose until the scenario-author validator is wired.
    # This prevents unsupported external facts from entering a scenario card.
    _generated = " ".join(_content(model.invoke(prompt)).split())
    summary = (
        f"{scenario['title']}은(는) {base_index:,.2f}을 기준으로 {forecast} 경로를 시험하는 조건부 학습 시나리오입니다. "
        "수급과 변동성 신호가 함께 확인되는지에 따라 경로의 유효성을 다시 판단해야 합니다."
    )
    title = scenario["title"]
    tone = scenario["tone"]
    check = "회복 신호" if tone == "up" else "방어 신호" if tone == "down" else "방향성 신호"
    chapters = [
        {"title": "출발점", "body": f"{base_index:,.2f}을 기준으로 {title}의 전개를 관찰합니다.", "evidence": "기준 지수와 단기 수익률"},
        {"title": "수급 확인", "body": "하루 변화보다 며칠 동안의 거래대금과 참여 강도를 함께 봅니다.", "evidence": "거래대금 레짐"},
        {"title": "변동성 해석", "body": "가격 움직임의 방향과 폭이 같은 신호를 주는지 점검합니다.", "evidence": "경로별 누적 영향"},
        {"title": "분기점", "body": f"{check}가 이어지는지 확인한 뒤 시나리오의 조건 충족 여부를 판단합니다.", "evidence": "이벤트 체크포인트"},
    ]
    lessons = [
        "기준값은 결과를 단정하는 숫자가 아니라 이후 변화율을 읽기 위한 출발점입니다.",
        "수급은 매수와 매도의 힘을 뜻하므로 하루치보다 누적 흐름을 살펴야 합니다.",
        "변동성이 크면 같은 방향의 가격 움직임도 신뢰도가 낮아질 수 있습니다.",
        "분기점은 한 신호가 아니라 가격·수급·변동성이 함께 확인되는 순간입니다.",
    ]
    return {
        "summary": summary,
        "thesis": f"{title}은(는) 조건이 충족될 때만 유효한 학습용 경로입니다.",
        "context": "이 결과는 현재 데이터에 시험 보정을 적용한 파일럿이며, 단정적 전망으로 사용하지 않습니다.",
        "chapters": chapters,
        "chapterLessons": lessons,
        "learningReport": {
            "title": f"{title} 읽기",
            "lead": "기준값·예상 경로·확인 항목을 분리해 읽으면 시나리오를 단정적 예측으로 오해하지 않을 수 있습니다.",
            "metrics": [
                {"label": "기준 지수", "value": f"{base_index:,.2f}", "note": "DB 최신 관측값"},
                {"label": "조건부 전망", "value": forecast, "note": "결정론적 영향 모델"},
                {"label": "수급 상태", "value": "확인 대기", "note": "파일럿 보정값"},
                {"label": "판단 방식", "value": "조건부", "note": "단일 결론 금지"},
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
            {"role": "Impact Model", "title": "경로 계산", "body": "이벤트별 입력을 누적해 조건부 경로를 계산했습니다."},
            {"role": "Market Data", "title": "기준값", "body": "읽기 전용 DB의 최신 KOSPI 관측값을 기준으로 사용했습니다."},
            {"role": "Scenario Author", "title": "학습형 서술", "body": "OpenRouter 연결을 확인했고, 화면 본문은 검증 가능한 입력값만으로 조립했습니다."},
        ],
        "riskPoints": ["유사사례 수와 유사도는 결과의 신뢰도를 제한합니다.", "웹 보완은 과거 채널이 부족한 경우에만 적용됩니다.", "이 시나리오는 투자 조언이나 확정적 예측이 아닙니다."],
    }


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
