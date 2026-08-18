import type { ElementDefinition } from "cytoscape";
import { useEffect, useMemo, useState } from "react";
import { fetchNeighbors, useOverview, useVocabulary } from "../api/hooks";
import SearchBox from "../components/SearchBox";
import GraphCanvas from "../components/graph/GraphCanvas";
import type { SelectedNode } from "../components/graph/GraphCanvas";
import GraphFilterBar from "../components/graph/GraphFilterBar";
import NodeSidePanel from "../components/graph/NodeSidePanel";
import { mergeElements, toElements } from "../components/graph/graphPayload";

/** 처음 화면에 띄울 라벨 — 골격만.
    Security 2,763개를 기본으로 켜면 나머지 라벨이 종목 무리에 묻힌다. */
const DEFAULT_LABELS = ["Market", "Index", "Sector", "Indicator"];

export default function GraphExplorerPage() {
  const vocabulary = useVocabulary();
  const [selectedLabels, setSelectedLabels] = useState<string[]>(DEFAULT_LABELS);
  const [perLabel, setPerLabel] = useState(60);
  const [extra, setExtra] = useState<ElementDefinition[]>([]);
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const overview = useOverview(selectedLabels, perLabel);

  // 필터가 바뀌면 확장으로 끌어온 노드는 버린다 — 필터에 없는 라벨이 남으면
  // 화면과 필터 상태가 어긋나 "왜 이게 보이지"가 된다.
  useEffect(() => {
    setExtra([]);
  }, [selectedLabels, perLabel]);

  const base = useMemo(
    () => (overview.data ? toElements(overview.data) : []),
    [overview.data],
  );
  const elements = useMemo(() => mergeElements(base, extra), [base, extra]);

  async function expand(uid: string) {
    setBusy(true);
    try {
      const payload = await fetchNeighbors(uid, 1, 120);
      setExtra((prev) => mergeElements(prev, toElements(payload)));
    } finally {
      setBusy(false);
    }
  }

  async function pickFromSearch(uid: string) {
    // 검색 결과는 지금 화면에 없을 수 있다 — 이웃을 먼저 끌어와야 이동할 대상이 생긴다.
    await expand(uid);
    setFocusId(uid);
  }

  return (
    <div className="explorer">
      <div className="explorer-top">
        <SearchBox onPick={pickFromSearch} />
        <div className="explorer-meta">
          {overview.data && (
            <>
              노드 {overview.data.meta.node_count.toLocaleString()}
              {overview.data.meta.truncated && (
                <span className="warn"> (라벨당 {perLabel}개로 잘림)</span>
              )}
              {" · 엣지 "}
              {overview.data.meta.edge_count.toLocaleString()}
              {extra.length > 0 && ` · 확장 ${extra.length}`}
            </>
          )}
          {busy && <span className="muted"> · 불러오는 중…</span>}
        </div>
      </div>

      {vocabulary.data && (
        <GraphFilterBar
          labels={vocabulary.data.labels}
          selected={selectedLabels}
          onToggle={(label) =>
            setSelectedLabels((prev) =>
              prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
            )
          }
          perLabel={perLabel}
          onPerLabel={setPerLabel}
        />
      )}

      <div className="explorer-body">
        {overview.error ? (
          <div className="state error">{(overview.error as Error).message}</div>
        ) : (
          <GraphCanvas
            elements={elements}
            onSelect={setSelected}
            onExpand={expand}
            focusId={focusId}
          />
        )}
        {selected && (
          <NodeSidePanel
            node={selected}
            onClose={() => setSelected(null)}
            onExpand={() => expand(selected.id)}
          />
        )}
      </div>

      <p className="explorer-hint">
        노드 클릭 = 상세 · 더블클릭 = 이웃 확장 · 점선 엣지 = 파생(재계산이 지워도 되는 것)
      </p>
    </div>
  );
}
