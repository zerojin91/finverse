"""Scenario paper-trading HTTP surface.

Only the event-scenario endpoints came over from FinSimulation. The legacy
single-stock mode and the OASIS bridges stayed behind with the services that
back them.
"""

from __future__ import annotations

from flask import Blueprint, Response, current_app, jsonify, request
import json
from pathlib import Path

from .kospi_paper_trading import TradingError
from .paper_game_store import PaperGameStore
from .finverse_market_data import FinverseMarketData, FinverseUnavailable
from .llm_market_simulator import LLMMarketUnavailable
from .initial_context_analyzer import (
    InitialContextUnavailable,
    clear_initial_context_cache,
    get_initial_context,
    get_initial_context_documents,
)
from .agent_profiles import (
    clear_agent_profile_cache, generate_agent_profiles, get_cached_agent_profiles,
    profile_summary,
)
from .evidence_documents import DOCUMENT_FILES
from .llm_scenario_simulator import run_scenario_agent_round
from .scenario_trading import (
    advance_inter_event_market, finish_event, new_scenario_game, public_scenario_game,
    reveal_and_react, scenario_portfolio, submit_scenario_order,
)
from .world_simulation import (
    PHASE_COMPLETED as WORLD_PHASE_COMPLETED, PHASE_WORLD_DECISION, PHASE_WORLD_MARKET,
    advance_world_market, new_world_game, resolve_world_decision, submit_world_order,
)
from .scenario_investor_analyzer import analyze_scenario_investor
from .scenario_job_manager import ScenarioJobManager
from .llm_scenario_report import generate_llm_scenario_report
from .config import Config

paper_trading_bp = Blueprint("paper_trading", __name__)


# 기간은 총 거래일만 정한다. 사건 수는 World Agent의 상태 기반 hazard가 정한다.
SIMULATION_DURATION_CONFIG = {
    10: {"source_window_days": 40},
    20: {"source_window_days": 60},
    60: {"source_window_days": 75},
}
INVESTMENT_MODES = {"new", "holding"}


def _fit_scenario_duration(events: list[dict], simulation_days: int) -> list[dict]:
    """Compatibility helper for legacy saved-game tests and migrations.

    The live World Agent route no longer calls this function: duration controls
    trading days, not a fixed number of scheduled events.  Keeping it here
    lets old scenario fixtures be opened and migrated without reintroducing a
    user-facing event-count setting.
    """
    if not events:
        raise TradingError("시나리오 이벤트가 없습니다.")
    gap_days = int(simulation_days) - len(events)
    base, remainder = divmod(gap_days, len(events))
    if base < 1 or base + (1 if remainder else 0) > 20:
        raise TradingError("선택한 기간을 구성할 사건이 충분하지 않습니다.")
    result = []
    for index, source in enumerate(events):
        row = dict(source)
        row["trading_days_until"] = base + (1 if index < remainder else 0)
        result.append(row)
    return result


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


@paper_trading_bp.errorhandler(InitialContextUnavailable)
def handle_initial_context_unavailable(error):
    return jsonify({"success": False, "error": str(error)}), 503


@paper_trading_bp.route("/securities", methods=["GET"])
def list_securities():
    items = _market_data().list_kospi_securities(
        request.args.get("q", ""), request.args.get("limit", 30, type=int))
    return jsonify({"success": True, "data": items})


@paper_trading_bp.route("/securities/<ticker>/candles", methods=["GET"])
def security_candles(ticker: str):
    candles = _market_data().load_recent_candles(
        ticker, request.args.get("limit", 36, type=int))
    return jsonify({"success": True, "data": {"ticker": str(ticker).zfill(6), "candles": candles}})


@paper_trading_bp.route("/securities/<ticker>/scenario-context", methods=["GET"])
def security_scenario_context(ticker: str):
    return jsonify({"success": True, "data": _market_data().collect_scenario_context(ticker)})


@paper_trading_bp.route("/securities/<ticker>/initial-context", methods=["GET"])
def security_initial_context(ticker: str):
    history = _market_data().load_game_data(ticker, "", "")
    return jsonify({"success": True, "data": get_initial_context(history)})


@paper_trading_bp.route("/securities/<ticker>/initial-context/documents", methods=["GET"])
def security_initial_context_documents(ticker: str):
    """Prepare the four Evidence documents before the aggregate LLM request."""
    history = _market_data().load_game_data(ticker, "", "")
    return jsonify({"success": True, "data": get_initial_context_documents(history)})


@paper_trading_bp.route("/securities/<ticker>/initial-context/cache", methods=["DELETE"])
def clear_security_initial_context_cache(ticker: str):
    """Allow the setup screen to explicitly regenerate its source documents and analysis."""
    history = _market_data().load_game_data(ticker, "", "")
    context = get_initial_context_documents(history)
    agent_profiles_removed = clear_agent_profile_cache(context["context_id"])
    return jsonify({"success": True, "data": {
        **clear_initial_context_cache(history), "agent_profiles_removed": agent_profiles_removed,
    }})


@paper_trading_bp.route("/securities/<ticker>/agent-profiles", methods=["GET"])
def security_agent_profiles(ticker: str):
    """Read a prepared individual-agent manifest without exposing full private prompts."""
    history = _market_data().load_game_data(ticker, "", "")
    context = get_initial_context_documents(history)
    payload = get_cached_agent_profiles(context["context_id"])
    if not payload:
        return jsonify({"success": True, "data": {"status": "missing", "context_id": context["context_id"]}})
    return jsonify({"success": True, "data": {"status": "ready", **profile_summary(payload)}})


@paper_trading_bp.route("/securities/<ticker>/agent-profiles/prepare", methods=["POST"])
def prepare_security_agent_profiles(ticker: str):
    """Start 59 independent profile generations after the initial context is ready."""
    history = _market_data().load_game_data(ticker, "", "")
    context = get_initial_context(history)
    cached = get_cached_agent_profiles(context["context_id"])
    if cached:
        return jsonify({"success": True, "data": {"status": "ready", **profile_summary(cached)}})
    cache_key = f"profiles_{context['context_id']}"
    initial_price = int(history["market_days"][-1]["close"])

    def operation(report):
        def on_progress(done: int, total: int, agent_id: str) -> None:
            report(round(done * 100 / max(total, 1)), f"개별 에이전트 프로필 생성 {done}/{total} · {agent_id}")
        generate_agent_profiles(context, initial_price=initial_price, progress=on_progress)

    job = _scenario_jobs().submit(cache_key, "agent_profiles", operation)
    return jsonify({"success": True, "data": {"status": "running", "context_id": context["context_id"], "job": job}}), 202


@paper_trading_bp.route("/securities/<ticker>/initial-context/documents/<domain>", methods=["GET"])
def security_initial_context_document(ticker: str, domain: str):
    """Open one target-specific Evidence Markdown document in a new browser tab."""
    filename = DOCUMENT_FILES.get(domain)
    if not filename:
        return jsonify({"success": False, "error": "지원하지 않는 Evidence 문서입니다."}), 404
    history = _market_data().load_game_data(ticker, "", "")
    context = get_initial_context_documents(history)
    context_id = context["context_id"].removeprefix("ctx_")
    path = Path(Config.UPLOAD_FOLDER) / "market_cache" / f"initial-context-{context_id}" / filename
    if not path.is_file():
        return jsonify({"success": False, "error": "Evidence 문서를 찾을 수 없습니다."}), 404
    return Response(path.read_text(encoding="utf-8"), mimetype="text/markdown; charset=utf-8")


@paper_trading_bp.route("/data-source/status", methods=["GET"])
def data_source_status():
    return jsonify({"success": True, "data": _market_data().healthcheck()})


def _summary(game):
    """Light row for the resume list.

    The full payload carries every agent round with 40 persona orders each, which
    is megabytes once a few games exist. The picker only needs identity and
    progress, so it never pays for the rest.
    """
    portfolio = scenario_portfolio(game) if game.get("mode") in ("scenario", "world") else None
    world = game.get("world") or {}
    world_events = ((world.get("memory") or {}).get("event_ledger") or [])
    return {
        "game_id": game["game_id"], "mode": game.get("mode"),
        "ticker": game.get("ticker"), "name": game.get("name"),
        "status": game.get("status"), "phase": game.get("phase"),
        "created_at": game.get("created_at"), "updated_at": game.get("updated_at"),
        "scenario_premise": game.get("scenario_premise", "") or "World Agent 기반 동적 시장 환경",
        "current_event_index": game.get("current_event_index", 0),
        "total_events": len(world_events) if game.get("mode") == "world" else len(game.get("events", [])),
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
    """Create a World Agent simulation after the 59 private profiles are ready.

    The previous fixed-event/practice-mode surface is intentionally gone.  The
    duration now controls only the number of business days; external events are
    created by the stateful World Agent as that time moves.
    """
    data = request.get_json(silent=True) or {}
    ticker = str(data.get("ticker", "")).zfill(6)
    simulation_days = int(data.get("simulation_days", 20))
    if simulation_days not in SIMULATION_DURATION_CONFIG:
        raise TradingError("시뮬레이션 기간은 10일, 20일, 60일 중에서 선택해주세요.")
    investment_mode = str(data.get("investment_mode") or "new").lower()
    if investment_mode not in INVESTMENT_MODES:
        raise TradingError("지원하지 않는 투자 상태입니다.")
    history = _market_data().load_game_data(
        ticker, data.get("history_start", ""), data.get("history_end", ""))
    initial_context = get_initial_context(history)
    agent_profiles = get_cached_agent_profiles(initial_context["context_id"])
    if not agent_profiles or len(agent_profiles.get("profiles") or []) != 59:
        raise TradingError("초기 상황을 바탕으로 59개 시장 참여 에이전트 프로필을 준비한 뒤 시작할 수 있습니다.")
    history_days = history["market_days"]
    game = new_world_game(
        history["ticker"], history["name"], history_days[-1]["close"], history_days,
        initial_context=initial_context, agent_profiles=agent_profiles, simulation_days=simulation_days,
        world_history=history,
        initial_cash=int(data.get("initial_cash", 100_000_000)),
        initial_position=(data.get("initial_position") if investment_mode == "holding" else None),
        fee_rate=float(data.get("fee_rate", .00015)),
        sell_tax_rate=float(data.get("sell_tax_rate", .0018)),
        slippage_bps=float(data.get("slippage_bps", 5.0)),
    )
    game["data_source"] = "finverse_postgresql_history_only"
    game["event_provenance"] = {"mode": "world_agent_retrieval_grounded"}
    game["ontology_snapshot"] = history.get("ontology_snapshot", {})
    game["ontology_coverage"] = history.get("ontology_coverage", {})
    game["history_quality"] = history.get("quality", {})
    game["investment_mode"] = investment_mode
    _store().save(game)
    return jsonify({"success": True, "data": public_scenario_game(game)}), 201


@paper_trading_bp.route("/scenarios/<game_id>/orders", methods=["POST"])
def create_event_scenario_order(game_id: str):
    data, store = request.get_json(silent=True) or {}, _store()
    def submit(game):
        if game.get("mode") == "world":
            return submit_world_order(game, data.get("side", ""), data.get("quantity"),
                                      data.get("rationale", ""), data.get("confidence"))
        return submit_scenario_order(game, data.get("side", ""), data.get("quantity"),
                                     data.get("rationale", ""), data.get("confidence"))
    updated = store.update(game_id, submit)
    if not updated:
        return _not_found(game_id)
    game, order = updated
    return jsonify({"success": True, "data": order, "game": public_scenario_game(game)}), 201


@paper_trading_bp.route("/scenarios/<game_id>/assessment", methods=["GET"])
def get_event_scenario_assessment(game_id: str):
    game = _store().get(game_id)
    if not game:
        return _not_found(game_id)
    if game.get("mode") not in ("scenario", "world"):
        raise TradingError("지원하지 않는 모의투자 게임입니다.")
    report = analyze_scenario_investor(game)
    report["llm_report"] = game.get("llm_report")
    return jsonify({"success": True, "data": report})


@paper_trading_bp.route("/scenarios/<game_id>/actions", methods=["POST"])
def start_event_scenario_action(game_id: str):
    data = request.get_json(silent=True) or {}
    action = str(data.get("action") or "").strip().lower()
    root = current_app.config.get("PAPER_TRADING_DATA_DIR")
    existing = PaperGameStore(root).get(game_id)
    if not existing:
        return _not_found(game_id)

    if existing.get("mode") == "world":
        if action not in ("advance", "resolve", "report"):
            raise TradingError("World Agent 작업은 advance, resolve 또는 report여야 합니다.")
        expected = (PHASE_WORLD_MARKET if action == "advance" else
                    PHASE_WORLD_DECISION if action == "resolve" else WORLD_PHASE_COMPLETED)
        if existing.get("phase") != expected:
            raise TradingError("현재 World Agent 단계와 요청 작업이 일치하지 않습니다.")

        def world_operation(report):
            store = PaperGameStore(root)
            if action == "advance":
                def advance(game):
                    report(4, "World Agent가 다음 거래일의 외부 환경을 열고 있습니다.")
                    return advance_world_market(game, progress=report)
                store.update(game_id, advance)
            elif action == "resolve":
                def resolve(game):
                    report(4, "사용자 판단과 공개 이벤트를 같은 시점에 반영합니다.")
                    return resolve_world_decision(game, progress=report)
                store.update(game_id, resolve)
            else:
                def generate_report(game):
                    report(15, "World Agent 사건과 사용자 판단 기록을 분석 중입니다.")
                    game["llm_report"] = generate_llm_scenario_report(game)
                    report(90, "인지 편향 중심 교육 보고서를 저장 중입니다.")
                    return game["llm_report"]
                store.update(game_id, generate_report)

        job = _scenario_jobs().submit(game_id, f"world_{action}", world_operation)
        return jsonify({"success": True, "data": job}), 202

    if action not in ("advance_days", "reveal", "continue", "report"):
        raise TradingError("시나리오 작업은 advance_days, reveal, continue 또는 report여야 합니다.")
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
