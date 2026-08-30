"""Bounded, explainable news/event impact scoring for the POC."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit


POSITIVE = {
    "실적 상향": .45, "어닝 서프라이즈": .55, "수주": .30, "증설": .20,
    "배당 확대": .30, "자사주 매입": .35, "규제 완화": .25,
    "upgrade": .35, "earnings beat": .50, "contract win": .30, "buyback": .35,
}
NEGATIVE = {
    "실적 하향": -.45, "어닝 쇼크": -.55, "리콜": -.35, "횡령": -.60,
    "유상증자": -.30, "규제 강화": -.25, "공급 차질": -.35,
    "downgrade": -.35, "earnings miss": -.50, "recall": -.35, "fraud": -.60,
}
OFFICIAL = {"dart", "금융감독원", "한국거래소", "krx", "reuters", "연합뉴스",
            "company", "ir", "보도자료", "federal reserve", "bank of korea"}


def _canonical_url(url: str | None) -> str:
    if not url:
        return ""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), "", ""))


def _title_key(title: str) -> str:
    return " ".join(re.findall(r"[가-힣a-z0-9]+", (title or "").casefold()))


def score_event(event: dict[str, Any]) -> dict[str, Any]:
    text = f"{event.get('title', '')} {event.get('summary', '')}".casefold()
    hits = [(term, value) for term, value in {**POSITIVE, **NEGATIVE}.items() if term in text]
    raw = sum(value for _, value in hits)
    source_text = f"{event.get('publisher', '')} {event.get('feed', '')}".casefold()
    official = any(term in source_text for term in OFFICIAL)
    source_score = max(0.0, min(float(event.get("source_score") or 0) / 7, 1.0))
    confidence = min(.95, .35 + (.25 if hits else 0) + (.2 if official else 0) + source_score * .15)
    impact = max(-.7, min(.7, raw * (.65 + confidence * .35))) if hits else 0.0
    magnitude = abs(impact)
    duration = 5 if magnitude >= .5 else 3 if magnitude >= .25 else 1
    reason = ([f"표현 '{term}' 감지" for term, _ in hits[:4]] or
              ["방향을 판정할 명시적 표현이 없어 중립 처리"])
    if official:
        reason.append("공식·주요 출처 신뢰도 반영")
    return {**event, "impact": round(impact, 4), "impact_confidence": round(confidence, 3),
            "impact_duration_days": duration, "impact_reasons": reason,
            "impact_method": "bounded_keyword_rules"}


def deduplicate_and_score(events: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    selected: dict[str, dict[str, Any]] = {}
    duplicates = 0
    for event in events:
        key = _canonical_url(event.get("url")) or _title_key(event.get("title", ""))
        if not key:
            continue
        scored = score_event(event)
        current = selected.get(key)
        if current is None or scored["impact_confidence"] > current["impact_confidence"]:
            if current is not None:
                duplicates += 1
            selected[key] = scored
        else:
            duplicates += 1
    return list(selected.values()), duplicates
