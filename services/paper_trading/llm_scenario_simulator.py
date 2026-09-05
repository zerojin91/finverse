"""LLM orchestration for event-driven market simulations."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from typing import Any, Callable

from .config import Config
from .financial_actions import allowed_actions_for, normalize_financial_action
from .kospi_paper_trading import TradingError
from .llm_market_simulator import (
    LLMMarketUnavailable, _decision_prompt, _normalize, _parse_json,
    missing_observation_slots, observation_repair_prompt,
)


# 누락 게시물 보완 시도 횟수. 대부분 1회에 채워진다.
OBSERVATION_REPAIR_ATTEMPTS = 2
# 페르소나 주문 보완 시도 횟수.
DECISION_REPAIR_ATTEMPTS = 3


def _chat_callable(chat: Callable[..., str] | None) -> Callable[..., str]:
    if chat is not None:
        return chat
    from .llm_client import LLMClient
    return LLMClient().chat


def generate_scenario_events(
    ticker: str, name: str, premise: str, event_count: int = 5,
    chat: Callable[..., str] | None = None,
) -> list[dict[str, Any]]:
    event_count = max(2, min(int(event_count), 10))
    premise = str(premise or "").strip()
    if not premise:
        raise TradingError("시나리오 주제를 입력하세요.")
    messages = [
        {"role": "system", "content": "한국 주식 교육용 시나리오 설계자다. 미래 예측이나 투자 권유가 아니라 가상 사건 연쇄를 만든다. 반드시 JSON 객체만 반환한다."},
        {"role": "user", "content": f"""종목: {name}({ticker})
시나리오 주제: {premise}
서로 인과관계가 있고 호재·악재·불확실성이 섞인 이벤트 {event_count}개를 생성하라.
각 이벤트 전에는 결과를 누설하지 않는 pre_brief와, 시간이 흐르며 공개될 선행 신호가 필요하다.
선행 신호에는 확정 결과·정답·실제 이벤트 description을 절대 누설하지 말고 일정, 루머, 기대, 관측치만 담아라.
반환 형식: {{"events":[{{"pre_brief":"예정 일정 안내","title":"공개 후 제목",
"description":"공개될 구체적 내용","trading_days_until":2부터 10,
"direction":-1부터1,"severity":0부터1,"surprise":0부터1,"persistence_days":1부터10,
"lead_signals":[{{"days_before":1부터 trading_days_until,"channel":"schedule|news|rumor|market_expectation",
"audience":"all|retail|foreign|institution|pension","reliability":0부터1,"content":"결과를 누설하지 않는 신호"}}]}}]}}"""},
    ]
    try:
        raw = _chat_callable(chat)(messages, temperature=.65, max_tokens=4000,
                                   response_format={"type": "json_object"})
    except Exception as exc:
        raise LLMMarketUnavailable("LLM 시나리오 이벤트 생성에 실패했습니다.") from exc
    parsed = _parse_json(raw)
    events = parsed.get("events") or []
    if len(events) != event_count:
        raise TradingError(f"LLM이 요청한 {event_count}개의 이벤트를 생성하지 못했습니다.")
    return events


def _round_context(game: dict[str, Any], event: dict[str, Any], phase: str,
                   round_number: int, market_date: str | None = None,
                   visible_signals: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    context = {
        "ticker": game["ticker"], "name": game["name"],
        "trade_date": market_date or event.get("event_date") or f"scenario-{event['sequence']}-{phase}-{round_number}",
        "previous_close": game["current_price"],
        "ontology_market_context": _ontology_context(game, market_date),
        "phase": phase,
        "recent_sessions": [{"label": row["label"], "price": row["price"],
                             "return_pct": row.get("return_pct", 0)}
                            for row in game["price_history"][-5:]],
        "persistent_market_psychology": {
            "aggregate_sentiment": game.get("market_psychology", {}).get("aggregate_sentiment", 0),
            "event_regime": game.get("market_psychology", {}).get("event_regime", {}),
            "groups": {group: {key: value for key, value in state.items() if key != "memory"}
                       for group, state in game.get("market_psychology", {}).get("groups", {}).items()},
        },
        "personas": [{"persona_id": p["persona_id"], "investor_group": p["group"],
                      "strategy": p["strategy"], "cash": p["cash"],
                      "quantity": p["quantity"], "average_price": p["average_price"],
                      "risk_tolerance": p["risk_tolerance"],
                      "persistent_sentiment": game.get("market_psychology", {}).get(
                          "groups", {}).get(p["group"], {}).get("sentiment", 0),
                      "persistent_risk_aversion": game.get("market_psychology", {}).get(
                          "groups", {}).get(p["group"], {}).get("risk_aversion", 0)}
                     for p in game["personas"]],
    }
    if phase == "event_reaction":
        context["event"] = {"title": event["title"], "description": event["description"],
                            "direction": event.get("direction"),
                            "severity": event.get("severity"),
                            "surprise": event.get("surprise"),
                            "persistence_days": event.get("persistence_days")}
        context["known_events"] = [{"title": event["title"], "description": event["description"]}]
    else:
        context["upcoming_event"] = {"event_date": event["event_date"],
                                     "pre_brief": event["pre_brief"]}
        context["released_signals"] = visible_signals or []
        context["information_boundary"] = "이 목록 외 미래 사건의 결과는 알려지지 않음"
    return context


def _ontology_context(game: dict[str, Any], market_date: str | None) -> dict[str, Any]:
    """Expose only date-matched normalized observations to the LLM."""
    snapshot = game.get("ontology_snapshot") or {}
    date_key = market_date or ""
    return {
        "coverage": game.get("ontology_coverage", {}),
        "indices": [row for row in snapshot.get("index_observations", [])
                    if row.get("trade_date") == date_key][-4:],
        "macro": [row for row in snapshot.get("macro_observations", [])
                  if row.get("trade_date") == date_key][:12],
        "social": [row for row in snapshot.get("social_signals", [])
                   if row.get("trade_date") == date_key][:4],
        "foreign_holding": [row for row in snapshot.get("foreign_holdings", [])
                             if row.get("trade_date") == date_key][-1:],
    }


def run_scenario_agent_round(
    game: dict[str, Any], event: dict[str, Any], phase: str, round_number: int = 1,
    market_date: str | None = None,
    visible_signals: list[dict[str, Any]] | None = None,
    chat: Callable[..., str] | None = None,
) -> dict[str, Any]:
    context = _round_context(game, event, phase, round_number, market_date, visible_signals)
    phase_instruction = ("이벤트가 방금 공개된 직후의 1차 반응" if phase == "event_reaction"
                         else "이벤트 전 거래일의 자율거래. 당일까지 공개된 신호만 사용하고 미래 결과를 추측 사실처럼 쓰지 말 것")
    messages = [
        {"role": "system", "content": "당신은 한국 주식 MiroFish형 멀티에이전트 시장이다. 모든 페르소나는 자신의 전략·포트폴리오와 누적된 심리 상태에 따라 직접 주문한다. 이전 이벤트 심리는 다음 사건과 같은 방향이면 강화되고 반대면 상쇄 또는 반전되며 시간에 따라 감쇠한다. 반드시 JSON 객체만 반환한다."},
        {"role": "user", "content": f"""단계: {phase_instruction}
시장 정보: {json.dumps(context, ensure_ascii=False)}
개인·외국 기관·국내 기관·연기금마다 Reddit/X 게시물 1개씩 총 8개와,
모든 persona_id의 주문을 생성하라.
반환 형식:
{{"market_summary":"시장 상황", "risk_flags":["반대 가능성"],
"observations":[{{"investor_group":"retail|foreign|institution|pension",
"platform":"reddit|x","sentiment":-1부터1,"engagement":1부터10000,
"content":"게시물","rationale":"근거"}}],
"persona_decisions":[{{"persona_id":"정확한 ID","side":"BUY|SELL|HOLD",
"allocation_pct":0부터0.05,"confidence":0부터100,"rationale":"주문 근거"}}]}}"""},
    ]
    call = _chat_callable(chat)
    try:
        raw = call(messages, temperature=.55, max_tokens=7000,
                   response_format={"type": "json_object"})
    except Exception as exc:
        raise LLMMarketUnavailable("LLM 시나리오 시장 라운드 생성에 실패했습니다.") from exc
    parsed = _parse_json(raw)
    persona_ids = {persona["persona_id"] for persona in game["personas"]}

    def returned_ids() -> set[str]:
        return {str(row.get("persona_id") or "") for row in
                (parsed.get("persona_decisions") or []) if isinstance(row, dict)}

    # 주문도 게시물과 같다. 한 번의 보완 호출이 실패하면 라운드 전체가 죽었다.
    # 실패 원인은 대개 일시적인 형식 오류라 몇 번 더 시도할 값어치가 있다.
    last_error: Exception | None = None
    for attempt in range(DECISION_REPAIR_ATTEMPTS):
        if returned_ids() == persona_ids:
            break
        try:
            repair = call(_decision_prompt(context, parsed), temperature=.35, max_tokens=7000,
                          response_format={"type": "json_object"})
            parsed["persona_decisions"] = _parse_json(repair).get("persona_decisions") or []
            last_error = None
        except Exception as exc:  # noqa: BLE001 - 다음 시도로 넘어가기 위함
            last_error = exc
    if last_error is not None:
        raise LLMMarketUnavailable("LLM 시나리오 주문 생성에 실패했습니다.") from last_error

    # 보완을 다 쓰고도 빠진 페르소나는 관망으로 채운다. 거래를 지어내지 않으면서
    # 60초 넘게 돌린 라운드가 한 명 때문에 통째로 버려지는 것을 막는다.
    # 채워 넣은 사실은 라운드의 risk_flags에 남겨 눈에 보이게 한다.
    filled = sorted(persona_ids - returned_ids())
    if filled:
        parsed.setdefault("persona_decisions", []).extend(
            {"persona_id": persona_id, "side": "HOLD", "allocation_pct": 0,
             "confidence": 0, "rationale": "모델이 이 페르소나의 주문을 반환하지 않아 관망 처리"}
            for persona_id in filled)
        parsed["risk_flags"] = [*(parsed.get("risk_flags") or []),
                                f"페르소나 {len(filled)}명의 주문이 생성되지 않아 관망으로 처리됐습니다."]

    # 8개 게시물(4그룹 × 2플랫폼) 중 빠진 것만 지목해 다시 받는다. 주문과 달리
    # 여기에는 보완 경로가 없어서, 한 칸만 빠져도 멀쩡한 라운드가 통째로
    # 실패했다("필수 페르소나 게시물이 누락됐습니다").
    for _ in range(OBSERVATION_REPAIR_ATTEMPTS):
        missing = missing_observation_slots(parsed)
        if not missing:
            break
        try:
            repair = call(observation_repair_prompt(context, missing),
                          temperature=.4, max_tokens=2500,
                          response_format={"type": "json_object"})
        except Exception as exc:
            raise LLMMarketUnavailable("LLM 페르소나 게시물 보완에 실패했습니다.") from exc
        recovered = _parse_json(repair).get("observations") or []
        parsed["observations"] = (parsed.get("observations") or []) + recovered
    return _normalize(parsed, persona_ids)


def _individual_round_context(
    game: dict[str, Any], persona: dict[str, Any], market_date: str,
    world_information: dict[str, Any],
) -> dict[str, Any]:
    """Expose one agent's private state plus the same public world to it.

    No other agent's portfolio or same-round decision appears here.  This is
    the key distinction from the older aggregate JSON prompt.
    """
    group_state = ((game.get("market_psychology") or {}).get("groups") or {}).get(persona["group"], {})
    return {
        "ticker": game["ticker"], "name": game["name"], "trade_date": market_date,
        "previous_close": game["current_price"],
        "recent_sessions": [{"date": row.get("market_date"), "return_pct": row.get("return_pct", 0), "price": row.get("price")}
                            for row in game.get("price_history", [])[-5:]],
        "public_world": world_information,
        "group_state": {key: value for key, value in group_state.items() if key != "memory"},
        "agent": {
            "persona_id": persona["persona_id"], "group": persona["group"],
            "role": persona.get("role_key") or persona.get("strategy"),
            "profile": persona.get("profile") or {},
            "cash": persona["cash"], "quantity": persona["quantity"],
            "average_price": persona["average_price"], "realized_pnl": persona.get("realized_pnl", 0),
            "memory": (persona.get("memory") or [])[-8:],
            "allowed_actions": allowed_actions_for(persona),
        },
    }


def _individual_decision_messages(context: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": "당신은 한국 개별 종목 교육용 시뮬레이션의 독립 투자 에이전트 한 명이다. 공개된 정보와 자신의 프로필·자산·기억만 근거로 판단한다. 다른 에이전트의 주문을 알 수 없으며, 미래 사실·가격 예측·투자 권유를 만들지 않는다. 허용된 금융 액션만 선택하고 반드시 JSON 객체 하나만 반환한다."},
        {"role": "user", "content": f"""{json.dumps(context, ensure_ascii=False)}
반환 형식:
{{"action_type":"허용 액션 하나","side":"BUY|SELL|HOLD","allocation_pct":0부터0.05,
"confidence":0부터100,"sentiment":-1부터1,"rationale":"현재 판단 근거","memory_note":"다음 거래일에 남길 짧은 기억"}}
"""},
    ]


def _scheduled_hold(persona: dict[str, Any], reason: str) -> dict[str, Any]:
    return normalize_financial_action({
        "action_type": "HOLD", "side": "HOLD", "allocation_pct": 0,
        "confidence": 0, "sentiment": 0, "rationale": reason,
        "memory_note": reason,
    }, persona) | {"decision_source": "scheduled_hold"}


def _agent_is_active(persona: dict[str, Any], game: dict[str, Any], world_information: dict[str, Any]) -> bool:
    frequency = str(persona.get("activity_frequency") or "medium")
    event = world_information.get("event")
    if frequency == "low":
        # 연기금은 중요한 사건 또는 5거래일 단위의 전략 점검 때만 LLM 행동한다.
        return bool(event) or int((game.get("world") or {}).get("current_day") or 0) % 5 == 0
    return True


def _run_individual_decision(
    game: dict[str, Any], persona: dict[str, Any], market_date: str,
    world_information: dict[str, Any], chat: Callable[..., str] | None,
) -> dict[str, Any]:
    if not _agent_is_active(persona, game, world_information):
        return _scheduled_hold(persona, "저빈도 전략 일정상 이번 거래일은 관망합니다.")
    context = _individual_round_context(game, persona, market_date, world_information)
    try:
        raw = _chat_callable(chat)(
            _individual_decision_messages(context), temperature=.45, max_tokens=850,
            response_format={"type": "json_object"},
        )
        parsed = _parse_json(raw)
        decision = normalize_financial_action(parsed, persona)
        return {**decision, "decision_source": "llm"}
    except Exception as exc:  # 개별 실패는 전체 시장의 실패가 아니다.
        return _scheduled_hold(persona, "개별 판단 호출에 실패해 안전하게 관망합니다.") | {"decision_error": str(exc)[:300]}


def run_individual_agent_round(
    game: dict[str, Any], *, market_date: str, world_information: dict[str, Any],
    phase: str = "inter_event", chat: Callable[..., str] | None = None,
    progress: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    """Run independent LLM decisions, one request per active market agent.

    Worker concurrency is a transport concern only.  Each future carries one
    persona and one private context; results are gathered after all calls so
    no same-day order can leak into another agent's prompt.
    """
    personas = list(game.get("personas") or [])
    decisions: list[dict[str, Any] | None] = [None] * len(personas)
    workers = max(1, min(int(Config.AGENT_ACTION_PARALLEL_COUNT), 8))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="agent-action") as executor:
        futures = {
            executor.submit(_run_individual_decision, game, persona, market_date, world_information, chat): index
            for index, persona in enumerate(personas)
        }
        completed = 0
        for future in as_completed(futures):
            index = futures[future]
            decisions[index] = future.result()
            completed += 1
            if progress:
                progress(completed, len(personas), personas[index]["persona_id"])

    normalized = [decision for decision in decisions if decision]
    observations = [{
        "investor_group": persona["group"], "platform": "market",
        "sentiment": decision.get("sentiment", 0),
        "engagement": max(1, int(decision.get("confidence", 0)) * 10),
        "content": decision.get("rationale", ""), "rationale": decision.get("rationale", ""),
    } for persona, decision in zip(personas, normalized)]
    failures = sum(1 for row in normalized if row.get("decision_error"))
    event = world_information.get("event") or {}
    return {
        "market_summary": str(event.get("description") or "공개된 시장 환경 아래 개별 에이전트가 독립 판단했습니다."),
        "risk_flags": ([f"에이전트 {failures}명의 LLM 판단이 실패해 안전 관망 처리됐습니다."] if failures else []),
        "observations": observations,
        "persona_decisions": normalized,
        "context_mode": "individual_agent_world",
        "phase": phase,
    }
