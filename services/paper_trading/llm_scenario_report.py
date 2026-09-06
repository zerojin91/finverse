"""LLM narrative report for a completed event-driven simulation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from .llm_market_simulator import LLMMarketUnavailable, _parse_json
from .scenario_investor_analyzer import analyze_scenario_investor


def enforce_verified_report_metrics(report: dict[str, Any],
                                    metrics: dict[str, Any]) -> dict[str, Any]:
    """Correct the common 100x total-return narration error without hiding it."""
    total = float(metrics["total_return_pct"])
    scaled = total * 100
    summary = str(report.get("executive_summary") or "")
    patterns = {f"{scaled:.2f}%", f"{scaled:.3f}%", f"{scaled:.4f}%"}
    corrected = summary
    for value in patterns:
        corrected = corrected.replace(value, f"{total:.4f}%")
    if corrected != summary:
        report["raw_executive_summary"] = summary
        report["executive_summary"] = corrected
        report.setdefault("metric_corrections", []).append({
            "field": "executive_summary", "reason": "100x_percentage_scale_error",
            "verified_value_pct": total,
        })
    # A verified deterministic line always takes precedence over narrative text.
    activity_label = "사용자 판단" if metrics.get("world_decision_count") is not None else "사용자 거래"
    activity_count = int(metrics.get("world_decision_count", metrics["trade_count"]))
    report["quantitative_summary"] = (
        f"검증된 총 수익률 {total:.4f}%, "
        f"최대 가격 낙폭 {float(metrics['max_price_drawdown_pct']):.4f}%, "
        f"{activity_label} {activity_count}회"
    )
    return report


REQUIRED_REPORT_KEYS = ("executive_summary", "investor_profile", "event_reviews",
                        "strengths", "risk_patterns", "action_plan")
REPORT_ATTEMPTS = 3


def _load_report_documents() -> tuple[str, str]:
    """Load the user-owned report contract and analysis instructions."""
    docs_dir = Path(__file__).resolve().parents[2] / "docs"
    template = (docs_dir / "report-template.md").read_text(encoding="utf-8")
    agent = (docs_dir / "report-agent.md").read_text(encoding="utf-8")
    return template, agent


def _compact_agent_rounds(game: dict[str, Any]) -> list[dict[str, Any]]:
    """Keep every recorded agent action while making the report prompt bounded.

    Rationales are already available in the persisted game for drill-down. The
    report needs the complete action log, but not the repeated prose for every
    agent, so each action is represented by its identity, side and notional.
    """
    rounds = []
    for row in game.get("agent_rounds", []):
        actions = []
        for order in row.get("persona_orders") or []:
            actions.append({key: order.get(key) for key in
                            ("persona_id", "group", "side", "quantity", "filled_quantity", "notional")})
        rounds.append({
            "market_date": row.get("market_date"), "phase": row.get("phase"),
            "return_pct": row.get("return_pct"), "previous_price": row.get("previous_price"),
            "price": row.get("price"), "order_imbalance": row.get("order_imbalance"),
            "market_pressure": row.get("market_pressure"),
            "market_summary": row.get("market_summary", ""),
            "actions": actions,
        })
    return rounds


def _report_context(game: dict[str, Any]) -> dict[str, Any]:
    base = analyze_scenario_investor(game)
    world = game.get("world") or {}
    memory = world.get("memory") or {}
    portfolio = game.get("portfolio") or {}
    if not portfolio:
        from .scenario_trading import scenario_portfolio
        portfolio = scenario_portfolio(game)
    return {
        "security": {"ticker": game.get("ticker"), "name": game.get("name")},
        "mode": game.get("mode"),
        "simulation_period": game.get("simulation_days") or len(game.get("agent_rounds", [])),
        "portfolio_at_end": portfolio,
        "initial_equity": game.get("initial_equity"),
        "user_daily_actions": [
            {key: row.get(key) for key in
             ("market_date", "stance", "label", "event_id", "market_return_pct", "market_summary", "source")}
            for row in game.get("daily_reflections", [])
        ],
        "user_fills": [{key: fill.get(key) for key in
                        ("market_date", "event_id", "phase", "side", "quantity", "price", "gross_amount", "rationale", "confidence", "realized_pnl")}
                       for fill in game.get("fills", [])],
        "world_state_daily_memory": memory.get("daily_ledger", []),
        "world_event_memory": memory.get("event_ledger", []),
        "agent_rounds_and_all_actions": _compact_agent_rounds(game),
        "verified_assessment": base,
    }


def _call_structured_report(messages: list[dict[str, str]], required_keys: list[str],
                            chat: Callable[..., str]) -> dict[str, Any]:
    report: dict[str, Any] = {}
    missing: list[str] = []
    last_error: Exception | None = None
    for _ in range(REPORT_ATTEMPTS):
        retry = list(messages)
        if missing:
            retry.append({"role": "user", "content":
                          f"직전 응답에 다음 필수 키가 없었다. 형식을 지켜 모두 포함해 다시 반환하라: {', '.join(missing)}"})
        try:
            report = _parse_json(chat(retry, temperature=.35, max_tokens=9000,
                                      response_format={"type": "json_object"}))
        except Exception as exc:  # noqa: BLE001 - 제한된 횟수로 재시도
            last_error, missing = exc, []
            continue
        missing = [key for key in required_keys if key not in report]
        if not missing:
            return report
        last_error = None
    if last_error is not None:
        raise LLMMarketUnavailable("LLM 보고서 생성에 실패했습니다.") from last_error
    raise LLMMarketUnavailable(f"LLM 보고서에 필수 항목이 누락됐습니다: {', '.join(missing)}")


_INVESTOR_TYPES = {
    "anchor": ("원칙형", "The Anchor", -3, 3),
    "adapter": ("전략형", "The Adapter", 3, 3),
    "defender": ("고집 반응형", "The Defender", -3, -3),
    "chaser": ("추격형", "The Chaser", 3, -3),
}


def _markdown_text(value: Any, fallback: str) -> str:
    """Render untrusted model text safely inside Markdown tables and prose."""
    text = " ".join(str(value or "").split())
    return (text.replace("|", "／") if text else fallback)


def _markdown_list(value: Any, fallback: list[str], limit: int = 3) -> list[str]:
    values = value if isinstance(value, list) else []
    result = [_markdown_text(item, "") for item in values if _markdown_text(item, "")]
    return (result[:limit] or fallback)[:limit]


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _stance_label(value: Any) -> str:
    labels = {
        "BUY_CONSIDER": "매수 고려", "SELL_CONSIDER": "매도 고려",
        "HOLD_WATCH": "관찰 계속", "BUY": "매수", "SELL": "매도",
    }
    return labels.get(str(value), _markdown_text(value, "관찰 계속"))


def _infer_investor_type(report: dict[str, Any], context: dict[str, Any]) -> str:
    candidate = str(report.get("investor_type") or "").strip().lower()
    if candidate in _INVESTOR_TYPES:
        return candidate
    actions = [str(row.get("stance") or "") for row in context.get("user_daily_actions", [])]
    traded = sum(action in {"BUY_CONSIDER", "SELL_CONSIDER"} for action in actions)
    if not actions or traded == 0:
        return "anchor"
    if traded >= max(3, len(actions) // 2):
        return "chaser"
    return "adapter"


def _score(value: Any, fallback: int) -> int:
    try:
        return max(-5, min(5, int(round(float(value)))))
    except (TypeError, ValueError):
        return fallback


def _score_bar(value: int) -> str:
    position = max(0, min(10, value + 5))
    return f"`{'─' * position}●{'─' * (10 - position)}`"


def _user_action_rows(context: dict[str, Any]) -> list[dict[str, Any]]:
    return [row for row in context.get("user_daily_actions", []) if isinstance(row, dict)]


def _default_scenarios(context: dict[str, Any]) -> list[dict[str, Any]]:
    events = [event for event in context.get("world_event_memory", []) if isinstance(event, dict)]
    if not events:
        return [{
            "scenario_name": "일상 거래일의 시장 변동", "scenario_category": "시장 흐름",
            "representative_event": "기록된 일별 수급과 가격 변동",
            "scenario_description": "중요 사건이 없는 거래일에도 공개된 시장 환경과 수급 변화가 누적되어 가격이 움직인 구간입니다.",
            "events": [],
        }]
    scenarios = []
    for event in events[:5]:
        scenarios.append({
            "scenario_name": _markdown_text(event.get("title") or event.get("event"), "시장 환경 변화"),
            "scenario_category": _markdown_text(event.get("category") or event.get("event_type"), "외부 환경"),
            "representative_event": _markdown_text(event.get("title") or event.get("event"), "시장 환경 변화"),
            "scenario_description": _markdown_text(event.get("description") or event.get("summary"), "기록된 외부 환경 변화가 시장에 전달된 구간입니다."),
            "events": [event],
        })
    return scenarios


def _render_investment_report_template(report: dict[str, Any], context: dict[str, Any]) -> str:
    """Fill the user-owned template deterministically from LLM analysis and logs.

    The model produces concise structured analysis.  The application owns the
    Markdown shape so a truncated model response can never leave a partial
    template or make the UI fall back to the old short-form report.
    """
    analysis = _mapping(report.get("template_analysis"))
    kind = _infer_investor_type(report, context)
    kind_kr, kind_en, x_default, y_default = _INVESTOR_TYPES[kind]
    axes = _mapping(analysis.get("axes"))
    x_axis, y_axis = _mapping(axes.get("judgment_flexibility")), _mapping(axes.get("behavioral_control"))
    x_score = _score(x_axis.get("score"), x_default)
    y_score = _score(y_axis.get("score"), y_default)
    confidence = _markdown_text(analysis.get("analysis_confidence"), "보통")
    actions = _user_action_rows(context)
    fills = [fill for fill in context.get("user_fills", []) if isinstance(fill, dict)]
    scenarios = analysis.get("scenarios") if isinstance(analysis.get("scenarios"), list) else _default_scenarios(context)
    scenarios = [item for item in scenarios if isinstance(item, dict)][:5] or _default_scenarios(context)
    strong_traits = _markdown_list(analysis.get("strong_traits"), [
        "기록된 정보 안에서 판단을 남겼음", "시장 가격과 개인 포트폴리오 영향을 구분했음", "일별 선택을 일관되게 기록했음",
    ])
    risks = _markdown_list(analysis.get("risk_patterns"), [
        "한 가지 선택을 반복할 때 반대 근거도 함께 점검할 필요가 있음", "포지션을 바꾸지 않은 이유를 더 구체적으로 기록할 필요가 있음",
    ], 2)
    summary = _markdown_text(report.get("summary"), "게임 기록을 바탕으로 사용자의 판단 과정과 실제 포트폴리오 변화를 정리했습니다.")
    quote = _markdown_text(analysis.get("personality_summary_quote"), "기록된 근거를 확인한 뒤, 내 원칙 안에서 판단을 남긴다.")
    metrics = _mapping(report.get("verified_metrics"))
    portfolio = _mapping(context.get("portfolio_at_end"))
    initial_equity = float(context.get("initial_equity") or 0)
    final_equity = float(portfolio.get("total_asset") or portfolio.get("equity") or initial_equity)
    return_pct = float(metrics.get("total_return_pct") or 0)
    distance = (x_score ** 2 + y_score ** 2) ** .5
    actor_defaults = {
        "개인": "공개 정보에 대한 각기 다른 해석을 바탕으로 분산된 대응을 보였습니다.",
        "외국인": "거시·환율·위험선호를 함께 반영해 방향성 있는 수급을 보였습니다.",
        "기관": "운용·ETF·리밸런싱 목적이 섞여 일관되지 않은 대응을 보였습니다.",
        "연기금": "저빈도·장기 운용 원칙 아래 포지션 변화를 제한했습니다.",
    }
    lines = [
        "# 나의 투자 성향 분석 보고서", "",
        f"> **Session:** `{_markdown_text(context.get('security', {}).get('ticker'), 'simulation')}`  ",
        f"> **Simulation Date:** `{_markdown_text(context.get('simulation_period'), '기록 기준')}`  ",
        f"> **총 이벤트:** {len(context.get('world_event_memory', []))}개  ",
        f"> **분석 시나리오:** {len(scenarios)}개  ",
        f"> **분석 신뢰도:** {confidence}", "", "---", "",
        "# 1. 한눈에 보는 나의 투자 성향", "",
        f"## {kind_kr} · {kind_en}", "", f"> **“{quote}”**", "",
        "| 항목 | 점수 | 해석 |", "|---|---:|---|",
        f"| 판단 가변성 | **{x_score} / 5** | {_markdown_text(x_axis.get('summary'), '새 정보에 대한 판단 수정 기록을 기준으로 평가했습니다.')} |",
        f"| 행동 통제성 | **{y_score} / 5** | {_markdown_text(y_axis.get('summary'), '판단과 실제 주문 사이의 일관성을 기준으로 평가했습니다.')} |", "",
        f"**현재 위치:** `({x_score}, {y_score})`", "",
        "- X축: **판단 가변성** — 고정형 `-5` ↔ 적응형 `+5`",
        "- Y축: **행동 통제성** — 반응형 `-5` ↔ 통제형 `+5`", "",
        f"`판단`  -5 {'─' * (x_score + 5)}●{'─' * (5 - x_score)} +5", "",
        f"`행동`  -5 {'─' * (y_score + 5)}●{'─' * (5 - y_score)} +5", "",
        "### 유형 구분", "", "|  | 판단 고정형 | 판단 적응형 |", "|---|---|---|",
        "| **행동 통제형** | 원칙형 · The Anchor | 전략형 · The Adapter |",
        "| **행동 반응형** | 고집 반응형 · The Defender | 추격형 · The Chaser |", "",
        "### 이번 게임에서 가장 두드러진 특징", "", "**강하게 나타난 특성**", "",
        *[f"- {item}" for item in strong_traits], "", "**주의할 행동 패턴**", "",
        *[f"- {item}" for item in risks], "", "---", "",
        "# 2. 내가 마주한 시나리오", "",
        f"이번 게임에서 발생한 사건과 시장 변동을 이벤트의 성격과 전달 경로를 기준으로 {len(scenarios)}개 시나리오로 정리했습니다.", "",
        "> 시나리오는 수익률 결과나 사용자의 선택이 아니라, 이벤트 자체의 성격과 시장 전달 경로를 기준으로 분류했습니다.", "",
    ]
    for index, scenario in enumerate(scenarios, start=1):
        item = _mapping(scenario)
        event_rows = item.get("events") if isinstance(item.get("events"), list) else []
        event_rows = [row for row in event_rows if isinstance(row, dict)]
        if not event_rows:
            event_rows = [{"title": item.get("representative_event"), "description": item.get("scenario_description")}]
        initial = next((row for row in actions if row.get("event_id")), actions[0] if actions else {})
        updated = actions[-1] if actions else {}
        action_summary = f"기록된 판단 {len(actions)}회, 체결 {len(fills)}건"
        lines += [
            "---", "", f"## Scenario {index}. {_markdown_text(item.get('scenario_name'), '시장 환경 변화')}", "",
            f"**시나리오 유형:** {_markdown_text(item.get('scenario_category'), '시장 흐름')}  ",
            f"**발생 횟수:** {len(event_rows)}회  ",
            f"**대표 이벤트:** {_markdown_text(item.get('representative_event'), '일별 시장 변동')}  ",
            f"**시장 특성:** {_markdown_text(item.get('market_characteristic'), '공개 정보와 수급 변화가 함께 반영된 구간')}", "",
            "### 시나리오 정의", "", _markdown_text(item.get("scenario_description"), "기록된 외부 환경 변화와 일별 시장 반응을 함께 살핀 구간입니다."), "",
            "### 포함된 이벤트", "", "| Event | 이벤트 | 충격 방향 | Surprise | 주요 영향 |", "|---|---|---|---:|---|",
        ]
        for event in event_rows:
            lines.append("| " + " | ".join([
                _markdown_text(event.get("event_date") or event.get("date"), "기록일"),
                _markdown_text(event.get("title") or event.get("event"), "시장 환경 변화"),
                _markdown_text(event.get("direction"), "혼합"),
                _markdown_text(event.get("surprise_level"), "-"),
                _markdown_text(event.get("impact") or event.get("description"), "시장 전달 경로를 관찰함"),
            ]) + " |")
        lines += ["", "## 시장 참여자들은 어떻게 판단했는가", "", "| 투자 주체 | 주요 판단 | 대표 행동 | 강도 | 핵심 근거 |", "|---|---|---|---:|---|"]
        actor_analysis = _mapping(item.get("actor_responses"))
        for actor, fallback in actor_defaults.items():
            actor_row = _mapping(actor_analysis.get(actor))
            lines.append(f"| {actor} | {_markdown_text(actor_row.get('view'), fallback)} | {_markdown_text(actor_row.get('action'), '독립 판단')} | {_markdown_text(actor_row.get('intensity'), '중간')} | {_markdown_text(actor_row.get('reasoning'), '당일 공개 정보와 각 주체의 운용 원칙')} |")
        lines += [
            "", "### 나의 판단과 선택", "", "**초기 판단**", "",
            _markdown_text(item.get("user_initial_view") or initial.get("label"), "기록된 첫 판단을 기준으로 시장을 관찰했습니다."), "",
            "**새로운 정보 이후 판단**", "",
            _markdown_text(item.get("user_updated_view") or updated.get("label"), "새로운 일별 정보가 공개될 때마다 판단을 기록했습니다."), "",
            "**실제 선택**", "", _markdown_text(item.get("user_action_summary"), action_summary), "",
            "### 다른 투자 주체와 비교", "",
            f"- **가장 유사했던 주체:** {_markdown_text(item.get('most_similar_actor'), '기록상 단정하기 어려움')}",
            f"  - {_markdown_text(item.get('similarity_reason'), '사용자와 각 주체의 판단 근거를 같은 기준으로 비교했습니다.')}",
            f"- **가장 달랐던 주체:** {_markdown_text(item.get('most_different_actor'), '기록상 단정하기 어려움')}",
            f"  - {_markdown_text(item.get('difference_reason'), '수급 주체별 운용 목적이 달라 행동의 방향과 강도가 달랐습니다.')}",
            f"- **나만의 특징:** {_markdown_text(item.get('user_unique_behavior'), '개인 포트폴리오의 판단을 매 거래일 기록했습니다.')}", "",
            "## 이 시나리오에서 나타난 나의 반응", "", "### 판단 측면", "",
            _markdown_text(item.get("judgment_analysis"), "당시 공개된 정보와 이후의 가격 결과를 구분해 판단 과정을 돌아볼 필요가 있습니다."), "",
            "### 행동 측면", "", _markdown_text(item.get("behavior_analysis"), "판단과 실제 주문은 별개로 기록되며, 체결은 개인 포트폴리오에만 반영됩니다."), "",
            "### 시장 참여자들과 비교했을 때 특징", "", _markdown_text(item.get("comparative_analysis"), "개인 투자자는 시장 전체 수급을 움직이지 않으며, 각 수급 주체의 집단 반응과 구분해 해석합니다."), "",
            "## 이 시나리오가 성향 점수에 준 영향", "", "| 성향 | 영향 | 주요 증거 |", "|---|---:|---|",
            f"| 판단 가변성 | {_markdown_text(item.get('x_contribution'), '0')} | {_markdown_text(item.get('x_evidence'), '기록된 판단 변화를 기준으로 검토')} |",
            f"| 행동 통제성 | {_markdown_text(item.get('y_contribution'), '0')} | {_markdown_text(item.get('y_evidence'), '주문과 관찰 기록을 기준으로 검토')} |", "",
        ]
    daily_lines = [f"- **{_markdown_text(row.get('market_date'), '기록일')}** · {_stance_label(row.get('stance'))} — {_markdown_text(row.get('market_summary'), '당일 공개 정보와 가격 변화를 확인했습니다.')}" for row in actions]
    bias_findings = analysis.get("bias_findings") if isinstance(analysis.get("bias_findings"), list) else []
    bias_findings = [item for item in bias_findings if isinstance(item, dict)][:3]
    if not bias_findings:
        bias_findings = [{"bias_name": "확증 편향 점검", "related_axis": "판단 가변성", "risk_level": "점검", "related_scenarios": "기록된 전체 거래일", "observed_behavior": "한 방향의 판단을 유지할 때 반대 근거를 함께 확인해야 합니다.", "bias_explanation": "기존 판단만 뒷받침하는 정보에 집중하면 새로운 위험 신호를 놓칠 수 있습니다.", "correction_method": "매 거래일 반대 가설 한 가지를 함께 기록합니다.", "self_check_question": "내 판단을 바꿀 수 있는 정보는 무엇인가?"}]
    guides = analysis.get("scenario_guides") if isinstance(analysis.get("scenario_guides"), list) else []
    guides = [item for item in guides if isinstance(item, dict)][:3] or [{"scenario_name": "변동성 확대 구간", "observed_pattern": "가격 변동과 공개 정보를 함께 확인했습니다.", "related_bias": "손실 회피 또는 추격 매수", "checks": ["가격 변동의 원인을 확인했는가?", "반대 근거를 확인했는가?", "주문 규모가 원칙에 맞는가?"], "recommended_rule": "하나의 거래일 결과가 아니라 사전에 정한 근거와 위험 한도를 기준으로 판단합니다."}]
    lines += [
        "---", "", "# 3. 시나리오를 가로질러 나타난 나의 패턴", "",
        "개별 이벤트 하나보다 중요한 것은 서로 다른 시장 환경에서 반복적으로 나타난 판단과 행동 방식입니다.", "",
        "## 반복적으로 나타난 판단 패턴", "", _markdown_text(analysis.get("cross_scenario_judgment_patterns"), summary), "",
        "## 반복적으로 나타난 행동 패턴", "", _markdown_text(analysis.get("cross_scenario_behavior_patterns"), _markdown_text(report.get("behavior_pattern"), "일별 판단과 체결 기록을 함께 확인했습니다.")), "",
        "## 특정 상황에서 두드러졌던 특징", "", _markdown_text(analysis.get("context_dependent_patterns"), "사건과 가격 변동이 큰 날에는 판단 근거와 포지션 변화의 관계를 더 면밀히 점검할 필요가 있습니다."), "",
        "## 시장 상황에 따라 달라진 반응", "", _markdown_text(analysis.get("scenario_dependent_reactions"), "거래일별 선택을 누적해 다음 시나리오에서 같은 상황을 비교할 수 있습니다."), "",
        "---", "", "# 4. 판단 가변성", "", f"## {x_score} / 5", "", "**고정형 `-5` ←──────── `0` ────────→ `+5` 적응형**", "", _score_bar(x_score), "",
        "### 이 점수가 의미하는 것", "", _markdown_text(x_axis.get("interpretation"), "새로운 정보에 따라 기존 관점을 어떻게 검토하고 수정했는지를 기록 기준으로 평가한 점수입니다."), "",
        "### 주요 근거", "", _markdown_text(x_axis.get("evidence"), "일별 판단 기록과 사건 전후 선택을 함께 확인했습니다."), "",
        "### 판단을 크게 바꾸었던 시나리오", "", _markdown_text(x_axis.get("high_scenarios"), "기록에서 충분한 판단 변경 근거를 확인하지 못했습니다."), "",
        "### 기존 판단을 강하게 유지했던 시나리오", "", _markdown_text(x_axis.get("low_scenarios"), "기록된 선택의 반복성과 근거를 함께 검토했습니다."), "",
        "---", "", "# 5. 행동 통제성", "", f"## {y_score} / 5", "", "**반응형 `-5` ←──────── `0` ────────→ `+5` 통제형**", "", _score_bar(y_score), "",
        "### 이 점수가 의미하는 것", "", _markdown_text(y_axis.get("interpretation"), "판단이 실제 주문으로 이어지는 방식과 행동을 유보한 기록을 기준으로 평가한 점수입니다."), "",
        "### 주요 근거", "", _markdown_text(y_axis.get("evidence"), "체결 기록과 관찰 선택을 함께 확인했습니다."), "",
        "### 즉각적인 행동이 강하게 나타난 시나리오", "", _markdown_text(y_axis.get("reactive_scenarios"), "기록에서 충분한 즉각 행동 근거를 확인하지 못했습니다."), "",
        "### 행동을 유보하거나 통제했던 시나리오", "", _markdown_text(y_axis.get("controlled_scenarios"), "일별 판단과 실제 체결 사이의 간격을 확인했습니다."), "",
        "---", "", "# 6. 나의 투자 유형", "", f"# {kind_kr}", "", f"### {kind_en}", "",
        _markdown_text(analysis.get("personality_description"), "이번 게임의 기록에서 확인된 판단 가변성과 행동 통제성의 조합을 바탕으로 분류한 교육용 유형입니다."), "",
        "### 이 유형의 핵심 특징", "", _markdown_text(analysis.get("personality_core_characteristics"), "수익률이 아니라 당시 정보 아래에서 판단과 행동을 연결한 방식을 중심으로 봅니다."), "",
        "### 이 유형의 강점", "", *[f"- {item}" for item in _markdown_list(analysis.get("strengths"), strong_traits)], "",
        "### 시장에서 유리할 수 있는 상황", "", *[f"- {item}" for item in _markdown_list(analysis.get("favorable_contexts"), ["사전에 정한 원칙을 점검할 수 있는 상황", "근거를 비교하며 포지션을 조절할 수 있는 상황"], 2)], "",
        "### 취약해질 수 있는 상황", "", *[f"- {item}" for item in _markdown_list(analysis.get("vulnerable_contexts"), risks, 2)], "",
        "### 이번 게임에서 실제로 나타난 사례", "", "\n".join(daily_lines) if daily_lines else "- 기록된 사용자 판단이 없어 행동 사례를 확정할 수 없습니다.", "",
        "---", "", "# 7. 중립점으로부터의 거리", "", "**중립점:** `(0, 0)`  ", f"**현재 위치:** `({x_score}, {y_score})`  ", f"**중립점과의 거리:** `{distance:.2f} / 7.07`", "",
        _markdown_text(analysis.get("distance_interpretation"), "중립점에서의 거리는 좋고 나쁨이 아니라 특정 판단·행동 경향의 뚜렷함을 나타냅니다."), "",
        "> 중심에서 멀다는 것은 반드시 나쁘다는 의미가 아닙니다. 특정 투자 환경에서는 극단적인 성향이 강점이 될 수 있습니다.", "",
        "---", "", "# 8. 나에게 나타날 가능성이 높은 인지 편향", "",
    ]
    for finding in bias_findings:
        finding = _mapping(finding)
        lines += [
            f"## {_markdown_text(finding.get('bias_name'), '인지 편향 점검')}", "",
            f"**관련 축:** {_markdown_text(finding.get('related_axis'), '판단·행동 기록')}  ",
            f"**위험도:** {_markdown_text(finding.get('risk_level'), '점검')}  ",
            f"**주로 나타난 시나리오:** {_markdown_text(finding.get('related_scenarios'), '기록된 거래일')}", "",
            "### 게임에서 관찰된 행동", "", _markdown_text(finding.get("observed_behavior"), "추가 확인이 필요한 행동 패턴입니다."), "",
            "### 왜 이 행동이 편향으로 이어질 수 있는가", "", _markdown_text(finding.get("bias_explanation"), "한 방향의 해석만 반복하면 반대 신호를 놓칠 수 있습니다."), "",
            "### 교정 방법", "", _markdown_text(finding.get("correction_method"), "판단 전에 반대 가설과 손실 한도를 함께 기록합니다."), "",
            "### 다음 게임에서 확인할 질문", "", f"> {_markdown_text(finding.get('self_check_question'), '이 판단을 바꿀 수 있는 새 정보는 무엇인가?')}", "",
        ]
    lines += ["---", "", "# 9. 상황별 행동 교정 가이드", ""]
    for guide in guides:
        guide = _mapping(guide)
        checks = _markdown_list(guide.get("checks"), ["가격 변동의 원인을 확인했는가?", "반대 근거를 확인했는가?", "주문 규모가 원칙에 맞는가?"], 3)
        lines += [
            f"## {_markdown_text(guide.get('scenario_name'), '변동성 확대 구간')}을 다시 만난다면", "",
            "**이번 게임에서 나타난 나의 반응**", "", _markdown_text(guide.get("observed_pattern"), "기록된 판단을 바탕으로 시장을 관찰했습니다."), "",
            "**주의할 수 있는 편향**", "", _markdown_text(guide.get("related_bias"), "확증 편향 또는 손실 회피"), "",
            "**행동 전 체크**", "", *[f"{idx}. {check}" for idx, check in enumerate(checks, start=1)], "",
            "**권장 판단 또는 행동 원칙**", "", f"> {_markdown_text(guide.get('recommended_rule'), '사전에 정한 근거와 위험 한도를 기준으로 판단합니다.')}", "",
        ]
    lines += [
        "---", "", "# 10. 이번 게임에서 얻은 핵심 인사이트", "",
        "### 가장 효과적이었던 판단 또는 행동", "", _markdown_text(analysis.get("best_behavior"), strong_traits[0]), "",
        "### 가장 개선할 가치가 큰 부분", "", _markdown_text(analysis.get("highest_priority_improvement"), risks[0]), "",
        "### 다음 게임에서 하나만 바꾼다면", "", f"> **{_markdown_text(analysis.get('single_next_action'), '매 거래일 반대 근거 한 가지와 행동 기준을 함께 기록합니다.')}**", "",
        "---", "", "# Appendix A. 성향 점수 산정 근거", "", "## 판단 가변성", "", "| Evidence | 방향 | 가중치 | 설명 |", "|---|---:|---:|---|",
        f"| 일별 판단 기록 | {x_score:+d} | 1.0 | {_markdown_text(x_axis.get('evidence'), '기록된 판단 변화와 유지 사례')} |", "", f"**최종 점수:** {x_score}", "",
        "---", "", "## 행동 통제성", "", "| Evidence | 방향 | 가중치 | 설명 |", "|---|---:|---:|---|",
        f"| 체결·관찰 기록 | {y_score:+d} | 1.0 | {_markdown_text(y_axis.get('evidence'), '체결과 행동 유보 사례')} |", "", f"**최종 점수:** {y_score}", "",
        "---", "", "# Appendix B. 분석 신뢰도", "", "| 항목 | 평가 |", "|---|---|",
        f"| 분석 가능한 이벤트 수 | {len(context.get('world_event_memory', []))} |",
        f"| 서로 다른 시나리오 수 | {len(scenarios)} |",
        f"| 판단 가변성 증거량 | {len(actions)}건의 일별 판단 기록 |",
        f"| 행동 통제성 증거량 | {len(fills)}건의 체결 기록 |",
        "| 서로 다른 시나리오에서의 증거 반복성 | 기록된 거래일 기준 |",
        "| 상충하는 증거의 정도 | LLM 해석과 검증 로그를 함께 검토 |", "",
        f"**종합 신뢰도: {confidence}**", "",
        _markdown_text(analysis.get("confidence_caveat"), "이 보고서는 교육용 시뮬레이션 로그에 근거하며, 기록되지 않은 심리나 의도를 사실로 단정하지 않습니다."),
    ]
    report["report_markdown"] = "\n".join(lines)
    report["final_equity"] = final_equity
    report["total_return_pct"] = return_pct
    return report


def generate_llm_reports(game: dict[str, Any],
                         chat: Callable[..., str] | None = None) -> dict[str, Any]:
    """Generate separate learner and world reports from one completed game.

    Both reports receive the same persisted world/action history, but use
    different prompts so the learner report focuses on the user's decisions
    while the scenario report explains the evolving environment and agents.
    """
    if chat is None:
        from .llm_client import LLMClient
        chat = LLMClient().chat
    context = _report_context(game)
    report_template, report_agent = _load_report_documents()
    common = ("한국 주식 교육용 가상 시뮬레이션이다. 실제 투자 권유나 미래 예측을 하지 않는다. "
              "입력의 금액과 퍼센트는 엔진이 계산한 검증값이므로 임의로 바꾸지 않는다. "
              "근거가 없는 심리 특성은 단정하지 말고 기록에서 확인되는 행동 패턴으로만 설명한다. "
              "반드시 JSON 객체만 반환한다. 아래 분석 에이전트 지침을 따른다.\n\n"
              f"[report-agent.md]\n{report_agent}")
    # The Markdown template is rendered by this service, not by the model.
    # Asking a model to return the entire long template made reports susceptible
    # to truncation and left the UI on the old short-form fallback.
    investment_keys = ["summary", "daily_action_review", "behavior_pattern", "strengths", "risk_patterns", "next_practice"]
    scenario_keys = ["summary", "environment_evolution", "event_reviews", "stock_flow", "group_behavior", "key_turning_points"]
    investment_message = {"role": "user", "content": (
        f"다음 기록으로 사용자의 투자보고서를 작성하라.\n{json.dumps(context, ensure_ascii=False)}\n"
        "report-template.md는 서버가 고정된 목차·표 구조로 렌더링한다. 모델은 Markdown을 쓰지 말고, "
        "아래 템플릿의 1~10번 섹션에 채울 근거 기반 분석을 template_analysis JSON으로 반환하라. "
        "데이터가 없는 항목은 추정하지 말고 '기록상 확인 불가'로 짧게 적어라.\n\n"
        f"[report-template.md]\n{report_template}\n\n"
        "사용자가 날짜별로 매수·매도·관찰을 어떻게 선택했는지, 최종 투자금액과 종료일 가격 기준 손익을 설명하라. "
        "investor_type은 행동 기록과 템플릿 기준을 종합해 anchor, adapter, defender, chaser 중 정확히 하나를 선택하라. "
        "daily_action_review는 날짜별 1~2문장 배열로 작성하라. 반환 형식: "
        '{"investor_type":"anchor|adapter|defender|chaser", "summary":"3~5문장", "daily_action_review":[{"date":"날짜","action":"행동","result":"다음 결과"}], '
        '"behavior_pattern":"종합 행동 패턴", "strengths":["잘한 점"], "risk_patterns":["주의할 점"], "next_practice":["다음 연습 원칙"], '
        '"template_analysis":{"personality_summary_quote":"한 문장", "analysis_confidence":"높음|보통|낮음", '
        '"strong_traits":["특성"], "risk_patterns":["주의"], '
        '"axes":{"judgment_flexibility":{"score":-5,"summary":"표용 요약","interpretation":"해석","evidence":"근거","high_scenarios":"사례","low_scenarios":"사례"}, '
        '"behavioral_control":{"score":5,"summary":"표용 요약","interpretation":"해석","evidence":"근거","reactive_scenarios":"사례","controlled_scenarios":"사례"}}, '
        '"scenarios":[{"scenario_name":"이름","scenario_category":"유형","representative_event":"대표 사건","market_characteristic":"시장 특성","scenario_description":"정의", '
        '"events":[{"date":"날짜","event":"사건","direction":"긍정|부정|혼합","surprise_level":"낮음|중간|높음","impact":"영향"}], '
        '"actor_responses":{"개인":{"view":"판단","action":"행동","intensity":"강도","reasoning":"근거"}}, "user_initial_view":"초기 판단", "user_updated_view":"변화", "user_action_summary":"선택", '
        '"most_similar_actor":"주체","similarity_reason":"이유","most_different_actor":"주체","difference_reason":"이유","user_unique_behavior":"특징", '
        '"judgment_analysis":"분석","behavior_analysis":"분석","comparative_analysis":"비교","x_contribution":"+1","x_evidence":"근거","y_contribution":"+1","y_evidence":"근거"}], '
        '"cross_scenario_judgment_patterns":"패턴", "cross_scenario_behavior_patterns":"패턴", "context_dependent_patterns":"패턴", "scenario_dependent_reactions":"패턴", '
        '"personality_description":"설명", "personality_core_characteristics":"핵심", "strengths":["강점"], "favorable_contexts":["상황"], "vulnerable_contexts":["상황"], '
        '"bias_findings":[{"bias_name":"편향","related_axis":"축","risk_level":"낮음|중간|높음","related_scenarios":"사례","observed_behavior":"행동","bias_explanation":"설명","correction_method":"교정","self_check_question":"질문"}], '
        '"scenario_guides":[{"scenario_name":"상황","observed_pattern":"반응","related_bias":"편향","checks":["확인1","확인2","확인3"],"recommended_rule":"원칙"}], '
        '"best_behavior":"잘한 행동", "highest_priority_improvement":"개선점", "single_next_action":"다음 한 가지", "confidence_caveat":"한계"}}'
    )}
    scenario_message = {"role": "user", "content": (
        f"다음 기록으로 시나리오 보고서를 작성하라.\n{json.dumps(context, ensure_ascii=False)}\n"
        "World State의 거래일별 변화, 실제 유사 근거로 생성된 이벤트, 사건 전후 종목 흐름, "
        "개인·외국인·기관·연기금의 집단 행동과 모든 개별 행동 기록을 종합하라. "
        "반환 형식: {\"summary\":\"전체 흐름 3~5문장\", \"environment_evolution\":\"환경 변화\", "
        "\"event_reviews\":[{\"date\":\"날짜\",\"event\":\"사건\",\"impact\":\"영향\"}], "
        "\"stock_flow\":\"가격 흐름\", \"group_behavior\":{\"retail\":\"개인\",\"foreign\":\"외국인\",\"institution\":\"기관\",\"pension\":\"연기금\"}, "
        "\"key_turning_points\":[\"전환점\"]}"
    )}
    investment = _call_structured_report(
        [{"role": "system", "content": common}, investment_message], investment_keys, chat)
    scenario = _call_structured_report(
        [{"role": "system", "content": common}, scenario_message], scenario_keys, chat)
    metrics = context["verified_assessment"]["metrics"]
    investment["verified_metrics"] = metrics
    investment["portfolio_at_end"] = context["portfolio_at_end"]
    investment["initial_equity"] = context["initial_equity"]
    investment = enforce_verified_report_metrics(investment, metrics)
    investment = _render_investment_report_template(investment, context)
    scenario["verified_metrics"] = metrics
    return {"investment": investment, "scenario": scenario}


def _slim_psychology(psychology: dict[str, Any]) -> dict[str, Any]:
    """Keep the psychology signal, drop the per-persona memory arrays.

    Each round carries every group's rolling `memory` list, which is most of the
    prompt and tells the model nothing the sentiment value doesn't already say.
    """
    groups = {
        group: {"sentiment": state.get("sentiment"),
                "risk_aversion": state.get("risk_aversion"),
                "event_conviction": state.get("event_conviction")}
        for group, state in (psychology.get("groups") or {}).items()
    }
    return {"aggregate_sentiment": psychology.get("aggregate_sentiment"),
            "event_impulse": psychology.get("event_impulse"),
            "event_regime": psychology.get("event_regime"), "groups": groups}


def generate_llm_scenario_report(game: dict[str, Any],
                                 chat: Callable[..., str] | None = None) -> dict[str, Any]:
    base = analyze_scenario_investor(game)
    context = {
        "ticker": game["ticker"], "name": game["name"],
        "scenario_premise": game.get("scenario_premise", ""),
        "events": [{"sequence": event["sequence"], "title": event["title"],
                    "description": event["description"], "event_date": event.get("event_date")}
                   for event in game.get("revealed_events", [])],
        "released_signal_timeline": game.get("released_signals", []),
        "price_history": [{"label": row.get("label"), "market_date": row.get("market_date"),
                           "phase": row.get("phase"), "close": row.get("close", row.get("price")),
                           "return_pct": row.get("return_pct")}
                          for row in game.get("price_history", [])],
        "user_fills": [{key: fill.get(key) for key in
                        ("event_id", "phase", "side", "quantity", "price",
                         "rationale", "confidence", "realized_pnl")}
                       for fill in game.get("fills", [])],
        "daily_reflections": [{key: row.get(key) for key in
                               ("market_date", "event_id", "stance", "label", "market_return_pct", "market_summary")}
                              for row in game.get("daily_reflections", [])],
        "agent_rounds": [{"label": row["label"], "market_date": row.get("market_date"),
                          "phase": row.get("phase"), "return_pct": row["return_pct"],
                          "order_imbalance": row["order_imbalance"],
                          "market_pressure": row.get("market_pressure"),
                          "return_components_pct": row.get("return_components_pct", {}),
                          "psychology": _slim_psychology(row.get("psychology", {})),
                          "market_summary": row.get("market_summary", "")}
                         for row in game.get("agent_rounds", [])],
        "quantitative_assessment": base,
    }
    messages = [
        {"role": "system", "content": "한국 주식 교육용 시뮬레이션 분석가다. 결과론적 비난과 투자 권유를 피하고, 이벤트 전후 의사결정 과정을 근거 중심으로 평가한다. World 모드의 사용자는 매수 고려·관찰 계속·매도 고려 판단을 기록하며, 매수·매도 수량은 시장에 영향을 주지 않는 개인 paper portfolio 체결로만 반영된다. daily_reflections와 user_fills의 판단·수량·체결 결과를 다음 시장 결과와 비교한다. 추격 매수, 손실 회피, 확증 편향, 과신, 과도한 매매는 기록에서 확인되는 경우에만 교육적 가설로 설명하고 단정하지 않는다. 입력의 백분율은 이미 % 단위이므로 100을 곱하거나 나누지 말고 그대로 인용한다. 수치를 재계산하지 않는다. 반드시 JSON 객체만 반환한다."},
        {"role": "user", "content": f"""다음 완료된 가상 시나리오를 분석하라.
{json.dumps(context, ensure_ascii=False)}
반환 형식:
{{"executive_summary":"전체 결과 3~5문장","investor_profile":"투자 성향 설명",
"event_reviews":[{{"event":"이벤트명","market_reaction":"시장 반응",
"user_decision":"사용자 전후 판단","lesson":"교육 포인트"}}],
"strengths":["잘한 판단"],"risk_patterns":["주의할 행동"],
"action_plan":["다음 훈련에서 적용할 구체적 원칙"]}}"""},
    ]
    if chat is None:
        from .llm_client import LLMClient
        chat = LLMClient().chat

    report: dict[str, Any] = {}
    missing: list[str] = []
    last_error: Exception | None = None
    for attempt in range(REPORT_ATTEMPTS):
        retry = list(messages)
        if missing:
            # 무엇이 빠졌는지 알려주면 다음 시도에서 대체로 채워 온다.
            retry.append({"role": "user", "content":
                          f"직전 응답에 다음 필수 키가 없었다. 형식을 지켜 모두 포함해 다시 반환하라: {', '.join(missing)}"})
        try:
            raw = chat(retry, temperature=.35, max_tokens=5000,
                       response_format={"type": "json_object"})
            report = _parse_json(raw)
        except Exception as exc:  # noqa: BLE001 - 다음 시도로 넘어가기 위함
            last_error, missing = exc, []
            continue
        missing = [key for key in REQUIRED_REPORT_KEYS if key not in report]
        if not missing:
            break
        last_error = None
    else:
        if last_error is not None:
            raise LLMMarketUnavailable(
                "LLM 종합 투자 보고서 생성에 실패했습니다.") from last_error
        raise LLMMarketUnavailable(
            f"LLM 종합 보고서에 필수 항목이 누락됐습니다: {', '.join(missing)}")
    metrics = base["metrics"]
    report["verified_metrics"] = metrics
    return enforce_verified_report_metrics(report, metrics)
