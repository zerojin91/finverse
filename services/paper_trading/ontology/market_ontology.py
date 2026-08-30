"""Load and validate the versioned market ontology contract.

The ontology is intentionally kept separate from the FINVERSE database schema.
Raw records remain immutable; adapters map them into this contract before a
simulation is started.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ONTOLOGY_PATH = Path(__file__).with_name("market_ontology_v1.json")


def load_market_ontology() -> dict[str, Any]:
    with ONTOLOGY_PATH.open(encoding="utf-8") as handle:
        ontology = json.load(handle)
    validate_market_ontology(ontology)
    return ontology


def validate_market_ontology(ontology: dict[str, Any]) -> None:
    """Fail fast on contract errors before a simulation consumes the data."""
    if ontology.get("ontology_id") != "finsimulation.market":
        raise ValueError("invalid market ontology id")
    if ontology.get("version") != "1.0.0":
        raise ValueError("unsupported market ontology version")

    entities = ontology.get("entities")
    if not isinstance(entities, list) or not entities:
        raise ValueError("ontology must define entities")
    names = {entity.get("name") for entity in entities}
    if len(names) != len(entities) or None in names:
        raise ValueError("entity names must be unique")
    required_entities = {
        "Security", "TradingSession", "PriceObservation", "InvestorFlow",
        "MarketEvent", "Persona", "Order", "PortfolioState",
    }
    missing = required_entities - names
    if missing:
        raise ValueError(f"missing required entities: {sorted(missing)}")

    relations = ontology.get("relations")
    if not isinstance(relations, list) or not relations:
        raise ValueError("ontology must define relations")
    for relation in relations:
        if not relation.get("name") or relation.get("source") not in names or relation.get("target") not in names:
            raise ValueError(f"invalid relation: {relation}")

    common = set(ontology.get("conventions", {}).get("temporal_fields", []))
    expected = {"observed_at", "published_at", "available_at", "effective_at", "ingested_at"}
    if common != expected:
        raise ValueError("temporal conventions must include the complete point-in-time field set")


def build_market_snapshot(game_data: dict[str, Any]) -> dict[str, Any]:
    """Convert the adapter's game payload into the v1 simulation contract.

    This is deliberately an in-memory transformation. It does not write to
    FINVERSE and keeps the existing game payload backwards compatible.
    """
    ontology = load_market_ontology()
    ticker = str(game_data["ticker"]).zfill(6)
    security_id = f"krx:{ticker}"
    sessions = []
    prices = []
    flows = []
    events = []
    index_observations = []
    holdings = []
    macro_observations = []
    social_signals = []
    for day in game_data.get("market_days", []):
        trade_date = day["trade_date"]
        session_id = f"krx:KOSPI:{trade_date}"
        sessions.append({"session_id": session_id, "trade_date": trade_date, "market_id": "krx:KOSPI", "is_trading_day": True})
        prices.append({"observation_id": f"price:{security_id}:{trade_date}", "security_id": security_id, "session_id": session_id, "trade_date": trade_date, "open": day["open"], "high": day["high"], "low": day["low"], "close": day["close"], "volume": day["volume"], "trading_value": day["trading_value"], "market_cap": day.get("market_cap"), "listed_shares": day.get("listed_shares"), "source": day.get("price_source"), "quality_status": "verified" if day.get("market_cap") is not None else "provisional"})
        for group, net_value in (day.get("investor_flow") or {}).items():
            flows.append({"flow_id": f"flow:{security_id}:{trade_date}:{group}", "security_id": security_id, "session_id": session_id, "investor_group": group, "net_value_krw": net_value, "scope": day.get("investor_flow_scope", "missing"), "quality_status": "verified" if day.get("investor_flow_scope") == "stock" else "provisional"})
        for event in day.get("events", []):
            events.append({"event_id": f"news:{security_id}:{event.get('url') or event.get('title')}", "security_id": security_id, "event_type": (event.get("event_types") or ["news"])[0], "title": event.get("title"), "description": event.get("summary"), "published_at": event.get("published_at"), "available_at": f"{trade_date}T00:00:00+09:00" if event.get("available_before_open") else f"{trade_date}T15:30:00+09:00", "source": event.get("publisher"), "source_score": event.get("source_score"), "quality_status": "verified"})
    for observation in game_data.get("indices", []):
        trade_date = observation["trade_date"]
        session_id = f"krx:KOSPI:{trade_date}"
        index_observations.append({"observation_id": f"index:{observation['index_id']}:{trade_date}", "index_id": observation["index_id"], "session_id": session_id, "trade_date": trade_date, "name": observation.get("name"), **{key: observation.get(key) for key in ("close", "change_pct", "volume", "trading_value", "market_cap", "source", "quality_status")}})
    for holding in game_data.get("foreign_holdings", []):
        trade_date = holding["trade_date"]
        holdings.append({"holding_id": f"holding:{security_id}:{trade_date}", "security_id": security_id, "session_id": f"krx:KOSPI:{trade_date}", **holding})
    for observation in game_data.get("macro_observations", []):
        macro_observations.append({"macro_observation_id": f"macro:{observation.get('series_code')}:{observation.get('trade_date')}", "series_code": observation.get("series_code"), "session_id": f"krx:KOSPI:{observation.get('trade_date')}", **observation})
    for signal in game_data.get("social_signals", []):
        social_signals.append({"signal_id": f"social:{signal.get('platform')}:{security_id}:{signal.get('trade_date')}", "security_id": security_id, "session_id": f"krx:KOSPI:{signal.get('trade_date')}", **signal})
    return {
        "ontology_id": ontology["ontology_id"], "ontology_version": ontology["version"],
        "security": {"security_id": security_id, "ticker": ticker, "name": game_data.get("name"), "market": game_data.get("market", "KOSPI")},
        "market": {"market_id": "krx:KOSPI", "code": "KOSPI", "name": "KOSPI"},
        "sessions": sessions, "prices": prices, "investor_flows": flows, "events": events,
        "index_observations": index_observations, "foreign_holdings": holdings,
        "macro_observations": macro_observations, "social_signals": social_signals,
        "quality": {"flow_scope": "stock" if any(x.get("scope") == "stock" for x in flows) else "kospi_market_fallback" if flows else "missing", "event_count": len(events), "price_count": len(prices), "index_count": len(index_observations), "holding_count": len(holdings), "macro_count": len(macro_observations), "social_count": len(social_signals)}
    }


def build_coverage_report(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Summarize which ontology inputs are usable for one security/run."""
    quality = snapshot.get("quality", {})
    checks = {
        "security": "verified" if snapshot.get("security", {}).get("security_id") else "missing",
        "price": "verified" if quality.get("price_count", 0) else "missing",
        "investor_flow": quality.get("flow_scope", "missing"),
        "foreign_holding": "verified" if quality.get("holding_count", 0) else "missing",
        "index": "verified" if quality.get("index_count", 0) else "missing",
        "macro": "verified" if quality.get("macro_count", 0) else "missing",
        "social": "provisional" if quality.get("social_count", 0) else "missing",
        "event": "verified" if quality.get("event_count", 0) else "missing",
    }
    return {"security_id": snapshot.get("security", {}).get("security_id"), "checks": checks, "ready_for_simulation": checks["security"] == "verified" and checks["price"] == "verified", "warnings": [f"{key} data unavailable" for key, value in checks.items() if value == "missing"]}


def preflight_simulation(snapshot: dict[str, Any], *, market: str = "KOSPI") -> dict[str, Any]:
    """Validate a snapshot before a run; warnings never masquerade as data."""
    errors: list[str] = []
    warnings: list[str] = []
    if snapshot.get("ontology_version") != "1.0.0":
        errors.append("unsupported ontology version")
    if snapshot.get("market", {}).get("code") != market:
        errors.append(f"market must be {market}")
    prices = snapshot.get("prices") or []
    if not prices:
        errors.append("price observations are required")
    dates = [str(row.get("trade_date") or "") for row in prices]
    if dates != sorted(set(dates)):
        errors.append("price observations must contain unique ascending trade dates")
    for event in snapshot.get("events") or []:
        published, available = event.get("published_at"), event.get("available_at")
        if published and available and str(available) < str(published):
            errors.append(f"event available_at precedes published_at: {event.get('event_id')}")
    quality = snapshot.get("quality") or {}
    if quality.get("flow_scope") != "stock":
        warnings.append("stock-level investor flow is not verified")
    if not quality.get("index_count"):
        warnings.append("benchmark index observations are missing")
    if not quality.get("holding_count"):
        warnings.append("foreign holding observations are missing")
    return {"ready": not errors, "errors": errors, "warnings": warnings, "ontology_version": snapshot.get("ontology_version")}
