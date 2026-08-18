"""Diagnostic checks for the first Bedrock call used by MiroFish.

This is an opt-in live diagnostic. It uses the local .env and limits each
request to 60 seconds so a provider/network issue cannot leave a process
waiting for the production one-hour timeout.
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agents import mirofish_a2a


def main() -> int:
    mirofish_a2a._load_dotenv()
    os.environ["FINVERSE_BEDROCK_TIMEOUT_SECONDS"] = "60"
    model_id = os.environ.get("FINVERSE_AGENT_MODEL", mirofish_a2a.DEFAULT_MODEL)
    print(f"MODEL {model_id}")
    print(f"REGION {os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION')}")

    model = mirofish_a2a._create_chat_model(model_id)
    started = time.perf_counter()
    try:
        response = model.invoke("Reply with exactly OK.")
    except Exception as exc:  # noqa: BLE001 - diagnostic output is the purpose.
        print(f"SIMPLE_CALL FAILED after {time.perf_counter() - started:.1f}s: {type(exc).__name__}: {exc}")
        return 1
    print(f"SIMPLE_CALL OK after {time.perf_counter() - started:.1f}s: {str(response.content)[:120]}")

    started = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="mirofish-first-call-") as temp_dir:
            agent = mirofish_a2a.build_agent(Path(temp_dir), date.today())
            agent.invoke({"messages": [{"role": "user", "content": "첫 호출 진단만 수행하고 즉시 종료해줘."}]})
    except Exception as exc:  # noqa: BLE001 - diagnostic output is the purpose.
        print(f"ORCHESTRATOR_CALL FAILED after {time.perf_counter() - started:.1f}s: {type(exc).__name__}: {exc}")
        return 2
    print(f"ORCHESTRATOR_CALL OK after {time.perf_counter() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
