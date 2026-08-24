"""Run the MiroFish preparation pipeline directly from FINVERSE.

This module deliberately calls the MiroFish-Offline Python services instead of
its Flask routes.  It consumes the evidence markdown files written by
``agents.ontology_a2a`` and creates the following local artifacts:

1. ontology definition
2. Neo4j knowledge graph
3. OASIS agent profiles
4. simulation configuration and initial-activation plan

The final OASIS simulation is intentionally *not* started here.  A later UI
action can invoke the saved simulation id through a separate runner.

Run:
    uv run python -m agents.mirofish_pipeline --input-dir output/.../query
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import traceback
from typing import Any
from werkzeug.datastructures import FileStorage


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_FILES = (
    "market-evidence.md",
    "economic-evidence.md",
    "external-event-evidence.md",
    "psychology-evidence.md",
)


def _load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _emit(event: str, **fields: Any) -> None:
    """Write one machine-readable progress record for the bridge/UI."""
    payload = {"event": event, **fields}
    print(f"mirofish_pipeline | {json.dumps(payload, ensure_ascii=False, default=str)}", flush=True)


def _resolve_source_root() -> Path:
    configured = os.environ.get("MIROFISH_OFFLINE_PATH", "").strip()
    source_root = Path(configured) if configured else ROOT.parent / "MiroFish-Offline"
    source_root = source_root.expanduser().resolve()
    backend_root = source_root / "backend"
    if not (backend_root / "app").is_dir():
        raise RuntimeError(
            "MiroFish-Offline 소스를 찾지 못했습니다. "
            "MIROFISH_OFFLINE_PATH에 MiroFish-Offline 폴더 경로를 설정해주세요."
        )
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))
    return source_root


def _configure_mirofish_env() -> None:
    """Map FINVERSE settings to the OpenAI-compatible MiroFish configuration."""
    api_key = os.environ.get("MIROFISH_LLM_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    base_url = os.environ.get("MIROFISH_LLM_BASE_URL", "https://openrouter.ai/api/v1")
    model = os.environ.get("MIROFISH_LLM_MODEL", "google/gemma-4-31b-it:free")
    if api_key:
        os.environ.setdefault("LLM_API_KEY", api_key)
    os.environ.setdefault("LLM_BASE_URL", base_url)
    os.environ.setdefault("LLM_MODEL_NAME", model)
    os.environ.setdefault("NEO4J_URI", os.environ.get("MIROFISH_NEO4J_URI", "bolt://localhost:7687"))
    os.environ.setdefault("NEO4J_USER", os.environ.get("MIROFISH_NEO4J_USER", "neo4j"))
    os.environ.setdefault("NEO4J_PASSWORD", os.environ.get("MIROFISH_NEO4J_PASSWORD", "mirofish"))
    os.environ.setdefault("EMBEDDING_MODEL", os.environ.get("MIROFISH_EMBEDDING_MODEL", "nomic-embed-text"))
    os.environ.setdefault("EMBEDDING_BASE_URL", os.environ.get("MIROFISH_EMBEDDING_BASE_URL", "http://localhost:11434"))


def _profile_parallel_count() -> int:
    """Match MiroFish-Offline's /api/simulation/prepare default of five."""
    try:
        return max(1, min(int(os.environ.get("FINVERSE_PROFILE_PARALLEL_COUNT", "5")), 8))
    except ValueError:
        return 5


def _configure_openrouter_ner(storage: Any) -> None:
    """Avoid multiplying MiroFish NER retries by OpenRouter fallbacks."""
    ner_extractor = getattr(storage, "_ner", None)
    if ner_extractor is not None and hasattr(ner_extractor, "max_retries"):
        ner_extractor.max_retries = 0


def _read_evidence(input_dir: Path) -> list[tuple[str, str]]:
    """Read one complete FINVERSE Evidence bundle in canonical order."""
    documents: list[tuple[str, str]] = []
    missing: list[str] = []
    for filename in EVIDENCE_FILES:
        path = input_dir / filename
        if not path.exists():
            missing.append(filename)
            continue
        content = path.read_text(encoding="utf-8").strip()
        if content:
            documents.append((filename, content))
        else:
            missing.append(filename)
    if missing:
        raise RuntimeError(
            "MiroFish 입력용 Evidence 문서 4종이 모두 필요합니다: "
            + ", ".join(missing)
        )
    return documents


def run(input_dir: Path, requirement: str, project_name: str) -> dict[str, Any]:
    """Execute MiroFish services synchronously and save FINVERSE-owned output."""
    _load_dotenv()
    _configure_mirofish_env()
    source_root = _resolve_source_root()
    input_dir = input_dir.resolve()
    workspace = input_dir / "mirofish"
    workspace.mkdir(parents=True, exist_ok=True)

    # Imports must happen after the environment and backend Python path are set.
    from app.config import Config
    from app.models.project import ProjectManager, ProjectStatus
    from app.services.graph_builder import GraphBuilderService
    from app.services.ontology_generator import OntologyGenerator
    from app.services.simulation_manager import SimulationManager
    from app.services.text_processor import TextProcessor
    from app.storage import Neo4jStorage
    from agents.openrouter_embeddings import OpenRouterEmbeddingService, configure_mirofish_vector_schema
    from agents.mirofish_openrouter import enable_openrouter_safe_responses

    # MiroFish assumes every provider response has text content.  Apply the
    # FINVERSE OpenRouter guard before any service creates an LLM client.
    enable_openrouter_safe_responses()

    # Mirror MiroFish-Offline's /api/graph/ontology/generate route: each
    # uploaded document is preprocessed independently, then the complete text
    # (with filename boundaries) is persisted for the later /graph/build step.
    evidence_documents = [
        (filename, TextProcessor.preprocess_text(content))
        for filename, content in _read_evidence(input_dir)
    ]
    document_texts = [content for _, content in evidence_documents]
    document_text = "".join(
        f"\n\n=== {filename} ===\n{content}"
        for filename, content in evidence_documents
    )

    # Keep all project/simulation artifacts beneath FINVERSE output rather than
    # writing to the MiroFish source checkout.
    Config.UPLOAD_FOLDER = str(workspace / "uploads")
    Config.OASIS_SIMULATION_DATA_DIR = str(Path(Config.UPLOAD_FOLDER) / "simulations")
    ProjectManager.PROJECTS_DIR = str(Path(Config.UPLOAD_FOLDER) / "projects")
    SimulationManager.SIMULATION_DATA_DIR = Config.OASIS_SIMULATION_DATA_DIR

    _emit("pipeline_start", input_dir=str(input_dir), source_root=str(source_root))
    storage = None
    try:
        _emit("stage", stage=2, status="running", message="MiroFish 온톨로지를 생성하고 있습니다.")
        project = ProjectManager.create_project(project_name)
        project.simulation_requirement = requirement
        project.total_text_length = len(document_text)
        project.files = []
        for filename, _ in evidence_documents:
            with (input_dir / filename).open("rb") as source:
                file_info = ProjectManager.save_file_to_project(
                    project.project_id,
                    FileStorage(stream=source, filename=filename),
                    filename,
                )
            project.files.append(
                {
                    "filename": file_info["original_filename"],
                    "size": file_info["size"],
                }
            )
        ProjectManager.save_extracted_text(project.project_id, document_text)
        ontology_result = OntologyGenerator().generate(
            document_texts=document_texts,
            simulation_requirement=requirement,
            additional_context=None,
        )
        project.ontology = {
            "entity_types": ontology_result.get("entity_types", []),
            "edge_types": ontology_result.get("edge_types", []),
        }
        project.analysis_summary = ontology_result.get("analysis_summary", "")
        project.status = ProjectStatus.ONTOLOGY_GENERATED
        ProjectManager.save_project(project)
        (workspace / "ontology.json").write_text(json.dumps(ontology_result, ensure_ascii=False, indent=2), encoding="utf-8")
        entity_type_names = [
            str(item.get("name", "")).strip()
            for item in project.ontology["entity_types"]
            if isinstance(item, dict) and str(item.get("name", "")).strip()
        ]
        relation_type_names = [
            str(item.get("name", "")).strip()
            for item in project.ontology["edge_types"]
            if isinstance(item, dict) and str(item.get("name", "")).strip()
        ]
        _emit(
            "stage",
            stage=2,
            status="complete",
            message="온톨로지 생성이 완료되었습니다.",
            entity_types=entity_type_names,
            relation_types=relation_type_names,
        )

        _emit("stage", stage=3, status="running", message="Neo4j 지식그래프를 구축하고 있습니다.")
        project.status = ProjectStatus.GRAPH_BUILDING
        ProjectManager.save_project(project)
        embedding = OpenRouterEmbeddingService()
        configure_mirofish_vector_schema(embedding.dimensions)
        storage = Neo4jStorage(embedding_service=embedding)
        # The stock offline NER extractor retries each failed JSON extraction
        # three times. OpenRouter routing already performs provider/model
        # fallback, so retaining both layers multiplies one bad chunk into a
        # multi-minute stall. Keep the original extraction flow but disable
        # only the redundant outer retry layer.
        _configure_openrouter_ner(storage)
        builder = GraphBuilderService(storage=storage)
        chunks = TextProcessor.split_text(
            ProjectManager.get_extracted_text(project.project_id),
            chunk_size=project.chunk_size or Config.DEFAULT_CHUNK_SIZE,
            overlap=project.chunk_overlap or Config.DEFAULT_CHUNK_OVERLAP,
        )
        graph_id = builder.create_graph(project_name)
        project.graph_id = graph_id
        ProjectManager.save_project(project)
        builder.set_ontology(graph_id, project.ontology)
        latest_graph_snapshot: dict[str, Any] | None = None

        def emit_graph_snapshot(message: str, ratio: float) -> None:
            """Publish the currently persisted Neo4j graph after each batch."""
            nonlocal latest_graph_snapshot
            try:
                graph_data = builder.get_graph_data(graph_id)
                all_nodes = [node for node in graph_data.get("nodes", []) if isinstance(node, dict)]
                all_edges = [edge for edge in graph_data.get("edges", []) if isinstance(edge, dict)]
                nodes = [
                    {
                        "id": str(node.get("uuid", "")),
                        "label": str(node.get("name", "")),
                        "type": str((node.get("labels") or ["Entity"])[0]),
                    }
                    for node in all_nodes[:80]
                    if isinstance(node, dict) and node.get("uuid") and node.get("name")
                ]
                node_ids = {node["id"] for node in nodes}
                edges = [
                    {
                        "source": str(edge.get("source_node_uuid", "")),
                        "target": str(edge.get("target_node_uuid", "")),
                        "label": str(edge.get("name") or edge.get("fact") or "RELATED_TO"),
                    }
                    for edge in all_edges[:160]
                    if isinstance(edge, dict)
                    and edge.get("source_node_uuid") in node_ids
                    and edge.get("target_node_uuid") in node_ids
                ]
                latest_graph_snapshot = {
                    "stage": 3,
                    "progress": round(ratio * 100),
                    "message": message,
                    "node_count": len(all_nodes),
                    "edge_count": len(all_edges),
                    "nodes": nodes,
                    "edges": edges,
                }
                _emit("graph_snapshot", **latest_graph_snapshot)
            except Exception as exc:  # A UI snapshot must never block graph construction.
                _emit("progress", stage=3, progress=round(ratio * 100), message=message, snapshot_error=str(exc))

        def graph_progress(message: str, ratio: float) -> None:
            _emit("progress", stage=3, progress=round(ratio * 100), message=message)
            # GraphBuilder invokes this at the next batch boundary, so the
            # snapshot contains all data persisted by the previous batch.
            emit_graph_snapshot(message, ratio)

        # Publish an explicit empty graph before the first LLM extraction
        # batch. This lets the UI distinguish “waiting for first batch” from
        # missing metrics, then replace the zeroes with live Neo4j counts.
        emit_graph_snapshot("Neo4j 지식그래프를 초기화했습니다. 첫 문서 청크를 적재하는 중입니다.", 0.0)
        builder.add_text_batches(graph_id, chunks, batch_size=3, progress_callback=graph_progress)
        graph_data = builder.get_graph_data(graph_id)
        emit_graph_snapshot("모든 청크를 Neo4j 지식그래프에 적재했습니다.", 1.0)
        graph_info = storage.get_graph_info(graph_id)
        project.status = ProjectStatus.GRAPH_COMPLETED
        ProjectManager.save_project(project)
        (workspace / "graph.json").write_text(json.dumps(graph_data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        _emit("stage", stage=3, status="complete", message="지식그래프 구축이 완료되었습니다.", graph_id=graph_id, nodes=graph_info.get("node_count", 0), edges=graph_info.get("edge_count", 0))

        manager = SimulationManager()
        state = manager.create_simulation(project.project_id, graph_id, enable_twitter=True, enable_reddit=True)

        last_stage: int | None = None
        stage_map = {"reading": 4, "generating_profiles": 4, "generating_config": 5, "copying_scripts": 6}

        def preparation_progress(phase: str, progress: int, message: str, **details: Any) -> None:
            nonlocal last_stage
            stage = stage_map.get(phase, 6)
            if last_stage != stage:
                _emit("stage", stage=stage, status="running", message=message)
                last_stage = stage
            _emit("progress", stage=stage, progress=progress, message=message, **details)

        prepared = manager.prepare_simulation(
            simulation_id=state.simulation_id,
            simulation_requirement=requirement,
            document_text=document_text,
            defined_entity_types=[item["name"] for item in project.ontology["entity_types"]],
            use_llm_for_profiles=True,
            progress_callback=preparation_progress,
            parallel_profile_count=_profile_parallel_count(),
            storage=storage,
        )
        if prepared.status.value != "ready":
            raise RuntimeError(prepared.error or "MiroFish 시뮬레이션 준비에 실패했습니다.")

        config = manager.get_simulation_config(prepared.simulation_id) or {}
        event_config = config.get("event_config", {}) if isinstance(config, dict) else {}
        activation = {
            "simulation_id": prepared.simulation_id,
            "initial_posts": event_config.get("initial_posts", []),
            "hot_topics": event_config.get("hot_topics", []),
            "prepared_at": datetime.now().isoformat(),
        }
        (workspace / "initial-activation.json").write_text(json.dumps(activation, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        _emit("stage", stage=4, status="complete", message="에이전트 프로필 생성이 완료되었습니다.", profiles=prepared.profiles_count, entities=prepared.entities_count)
        _emit("stage", stage=5, status="complete", message="시뮬레이션 설정 생성이 완료되었습니다.")
        _emit("stage", stage=6, status="complete", message="초기 활성화 계획이 준비되었습니다.", initial_posts=len(activation["initial_posts"]), hot_topics=len(activation["hot_topics"]))

        result = {
            "input_dir": str(input_dir),
            "workspace": str(workspace),
            "project_id": project.project_id,
            "graph_id": graph_id,
            "simulation_id": prepared.simulation_id,
            "entity_count": prepared.entities_count,
            "profile_count": prepared.profiles_count,
            "node_count": graph_info.get("node_count", 0),
            "edge_count": graph_info.get("edge_count", 0),
            "chunk_count": len(chunks),
            "entity_types": entity_type_names,
            "relation_types": relation_type_names,
            "graph_snapshot": latest_graph_snapshot,
            "initial_posts_count": len(activation["initial_posts"]),
        }
        (workspace / "mirofish-manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        _emit("pipeline_complete", **result)
        return result
    except Exception as exc:
        _emit("pipeline_error", error=f"{type(exc).__name__}: {exc}", traceback=traceback.format_exc())
        raise
    finally:
        if storage is not None:
            storage.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Execute MiroFish preparation directly from FINVERSE Python.")
    parser.add_argument("--input-dir", required=True, type=Path, help="Directory containing FINVERSE Evidence markdown files")
    parser.add_argument("--requirement", required=True, help="Scenario question and forecast period")
    parser.add_argument("--project-name", default="FINVERSE Market Scenario", help="MiroFish project name")
    args = parser.parse_args()
    result = run(args.input_dir, args.requirement, args.project_name)
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
