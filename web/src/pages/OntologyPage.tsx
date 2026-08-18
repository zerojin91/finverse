import { useVocabulary } from "../api/hooks";
import { LAYER_COLORS, LAYER_LABELS, nodeStyleOf } from "../components/graph/graphStyles";
import type { Layer } from "../components/graph/graphStyles";

const LAYER_ORDER: Layer[] = ["entity", "event", "scenario"];

/** 어휘 대조표 — 정의된 라벨/엣지와 실제 투영량을 나란히 놓는다.
    수치는 db/ontology.sql의 CHECK 제약(허용 어휘)과 graph 테이블(실제)에서 온다.
    문서에만 있고 코드에 없는 어휘는 여기 나타나지 않는다 — 그것이 검증이다. */
export default function OntologyPage() {
  const { data, isLoading, error } = useVocabulary();

  if (isLoading) return <div className="state">불러오는 중…</div>;
  if (error) return <div className="state error">{(error as Error).message}</div>;
  if (!data) return null;

  const empty = data.labels.filter((l) => l.count === 0).length;

  return (
    <div className="ontology-page">
      <header className="ontology-head">
        <h2>어휘와 적재 현황</h2>
        <p className="muted">
          어휘의 단일 진실은 <code>docs/ontology/scenario-ontology.md</code>, 강제하는 곳은{" "}
          <code>db/ontology.sql</code>의 CHECK 제약이다. 이 표는 그 제약에서 되읽은 것이다.
        </p>
        <p className="ontology-summary">
          노드 {data.node_total.toLocaleString()}개 · 엣지 {data.edge_total.toLocaleString()}개 ·
          정의됐지만 아직 비어 있는 라벨 <strong>{empty}</strong>종
        </p>
      </header>

      <section>
        <h3>노드 라벨</h3>
        {LAYER_ORDER.map((layer) => {
          const rows = data.labels.filter((l) => nodeStyleOf(l.label).layer === layer);
          if (rows.length === 0) return null;
          return (
            <div key={layer} className="ontology-layer">
              <h4 style={{ color: LAYER_COLORS[layer] }}>{LAYER_LABELS[layer]}</h4>
              <table className="ontology-table">
                <tbody>
                  {rows.map((row) => {
                    const style = nodeStyleOf(row.label);
                    return (
                      <tr key={row.label} className={row.count === 0 ? "is-empty" : undefined}>
                        <td className="cell-dot">
                          <span className="dot" style={{ backgroundColor: style.color }} />
                        </td>
                        <td className="cell-label">
                          <code>{row.label}</code>
                        </td>
                        <td className="cell-ko">{style.ko}</td>
                        <td className="cell-count">
                          {row.count === 0 ? "—" : row.count.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>

      <section>
        <h3>엣지 타입</h3>
        <table className="ontology-table">
          <tbody>
            {data.edge_types.map((row) => (
              <tr key={row.type} className={row.count === 0 ? "is-empty" : undefined}>
                <td className="cell-label">
                  <code>{row.type}</code>
                </td>
                <td className="cell-ko">
                  {row.derived && <span className="tag derived">파생</span>}
                </td>
                <td className="cell-count">
                  {row.count === 0 ? "—" : row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          파생 = <code>method</code>·<code>computed_at</code>·<code>pipeline_version</code>을
          요구받는 엣지. 재계산이 지워도 되는 것이라는 계약이다 (§4).
        </p>
      </section>
    </div>
  );
}
