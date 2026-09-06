"""Generate and cache individual, evidence-grounded market-agent profiles.

The profile is a durable simulation input, not a one-off UI card.  Each agent
gets its own LLM call and keeps the generated thesis, blind spots and action
bounds for the whole game.  Group policy is code-owned so the model cannot
turn a pension into a day trader merely because a prompt is noisy.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Any, Callable

from .config import Config
from .kospi_paper_trading import TradingError
from .llm_client import LLMClient


AGENT_PROFILE_SCHEMA_VERSION = "market-agent-profiles-v1"
AGENT_PROFILE_CACHE_TTL_SECONDS = 12 * 60 * 60
AGENT_GROUP_COUNTS = {"retail": 40, "foreign": 6, "institution": 12, "pension": 1}

# 사용자와 합의한 수급 주체 규칙이다. 프롬프트 참고 문구가 아니라 프로필
# 정규화와 주문 검증에 함께 쓰는 불변 정책이다.
GROUP_POLICY: dict[str, dict[str, Any]] = {
    "retail": {
        "label": "개인 투자자", "count": 40, "capital": 100_000_000,
        "allocation": .20, "risk_range": (.25, .82), "frequency": "high",
        "market_impact": "low",
        "description": "서로 다른 단일 편향을 가진 소규모 참여자 다수. 하나의 신호에 치우쳐 단기 노이즈를 만든다.",
        "allowed_actions": ["HOLD", "BUILD_POSITION", "REDUCE_POSITION", "EXIT_POSITION", "CHASE_MOMENTUM", "PANIC_EXIT", "AVERAGE_DOWN", "WAIT_FOR_CONFIRMATION"],
    },
    "foreign": {
        "label": "외국인", "count": 6, "capital": 30_000_000_000,
        "allocation": .38, "risk_range": (.35, .68), "frequency": "medium",
        "market_impact": "high",
        "description": "공통 거시 방향을 공유하는 대형 수급 주체. 환율·글로벌 위험선호·대형주 비중을 종합하고 방향성은 수 거래일 이상 유지한다.",
        "allowed_actions": ["HOLD", "BUILD_POSITION", "REDUCE_POSITION", "EXIT_POSITION", "MACRO_ROTATE", "FX_HEDGE", "RISK_OFF", "WAIT_FOR_CONFIRMATION"],
    },
    "institution": {
        "label": "기관", "count": 12, "capital": 20_000_000_000,
        "allocation": .42, "risk_range": (.30, .72), "frequency": "medium",
        "market_impact": "medium",
        "description": "액티브 운용, ETF/ETN·패시브, 리밸런싱·헤지 목적이 섞여 통일된 방향을 강제하지 않는 금융 투자 주체다.",
        "allowed_actions": ["HOLD", "BUILD_POSITION", "REDUCE_POSITION", "EXIT_POSITION", "REBALANCE", "SECTOR_ROTATE", "ETF_FLOW_SYNC", "HEDGE_RISK", "WAIT_FOR_CONFIRMATION"],
    },
    "pension": {
        "label": "연기금", "count": 1, "capital": 50_000_000_000,
        "allocation": .58, "risk_range": (.55, .78), "frequency": "low",
        "market_impact": "very_high",
        "description": "단일 대형·저빈도 자금 운용 주체. 안정 운용을 우선하고, 정기 리밸런싱 또는 고변동성 위험 축소 때만 큰 주문을 낸다.",
        "allowed_actions": ["HOLD", "BUILD_POSITION", "REDUCE_POSITION", "STRATEGIC_REBALANCE", "VOLATILITY_DELEVERAGE", "HEDGE_RISK", "WAIT_FOR_CONFIRMATION"],
    },
}

ROLE_CATALOG = {
    "retail": [
        ("momentum_chaser", "가격 돌파와 거래량 증가를 우선 보는 모멘텀 추격자", "모멘텀"),
        ("news_reactor", "헤드라인과 사건의 첫 인상에 빠르게 반응하는 뉴스 반응자", "뉴스 반응"),
        ("loss_averse", "손실 회피가 강해 하락 시 축소를 서두르는 참여자", "손실 회피"),
        ("value_anchor", "가격 수준만 보고 반등을 기대하는 가치 고정형 참여자", "가치 고정"),
        ("community_echo", "커뮤니티 관심과 감성 변화를 과대평가하는 참여자", "커뮤니티 반향"),
        ("contrarian", "급등락 직후 되돌림만 보는 역추세 참여자", "역추세"),
        ("averager", "기존 보유 가격을 기준으로 물타기를 고려하는 참여자", "평단 고정"),
        ("technical_breakout", "단기 가격 흐름과 변동성만 보는 기술적 참여자", "기술적 돌파"),
    ],
    "foreign": [
        ("global_macro_core", "글로벌 금리와 위험선호를 종합하는 코어 자금", "글로벌 거시"),
        ("fx_allocator", "원화·달러 흐름을 중심으로 비중을 조절하는 자금", "환율"),
        ("largecap_allocator", "대형주 상대가치와 글로벌 동종업계를 보는 자금", "글로벌 대형주"),
        ("risk_off_hedger", "변동성 확대 시 위험 노출을 먼저 줄이는 헤지 자금", "리스크 오프"),
        ("cross_border_flow", "국가 간 자금 흐름과 지수 편입 비중을 보는 자금", "크로스보더 수급"),
        ("relative_value", "시장 대비 상대 수익률과 밸류에이션 차이를 보는 자금", "상대가치"),
    ],
    "institution": [
        ("active_fund", "종목 펀더멘털과 과열·과매도를 함께 보는 액티브 운용", "액티브 운용"),
        ("etf_etn_flow", "지수와 섹터 연동을 종목에 전달하는 ETF/ETN 자금", "ETF/ETN"),
        ("rebalance_hedge", "목표 비중과 위험 한도를 맞추는 리밸런싱·헤지 자금", "리밸런싱"),
    ],
    "pension": [
        ("national_pension", "장기 안정 운용을 우선하는 연기금 전략 자금", "장기·저빈도"),
    ],
}


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))


def _unit(seed: str, salt: str) -> float:
    digest = hashlib.sha256(f"{seed}|{salt}".encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF


def _cache_path(context_id: str) -> Path:
    safe = context_id.removeprefix("ctx_")
    if not safe or not safe.isalnum():
        raise TradingError("올바르지 않은 초기 맥락 ID입니다.")
    root = Path(Config.UPLOAD_FOLDER) / "market_cache"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"agent-profiles-{safe}-{AGENT_PROFILE_SCHEMA_VERSION}.json"


def _read_cache(path: Path) -> dict[str, Any] | None:
    try:
        if time.time() - path.stat().st_mtime > AGENT_PROFILE_CACHE_TTL_SECONDS:
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def _write_cache(path: Path, value: dict[str, Any]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".agent-profiles-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        Path(temporary).replace(path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def clear_agent_profile_cache(context_id: str) -> bool:
    path = _cache_path(context_id)
    existed = path.exists()
    path.unlink(missing_ok=True)
    return existed


def get_cached_agent_profiles(context_id: str) -> dict[str, Any] | None:
    return _read_cache(_cache_path(context_id))


def _last_price(context: dict[str, Any]) -> int:
    days = ((context.get("source") or {}).get("market") or {}).get("recent_days") or []
    try:
        return max(1, int(float(days[-1].get("close") or 0)))
    except (IndexError, TypeError, ValueError):
        return 1


def _profile_seed(context_id: str, group: str, index: int) -> str:
    return f"{context_id}:{group}:{index}:{AGENT_PROFILE_SCHEMA_VERSION}"


def _specs(context_id: str, initial_price: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for group, policy in GROUP_POLICY.items():
        catalog = ROLE_CATALOG[group]
        low, high = policy["risk_range"]
        for index in range(policy["count"]):
            seed = _profile_seed(context_id, group, index)
            role_key, role_description, bias = catalog[index % len(catalog)]
            base_capital = int(policy["capital"] * (.78 + .44 * _unit(seed, "capital")))
            allocation = max(.02, min(.85, policy["allocation"] + (_unit(seed, "allocation") - .5) * .18))
            quantity = int(base_capital * allocation / max(1, initial_price))
            persona_id = f"{group}_{index + 1:03d}"
            result.append({
                "persona_id": persona_id,
                "agent_id": persona_id,
                "group": group,
                "group_label": policy["label"],
                "role_key": role_key,
                "role_description": role_description,
                "bias_seed": bias,
                "strategy": role_key,
                "capital": base_capital,
                "risk_tolerance": round(low + (high - low) * _unit(seed, "risk"), 3),
                "trend_sensitivity": round(.2 + .75 * _unit(seed, "trend"), 3),
                "event_sensitivity": round(.2 + .75 * _unit(seed, "event"), 3),
                "flow_sensitivity": round(.2 + .75 * _unit(seed, "flow"), 3),
                "cash": base_capital - quantity * initial_price,
                "quantity": quantity,
                "average_price": initial_price,
                "realized_pnl": 0,
                "platforms": [],
                "social_influence": 0.0,
                "allowed_actions": list(policy["allowed_actions"]),
                "activity_frequency": policy["frequency"],
                "market_impact_tier": policy["market_impact"],
            })
    return result


def _prompt(initial_context: dict[str, Any], spec: dict[str, Any]) -> list[dict[str, str]]:
    analysis = initial_context.get("analysis") or {}
    source_summary = initial_context.get("source_summary") or {}
    policy = GROUP_POLICY[spec["group"]]
    payload = {
        "target_security": {
            "ticker": source_summary.get("ticker"), "name": source_summary.get("name"),
            "as_of": (source_summary.get("as_of") or {}).get("latest_market_date"),
        },
        "initial_market_context": {
            "summary_points": (analysis.get("summary_points") or [])[:5],
            "risk_factors": (analysis.get("risk_factors") or [])[:5],
            "watch_points": (analysis.get("watch_points") or [])[:5],
            "event_sequence": (analysis.get("event_sequence") or [])[:6],
            "document_previews": (source_summary.get("document_previews") or {}),
        },
        "group_policy": {
            "label": policy["label"], "description": policy["description"],
            "activity_frequency": policy["frequency"], "market_impact": policy["market_impact"],
            "allowed_actions": policy["allowed_actions"],
        },
        "agent_skeleton": {
            key: spec[key] for key in ("persona_id", "group", "role_key", "role_description", "bias_seed", "risk_tolerance", "trend_sensitivity", "event_sensitivity", "flow_sensitivity")
        },
    }
    return [
        {"role": "system", "content": "당신은 한국 개별 종목 모의투자의 시장 참여 에이전트 프로필 설계자다. 실제 근거 문서에서 확인되는 초기 맥락만 사용한다. 투자 권유·미래 가격 예측·사실처럼 단정하는 가상 사건을 쓰지 않는다. 주어진 그룹 정책과 허용 행동을 벗어나지 말고, 반드시 JSON 객체 하나만 반환한다."},
        {"role": "user", "content": f"""아래 초기 맥락과 그룹 정책을 바탕으로 정확히 한 명의 독립 투자 에이전트 프로필을 만든다.

{_json(payload)}

반환 형식:
{{
  "display_name":"한국어 표시명", "investment_thesis":"초기 시장을 바라보는 1~2문장",
  "focus_signals":["주로 보는 신호"], "ignored_signals":["과소평가·무시하는 신호"],
  "bias":"이 에이전트만의 한 가지 편향", "holding_horizon":"단기|중기|장기",
  "event_response":"사건을 만났을 때의 반응", "risk_rule":"위험 축소·손절·헤지 기준",
  "memory_seed":"게임 시작 시 기억할 현재 시장 조건", "initial_stance":"bullish|bearish|neutral|mixed"
}}
"""},
    ]


def _fallback_profile(spec: dict[str, Any]) -> dict[str, Any]:
    return {
        "display_name": f"{spec['group_label']} · {spec['role_description'].split(' ')[0]}",
        "investment_thesis": f"{spec['role_description']} 관점에서 초기 공개 정보와 가격·수급 변화를 관찰한다.",
        "focus_signals": [spec["bias_seed"], "가격·수급 변화"],
        "ignored_signals": ["근거가 약한 단기 소음"],
        "bias": spec["bias_seed"],
        "holding_horizon": "장기" if spec["group"] == "pension" else "중기" if spec["group"] in ("foreign", "institution") else "단기",
        "event_response": "사건 공개 후 현재 보유와 허용 행동 범위 안에서만 비중을 조정한다.",
        "risk_rule": "자금·보유 수량·최대 주문 한도를 넘기지 않는다.",
        "memory_seed": "초기 상황의 실제 근거와 이후 공개되는 정보만 판단에 사용한다.",
        "initial_stance": "neutral",
    }


def _normalize_profile(value: Any, spec: dict[str, Any]) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    fallback = _fallback_profile(spec)
    result: dict[str, Any] = {}
    for key in ("display_name", "investment_thesis", "bias", "holding_horizon", "event_response", "risk_rule", "memory_seed", "initial_stance"):
        result[key] = str(raw.get(key) or fallback[key]).strip()[:600]
    for key in ("focus_signals", "ignored_signals"):
        values = raw.get(key)
        result[key] = [str(item).strip()[:120] for item in values if str(item).strip()][:5] if isinstance(values, list) else fallback[key]
    if result["initial_stance"] not in {"bullish", "bearish", "neutral", "mixed"}:
        result["initial_stance"] = "neutral"
    return result


def _generate_one(initial_context: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    try:
        profile = _normalize_profile(LLMClient().chat_json(_prompt(initial_context, spec), temperature=.35, max_tokens=900), spec)
        return {**spec, "profile": profile, "profile_source": "openrouter", "profile_error": None}
    except Exception as exc:  # 한 에이전트 실패가 전체 세계 생성을 막지 않게 한다.
        return {**spec, "profile": _fallback_profile(spec), "profile_source": "rule_fallback", "profile_error": str(exc)[:300]}


def generate_agent_profiles(
    initial_context: dict[str, Any], *, initial_price: int | None = None,
    progress: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    context_id = str(initial_context.get("context_id") or "")
    if not context_id:
        raise TradingError("에이전트 프로필에는 초기 맥락 ID가 필요합니다.")
    cached = get_cached_agent_profiles(context_id)
    if cached:
        return {**cached, "cached": True}

    # API는 전체 이력에서 마지막 실제 종가를 넘긴다. 초기 맥락 캐시가 의도적으로
    # 압축본만 보관하므로, 캐시 자체에서 가격을 복원하지 못하는 경우의 안전망도 둔다.
    specs = _specs(context_id, max(1, int(initial_price or _last_price(initial_context))))
    profiles: list[dict[str, Any] | None] = [None] * len(specs)
    workers = max(1, min(int(Config.AGENT_PROFILE_PARALLEL_COUNT), 8))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="agent-profile") as executor:
        futures = {executor.submit(_generate_one, initial_context, spec): index for index, spec in enumerate(specs)}
        completed = 0
        for future in as_completed(futures):
            index = futures[future]
            profiles[index] = future.result()
            completed += 1
            if progress:
                progress(completed, len(specs), specs[index]["persona_id"])

    result = {
        "context_id": context_id,
        "schema_version": AGENT_PROFILE_SCHEMA_VERSION,
        "generated_at": datetime.now().isoformat(),
        "counts": deepcopy(AGENT_GROUP_COUNTS),
        "profiles": [profile for profile in profiles if profile],
        "cached": False,
    }
    _write_cache(_cache_path(context_id), result)
    return result


def profile_summary(payload: dict[str, Any]) -> dict[str, Any]:
    """Small API response for the setup screen; full profiles stay server-side until game start."""
    profiles = payload.get("profiles") or []
    groups = []
    for key, policy in GROUP_POLICY.items():
        rows = [row for row in profiles if row.get("group") == key]
        groups.append({
            "key": key, "label": policy["label"], "count": len(rows),
            "description": policy["description"],
            "strategies": sorted({str(row.get("role_key") or "") for row in rows if row.get("role_key")}),
            "average_risk_tolerance": round(sum(float(row.get("risk_tolerance") or 0) for row in rows) / len(rows), 3) if rows else 0,
            "activity_frequency": policy["frequency"], "market_impact_tier": policy["market_impact"],
        })
    return {"context_id": payload.get("context_id"), "schema_version": payload.get("schema_version"), "counts": payload.get("counts"), "groups": groups, "profile_count": len(profiles), "cached": bool(payload.get("cached"))}


def public_group_profiles(payload: dict[str, Any], group: str) -> list[dict[str, Any]]:
    """Return UI-safe individual profiles without simulation balances or prompts."""
    if group not in GROUP_POLICY:
        raise TradingError("지원하지 않는 시장 참여자 범주입니다.")
    rows = [row for row in payload.get("profiles") or [] if row.get("group") == group]
    public_keys = (
        "persona_id", "group", "group_label", "role_key", "role_description",
        "bias_seed", "risk_tolerance", "trend_sensitivity", "event_sensitivity",
        "flow_sensitivity", "allowed_actions", "activity_frequency", "market_impact_tier",
    )
    profile_keys = (
        "display_name", "investment_thesis", "focus_signals", "ignored_signals", "bias",
        "holding_horizon", "event_response", "risk_rule", "memory_seed", "initial_stance",
    )
    result = []
    for row in rows:
        profile = row.get("profile") or {}
        result.append({
            **{key: row.get(key) for key in public_keys},
            "profile": {key: profile.get(key) for key in profile_keys},
        })
    return result
