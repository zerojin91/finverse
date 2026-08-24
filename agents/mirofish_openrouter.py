"""OpenRouter-safe LLM behavior for the FINVERSE MiroFish runtime.

MiroFish's stock client assumes every OpenAI-compatible response contains a
text ``message.content``.  Some OpenRouter providers can return a successful
response with an empty content field (for example when a provider only returns
reasoning data).  This module adds FINVERSE-owned retry and fallback behavior
without modifying the MiroFish source checkout.
"""

from __future__ import annotations

import os
import re
from contextvars import ContextVar
from functools import wraps
from importlib import import_module
from typing import Any


_outer_retry_scope: ContextVar[bool] = ContextVar(
    "finverse_openrouter_outer_retry_scope",
    default=False,
)
_routed_failure_in_scope: ContextVar[bool] = ContextVar(
    "finverse_openrouter_routed_failure_in_scope",
    default=False,
)


def _fallback_models(primary: str) -> list[str]:
    configured = os.environ.get(
        "FINVERSE_OPENROUTER_FALLBACK_MODELS",
        "google/gemma-4-26b-a4b-it:free,"
        "dots-studio/dots-3-note-preview:free,"
        "poolside/laguna-s-2.1:free",
    )
    candidates = [item.strip() for item in configured.split(",") if item.strip()]
    return [model for model in candidates if model != primary]


def _request_timeout_seconds() -> float:
    """Keep one stalled provider from blocking the whole preparation job."""
    raw = os.environ.get("FINVERSE_OPENROUTER_REQUEST_TIMEOUT_SECONDS", "60")
    try:
        # Keep the hard ceiling in code so a stale server environment value
        # cannot reintroduce multi-minute OpenAI SDK waits.
        return max(15.0, min(float(raw), 60.0))
    except ValueError:
        return 60.0


def _max_output_tokens() -> int:
    """Bound direct MiroFish generations that omit an output-token limit."""
    raw = os.environ.get("FINVERSE_OPENROUTER_MAX_TOKENS", "4096")
    try:
        return max(512, min(int(raw), 8192))
    except ValueError:
        return 4096


def _routing_attempts(primary: str) -> list[tuple[str, list[str]]]:
    """Build at most two OpenRouter requests with server-side model fallback."""
    fallbacks = _fallback_models(primary)
    attempts = [(primary, fallbacks)]
    # OpenRouter can route provider/model failures from the first request. A
    # second request is retained only for a successful HTTP response whose
    # message content is empty (that condition cannot trigger server fallback).
    if fallbacks:
        attempts.append((fallbacks[0], fallbacks[1:]))
    return attempts


def _response_content(response: Any) -> str | None:
    """Return cleaned assistant text and preserve it on the SDK response."""
    choices = getattr(response, "choices", None) or []
    message = getattr(choices[0], "message", None) if choices else None
    content = getattr(message, "content", None)
    if not isinstance(content, str) or not content.strip():
        return None
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", content).strip()
    if not cleaned:
        return None
    if cleaned != content:
        try:
            message.content = cleaned
        except (AttributeError, TypeError):
            object.__setattr__(message, "content", cleaned)
    return cleaned


def _routed_completion(client: Any, request: dict[str, Any]) -> Any:
    """Make one OpenRouter-routed completion without hidden SDK retries."""
    if _outer_retry_scope.get() and _routed_failure_in_scope.get():
        raise RuntimeError(
            "OpenRouter routing already exhausted for this MiroFish operation"
        )
    primary = str(request.get("model", "")).strip()
    if not primary:
        raise ValueError("OpenRouter completion requires a model name")

    original_extra = request.get("extra_body")
    base_extra = dict(original_extra) if isinstance(original_extra, dict) else {}
    failures: list[str] = []
    attempts = _routing_attempts(primary)
    for attempt, (model, fallback_models) in enumerate(attempts, start=1):
        extra_body = dict(base_extra)
        # FINVERSE only needs the final structured answer for ontology,
        # profiles, and simulation config. Hidden reasoning can consume the
        # whole token budget and leave message.content empty.
        extra_body["reasoning"] = {"enabled": False}
        if fallback_models:
            extra_body["models"] = fallback_models
        else:
            extra_body.pop("models", None)

        routed_request = {
            **request,
            "model": model,
            "extra_body": extra_body,
        }
        requested_max_tokens = routed_request.get("max_tokens")
        try:
            requested_limit = int(requested_max_tokens)
        except (TypeError, ValueError):
            requested_limit = _max_output_tokens()
        routed_request["max_tokens"] = min(
            max(1, requested_limit),
            _max_output_tokens(),
        )
        try:
            routed_client = client.with_options(
                timeout=_request_timeout_seconds(),
                max_retries=0,
            )
            response = routed_client.chat.completions.create(**routed_request)
            if _response_content(response):
                if attempt > 1:
                    print(
                        f"mirofish_openrouter | recovered | model={model} | attempt={attempt}",
                        flush=True,
                    )
                return response
            failures.append(f"{model}: empty message.content")
            print(
                f"mirofish_openrouter | retry {attempt}/{len(attempts)} | "
                f"model={model} | empty_content",
                flush=True,
            )
        except Exception as exc:  # provider errors should try the next model
            failures.append(f"{model}: {type(exc).__name__}: {exc}")
            print(
                f"mirofish_openrouter | retry {attempt}/{len(attempts)} | "
                f"model={model} | error={type(exc).__name__}",
                flush=True,
            )

    if _outer_retry_scope.get():
        _routed_failure_in_scope.set(True)
    raise RuntimeError(
        "OpenRouter returned no usable text after all configured models: "
        + " | ".join(failures)
    )


class _RoutedCompletions:
    def __init__(self, client: Any) -> None:
        self._client = client

    def create(self, **request: Any) -> Any:
        return _routed_completion(self._client, request)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client.chat.completions, name)


class _RoutedChat:
    def __init__(self, client: Any) -> None:
        self._client = client
        self.completions = _RoutedCompletions(client)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client.chat, name)


class _RoutedOpenAIClient:
    """Small proxy for MiroFish services that instantiate OpenAI directly."""

    _finverse_openrouter_routed = True

    def __init__(self, client: Any) -> None:
        self._client = client
        self.chat = _RoutedChat(client)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


def _patch_outer_retry_scope(service_class: type[Any], method_name: str) -> None:
    """Let stock parsing retries run without repeating failed network routing."""
    marker = f"_finverse_openrouter_scope_{method_name}"
    if getattr(service_class, marker, False):
        return
    original_method = getattr(service_class, method_name, None)
    if not callable(original_method):
        return

    @wraps(original_method)
    def scoped_method(self: Any, *args: Any, **kwargs: Any) -> Any:
        scope_token = _outer_retry_scope.set(True)
        failure_token = _routed_failure_in_scope.set(False)
        try:
            return original_method(self, *args, **kwargs)
        finally:
            _routed_failure_in_scope.reset(failure_token)
            _outer_retry_scope.reset(scope_token)

    setattr(service_class, method_name, scoped_method)
    setattr(service_class, marker, True)


def _patch_direct_client(service_class: type[Any], retry_method: str) -> None:
    """Wrap direct OpenAI clients created by stock MiroFish services."""
    if getattr(service_class, "_finverse_openrouter_safe", False):
        _patch_outer_retry_scope(service_class, retry_method)
        return
    original_init = service_class.__init__

    def safe_init(self: Any, *args: Any, **kwargs: Any) -> None:
        original_init(self, *args, **kwargs)
        base_url = str(getattr(self, "base_url", ""))
        client = getattr(self, "client", None)
        if (
            "openrouter.ai" in base_url
            and client is not None
            and not getattr(client, "_finverse_openrouter_routed", False)
        ):
            self.client = _RoutedOpenAIClient(client)

    service_class.__init__ = safe_init
    service_class._finverse_openrouter_safe = True
    _patch_outer_retry_scope(service_class, retry_method)


def enable_openrouter_safe_responses() -> None:
    """Patch the already-imported MiroFish client when OpenRouter is in use."""
    from app.utils.llm_client import LLMClient

    if not getattr(LLMClient, "_finverse_openrouter_safe", False):
        original_chat = LLMClient.chat

        def safe_chat(
            self: Any,
            messages: list[dict[str, str]],
            temperature: float = 0.7,
            max_tokens: int = 4096,
            response_format: dict[str, Any] | None = None,
        ) -> str:
            base_url = str(getattr(self, "base_url", ""))
            if "openrouter.ai" not in base_url:
                return original_chat(self, messages, temperature, max_tokens, response_format)

            request: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if response_format:
                request["response_format"] = response_format
            response = _routed_completion(self.client, request)
            content = _response_content(response)
            if content is None:  # guarded by _routed_completion; keeps typing explicit
                raise RuntimeError("OpenRouter returned an empty response")
            return content

        LLMClient.chat = safe_chat
        LLMClient._finverse_openrouter_safe = True

    # These stock MiroFish services instantiate OpenAI directly instead of
    # using LLMClient. Patch their constructors without changing the original
    # source checkout, preserving all prompts, parsing, and business logic.
    for module_name, class_name, retry_method in (
        (
            "app.services.oasis_profile_generator",
            "OasisProfileGenerator",
            "_generate_profile_with_llm",
        ),
        (
            "app.services.simulation_config_generator",
            "SimulationConfigGenerator",
            "_call_llm_with_retry",
        ),
    ):
        try:
            module = import_module(module_name)
            service_class = getattr(module, class_name)
        except (ImportError, AttributeError):
            continue
        _patch_direct_client(service_class, retry_method)
