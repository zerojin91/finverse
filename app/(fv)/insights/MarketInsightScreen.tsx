"use client";

import * as React from "react";
import { Activity, BarChart3, Bookmark, CalendarClock, CalendarDays, CircleDollarSign, Globe2, Plus, Sparkles, UsersRound, X } from "lucide-react";
import { EventTimeline, PageHeading, Panel, ScenarioCard } from "@/components/ds";
import { forecastGeometry, sparkline, toneBand, toneColor } from "@/lib/charts";
import { MARKET_STAMP, kospiActual, miniIndices, scenarios, signals, stars, type Signal } from "@/lib/finverse-data";

const scenarioIcon = { chart: <BarChart3 size={22} />, brain: <Activity size={22} />, dollar: <CircleDollarSign size={22} /> };
const signalIcon = { economy: Activity, country: Globe2, event: CalendarClock, community: UsersRound };

export default function MarketInsightScreen() {
  const [selectedId, setSelectedId] = React.useState(scenarios[0].id);
  const [signal, setSignal] = React.useState<Signal | null>(null);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [period, setPeriod] = React.useState("30일");
  const [summaryOpen, setSummaryOpen] = React.useState(false);

  const selected = scenarios.find((s) => s.id === selectedId) ?? scenarios[0];
  const fg = forecastGeometry(kospiActual, selected);
  const color = toneColor(selected.tone);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSignal(null);
      setBuilderOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="market-page" data-screen-label="시장 인사이트">
      <PageHeading
        kicker="MARKET INSIGHT"
        title="오늘의 시장을 이해하고, 다음 움직임을 미리 살펴보세요."
        stamp={
          <>
            <CalendarDays size={15} />
            {MARKET_STAMP}
          </>
        }
      />

      <section className="market-dashboard">
        <Panel className="market-signal-panel" kicker="MARKET PULSE" title="시장 연결">
          <div className="signal-stack">
            {signals.map((s) => {
              const Icon = signalIcon[s.key];
              return (
                <article className={`signal-group ${s.key}`} key={s.key}>
                  <button className="signal-group-button" type="button" onClick={() => setSignal(s)}>
                    <span className="signal-group-head">
                      <span className="signal-icon">
                        <Icon size={15} />
                      </span>
                      <strong>{s.label}</strong>
                    </span>
                    <span className="signal-events">
                      {s.topics.map((t) => (
                        <span key={t.title}>
                          <span>
                            <strong>{t.title}</strong>
                            <small>근거 {t.stars}개</small>
                          </span>
                          <b>{stars(t.stars)}</b>
                        </span>
                      ))}
                    </span>
                    <span className="signal-track" aria-hidden="true">
                      <i />
                      <i />
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
          <p className="data-note">* 모든 시장 연결 값은 {MARKET_STAMP}입니다.</p>
        </Panel>

        <section className="panel chart-panel">
          <div className="market-overview">
            <article className="market-overview-primary kospi-classic-primary">
              <div className="kospi-head">
                <div>
                  <div className="kospi-title-line">
                    <span>코스피</span>
                  </div>
                  <div className="kospi-value-line">
                    <b>6,023.66</b>
                    <strong className="down">-732.09 (10.84%)</strong>
                  </div>
                </div>
                <div className="scenario-preview-meta">
                  <span>선택 시나리오</span>
                  <div className="scenario-preview-card">
                    <strong>{selected.title}</strong>
                    <b className={selected.tone}>{selected.forecast}</b>
                  </div>
                </div>
              </div>
              <svg viewBox={`0 0 ${fg.width} ${fg.height}`} className="forecast-canvas" role="img" aria-label="KOSPI 조건부 예측 경로">
                {fg.grid.map((gy) => (
                  <line key={gy} x1={16} y1={gy} x2={fg.width - 50} y2={gy} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 4" />
                ))}
                <polygon points={fg.band} fill={toneBand(selected.tone)} />
                <path d={fg.actualPath} fill="none" stroke="var(--ink)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                <path d={fg.forecastPath} fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={fg.splitX} cy={fg.splitY} r={4} fill="var(--soft)" stroke="var(--ink)" strokeWidth={1.6} />
                <text x={fg.splitX - 34} y={fg.splitY + 20} fill="var(--text)" fontSize={11} fontWeight={700}>
                  6,023.66
                </text>
                <text x={fg.endX + 8} y={fg.endY + 4} fill={color} fontSize={12} fontWeight={800}>
                  {fg.endValue.toLocaleString("ko-KR")}
                </text>
                <text x={16} y={fg.height - 8} fill="#a1a1aa" fontSize={9}>
                  6/16
                </text>
                <text x={fg.splitX - 12} y={fg.height - 8} fill="#a1a1aa" fontSize={9}>
                  7/28
                </text>
                <text x={fg.endX - 26} y={fg.height - 8} fill="#a1a1aa" fontSize={9}>
                  1개월 후
                </text>
              </svg>
            </article>
            <div className="market-overview-side">
              {miniIndices.map((m) => {
                const { pts, lastY } = sparkline(m.points);
                return (
                  <article className="market-overview-mini" key={m.name}>
                    <svg viewBox="0 0 66 66" aria-hidden="true">
                      <polyline points={pts} />
                      <circle cx={61} cy={lastY} r={2.4} />
                    </svg>
                    <div>
                      <header>
                        <span>{m.name}</span>
                      </header>
                      <div className="market-overview-mini-value">
                        <b>{m.value}</b>
                        <span className="down">{m.change}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          <div className={`ai-summary${summaryOpen ? " expanded" : ""}`}>
            <Sparkles size={17} />
            <button className="ai-summary-copy" type="button" onClick={() => setSummaryOpen((v) => !v)}>
              <strong>AI 요약</strong>
              <p>
                <span>
                  2026년 7월 28일 종가 6,023.66에서 출발하는 조건부 전망입니다. 외국인 수급 회복, SK하이닉스 영업이익의 컨센서스 10% 이상 상회, Microsoft·Meta의 AI CapEx 유지·확대가 모두 확인되면 1개월 7,500까지 반등을 시도합니다.
                </span>
                <span>선행 PER 5.7~5.8배와 RSI 31~34의 과매도 구간은 반등 여지를 주지만, MACD 하락과 연환산 변동성 80%는 큰 변동성을 경고합니다.</span>
              </p>
            </button>
          </div>
        </section>

        <Panel
          className="event-panel"
          kicker="가상 시뮬레이션"
          title="발생 가능 이벤트"
          aside={<span className="scenario-period">{selected.duration}</span>}
        >
          <EventTimeline events={selected.events} />
        </Panel>
      </section>

      <section className="scenario-section" id="scenarios">
        <div className="scenario-heading">
          <div>
            <span>SCENARIO LIBRARY</span>
            <h2>시나리오별 KOSPI 경로를 비교하세요</h2>
            <p>준비된 시장 환경을 선택하면 발생 가능 이벤트와 조건부 예상 경로가 열립니다.</p>
          </div>
          <span>
            <CircleDollarSign size={15} />
            가상 시뮬레이션
          </span>
        </div>
        <div className="scenario-grid">
          {scenarios.map((s) => (
            <ScenarioCard
              key={s.id}
              title={s.title}
              tags={[s.duration, ...s.tags]}
              forecast={s.forecast}
              tone={s.tone}
              active={s.id === selectedId}
              icon={scenarioIcon[s.icon]}
              onSelect={() => setSelectedId(s.id)}
            />
          ))}
          <button className="custom-scenario-card" type="button" onClick={() => setBuilderOpen(true)}>
            <Plus size={24} />
            <div>
              <strong>내 시나리오 예측하기</strong>
              <p>원하는 시장 조건과 기간을 직접 선택하세요.</p>
            </div>
          </button>
        </div>
      </section>

      {signal ? (
        <div className="modal-backdrop market-signal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSignal(null)}>
          <section className="market-signal-modal" role="dialog" aria-modal="true" aria-label={`${signal.label} 상세`}>
            <header className="market-signal-modal-header">
              <div>
                <span>MARKET CONNECTION · DETAIL</span>
                <h2>{signal.label}</h2>
                <p>오늘 KOSPI에 연결된 핵심 키워드와 시장 영향을 확인하세요.</p>
              </div>
              <button className="scenario-modal-close" type="button" onClick={() => setSignal(null)} aria-label="닫기">
                <X size={20} />
              </button>
            </header>
            <div className="market-signal-modal-section">
              <span>현재 KOSPI 영향 요약</span>
              <p>{signal.impact}</p>
            </div>
            <div className="market-signal-modal-keywords">
              {signal.topics.map((t, i) => (
                <article key={t.title}>
                  <div className="market-signal-topic-copy">
                    <span>대주제 {i + 1}</span>
                    <strong>{t.title}</strong>
                  </div>
                  <b>{stars(t.stars)}</b>
                  <p>{t.summary}</p>
                </article>
              ))}
            </div>
            <small className="market-signal-modal-note">DB 원천을 규칙 기반으로 정리한 결과입니다.</small>
          </section>
        </div>
      ) : null}

      {builderOpen ? (
        <div className="modal-backdrop scenario-builder-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setBuilderOpen(false)}>
          <section className="scenario-modal scenario-builder-modal" role="dialog" aria-modal="true" aria-label="내 시나리오 만들기">
            <header className="scenario-builder-header">
              <div>
                <span>MY SCENARIO LAB</span>
                <h2>내 시나리오를 예측해보세요</h2>
                <p>질문과 예측 기간을 입력하면 최신 시장 근거로 온톨로지 문서를 생성합니다.</p>
              </div>
              <button className="scenario-modal-close" type="button" onClick={() => setBuilderOpen(false)} aria-label="닫기">
                <X size={20} />
              </button>
            </header>
            <div className="builder-question-section">
              <div className="builder-section-heading">
                <div>
                  <span>01 · FORECAST QUESTION</span>
                  <h3>예측 시나리오 질문</h3>
                </div>
              </div>
              <textarea
                className="scenario-prompt"
                rows={6}
                defaultValue="현재 코스피 시장에서 반도체 실적과 외국인 수급 변화가 향후 1개월 코스피에 미칠 영향은 무엇인가"
              />
              <div className="builder-prompt-hint">
                <Sparkles size={14} /> 질문은 시장·경제·이벤트 Evidence 문서 생성에 사용됩니다.
              </div>
            </div>
            <div className="builder-period-row">
              <div>
                <span>예측 기간</span>
                <small>지식그래프에서 경로를 계산할 구간</small>
              </div>
              <div className="builder-period-options">
                {["7일", "30일", "3개월"].map((p) => (
                  <button key={p} type="button" className={p === period ? "active" : undefined} onClick={() => setPeriod(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <button className="run-custom-button" type="button" onClick={() => setBuilderOpen(false)}>
              <Bookmark size={18} /> 시뮬레이션 시작하기
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
