"""Minimal LangChain -> Amazon Bedrock connectivity check.

Run with: python tests/test_bedrock_langchain.py
The script reads the local .env without printing the bearer token.
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
        from langchain_aws import ChatBedrockConverse
    except ImportError as exc:
        print("FAILED: install langchain-aws first")
        print(exc)
        return 2

    region = os.environ.get("AWS_REGION", "ap-northeast-2")
    configured_model = os.environ.get(
        "FINVERSE_AGENT_MODEL", "bedrock:global.anthropic.claude-sonnet-5"
    )
    model = configured_model.removeprefix("bedrock:")

    if not os.environ.get("AWS_BEARER_TOKEN_BEDROCK"):
        print("FAILED: AWS_BEARER_TOKEN_BEDROCK is empty")
        return 2

    try:
        chat = ChatBedrockConverse(
            model=model,
            region_name=region,
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
        print(f"SUCCEEDED: region={region}; model={model}; response={text}")
        return 0
    except Exception as exc:  # noqa: BLE001 - diagnostic script reports provider errors.
        print(f"FAILED: region={region}; model={model}; {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
