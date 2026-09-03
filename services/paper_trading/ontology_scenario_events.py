"""Build scenario events from the ontology's real market events.

The premise-driven generator asks an LLM to invent a chain of fictional
events. This module does the opposite: it takes events that actually
happened — with their real dates, sources and observed market reaction —
and only asks the LLM for the teaching scaffolding around them.

The split matters. Facts stay facts:

    event_date, title, summary, event_types, publisher  ← ontology
    direction, severity, surprise                       ← measured from price
    pre_brief, lead_signals                             ← written by the LLM

so a scenario can never claim a move the market did not make.
"""

from __future__ import annotations

from datetime import date
import json
import random
import re
import statistics
from typing import Any, Callable

from .kospi_paper_trading import TradingError
from .global_macro import fetch_global_observations, sector_sensitivity
from .llm_market_simulator import LLMMarketUnavailable, _parse_json


# 이벤트 구간이 이보다 짧으면 사건 사이에 자율거래 구간을 둘 수 없다.
MIN_SCENARIO_WINDOW_DAYS = 20
DEFAULT_SCENARIO_WINDOW_DAYS = 60
# 충격 모델 보정에 필요한 최소 거래일. 이보다 적으면 수익률 분포가 빈약해진다.
MIN_CALIBRATION_DAYS = 80
# 이벤트 사이 최소 간격(거래일). 사전 판단 구간을 확보하기 위한 값이다.
MIN_EVENT_GAP_DAYS = 3
# 사건 사이에 시뮬레이션할 자율거래일 상한. 실제 달력을 그대로 쓰면 한국은행
# 회의 사이가 25거래일까지 벌어져, 한 번 누르면 25라운드(3분 이상)가 돈다.
# 사건의 내용·순서·방향은 실제 그대로 두고 간격만 압축한다. 원래 날짜는
# ontology_source.original_date에 남긴다.
MAX_INTER_EVENT_DAYS = 5
# 하루 변동을 ±1로 정규화할 때, 고정 퍼센트가 아니라 그 종목·그 기간의
# 변동성으로 나눈다. 이 레이크의 가격은 합성 데이터라 일간 표준편차가 5.6%로
# 실제 삼성전자(1.3~1.8%)의 서너 배다. 3% 같은 상수를 쓰면 거의 모든 날이
# severity 1.0으로 포화된다. 변동성 대비로 재면 데이터가 바뀌어도 성립한다.
SIGMA_FOR_FULL_SCALE = 2.5
PERSISTENCE_BY_TYPE = {
    "INTEREST_RATES": 7, "POLICY": 6, "FOREIGN_EXCHANGE": 5,
    "REAL_ECONOMY": 5, "GEOPOLITICAL": 4,
}


# 원화 약세는 수출 비중이 큰 업종엔 순풍, 내수 업종엔 역풍이다.
# 섹터를 모르면 방향을 단정하지 않고 0으로 둔다.
EXPORT_SECTORS = {
    "반도체와반도체장비", "자동차", "자동차부품", "전자장비와기기", "화학",
    "조선", "철강", "디스플레이패널및부품", "기계", "IT하드웨어및장비",
    "전기제품", "타이어", "비철금속",
}

# 지표가 실제로 움직인 날을 사건으로 본다. 방향은 가격이 아니라 경제 논리에서
# 나온다. 이 레이크의 일별 가격은 합성이라(삼성전자 일간 표준편차 5.6%,
# 실제는 1.3~1.8%) 가격 반응으로 방향을 정하면 무관한 헤드라인에 무관한
# 급등을 갖다 붙이게 된다. 지표는 ECOS/KOSIS 실측이라 신뢰할 수 있다.
MACRO_RULES: dict[str, dict[str, Any]] = {
    "한국은행 기준금리": {
        # 25bp는 통상적인 한 번의 조정이다. 만점은 50bp짜리 빅스텝에 준다.
        "kind": "policy_rate", "equity_sign": -1, "full_scale": .5,
        "unit": "%p", "decimals": 2, "persistence": 8, "min_move": .009,
        "up": "기준금리 인상", "down": "기준금리 인하",
        "why_up": "정책금리가 올라 할인율이 높아지고 위험자산 선호가 약해집니다.",
        "why_down": "정책금리가 내려 할인율이 낮아지고 위험자산 선호가 살아납니다.",
    },
    "국고채3년": {
        "kind": "bond_yield", "equity_sign": -1, "full_scale": .25,
        "unit": "%p", "decimals": 3, "persistence": 5, "min_move": None,
        "up": "국고채 3년물 금리 급등", "down": "국고채 3년물 금리 급락",
        "why_up": "시장금리가 뛰며 주식의 상대 매력이 떨어집니다.",
        "why_down": "시장금리가 내리며 주식의 상대 매력이 올라갑니다.",
    },
    "원달러환율": {
        "kind": "fx", "equity_sign": None, "full_scale": 45.0,
        "unit": "원", "decimals": 1, "persistence": 5, "min_move": None,
        "up": "원달러 환율 급등", "down": "원달러 환율 급락",
        "why_up": "원화가 약해져 수출 채산성은 개선되지만 외국인 자금엔 부담입니다.",
        "why_down": "원화가 강해져 수출 채산성은 나빠지지만 외국인 자금엔 우호적입니다.",
    },
}
# 상시 변동하는 지표는 자기 변동성의 이 배수를 넘어야 사건으로 친다.
MACRO_SIGMA_THRESHOLD = 1.6

# 국내 정책금리·환율만으로는 시장을 움직인 이유의 절반만 잡힌다. 미국 장기금리,
# 유가, 달러는 KOSPI 종목의 공시 어디에도 안 나오지만 가격을 움직인다.
# 방향은 업종 민감도가 정한다 — 유가는 화학에 비용이고 정유에 매출이다.
GLOBAL_MACRO_RULES: dict[str, dict[str, Any]] = {
    "미국 10년물 국채금리": {
        "kind": "us_yield", "full_scale": .18, "unit": "%p", "decimals": 3,
        "persistence": 6, "up": "미국 10년물 금리 급등", "down": "미국 10년물 금리 급락",
        "why_up": "글로벌 할인율이 올라 위험자산 전반이 압박받습니다.",
        "why_down": "글로벌 할인율이 내려 위험자산 선호가 개선됩니다.",
    },
    "WTI 유가": {
        "kind": "oil", "full_scale": 5.0, "unit": "달러", "decimals": 2,
        "persistence": 5, "up": "국제 유가 급등", "down": "국제 유가 급락",
        "why_up": "원유 가격이 올라 비용 구조와 물가 경로가 함께 흔들립니다.",
        "why_down": "원유 가격이 내려 비용 부담과 물가 압력이 완화됩니다.",
    },
    "달러 인덱스": {
        "kind": "dollar", "full_scale": 1.2, "unit": "p", "decimals": 2,
        "persistence": 5, "up": "달러 강세", "down": "달러 약세",
        "why_up": "달러가 강해져 수출 채산성과 외국인 자금이 반대로 움직입니다.",
        "why_down": "달러가 약해져 수출 채산성과 외국인 자금이 반대로 움직입니다.",
    },
}


def _subject_particle(word: str) -> str:
    """Pick 이/가 by whether the last syllable ends in a consonant."""
    if not word:
        return "가"
    last = word[-1]
    if not "\uac00" <= last <= "\ud7a3":
        return "가"
    return "이" if (ord(last) - 0xAC00) % 28 else "가"


def fx_equity_sign(sector: str | None) -> int:
    """Which way a weaker won cuts for this security."""
    if not sector:
        return 0
    return 1 if sector in EXPORT_SECTORS else -1


def _series_by_date(macro_observations: list[dict[str, Any]],
                    series_name: str) -> list[tuple[str, float]]:
    rows = [(str(row["trade_date"]), float(row["value"]))
            for row in macro_observations
            if row.get("series_name") == series_name and row.get("value") is not None]
    rows.sort()
    return rows


def detect_macro_events(macro_observations: list[dict[str, Any]],
                        window_start: str, window_end: str,
                        sector: str | None) -> list[dict[str, Any]]:
    """Find sessions where a policy or market rate actually moved."""
    events = []
    for series_name, rule in {**MACRO_RULES, **GLOBAL_MACRO_RULES}.items():
        rows = _series_by_date(macro_observations, series_name)
        if len(rows) < 3:
            continue
        deltas = [rows[i][1] - rows[i - 1][1] for i in range(1, len(rows))]
        moved = [abs(value) for value in deltas if value]
        threshold = rule.get("min_move")
        if threshold is None:
            spread = statistics.pstdev(moved) if len(moved) > 1 else 0.0
            centre = statistics.median(moved) if moved else 0.0
            threshold = max(centre + MACRO_SIGMA_THRESHOLD * spread, 1e-9)
        equity_sign = rule.get("equity_sign")
        if series_name in GLOBAL_MACRO_RULES:
            # 글로벌 지표는 업종에 따라 부호와 크기가 모두 달라진다.
            equity_sign = sector_sensitivity(series_name, sector)
            if abs(equity_sign) < 1e-6:
                continue
        elif equity_sign is None:
            equity_sign = fx_equity_sign(sector)
        for index in range(1, len(rows)):
            day, value = rows[index]
            if not window_start <= day <= window_end:
                continue
            change = value - rows[index - 1][1]
            if abs(change) < threshold:
                continue
            rising = change > 0
            magnitude = min(1.0, abs(change) / rule["full_scale"])
            events.append({
                "event_date": day,
                "origin": "macro",
                "series_name": series_name,
                "title": f"{rule['up'] if rising else rule['down']}",
                "summary": (
                    f"{series_name}{_subject_particle(series_name)} "
                    f"{rows[index-1][1]:.{rule['decimals']}f}에서 "
                    f"{value:.{rule['decimals']}f}로 "
                    f"{abs(change):.{rule['decimals']}f}{rule['unit']} "
                    f"{'상승' if rising else '하락'}했습니다. "
                    f"{rule['why_up'] if rising else rule['why_down']}"),
                "event_types": [rule["kind"].upper()],
                "publisher": "ECOS" if series_name in MACRO_RULES else "글로벌 시장",
                "url": None,
                "source_score": 7.0,
                "available_before_open": False,
                "scope": "market",
                "observed_change": round(change, 6),
                "observed_value": round(value, 6),
                # 방향은 경제 논리 × 지표 변화량이다. 가격을 보지 않는다.
                "direction": round(_clamp(equity_sign * change / rule["full_scale"]), 4),
                "severity": round(magnitude, 4),
                "surprise": round(min(1.0, abs(change) / max(threshold, 1e-9) / 2), 4),
                "persistence_days": rule["persistence"],
            })
    return events


def event_source_start(market_days: list[dict[str, Any]],
                       window_days: int = DEFAULT_SCENARIO_WINDOW_DAYS) -> int:
    """Return the index where the event-source window begins.

    Real events are drawn from the tail of the history, but the scenario itself
    runs forward from the last known session — the user is trading the future,
    not replaying a stretch that already closed. The whole history still feeds
    the impact model, and each event keeps the date it really happened in
    ``ontology_source.original_date``.
    """
    window = max(MIN_SCENARIO_WINDOW_DAYS, int(window_days))
    split = len(market_days) - window
    if split < MIN_CALIBRATION_DAYS:
        raise TradingError(
            f"온톨로지 이벤트 시나리오에는 최소 "
            f"{MIN_CALIBRATION_DAYS + MIN_SCENARIO_WINDOW_DAYS}거래일이 필요합니다"
            f"(현재 {len(market_days)}일). 조회 기간을 늘리세요.")
    return split


def _daily_volatility_pct(market_days: list[dict[str, Any]]) -> float:
    returns = []
    for previous, current in zip(market_days, market_days[1:]):
        if previous["close"] and current["close"]:
            returns.append((current["close"] / previous["close"] - 1) * 100)
    if len(returns) < 2:
        return 1.0
    return max(0.3, statistics.pstdev(returns))


def _measure_reaction(market_days: list[dict[str, Any]], index: int) -> float:
    """The security's own realised move on the session, in percent."""
    if index <= 0:
        return 0.0
    previous, current = market_days[index - 1], market_days[index]
    if not previous["close"]:
        return 0.0
    return (current["close"] / previous["close"] - 1) * 100


def _clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _name_tokens(name: str | None, english_name: str | None) -> list[str]:
    """Words that identify this company in a headline.

    News in this lake carries no ticker tags, so the only way to find
    company-specific coverage is by name. Korean listings are stored as
    '삼성전자보통주' style, and the articles are in English, so both forms and
    the first English word ('Samsung') are worth matching.
    """
    tokens = []
    for raw in (name, english_name):
        text = str(raw or "").strip()
        if not text:
            continue
        text = re.sub(r"(보통주|우선주|\(주\)|주식회사)$", "", text).strip()
        if len(text) >= 2:
            tokens.append(text)
        # 영문명은 'SamsungElectronics'처럼 붙어서 저장돼 있다. 기사에는
        # 'Samsung Electronics'로 나오므로 낱말 경계에서 쪼개 앞말을 쓴다.
        words = re.findall(r"[A-Z][a-z]+|[가-힣]+", text)
        if len(words) > 1 and len(words[0]) >= 4:
            tokens.append(words[0])
        elif " " in text:
            head = text.split()[0]
            if len(head) >= 4:
                tokens.append(head)
    return list(dict.fromkeys(tokens))


def collect_micro_events(market_days: list[dict[str, Any]], split: int,
                         tokens: list[str]) -> list[dict[str, Any]]:
    """Company-specific news in the scenario window, matched by name."""
    if not tokens:
        return []
    lowered = [token.casefold() for token in tokens]
    events = []
    for index in range(split, len(market_days)):
        day = market_days[index]
        for event in day.get("events") or []:
            haystack = f"{event.get('title', '')} {event.get('summary', '')}".casefold()
            if not any(token in haystack for token in lowered):
                continue
            impact = float(event.get("impact") or 0)
            events.append({
                "event_date": day["trade_date"],
                "origin": "micro",
                "title": str(event.get("title") or "").strip(),
                "summary": str(event.get("summary") or "").strip(),
                "event_types": [str(item) for item in (event.get("event_types") or [])],
                "publisher": event.get("publisher") or event.get("feed"),
                "url": event.get("url"),
                "source_score": float(event.get("source_score") or 0),
                "available_before_open": bool(event.get("available_before_open")),
                "scope": "security",
                # 키워드 채점기가 방향을 못 잡으면 0으로 두고 LLM 서술에 맡긴다.
                "direction": round(_clamp(impact / .7), 4),
                "severity": round(min(1.0, abs(impact) / .7), 4),
                "surprise": round(min(1.0, abs(impact) / .5), 4),
                "persistence_days": int(event.get("impact_duration_days") or 3),
            })
    return events


def attach_narrative(events: list[dict[str, Any]],
                     market_days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Give a macro move the headline that reported it, when one exists.

    A rate decision and the press release announcing it land on the same day;
    pairing them turns a number into something a reader can act on.
    """
    by_date: dict[str, list[dict[str, Any]]] = {}
    for day in market_days:
        if day.get("events"):
            by_date[day["trade_date"]] = day["events"]
    for event in events:
        if event["origin"] != "macro":
            continue
        same_day = by_date.get(event["event_date"]) or []
        best = max(same_day, key=lambda item: float(item.get("source_score") or 0),
                   default=None)
        if best and float(best.get("source_score") or 0) >= 5:
            event["headline"] = str(best.get("title") or "").strip()
            event["url"] = best.get("url")
            event["publisher"] = best.get("publisher") or best.get("feed") or event["publisher"]
    return events


def record_price_reaction(events: list[dict[str, Any]],
                          market_days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Note what the price did, without letting it decide anything.

    Kept so a later comparison can show where the market moved against the
    textbook reading — but this lake's daily prices are synthetic, so they
    never feed direction or severity.
    """
    index_by_date = {day["trade_date"]: position
                     for position, day in enumerate(market_days)}
    for event in events:
        position = index_by_date.get(event["event_date"])
        event["actual_return_pct"] = (round(_measure_reaction(market_days, position), 4)
                                      if position is not None else None)
    return events


def pick_events(candidates: list[dict[str, Any]], event_count: int,
                practice_mode: str = "balanced") -> list[dict[str, Any]]:
    """Choose events that are both consequential and spread across the window.

    Ranking by impact alone clusters every pick into the loudest week, which
    leaves the user with no quiet stretch to read signals in.
    """
    if not candidates:
        raise TradingError("선택한 기간의 온톨로지에 사용할 이벤트가 없습니다.")
    if practice_mode not in {"balanced", "stress", "opportunity", "random"}:
        raise TradingError("지원하지 않는 연습 유형입니다.")
    ordered = sorted(candidates, key=lambda item: item["event_date"])
    randomizer = random.SystemRandom()
    random_scores = ({id(item): randomizer.random() for item in ordered}
                     if practice_mode == "random" else {})

    def weight(item: dict[str, Any]) -> float:
        # 종목 고유 사건을 우대한다. 이 종목에 대한 뉴스가 매크로보다 배우기
        # 좋고, 이 레이크에서는 드물어서 놓치면 다시 안 나온다.
        # 종목 고유 사건은 우대하되, 시상식 수상 같은 무영향 기사가 실제
        # 금리 결정을 밀어내지 않도록 방향성이 있을 때만 가산점을 준다.
        # 방향이 0인 사건은 시나리오의 한 막이 될 수 없다. 시상식 수상 기사가
        # 이벤트로 뽑히면 공개해도 아무 일이 없어 그 구간이 통째로 빈다.
        if item["severity"] < .05:
            return -1.0
        micro_bonus = .6 if item.get("origin") == "micro" else 0
        base = item["source_score"] / 7 + item["severity"] * .8 + micro_bonus
        if practice_mode == "stress" and item["direction"] < -.05:
            return base + 1.1
        if practice_mode == "opportunity" and item["direction"] > .05:
            return base + 1.1
        if practice_mode == "random":
            return base * .2 + random_scores[id(item)] * 2
        return base

    picked: list[dict[str, Any]] = []
    buckets = max(1, event_count)
    span = max(1, len(ordered))
    for bucket in range(buckets):
        lo = bucket * span // buckets
        hi = max(lo + 1, (bucket + 1) * span // buckets)
        pool = [item for item in ordered[lo:hi]
                if weight(item) > 0
                and all(_business_gap(item["event_date"], chosen["event_date"])
                        >= MIN_EVENT_GAP_DAYS for chosen in picked)]
        if not pool:
            continue
        picked.append(max(pool, key=weight))
    picked.sort(key=lambda item: item["event_date"])
    if len(picked) < 2:
        raise TradingError(
            f"이벤트 간격 조건을 만족하는 사건이 부족합니다"
            f"(확보 {len(picked)}개). 조회 기간을 늘리거나 이벤트 수를 줄이세요.")
    return picked[:event_count]


def _business_gap(left: str, right: str) -> int:
    return abs((date.fromisoformat(left) - date.fromisoformat(right)).days)


def narrate_events(security_name: str, ticker: str, events: list[dict[str, Any]],
                   chat: Callable[..., str] | None = None) -> list[dict[str, Any]]:
    """Turn real events into the scenario contract without touching the facts.

    The model writes Korean copy and the lead signals a trader would plausibly
    have seen beforehand. Dates and magnitudes are passed through untouched —
    it is told the outcome only so the pre-event copy can avoid leaking it.
    """
    if chat is None:
        from .llm_client import LLMClient
        chat = LLMClient().chat

    payload = [{
        "index": index,
        "event_date": item["event_date"],
        "title": item["title"],
        "headline": item.get("headline"),
        "summary": item["summary"][:400],
        "event_types": item["event_types"],
        "publisher": item["publisher"],
        "구분": "종목 고유" if item.get("origin") == "micro" else "시장 전체",
        "주가_영향_방향": ("호재" if item["direction"] > .05 else
                      "악재" if item["direction"] < -.05 else "중립"),
        "trading_days_until": 3,
    } for index, item in enumerate(events)]

    messages = [
        {"role": "system", "content":
         "한국 주식 교육용 시뮬레이션의 시나리오 작성자다. 아래 사건들은 실제로 일어난 "
         "일이며 내용을 바꾸거나 새로 지어내면 안 된다. 각 사건을 한국어로 옮기고, "
         "사건 공개 전 투자자가 볼 수 있었을 선행 신호를 만든다. 반드시 JSON 객체만 반환한다."},
        {"role": "user", "content": f"""종목: {security_name}({ticker})
실제 발생 사건:
{json.dumps(payload, ensure_ascii=False, indent=1)}

각 사건마다 다음을 작성하라.
- title: 사건을 한국어로 간결하게 (실제 내용 유지, 30자 내외)
- description: 공개 시 투자자에게 보여줄 설명 2~3문장 (실제 사건 내용만)
- pre_brief: 공개 전 안내. 일정이 있다는 사실만 알리고 결과는 절대 누설하지 말 것
  (주가_영향_방향은 사후 판정용이니 pre_brief와 lead_signals에 절대 반영하지 말 것)
- lead_signals: 공개 전 나올 법한 신호 2~3개. 확정 결과를 담지 말고
  일정·기대·관측만 담아라. days_before는 1~3.

반환 형식:
{{"events":[{{"index":0,"title":"...","description":"...","pre_brief":"...",
"lead_signals":[{{"days_before":1,"channel":"schedule|news|rumor|market_expectation",
"audience":"all|retail|foreign|institution|pension","reliability":0부터1,"content":"..."}}]}}]}}"""},
    ]
    try:
        raw = chat(messages, temperature=.5, max_tokens=4000,
                   response_format={"type": "json_object"})
    except Exception as exc:
        raise LLMMarketUnavailable("온톨로지 이벤트 서술 생성에 실패했습니다.") from exc

    narrated = {int(item.get("index", -1)): item
                for item in (_parse_json(raw).get("events") or [])}
    result = []
    previous_date: str | None = None
    for index, source in enumerate(events):
        copy = narrated.get(index, {})
        gap = (_business_gap(source["event_date"], previous_date) * 5 // 7
               if previous_date else MAX_INTER_EVENT_DAYS)
        previous_date = source["event_date"]
        result.append({
            # 날짜는 엔진이 압축된 간격으로 다시 배치한다. event_date를 주면
            # 실제 달력 그대로 잡혀서 자율거래 구간이 감당 못 하게 길어진다.
            "trading_days_until": max(2, min(MAX_INTER_EVENT_DAYS, gap)),
            "direction": source["direction"],
            "severity": source["severity"],
            "surprise": source["surprise"],
            "persistence_days": source["persistence_days"],
            # 서술만 LLM이 쓴다. 비어 있으면 원문으로 되돌린다.
            "title": str(copy.get("title") or source["title"]).strip()[:120],
            "description": str(copy.get("description") or source["summary"]
                               or source["title"]).strip()[:600],
            "pre_brief": str(copy.get("pre_brief")
                             or "예정된 발표가 있습니다.").strip()[:300],
            "lead_signals": copy.get("lead_signals") or [],
            # 근거를 남겨 리포트와 UI가 출처를 밝힐 수 있게 한다.
            "ontology_source": {
                "origin": source.get("origin"),
                "series_name": source.get("series_name"),
                "observed_change": source.get("observed_change"),
                "observed_value": source.get("observed_value"),
                "headline": source.get("headline"),
                "publisher": source["publisher"], "url": source["url"],
                "event_types": source["event_types"],
                "source_score": source["source_score"],
                "scope": source["scope"],
                "original_date": source["event_date"],
                "original_title": source["title"],
                "actual_return_pct": source["actual_return_pct"],
            },
        })
    return result


def build_ontology_scenario(history: dict[str, Any], event_count: int = 3,
                            window_days: int = DEFAULT_SCENARIO_WINDOW_DAYS,
                            chat: Callable[..., str] | None = None,
                            practice_mode: str = "balanced",
                            ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Return (calibration_days, scenario_events, provenance).

    Events come from two ontology layers: macro indicator moves that actually
    happened (policy rate, FX, bond yields) and company news matched by name.
    Both keep their real dates, so the user trades a real sequence.
    """
    market_days = history["market_days"]
    split = event_source_start(market_days, window_days)
    window_start = market_days[split]["trade_date"]
    window_end = market_days[-1]["trade_date"]
    sector = history.get("sector")

    observations = [*(history.get("macro_observations") or []),
                    *fetch_global_observations(window_start, window_end)]
    macro = detect_macro_events(observations, window_start, window_end, sector)
    micro = collect_micro_events(
        market_days, split,
        _name_tokens(history.get("name"), history.get("english_name")))
    candidates = attach_narrative(macro + micro, market_days)
    candidates = record_price_reaction(candidates, market_days)
    picked = pick_events(candidates, event_count, practice_mode)
    events = narrate_events(history["name"], history["ticker"], picked, chat=chat)
    provenance = {
        "mode": "ontology_events",
        "sector": sector,
        # 보정에는 이력 전체를 쓴다. 시나리오는 마지막 거래일 다음날부터 시작한다.
        "calibration_days": len(market_days),
        "calibration_end": market_days[-1]["trade_date"],
        "event_source_window": [window_start, window_end],
        "macro_candidates": len(macro),
        "global_observations": sum(1 for row in observations
                                   if row.get("series_name") in GLOBAL_MACRO_RULES),
        "micro_candidates": len(micro),
        "selected_events": len(events),
        "practice_mode": practice_mode,
        "direction_basis": "macro_indicator_moves_and_news_keywords",
    }
    return market_days, events, provenance
