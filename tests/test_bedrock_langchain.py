"""Minimal LangChain -> OpenRouter connectivity check.

Run with: python tests/test_bedrock_langchain.py
The script reads the local .env without printing the API key.
"""

from __future__ import annotations

import os
from pathlib import Path


def load_local_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        raise RuntimeError(f"missing {env_path}")
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    load_local_env()

    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:
        print("FAILED: install langchain-openai first")
        print(exc)
        return 2

    model = os.environ.get("OPENROUTER_MODEL", "google/gemma-4-31b-it:free")

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("FAILED: OPENROUTER_API_KEY is empty")
        return 2

    try:
        chat = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            max_tokens=32,
        )
        response = chat.invoke("Reply with exactly OK.")
        content = response.content
        if isinstance(content, list):
            text = " ".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict)
            ).strip()
        else:
            text = str(content).strip()
        print(f"SUCCEEDED: provider=OpenRouter; model={model}; response={text}")
        return 0
    except Exception as exc:  # noqa: BLE001 - diagnostic script reports provider errors.
        print(f"FAILED: provider=OpenRouter; model={model}; {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
