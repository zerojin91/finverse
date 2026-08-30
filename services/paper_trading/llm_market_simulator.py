"""Daily LLM social-market round for the single-stock paper simulator.

The model interprets only information available before the current session. It
creates Reddit/X observations for the four investor groups; the deterministic
trading engine remains responsible for orders, fills, cash, and price impact.
"""

from __future__ import annotations

from datetime import datetime
import json
from typing import Any, Callable

from .kospi_paper_trading import INVESTOR_GROUPS, TradingError, set_social_signals


GROUP_LABELS = {
    "retail": "개인 투자자",
    "foreign": "외국 기관",
    "institution": "국내 기관",
    "pension": "연기금",
}


class LLMMarketUnavailable(TradingError):
    """Raised when the configured daily LLM market round cannot complete."""


def _pre_open_context(game: dict[str, Any]) -> dict[str, Any]:
    index = game["current_day_index"]
    if index >= len(game["market_days"]):
        raise TradingError("모든 거래일이 이미 처리되었습니다.")
    day = game["market_days"][index]
    prior = game.get("daily_results", [])[-5:]
    previous_close = (prior[-1]["simulated_close"] if prior
                      else game["initial_reference_price"])
    return {
        "ticker": game["ticker"],
        "name": game["name"],
        "trade_date": day["trade_date"],
        "previous_close": previous_close,
        "ontology_market_context": _ontology_market_context(game, day["trade_date"]),
        "known_events": [
            {
                "title": event.get("title", ""),
                "description": event.get("summary") or event.get("description") or "",
                "publisher": event.get("publisher") or event.get("source") or "unknown",
                "impact": event.get("impact"),
            }
            for event in day.get("events", [])
            if event.get("available_before_open") is True
        ],
        "recent_sessions": [
            {
                "trade_date": row["trade_date"],
                "simulated_close": row["simulated_close"],
                "price_impact_pct": row["price_impact_pct"],
                "released_investor_flow": row.get("released_investor_flow", {}),
                "flow_scope": row.get("released_investor_flow_scope", "unknown"),
            }
            for row in prior
        ],
        "personas": [
            {
                "persona_id": persona["persona_id"],
                "investor_group": persona["group"],
                "strategy": persona["strategy"],
                "cash": persona.get("cash", persona["capital"]),
                "quantity": persona.get("quantity", 0),
                "average_price": persona.get("average_price", 0),
                "risk_tolerance": persona["risk_tolerance"],
            }
            for persona in game["personas"]
        ],
    }


def _ontology_market_context(game: dict[str, Any], trade_date: str) -> dict[str, Any]:
    snapshot = game.get("ontology_snapshot") or {}
    return {
        "coverage": game.get("ontology_coverage", {}),
        "indices": [row for row in snapshot.get("index_observations", [])
                    if row.get("trade_date") == trade_date][-4:],
        "macro": [row for row in snapshot.get("macro_observations", [])
                  if row.get("trade_date") == trade_date][:12],
        "social": [row for row in snapshot.get("social_signals", [])
                   if row.get("trade_date") == trade_date][:4],
        "foreign_holding": [row for row in snapshot.get("foreign_holdings", [])
                             if row.get("trade_date") == trade_date][-1:],
    }


def _prompt(context: dict[str, Any]) -> list[dict[str, str]]:
    system = """당신은 한국 주식시장 멀티에이전트 소셜 시뮬레이터다.
현재 장 시작 전에 공개된 정보만 사용한다. 당일 시가·고가·저가·종가와 수급은
절대 추측해서 사실처럼 말하지 않는다. 개인, 외국 기관, 국내 기관, 연기금의
서로 다른 목적과 투자기간을 반영한다. Reddit은 개인적이고 토론적인 문체,
X는 짧고 즉각적인 문체로 쓴다. 각 페르소나의 주문 방향과 자본 배분율도 직접
결정한다. 보유수량이 0이면 매도하지 않는다. 투자 권유가 아닌 모의시장 관찰만 생성한다.
반드시 JSON 객체 하나만 반환한다."""
    user = f"""아래 장전 정보로 오늘의 소셜 시장 라운드를 생성하라.

장전 정보:
{json.dumps(context, ensure_ascii=False)}

반환 스키마:
{{
  "market_summary": "오늘 장전 심리를 설명하는 한국어 1~3문장",
  "risk_flags": ["불확실성 또는 반대 시나리오"],
  "observations": [
    {{
      "investor_group": "retail|foreign|institution|pension",
      "platform": "reddit|x",
      "sentiment": -1.0부터 1.0,
      "engagement": 1부터 10000,
      "content": "해당 페르소나가 실제로 작성한 한국어 게시물",
      "rationale": "장전 정보에 근거한 짧은 판단 근거"
    }}
  ],
  "persona_decisions": [
    {{
      "persona_id": "입력에 주어진 정확한 persona_id",
      "side": "BUY|SELL|HOLD",
      "allocation_pct": 0.0부터 0.05,
      "confidence": 0부터 100,
      "rationale": "장전 정보와 자신의 전략에 근거한 주문 이유"
    }}
  ]
}}

각 투자자 그룹마다 Reddit 1개와 X 1개, 총 8개 observations를 생성하라.
입력에 포함된 모든 persona_id에 대해 정확히 하나씩 persona_decisions를 생성하라.
allocation_pct는 매수 시 현재 현금, 매도 시 현재 보유 평가금액에서 사용할 비율이다."""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _parse_json(raw: str) -> dict[str, Any]:
    text = str(raw or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]).strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise TradingError("LLM 시장 응답이 올바른 JSON이 아닙니다.") from exc
    if not isinstance(value, dict):
        raise TradingError("LLM 시장 응답은 JSON 객체여야 합니다.")
    return value


def _decision_prompt(context: dict[str, Any], social_round: dict[str, Any]) -> list[dict[str, str]]:
    system = """당신은 한국 주식 모의시장의 주문 결정 에이전트다. 입력에 포함된
모든 persona_id에 대해 주문을 하나씩 결정한다. 장전 공개 정보만 사용하고,
보유수량이 0인 페르소나는 SELL을 선택하지 않는다. 반드시 JSON 객체만 반환한다."""
    compact_context = {
        "ticker": context["ticker"], "name": context["name"],
        "trade_date": context["trade_date"], "previous_close": context["previous_close"],
        "known_events": context["known_events"],
        "recent_sessions": context["recent_sessions"],
        "personas": context["personas"],
        "market_summary": social_round.get("market_summary", ""),
        "social_observations": social_round.get("observations", []),
    }
    user = f"""다음 정보로 모든 페르소나의 주문을 결정하라.
{json.dumps(compact_context, ensure_ascii=False)}

반환 형식:
{{"persona_decisions":[{{"persona_id":"정확한 ID","side":"BUY|SELL|HOLD",
"allocation_pct":0.0부터 0.05,"confidence":0부터 100,
"rationale":"전략과 장전 정보에 근거한 이유"}}]}}
입력의 persona_id를 빠짐없이 정확히 한 번씩 반환하라."""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def missing_observation_slots(value: dict[str, Any]) -> list[tuple[str, str]]:
    """Which investor-group/platform posts the model failed to produce.

    The round needs one post per group per platform. Models drop a few of the
    eight often enough that a hard failure here kills otherwise good rounds.
    """
    seen = set()
    for item in value.get("observations") or []:
        if not isinstance(item, dict):
            continue
        group = str(item.get("investor_group", "")).strip().lower()
        platform = str(item.get("platform", "")).strip().lower()
        if (group in INVESTOR_GROUPS and platform in ("reddit", "x")
                and str(item.get("content") or "").strip()):
            seen.add((group, platform))
    return [(group, platform) for group in INVESTOR_GROUPS
            for platform in ("reddit", "x") if (group, platform) not in seen]


def observation_repair_prompt(context: dict[str, Any],
                              missing: list[tuple[str, str]]) -> list[dict[str, str]]:
    """Ask only for the posts that are absent, naming each one."""
    slots = ", ".join(f"{GROUP_LABELS[group]}({group})/{platform}"
                      for group, platform in missing)
    return [
        {"role": "system", "content":
         "한국 주식 멀티에이전트 시장의 소셜 게시물을 작성한다. "
         "요청된 조합만 정확히 채워서 JSON 객체만 반환한다."},
        {"role": "user", "content": f"""시장 정보: {json.dumps(context, ensure_ascii=False)}

직전 응답에서 다음 게시물이 누락됐다. 각 조합마다 정확히 하나씩 작성하라: {slots}

반환 형식:
{{"observations":[{{"investor_group":"retail|foreign|institution|pension",
"platform":"reddit|x","sentiment":-1부터1,"engagement":1부터10000,
"content":"게시물","rationale":"근거"}}]}}"""},
    ]


def _normalize(value: dict[str, Any], persona_ids: set[str]) -> dict[str, Any]:
    observations = []
    seen = set()
    for item in value.get("observations") or []:
        if not isinstance(item, dict):
            continue
        group = str(item.get("investor_group", "")).strip().lower()
        platform = str(item.get("platform", "")).strip().lower()
        if group not in INVESTOR_GROUPS or platform not in ("reddit", "x"):
            continue
        try:
            sentiment = max(-1.0, min(1.0, float(item.get("sentiment", 0))))
            engagement = max(1, min(10_000, int(item.get("engagement", 1))))
        except (TypeError, ValueError):
            continue
        content = str(item.get("content") or "").strip()[:500]
        rationale = str(item.get("rationale") or "").strip()[:500]
        if not content:
            continue
        observations.append({
            "investor_group": group,
            "investor_label": GROUP_LABELS[group],
            "platform": platform,
            "sentiment": round(sentiment, 4),
            "engagement": engagement,
            "content": content,
            "rationale": rationale,
        })
        seen.add((group, platform))
    missing = [(group, platform) for group in INVESTOR_GROUPS
               for platform in ("reddit", "x") if (group, platform) not in seen]
    if missing:
        labels = ", ".join(f"{group}/{platform}" for group, platform in missing)
        raise TradingError(f"LLM 시장 응답에 필수 페르소나 게시물이 누락됐습니다: {labels}")
    decisions = []
    decision_ids = set()
    for item in value.get("persona_decisions") or []:
        if not isinstance(item, dict):
            continue
        persona_id = str(item.get("persona_id") or "").strip()
        side = str(item.get("side") or "").strip().upper()
        if persona_id not in persona_ids or persona_id in decision_ids:
            continue
        if side not in ("BUY", "SELL", "HOLD"):
            continue
        try:
            allocation = max(0.0, min(0.05, float(item.get("allocation_pct", 0))))
            confidence = max(0, min(100, int(item.get("confidence", 50))))
        except (TypeError, ValueError):
            continue
        if side == "HOLD":
            allocation = 0.0
        decisions.append({
            "persona_id": persona_id,
            "side": side,
            "allocation_pct": round(allocation, 5),
            "confidence": confidence,
            "rationale": str(item.get("rationale") or "").strip()[:500],
        })
        decision_ids.add(persona_id)
    missing_personas = sorted(persona_ids - decision_ids)
    if missing_personas:
        raise TradingError(
            f"LLM 시장 응답에 {len(missing_personas)}명의 주문 결정이 누락됐습니다."
        )
    return {
        "market_summary": str(value.get("market_summary") or "").strip()[:1000],
        "risk_flags": [str(flag).strip()[:300] for flag in (value.get("risk_flags") or [])
                       if str(flag).strip()][:5],
        "observations": observations,
        "persona_decisions": decisions,
    }


def run_llm_market_round(
    game: dict[str, Any],
    chat: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """Generate and attach the current day's LLM social observations."""
    context = _pre_open_context(game)
    if chat is None:
        # Lazy import keeps the deterministic engine usable without OpenAI extras.
        from .llm_client import LLMClient
        chat = LLMClient().chat
    try:
        raw = chat(
            _prompt(context), temperature=0.55, max_tokens=7000,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        raise LLMMarketUnavailable(
            "LLM 일별 시장 라운드 생성에 실패했습니다. 서버 연결과 모델 설정을 확인하세요."
        ) from exc
    persona_ids = {persona["persona_id"] for persona in game["personas"]}
    parsed = _parse_json(raw)
    returned_ids = {str(item.get("persona_id") or "") for item in
                    (parsed.get("persona_decisions") or []) if isinstance(item, dict)}
    if returned_ids != persona_ids:
        try:
            decision_raw = chat(
                _decision_prompt(context, parsed), temperature=0.35, max_tokens=7000,
                response_format={"type": "json_object"},
            )
        except Exception as exc:
            raise LLMMarketUnavailable(
                "LLM 페르소나 주문 생성에 실패했습니다. 서버 연결과 모델 설정을 확인하세요."
            ) from exc
        parsed["persona_decisions"] = _parse_json(decision_raw).get("persona_decisions") or []
    result = _normalize(parsed, persona_ids)
    summary = set_social_signals(game, context["trade_date"], result["observations"])
    round_data = {
        **result,
        "trade_date": context["trade_date"],
        "model_generated_at": datetime.now().isoformat(),
        "aggregated_signals": summary,
        "information_phase": "pre_open",
    }
    game.setdefault("llm_market_rounds", {})[context["trade_date"]] = round_data
    game.setdefault("llm_persona_decisions", {})[context["trade_date"]] = {
        decision["persona_id"]: decision for decision in result["persona_decisions"]
    }
    return round_data
