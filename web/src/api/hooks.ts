import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./client";
import type {
  GraphPayload,
  HealthResponse,
  NodeDetail,
  SearchResponse,
  VocabularyResponse,
} from "./types";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet<HealthResponse>("/api/health"),
    refetchInterval: 30_000,
  });
}

export function useVocabulary() {
  return useQuery({
    queryKey: ["vocabulary"],
    queryFn: () => apiGet<VocabularyResponse>("/api/ontology/vocabulary"),
    staleTime: 5 * 60_000,
  });
}

export function useOverview(labels: string[], perLabel: number) {
  const key = [...labels].sort().join(",");
  return useQuery({
    queryKey: ["overview", key, perLabel],
    queryFn: () =>
      apiGet<GraphPayload>("/api/graph/overview", {
        labels: key || undefined,
        per_label: perLabel,
      }),
  });
}

export function useNodeDetail(uid: string | null) {
  return useQuery({
    queryKey: ["node", uid],
    // uid에 슬래시·물음표가 들어간다(Event uid = 기사 URL) — 경로 세그먼트로 인코딩.
    queryFn: () => apiGet<NodeDetail>(`/api/graph/node/${encodeURIComponent(uid!)}`),
    enabled: uid !== null,
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => apiGet<SearchResponse>("/api/search", { q: query, limit: 20 }),
    enabled: query.trim().length > 0,
  });
}

/** 이웃 확장은 클릭 시점에 한 번만 부르므로 훅이 아니라 함수로 둔다. */
export function fetchNeighbors(uid: string, depth: number, limit = 120) {
  return apiGet<GraphPayload>("/api/graph/neighbors", {
    node_id: uid,
    depth,
    limit,
  });
}
