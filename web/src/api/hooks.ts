import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./client";
import type {
  GraphPayload,
  HealthResponse,
  NodeDetail,
  SearchResponse,
  SeriesResponse,
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

/**
 * 노드의 시계열. `enabled`가 true가 될 때까지 요청하지 않는다 — 패널에서 사용자가
 * 펼쳤을 때만 부르는 게 이 엔드포인트의 전제다(그래프에도 core에도 값이 없고
 * 매번 lake를 읽는다). staleTime을 길게 둬서 접었다 펴도 다시 안 부른다.
 */
export function useSeries(uid: string | null, source: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["series", uid, source],
    queryFn: () =>
      apiGet<SeriesResponse>("/api/graph/series", {
        node_id: uid!,
        source: source ?? undefined,
        limit: 400,
      }),
    enabled: enabled && uid !== null,
    staleTime: 10 * 60_000,
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
