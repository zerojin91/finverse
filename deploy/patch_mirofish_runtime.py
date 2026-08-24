"""Apply FINVERSE runtime safeguards to MiroFish's parallel simulator.

The upstream script creates an independent LLM semaphore for Twitter and
Reddit, so both platforms can still allocate inference batches at the same
time.  On the collector host that transient memory is enough to trigger the
Linux OOM killer.  This build-time patch keeps both platform loops alive, but
serializes their expensive ``env.step`` calls through one shared semaphore.
"""

from __future__ import annotations

import sys
from pathlib import Path


def replace_once(source: str, old: str, new: str, description: str) -> str:
    count = source.count(old)
    if count < 1:
        raise RuntimeError(f"MiroFish patch anchor not found: {description}")
    return source.replace(old, new, 1)


def patch(source_path: Path) -> None:
    source = source_path.read_text(encoding="utf-8")

    globals_anchor = """# Global variables: for signal handling
_shutdown_event = None
_cleanup_done = False
"""
    globals_replacement = """# Global variables: for signal handling
_shutdown_event = None
_cleanup_done = False
_finverse_llm_step_semaphore = None
_finverse_runtime_lock_handle = None


def _acquire_finverse_runtime_lock():
    \"\"\"Allow only one memory-heavy MiroFish runner in this container.\"\"\"
    global _finverse_runtime_lock_handle
    if os.name == \"nt\":
        return
    import fcntl

    lock_path = os.environ.get(
        \"FINVERSE_SIMULATION_GLOBAL_LOCK_FILE\",
        \"/tmp/finverse-mirofish-simulation.lock\",
    )
    handle = open(lock_path, \"a+\", encoding=\"utf-8\")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        handle.close()
        raise RuntimeError(
            \"Another MiroFish simulation is already running on this server\"
        ) from exc
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    _finverse_runtime_lock_handle = handle


def _get_finverse_llm_step_semaphore():
    \"\"\"Return the event-loop-local semaphore shared by both platforms.\"\"\"
    global _finverse_llm_step_semaphore
    if _finverse_llm_step_semaphore is None:
        limit = max(1, int(os.environ.get(\"FINVERSE_SIMULATION_GLOBAL_LLM_BATCHES\", \"1\")))
        _finverse_llm_step_semaphore = asyncio.Semaphore(limit)
    return _finverse_llm_step_semaphore


def _write_finverse_batch_progress(payload):
    \"\"\"Atomically publish the currently executing platform batch.\"\"\"
    path = os.path.join(os.getcwd(), \"finverse_batch_progress.json\")
    temporary_path = f\"{path}.tmp\"
    payload = {**payload, \"updated_at\": datetime.now().isoformat()}
    try:
        with open(temporary_path, \"w\", encoding=\"utf-8\") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        os.replace(temporary_path, path)
    except OSError as exc:
        print(f\"[FINVERSE] Unable to write batch progress: {exc}\", flush=True)


async def _finverse_env_step(env, actions, label):
    \"\"\"Run one OASIS batch with a cross-platform memory guard and timing logs.\"\"\"
    semaphore = _get_finverse_llm_step_semaphore()
    started = asyncio.get_running_loop().time()
    print(
        f\"[FINVERSE] LLM batch waiting: {label}, actions={len(actions)}\",
        flush=True,
    )
    async with semaphore:
        acquired = asyncio.get_running_loop().time()
        started_at = datetime.now().isoformat()
        _write_finverse_batch_progress({
            \"status\": \"running\",
            \"label\": label,
            \"actions_count\": len(actions),
            \"completed_actions\": 0,
            \"started_at\": started_at,
        })
        print(
            f\"[FINVERSE] LLM batch started: {label}, \"
            f\"waited={acquired - started:.1f}s\",
            flush=True,
        )
        completed_actions = 0
        original_perform_llm_action = getattr(env, \"_perform_llm_action\", None)

        if original_perform_llm_action is not None:
            async def tracked_perform_llm_action(agent):
                nonlocal completed_actions
                result = await original_perform_llm_action(agent)
                completed_actions += 1
                _write_finverse_batch_progress({
                    \"status\": \"running\",
                    \"label\": label,
                    \"actions_count\": len(actions),
                    \"completed_actions\": completed_actions,
                    \"started_at\": started_at,
                })
                print(
                    f\"[FINVERSE] LLM action completed: {label}, \"
                    f\"progress={completed_actions}/{len(actions)}\",
                    flush=True,
                )
                return result

            env._perform_llm_action = tracked_perform_llm_action

        try:
            result = await env.step(actions)
        except Exception as exc:
            _write_finverse_batch_progress({
                \"status\": \"failed\",
                \"label\": label,
                \"actions_count\": len(actions),
                \"completed_actions\": completed_actions,
                \"started_at\": started_at,
                \"error\": f\"{type(exc).__name__}: {exc}\",
            })
            raise
        finally:
            if original_perform_llm_action is not None:
                env._perform_llm_action = original_perform_llm_action
    finished = asyncio.get_running_loop().time()
    _write_finverse_batch_progress({
        \"status\": \"completed\",
        \"label\": label,
        \"actions_count\": len(actions),
        \"completed_actions\": completed_actions,
        \"started_at\": started_at,
        \"elapsed_seconds\": round(finished - acquired, 1),
    })
    print(
        f\"[FINVERSE] LLM batch completed: {label}, \"
        f\"elapsed={finished - acquired:.1f}s\",
        flush=True,
    )
    return result
"""
    # Replace upstream call sites before inserting the helper itself.  This
    # prevents the helper's own ``env.step`` from being rewritten recursively.
    replacements = [
        (
            "await env.step(actions)",
            "await _finverse_env_step(env, actions, f\"interview:{actual_platform}\")",
            "single interview batch",
        ),
        (
            "await self.twitter_env.step(twitter_actions)",
            "await _finverse_env_step(self.twitter_env, twitter_actions, \"twitter-interview\")",
            "Twitter interview batch",
        ),
        (
            "await self.reddit_env.step(reddit_actions)",
            "await _finverse_env_step(self.reddit_env, reddit_actions, \"reddit-interview\")",
            "Reddit interview batch",
        ),
        (
            "await result.env.step(initial_actions)",
            "await _finverse_env_step(result.env, initial_actions, \"twitter-initial\")",
            "Twitter initial batch",
        ),
        (
            "await result.env.step(actions)",
            "await _finverse_env_step(result.env, actions, f\"twitter-round-{round_num + 1}\")",
            "Twitter round batch",
        ),
        (
            "await result.env.step(initial_actions)",
            "await _finverse_env_step(result.env, initial_actions, \"reddit-initial\")",
            "Reddit initial batch",
        ),
        (
            "await result.env.step(actions)",
            "await _finverse_env_step(result.env, actions, f\"reddit-round-{round_num + 1}\")",
            "Reddit round batch",
        ),
    ]
    for old, new, description in replacements:
        source = replace_once(source, old, new, description)

    source = replace_once(
        source,
        """    return ModelFactory.create(
        model_platform=ModelPlatformType.OPENAI,
        model_type=llm_model,
    )
""",
        """    return ModelFactory.create(
        model_platform=ModelPlatformType.OPENAI,
        model_type=llm_model,
        timeout=max(1.0, float(os.environ.get(\"FINVERSE_OPENROUTER_REQUEST_TIMEOUT_SECONDS\", \"60\"))),
        max_retries=max(0, int(os.environ.get(\"FINVERSE_SIMULATION_LLM_MAX_RETRIES\", \"1\"))),
    )
""",
        "MiroFish ModelFactory timeout",
    )

    source = replace_once(
        source,
        """    args = parser.parse_args()
""" + "    \n" + """    # Create shutdown event at the start of main function to ensure the whole program can respond to exit signal
""",
        """    args = parser.parse_args()
    _acquire_finverse_runtime_lock()
""" + "    \n" + """    # Create shutdown event at the start of main function to ensure the whole program can respond to exit signal
""",
        "MiroFish process-wide runtime lock",
    )

    per_platform_count = source.count("semaphore=30,")
    if per_platform_count != 2:
        raise RuntimeError(
            "Expected two MiroFish platform semaphore anchors, "
            f"found {per_platform_count}"
        )
    source = source.replace(
        "semaphore=30,",
        'semaphore=max(1, int(os.environ.get("FINVERSE_SIMULATION_LLM_CONCURRENCY", "1"))),',
    )

    source = replace_once(
        source,
        globals_anchor,
        globals_replacement,
        "shared LLM semaphore globals",
    )

    source_path.write_text(source, encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_mirofish_runtime.py PATH")
    patch(Path(sys.argv[1]))


if __name__ == "__main__":
    main()
