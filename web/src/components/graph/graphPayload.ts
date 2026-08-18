import type { ElementDefinition } from "cytoscape";
import type { GraphEdge, GraphNode, GraphPayload } from "../../api/types";
import { nodeStyleOf } from "./graphStyles";

/** 파생 엣지 판별 — properties.method 존재 여부.
    scenario-ontology.md §4: 파생 엣지는 method/computed_at/pipeline_version을 갖는다
    (db/ontology.sql의 derived_edge_declares_method가 이를 강제한다). */
export function isDerivedEdge(edge: GraphEdge): boolean {
  return edge.properties != null && "method" in edge.properties;
}

export function nodeToElement(node: GraphNode): ElementDefinition {
  const style = nodeStyleOf(node.label);
  return {
    group: "nodes",
    data: {
      id: node.id,
      label: node.label,
      name: node.name,
      color: style.color,
      shape: style.shape,
      layer: style.layer,
      evidenceCount: node.evidence_count,
      props: node.properties ?? {},
    },
  };
}

export function edgeToElement(edge: GraphEdge): ElementDefinition {
  return {
    group: "edges",
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      props: edge.properties ?? {},
    },
    classes: isDerivedEdge(edge) ? "derived" : undefined,
  };
}

/** GraphPayload → cytoscape 요소 (노드가 항상 엣지보다 앞) */
export function toElements(payload: GraphPayload): ElementDefinition[] {
  return [...payload.nodes.map(nodeToElement), ...payload.edges.map(edgeToElement)];
}

/** id 기준 중복 제거 병합 — 이웃 확장 결과를 캔버스에 누적할 때 쓴다. base 우선. */
export function mergeElements(
  base: ElementDefinition[],
  extra: ElementDefinition[],
): ElementDefinition[] {
  const seen = new Set(base.map((el) => String(el.data.id)));
  const merged = [...base];
  for (const el of extra) {
    const id = String(el.data.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(el);
  }
  return merged;
}
