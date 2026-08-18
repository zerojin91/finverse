/*
 * 라벨별 표시 규칙 — cytoscape는 CSS 변수를 못 읽으므로 hex를 직접 쓴다.
 * 계층 구분은 docs/ontology/scenario-ontology.md의 절 구성을 그대로 따른다:
 *   §1 실체(시간이 지나도 같은 것) · §2 사건(시간 위의 한 점) · §5 시나리오(질문→분기)
 * 계층이 색상 계열을 정하고, 라벨이 그 안의 명도를 정한다. 화면에서 "무엇이 관측된
 * 사실이고 무엇이 시뮬레이션 산물인가"가 색으로 먼저 읽히게 하려는 것이다.
 */

export type Layer = "entity" | "event" | "scenario";

export type NodeStyle = {
  color: string;
  shape: string;
  layer: Layer;
  ko: string;
};

export const LAYER_LABELS: Record<Layer, string> = {
  entity: "실체",
  event: "사건",
  scenario: "시나리오",
};

export const LAYER_COLORS: Record<Layer, string> = {
  entity: "#3b6fd4",
  event: "#d97706",
  scenario: "#8b5cf6",
};

/** 어휘 전체 — 아직 0건인 라벨도 포함한다. 정의됐지만 안 채워진 자리를 보여주는 게
    이 화면의 목적 중 하나다. */
export const NODE_STYLE: Record<string, NodeStyle> = {
  // §1 실체
  Market: { color: "#1e40af", shape: "round-rectangle", layer: "entity", ko: "시장" },
  Index: { color: "#2563eb", shape: "ellipse", layer: "entity", ko: "지수" },
  Sector: { color: "#60a5fa", shape: "round-diamond", layer: "entity", ko: "섹터" },
  Security: { color: "#93c5fd", shape: "ellipse", layer: "entity", ko: "종목" },
  Indicator: { color: "#0891b2", shape: "round-tag", layer: "entity", ko: "경제지표" },
  Actor: { color: "#0d9488", shape: "round-hexagon", layer: "entity", ko: "행위자" },
  // §2 사건
  MarketMove: { color: "#dc2626", shape: "triangle", layer: "event", ko: "시장 변동" },
  Release: { color: "#ea580c", shape: "round-tag", layer: "event", ko: "지표 발표" },
  Event: { color: "#f59e0b", shape: "round-rectangle", layer: "event", ko: "사건(뉴스)" },
  SentimentWindow: { color: "#fbbf24", shape: "round-octagon", layer: "event", ko: "감성 구간" },
  Regime: { color: "#b45309", shape: "rectangle", layer: "event", ko: "국면" },
  // §5 시나리오
  Question: { color: "#7c3aed", shape: "round-rectangle", layer: "scenario", ko: "질문" },
  Situation: { color: "#8b5cf6", shape: "round-octagon", layer: "scenario", ko: "상황" },
  Brief: { color: "#a78bfa", shape: "round-rectangle", layer: "scenario", ko: "브리프" },
  Simulation: { color: "#6366f1", shape: "round-hexagon", layer: "scenario", ko: "시뮬레이션" },
  Branch: { color: "#818cf8", shape: "round-diamond", layer: "scenario", ko: "분기" },
  Assumption: { color: "#c4b5fd", shape: "round-tag", layer: "scenario", ko: "전제" },
};

export const FALLBACK_NODE_STYLE: NodeStyle = {
  color: "#94a3b8",
  shape: "ellipse",
  layer: "entity",
  ko: "",
};

export function nodeStyleOf(label: string): NodeStyle {
  return NODE_STYLE[label] ?? FALLBACK_NODE_STYLE;
}

/** 라벨 → "지수(Index)" 형태의 표시 문자열 */
export function labelText(label: string): string {
  const ko = NODE_STYLE[label]?.ko;
  return ko ? `${ko} (${label})` : label;
}

/** cytoscape 스타일시트 — 노드 색은 data(color)로 주입(라벨별 selector 17개를 피한다) */
export const CYTOSCAPE_STYLESHEET = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      shape: "data(shape)",
      label: "data(name)",
      "font-size": 10,
      "font-family": "system-ui, -apple-system, sans-serif",
      color: "#1f2937",
      "text-valign": "bottom",
      "text-margin-y": 4,
      "text-max-width": 120,
      "text-wrap": "ellipsis",
      width: 26,
      height: 26,
      "border-width": 0,
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 3,
      "border-color": "#111827",
      "font-weight": "bold",
    },
  },
  {
    selector: "node.faded",
    style: { opacity: 0.15, "text-opacity": 0.15 },
  },
  {
    selector: "edge",
    style: {
      width: 1.2,
      "line-color": "#cbd5e1",
      "target-arrow-color": "#cbd5e1",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.7,
      "curve-style": "bezier",
      label: "data(label)",
      "font-size": 8,
      color: "#94a3b8",
      "text-opacity": 0,
    },
  },
  {
    // 파생 엣지 = method/computed_at/pipeline_version을 가진 것. 점선으로 "재계산이
    // 지워도 되는 엣지"임을 표시한다 (scenario-ontology.md §4).
    selector: "edge.derived",
    style: { "line-style": "dashed", "line-color": "#a78bfa", "target-arrow-color": "#a78bfa" },
  },
  {
    selector: "edge:selected, edge.highlight",
    style: { width: 2.4, "line-color": "#111827", "target-arrow-color": "#111827", "text-opacity": 1 },
  },
  {
    selector: "edge.faded",
    style: { opacity: 0.08, "text-opacity": 0 },
  },
] as const;
