import { useNodeDetail } from "../../api/hooks";
import SeriesPanel from "../series/SeriesPanel";
import type { SelectedNode } from "./GraphCanvas";
import { labelText, nodeStyleOf } from "./graphStyles";

/** 시계열을 갖는 라벨 — API의 SERIES_KINDS와 같은 집합. */
const SERIES_LABELS = new Set(["Security", "Index", "Indicator"]);

type Props = {
  node: SelectedNode;
  onClose: () => void;
  onExpand: () => void;
};

function PropList({ props }: { props: Record<string, unknown> }) {
  const entries = Object.entries(props);
  if (entries.length === 0) return <p className="state">표시할 속성이 없습니다.</p>;
  return (
    <dl className="kv">
      {entries.map(([key, value]) => (
        <div className="kv-row" key={key}>
          <dt>{key}</dt>
          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function NodeSidePanel({ node, onClose, onExpand }: Props) {
  const style = nodeStyleOf(node.label);
  const { data, isLoading, error } = useNodeDetail(node.id);

  return (
    <aside className="node-side-panel">
      <div className="panel-header">
        <span className="label-badge" style={{ backgroundColor: style.color }}>
          {labelText(node.label)}
        </span>
        <button type="button" className="panel-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      <strong className="panel-name">{node.name}</strong>
      <div className="panel-uid">{node.id}</div>

      <div className="panel-actions">
        <button type="button" className="btn" onClick={onExpand}>
          이웃 확장
        </button>
      </div>

      {isLoading && <p className="state">불러오는 중…</p>}
      {error && <p className="state error">{(error as Error).message}</p>}

      <SeriesPanel uid={node.id} hasSeries={SERIES_LABELS.has(node.label)} />

      {data && (
        <>
          <section className="panel-section">
            <h4>속성</h4>
            <PropList props={data.properties} />
          </section>

          <section className="panel-section">
            <h4>연결</h4>
            {data.degrees.length === 0 ? (
              <p className="state">연결된 엣지가 없습니다.</p>
            ) : (
              <ul className="degree-list">
                {data.degrees.map((d) => (
                  <li key={`${d.type}-${d.direction}`}>
                    <code>{d.type}</code>
                    <span className="degree-dir">{d.direction === "out" ? "→" : "←"}</span>
                    <span className="degree-count">{d.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel-section">
            {/* 온톨로지가 모든 노드에 요구하는 것: 어느 수집 레코드에서 나왔는가.
                이 화면이 다른 그래프 뷰어와 다른 지점이라 접어두지 않고 노출한다. */}
            <h4>
              근거 <span className="muted">evidence · lake.records</span>
            </h4>
            <p className="evidence-count">
              {data.evidence_count.toLocaleString()}건
              {data.evidence_count > data.evidence.length &&
                ` (앞 ${data.evidence.length}건 표시)`}
            </p>
            <ul className="evidence-list">
              {data.evidence.map((rid) => (
                <li key={rid}>
                  <code>{rid.slice(0, 16)}…</code>
                </li>
              ))}
            </ul>
            {data.projected_at && (
              <p className="muted small">투영 시각 {data.projected_at.slice(0, 19).replace("T", " ")}</p>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
