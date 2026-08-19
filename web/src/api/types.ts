/** API 계약 — api/src/fin_api/schemas 와 1:1. 라벨/엣지 타입은 문자열로 둔다
    (어휘의 단일 진실은 docs/ontology/scenario-ontology.md와 db/ontology.sql). */

export type GraphNode = {
  id: string;
  label: string;
  name: string;
  properties: Record<string, unknown>;
  evidence_count: number;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  properties: Record<string, unknown>;
};

export type GraphMeta = {
  node_count: number;
  edge_count: number;
  truncated: boolean;
};

export type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
};

export type DegreeEntry = {
  type: string;
  direction: "out" | "in";
  count: number;
};

export type NodeDetail = {
  id: string;
  label: string;
  name: string;
  properties: Record<string, unknown>;
  evidence: string[];
  evidence_count: number;
  degrees: DegreeEntry[];
  projected_at: string | null;
};

export type SearchHit = {
  id: string;
  label: string;
  name: string;
  matched_on: string;
};

export type SearchResponse = {
  query: string;
  hits: SearchHit[];
  truncated: boolean;
};

export type SeriesPoint = {
  bas_dd: string;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
};

export type SeriesResponse = {
  id: string;
  label: string;
  /** price | index | indicator | none */
  kind: string;
  source: string | null;
  sources: string[];
  points: SeriesPoint[];
  truncated: boolean;
};

export type LabelEntry = { label: string; count: number };
export type EdgeTypeEntry = { type: string; count: number; derived: boolean };

export type VocabularyResponse = {
  labels: LabelEntry[];
  edge_types: EdgeTypeEntry[];
  node_total: number;
  edge_total: number;
};

export type HealthResponse = {
  status: string;
  database: string;
  node_count: number | null;
  edge_count: number | null;
  detail: string | null;
};
