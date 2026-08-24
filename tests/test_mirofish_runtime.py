from __future__ import annotations

import importlib
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

from agents.mirofish_chat import build_context


def test_chat_context_separates_evidence_graph_and_actions(tmp_path: Path) -> None:
    for filename in (
        "market-evidence.md",
        "economic-evidence.md",
        "external-event-evidence.md",
        "psychology-evidence.md",
    ):
        (tmp_path / filename).write_text(
            f"# {filename}\n반도체와 외국인 수급이 KOSPI에 영향을 줍니다.",
            encoding="utf-8",
        )
    graph_dir = tmp_path / "mirofish"
    graph_dir.mkdir()
    (graph_dir / "graph.json").write_text(
        json.dumps(
            {
                "nodes": [
                    {"uuid": "a", "name": "KOSPI", "labels": ["Index"]},
                    {"uuid": "b", "name": "외국인 수급", "labels": ["Flow"]},
                ],
                "edges": [
                    {
                        "source_node_uuid": "b",
                        "target_node_uuid": "a",
                        "name": "INFLUENCES",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    context, sources = build_context(
        tmp_path,
        "반도체 실적과 외국인 수급의 영향",
        "30일",
        "외국인 수급 반응은 어때?",
        {
            "runner_status": "running",
            "current_round": 4,
            "total_rounds": 720,
            "recent_actions": [
                {
                    "round_num": 4,
                    "platform": "twitter",
                    "agent_name": "수급 분석가",
                    "action_type": "CREATE_POST",
                    "action_args": {"content": "외국인 순매수가 회복되고 있습니다."},
                }
            ],
        },
    )

    assert "[market-evidence.md]" in context
    assert "[Neo4j 지식그래프]" in context
    assert "[최근 시뮬레이션 행동]" in context
    assert "외국인 순매수가 회복" in context
    assert "OASIS live simulation actions" in sources


def test_runtime_jsonl_reader_waits_for_complete_line(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINVERSE_SIMULATION_RUNS_DIR", str(tmp_path / "runs"))
    import services.finverse_simulation_api as simulation_api

    simulation_api = importlib.reload(simulation_api)
    path = tmp_path / "actions.jsonl"
    first = json.dumps({"event_type": "round_end", "round": 1})
    second = json.dumps({"event_type": "round_end", "round": 2})
    path.write_bytes((first + "\n" + second[:8]).encode("utf-8"))

    records, position = simulation_api._read_new_runtime_records(path, 0)
    assert records == [{"event_type": "round_end", "round": 1}]

    with path.open("ab") as output:
        output.write((second[8:] + "\n").encode("utf-8"))
    next_records, next_position = simulation_api._read_new_runtime_records(path, position)
    assert next_records == [{"event_type": "round_end", "round": 2}]
    assert next_position == path.stat().st_size


def test_process_alive_rejects_linux_zombie(monkeypatch) -> None:
    import services.finverse_simulation_api as simulation_api

    monkeypatch.setattr(simulation_api, "_linux_process_state", lambda pid: "Z")

    assert simulation_api._process_alive(1234) is False


def test_cgroup_oom_kill_count_reads_memory_events(tmp_path: Path) -> None:
    import services.finverse_simulation_api as simulation_api

    events = tmp_path / "memory.events"
    events.write_text("low 0\nhigh 0\noom 4\noom_kill 3\n", encoding="utf-8")

    assert simulation_api._cgroup_oom_kill_count(events) == 3


def test_runtime_request_reconciles_dead_process_to_retryable_failure(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("FINVERSE_SIMULATION_RUNS_DIR", str(tmp_path / "runs"))
    import services.finverse_simulation_api as simulation_api

    simulation_api = importlib.reload(simulation_api)
    job = {
        "id": "fv-sim-333333333333",
        "fingerprint": "fingerprint",
        "query": "코스피 시뮬레이션 질문",
        "period": "30일",
        "status": "running",
        "created_at": "2026-08-25T00:00:00+00:00",
        "updated_at": "2026-08-25T00:00:00+00:00",
        "next_event": 1,
        "events": [],
        "result": {"simulation_id": "sim_test"},
        "simulation": {"simulation_id": "sim_test"},
        "runtime": {
            "simulation_id": "sim_test",
            "runner_status": "running",
            "process_pid": 4321,
            "process_start_ticks": "10",
        },
        "chat_messages": [],
        "error": None,
    }
    simulation_api.jobs[job["id"]] = job
    monkeypatch.setattr(simulation_api, "_process_alive", lambda pid, expected=None: False)
    monkeypatch.setattr(simulation_api, "_linux_process_state", lambda pid: "Z")
    monkeypatch.setattr(simulation_api, "_runtime_log_tail", lambda path: "runner stopped")

    client = simulation_api.app.test_client()
    response = client.get(f"/v1/scenario-jobs/{job['id']}/runtime")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "failed"
    assert payload["runtime"]["runner_status"] == "failed"
    assert payload["runtime"]["failure_reason"] == "process_zombie"
    assert payload["chat_ready"] is False
    assert "다시 시작" in payload["error"]
    assert job["events"][-1]["type"] == "error"


def test_start_rejects_second_active_simulation(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FINVERSE_SIMULATION_RUNS_DIR", str(tmp_path / "runs"))
    import services.finverse_simulation_api as simulation_api

    simulation_api = importlib.reload(simulation_api)
    active_job = {
        "id": "fv-sim-111111111111",
        "status": "starting",
        "runtime": {"runner_status": "starting"},
    }
    ready_job = {
        "id": "fv-sim-222222222222",
        "query": "코스피 시뮬레이션 질문",
        "period": "30일",
        "status": "ready",
        "result": {"simulation_id": "sim_ready"},
        "runtime": None,
        "events": [],
        "next_event": 1,
        "error": None,
    }
    simulation_api.jobs.update({
        active_job["id"]: active_job,
        ready_job["id"]: ready_job,
    })

    client = simulation_api.app.test_client()
    response = client.post(f"/v1/scenario-jobs/{ready_job['id']}/start")

    assert response.status_code == 409
    payload = response.get_json()
    assert payload["active_job_id"] == active_job["id"]
    assert ready_job["status"] == "ready"


def test_start_uses_finverse_workspace_for_runner_paths(tmp_path: Path, monkeypatch) -> None:
    from agents import mirofish_start

    workspace = tmp_path / "mirofish"
    workspace.mkdir()
    (workspace / "mirofish-manifest.json").write_text(
        json.dumps({"simulation_id": "sim_test"}),
        encoding="utf-8",
    )
    source_root = tmp_path / "MiroFish-Offline"
    (source_root / "backend" / "scripts").mkdir(parents=True)
    monkeypatch.setattr(mirofish_start, "_load_dotenv", lambda: None)
    monkeypatch.setattr(mirofish_start, "_configure_mirofish_env", lambda: None)
    monkeypatch.setattr(mirofish_start, "_resolve_source_root", lambda: source_root)

    class FakeConfig:
        UPLOAD_FOLDER = ""
        OASIS_SIMULATION_DATA_DIR = ""

    class FakeProjectManager:
        PROJECTS_DIR = ""

    class FakeSimulationManager:
        SIMULATION_DATA_DIR = ""

        def get_simulation(self, simulation_id: str):
            assert simulation_id == "sim_test"
            return SimpleNamespace(status=SimpleNamespace(value="ready"))

    class FakeRunState:
        def to_dict(self):
            return {"process_pid": 1234, "status": "running"}

    class FakeSimulationRunner:
        RUN_STATE_DIR = ""
        SCRIPTS_DIR = ""

        @classmethod
        def start_simulation(cls, **kwargs):
            assert kwargs == {
                "simulation_id": "sim_test",
                "platform": "parallel",
                "max_rounds": 12,
                "enable_graph_memory_update": False,
                "graph_id": None,
            }
            assert cls.RUN_STATE_DIR == str(workspace / "uploads" / "simulations")
            assert cls.SCRIPTS_DIR == str(source_root / "backend" / "scripts")
            return FakeRunState()

    modules = {
        "app": ModuleType("app"),
        "app.config": ModuleType("app.config"),
        "app.models": ModuleType("app.models"),
        "app.models.project": ModuleType("app.models.project"),
        "app.services": ModuleType("app.services"),
        "app.services.simulation_manager": ModuleType("app.services.simulation_manager"),
        "app.services.simulation_runner": ModuleType("app.services.simulation_runner"),
    }
    modules["app.config"].Config = FakeConfig
    modules["app.models.project"].ProjectManager = FakeProjectManager
    modules["app.services.simulation_manager"].SimulationManager = FakeSimulationManager
    modules["app.services.simulation_runner"].SimulationRunner = FakeSimulationRunner
    for name, module in modules.items():
        monkeypatch.setitem(sys.modules, name, module)

    result = mirofish_start.start(tmp_path, 12)

    assert result["simulation_id"] == "sim_test"
    assert result["recovered_stale_run"] is False
    assert result["run_state"] == {"process_pid": 1234, "status": "running"}


def test_start_archives_dead_mirofish_attempt_before_retry(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from agents import mirofish_start

    simulation_dir = tmp_path / "sim_dead"
    (simulation_dir / "twitter").mkdir(parents=True)
    (simulation_dir / "reddit").mkdir(parents=True)
    (simulation_dir / "run_state.json").write_text(
        json.dumps(
            {
                "simulation_id": "sim_dead",
                "runner_status": "running",
                "process_pid": 99999,
                "twitter_running": True,
                "reddit_running": True,
            }
        ),
        encoding="utf-8",
    )
    (simulation_dir / "simulation.log").write_text("old log", encoding="utf-8")
    (simulation_dir / "twitter" / "actions.jsonl").write_text("old action\n", encoding="utf-8")
    monkeypatch.setattr(mirofish_start, "_process_alive", lambda pid: False)

    assert mirofish_start._recover_stale_run(simulation_dir) is True

    state = json.loads((simulation_dir / "run_state.json").read_text(encoding="utf-8"))
    assert state["runner_status"] == "stopped"
    assert state["process_pid"] is None
    assert state["twitter_running"] is False
    archives = list((simulation_dir / "attempts").glob("interrupted-*"))
    assert len(archives) == 1
    assert (archives[0] / "run_state.json").exists()
    assert (archives[0] / "simulation.log").read_text(encoding="utf-8") == "old log"
    assert (archives[0] / "twitter" / "actions.jsonl").exists()
    assert not (simulation_dir / "simulation.log").exists()
    assert not (simulation_dir / "twitter" / "actions.jsonl").exists()


def test_start_does_not_unlock_matching_live_simulation(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from agents import mirofish_start

    simulation_dir = tmp_path / "sim_live"
    simulation_dir.mkdir()
    state_path = simulation_dir / "run_state.json"
    state_path.write_text(
        json.dumps(
            {
                "simulation_id": "sim_live",
                "runner_status": "running",
                "process_pid": 42,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        mirofish_start,
        "_process_matches_simulation",
        lambda pid, directory: True,
    )

    assert mirofish_start._recover_stale_run(simulation_dir) is False
    assert json.loads(state_path.read_text(encoding="utf-8"))["runner_status"] == "running"
    assert not (simulation_dir / "attempts").exists()
