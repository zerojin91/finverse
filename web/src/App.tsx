import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { useHealth } from "./api/hooks";
import GraphExplorerPage from "./pages/GraphExplorerPage";
import OntologyPage from "./pages/OntologyPage";

/** DB 상태 표시 — API는 DB가 죽어도 200을 주므로 여기서 사유를 보여준다. */
function HealthBadge() {
  const { data, error } = useHealth();
  if (error) return <span className="health bad">API 연결 실패</span>;
  if (!data) return null;
  if (data.status !== "ok") {
    return <span className="health bad">DB {data.database}</span>;
  }
  return (
    <span className="health ok">
      노드 {data.node_count?.toLocaleString()} · 엣지 {data.edge_count?.toLocaleString()}
    </span>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-nav">
          <span className="brand">FINVERSE</span>
          <NavLink to="/" end>
            그래프 탐색
          </NavLink>
          <NavLink to="/ontology">어휘</NavLink>
          <div className="nav-spacer" />
          <HealthBadge />
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<GraphExplorerPage />} />
            <Route path="/ontology" element={<OntologyPage />} />
            <Route path="*" element={<div className="state">페이지를 찾을 수 없습니다.</div>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
