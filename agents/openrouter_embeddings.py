"""OpenRouter embedding adapter for the FINVERSE Neo4j runtime."""

from __future__ import annotations

import os
import time
from typing import Optional

import requests


class OpenRouterEmbeddingError(RuntimeError):
    """Raised when an OpenRouter embedding request cannot complete."""


class OpenRouterEmbeddingService:
    """MiroFish-compatible embedding service backed by OpenRouter's API."""

    def __init__(self, model: Optional[str] = None, dimensions: Optional[int] = None) -> None:
        self.model = model or os.environ.get("FINVERSE_EMBEDDING_MODEL", "baai/bge-m3")
        self.dimensions = dimensions or int(os.environ.get("FINVERSE_EMBEDDING_DIMENSIONS", "1024"))
        self.api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        self.base_url = os.environ.get("FINVERSE_EMBEDDING_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        self.timeout = int(os.environ.get("FINVERSE_EMBEDDING_TIMEOUT_SECONDS", "90"))
        self.max_retries = int(os.environ.get("FINVERSE_EMBEDDING_MAX_RETRIES", "3"))
        self._cache: dict[str, list[float]] = {}
        if not self.api_key:
            raise OpenRouterEmbeddingError("OPENROUTER_API_KEY is required for OpenRouter embeddings")

    def embed(self, text: str) -> list[float]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: list[str], batch_size: int = 32) -> list[list[float]]:
        if not texts:
            return []
        result: list[Optional[list[float]]] = [None] * len(texts)
        pending: list[tuple[int, str]] = []
        for index, raw_text in enumerate(texts):
            text = raw_text.strip() if raw_text else ""
            if not text:
                result[index] = [0.0] * self.dimensions
            elif text in self._cache:
                result[index] = self._cache[text]
            else:
                pending.append((index, text))
        for start in range(0, len(pending), batch_size):
            batch = pending[start:start + batch_size]
            vectors = self._request([text for _, text in batch])
            for (index, text), vector in zip(batch, vectors):
                result[index] = vector
                if len(self._cache) >= 2_000:
                    self._cache.pop(next(iter(self._cache)))
                self._cache[text] = vector
        return [vector if vector is not None else [0.0] * self.dimensions for vector in result]

    def _request(self, texts: list[str]) -> list[list[float]]:
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    f"{self.base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json={"model": self.model, "input": texts, "encoding_format": "float"},
                    timeout=self.timeout,
                )
                response.raise_for_status()
                data = response.json().get("data", [])
                vectors = [item.get("embedding") for item in sorted(data, key=lambda item: item.get("index", 0))]
                if len(vectors) != len(texts) or any(not isinstance(vector, list) for vector in vectors):
                    raise OpenRouterEmbeddingError("OpenRouter returned an invalid embedding response")
                if any(len(vector) != self.dimensions for vector in vectors):
                    raise OpenRouterEmbeddingError(f"Expected {self.dimensions}-dimension embeddings from {self.model}")
                return vectors
            except (requests.RequestException, ValueError, OpenRouterEmbeddingError) as exc:
                last_error = exc
                if attempt < self.max_retries - 1:
                    time.sleep(2 ** attempt)
        raise OpenRouterEmbeddingError(f"OpenRouter embedding request failed: {last_error}")


def configure_mirofish_vector_schema(dimensions: int) -> None:
    """Patch the MiroFish runtime schema before Neo4jStorage is initialized."""
    from app.storage import neo4j_schema

    neo4j_schema.CREATE_ENTITY_VECTOR_INDEX = f"""
CREATE VECTOR INDEX entity_embedding IF NOT EXISTS
FOR (n:Entity) ON (n.embedding)
OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, `vector.similarity_function`: 'cosine'}}}}
"""
    neo4j_schema.CREATE_RELATION_VECTOR_INDEX = f"""
CREATE VECTOR INDEX fact_embedding IF NOT EXISTS
FOR ()-[r:RELATION]-() ON (r.fact_embedding)
OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, `vector.similarity_function`: 'cosine'}}}}
"""
    neo4j_schema.ALL_SCHEMA_QUERIES = [
        neo4j_schema.CREATE_GRAPH_UUID_CONSTRAINT,
        neo4j_schema.CREATE_ENTITY_UUID_CONSTRAINT,
        neo4j_schema.CREATE_EPISODE_UUID_CONSTRAINT,
        neo4j_schema.CREATE_ENTITY_VECTOR_INDEX,
        neo4j_schema.CREATE_RELATION_VECTOR_INDEX,
        neo4j_schema.CREATE_ENTITY_FULLTEXT_INDEX,
        neo4j_schema.CREATE_FACT_FULLTEXT_INDEX,
    ]
