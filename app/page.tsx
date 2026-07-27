"use client";

import { BrainCircuit, Network, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";

type MainTab = "market" | "twin";

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>("market");

  const activateTab = (tab: MainTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="finverse-app">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => activateTab("market")}
          aria-label="FINVERSE 시장 인사이트 홈"
        >
          <span className="brand-mark">F</span>
          <span>FINVERSE</span>
        </button>

        <nav className="top-tabs" aria-label="주요 메뉴">
          <button
            className={activeTab === "market" ? "active" : ""}
            onClick={() => activateTab("market")}
          >
            시장 인사이트
          </button>
          <button
            className={activeTab === "twin" ? "active" : ""}
            onClick={() => activateTab("twin")}
          >
            마이 금융 트윈
          </button>
        </nav>

      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="FINVERSE 탐색">
          <div className="sidebar-label">
            <BrainCircuit size={19} aria-hidden="true" />
            <div>
              <span>AI DECISION LAB</span>
              <strong>금융 판단 실험실</strong>
            </div>
          </div>

          <nav className="side-tabs">
            <button
              className={activeTab === "market" ? "active" : ""}
              onClick={() => activateTab("market")}
            >
              <Network size={18} aria-hidden="true" />
              시장 인사이트
            </button>
            <button
              className={activeTab === "twin" ? "active" : ""}
              onClick={() => activateTab("twin")}
            >
              <UserRound size={18} aria-hidden="true" />
              마이 금융 트윈
            </button>
          </nav>

          <div className="sidebar-note">
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <strong>교육용 가상 데이터</strong>
              <p>실제 금융 계좌와 연결되지 않는 서비스 화면입니다.</p>
            </div>
          </div>
        </aside>

        <main className="main-content">
          <section
            className="empty-tab-content"
            aria-label={activeTab === "market" ? "시장 인사이트 작업 영역" : "마이 금융 트윈 작업 영역"}
          />
        </main>
      </div>

      <nav className="mobile-tabs" aria-label="모바일 주요 메뉴">
        <button
          className={activeTab === "market" ? "active" : ""}
          onClick={() => activateTab("market")}
        >
          <Network size={18} />
          <span>시장 인사이트</span>
        </button>
        <button
          className={activeTab === "twin" ? "active" : ""}
          onClick={() => activateTab("twin")}
        >
          <UserRound size={18} />
          <span>마이 금융 트윈</span>
        </button>
      </nav>
    </div>
  );
}
