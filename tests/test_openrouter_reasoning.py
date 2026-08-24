"""Opt-in OpenRouter reasoning continuity diagnostic.

Run with:
    uv run python tests/test_openrouter_reasoning.py

The script reads OPENROUTER_API_KEY from .env and never prints it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agents.mirofish_a2a import _load_dotenv


MODEL = "google/gemma-4-31b-it:free"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
QUESTION = "How many r's are in the word 'strawberry'?"


def request(payload: dict, headers: dict[str, str]) -> dict:
    response = requests.post(ENDPOINT, headers=headers, json=payload, timeout=60)
    print(f"STATUS {response.status_code}")
    if not response.ok:
        print(f"ERROR {response.text[:500]}")
    response.raise_for_status()
    return response.json()


def main() -> int:
    _load_dotenv()
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("FAILED: OPENROUTER_API_KEY is empty")
        return 2
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    first = request(
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": QUESTION}],
            "reasoning": {"enabled": True},
        },
        headers,
    )
    assistant = first["choices"][0]["message"]
    print(f"FIRST_MODEL {first.get('model')}")
    print(f"FIRST_HAS_REASONING_DETAILS {bool(assistant.get('reasoning_details'))}")

    second = request(
        {
            "model": MODEL,
            "messages": [
                {"role": "user", "content": QUESTION},
                {
                    "role": "assistant",
                    "content": assistant.get("content"),
                    "reasoning_details": assistant.get("reasoning_details"),
                },
                {"role": "user", "content": "Are you sure? Think carefully."},
            ],
            "reasoning": {"enabled": True},
        },
        headers,
    )
    answer = second["choices"][0]["message"]
    print(f"SECOND_MODEL {second.get('model')}")
    print(f"SECOND_REPLY {str(answer.get('content', ''))[:160]}")
    print(f"SECOND_HAS_REASONING_DETAILS {bool(answer.get('reasoning_details'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
