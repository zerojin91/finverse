"""Start a prepared MiroFish simulation directly from FINVERSE Python."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil

from agents.mirofish_pipeline import _configure_mirofish_env, _load_dotenv, _resolve_source_root


RUNTIME_ARTIFACTS = (
    "simulation.log",
    "env_status.json",
    "twitter/actions.jsonl",
    "reddit/actions.jsonl",
    "twitter_simulation.db",
    "reddit_simulation.db",
)


def _process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        status = Path(f"/proc/{pid}/status").read_text(encoding="utf-8", errors="replace")
        state_line = next((line for line in status.splitlines() if line.startswith("State:")), "")
        if "Z (zombie)" in state_line or "X (dead)" in state_line:
            return False
    except OSError:
        pass
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def _process_matches_simulation(pid: int, simulation_dir: Path) -> bool:
    """Reject a live-but-recycled PID that belongs to another command."""
    if not _process_alive(pid):
        return False
    cmdline_path = Path(f"/proc/{pid}/cmdline")
    if not cmdline_path.exists():
        # Non-Linux fallback: liveness is the strongest signal available.
        return True
    try:
        command = cmdline_path.read_bytes().replace(b"\0", b" ").decode(
            "utf-8", errors="replace"
        )
    except OSError:
        return False
    expected_config = str((simulation_dir / "simulation_config.json").resolve())
    return "run_parallel_simulation.py" in command and expected_config in command


def _recover_stale_run(simulation_dir: Path) -> bool:
    """Archive a dead attempt and unlock MiroFish's persisted run state."""
    state_path = simulation_dir / "run_state.json"
    if not state_path.exists():
        return False
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return False
    if state.get("runner_status") not in {"running", "starting"}:
        return False
    pid = int(state.get("process_pid", 0) or 0)
    if _process_matches_simulation(pid, simulation_dir):
        return False

    attempt_name = datetime.now(timezone.utc).strftime("interrupted-%Y%m%dT%H%M%S%fZ")
    archive_dir = simulation_dir / "attempts" / attempt_name
    archive_dir.mkdir(parents=True, exist_ok=False)
    shutil.copy2(state_path, archive_dir / "run_state.json")
    for relative_name in RUNTIME_ARTIFACTS:
        source = simulation_dir / relative_name
        if not source.exists():
            continue
        destination = archive_dir / relative_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        source.replace(destination)

    finished_at = datetime.now(timezone.utc).isoformat()
    state.update(
        {
            "runner_status": "stopped",
            "twitter_running": False,
            "reddit_running": False,
            "completed_at": finished_at,
            "updated_at": finished_at,
            "error": "Recovered stale FINVERSE simulation process before retry",
            "process_pid": None,
        }
    )
    temporary_path = state_path.with_suffix(".json.tmp")
    temporary_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_path.replace(state_path)
    return True


def start(input_dir: Path, max_rounds: int) -> dict[str, object]:
    _load_dotenv()
    _configure_mirofish_env()
    source_root = _resolve_source_root()
    workspace = input_dir.resolve() / "mirofish"
    manifest_path = workspace / "mirofish-manifest.json"
    if not manifest_path.exists():
        raise RuntimeError("MiroFish 준비 결과가 없습니다. 먼저 데이터 수집과 시뮬레이션 준비를 완료해주세요.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    simulation_id = str(manifest.get("simulation_id") or "")
    if not simulation_id:
        raise RuntimeError("MiroFish simulation_id를 찾지 못했습니다.")

    from app.config import Config
    from app.models.project import ProjectManager
    from app.services.simulation_manager import SimulationManager
    from app.services.simulation_runner import SimulationRunner

    Config.UPLOAD_FOLDER = str(workspace / "uploads")
    Config.OASIS_SIMULATION_DATA_DIR = str(Path(Config.UPLOAD_FOLDER) / "simulations")
    ProjectManager.PROJECTS_DIR = str(Path(Config.UPLOAD_FOLDER) / "projects")
    SimulationManager.SIMULATION_DATA_DIR = Config.OASIS_SIMULATION_DATA_DIR
    # SimulationRunner keeps its own class-level paths.  Updating Config and
    # SimulationManager alone leaves it looking under the MiroFish source
    # checkout, so a prepared FINVERSE job fails as soon as Start is pressed.
    SimulationRunner.RUN_STATE_DIR = Config.OASIS_SIMULATION_DATA_DIR
    SimulationRunner.SCRIPTS_DIR = str(source_root / "backend" / "scripts")
    recovered_stale_run = _recover_stale_run(
        Path(Config.OASIS_SIMULATION_DATA_DIR) / simulation_id
    )
    manager = SimulationManager()
    state = manager.get_simulation(simulation_id)
    if not state or state.status.value != "ready":
        raise RuntimeError("MiroFish 시뮬레이션이 아직 실행 준비 상태가 아닙니다.")
    run_state = SimulationRunner.start_simulation(
        simulation_id=simulation_id,
        platform="parallel",
        max_rounds=max_rounds,
        enable_graph_memory_update=False,
        graph_id=None,
    )
    return {
        "simulation_id": simulation_id,
        "max_rounds": max_rounds,
        "recovered_stale_run": recovered_stale_run,
        "run_state": run_state.to_dict(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Start a prepared FINVERSE MiroFish simulation.")
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--max-rounds", required=True, type=int)
    args = parser.parse_args()
    if args.max_rounds <= 0:
        raise SystemExit("--max-rounds must be positive")
    print(json.dumps(start(args.input_dir, args.max_rounds), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
