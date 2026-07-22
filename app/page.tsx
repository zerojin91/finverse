"use client";

import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  Gauge,
  Landmark,
  LineChart,
  LockKeyhole,
  Newspaper,
  Pencil,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type MainTab = "insight" | "twin";
type SearchMode = "market" | "stock";
type EntityId = "kospi" | "kosdaq" | "samsung" | "skhynix";

const entities: Record<
  EntityId,
  {
    mode: SearchMode;
    name: string;
    code: string;
    value: number;
    valueLabel: string;
    delta: string;
    summary: string;
    regime: string;
    confidence: number;
    range: string;
  }
> = {
  kospi: {
    mode: "market",
    name: "KOSPI",
    code: "국내 대표지수",
    value: 3248.6,
    valueLabel: "3,248.60",
    delta: "+1.84%",
    summary: "반도체가 상승을 이끌고 있지만, 지수 내부의 쏠림과 환율 부담이 함께 커지는 변곡 구간입니다.",
    regime: "상승 · 변동성 확대",
    confidence: 78,
    range: "3,120 – 3,390",
  },
  kosdaq: {
    mode: "market",
    name: "KOSDAQ",
    code: "국내 성장주 지수",
    value: 842.31,
    valueLabel: "842.31",
    delta: "+0.62%",
    summary: "바이오와 2차전지의 반등이 나타났지만 거래대금 회복이 약해 방향성보다 종목별 차별화가 큰 구간입니다.",
    regime: "중립 · 종목 장세",
    confidence: 71,
    range: "795 – 878",
  },
  samsung: {
    mode: "stock",
    name: "삼성전자",
    code: "005930 · KOSPI",
    value: 92400,
    valueLabel: "92,400원",
    delta: "+2.21%",
    summary: "HBM 공급 확대 기대가 주가를 지지하지만, 실적 발표 전 기대 수준이 빠르게 높아진 상태입니다.",
    regime: "상승 · 실적 확인 대기",
    confidence: 74,
    range: "88,000 – 99,000원",
  },
  skhynix: {
    mode: "stock",
    name: "SK하이닉스",
    code: "000660 · KOSPI",
    value: 341500,
    valueLabel: "341,500원",
    delta: "+3.08%",
    summary: "AI 메모리 수요가 강한 추세를 만들었지만 높은 밸류에이션과 외국인 수급 변화에 민감한 구간입니다.",
    regime: "강세 · 과열 주의",
    confidence: 72,
    range: "318,000 – 371,000원",
  },
};

const predictionDrivers = [
  { rank: "01", label: "반도체 실적 기대", detail: "HBM 수요와 가이던스 상향", contribution: "+1.8%p", width: "82%", tone: "positive" },
  { rank: "02", label: "외국인 순매수", detail: "대형주 중심 수급 유입", contribution: "+0.9%p", width: "58%", tone: "positive" },
  { rank: "03", label: "원·달러 환율", detail: "1,380원대 재진입 부담", contribution: "-0.7%p", width: "43%", tone: "negative" },
];

const driverNews = [
  [
    { source: "산업", time: "34분 전", title: "HBM 수요 전망 상향, 반도체 실적 눈높이도 상승" },
    { source: "시장", time: "2시간 전", title: "반도체 대형주가 KOSPI 상승분의 절반 이상 기여" },
  ],
  [
    { source: "수급", time: "1시간 전", title: "외국인 반도체 순매수 지속, 대형주 중심 자금 유입" },
    { source: "증권", time: "4시간 전", title: "기관 매도에도 외국인 매수세가 지수 하단을 지지" },
  ],
  [
    { source: "환율", time: "48분 전", title: "원·달러 1,380원대 재진입, 외국인 수급에 부담" },
    { source: "글로벌", time: "3시간 전", title: "미 국채금리 반등과 달러 강세가 성장주 변동성 확대" },
  ],
];

const kospiCandleData = [
  { date: "03.06", open: 3042.0, high: 3068.4, low: 2998.1, close: 3028.5, volume: 318200000 },
  { date: "03.13", open: 3026.8, high: 3081.2, low: 3010.4, close: 3062.3, volume: 302450000 },
  { date: "03.20", open: 3060.5, high: 3114.8, low: 3048.9, close: 3098.6, volume: 329810000 },
  { date: "03.27", open: 3097.4, high: 3141.7, low: 3080.2, close: 3128.4, volume: 341600000 },
  { date: "04.03", open: 3126.9, high: 3179.3, low: 3102.6, close: 3164.2, volume: 356740000 },
  { date: "04.10", open: 3162.8, high: 3206.5, low: 3140.3, close: 3192.7, volume: 369200000 },
  { date: "04.17", open: 3190.5, high: 3244.9, low: 3171.4, close: 3228.1, volume: 382440000 },
  { date: "04.24", open: 3226.3, high: 3278.6, low: 3207.8, close: 3261.5, volume: 396530000 },
  { date: "05.01", open: 3258.4, high: 3318.2, low: 3239.7, close: 3306.8, volume: 418920000 },
  { date: "05.08", open: 3308.1, high: 3340.6, low: 3272.8, close: 3289.4, volume: 401120000 },
  { date: "05.15", open: 3287.5, high: 3365.9, low: 3270.1, close: 3341.7, volume: 436750000 },
  { date: "05.22", open: 3344.2, high: 3389.4, low: 3318.6, close: 3368.5, volume: 448620000 },
  { date: "05.29", open: 3370.1, high: 3402.8, low: 3332.4, close: 3346.3, volume: 429780000 },
  { date: "06.05", open: 3344.8, high: 3381.6, low: 3305.7, close: 3322.1, volume: 407330000 },
  { date: "06.12", open: 3320.6, high: 3356.4, low: 3289.8, close: 3302.5, volume: 389410000 },
  { date: "06.19", open: 3300.3, high: 3337.2, low: 3268.9, close: 3281.4, volume: 374220000 },
  { date: "06.26", open: 3278.5, high: 3322.8, low: 3251.6, close: 3298.7, volume: 392170000 },
  { date: "07.03", open: 3296.1, high: 3317.5, low: 3240.2, close: 3264.3, volume: 405860000 },
  { date: "07.07", open: 3262.4, high: 3290.7, low: 3211.5, close: 3228.8, volume: 417250000 },
  { date: "07.10", open: 3225.7, high: 3256.9, low: 3180.4, close: 3190.0, volume: 431940000 },
  { date: "07.17", open: 3195.4, high: 3266.8, low: 3178.2, close: 3248.6, volume: 424280000 },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>("insight");
  const [searchMode, setSearchMode] = useState<SearchMode>("market");
  const [selectedEntity, setSelectedEntity] = useState<EntityId>("kospi");
  const [activeDriver, setActiveDriver] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [appliedToTwin, setAppliedToTwin] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [rateChange, setRateChange] = useState(0);
  const [fxLevel, setFxLevel] = useState(1380);
  const [earningsExpectation, setEarningsExpectation] = useState(8);
  const [foreignFlow, setForeignFlow] = useState(0.8);
  const [shockLevel, setShockLevel] = useState(3);
  const [semiconductorRatio, setSemiconductorRatio] = useState(42);
  const [goal, setGoal] = useState("전세자금");
  const [goalMonths, setGoalMonths] = useState(36);
  const [riskStyle, setRiskStyle] = useState("균형형");

  const current = entities[selectedEntity];
  const availableEntities = (Object.keys(entities) as EntityId[]).filter(
    (id) => entities[id].mode === searchMode,
  );

  const simulation = useMemo(() => {
    const marketMove =
      earningsExpectation * 0.075 +
      foreignFlow * 0.82 -
      rateChange * 0.011 -
      Math.max(0, fxLevel - 1380) * 0.012 -
      (shockLevel - 3) * 0.62;
    const center = current.value * (1 + marketMove / 100);
    const band = 2.1 + shockLevel * 0.72;
    const confidence = Math.max(54, Math.min(86, current.confidence - (shockLevel - 3) * 4));

    return {
      move: Math.round(marketMove * 10) / 10,
      confidence,
      optimistic: center * (1 + band / 100),
      base: center,
      risk: center * (1 - (band + 1.3) / 100),
    };
  }, [current, earningsExpectation, foreignFlow, fxLevel, rateChange, shockLevel]);

  const currentDeltaTone = current.delta.trim().startsWith("-") ? "down" : "up";
  const simulationTone = simulation.move > 0 ? "up" : simulation.move < 0 ? "down" : "flat";

  const chartModel = useMemo(() => {
    const scale = current.value / 3248.6;
    const candles = kospiCandleData.map((candle) => ({
      ...candle,
      open: candle.open * scale,
      high: candle.high * scale,
      low: candle.low * scale,
      close: candle.close * scale,
    }));
    const latest = candles[candles.length - 1];
    const rawMin = Math.min(...candles.map((candle) => candle.low), simulation.risk);
    const rawMax = Math.max(...candles.map((candle) => candle.high), simulation.optimistic);
    const padding = (rawMax - rawMin) * 0.09;
    const step = current.mode === "stock" ? 1000 : 10;
    const min = Math.floor((rawMin - padding) / step) * step;
    const max = Math.ceil((rawMax + padding) / step) * step;
    const range = Math.max(1, max - min);
    const y = (value: number) => ((max - value) / range) * 100;
    const ticks = Array.from({ length: 5 }, (_, index) => max - (range / 4) * index);

    return { candles, latest, min, max, ticks, y };
  }, [current.mode, current.value, simulation.optimistic, simulation.risk]);

  const goalStability = Math.max(
    32,
    Math.min(92, Math.round(88 - semiconductorRatio * 0.48 - shockLevel * 3 + goalMonths * 0.18)),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activateTab = (tab: MainTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const changeSearchMode = (mode: SearchMode) => {
    setSearchMode(mode);
    setSelectedEntity(mode === "market" ? "kospi" : "samsung");
    setQuery("");
    setHasRun(false);
  };

  const chooseEntity = (id: EntityId) => {
    setSelectedEntity(id);
    setQuery(entities[id].name);
    setHasRun(false);
  };

  const submitSearch = () => {
    const normalized = query.trim().toLowerCase();
    const found = availableEntities.find((id) =>
      `${entities[id].name} ${entities[id].code}`.toLowerCase().includes(normalized),
    );
    if (found) chooseEntity(found);
  };

  const runSimulation = () => {
    setHasRun(true);
    window.setTimeout(
      () => document.getElementById("simulation-result")?.scrollIntoView({ behavior: "smooth", block: "center" }),
      80,
    );
  };

  const applyToTwin = () => {
    setAppliedToTwin(true);
    activateTab("twin");
  };

  const openSimulator = () => {
    setSimulatorOpen(true);
    window.setTimeout(
      () => document.getElementById("market-simulator")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  };

  const formatValue = (value: number) => {
    const rounded = current.mode === "stock" ? Math.round(value / 100) * 100 : Math.round(value * 100) / 100;
    return `${rounded.toLocaleString("ko-KR")}${current.mode === "stock" ? "원" : ""}`;
  };

  const formatChartValue = (value: number) => current.mode === "stock"
    ? `${Math.round(value / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatVolume = (volume: number) => `${Math.floor(volume / 100000000)}억 ${Math.round((volume % 100000000) / 10000).toLocaleString("ko-KR")}만`;

  const predictionRange = `${formatValue(simulation.risk)} – ${formatValue(simulation.optimistic)}`;

  return (
    <div className="finverse-app">
      <header className="topbar">
        <button className="brand" onClick={() => activateTab("insight")} aria-label="FINVERSE 시장 인사이트 홈">
          <span className="brand-mark">F</span>
          <span>FINVERSE</span>
        </button>

        <nav className="top-tabs" aria-label="주요 메뉴">
          <button className={activeTab === "insight" ? "active" : ""} onClick={() => activateTab("insight")}>
            시장 인사이트
          </button>
          <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}>
            마이 금융 트윈
          </button>
        </nav>

        <button className="profile-button" onClick={() => setProfileOpen(true)}>
          <UserRound size={17} aria-hidden="true" />
          <span>내 금융 상태</span>
        </button>
      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="FINVERSE 탐색">
          <div className="sidebar-label">
            <BrainCircuit size={19} aria-hidden="true" />
            <div><span>AI DECISION LAB</span><strong>금융 판단 실험실</strong></div>
          </div>
          <nav className="side-tabs">
            <button className={activeTab === "insight" ? "active" : ""} onClick={() => activateTab("insight")}>
              <LineChart size={18} aria-hidden="true" />
              시장 인사이트
            </button>
            <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}>
              <UserRound size={18} aria-hidden="true" />
              마이 금융 트윈
            </button>
          </nav>
          <div className="sidebar-note">
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <strong>교육용 가상 데이터</strong>
              <p>조건과 불확실성을 비교하는 판단 훈련이며 투자 권유가 아닙니다.</p>
            </div>
          </div>
        </aside>

        <main className="main-content">
          {activeTab === "insight" ? (
            <div className="view-shell insight-view">
              <section className="market-hero" aria-labelledby="market-hero-title">
                <div className="market-hero-copy">
                  <span>MARKET DECISION LAB</span>
                  <h1 id="market-hero-title">AI 반도체 랠리 이후,<br />지금 어떤 판단을 하시겠어요?</h1>
                  <p>시장의 정답을 맞히는 대신 내 목표에 남을 영향을 먼저 비교합니다.</p>
                </div>
                <div className="hero-orbit" aria-hidden="true">
                  <i className="orbit orbit-outer" />
                  <i className="orbit orbit-inner" />
                  <i className="orbit-node node-a" />
                  <i className="orbit-node node-b" />
                  <span><BrainCircuit size={34} /></span>
                </div>
              </section>

              <section className="search-card" aria-label="시장 및 종목 검색">
                <div className="search-modes" role="tablist" aria-label="검색 범위">
                  <button className={searchMode === "market" ? "active" : ""} onClick={() => changeSearchMode("market")}>
                    시장
                  </button>
                  <button className={searchMode === "stock" ? "active" : ""} onClick={() => changeSearchMode("stock")}>
                    개별 종목
                  </button>
                </div>
                <div className="search-input-wrap">
                  <Search size={20} aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && submitSearch()}
                    placeholder={searchMode === "market" ? "KOSPI, KOSDAQ을 검색하세요" : "삼성전자, SK하이닉스를 검색하세요"}
                    aria-label={searchMode === "market" ? "시장 검색" : "개별 종목 검색"}
                  />
                  <button onClick={submitSearch}>조회</button>
                </div>
                <div className="quick-searches" aria-label="빠른 검색">
                  <span>빠른 검색</span>
                  {availableEntities.map((id) => (
                    <button key={id} className={selectedEntity === id ? "active" : ""} onClick={() => chooseEntity(id)}>
                      {entities[id].name}
                    </button>
                  ))}
                </div>
              </section>

              <section className="terminal-workspace" aria-label={`${current.name} 시장 차트와 AI 분석`}>
                <section className="market-chart-panel" aria-labelledby="terminal-chart-title">
                  <div className="chart-market-header">
                    <div>
                      <div className="chart-title-line">
                        <h2 id="terminal-chart-title">{current.name} <strong>{current.valueLabel}</strong></h2>
                        <span className={`chart-delta ${currentDeltaTone}`}>{current.delta}</span>
                      </div>
                      <p>전일대비 <strong className={currentDeltaTone}>{current.delta}</strong> · 🇰🇷 한국 <CircleAlert size={12} /></p>
                    </div>
                    <div className="chart-market-stats">
                      <div><span>거래량</span><strong>{formatVolume(chartModel.latest.volume)}</strong></div>
                      <div><span>시가</span><strong>{formatChartValue(chartModel.latest.open)}</strong></div>
                      <div><span>1일 최저</span><strong>{formatChartValue(chartModel.latest.low)}</strong></div>
                      <div><span>1일 최고</span><strong>{formatChartValue(chartModel.latest.high)}</strong></div>
                    </div>
                  </div>

                  <div className="chart-toolbar">
                    <div className="timeframes"><button>1분</button><button className="active">일</button><button>주</button><button>월</button><button>년</button></div>
                    <div className="chart-tools"><i className="candle-tool" /><span>▦</span><span>⚙</span></div>
                  </div>

                  <div className="market-data-chart" role="img" aria-label={`${current.name} 실제 OHLC 데이터와 AI 30일 예측구간`}>
                    <div className="data-chart-legend">
                      <div><span className="actual-key" />시장 고가 저가 종가</div>
                      <div><span className="forecast-key" />AI 30일 예측구간</div>
                    </div>
                    <div className="data-chart-plot">
                      <div className="forecast-surface" />
                      {chartModel.ticks.map((tick) => (
                        <div className="data-grid-line" style={{ top: `${chartModel.y(tick)}%` }} key={tick}>
                          <span>{formatChartValue(tick)}</span>
                        </div>
                      ))}
                      {chartModel.candles.map((candle, index) => {
                        const x = 3 + (index / (chartModel.candles.length - 1)) * 62;
                        const openY = chartModel.y(candle.open);
                        const closeY = chartModel.y(candle.close);
                        const highY = chartModel.y(candle.high);
                        const lowY = chartModel.y(candle.low);
                        const rising = candle.close >= candle.open;
                        return (
                          <span className={`data-candle ${rising ? "rising" : "falling"}`} style={{ left: `${x}%` }} key={candle.date} title={`${candle.date} 시가 ${formatChartValue(candle.open)} 고가 ${formatChartValue(candle.high)} 저가 ${formatChartValue(candle.low)} 종가 ${formatChartValue(candle.close)}`}>
                            <i className="data-wick" style={{ top: `${highY}%`, height: `${Math.max(1, lowY - highY)}%` }} />
                            <i className="data-body" style={{ top: `${Math.min(openY, closeY)}%`, height: `${Math.max(1.4, Math.abs(openY - closeY))}%` }} />
                          </span>
                        );
                      })}
                      <div className="data-today-line" style={{ left: "68%" }}><span>오늘</span></div>
                      <div className="data-current-point" style={{ left: "68%", top: `${chartModel.y(chartModel.latest.close)}%` }}><i /><strong>{formatChartValue(chartModel.latest.close)}</strong></div>
                      <div className="data-forecast-band" style={{ clipPath: `polygon(68% ${chartModel.y(chartModel.latest.close)}%, 92% ${chartModel.y(simulation.optimistic)}%, 92% ${chartModel.y(simulation.risk)}%)` }} />
                      <div className="data-forecast-stroke upper" style={{ clipPath: `polygon(68% ${chartModel.y(chartModel.latest.close)}%, 92% ${chartModel.y(simulation.optimistic)}%, 92% ${chartModel.y(simulation.optimistic) + 0.25}%, 68% ${chartModel.y(chartModel.latest.close) + 0.25}%)` }} />
                      <div className="data-forecast-stroke center" style={{ clipPath: `polygon(68% ${chartModel.y(chartModel.latest.close)}%, 92% ${chartModel.y(simulation.base)}%, 92% ${chartModel.y(simulation.base) + 0.35}%, 68% ${chartModel.y(chartModel.latest.close) + 0.35}%)` }} />
                      <div className="data-forecast-stroke lower" style={{ clipPath: `polygon(68% ${chartModel.y(chartModel.latest.close)}%, 92% ${chartModel.y(simulation.risk)}%, 92% ${chartModel.y(simulation.risk) + 0.25}%, 68% ${chartModel.y(chartModel.latest.close) + 0.25}%)` }} />
                      <div className="data-prediction-interval" style={{ left: "92%", top: `${chartModel.y(simulation.optimistic)}%`, height: `${chartModel.y(simulation.risk) - chartModel.y(simulation.optimistic)}%` }}><span className="upper-value">{formatChartValue(simulation.optimistic)}</span><span className="lower-value">{formatChartValue(simulation.risk)}</span></div>
                      <div className="data-prediction-point" style={{ left: "92%", top: `${chartModel.y(simulation.base)}%` }}><i /><strong>{formatValue(simulation.base)}</strong><small className={simulationTone}>{simulation.move > 0 ? "+" : ""}{simulation.move}%</small></div>
                      <div className="data-forecast-caption"><span>AI 30일 전망</span><strong>신뢰도 {simulation.confidence}%</strong></div>
                      <div className="data-chart-months"><span>3월</span><span>4월</span><span>5월</span><span>6월</span><span>오늘</span><span>30일 후</span></div>
                    </div>
                  </div>
                </section>

                <aside className="ai-terminal-panel prediction-panel" aria-label="AI 예측 근거와 멀티 에이전트 시뮬레이션">
                  <section className="prediction-overview">
                    <div className="panel-section-heading">
                      <div><span>01 · AI FORECAST</span><h3>예측 포인트와 구간</h3></div>
                      <span className="prediction-confidence">신뢰도 {current.confidence}%</span>
                    </div>
                    <div className="prediction-numbers">
                      <div><span>30일 예측값</span><strong>{formatValue(simulation.base)}</strong><small className={simulationTone}>{simulation.move > 0 ? "+" : ""}{simulation.move}%</small></div>
                      <div><span>예측구간</span><strong>{predictionRange}</strong><small>{current.regime}</small></div>
                    </div>
                  </section>

                  <section className="prediction-drivers">
                    <div className="panel-section-heading"><div><span>02 · TOP 3 DRIVERS</span><h3>예측값을 만든 이유 TOP 3</h3></div><BrainCircuit size={17} /></div>
                    <p>어제 예측값과 비교해 각 요인이 변화에 기여한 비중입니다.</p>
                    <div className="driver-list" aria-label="예측 근거별 관련 뉴스">
                      {predictionDrivers.map((driver, index) => (
                        <div className={`driver-entry ${activeDriver === index ? "active" : ""}`} key={driver.rank}>
                          <button
                            type="button"
                            className={activeDriver === index ? "active" : ""}
                            onClick={() => setActiveDriver((currentDriver) => currentDriver === index ? null : index)}
                            aria-expanded={activeDriver === index}
                            aria-controls={`driver-news-${index}`}
                          >
                            <span className="driver-rank">{driver.rank}</span>
                            <div className="driver-copy"><strong>{driver.label}</strong><small>{driver.detail}</small><div><i className={driver.tone} style={{ width: driver.width }} /></div></div>
                            <strong className={`driver-contribution ${driver.tone}`}>{driver.contribution}</strong>
                            <ChevronRight className="driver-chevron" size={15} />
                          </button>
                          {activeDriver === index && (
                            <div className="driver-news-drawer" id={`driver-news-${index}`} aria-live="polite">
                              <div className="driver-news-title"><div><Newspaper size={15} /><strong>관련 뉴스 2건</strong></div><span>{driver.label} 근거</span></div>
                              <div className="driver-news-list">
                                {driverNews[index].map((news) => (
                                  <article key={news.title}>
                                    <span>{news.source}</span>
                                    <div><strong>{news.title}</strong><small>{news.time}</small></div>
                                    <ChevronRight size={14} aria-hidden="true" />
                                  </article>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="agent-preview-panel">
                    <div className="panel-section-heading"><div><span>03 · MULTI-AGENT READY</span><h3>시나리오에 참여할 에이전트</h3></div><Sparkles size={17} /></div>
                    <p className="agent-intro">선택한 근거와 뉴스를 서로 다른 관점으로 검증합니다.</p>
                    <div className="agent-list">
                      <article><i><Newspaper size={16} /></i><div><strong>시장 해석 에이전트</strong><small>실적·뉴스 신호 분석</small></div><span>준비</span></article>
                      <article><i><Landmark size={16} /></i><div><strong>수급·거시 에이전트</strong><small>외국인·환율 압력 분석</small></div><span>준비</span></article>
                      <article><i><UserRound size={16} /></i><div><strong>금융 트윈 에이전트</strong><small>내 목표와 자산 영향 분석</small></div><span>연결</span></article>
                    </div>
                    <div className="agent-context"><BrainCircuit size={15} /><p>{current.summary}</p></div>
                  </section>

                  <button className="terminal-cta agent-simulation-cta" onClick={openSimulator}><span><small>MULTI-AGENT SIMULATOR</small><strong>3개 에이전트로 {current.name} 시나리오 검증</strong></span><i><Play size={14} fill="currentColor" /> 시뮬레이션 시작 <ArrowRight size={14} /></i></button>
                </aside>
              </section>

              {simulatorOpen && (
                <section className="simulator" id="market-simulator" aria-labelledby="simulator-title">
                  <div className="simulator-heading">
                    <div><span>MULTI-AGENT SIMULATOR</span><h2 id="simulator-title">에이전트의 가정과 조건을 직접 조정하세요</h2><p>시장·수급·금융 트윈 에이전트가 변경된 조건으로 경로를 다시 계산합니다.</p></div>
                    <SlidersHorizontal size={24} aria-hidden="true" />
                  </div>
                  <div className="simulator-grid">
                    <div className="control-panel">
                      <label><span>기준금리 변화 <strong>{rateChange > 0 ? "+" : ""}{rateChange}bp</strong></span><input type="range" min="-50" max="50" step="10" value={rateChange} onChange={(event) => { setRateChange(Number(event.target.value)); setHasRun(false); }} /><small><span>-50bp</span><span>+50bp</span></small></label>
                      <label><span>원·달러 환율 <strong>{fxLevel.toLocaleString()}원</strong></span><input type="range" min="1320" max="1450" step="5" value={fxLevel} onChange={(event) => { setFxLevel(Number(event.target.value)); setHasRun(false); }} /><small><span>1,320원</span><span>1,450원</span></small></label>
                      <label><span>반도체 실적 기대 <strong>{earningsExpectation > 0 ? "+" : ""}{earningsExpectation}%</strong></span><input type="range" min="-20" max="20" step="2" value={earningsExpectation} onChange={(event) => { setEarningsExpectation(Number(event.target.value)); setHasRun(false); }} /><small><span>-20%</span><span>+20%</span></small></label>
                      <label><span>외국인 순매수 <strong>{foreignFlow > 0 ? "+" : ""}{foreignFlow.toFixed(1)}조</strong></span><input type="range" min="-3" max="3" step="0.2" value={foreignFlow} onChange={(event) => { setForeignFlow(Number(event.target.value)); setHasRun(false); }} /><small><span>-3조</span><span>+3조</span></small></label>
                      <label><span>시장 충격 강도 <strong>{shockLevel}/5</strong></span><input type="range" min="1" max="5" step="1" value={shockLevel} onChange={(event) => { setShockLevel(Number(event.target.value)); setHasRun(false); }} /><small><span>낮음</span><span>높음</span></small></label>
                      <button className="run-button" onClick={runSimulation}><RefreshCw size={17} /> 에이전트 시뮬레이션 실행</button>
                    </div>

                    <div className={`simulation-result ${hasRun ? "ready" : ""}`} id="simulation-result" aria-live="polite">
                      {!hasRun ? (
                        <div className="result-placeholder">
                          <Gauge size={36} aria-hidden="true" />
                          <span>에이전트 준비 완료</span>
                          <h3>실행하면 세 가지 경로가 열립니다</h3>
                          <p>현재 입력값을 기준으로 상단·중심·하단 범위와 영향을 받는 섹터를 비교합니다.</p>
                        </div>
                      ) : (
                        <>
                          <div className="result-top"><div><span>30일 중심 경로</span><strong>{formatValue(simulation.base)}</strong><small className={simulationTone}>{simulation.move > 0 ? "+" : ""}{simulation.move}%</small></div><div className="result-confidence"><span>신뢰도</span><strong>{simulation.confidence}%</strong></div></div>
                          <div className="scenario-cards">
                            <div><span>상단 경로</span><strong>{formatValue(simulation.optimistic)}</strong><p>실적 기대 상회<br />외국인 수급 유지</p></div>
                            <div className="base"><span>중심 경로</span><strong>{formatValue(simulation.base)}</strong><p>현재 기대 유지<br />변동성 지속</p></div>
                            <div><span>하단 경로</span><strong>{formatValue(simulation.risk)}</strong><p>환율·금리 부담<br />기술주 조정</p></div>
                          </div>
                          <div className="result-reason"><BrainCircuit size={20} /><div><span>에이전트 합의</span><p>시장 해석과 수급 에이전트는 실적 기대가 환율 부담을 상쇄한다고 판단했습니다. 금융 트윈은 충격 강도가 커질수록 목표자금의 하단 위험이 빠르게 넓어지는 점을 경고합니다.</p></div></div>
                          <button className="apply-twin-button" onClick={applyToTwin}>이 결과를 내 금융 트윈에 적용하기 <ArrowRight size={18} /></button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="simulator-disclaimer"><LockKeyhole size={14} /> 모든 수치는 서비스 경험을 위한 교육용 조건부 범위이며 실제 시장 예측이나 투자 권유가 아닙니다.</p>
                </section>
              )}
            </div>
          ) : (
            <div className="view-shell twin-view">
              <div className="view-heading">
                <div><span className="eyebrow">MY FINANCIAL TWIN</span><h1>같은 시장도 나에게 미치는 영향은 다릅니다</h1><p>시장 시뮬레이션 위에 나의 자산, 목표와 행동 특성을 겹쳐 봅니다.</p></div>
                <button className="edit-profile" onClick={() => setProfileOpen(true)}><Pencil size={16} /> 금융 상태 수정</button>
              </div>

              {!appliedToTwin ? (
                <section className="twin-empty">
                  <div className="twin-empty-icon"><UserRound size={34} /></div>
                  <span>연결된 시장 시나리오가 없습니다</span>
                  <h2>시장 환경을 먼저 시뮬레이션해 주세요</h2>
                  <p>시장 인사이트에서 조건을 바꿔본 뒤 결과를 금융 트윈에 적용하면 개인 영향 분석이 시작됩니다.</p>
                  <button onClick={() => activateTab("insight")}>시장 인사이트로 이동 <ArrowRight size={17} /></button>
                </section>
              ) : (
                <>
                  <section className="twin-overview">
                    <div className="twin-overview-copy"><span>적용된 시장 환경</span><h2>{current.name} · 중심 경로 {simulation.move > 0 ? "+" : ""}{simulation.move}%</h2><p>실적 기대 {earningsExpectation > 0 ? "+" : ""}{earningsExpectation}%, 원·달러 {fxLevel.toLocaleString()}원, 시장 충격 {shockLevel}/5 조건을 적용했습니다.</p><div className="twin-route"><span>시장 이벤트</span><ChevronRight size={15} /><span>{current.name}</span><ChevronRight size={15} /><span>나의 자산</span><ChevronRight size={15} /><span className="active">{goal}</span></div></div>
                    <div className="stability-score"><span>목표 안정성</span><strong>{goalStability}</strong><small>/100</small><div><i style={{ width: `${goalStability}%` }} /></div><p>{goalStability >= 70 ? "현재 조건에서 목표 방어력이 비교적 안정적입니다." : "시장 충격이 목표자금에 전달될 가능성이 큽니다."}</p></div>
                  </section>

                  <div className="twin-grid">
                    <section className="card profile-card">
                      <div className="card-heading"><div><span>01 · MY PROFILE</span><h2>나의 가상 금융 상태</h2></div><WalletCards size={20} /></div>
                      <div className="profile-metrics"><div><span>투자 성향</span><strong>{riskStyle}</strong></div><div><span>반도체·성장주</span><strong>{semiconductorRatio}%</strong></div><div><span>생활 목표</span><strong>{goal}</strong></div><div><span>목표까지</span><strong>{goalMonths}개월</strong></div></div>
                      <div className="asset-bar" aria-label="가상 자산 구성"><i className="asset-risk" style={{ width: `${semiconductorRatio}%` }} /><i className="asset-safe" style={{ width: `${Math.max(18, 68 - semiconductorRatio)}%` }} /><i className="asset-cash" /></div>
                      <div className="asset-legend"><span><i className="risk" />성장자산</span><span><i className="safe" />안전자산</span><span><i className="cash" />현금성</span></div>
                    </section>

                    <section className="card impact-card">
                      <div className="card-heading"><div><span>02 · GOAL IMPACT</span><h2>내 목표에 전달되는 영향</h2></div><Target size={20} /></div>
                      <div className="impact-metrics"><div><span>기준 경로 자산 영향</span><strong>{(simulation.move * semiconductorRatio / 100).toFixed(1)}%</strong><small>시장 변화 × 위험자산 비중</small></div><div><span>하단 경로 최대 충격</span><strong>-{Math.max(4.8, shockLevel * semiconductorRatio * 0.045).toFixed(1)}%</strong><small>목표 시점 전 회복 기간 필요</small></div></div>
                      <div className="impact-message"><CircleAlert size={18} /><p>반도체 비중이 {semiconductorRatio}%인 현재 구성에서는 업종 조정이 {goal} 목표자금 변동으로 빠르게 전달됩니다.</p></div>
                    </section>

                    <section className="card bias-card">
                      <div className="card-heading"><div><span>03 · BEHAVIOR CHECK</span><h2>지금 작동하기 쉬운 판단 편향</h2></div><BrainCircuit size={20} /></div>
                      <div className="bias-primary"><span>주의 편향</span><strong>과신 · 최근성 편향</strong><p>최근 반도체 상승과 긍정적 뉴스가 앞으로도 그대로 이어질 가능성을 실제보다 크게 느낄 수 있습니다.</p></div>
                      <ul><li><Check size={15} /> 기대수익보다 감당 가능한 손실을 먼저 적기</li><li><Check size={15} /> 목표 시점과 무관한 단기 뉴스는 분리하기</li><li><Check size={15} /> 매수 전 하단 경로의 행동 기준 정하기</li></ul>
                    </section>

                    <section className="card next-action-card">
                      <div className="card-heading"><div><span>04 · NEXT QUESTION</span><h2>결정 전에 확인할 질문</h2></div><Landmark size={20} /></div>
                      <blockquote>“수익 기회를 놓칠까 두려운가요, 아니면 {goal}을 지키는 기준이 있나요?”</blockquote>
                      <div className="decision-checks"><div><span>목표 기준</span><strong>{goalMonths}개월 안에 쓸 자금은 변동성에서 분리했는가</strong></div><div><span>실행 기준</span><strong>하단 경로 도달 시 무엇을 할지 미리 정했는가</strong></div></div>
                      <button onClick={() => activateTab("insight")}>다른 시장 환경 시뮬레이션 <ArrowRight size={16} /></button>
                    </section>
                  </div>
                </>
              )}
            </div>
          )}

          <footer>
            <div><span className="brand-mark small">F</span><strong>FINVERSE</strong></div>
            <p>불확실성을 이해하고 더 나은 금융 판단을 연습하는 AI 시뮬레이션</p>
            <span>2026 금융 AI Challenge MVP</span>
          </footer>
        </main>
      </div>

      <nav className="mobile-tabs" aria-label="모바일 주요 메뉴">
        <button className={activeTab === "insight" ? "active" : ""} onClick={() => activateTab("insight")}><LineChart size={18} /><span>시장 인사이트</span></button>
        <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}><UserRound size={18} /><span>마이 금융 트윈</span></button>
      </nav>

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setProfileOpen(false)}>
          <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><span>MY FINANCIAL TWIN</span><h2 id="profile-modal-title">내 가상 금융 상태</h2><p>실제 계좌정보 없이 대략적인 상태만 입력합니다.</p></div><button onClick={() => setProfileOpen(false)} aria-label="닫기"><X size={19} /></button></div>
            <div className="profile-form">
              <label><span>투자 성향</span><select value={riskStyle} onChange={(event) => setRiskStyle(event.target.value)}><option>안정형</option><option>균형형</option><option>성장형</option></select></label>
              <label><span>가장 중요한 금융 목표</span><select value={goal} onChange={(event) => setGoal(event.target.value)}><option>비상금</option><option>전세자금</option><option>주택 마련</option><option>학자금 상환</option></select></label>
              <label className="range-label"><span>반도체·성장주 비중 <strong>{semiconductorRatio}%</strong></span><input type="range" min="0" max="80" step="2" value={semiconductorRatio} onChange={(event) => setSemiconductorRatio(Number(event.target.value))} /><small><span>0%</span><span>80%</span></small></label>
              <label className="range-label"><span>목표까지 남은 기간 <strong>{goalMonths}개월</strong></span><input type="range" min="6" max="84" step="6" value={goalMonths} onChange={(event) => setGoalMonths(Number(event.target.value))} /><small><span>6개월</span><span>84개월</span></small></label>
            </div>
            <div className="modal-notice"><LockKeyhole size={17} /><p>입력값은 이 MVP 화면에서만 사용되며 실제 금융계좌와 연결되지 않습니다.</p></div>
            <button className="modal-submit" onClick={() => setProfileOpen(false)}><Check size={17} /> 내 상태 적용하기</button>
          </section>
        </div>
      )}
    </div>
  );
}
