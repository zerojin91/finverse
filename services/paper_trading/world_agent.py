"""Stateful external environment for FINVERSE world-mode simulations.

The World Agent is deliberately not an investor.  It owns public information,
event timing and the append-only memory of simulated days.  Agent orders feed
back only into the next day's market state; they never rewrite an exogenous
event's facts.
"""

from __future__ import annotations

from datetime import date, timedelta
import hashlib
import json
from typing import Any
import uuid

from .llm_client import LLMClient


WORLD_SCHEMA_VERSION = "world-agent-v1"


def _unit(seed: str, salt: str) -> float:
    digest = hashlib.sha256(f"{seed}|{salt}".encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF


def _next_business_day(value: date) -> date:
    value += timedelta(days=1)
    while value.weekday() >= 5:
        value += timedelta(days=1)
    return value


def _as_date(value: Any) -> date:
    return date.fromisoformat(str(value)[:10])


def _analogue_events(history: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for day in history.get("market_days") or []:
        for index, event in enumerate(day.get("events") or []):
            title = str(event.get("title") or "").strip()
            if not title:
                continue
            scope = str(event.get("scope") or "market")
            # 방어선: 이전 캐시나 외부 입력에 타사 뉴스가 있어도 World Agent의
            # 유사 사례 후보로 승격시키지 않는다.
            if scope not in {"security", "market", "micro", "macro"}:
                continue
            result.append({
                "analogue_id": f"analogue:{day.get('trade_date')}:{index}",
                "date": str(day.get("trade_date") or ""), "title": title,
                "summary": str(event.get("summary") or "").strip(),
                "scope": scope,
                "event_types": [str(item) for item in (event.get("event_types") or [])],
                "source_score": float(event.get("source_score") or 0),
            })
    return sorted(result, key=lambda item: (item["source_score"], item["date"]), reverse=True)[:80]


def build_world_state(history: dict[str, Any], initial_context: dict[str, Any], simulation_days: int) -> dict[str, Any]:
    market_days = history.get("market_days") or []
    last = market_days[-1] if market_days else {}
    as_of = str(last.get("trade_date") or (initial_context.get("source_summary") or {}).get("as_of", {}).get("latest_market_date") or "")
    start = _next_business_day(_as_date(as_of)) if as_of else date.today()
    analysis = initial_context.get("analysis") or {}
    recent = market_days[-30:]
    first_close = float((recent[0] if recent else {}).get("close") or 0)
    last_close = float((recent[-1] if recent else {}).get("close") or 0)
    change = ((last_close / first_close - 1) * 100) if first_close else 0.0
    social = history.get("social_signals") or []
    sentiments = [float(row.get("sentiment")) for row in social[-30:]
                  if row.get("sentiment") is not None]
    active_momentum = max(-1.0, min(1.0, change / 12.0))
    return {
        "schema_version": WORLD_SCHEMA_VERSION,
        "calendar_type": "KOSPI_WEEKDAY_POC",
        "as_of_date": as_of,
        "simulation_start_date": start.isoformat(),
        "simulation_days": int(simulation_days),
        "current_day": 0,
        "next_market_date": start.isoformat(),
        "state": {
            "momentum": round(active_momentum, 4),
            "volatility": .35 + min(.45, abs(active_momentum) * .35),
            "liquidity": .65,
            "risk_appetite": round(max(-1.0, min(1.0, active_momentum * .55)), 4),
            "community_sentiment": round(sum(sentiments) / len(sentiments), 4) if sentiments else None,
            "macro_regime": (analysis.get("economy") or {}).get("condition", "혼조"),
        },
        "active_event": None,
        "analogue_events": _analogue_events(history),
        "memory": {
            "initial_context_id": initial_context.get("context_id"),
            "initial_summary_points": (analysis.get("summary_points") or [])[:5],
            "active_momenta": (analysis.get("tensions") or [])[:5],
            "event_ledger": [],
            "daily_ledger": [],
        },
    }


def _event_type(world: dict[str, Any], game_id: str, market_date: str) -> str | None:
    state = world["state"]
    seed = f"{game_id}:{market_date}:{world['current_day']}"
    # 계절성은 분기 말에만 후보가 된다. 다른 사건은 고정 수가 아니라 hazard다.
    value = _as_date(market_date)
    if value.month in (3, 6, 9, 12) and value.day >= 20 and _unit(seed, "seasonal") < .35:
        return "seasonal"
    if abs(float(state.get("momentum") or 0)) >= .23 and _unit(seed, "momentum") < .18:
        return "momentum"
    if _unit(seed, "surprise") < .035:
        return "surprise"
    return None


def _retrieve_analogue(world: dict[str, Any], event_type: str, seed: str) -> dict[str, Any] | None:
    candidates = list(world.get("analogue_events") or [])
    if not candidates:
        return None
    keywords = {
        "seasonal": ("실적", "금리", "결정", "분기", "배당", "리밸런싱"),
        "momentum": ("수주", "상향", "하향", "전망", "공급", "수요", "전쟁", "규제"),
        "surprise": ("기습", "충격", "신용", "제재", "사고", "급등", "급락"),
    }[event_type]
    matched = [row for row in candidates if any(word in f"{row['title']} {row['summary']}" for word in keywords)]
    pool = matched or candidates
    return pool[min(len(pool) - 1, int(_unit(seed, "analogue") * len(pool)))]


def _fallback_event(event_type: str, analogue: dict[str, Any], world: dict[str, Any], market_date: str) -> dict[str, Any]:
    state = world["state"]
    title = analogue["title"]
    prefix = {"momentum": "기존 모멘텀과 유사한 후속 흐름", "seasonal": "정기 일정과 유사한 관측", "surprise": "과거 충격 사례와 유사한 불확실성"}[event_type]
    return {
        "title": f"{prefix}: {title}",
        "description": f"시작 시점 이전에 관측된 유사 사례를 바탕으로 구성한 가상 이벤트입니다. 현재 시장의 모멘텀 {state['momentum']:+.2f}와 변동성 {state['volatility']:.2f} 조건에서 정보 해석과 수급 반응이 엇갈릴 수 있습니다.",
        "public_signal": "초기 신호가 공개됐으며, 실제 미래 사실이나 가격 예측이 아닌 교육용 가상 전개입니다.",
        "impact_score": .72 if event_type == "surprise" else .58 if event_type == "momentum" else .52,
    }


def _event_messages(event_type: str, analogue: dict[str, Any], world: dict[str, Any], market_date: str) -> list[dict[str, str]]:
    payload = {
        "event_type": event_type, "market_date": market_date,
        "world_state": world.get("state"), "analogue": analogue,
        "constraints": "유사 실제 사례를 미래 사실처럼 복사하지 말고, 현재 가상 환경에 맞는 교육용 사건으로만 바꾼다.",
    }
    return [
        {"role": "system", "content": "당신은 한국 주식 교육용 시뮬레이션의 World Agent다. 실제 과거 유사 사례를 근거로만 가상 사건을 구성한다. 미래 실제 사실·가격 예측·투자 권유를 만들지 않는다. 반드시 JSON 객체 하나만 반환한다."},
        {"role": "user", "content": f"""{json.dumps(payload, ensure_ascii=False)}
반환 형식: {{"title":"가상 사건 제목","description":"2문장 설명","public_signal":"사용자와 에이전트에게 공개할 신호","impact_score":0부터1}}
"""},
    ]


def _generate_event(event_type: str, analogue: dict[str, Any], world: dict[str, Any], market_date: str) -> dict[str, Any]:
    fallback = _fallback_event(event_type, analogue, world, market_date)
    try:
        raw = LLMClient().chat_json(_event_messages(event_type, analogue, world, market_date), temperature=.45, max_tokens=850)
        impact = max(.1, min(1.0, float(raw.get("impact_score") or fallback["impact_score"])))
        return {
            "title": str(raw.get("title") or fallback["title"]).strip()[:180],
            "description": str(raw.get("description") or fallback["description"]).strip()[:1000],
            "public_signal": str(raw.get("public_signal") or fallback["public_signal"]).strip()[:500],
            "impact_score": round(impact, 3), "generation_source": "openrouter",
        }
    except Exception:
        return {**fallback, "generation_source": "grounded_fallback"}


def advance_environment(game: dict[str, Any]) -> dict[str, Any]:
    """Open one new world day and, if warranted, publish a public event."""
    world = game["world"]
    if int(world["current_day"]) >= int(world["simulation_days"]):
        game["phase"] = "completed"
        game["status"] = "completed"
        return {"completed": True, "market_date": world["next_market_date"], "event": None}
    market_date = str(world["next_market_date"])
    world["current_day"] += 1
    event_type = _event_type(world, game["game_id"], market_date)
    event = None
    if event_type and not world.get("active_event"):
        analogue = _retrieve_analogue(world, event_type, f"{game['game_id']}:{market_date}")
        if analogue:
            generated = _generate_event(event_type, analogue, world, market_date)
            event = {
                "event_id": f"world_evt_{uuid.uuid4().hex[:10]}", "sequence": len(world["memory"]["event_ledger"]) + 1,
                "event_date": market_date, "event_type": event_type, "stage": "public", "status": "revealed",
                "is_simulated": True, "analogue_event_ids": [analogue["analogue_id"]],
                "analogue_title": analogue["title"], "persistence_days": 1 if event_type == "surprise" else 2,
                "direction": None, "severity": generated["impact_score"], "surprise": .8 if event_type == "surprise" else .35,
                **generated,
            }
            world["active_event"] = event
            world["memory"]["event_ledger"].append({**event, "lifecycle": ["public"]})
    return {"completed": False, "market_date": market_date, "event": event}


def public_world_information(game: dict[str, Any], market_date: str) -> dict[str, Any]:
    world = game["world"]
    event = world.get("active_event")
    return {
        "market_date": market_date,
        "world_state": dict(world.get("state") or {}),
        "event": {key: value for key, value in event.items() if key not in ("direction",)} if event else None,
        "public_signals": [event["public_signal"]] if event else ["새로운 중대 사건은 공개되지 않았습니다. 현재 공개된 가격·수급·거시 환경을 기준으로 판단합니다."],
    }


def record_market_feedback(game: dict[str, Any], round_result: dict[str, Any], market_date: str) -> None:
    world = game["world"]
    state = world["state"]
    return_pct = float(round_result.get("return_pct") or 0)
    imbalance = float(round_result.get("order_imbalance") or 0)
    state["momentum"] = round(max(-1.0, min(1.0, .72 * float(state.get("momentum") or 0) + .28 * (return_pct / 8))), 4)
    state["volatility"] = round(max(.05, min(1.0, .78 * float(state.get("volatility") or .35) + .22 * min(1.0, abs(return_pct) / 8))), 4)
    state["liquidity"] = round(max(.05, min(1.0, .72 * float(state.get("liquidity") or .65) + .28 * (1 - abs(imbalance)))), 4)
    state["risk_appetite"] = round(max(-1.0, min(1.0, .7 * float(state.get("risk_appetite") or 0) + .3 * imbalance)), 4)
    world["memory"]["daily_ledger"].append({
        "market_date": market_date, "price": round_result.get("price"), "return_pct": return_pct,
        "order_imbalance": imbalance, "state_after": dict(state),
    })
    if world.get("active_event"):
        active = world["active_event"]
        active["stage"] = "absorbed"
        for item in reversed(world["memory"]["event_ledger"]):
            if item["event_id"] == active["event_id"]:
                item.setdefault("lifecycle", []).append("absorbed")
                item["market_reaction"] = {"return_pct": return_pct, "order_imbalance": imbalance}
                break
        game.setdefault("revealed_events", []).append(dict(active))
        world["active_event"] = None
    current = _as_date(market_date)
    world["next_market_date"] = _next_business_day(current).isoformat()
