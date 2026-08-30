"""Scenario paper-trading HTTP surface.

Only the event-scenario endpoints came over from FinSimulation. The legacy
single-stock mode and the OASIS bridges stayed behind with the services that
back them.
"""

from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request
import json
from pathlib import Path

from .kospi_paper_trading import TradingError
from .paper_game_store import PaperGameStore
from .finverse_market_data import FinverseMarketData, FinverseUnavailable
from .llm_market_simulator import LLMMarketUnavailable
from .llm_scenario_simulator import generate_scenario_events, run_scenario_agent_round
from .scenario_trading import (
    advance_inter_event_market, finish_event, new_scenario_game, public_scenario_game,
    reveal_and_react, scenario_portfolio, submit_scenario_order,
)
from .scenario_investor_analyzer import analyze_scenario_investor
from .scenario_job_manager import ScenarioJobManager
from .llm_scenario_report import generate_llm_scenario_report
from .ontology_scenario_events import build_ontology_scenario
from .config import Config

paper_trading_bp = Blueprint("paper_trading", __name__)


def _store() -> PaperGameStore:
    return PaperGameStore(current_app.config.get("PAPER_TRADING_DATA_DIR"))


def _market_data() -> FinverseMarketData:
    return FinverseMarketData(current_app.config.get("FINVERSE_DATABASE_URL"))


def _scenario_jobs() -> ScenarioJobManager:
    return ScenarioJobManager(current_app.config.get("PAPER_TRADING_DATA_DIR"))


def _not_found(game_id: str):
    return jsonify({"success": False, "error": f"게임이 존재하지 않습니다: {game_id}"}), 404


def _public(game):
    return public_scenario_game(game)


@paper_trading_bp.errorhandler(TradingError)
@paper_trading_bp.errorhandler(ValueError)
def handle_trading_error(error):
    return jsonify({"success": False, "error": str(error)}), 400


@paper_trading_bp.errorhandler(FinverseUnavailable)
def handle_finverse_unavailable(error):
    return jsonify({"success": False, "error": str(error)}), 503


@paper_trading_bp.errorhandler(LLMMarketUnavailable)
def handle_llm_market_unavailable(error):
    return jsonify({"success": False, "error": str(error)}), 503


@paper_trading_bp.route("/securities", methods=["GET"])
def list_securities():
    items = _market_data().list_kospi_securities(
        request.args.get("q", ""), request.args.get("limit", 30, type=int))
    return jsonify({"success": True, "data": items})


@paper_trading_bp.route("/data-source/status", methods=["GET"])
def data_source_status():
    return jsonify({"success": True, "data": _market_data().healthcheck()})


def _summary(game):
    """Light row for the resume list.

    The full payload carries every agent round with 40 persona orders each, which
    is megabytes once a few games exist. The picker only needs identity and
    progress, so it never pays for the rest.
    """
    portfolio = scenario_portfolio(game) if game.get("mode") == "scenario" else None
    return {
        "game_id": game["game_id"], "mode": game.get("mode"),
        "ticker": game.get("ticker"), "name": game.get("name"),
        "status": game.get("status"), "phase": game.get("phase"),
        "created_at": game.get("created_at"), "updated_at": game.get("updated_at"),
        "scenario_premise": game.get("scenario_premise", ""),
        "current_event_index": game.get("current_event_index", 0),
        "total_events": len(game.get("events", [])),
        "market_days": len(game.get("agent_rounds", [])),
        "current_price": game.get("current_price"),
        "total_return_pct": portfolio["total_return_pct"] if portfolio else None,
    }


@paper_trading_bp.route("/games", methods=["GET"])
def list_games():
    games = _store().list(request.args.get("limit", 50, type=int))
    if request.args.get("summary") in ("1", "true", "yes"):
        return jsonify({"success": True, "data": [_summary(game) for game in games]})
    return jsonify({"success": True, "data": [_public(game) for game in games]})


@paper_trading_bp.route("/games/<game_id>", methods=["GET"])
def get_game(game_id: str):
    game = _store().get(game_id)
    if not game:
        return _not_found(game_id)
    return jsonify({"success": True, "data": _public(game)})


@paper_trading_bp.route("/scenarios", methods=["POST"])
def create_event_scenario():
    data = request.get_json(silent=True) or {}
    ticker = str(data.get("ticker", "")).zfill(6)
    history = _market_data().load_game_data(
        ticker, data.get("history_start", ""), data.get("history_end", ""))
    history_source = "finverse_postgresql_history_only"
    event_count = int(data.get("event_count", 5))
    history_days = history["market_days"]
    provenance = {"mode": "llm_premise"}
    if data.get("events"):
        events = data["events"]
        provenance = {"mode": "caller_supplied"}
    elif str(data.get("event_source") or "ontology").lower() == "ontology":
        # 기본 경로. 실제로 일어난 사건과 그날의 실제 시장 반응으로 시나리오를
        # 만든다. 이력이 짧거나 사건이 부족하면 전제 기반 생성으로 물러난다.
        try:
            history_days, events, provenance = build_ontology_scenario(
                history, event_count, int(data.get("scenario_window_days", 60)))
        except (TradingError, LLMMarketUnavailable) as exc:
            if not str(data.get("premise") or "").strip():
                raise
            provenance = {"mode": "llm_premise", "ontology_fallback_reason": str(exc)}
            events = generate_scenario_events(
                history["ticker"], history["name"], data.get("premise", ""), event_count)
    else:
        events = generate_scenario_events(
            history["ticker"], history["name"], data.get("premise", ""), event_count)
    game = new_scenario_game(
        history["ticker"], history["name"], history_days[-1]["close"], history_days,
        events, initial_cash=int(data.get("initial_cash", 100_000_000)),
        persona_counts=data.get("persona_counts"),
        fee_rate=float(data.get("fee_rate", .00015)),
        sell_tax_rate=float(data.get("sell_tax_rate", .0018)),
        slippage_bps=float(data.get("slippage_bps", 5.0)),
        scenario_start_date=data.get("scenario_start_date"),
    )
    game["data_source"] = history_source
    game["event_provenance"] = provenance
    game["ontology_snapshot"] = history.get("ontology_snapshot", {})
    game["ontology_coverage"] = history.get("ontology_coverage", {})
    game["scenario_premise"] = str(data.get("premise") or "")
    game["history_quality"] = history.get("quality", {})
    _store().save(game)
    return jsonify({"success": True, "data": public_scenario_game(game)}), 201


@paper_trading_bp.route("/scenarios/<game_id>/orders", methods=["POST"])
def create_event_scenario_order(game_id: str):
    data, store = request.get_json(silent=True) or {}, _store()
    updated = store.update(game_id, lambda game: submit_scenario_order(
        game, data.get("side", ""), data.get("quantity"),
        data.get("rationale", ""), data.get("confidence")))
    if not updated:
        return _not_found(game_id)
    game, order = updated
    return jsonify({"success": True, "data": order, "game": public_scenario_game(game)}), 201


@paper_trading_bp.route("/scenarios/<game_id>/assessment", methods=["GET"])
def get_event_scenario_assessment(game_id: str):
    game = _store().get(game_id)
    if not game:
        return _not_found(game_id)
    if game.get("mode") != "scenario":
        raise TradingError("이벤트 시나리오 게임이 아닙니다.")
    report = analyze_scenario_investor(game)
    report["llm_report"] = game.get("llm_report")
    return jsonify({"success": True, "data": report})


@paper_trading_bp.route("/scenarios/<game_id>/actions", methods=["POST"])
def start_event_scenario_action(game_id: str):
    data = request.get_json(silent=True) or {}
    action = str(data.get("action") or "").strip().lower()
    if action not in ("advance_days", "reveal", "continue", "report"):
        raise TradingError("시나리오 작업은 advance_days, reveal, continue 또는 report여야 합니다.")
    root = current_app.config.get("PAPER_TRADING_DATA_DIR")
    existing = PaperGameStore(root).get(game_id)
    if not existing:
        return _not_found(game_id)
    expected = ("inter_event_market" if action == "advance_days" else
                "pre_event_decision" if action == "reveal" else
                "post_event_decision" if action == "continue" else "completed")
    if existing.get("phase") != expected:
        raise TradingError("현재 시나리오 단계와 요청 작업이 일치하지 않습니다.")

    # 하루씩 볼 수 있게 한다. 없으면 이벤트 직전까지 한 번에 진행한다.
    raw_days = data.get("days")
    max_days = max(1, int(raw_days)) if raw_days is not None else None

    def operation(report):
        store = PaperGameStore(root)
        if action == "advance_days":
            def advance_days(game):
                event = game["events"][game["current_event_index"]]
                from .scenario_trading import pending_inter_event_dates
                dates = pending_inter_event_dates(game)
                if max_days is not None:
                    dates = dates[:max_days]
                total = max(1, len(dates))
                def provider(current_game, current_event, market_date, index, visible_signals):
                    report(10 + round(75 * (index - 1) / total),
                           f"{market_date} 자율거래 {index}/{total} · LLM 주문 생성 중")
                    return run_scenario_agent_round(
                        current_game, current_event, "inter_event", index,
                        market_date=market_date, visible_signals=visible_signals)
                result = advance_inter_event_market(game, provider, max_days=max_days)
                report(90, f"{event['event_date']} 이벤트 전 판단 단계 준비 중")
                return result
            store.update(game_id, advance_days)
        elif action == "reveal":
            def reveal(game):
                event = game["events"][game["current_event_index"]]
                report(15, "이벤트 공개 및 LLM 시장 반응 생성 중")
                llm_round = run_scenario_agent_round(game, event, "event_reaction")
                report(85, "페르소나 주문과 가격 반영 중")
                return reveal_and_react(game, llm_round)
            store.update(game_id, reveal)
        elif action == "continue":
            def advance(game):
                report(40, "이벤트 사후 사용자 주문 체결 중")
                result = finish_event(game)
                report(90, "다음 이벤트 상태 저장 중")
                return result
            store.update(game_id, advance)
        else:
            def generate_report(game):
                report(15, "이벤트와 투자 판단 기록 분석 중")
                game["llm_report"] = generate_llm_scenario_report(game)
                report(90, "종합 교육 보고서 저장 중")
                return game["llm_report"]
            store.update(game_id, generate_report)

    job = _scenario_jobs().submit(game_id, action, operation)
    return jsonify({"success": True, "data": job}), 202


@paper_trading_bp.route("/scenario-jobs/<job_id>", methods=["GET"])
def get_event_scenario_job(job_id: str):
    job = _scenario_jobs().get(job_id)
    if not job:
        return jsonify({"success": False, "error": "작업이 존재하지 않습니다."}), 404
    return jsonify({"success": True, "data": job})
