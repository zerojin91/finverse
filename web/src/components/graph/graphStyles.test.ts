import { describe, expect, it } from "vitest";
import { LAYER_LABELS, NODE_STYLE, labelText, nodeStyleOf } from "./graphStyles";

/** db/ontology.sql의 node_label_known이 허용하는 17종.
    프론트 스타일표가 어휘를 앞서가거나 뒤처지면 여기서 걸린다. */
const ONTOLOGY_LABELS = [
  "Market",
  "Index",
  "Sector",
  "Security",
  "Indicator",
  "Actor",
  "MarketMove",
  "Release",
  "Event",
  "SentimentWindow",
  "Regime",
  "Question",
  "Situation",
  "Brief",
  "Simulation",
  "Branch",
  "Assumption",
];

describe("NODE_STYLE", () => {
  it("어휘의 모든 라벨에 스타일이 있다", () => {
    for (const label of ONTOLOGY_LABELS) {
      expect(NODE_STYLE[label], `${label} 스타일 누락`).toBeDefined();
    }
  });

  it("어휘에 없는 라벨을 넣어두지 않았다", () => {
    expect(Object.keys(NODE_STYLE).sort()).toEqual([...ONTOLOGY_LABELS].sort());
  });

  it("모든 라벨이 세 계층 중 하나에 속한다", () => {
    for (const style of Object.values(NODE_STYLE)) {
      expect(Object.keys(LAYER_LABELS)).toContain(style.layer);
    }
  });
});

describe("nodeStyleOf", () => {
  it("미지 라벨은 폴백", () => {
    expect(nodeStyleOf("Unknown").color).toBeTruthy();
  });
});

describe("labelText", () => {
  it("한글이 있으면 병기한다", () => {
    expect(labelText("Security")).toBe("종목 (Security)");
  });

  it("미지 라벨은 원문 그대로", () => {
    expect(labelText("Unknown")).toBe("Unknown");
  });
});
