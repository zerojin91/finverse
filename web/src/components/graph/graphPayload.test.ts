import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "../../api/types";
import { edgeToElement, isDerivedEdge, mergeElements, nodeToElement } from "./graphPayload";

const node = (over: Partial<GraphNode> = {}): GraphNode => ({
  id: "market:kospi",
  label: "Market",
  name: "KOSPI",
  properties: { code: "KOSPI" },
  evidence_count: 5,
  ...over,
});

const edge = (over: Partial<GraphEdge> = {}): GraphEdge => ({
  id: "TRACKS:index:a->market:kospi",
  source: "index:a",
  target: "market:kospi",
  label: "TRACKS",
  properties: { source: "krx_open_api" },
  ...over,
});

describe("isDerivedEdge", () => {
  it("method 속성이 있으면 파생 엣지", () => {
    expect(isDerivedEdge(edge({ properties: { method: "corr/v1" } }))).toBe(true);
  });

  it("관측 엣지(source만 있음)는 파생이 아니다", () => {
    expect(isDerivedEdge(edge())).toBe(false);
  });

  it("속성이 비어도 죽지 않는다", () => {
    expect(isDerivedEdge(edge({ properties: {} }))).toBe(false);
  });
});

describe("nodeToElement", () => {
  it("라벨에서 색·모양을 붙인다", () => {
    const el = nodeToElement(node());
    expect(el.data.id).toBe("market:kospi");
    expect(el.data.color).toBeTruthy();
    expect(el.data.shape).toBeTruthy();
    expect(el.data.layer).toBe("entity");
  });

  it("어휘에 없는 라벨도 폴백 스타일로 그린다", () => {
    // 문서에 라벨이 추가되고 프론트가 아직 모를 때 화면이 빈 채로 죽으면 안 된다.
    const el = nodeToElement(node({ label: "SomethingNew" }));
    expect(el.data.color).toBeTruthy();
  });
});

describe("edgeToElement", () => {
  it("파생 엣지에는 derived 클래스가 붙는다", () => {
    expect(edgeToElement(edge({ properties: { method: "x" } })).classes).toBe("derived");
    expect(edgeToElement(edge()).classes).toBeUndefined();
  });
});

describe("mergeElements", () => {
  it("id 중복은 base를 남긴다", () => {
    const a = [nodeToElement(node())];
    const b = [nodeToElement(node({ name: "다른이름" }))];
    const merged = mergeElements(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].data.name).toBe("KOSPI");
  });

  it("새 id는 뒤에 붙는다", () => {
    const merged = mergeElements(
      [nodeToElement(node())],
      [nodeToElement(node({ id: "market:kosdaq", name: "KOSDAQ" }))],
    );
    expect(merged.map((el) => el.data.id)).toEqual(["market:kospi", "market:kosdaq"]);
  });
});
