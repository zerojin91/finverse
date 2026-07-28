"use client";

import {
  ArrowRight,
  BarChart3,
  Bookmark,
  BrainCircuit,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  Plus,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type MainTab = "market" | "twin";

type Scenario = {
  id: string;
  title: string;
  duration: string;
  tags: string[];
  forecast: string;
  tone: "up" | "down";
  summary: string;
  path: number[];
  events: { week: string; category: string; title: string; body: string; impact: string }[];
};

const marketConnections = [
  { symbol: "S", name: "삼성전자", code: "005930 · KOSPI", value: "80,700원", change: "+1.51%", contribution: "+0.27%p", tone: "up" },
  { symbol: "H", name: "SK하이닉스", code: "000660 · KOSPI", value: "186,500원", change: "+2.21%", contribution: "+0.41%p", tone: "up" },
  { symbol: "$", name: "원·달러 환율", code: "USD/KRW", value: "1,336.80", change: "-0.35%", contribution: "-0.06%p", tone: "down" },
  { symbol: "F", name: "외국인 수급", code: "KOSPI", value: "-1,842억원", change: "순매도", contribution: "-0.23%p", tone: "down" },
  { symbol: "C", name: "반도체 지수", code: "KRX 반도체", value: "5,212.38", change: "+2.35%", contribution: "+0.38%p", tone: "up" },
] as const;

const actualPath = [
  6590, 6622, 6610, 6645, 6662, 6651, 6680, 6672, 6701, 6688, 6714, 6706,
  6730, 6719, 6742, 6734, 6750, 6741, 6764, 6751, 6770, 6758, 6776, 6762,
  6772, 6760, 6768, 6754, 6746, 6759, 6748, 6755.75,
];

const scenarios: Scenario[] = [
  {
    id: "fx",
    title: "원·달러 환율 1,450원",
    duration: "30일",
    tags: ["환율", "외국인"],
    forecast: "KOSPI -4.2%",
    tone: "down",
    summary:
      "원·달러 환율이 1,450원까지 상승하면 외국인 현·선물 수급이 약해지고 반도체 대형주의 밸류에이션 부담이 커지는 경로입니다. 수출주는 환율 효과로 일부 방어하지만 지수 상단은 제한되며, 6,300~6,750 구간에서 단기 변동성이 확대될 가능성이 있습니다.",
    path: [6755.75, 6718, 6728, 6692, 6655, 6668, 6618, 6575, 6542, 6508, 6486, 6472.2],
    events: [
      { week: "1주 차", category: "환율", title: "원·달러 1,400원 돌파", body: "외국인 현물·선물 매도가 동시에 확대됩니다.", impact: "-0.8%p" },
      { week: "2주 차", category: "수급", title: "반도체 대형주 조정", body: "환차손 우려로 지수 상위 종목의 매도 압력이 커집니다.", impact: "-1.6%p" },
      { week: "4주 차", category: "시장", title: "방어주 상대 강세", body: "통신·필수소비재로 자금이 이동하며 낙폭을 일부 줄입니다.", impact: "+0.5%p" },
    ],
  },
  {
    id: "chip",
    title: "반도체 실적 서프라이즈",
    duration: "60일",
    tags: ["반도체", "수출"],
    forecast: "KOSPI +6.8%",
    tone: "up",
    summary:
      "HBM 수요와 메모리 가격 상승이 실적 추정치를 끌어올리는 경로입니다. 삼성전자와 SK하이닉스의 지수 기여도가 높아지며 상승 폭이 확대됩니다.",
    path: [6755.75, 6810, 6855, 6912, 6970, 7025, 7070, 7122, 7165, 7228, 7200, 7215.1],
    events: [
      { week: "1주 차", category: "실적", title: "영업이익 전망 상향", body: "증권사 반도체 업종 추정치가 연속 상향됩니다.", impact: "+1.4%p" },
      { week: "3주 차", category: "수급", title: "외국인 반도체 순매수", body: "대형주 중심 프로그램 매수세가 강화됩니다.", impact: "+2.2%p" },
      { week: "8주 차", category: "산업", title: "AI 투자 사이클 재평가", body: "장비·부품주까지 실적 기대가 확산됩니다.", impact: "+1.1%p" },
    ],
  },
  {
    id: "foreign",
    title: "외국인 2조원 순매도",
    duration: "14일",
    tags: ["수급", "대형주"],
    forecast: "KOSPI -3.7%",
    tone: "down",
    summary:
      "지수 비중이 큰 종목에 매도가 집중되며 낙폭이 빠르게 확대되는 경로입니다. 기관 저가 매수가 유입되지만 단기 변동성은 높은 상태를 유지합니다.",
    path: [6755.75, 6704, 6668, 6625, 6580, 6545, 6512, 6478, 6450, 6472, 6490, 6505.8],
    events: [
      { week: "1일 차", category: "수급", title: "프로그램 매도 확대", body: "선물 베이시스 악화로 대형주 매도가 늘어납니다.", impact: "-1.2%p" },
      { week: "5일 차", category: "변동성", title: "KOSPI 변동성 급등", body: "손절과 반대매매가 겹치며 장중 낙폭이 확대됩니다.", impact: "-1.8%p" },
      { week: "2주 차", category: "기관", title: "연기금 저가 매수", body: "낙폭 과대 업종 중심으로 지수 하단을 지지합니다.", impact: "+0.7%p" },
    ],
  },
];

function ForecastChart({ scenario }: { scenario: Scenario }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const pad = { top: 22, right: 24, bottom: 36, left: 50 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      const splitX = pad.left + plotW * 0.58;
      const rightX = width - pad.right;
      const outerUpper = scenario.path.map((value, index) => value + 12 + index * 11);
      const outerLower = scenario.path.map((value, index) => value - 12 - index * 11);
      const innerUpper = scenario.path.map((value, index) => value + 7 + index * 6);
      const innerLower = scenario.path.map((value, index) => value - 7 - index * 6);
      const all = [...actualPath, ...outerUpper, ...outerLower];
      const min = Math.min(...all) - 24;
      const max = Math.max(...all) + 24;
      const xActual = (index: number) => pad.left + (index / (actualPath.length - 1)) * (splitX - pad.left);
      const xForecast = (index: number) => splitX + (index / (scenario.path.length - 1)) * (rightX - splitX);
      const y = (value: number) => pad.top + ((max - value) / (max - min)) * plotH;

      ctx.clearRect(0, 0, width, height);
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.textAlign = "right";
      ctx.fillStyle = "#a1a1aa";
      ctx.strokeStyle = "#ececef";
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i += 1) {
        const value = max - ((max - min) / 4) * i;
        const py = y(value);
        ctx.beginPath();
        ctx.moveTo(pad.left, py);
        ctx.lineTo(width - pad.right, py);
        ctx.stroke();
        ctx.fillText(Math.round(value).toLocaleString("ko-KR"), pad.left - 10, py + 4);
      }

      const drawBand = (upper: number[], lower: number[], opacity: number) => {
        ctx.beginPath();
        upper.forEach((value, index) => {
          const px = xForecast(index);
          const py = y(value);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        for (let index = lower.length - 1; index >= 0; index -= 1) {
          ctx.lineTo(xForecast(index), y(lower[index]));
        }
        ctx.closePath();
        ctx.fillStyle = scenario.tone === "up" ? `rgba(239,68,68,${opacity})` : `rgba(37,99,235,${opacity})`;
        ctx.fill();
      };

      drawBand(outerUpper, outerLower, 0.08);
      drawBand(innerUpper, innerLower, 0.12);

      const candleWidth = Math.max(3, Math.min(6, (splitX - pad.left) / actualPath.length * 0.58));
      actualPath.slice(1).forEach((value, index) => {
        const previous = actualPath[index];
        const px = xActual(index + 1);
        const high = Math.max(previous, value) + 5 + ((index * 7) % 8);
        const low = Math.min(previous, value) - 5 - ((index * 5) % 7);
        const color = value >= previous ? "#ef4444" : "#2563eb";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, y(high));
        ctx.lineTo(px, y(low));
        ctx.stroke();
        const bodyTop = Math.min(y(previous), y(value));
        const bodyHeight = Math.max(2, Math.abs(y(previous) - y(value)));
        ctx.fillStyle = color;
        ctx.fillRect(px - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      });

      const currentY = y(actualPath[actualPath.length - 1]);
      ctx.strokeStyle = "#a1a1aa";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, currentY);
      ctx.lineTo(rightX, currentY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      scenario.path.forEach((value, index) => {
        const px = xForecast(index);
        const py = y(value);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = scenario.tone === "up" ? "#ef4444" : "#2563eb";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = "#18181b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(splitX, pad.top);
      ctx.lineTo(splitX, height - pad.bottom);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.fillStyle = "#71717a";
      ["09:00", "10:30", "12:00", "13:30", "15:00"].forEach((label, index, labels) => {
        ctx.fillText(label, pad.left + (index / (labels.length - 1)) * (splitX - pad.left - 12), height - 12);
      });
      ctx.fillStyle = "#fff";
      ctx.fillRect(splitX - 20, height - 29, 40, 24);
      ctx.fillStyle = "#18181b";
      ctx.fillRect(splitX - 20, height - 29, 40, 24);
      ctx.fillStyle = "#fff";
      ctx.font = '700 10px "Pretendard Variable", sans-serif';
      ctx.fillText("현재", splitX, height - 13);
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.fillStyle = "#a1a1aa";
      ["+7일", "+14일", "+21일", scenario.duration + " 후"].forEach((label, index, labels) => {
        ctx.fillText(label, splitX + ((index + 1) / labels.length) * (rightX - splitX), height - 12);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scenario]);

  return <canvas ref={canvasRef} className="forecast-canvas" aria-label={`${scenario.title} 조건부 KOSPI 예상 경로`} />;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>("market");
  const [selectedScenario, setSelectedScenario] = useState(scenarios[0]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(["환율 상승"]);
  const [period, setPeriod] = useState("30일");

  const activateTab = (tab: MainTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleSeed = (seed: string) => {
    setSelectedSeeds((current) =>
      current.includes(seed) ? current.filter((item) => item !== seed) : [...current, seed],
    );
  };

  const runCustomScenario = () => {
    setSelectedScenario({
      ...scenarios[0],
      id: "custom",
      title: selectedSeeds.join(" · ") || "사용자 지정 시나리오",
      duration: period,
      tags: selectedSeeds.slice(0, 2),
      forecast: "조건부 경로 계산",
    });
    setBuilderOpen(false);
  };

  return (
    <div className="finverse-app">
      <header className="mobile-header">
        <button className="sidebar-brand" onClick={() => activateTab("market")} aria-label="FINVERSE 시장 인사이트 홈">
          <span className="brand-mark">F</span><span>FINVERSE</span>
        </button>
      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="FINVERSE 탐색">
          <button className="sidebar-brand" onClick={() => activateTab("market")} aria-label="FINVERSE 시장 인사이트 홈">
            <span className="brand-mark">F</span><span>FINVERSE</span>
          </button>
          <div className="sidebar-label"><BrainCircuit size={19} /><div><span>AI DECISION LAB</span><strong>금융 판단 실험실</strong></div></div>
          <nav className="side-tabs">
            <button className={activeTab === "market" ? "active" : ""} onClick={() => activateTab("market")}><BarChart3 size={18} />시장 인사이트</button>
            <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}><UserRound size={18} />마이 금융 트윈</button>
          </nav>
          <button className="sidebar-help" type="button"><CircleHelp size={20} /><span>도움말</span><ChevronRight size={17} /></button>
        </aside>

        <main className="main-content">
          {activeTab === "market" ? (
            <div className="market-page">
              <header className="page-heading">
                <div><span>MARKET INSIGHT</span><h1>오늘의 시장을 이해하고, 다음 움직임을 미리 살펴보세요.</h1></div>
                <div className="market-stamp"><CalendarDays size={15} />2026.07.27 KRX 장마감 · 7월 28일 기준</div>
              </header>

              <section className="market-dashboard">
                <section className="panel connection-panel">
                  <div className="panel-title"><h2>시장 연결</h2></div>
                  <div className="connection-list">
                    {marketConnections.map((item) => (
                      <article key={item.name}>
                        <div className="connection-main">
                          <span className={`entity-symbol ${item.tone}`}>{item.symbol}</span>
                          <div><strong>{item.name}</strong><small>{item.code}</small></div>
                          <div className={item.tone}><strong>{item.value}</strong><small>{item.change}</small></div>
                        </div>
                        <div className="connection-contribution">
                          <span>KOSPI 기여도</span>
                          <strong className={item.contribution.startsWith("+") ? "up" : "down"}>{item.contribution}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                  <p className="data-note">* 가격은 2026.07.27 KRX 장마감 기준입니다.</p>
                </section>

                <section className="panel chart-panel">
                  <div className="kospi-head">
                    <div>
                      <span>KOSPI LIVE</span>
                      <h2>6,755.75 <strong>+0.97%</strong></h2>
                      <div className="today-change">▲ 65.13 <span>(오늘)</span></div>
                    </div>
                    <div><span>선택 시나리오</span><strong>{selectedScenario.title}</strong></div>
                  </div>
                  <div className="chart-legend"><span><i className="actual" />KOSPI</span><span><i className="forecast" />예상({selectedScenario.duration})</span><span><i className="range" />신뢰구간(70%)</span></div>
                  <ForecastChart scenario={selectedScenario} />
                  <div className="ai-summary"><Sparkles size={17} /><div><strong>AI 요약</strong><p>{selectedScenario.summary}</p></div></div>
                </section>

                <aside className="panel event-panel">
                  <div className="panel-title"><div><span>가상 시뮬레이션</span><h2>발생 가능 이벤트</h2></div><span className="scenario-period">{selectedScenario.duration}</span></div>
                  <div className="event-timeline">
                    {selectedScenario.events.map((event) => (
                      <article key={event.title}>
                        <div className="event-week">{event.week}</div>
                        <div className="event-dot" />
                        <div className="event-copy">
                          <span>{event.category}</span>
                          <h3>{event.title}</h3>
                          <p>{event.body}</p>
                          <div className="event-impact">
                            <span>예상 영향</span>
                            <strong className={event.impact.startsWith("+") ? "up" : "down"}>{event.impact}</strong>
                          </div>
                          <button type="button" aria-label={`${event.title} 시나리오에 포함됨`}>
                            <span>시나리오에 포함됨</span>
                            <Bookmark size={14} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </aside>
              </section>

              <section className="scenario-section">
                <div className="scenario-heading"><div><span>SCENARIO LIBRARY</span><h2>시나리오별 KOSPI 경로를 비교하세요</h2><p>준비된 시장 환경을 선택하면 발생 가능 이벤트와 조건부 예상 경로가 열립니다.</p></div><span><CircleDollarSign size={15} />가상 시뮬레이션</span></div>
                <div className="scenario-grid">
                  {scenarios.map((scenario) => (
                    <button key={scenario.id} className={`scenario-card ${selectedScenario.id === scenario.id ? "active" : ""}`} onClick={() => setSelectedScenario(scenario)}>
                      <div className="scenario-card-main">
                        <span className={`scenario-icon ${scenario.tone}`}>
                          {scenario.id === "fx" ? <CircleDollarSign size={22} /> : scenario.id === "chip" ? <BrainCircuit size={22} /> : <UserRound size={22} />}
                        </span>
                        <div>
                          <h3>{scenario.title}</h3>
                          <div className="scenario-tags"><span>{scenario.duration}</span>{scenario.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                        </div>
                      </div>
                      <small>조건부 예상</small>
                      <strong className={scenario.tone}>{scenario.forecast}</strong>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                  <button className="custom-scenario-card" onClick={() => setBuilderOpen(true)}>
                    <Plus size={24} /><div><strong>내 시나리오 예측하기</strong><p>원하는 시장 조건과 기간을 직접 선택하세요.</p></div><ArrowRight size={18} />
                  </button>
                </div>
              </section>
            </div>
          ) : <section className="twin-blank" aria-label="마이 금융 트윈 작업 영역" />}
        </main>
      </div>

      <nav className="mobile-tabs" aria-label="모바일 주요 메뉴">
        <button className={activeTab === "market" ? "active" : ""} onClick={() => activateTab("market")}><BarChart3 size={18} /><span>시장 인사이트</span></button>
        <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}><UserRound size={18} /><span>마이 금융 트윈</span></button>
      </nav>

      {builderOpen && (
        <div className="modal-backdrop" onMouseDown={() => setBuilderOpen(false)}>
          <section className="scenario-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>MY SCENARIO</span><h2 id="scenario-modal-title">어떤 시장 환경을 시험해볼까요?</h2><p>조건과 기간을 고르면 같은 화면에서 예상 경로를 비교합니다.</p></div><button onClick={() => setBuilderOpen(false)} aria-label="닫기"><X size={20} /></button></header>
            <div className="builder-group"><strong>환경 시드</strong><div>{["환율 상승", "금리 인하", "반도체 실적 개선", "외국인 순매도", "미국 기술주 조정"].map((seed) => <button key={seed} className={selectedSeeds.includes(seed) ? "active" : ""} onClick={() => toggleSeed(seed)}>{seed}</button>)}</div></div>
            <div className="builder-group"><strong>예측 기간</strong><div>{["7일", "30일", "3개월"].map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
            <button className="run-custom-button" onClick={runCustomScenario}>이 조건으로 예측하기 <ArrowRight size={17} /></button>
          </section>
        </div>
      )}
    </div>
  );
}
