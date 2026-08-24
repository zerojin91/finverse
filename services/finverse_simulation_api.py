"""HTTP job API for the FINVERSE Neo4j + MiroFish simulation runtime.

This service runs beside Neo4j on the collector server.  It deliberately keeps
the public contract FINVERSE-specific while using the locally installed
MiroFish-Offline service layer for ontology, graph, persona, and OASIS work.
"""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from typing import Any
from uuid import uuid4

from flask import Flask, Response, jsonify, request


ROOT = Path(__file__).resolve().parents[1]
RUNS_ROOT = Path(os.environ.get("FINVERSE_SIMULATION_RUNS_DIR", "/var/lib/finverse-simulation/runs"))
EVIDENCE_FILES = {
    "market-evidence.md",
    "economic-evidence.md",
    "external-event-evidence.md",
    "psychology-evidence.md",
}
MAX_EVIDENCE_BYTES = 2_000_000
MAX_EVENTS = 600
MAX_RUNTIME_LINE_CHARS = 2_000
MAX_RECENT_ACTIONS = 80
MAX_CHAT_MESSAGES = 40
PIPELINE_VERSION = os.environ.get(
    "FINVERSE_SIMULATION_PIPELINE_VERSION",
    "2026-08-24-mirofish-adapter-v2",
)
jobs: dict[str, dict[str, Any]] = {}
# Job creation records its first event while holding this lock.  The event
# writer also persists under the same lock, so a re-entrant lock is required
# to avoid deadlocking the POST /v1/scenario-jobs request before it returns.
jobs_lock = threading.RLock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_path(job_id: str) -> Path:
    return RUNS_ROOT / job_id


def _bounded_runtime_line(line: str) -> str:
    if len(line) <= MAX_RUNTIME_LINE_CHARS:
        return line
    omitted = len(line) - MAX_RUNTIME_LINE_CHARS
    return f"{line[:MAX_RUNTIME_LINE_CHARS]} … [truncated {omitted} chars]"


def _write_job(job: dict[str, Any]) -> None:
    workspace = _job_path(job["id"])
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_persisted_jobs() -> int:
    """Restore durable job metadata after an API container restart."""
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    restored = 0
    for metadata_path in RUNS_ROOT.glob("fv-sim-*/job.json"):
        try:
            job = json.loads(metadata_path.read_text(encoding="utf-8"))
            job_id = str(job.get("id", ""))
            if not re.fullmatch(r"fv-sim-[0-9a-f]{12}", job_id):
                continue
            if metadata_path.parent.name != job_id:
                continue
            events = job.get("events") if isinstance(job.get("events"), list) else []
            job["events"] = events[-MAX_EVENTS:]
            job.setdefault("simulation", None)
            job.setdefault("runtime", None)
            job["chat_messages"] = (
                job.get("chat_messages")[-MAX_CHAT_MESSAGES:]
                if isinstance(job.get("chat_messages"), list)
                else []
            )
            job["next_event"] = max(
                int(job.get("next_event", 1)),
                max((int(item.get("seq", 0)) for item in job["events"] if isinstance(item, dict)), default=0) + 1,
            )
            # A preparation/simulation subprocess cannot survive a container
            # restart. Keep completed jobs reusable, but make interrupted jobs
            # explicitly retryable instead of leaving them stuck forever.
            if job.get("status") in {"queued", "preparing", "starting", "running"}:
                job["status"] = "failed"
                job["error"] = "Simulation API restarted before the active subprocess completed"
                runtime = job.get("runtime") if isinstance(job.get("runtime"), dict) else {}
                if runtime:
                    runtime["runner_status"] = "failed"
                    runtime["failure_reason"] = "api_restarted"
                    runtime["completed_at"] = _now()
                    runtime["updated_at"] = runtime["completed_at"]
                    job["runtime"] = runtime
                interrupted_event = {
                    "seq": job["next_event"],
                    "type": "error",
                    "at": _now(),
                    "message": job["error"],
                }
                job["next_event"] += 1
                job["events"] = [*job["events"], interrupted_event][-MAX_EVENTS:]
                job["updated_at"] = interrupted_event["at"]
            jobs[job_id] = job
            _write_job(job)
            restored += 1
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            continue
    return restored


def _event(job: dict[str, Any], event_type: str, **payload: Any) -> None:
    with jobs_lock:
        event = {"seq": job["next_event"], "type": event_type, "at": _now(), **payload}
        job["next_event"] += 1
        job["events"] = [*job["events"], event][-MAX_EVENTS:]
        job["updated_at"] = event["at"]
        _write_job(job)


def _safe_evidence(body: dict[str, Any]) -> list[dict[str, str]]:
    evidence = body.get("evidence")
    if not isinstance(evidence, list):
        raise ValueError("evidence must be an array of FINVERSE Evidence documents")
    documents: list[dict[str, str]] = []
    names: set[str] = set()
    for item in evidence:
        if not isinstance(item, dict):
            raise ValueError("each evidence item must be an object")
        name, content = item.get("name"), item.get("content")
        if name not in EVIDENCE_FILES or not isinstance(content, str) or not content.strip():
            raise ValueError("evidence contains an invalid or empty FINVERSE document")
        if len(content.encode("utf-8")) > MAX_EVIDENCE_BYTES:
            raise ValueError(f"{name} is too large")
        if name in names:
            raise ValueError(f"duplicate evidence document: {name}")
        names.add(name)
        documents.append({"name": name, "content": content})
    if names != EVIDENCE_FILES:
        raise ValueError("all four FINVERSE Evidence documents are required")
    return documents


def _authorized() -> bool:
    expected = os.environ.get("FINVERSE_SIMULATION_API_TOKEN", "").strip()
    return not expected or request.headers.get("Authorization", "") == f"Bearer {expected}"


def _simulation_workspace(job: dict[str, Any], simulation_id: str | None = None) -> Path:
    resolved_id = simulation_id or str((job.get("result") or {}).get("simulation_id") or "")
    return _job_path(job["id"]) / "mirofish" / "uploads" / "simulations" / resolved_id


def _linux_process_state(pid: int) -> str | None:
    """Return the one-letter Linux process state when ``/proc`` is available."""
    try:
        status = Path(f"/proc/{pid}/status").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    match = re.search(r"^State:\s+([A-Z])", status, flags=re.MULTILINE)
    return match.group(1) if match else None


def _linux_process_start_ticks(pid: int) -> str | None:
    """Read Linux start ticks so a recycled PID is not mistaken for our runner."""
    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8", errors="replace")
        fields_after_name = stat[stat.rfind(")") + 2 :].split()
        return fields_after_name[19]
    except (OSError, IndexError):
        return None


def _process_alive(pid: int | None, expected_start_ticks: str | None = None) -> bool:
    if not pid or pid <= 0:
        return False
    # os.kill(pid, 0) also succeeds for a zombie. A finished OASIS child can
    # therefore look alive forever unless /proc is checked explicitly.
    if _linux_process_state(pid) in {"Z", "X"}:
        return False
    if expected_start_ticks:
        current_start_ticks = _linux_process_start_ticks(pid)
        if current_start_ticks and current_start_ticks != expected_start_ticks:
            return False
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def _read_new_runtime_records(path: Path, position: int) -> tuple[list[dict[str, Any]], int]:
    """Read only complete JSONL records appended after ``position``."""
    if not path.exists():
        return [], position
    records: list[dict[str, Any]] = []
    try:
        with path.open("rb") as source:
            source.seek(position)
            while True:
                line_start = source.tell()
                raw = source.readline()
                if not raw:
                    break
                # The simulation may still be writing the current record. Read
                # it again on the next poll instead of treating it as corrupt.
                if not raw.endswith(b"\n"):
                    source.seek(line_start)
                    break
                try:
                    value = json.loads(raw.decode("utf-8", errors="replace"))
                    if isinstance(value, dict):
                        records.append(value)
                except json.JSONDecodeError:
                    continue
            return records, source.tell()
    except OSError:
        return [], position


def _runtime_action(record: dict[str, Any], platform: str) -> dict[str, Any]:
    args = record.get("action_args") if isinstance(record.get("action_args"), dict) else {}
    return {
        "round_num": int(record.get("round", 0) or 0),
        "timestamp": str(record.get("timestamp") or _now()),
        "platform": platform,
        "agent_id": int(record.get("agent_id", 0) or 0),
        "agent_name": str(record.get("agent_name") or f"Agent {record.get('agent_id', 0)}"),
        "action_type": str(record.get("action_type") or "ACTION"),
        "action_args": args,
        "result": record.get("result"),
        "success": bool(record.get("success", True)),
    }


def _runtime_log_tail(simulation_dir: Path) -> str:
    try:
        return (simulation_dir / "simulation.log").read_text(
            encoding="utf-8", errors="replace"
        )[-4_000:]
    except OSError:
        return ""


def _cgroup_oom_kill_count(path: Path | None = None) -> int:
    """Read the container's cumulative OOM-kill counter when cgroup v2 exists."""
    events_path = path or Path("/sys/fs/cgroup/memory.events")
    try:
        for line in events_path.read_text(encoding="utf-8", errors="replace").splitlines():
            key, _, value = line.partition(" ")
            if key == "oom_kill":
                return int(value.strip() or 0)
    except (OSError, ValueError):
        pass
    return 0


def _fail_runtime(
    job: dict[str, Any],
    *,
    reason: str,
    message: str,
    detail: str = "",
) -> None:
    """Persist one terminal failure state and make the prepared job retryable."""
    runtime = job.get("runtime") if isinstance(job.get("runtime"), dict) else {}
    finished_at = _now()
    runtime.update(
        {
            "runner_status": "failed",
            "failure_reason": reason,
            "completed_at": finished_at,
            "updated_at": finished_at,
        }
    )
    job["status"] = "failed"
    job["runtime"] = runtime
    job["error"] = message
    if not (
        job.get("events")
        and job["events"][-1].get("type") == "error"
        and job["events"][-1].get("message") == message
    ):
        payload: dict[str, Any] = {"message": message, "reason": reason}
        if detail:
            payload["detail"] = _bounded_runtime_line(detail)
        _event(job, "error", **payload)
    else:
        _write_job(job)


def _reconcile_runtime_state(job: dict[str, Any]) -> bool:
    """Correct a persisted ``running`` state when its OS process has ended."""
    if job.get("status") != "running":
        return False
    runtime = job.get("runtime") if isinstance(job.get("runtime"), dict) else {}
    pid = int(runtime.get("process_pid", 0) or 0)
    expected_start_ticks = str(runtime.get("process_start_ticks") or "") or None
    if _process_alive(pid, expected_start_ticks):
        return False
    simulation_id = str(runtime.get("simulation_id") or "")
    detail = _runtime_log_tail(_simulation_workspace(job, simulation_id))
    state = _linux_process_state(pid) if pid else None
    reason = "process_zombie" if state == "Z" else "process_exited"
    _fail_runtime(
        job,
        reason=reason,
        message="시뮬레이션 실행 프로세스가 완료 이벤트 없이 종료되었습니다. 다시 시작해 주세요.",
        detail=detail,
    )
    return True


def _active_simulation_job(exclude_job_id: str | None = None) -> dict[str, Any] | None:
    """Return the one live/starting simulation allowed on this 4 GB host."""
    for candidate in jobs.values():
        if candidate.get("id") == exclude_job_id:
            continue
        if candidate.get("status") == "running":
            _reconcile_runtime_state(candidate)
        if candidate.get("status") in {"starting", "running"}:
            return candidate
    return None


def _monitor_simulation(job: dict[str, Any], simulation_id: str, total_rounds: int, process_pid: int | None) -> None:
    """Publish live OASIS rounds and actions from the original MiroFish logs."""
    simulation_dir = _simulation_workspace(job, simulation_id)
    positions = {"twitter": 0, "reddit": 0}
    runtime: dict[str, Any] = {
        "simulation_id": simulation_id,
        "runner_status": "running",
        "current_round": 0,
        "total_rounds": total_rounds,
        "progress_percent": 0.0,
        "simulated_hours": 0,
        "twitter_current_round": 0,
        "reddit_current_round": 0,
        "twitter_actions_count": 0,
        "reddit_actions_count": 0,
        "total_actions_count": 0,
        "twitter_completed": False,
        "reddit_completed": False,
        "env_alive": False,
        "recent_actions": [],
        "active_batch": None,
        "started_at": _now(),
        "updated_at": _now(),
        "completed_at": None,
        "process_pid": process_pid,
        "process_start_ticks": _linux_process_start_ticks(process_pid or 0),
        "oom_kill_count_at_start": _cgroup_oom_kill_count(),
    }
    with jobs_lock:
        job["runtime"] = runtime
        _write_job(job)

    last_signature: tuple[Any, ...] | None = None
    while True:
        changed = False
        for platform in ("twitter", "reddit"):
            records, positions[platform] = _read_new_runtime_records(
                simulation_dir / platform / "actions.jsonl",
                positions[platform],
            )
            for record in records:
                event_type = record.get("event_type")
                if event_type == "round_end":
                    round_num = int(record.get("round", 0) or 0)
                    runtime[f"{platform}_current_round"] = max(
                        int(runtime[f"{platform}_current_round"]), round_num
                    )
                    runtime["simulated_hours"] = max(
                        int(runtime.get("simulated_hours", 0)),
                        int(record.get("simulated_hours", 0) or 0),
                    )
                    changed = True
                    continue
                if event_type == "simulation_end":
                    runtime[f"{platform}_completed"] = True
                    changed = True
                    continue
                if event_type or "agent_id" not in record:
                    continue
                action = _runtime_action(record, platform)
                runtime[f"{platform}_actions_count"] = int(
                    runtime[f"{platform}_actions_count"]
                ) + 1
                runtime["recent_actions"] = [
                    action,
                    *runtime.get("recent_actions", []),
                ][:MAX_RECENT_ACTIONS]
                changed = True

        runtime["current_round"] = max(
            int(runtime["twitter_current_round"]),
            int(runtime["reddit_current_round"]),
        )
        runtime["total_actions_count"] = int(runtime["twitter_actions_count"]) + int(
            runtime["reddit_actions_count"]
        )
        runtime["progress_percent"] = round(
            min(100.0, runtime["current_round"] / max(total_rounds, 1) * 100), 1
        )
        env_status = _load_json_file(simulation_dir / "env_status.json")
        runtime["env_alive"] = env_status.get("status") == "alive"
        batch_progress = _load_json_file(
            simulation_dir / "finverse_batch_progress.json"
        )
        runtime["active_batch"] = batch_progress or None
        runtime["updated_at"] = _now()
        completed = bool(runtime["twitter_completed"] and runtime["reddit_completed"])
        alive = _process_alive(process_pid, runtime.get("process_start_ticks"))
        signature = (
            runtime["current_round"],
            runtime["total_actions_count"],
            runtime["twitter_completed"],
            runtime["reddit_completed"],
            runtime["env_alive"],
            batch_progress.get("status"),
            batch_progress.get("label"),
            batch_progress.get("started_at"),
            alive,
        )
        if signature != last_signature or changed:
            last_signature = signature
            with jobs_lock:
                job["runtime"] = runtime
                _event(
                    job,
                    "simulation_progress",
                    current_round=runtime["current_round"],
                    total_rounds=total_rounds,
                    progress_percent=runtime["progress_percent"],
                    total_actions_count=runtime["total_actions_count"],
                    env_alive=runtime["env_alive"],
                    active_batch=runtime["active_batch"],
                )

        # simulation_end from both platform logs is the authoritative completion
        # signal. env_status.json may be absent when IPC was never initialized.
        if completed:
            runtime["runner_status"] = "completed"
            runtime["progress_percent"] = 100.0
            runtime["completed_at"] = _now()
            with jobs_lock:
                job["status"] = "completed"
                job["runtime"] = runtime
                _event(
                    job,
                    "simulation_completed",
                    message="시장 시나리오 실행이 완료되어 대화를 시작할 수 있습니다.",
                    total_actions_count=runtime["total_actions_count"],
                )
            return
        if not alive:
            detail = _runtime_log_tail(simulation_dir)
            oom_kill_count = _cgroup_oom_kill_count()
            out_of_memory = oom_kill_count > int(runtime.get("oom_kill_count_at_start", 0) or 0)
            with jobs_lock:
                _fail_runtime(
                    job,
                    reason=(
                        "out_of_memory"
                        if out_of_memory
                        else "process_zombie"
                        if _linux_process_state(process_pid or 0) == "Z"
                        else "process_exited"
                    ),
                    message=(
                        "서버 메모리가 부족해 시뮬레이션 프로세스가 종료되었습니다. 동시 실행 수를 낮춘 뒤 다시 시작해 주세요."
                        if out_of_memory
                        else "시뮬레이션 실행 프로세스가 완료 이벤트 없이 종료되었습니다. 다시 시작해 주세요."
                    ),
                    detail=detail,
                )
            return
        time.sleep(1.5)


def _load_json_file(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError, TypeError):
        return {}


def _run_pipeline(job: dict[str, Any]) -> None:
    workspace = _job_path(job["id"])
    requirement = f"{job['query']}\n\n예측 기간: {job['period']}. 이 기간을 기준으로 근거·불확실성·확인 지표를 정리한다."
    command = [sys.executable, "-u", "-m", "agents.mirofish_pipeline", "--input-dir", str(workspace), "--requirement", requirement, "--project-name", "FINVERSE 시장 시나리오"]
    _event(job, "stage", stage=2, status="running", message="수집된 Evidence로 온톨로지를 생성하고 있습니다.")
    try:
        process = subprocess.Popen(command, cwd=ROOT, env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        assert process.stdout is not None
        for raw in process.stdout:
            line = raw.strip()
            if not line:
                continue
            marker = "mirofish_pipeline | "
            if line.startswith(marker):
                try:
                    payload = json.loads(line[len(marker):])
                    kind = payload.pop("event", "log")
                    if kind in {"stage", "progress"}:
                        _event(job, "stage", **payload)
                    elif kind == "graph_snapshot":
                        _event(job, "graph_snapshot", **payload)
                    elif kind == "pipeline_complete":
                        job["result"] = payload
                        _event(job, "ready", **payload)
                    elif kind == "pipeline_error":
                        _event(job, "log", source="stderr", line=payload.get("error", "Simulation preparation failed"))
                    continue
                except json.JSONDecodeError:
                    pass
            _event(job, "log", source="runtime", line=_bounded_runtime_line(line))
        if process.wait() != 0 or not job.get("result"):
            raise RuntimeError("Neo4j simulation preparation did not complete")
        job["status"] = "ready"
        _event(job, "complete", message="Neo4j 지식그래프와 시뮬레이션 준비가 완료되었습니다.")
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = f"{type(exc).__name__}: {exc}"
        _event(job, "error", message=job["error"])
    finally:
        _write_job(job)


def _start_simulation(job: dict[str, Any]) -> None:
    workspace = _job_path(job["id"])
    rounds = {"7일": 168, "30일": 720, "3개월": 2160}[job["period"]]
    try:
        process = subprocess.run([sys.executable, "-u", "-m", "agents.mirofish_start", "--input-dir", str(workspace), "--max-rounds", str(rounds)], cwd=ROOT, env={**os.environ, "PYTHONUTF8": "1"}, text=True, capture_output=True, encoding="utf-8", errors="replace", check=True)
        payload = json.loads(process.stdout.strip().splitlines()[-1]) if process.stdout.strip() else {}
        simulation_id = str(payload.get("simulation_id") or "")
        run_state = payload.get("run_state") if isinstance(payload.get("run_state"), dict) else {}
        process_pid = int(run_state.get("process_pid", 0) or 0)
        if not simulation_id or not process_pid:
            raise RuntimeError("MiroFish가 유효한 simulation_id 또는 process_pid를 반환하지 않았습니다.")
        with jobs_lock:
            job["simulation"] = payload
            job["status"] = "running"
            job["error"] = None
            _event(job, "simulation_started", **payload)
        _monitor_simulation(job, simulation_id, rounds, process_pid)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        with jobs_lock:
            job["status"] = "failed"
            job["error"] = f"MiroFish start failed: {_bounded_runtime_line(detail)}"
            _event(job, "error", message=job["error"])
    except Exception as exc:
        with jobs_lock:
            job["status"] = "failed"
            job["error"] = f"{type(exc).__name__}: {exc}"
            _event(job, "error", message=job["error"])
    finally:
        _write_job(job)


app = Flask("finverse-simulation-api")
_load_persisted_jobs()


@app.before_request
def require_token() -> Response | None:
    if request.path == "/health":
        return None
    if not _authorized():
        return jsonify({"error": "unauthorized"}), 401
    return None


@app.get("/health")
def health() -> Response:
    return jsonify({"status": "ok", "service": "finverse-simulation-api", "pipeline_version": PIPELINE_VERSION, "neo4j_uri": os.environ.get("NEO4J_URI", "")})


@app.post("/v1/scenario-jobs")
def create_job() -> Response:
    try:
        body = request.get_json(force=True)
        if not isinstance(body, dict):
            raise ValueError("JSON object required")
        query, period = str(body.get("query", "")).strip(), str(body.get("period", "")).strip()
        if not 8 <= len(query) <= 1_200 or period not in {"7일", "30일", "3개월"}:
            raise ValueError("query or period is invalid")
        evidence = _safe_evidence(body)
        fingerprint = sha256(json.dumps({"pipeline_version": PIPELINE_VERSION, "query": query, "period": period, "evidence": evidence}, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        with jobs_lock:
            reusable = next((item for item in jobs.values() if item["fingerprint"] == fingerprint and item["status"] in {"queued", "preparing", "ready", "starting", "running", "completed"}), None)
            if reusable:
                return jsonify({"job_id": reusable["id"], "status": reusable["status"], "reused": True}), 200
            job_id = f"fv-sim-{uuid4().hex[:12]}"
            job = {"id": job_id, "fingerprint": fingerprint, "pipeline_version": PIPELINE_VERSION, "query": query, "period": period, "status": "preparing", "created_at": _now(), "updated_at": _now(), "next_event": 1, "events": [], "result": None, "simulation": None, "runtime": None, "chat_messages": [], "error": None}
            jobs[job_id] = job
            workspace = _job_path(job_id)
            workspace.mkdir(parents=True, exist_ok=True)
            for document in evidence:
                (workspace / document["name"]).write_text(document["content"], encoding="utf-8")
            _event(job, "accepted", message="FINVERSE 시뮬레이션 작업을 생성했습니다.")
        threading.Thread(target=_run_pipeline, args=(job,), daemon=True).start()
        return jsonify({"job_id": job_id, "status": "preparing", "reused": False}), 202
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@app.get("/v1/scenario-jobs/<job_id>")
def get_job(job_id: str) -> Response:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "job not found"}), 404
        _reconcile_runtime_state(job)
        after = max(0, int(request.args.get("after", "0")))
        events = [item for item in job["events"] if item["seq"] > after]
        return jsonify({key: value for key, value in job.items() if key != "fingerprint"} | {"events": events})


@app.get("/v1/scenario-jobs/<job_id>/graph")
def get_graph(job_id: str) -> Response:
    if job_id not in jobs:
        return jsonify({"error": "job not found"}), 404
    graph_path = _job_path(job_id) / "mirofish" / "graph.json"
    if not graph_path.exists():
        return jsonify({"error": "graph is not ready"}), 409
    return Response(graph_path.read_text(encoding="utf-8"), content_type="application/json; charset=utf-8")


@app.post("/v1/scenario-jobs/<job_id>/start")
def start_job(job_id: str) -> Response:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "job not found"}), 404
        _reconcile_runtime_state(job)
        if job["status"] in {"starting", "running", "completed"}:
            return jsonify({"job_id": job_id, "status": job["status"], "reused": True})
        retryable_failure = job["status"] == "failed" and bool(job.get("result"))
        if job["status"] != "ready" and not retryable_failure:
            return jsonify({"error": "job is not ready to start"}), 409
        active_job = _active_simulation_job(exclude_job_id=job_id)
        if active_job is not None:
            return jsonify({
                "error": "다른 시뮬레이션이 이미 실행 중입니다. 완료된 뒤 다시 시작해 주세요.",
                "active_job_id": active_job.get("id"),
                "status": active_job.get("status"),
            }), 409
        job["status"] = "starting"
        job["error"] = None
        job["runtime"] = {
            "simulation_id": str((job.get("result") or {}).get("simulation_id") or ""),
            "runner_status": "starting",
            "current_round": 0,
            "total_rounds": {"7일": 168, "30일": 720, "3개월": 2160}[job["period"]],
            "progress_percent": 0.0,
            "total_actions_count": 0,
            "recent_actions": [],
            "env_alive": False,
            "started_at": _now(),
            "updated_at": _now(),
        }
        _event(job, "simulation_starting", message="MiroFish 실행 환경을 시작하고 있습니다.")
        threading.Thread(target=_start_simulation, args=(job,), daemon=True).start()
        return jsonify({"job_id": job_id, "status": "starting"}), 202


@app.get("/v1/scenario-jobs/<job_id>/runtime")
def get_runtime(job_id: str) -> Response:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "job not found"}), 404
        _reconcile_runtime_state(job)
        simulation_id = str(
            ((job.get("simulation") or {}).get("simulation_id"))
            or ((job.get("result") or {}).get("simulation_id"))
            or ""
        )
        runtime = job.get("runtime") if isinstance(job.get("runtime"), dict) else None
        return jsonify({
            "job_id": job_id,
            "status": job["status"],
            "query": job["query"],
            "period": job["period"],
            "simulation_id": simulation_id,
            "runtime": runtime,
            "chat_ready": bool(simulation_id and job["status"] in {"running", "completed"}),
            "chat_messages": job.get("chat_messages", [])[-MAX_CHAT_MESSAGES:],
            "error": job.get("error"),
            "updated_at": job.get("updated_at"),
        })


@app.post("/v1/scenario-jobs/<job_id>/chat")
def chat_with_job(job_id: str) -> Response:
    body = request.get_json(silent=True) or {}
    message = str(body.get("message") or "").strip()
    if not 1 <= len(message) <= 2_000:
        return jsonify({"error": "message must contain 1 to 2000 characters"}), 400
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "job not found"}), 404
        if job["status"] not in {"running", "completed"}:
            return jsonify({"error": "simulation has not started"}), 409
        history = [
            {"role": str(item.get("role")), "content": str(item.get("content"))}
            for item in job.get("chat_messages", [])[-16:]
            if isinstance(item, dict) and item.get("role") in {"user", "assistant"}
        ]
        query = str(job["query"])
        period = str(job["period"])
        runtime = dict(job.get("runtime") or {})
        workspace = _job_path(job_id)
    try:
        from agents.mirofish_chat import chat as answer_simulation_question

        result = answer_simulation_question(
            workspace,
            query,
            period,
            message,
            history=history,
            runtime=runtime,
        )
        user_message = {
            "id": f"chat_{uuid4().hex[:12]}",
            "role": "user",
            "content": message,
            "at": _now(),
        }
        assistant_message = {
            "id": f"chat_{uuid4().hex[:12]}",
            "role": "assistant",
            "content": str(result.get("response") or ""),
            "sources": result.get("sources") or [],
            "model": result.get("model") or "",
            "at": result.get("generated_at") or _now(),
        }
        with jobs_lock:
            job = jobs[job_id]
            job["chat_messages"] = [
                *job.get("chat_messages", []),
                user_message,
                assistant_message,
            ][-MAX_CHAT_MESSAGES:]
            _event(job, "chat_completed", message_id=assistant_message["id"])
        return jsonify({"message": assistant_message})
    except Exception as exc:
        return jsonify({"error": f"{type(exc).__name__}: {exc}"}), 502


if __name__ == "__main__":
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    app.run(host="0.0.0.0", port=int(os.environ.get("FINVERSE_SIMULATION_API_PORT", "8010")), threaded=True)
