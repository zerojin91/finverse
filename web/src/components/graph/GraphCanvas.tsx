import cytoscape from "cytoscape";
import type { Core, ElementDefinition, NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useEffect, useRef } from "react";
import { CYTOSCAPE_STYLESHEET } from "./graphStyles";

cytoscape.use(fcose);

export type SelectedNode = {
  id: string;
  label: string;
  name: string;
  props: Record<string, unknown>;
};

type Props = {
  elements: ElementDefinition[];
  onSelect: (node: SelectedNode | null) => void;
  /** 더블클릭 = 이웃 확장 */
  onExpand: (uid: string) => void;
  /** 강조할 노드 id — 검색 결과에서 고른 노드 */
  focusId?: string | null;
};

/**
 * randomize는 "기존 좌표를 시작점으로 쓸지"를 정한다.
 * - 첫 배치: true. 새 노드는 전부 (0,0)에 있어서 false로 두면 힘이 한 방향으로만
 *   작용해 노드가 대각선 한 줄로 늘어선다.
 * - 확장 배치: false. 이미 자리를 잡은 노드를 흔들지 않고 새 노드만 끼워 넣는다.
 */
function layoutOptions(randomize: boolean) {
  return {
    name: "fcose",
    quality: "proof",
    animate: false,
    randomize,
    nodeRepulsion: 12000,
    idealEdgeLength: 110,
    nodeSeparation: 120,
    // 연결이 없는 덩어리(예: 구성종목 미상인 섹터)를 한 구석에 뭉치지 않게 띄운다.
    packComponents: true,
  };
}

function toSelected(node: NodeSingular): SelectedNode {
  return {
    id: node.id(),
    label: String(node.data("label")),
    name: String(node.data("name")),
    props: (node.data("props") ?? {}) as Record<string, unknown>,
  };
}

export default function GraphCanvas({ elements, onSelect, onExpand, focusId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  // 콜백은 렌더마다 새로 만들어지지만 cytoscape 핸들러는 한 번만 붙인다 —
  // ref로 최신 콜백을 가리켜 리스너 재등록(과 그로 인한 중복 발화)을 피한다.
  const handlers = useRef({ onSelect, onExpand });
  handlers.current = { onSelect, onExpand };

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: CYTOSCAPE_STYLESHEET as unknown as cytoscape.StylesheetJson,
      minZoom: 0.1,
      maxZoom: 3,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => handlers.current.onSelect(toSelected(evt.target)));
    cy.on("dbltap", "node", (evt) => handlers.current.onExpand(evt.target.id()));
    cy.on("tap", (evt) => {
      if (evt.target === cy) handlers.current.onSelect(null);
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // 요소 반영 — 신규 노드만 추가하고 레이아웃은 추가가 있을 때만 돌린다.
  // 확장할 때마다 전체 레이아웃을 다시 돌리면 보고 있던 노드가 화면 밖으로 튄다.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const incoming = new Set(elements.map((el) => String(el.data.id)));
    const present = new Set(cy.elements().map((el) => el.id()));

    const removed = cy.elements().filter((el) => !incoming.has(el.id()));
    if (removed.length > 0) removed.remove();

    const added = elements.filter((el) => !present.has(String(el.data.id)));
    if (added.length > 0) cy.add(added);

    if (added.length > 0 || removed.length > 0) {
      const first = present.size === 0;
      cy.layout(layoutOptions(first)).run();
      // animate:false면 run()이 동기적으로 끝나므로 여기서 바로 맞춰도 된다.
      if (first) cy.fit(undefined, 40);
    }
  }, [elements]);

  // 검색으로 고른 노드로 이동
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !focusId) return;
    const node = cy.getElementById(focusId);
    if (node.length === 0) return;
    cy.animate({ center: { eles: node }, zoom: 1.2 }, { duration: 250 });
    node.select();
    handlers.current.onSelect(toSelected(node as NodeSingular));
  }, [focusId]);

  return <div className="graph-canvas" ref={containerRef} />;
}
