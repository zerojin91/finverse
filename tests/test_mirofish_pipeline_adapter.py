from __future__ import annotations

from datetime import datetime
from hashlib import sha256
import importlib
import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys

import pytest

from agents import mirofish_openrouter, mirofish_pipeline, ontology_a2a


def _write_evidence_bundle(directory: Path) -> None:
    for index, filename in enumerate(mirofish_pipeline.EVIDENCE_FILES, start=1):
        (directory / filename).write_text(
            f"# Evidence {index}\n\n문서 {index} 내용\n",
            encoding="utf-8",
        )


def test_collection_run_directory_is_isolated_inside_browser_session(tmp_path: Path) -> None:
    run_time = datetime(2026, 8, 24, 19, 30, 45, 123456)

    session_root, run_dir, run_id = ontology_a2a._build_run_output_dir(
        tmp_path,
        "현재 코스피 시장은?",
        "browser-12345678",
        run_time,
    )

    assert session_root == tmp_path / "2026-08-24" / "session-browser-12345678"
    assert run_id == "run-193045-123456"
    assert run_dir.parent.name == run_id
    assert run_dir.parent.parent == session_root


def test_evidence_manifest_hashes_all_four_documents(tmp_path: Path) -> None:
    _write_evidence_bundle(tmp_path)

    manifest = ontology_a2a._write_evidence_manifest(
        output_dir=tmp_path,
        query="코스피 질문",
        run_id="run-193045-123456",
        session_id="browser-12345678",
    )

    saved = json.loads(
        (tmp_path / ontology_a2a.EVIDENCE_MANIFEST_FILE).read_text(encoding="utf-8")
    )
    assert saved == manifest
    assert saved["status"] == "complete"
    assert [item["name"] for item in saved["documents"]] == list(
        ontology_a2a.DOMAIN_FILES.values()
    )
    for item in saved["documents"]:
        content = (tmp_path / item["name"]).read_bytes()
        assert item["bytes"] == len(content)
        assert item["sha256"] == sha256(content).hexdigest()


def test_evidence_manifest_rejects_partial_bundle(tmp_path: Path) -> None:
    (tmp_path / "market-evidence.md").write_text("시장", encoding="utf-8")

    with pytest.raises(RuntimeError, match="all required documents"):
        ontology_a2a._write_evidence_manifest(
            output_dir=tmp_path,
            query="코스피 질문",
            run_id="run-193045-123456",
            session_id=None,
        )


def test_mirofish_adapter_requires_and_preserves_canonical_document_order(
    tmp_path: Path,
) -> None:
    _write_evidence_bundle(tmp_path)

    documents = mirofish_pipeline._read_evidence(tmp_path)

    assert [name for name, _ in documents] == list(mirofish_pipeline.EVIDENCE_FILES)


def test_mirofish_adapter_rejects_missing_document(tmp_path: Path) -> None:
    _write_evidence_bundle(tmp_path)
    (tmp_path / "psychology-evidence.md").unlink()

    with pytest.raises(RuntimeError, match="psychology-evidence.md"):
        mirofish_pipeline._read_evidence(tmp_path)


def test_mirofish_adapter_disables_redundant_outer_ner_retries() -> None:
    storage = SimpleNamespace(_ner=SimpleNamespace(max_retries=2))

    mirofish_pipeline._configure_openrouter_ner(storage)

    assert storage._ner.max_retries == 0


def test_openrouter_adapter_uses_server_routing_without_sdk_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []
    options: list[dict] = []

    class FakeClient:
        def __init__(self) -> None:
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=self._create)
            )

        def with_options(self, **kwargs):
            options.append(kwargs)
            return self

        @staticmethod
        def _create(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok": true}'))]
            )

    class FakeLLMClient:
        def __init__(self) -> None:
            self.base_url = "https://openrouter.ai/api/v1"
            self.model = "deepseek/deepseek-v4-flash-0731"
            self.client = FakeClient()

        def chat(self, *_args, **_kwargs) -> str:
            raise AssertionError("stock chat must be patched")

    app_module = ModuleType("app")
    utils_module = ModuleType("app.utils")
    llm_module = ModuleType("app.utils.llm_client")
    llm_module.LLMClient = FakeLLMClient
    monkeypatch.setitem(sys.modules, "app", app_module)
    monkeypatch.setitem(sys.modules, "app.utils", utils_module)
    monkeypatch.setitem(sys.modules, "app.utils.llm_client", llm_module)
    monkeypatch.setenv(
        "FINVERSE_OPENROUTER_FALLBACK_MODELS",
        "fallback/one,fallback/two",
    )

    mirofish_openrouter.enable_openrouter_safe_responses()
    result = FakeLLMClient().chat(
        [{"role": "user", "content": "JSON으로 답해"}],
        response_format={"type": "json_object"},
    )

    assert result == '{"ok": true}'
    assert options == [{"timeout": 60.0, "max_retries": 0}]
    assert calls[0]["extra_body"] == {
        "reasoning": {"enabled": False},
        "models": ["fallback/one", "fallback/two"],
    }


def test_openrouter_timeout_has_a_hard_sixty_second_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FINVERSE_OPENROUTER_REQUEST_TIMEOUT_SECONDS", "600")

    assert mirofish_openrouter._request_timeout_seconds() == 60.0


def test_openrouter_caps_unbounded_direct_generation_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FINVERSE_OPENROUTER_MAX_TOKENS", "999999")

    assert mirofish_openrouter._max_output_tokens() == 8192


def test_openrouter_adapter_wraps_direct_profile_and_config_clients(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []
    options: list[dict] = []

    class FakeClient:
        def __init__(self) -> None:
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=self._create)
            )

        def with_options(self, **kwargs):
            options.append(kwargs)
            return self

        @staticmethod
        def _create(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content='<think>hidden</think>{"ok": true}'),
                        finish_reason="stop",
                    )
                ]
            )

    class FakeLLMClient:
        def chat(self, *_args, **_kwargs) -> str:
            return "stock"

    class FakeDirectService:
        def __init__(self) -> None:
            self.base_url = "https://openrouter.ai/api/v1"
            self.client = FakeClient()

    class FakeProfileGenerator(FakeDirectService):
        pass

    class FakeConfigGenerator(FakeDirectService):
        pass

    app_module = ModuleType("app")
    utils_module = ModuleType("app.utils")
    llm_module = ModuleType("app.utils.llm_client")
    services_module = ModuleType("app.services")
    profile_module = ModuleType("app.services.oasis_profile_generator")
    config_module = ModuleType("app.services.simulation_config_generator")
    llm_module.LLMClient = FakeLLMClient
    profile_module.OasisProfileGenerator = FakeProfileGenerator
    config_module.SimulationConfigGenerator = FakeConfigGenerator
    for name, module in (
        ("app", app_module),
        ("app.utils", utils_module),
        ("app.utils.llm_client", llm_module),
        ("app.services", services_module),
        ("app.services.oasis_profile_generator", profile_module),
        ("app.services.simulation_config_generator", config_module),
    ):
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setenv(
        "FINVERSE_OPENROUTER_FALLBACK_MODELS",
        "fallback/one,fallback/two",
    )

    mirofish_openrouter.enable_openrouter_safe_responses()
    for service_class in (FakeProfileGenerator, FakeConfigGenerator):
        response = service_class().client.chat.completions.create(
            model="deepseek/deepseek-v4-flash-0731",
            messages=[{"role": "user", "content": "JSON으로 답해"}],
            response_format={"type": "json_object"},
        )
        assert response.choices[0].message.content == '{"ok": true}'

    assert options == [
        {"timeout": 60.0, "max_retries": 0},
        {"timeout": 60.0, "max_retries": 0},
    ]
    assert all(
        call["extra_body"]
        == {
            "reasoning": {"enabled": False},
            "models": ["fallback/one", "fallback/two"],
        }
        for call in calls
    )
    assert all(call["max_tokens"] == 4096 for call in calls)


def test_direct_service_outer_retry_does_not_repeat_failed_routing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []

    class FailingClient:
        def __init__(self) -> None:
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=self._create)
            )

        def with_options(self, **_kwargs):
            return self

        @staticmethod
        def _create(**kwargs):
            calls.append(kwargs)
            raise TimeoutError("provider timed out")

    class FakeProfileGenerator:
        def __init__(self) -> None:
            self.base_url = "https://openrouter.ai/api/v1"
            self.client = FailingClient()

        def _generate_profile_with_llm(self):
            last_error: Exception | None = None
            for _attempt in range(3):
                try:
                    return self.client.chat.completions.create(
                        model="deepseek/deepseek-v4-flash-0731",
                        messages=[{"role": "user", "content": "JSON"}],
                    )
                except Exception as exc:  # mirrors stock MiroFish retry loop
                    last_error = exc
            raise last_error or RuntimeError("unexpected")

    monkeypatch.setenv("FINVERSE_OPENROUTER_FALLBACK_MODELS", "fallback/one")
    mirofish_openrouter._patch_direct_client(
        FakeProfileGenerator,
        "_generate_profile_with_llm",
    )

    with pytest.raises(RuntimeError, match="routing already exhausted"):
        FakeProfileGenerator()._generate_profile_with_llm()

    assert len(calls) == 2


def test_simulation_api_restores_ready_jobs_and_unlocks_interrupted_jobs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FINVERSE_SIMULATION_RUNS_DIR", str(tmp_path))
    sys.modules.pop("services.finverse_simulation_api", None)
    simulation_api = importlib.import_module("services.finverse_simulation_api")
    simulation_api.jobs.clear()

    def save_job(job_id: str, status: str) -> None:
        directory = tmp_path / job_id
        directory.mkdir()
        (directory / "job.json").write_text(
            json.dumps(
                {
                    "id": job_id,
                    "fingerprint": f"fingerprint-{job_id}",
                    "query": "코스피 질문",
                    "period": "30일",
                    "status": status,
                    "created_at": "2026-08-24T10:00:00+00:00",
                    "updated_at": "2026-08-24T10:00:00+00:00",
                    "next_event": 2,
                    "events": [{"seq": 1, "type": "accepted"}],
                    "result": {"simulation_id": "sim-ready"} if status == "ready" else None,
                    "error": None,
                }
            ),
            encoding="utf-8",
        )

    save_job("fv-sim-111111111111", "ready")
    save_job("fv-sim-222222222222", "preparing")

    assert simulation_api._load_persisted_jobs() == 2
    assert simulation_api.jobs["fv-sim-111111111111"]["status"] == "ready"
    interrupted = simulation_api.jobs["fv-sim-222222222222"]
    assert interrupted["status"] == "failed"
    assert "restarted" in interrupted["error"]
    assert interrupted["events"][-1]["type"] == "error"

    bounded = simulation_api._bounded_runtime_line("x" * 10_000)
    assert len(bounded) < 2_100
    assert "truncated 8000 chars" in bounded
