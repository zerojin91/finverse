"use client";

import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Landmark,
  LineChart,
  LockKeyhole,
  Pencil,
  Play,
  RefreshCw,
  ShieldCheck,
  Target,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type EventId = "rally" | "turning" | "earnings";
type ChoiceId = "increase" | "hold" | "rebalance" | "diversify" | "wait";

const marketMetrics = [
  { label: "KOSPI", value: "3,248.60", delta: "+1.84%", tone: "up" },
  { label: "KOSDAQ", value: "842.31", delta: "+0.62%", tone: "up" },
  { label: "반도체 지수", value: "1,486.20", delta: "-2.18%", tone: "down" },
  { label: "원·달러", value: "1,381.40", delta: "+6.20원", tone: "down" },
  { label: "미 10년물", value: "4.21%", delta: "+0.04%p", tone: "neutral" },
  { label: "시장 심리", value: "74", delta: "과열 주의", tone: "warning" },
];

const events: Record<
  EventId,
  {
    date: string;
    phase: string;
    title: string;
    summary: string;
    signal: string;
    exposure: string;
    goal: string;
  }
> = {
  rally: {
    date: "2026.03",
    phase: "상승 국면",
    title: "AI 반도체 기대가 KOSPI 상승을 견인",
    summary:
      "HBM 수요와 실적 기대가 빠르게 확산되며 반도체 대형주와 관련 ETF로 자금이 집중됐습니다.",
    signal: "거래대금·외국인 수급 동반 증가",
    exposure: "반도체·성장주 비중 42%",
    goal: "전세자금까지 36개월",
  },
  turning: {
    date: "2026.07.19",
    phase: "현재 변곡점",
    title: "좋은 실적과 높아진 기대가 충돌하는 구간",
    summary:
      "차익 실현, 글로벌 기술주 조정, 업황 정점 우려가 겹치며 하루 변동 폭이 커지고 있습니다.",
    signal: "상승 종목 감소·변동성 확대",
    exposure: "집중도 높음·환율 민감",
    goal: "단기 목표자금 보호 필요",
  },
  earnings: {
    date: "2026.08",
    phase: "예정 이벤트",
    title: "반도체 실적 발표 이후 시장 재평가",
    summary:
      "실적이 기대를 웃돌아도 이미 반영된 기대 수준에 따라 주가 반응은 달라질 수 있습니다.",
    signal: "실적·가이던스 3개 경로",
    exposure: "반도체 ETF 변동 가능",
    goal: "결정 전 손실 감내 범위 점검",
  },
};

const choices: Array<{
  id: ChoiceId;
  label: string;
  description: string;
  stability: number;
  drawdown: number;
  liquidity: string;
  bias: string;
  biasTone: "high" | "medium" | "low";
  feedback: string;
}> = [
  {
    id: "increase",
    label: "반도체 자산 비중을 더 늘린다",
    description: "상승 흐름이 이어질 가능성에 집중",
    stability: 43,
    drawdown: -24,
    liquidity: "낮음",
    bias: "과신·군집행동",
    biasTone: "high",
    feedback:
      "최근 수익과 주변의 낙관론을 미래에도 이어질 근거로 사용했습니다. 기대수익보다 목표자금 훼손 가능성을 먼저 확인해 보세요.",
  },
  {
    id: "hold",
    label: "기존 자산배분을 유지한다",
    description: "정한 원칙을 유지하며 이벤트를 통과",
    stability: 76,
    drawdown: -14,
    liquidity: "보통",
    bias: "관성 가능성",
    biasTone: "medium",
    feedback:
      "단기 뉴스에 흔들리지 않은 점은 견고합니다. 다만 현재 비중이 처음 세운 원칙과 여전히 맞는지는 별도로 점검해야 합니다.",
  },
  {
    id: "rebalance",
    label: "일부 수익을 실현해 비중을 조정한다",
    description: "목표 시점에 맞춰 위험자산을 축소",
    stability: 86,
    drawdown: -9,
    liquidity: "높음",
    bias: "낮음",
    biasTone: "low",
    feedback:
      "시장 방향을 맞히기보다 목표 시점과 감당 가능한 손실을 기준으로 판단했습니다. 상승이 이어질 때의 기회비용도 함께 감수하는 선택입니다.",
  },
  {
    id: "diversify",
    label: "다른 자산군으로 분산한다",
    description: "집중도를 낮추고 충격 전달 경로를 분산",
    stability: 82,
    drawdown: -11,
    liquidity: "보통 이상",
    bias: "낮음",
    biasTone: "low",
    feedback:
      "한 산업의 기대가 전체 목표를 좌우하지 않도록 위험을 나눴습니다. 자산 간 상관관계가 충격기에 달라질 수 있다는 점은 남아 있습니다.",
  },
  {
    id: "wait",
    label: "실적과 시장 반응을 확인한 뒤 결정한다",
    description: "정보를 더 확보하되 결정 기준을 먼저 설정",
    stability: 69,
    drawdown: -13,
    liquidity: "높음",
    bias: "판단 회피 주의",
    biasTone: "medium",
    feedback:
      "불확실한 시점에 기다리는 것도 전략이지만, 기한과 실행 조건이 없으면 판단 회피가 됩니다. 결정 날짜와 허용 손실을 함께 정해 보세요.",
  },
];

const scenarioCopy = {
  optimistic: {
    label: "낙관 경로",
    trigger: "AI 수요·실적 기대 상회",
    outcome: "반도체 강세가 이어지고 KOSPI가 추가 상승",
  },
  base: {
    label: "기준 경로",
    trigger: "실적은 부합, 기대는 이미 반영",
    outcome: "큰 방향 없이 높은 변동성이 반복",
  },
  risk: {
    label: "위험 경로",
    trigger: "업황 우려·기술주 조정 중첩",
    outcome: "집중 자산의 하락이 목표자금에 전달",
  },
};

export default function Home() {
  const [activeEvent, setActiveEvent] = useState<EventId>("turning");
  const [selectedChoice, setSelectedChoice] = useState<ChoiceId | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [semiconductorRatio, setSemiconductorRatio] = useState(42);
  const [goal, setGoal] = useState("전세자금");
  const [goalMonths, setGoalMonths] = useState(36);
  const [riskStyle, setRiskStyle] = useState("균형형");

  const activeChoice = useMemo(
    () => choices.find((choice) => choice.id === selectedChoice) ?? null,
    [selectedChoice],
  );

  const concentrationPenalty = Math.max(0, semiconductorRatio - 42);
  const adjustedStability = activeChoice
    ? Math.max(28, Math.round(activeChoice.stability - concentrationPenalty * 0.35))
    : 0;
  const adjustedDrawdown = activeChoice
    ? Math.round((activeChoice.drawdown - concentrationPenalty * 0.08) * 10) / 10
    : 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chooseEvent = (id: EventId) => {
    setActiveEvent(id);
    setSelectedChoice(null);
    setHasRun(false);
  };

  const chooseAction = (id: ChoiceId) => {
    setSelectedChoice(id);
    setHasRun(false);
  };

  const runSimulation = () => {
    if (!selectedChoice) return;
    setHasRun(true);
    window.setTimeout(() => scrollTo("simulation-result"), 80);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => scrollTo("today")} aria-label="FINVERSE 홈">
            <span className="brand-mark">F</span>
            <span>FINVERSE</span>
          </button>

          <nav className="main-nav" aria-label="주요 메뉴">
            <button className="active" onClick={() => scrollTo("today")}>오늘 시장</button>
            <button onClick={() => scrollTo("simulate")}>시뮬레이션</button>
            <button onClick={() => scrollTo("my-twin")}>마이 트윈</button>
          </nav>

          <button className="profile-button" onClick={() => setProfileOpen(true)}>
            <UserRound size={17} aria-hidden="true" />
            <span>내 상태</span>
          </button>
        </div>
      </header>

      <main>
        <section className="market-strip" aria-label="교육용 시장 데이터">
          <div className="market-strip-inner">
            <div className="market-date">
              <span>오늘의 시장</span>
              <strong>2026.07.19</strong>
            </div>
            <div className="market-metrics">
              {marketMetrics.map((metric) => (
                <div className="market-metric" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small className={metric.tone}>{metric.delta}</small>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="workspace" id="today">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">TODAY · MARKET IMPACT LAB</p>
              <h1>오늘 시장을 내 미래로 연결합니다</h1>
              <p>
                뉴스의 방향을 맞히는 대신, 지금의 선택이 내 자산과 생활 목표에 남길 영향을 연습하세요.
              </p>
            </div>
            <span className="demo-label"><ShieldCheck size={15} /> 교육용 가상 데이터</span>
          </div>

          <div className="dashboard-grid">
            <div className="market-column">
              <section className="market-timeline" aria-labelledby="timeline-title">
                <div className="section-heading">
                  <div>
                    <span className="section-index">01</span>
                    <p>핵심 시장 이벤트</p>
                    <h2 id="timeline-title">AI 반도체 랠리 이후 KOSPI 변곡점</h2>
                  </div>
                  <div className="timeline-legend" aria-label="차트 범례">
                    <span><i className="legend-line history" />실제 흐름</span>
                    <span><i className="legend-line future" />조건부 경로</span>
                  </div>
                </div>

                <div className="chart-frame" aria-label="2026년 KOSPI 반도체 시나리오 타임라인">
                  <div className="chart-caption-row">
                    <span>KOSPI 교육용 지수</span>
                    <strong>상승 뒤 변동성 확대</strong>
                  </div>
                  <div className="chart-scroll">
                    <div className="chart-stage">
                      <svg viewBox="0 0 900 290" role="img" aria-labelledby="chart-title chart-desc">
                        <title id="chart-title">2026 반도체 랠리와 KOSPI 변곡점</title>
                        <desc id="chart-desc">
                          2026년 1월부터 7월까지 상승한 교육용 KOSPI 흐름과 이후 세 가지 조건부 경로를 보여줍니다.
                        </desc>
                        <g className="grid-lines">
                          <line x1="40" y1="45" x2="870" y2="45" />
                          <line x1="40" y1="105" x2="870" y2="105" />
                          <line x1="40" y1="165" x2="870" y2="165" />
                          <line x1="40" y1="225" x2="870" y2="225" />
                        </g>
                        <g className="axis-copy">
                          <text x="4" y="49">3,400</text>
                          <text x="4" y="109">3,200</text>
                          <text x="4" y="169">3,000</text>
                          <text x="4" y="229">2,800</text>
                          <text x="56" y="274">1월</text>
                          <text x="232" y="274">3월</text>
                          <text x="410" y="274">5월</text>
                          <text x="579" y="274">오늘</text>
                          <text x="797" y="274">8월</text>
                        </g>
                        <path
                          className="market-area"
                          d="M60 220 C120 210 150 185 205 190 C260 196 270 132 330 145 C395 158 405 90 470 98 C515 105 545 65 600 86 L600 245 L60 245 Z"
                        />
                        <path
                          className="market-history"
                          d="M60 220 C120 210 150 185 205 190 C260 196 270 132 330 145 C395 158 405 90 470 98 C515 105 545 65 600 86"
                        />
                        <path className="scenario-path optimistic" d="M600 86 C675 60 735 68 850 45" />
                        <path className="scenario-path base" d="M600 86 C682 120 748 78 850 112" />
                        <path className="scenario-path risk" d="M600 86 C670 128 735 150 850 194" />
                        <line className="today-line" x1="600" y1="28" x2="600" y2="246" />
                        <circle className="event-dot rally" cx="285" cy="154" r="7" />
                        <circle className="event-dot current" cx="600" cy="86" r="9" />
                        <circle className="event-dot future" cx="850" cy="112" r="7" />
                      </svg>
                      <div className="path-label optimistic">낙관</div>
                      <div className="path-label base">기준</div>
                      <div className="path-label risk">위험</div>
                    </div>
                  </div>
                </div>

                <div className="event-selector" role="list" aria-label="시장 이벤트 선택">
                  {(Object.keys(events) as EventId[]).map((id) => {
                    const item = events[id];
                    return (
                      <button
                        className={activeEvent === id ? "event-option active" : "event-option"}
                        key={id}
                        onClick={() => chooseEvent(id)}
                        aria-pressed={activeEvent === id}
                      >
                        <span>{item.date}</span>
                        <strong>{item.phase}</strong>
                        <ChevronRight size={17} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>

                <div className="event-detail" aria-live="polite">
                  <div className="event-copy">
                    <span className="event-phase">{events[activeEvent].phase}</span>
                    <h3>{events[activeEvent].title}</h3>
                    <p>{events[activeEvent].summary}</p>
                  </div>
                  <div className="impact-list">
                    <div>
                      <LineChart size={18} aria-hidden="true" />
                      <span>시장 신호</span>
                      <strong>{events[activeEvent].signal}</strong>
                    </div>
                    <div>
                      <WalletCards size={18} aria-hidden="true" />
                      <span>내 노출</span>
                      <strong>{events[activeEvent].exposure}</strong>
                    </div>
                    <div>
                      <Target size={18} aria-hidden="true" />
                      <span>목표 영향</span>
                      <strong>{events[activeEvent].goal}</strong>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <aside className="twin-panel" aria-labelledby="twin-summary-title">
              <div className="twin-heading">
                <div className="twin-icon"><UserRound size={21} aria-hidden="true" /></div>
                <div>
                  <span>MY FINANCIAL TWIN</span>
                  <h2 id="twin-summary-title">내 상태로 보면</h2>
                </div>
                <button className="icon-button" onClick={() => setProfileOpen(true)} title="금융 트윈 수정">
                  <Pencil size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="profile-summary">
                <div><span>투자 성향</span><strong>{riskStyle}</strong></div>
                <div><span>반도체 비중</span><strong>{semiconductorRatio}%</strong></div>
                <div><span>생활 목표</span><strong>{goal}</strong></div>
                <div><span>목표까지</span><strong>{goalMonths}개월</strong></div>
              </div>

              <div className="risk-gauge">
                <div className="gauge-label">
                  <span>산업 집중도</span>
                  <strong className={semiconductorRatio >= 40 ? "high" : "normal"}>
                    {semiconductorRatio >= 40 ? "주의" : "보통"}
                  </strong>
                </div>
                <div className="gauge-track" aria-label={`반도체 자산 비중 ${semiconductorRatio}%`}>
                  <span style={{ width: `${Math.min(100, semiconductorRatio)}%` }} />
                </div>
                <p>반도체 조정이 커지면 {goal} 목표자금의 변동 가능성도 함께 높아집니다.</p>
              </div>

              <div className="impact-route" aria-label="시장 충격 영향 경로">
                <span>반도체 기대</span>
                <ChevronRight size={15} />
                <span>KOSPI 변동</span>
                <ChevronRight size={15} />
                <span className="active">내 목표</span>
              </div>

              <div className="twin-insight">
                <BrainCircuit size={19} aria-hidden="true" />
                <div>
                  <strong>지금 확인할 질문</strong>
                  <p>수익 기회를 놓칠까 두려운가요, 아니면 {goal}을 지키는 기준이 있나요?</p>
                </div>
              </div>

              <button className="primary-button" onClick={() => scrollTo("simulate")}>
                <Play size={17} fill="currentColor" aria-hidden="true" />
                내 상황으로 시뮬레이션
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <p className="privacy-note"><LockKeyhole size={14} /> 실제 계좌 연결 없이 가상 프로필로 체험합니다.</p>
            </aside>
          </div>
        </div>

        <section className="simulation-section" id="simulate">
          <div className="simulation-inner">
            <div className="section-heading simulation-heading">
              <div>
                <span className="section-index">02</span>
                <p>내 선택 플레이</p>
                <h2>시장이 흔들릴 때, 어떤 행동을 선택하시겠습니까?</h2>
              </div>
              <div className="profile-context">
                <Target size={16} /> {goal} · {goalMonths}개월 · 반도체 {semiconductorRatio}%
              </div>
            </div>

            <div className="simulation-grid">
              <div className="choice-panel">
                <div className="choice-intro">
                  <strong>하나의 행동을 선택하세요</strong>
                  <span>정답이 아니라 선택의 조건과 위험을 비교합니다.</span>
                </div>
                <div className="choice-list">
                  {choices.map((choice, index) => (
                    <button
                      className={selectedChoice === choice.id ? "choice-card selected" : "choice-card"}
                      key={choice.id}
                      onClick={() => chooseAction(choice.id)}
                      aria-pressed={selectedChoice === choice.id}
                    >
                      <span className="choice-key">{String.fromCharCode(65 + index)}</span>
                      <span className="choice-copy">
                        <strong>{choice.label}</strong>
                        <small>{choice.description}</small>
                      </span>
                      <span className="choice-check">{selectedChoice === choice.id && <Check size={15} />}</span>
                    </button>
                  ))}
                </div>
                <button className="run-button" onClick={runSimulation} disabled={!selectedChoice}>
                  <RefreshCw size={17} aria-hidden="true" />
                  선택 결과 비교하기
                </button>
              </div>

              <div className={hasRun ? "result-panel ready" : "result-panel"} id="simulation-result" aria-live="polite">
                {!hasRun || !activeChoice ? (
                  <div className="result-empty">
                    <div className="empty-visual">
                      <BarChart3 size={36} aria-hidden="true" />
                    </div>
                    <span>CONDITIONAL SCENARIOS</span>
                    <h3>선택하면 세 가지 미래 경로가 열립니다</h3>
                    <p>시장 예측이 아닌 낙관·기준·위험 조건에서 내 목표가 얼마나 견고한지 비교합니다.</p>
                    <div className="empty-lanes" aria-hidden="true">
                      <i /><i /><i />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="result-header">
                      <div>
                        <span>선택 결과</span>
                        <h3>{activeChoice.label}</h3>
                      </div>
                      <span className={`bias-badge ${activeChoice.biasTone}`}>{activeChoice.bias}</span>
                    </div>

                    <div className="result-metrics">
                      <div>
                        <span>목표 안정성</span>
                        <strong>{adjustedStability}<small>/100</small></strong>
                      </div>
                      <div>
                        <span>위험 경로 손실 폭</span>
                        <strong className="negative">{adjustedDrawdown}%</strong>
                      </div>
                      <div>
                        <span>유동성</span>
                        <strong>{activeChoice.liquidity}</strong>
                      </div>
                    </div>

                    <div className="scenario-lanes">
                      {(Object.keys(scenarioCopy) as Array<keyof typeof scenarioCopy>).map((key) => {
                        const scenario = scenarioCopy[key];
                        return (
                          <div className={`scenario-lane ${key}`} key={key}>
                            <div><span>{scenario.label}</span><i /></div>
                            <strong>{scenario.trigger}</strong>
                            <p>{scenario.outcome}</p>
                          </div>
                        );
                      })}
                    </div>

                    <div className="coach-feedback">
                      <BrainCircuit size={22} aria-hidden="true" />
                      <div>
                        <span>AI 행동 코치</span>
                        <p>{activeChoice.feedback}</p>
                      </div>
                    </div>
                    <p className="result-disclaimer">
                      수치는 서비스 경험을 설명하기 위한 가상 범위이며 실제 수익률 예측이나 금융상품 추천이 아닙니다.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="twin-history" id="my-twin">
          <div className="twin-history-inner">
            <div className="section-heading">
              <div>
                <span className="section-index">03</span>
                <p>마이 트윈</p>
                <h2>수익률보다 판단 습관을 기록합니다</h2>
              </div>
            </div>
            <div className="learning-grid">
              <div className="learning-summary">
                <span>이번 시뮬레이션</span>
                <strong>{hasRun ? "1회 완료" : "진행 전"}</strong>
                <p>{hasRun ? "시장 충격에서 목표를 기준으로 선택하는 연습을 완료했습니다." : "첫 선택을 완료하면 행동 패턴이 여기에 기록됩니다."}</p>
              </div>
              <div className="habit-list">
                <div><span>추격 매수 민감도</span><strong>{selectedChoice === "increase" ? "높음" : hasRun ? "낮음" : "-"}</strong></div>
                <div><span>목표 기준 일관성</span><strong>{hasRun ? `${adjustedStability}점` : "-"}</strong></div>
                <div><span>대안 비교 완료</span><strong>{hasRun ? "3개 경로" : "-"}</strong></div>
              </div>
              <div className="next-mission">
                <span>다음 추천 연습</span>
                <CalendarDays size={22} aria-hidden="true" />
                <h3>기준금리 변화와 내 대출 점검</h3>
                <p>투자 외에도 부채와 현금흐름에 연결되는 의사결정을 연습합니다.</p>
                <button onClick={() => scrollTo("today")}>오늘 시장으로 돌아가기 <ArrowRight size={15} /></button>
              </div>
            </div>
          </div>
        </section>

        <footer>
          <div className="footer-inner">
            <div><span className="brand-mark small">F</span><strong>FINVERSE</strong></div>
            <p>금융 지식을 실제 판단으로 연결하는 AI 금융 디지털 트윈</p>
            <span>2026 금융 AI Challenge MVP</span>
          </div>
        </footer>
      </main>

      <nav className="mobile-dock" aria-label="모바일 주요 메뉴">
        <button onClick={() => scrollTo("today")}><Landmark size={18} /><span>오늘</span></button>
        <button onClick={() => scrollTo("simulate")}><Play size={18} /><span>플레이</span></button>
        <button onClick={() => scrollTo("my-twin")}><UserRound size={18} /><span>마이 트윈</span></button>
      </nav>

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setProfileOpen(false)}>
          <section
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span>MY FINANCIAL TWIN</span>
                <h2 id="profile-modal-title">내 가상 금융 상태</h2>
                <p>민감한 계좌정보 없이 대략적인 상태만 입력합니다.</p>
              </div>
              <button className="icon-button" onClick={() => setProfileOpen(false)} title="닫기">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="form-grid">
              <label>
                <span>투자 성향</span>
                <select value={riskStyle} onChange={(event) => setRiskStyle(event.target.value)}>
                  <option>안정형</option>
                  <option>균형형</option>
                  <option>성장형</option>
                </select>
              </label>
              <label>
                <span>가장 중요한 생활 목표</span>
                <select value={goal} onChange={(event) => setGoal(event.target.value)}>
                  <option>비상금</option>
                  <option>전세자금</option>
                  <option>주택 마련</option>
                  <option>학자금 상환</option>
                </select>
              </label>
              <label className="range-field">
                <span>반도체·성장주 비중 <strong>{semiconductorRatio}%</strong></span>
                <input
                  type="range"
                  min="0"
                  max="80"
                  step="2"
                  value={semiconductorRatio}
                  onChange={(event) => setSemiconductorRatio(Number(event.target.value))}
                />
                <small><span>0%</span><span>80%</span></small>
              </label>
              <label className="range-field">
                <span>목표까지 남은 기간 <strong>{goalMonths}개월</strong></span>
                <input
                  type="range"
                  min="6"
                  max="84"
                  step="6"
                  value={goalMonths}
                  onChange={(event) => setGoalMonths(Number(event.target.value))}
                />
                <small><span>6개월</span><span>84개월</span></small>
              </label>
            </div>

            <div className="modal-notice">
              <CircleAlert size={18} aria-hidden="true" />
              <p>입력값은 MVP 화면 안에서만 사용되며 실제 금융계좌와 연결되지 않습니다.</p>
            </div>
            <button className="primary-button modal-submit" onClick={() => setProfileOpen(false)}>
              <Check size={17} aria-hidden="true" /> 내 상태 적용하기
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
