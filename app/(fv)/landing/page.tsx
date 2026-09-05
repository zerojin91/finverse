import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, BarChart3, CalendarClock, CircleDollarSign, Plus, Sparkles } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { ScenarioCard } from "@/components/ds";
import { ThemeToggle } from "@/components/ds/ThemeToggle";
import { scenarios, stars, kospiActual, DISCLAIMER } from "@/lib/finverse-data";
import { forecastGeometry, twinGeometry } from "@/lib/charts";

const scenarioIcon = { chart: <BarChart3 size={22} />, brain: <Activity size={22} />, dollar: <CircleDollarSign size={22} /> };

const ticker = [
  { label: "KOSPI · 7/28 KRX 장마감", value: "6,023.66", delta: "-732.09 (10.84%)", tone: "down" },
  { label: "외국인 수급", value: "-5조 1,200억", delta: "순매도", tone: "down" },
  { label: "원·달러", value: "1,462.50", delta: "-0.41%", tone: "down" },
  { label: "KRX 반도체", value: "4,318.72", delta: "-13.82%", tone: "down" },
  { label: "선택 시나리오", value: "+24.5%", delta: "조건부 반등", tone: "up" },
];

const flow = [
  {
    n: "01",
    title: "시장을 이해한다",
    body: "경제·국가·이벤트·커뮤니티 네 축의 근거를 모아 오늘의 KOSPI 기여도로 환산합니다. 삼성전자 -1.68%p, 반도체 지수 -3.46%p처럼 원인이 숫자로 남습니다.",
    note: "근거마다 원천 링크와 중요도 ★ 3점 척도",
  },
  {
    n: "02",
    title: "조건을 시뮬레이션한다",
    body: "\u201c외국인 순매수가 돌아오고, 실적이 컨센서스를 10% 웃돌면\u201d 같은 조건을 세워 1주·2주·1개월 중심값과 70% 신뢰구간을 그립니다.",
    note: "반증 신호를 같은 화면에 함께 기록",
  },
  {
    n: "03",
    title: "나에게 적용한다",
    body: "선택한 시나리오를 내 보유 종목·비중에 대입해 자산 경로를 다시 계산합니다. 지수 이야기가 내 계좌의 숫자로 번역됩니다.",
    note: "목표 달성률과 현금 비중까지 함께 갱신",
  },
];

export const metadata: Metadata = {
  title: "FINVERSE | 시장을 이해하고, 나에게 적용하다",
  description:
    "오늘의 KOSPI를 만든 조건을 분해하고, 그 조건이 이어질 때의 경로를 시뮬레이션한 뒤, 내 포트폴리오에 그대로 연결합니다.",
};

export default function LandingPage() {
  const hero = scenarios[0];
  const fg = forecastGeometry(kospiActual, hero, 620, 210);
  const tg = twinGeometry(scenarios, hero.id);

  return (
    <Reveal>
      <div className="lp finverse-app" data-screen-label="스모크 페이지">
        <header className="lp-nav">
          <div className="lp-wrap">
            <div className="lp-brand">
              <span className="brand-mark">F</span>
              <span>FINVERSE</span>
            </div>
            <nav>
              <a href="#flow">작동 방식</a>
              <a href="#features">기능</a>
              <a href="#scenarios">시나리오</a>
            </nav>
            <div className="lp-nav-cta">
              <ThemeToggle />
              <Link className="lp-ghost" href="/twin">
                마이 금융 트윈
              </Link>
              <Link className="lp-solid" href="/insights">
                시장 인사이트 열기
              </Link>
            </div>
          </div>
        </header>

        <section className="lp-hero">
          <div className="lp-smoke" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="lp-grid" aria-hidden="true" />
          <div className="lp-wrap">
            <span className="lp-kicker">
              <i />
              AI DECISION LAB · 금융 판단 실험실
            </span>
            <h1>
              시장을 이해하고,
              <br />
              <em>나에게</em> 적용하다.
            </h1>
            <p className="lp-hero-lede">
              오늘의 KOSPI를 만든 조건을 분해하고, 그 조건이 이어질 때의 경로를 시뮬레이션한 뒤, 내 포트폴리오에 그대로 연결합니다. 예측을 파는 대신 판단의 근거를 남깁니다.
            </p>
            <div className="lp-hero-actions">
              <Link className="lp-solid" href="/insights">
                시장 인사이트 보기
              </Link>
              <Link className="lp-ghost" href="/twin">
                내 자산 경로 확인하기
              </Link>
            </div>
            <div className="lp-ticker" data-reveal>
              {ticker.map((t) => (
                <div key={t.label}>
                  <span>{t.label}</span>
                  <b className={t.tone}>
                    {t.value} <em>{t.delta}</em>
                  </b>
                </div>
              ))}
            </div>
          </div>
          <div className="lp-hero-shot" data-reveal>
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image is unused in this repo; a plain img keeps the vinext build safe */}
            <img src="/og.png" alt="FINVERSE 시장 인사이트와 마이 금융 트윈 화면" width={1200} height={630} fetchPriority="high" />
          </div>
        </section>

        <div className="lp-wrap">
          <section className="lp-section" id="flow">
            <div className="lp-section-head" data-reveal>
              <span>HOW IT WORKS</span>
              <h2>시장 → 조건 → 나. 세 단계로만 움직입니다.</h2>
              <p>각 단계는 다음 단계의 입력이 됩니다. 뉴스를 요약해 보여주는 대신, 그 뉴스가 지수의 어디에 연결되는지부터 확인합니다.</p>
            </div>
            <div className="lp-flow" data-reveal>
              {flow.map((f) => (
                <article key={f.n}>
                  <b>{f.n}</b>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                  <small>{f.note}</small>
                </article>
              ))}
            </div>
          </section>

          <section id="features">
            <div className="lp-feature" data-reveal>
              <div className="lp-feature-copy">
                <span>MARKET PULSE</span>
                <h3>오늘 지수를 움직인 것이 무엇인지, 먼저 분해합니다.</h3>
                <p>네 개의 신호 축이 각각 어떤 대주제로 KOSPI에 연결되는지 보여줍니다. 요약문이 아니라 연결 경로를 읽게 됩니다.</p>
                <div className="lp-feature-list">
                  <div>
                    <b>01</b>
                    <div>
                      <strong>기여도 환산</strong>
                      <small>종목·환율·수급을 지수 기여도(%p)로 통일해 비교합니다.</small>
                    </div>
                  </div>
                  <div>
                    <b>02</b>
                    <div>
                      <strong>근거 추적</strong>
                      <small>대주제마다 사용한 기사·지표·댓글의 원천을 그대로 노출합니다.</small>
                    </div>
                  </div>
                  <div>
                    <b>03</b>
                    <div>
                      <strong>중요도 표기</strong>
                      <small>★ 3점 척도로 신호의 무게를 구분해, 모든 뉴스를 같게 취급하지 않습니다.</small>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lp-mock">
                <section className="panel" style={{ minHeight: 0 }}>
                  <div className="panel-title">
                    <div>
                      <span>MARKET PULSE</span>
                      <h2>시장 연결</h2>
                    </div>
                  </div>
                  <div className="signal-stack" style={{ margin: "14px 18px 16px" }}>
                    <article className="signal-group economy">
                      <span className="signal-group-head">
                        <span className="signal-icon">
                          <Activity size={15} />
                        </span>
                        <strong>경제</strong>
                      </span>
                      <span className="signal-events">
                        <span>
                          <span>
                            <strong>금리 정책</strong>
                            <small>근거 3개</small>
                          </span>
                          <b>{stars(3)}</b>
                        </span>
                        <span>
                          <span>
                            <strong>환율 변동성</strong>
                            <small>근거 2개</small>
                          </span>
                          <b>{stars(2)}</b>
                        </span>
                      </span>
                      <span className="signal-track" aria-hidden="true">
                        <i />
                        <i />
                      </span>
                    </article>
                    <article className="signal-group event">
                      <span className="signal-group-head">
                        <span className="signal-icon">
                          <CalendarClock size={15} />
                        </span>
                        <strong>이벤트</strong>
                      </span>
                      <span className="signal-events">
                        <span>
                          <span>
                            <strong>외국인 수급</strong>
                            <small>근거 5개</small>
                          </span>
                          <b>{stars(3)}</b>
                        </span>
                        <span>
                          <span>
                            <strong>반도체 실적</strong>
                            <small>근거 4개</small>
                          </span>
                          <b>{stars(3)}</b>
                        </span>
                      </span>
                      <span className="signal-track" aria-hidden="true">
                        <i />
                        <i />
                      </span>
                    </article>
                  </div>
                  <p className="data-note">* 모든 시장 연결 값은 2026.07.28 KRX 장마감 기준입니다.</p>
                </section>
              </div>
            </div>

            <div className="lp-feature reverse" data-reveal>
              <div className="lp-feature-copy">
                <span>CONDITIONAL PATH</span>
                <h3>맞히는 예측이 아니라, 무너지면 접는 조건입니다.</h3>
                <p>실제 지수 경로(잉크 실선) 뒤에 조건부 예측선과 70% 신뢰구간을 이어 그립니다. 조건이 하나 깨질 때 어디를 다시 봐야 하는지가 함께 남습니다.</p>
                <div className="lp-feature-list">
                  <div>
                    <b>01</b>
                    <div>
                      <strong>세 관문 체크리스트</strong>
                      <small>수급 회복 · 실적 서프라이즈 · AI CapEx 유지를 순서대로 검증합니다.</small>
                    </div>
                  </div>
                  <div>
                    <b>02</b>
                    <div>
                      <strong>구간별 중심값</strong>
                      <small>1주 6,650 · 2주 7,050 · 1개월 7,500과 밴드 6,700–8,300.</small>
                    </div>
                  </div>
                  <div>
                    <b>03</b>
                    <div>
                      <strong>반증 신호 상시 노출</strong>
                      <small>외국인 재순매도, MACD 하락 지속, 20일선 회복 실패.</small>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lp-mock">
                <section className="panel chart-panel" style={{ minHeight: 0 }}>
                  <div className="kospi-head" style={{ height: "auto", minHeight: 0, padding: "18px 22px 6px" }}>
                    <div>
                      <div className="kospi-title-line">
                        <span>코스피</span>
                        <em>조건부 반등</em>
                      </div>
                      <div className="kospi-value-line">
                        <b>6,023.66</b>
                        <strong className="down">-732.09 (10.84%)</strong>
                      </div>
                    </div>
                    <div className="scenario-preview-meta">
                      <span>1개월 중심값</span>
                      <div className="scenario-preview-card">
                        <strong>{hero.title}</strong>
                        <b className="up">7,500</b>
                      </div>
                    </div>
                  </div>
                  <div className="chart-legend" style={{ padding: "10px 22px 6px" }}>
                    <span>
                      <i className="forecast" style={{ background: "var(--ink)" }} />
                      실제(KRX)
                    </span>
                    <span>
                      <i className="forecast" />
                      예측(1개월)
                    </span>
                    <span>
                      <i className="range" />
                      신뢰구간(70%)
                    </span>
                  </div>
                  <svg
                    viewBox={`0 0 ${fg.width} ${fg.height}`}
                    style={{ display: "block", width: "100%", height: 210, background: "var(--soft)", borderTop: "1px solid var(--line)" }}
                    role="img"
                    aria-label="조건부 예측 경로"
                  >
                    {fg.grid.map((gy) => (
                      <line key={gy} x1={16} y1={gy} x2={fg.width - 20} y2={gy} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 4" />
                    ))}
                    <polygon points={fg.band} fill="rgba(239,68,68,.12)" />
                    <path d={fg.actualPath} fill="none" stroke="var(--ink)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                    <path d={fg.forecastPath} fill="none" stroke="#ef4444" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx={fg.splitX} cy={fg.splitY} r={4.5} fill="var(--soft)" stroke="var(--ink)" strokeWidth={1.6} />
                    <text x={fg.splitX - 48} y={fg.splitY + 20} fill="var(--text)" fontSize={11} fontWeight={700}>
                      6,023.66
                    </text>
                    <text x={fg.endX - 42} y={fg.endY - 10} fill="#ef4444" fontSize={12} fontWeight={800}>
                      7,500
                    </text>
                    <text x={16} y={fg.height - 8} fill="#a1a1aa" fontSize={9}>
                      6/16
                    </text>
                    <text x={fg.splitX - 12} y={fg.height - 8} fill="#a1a1aa" fontSize={9}>
                      7/28
                    </text>
                    <text x={fg.endX - 34} y={fg.height - 8} fill="#a1a1aa" fontSize={9}>
                      1개월 후
                    </text>
                  </svg>
                  <div className="ai-summary" style={{ margin: "12px 16px 14px" }}>
                    <Sparkles size={17} />
                    <div>
                      <strong>AI 요약</strong>
                      <p>세 조건이 모두 확인되면 1개월 7,500까지 반등을 시도합니다. RSI 31~34의 과매도는 여지를 주지만 연환산 변동성 80%는 큰 흔들림을 경고합니다.</p>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div className="lp-feature" data-reveal>
              <div className="lp-feature-copy">
                <span>MY FINANCIAL TWIN</span>
                <h3>지수 이야기를 내 계좌의 숫자로 번역합니다.</h3>
                <p>같은 시나리오를 내 보유 종목과 비중에 대입해 세 개의 자산 경로를 동시에 보여줍니다. 시장 전망이 아니라 내 선택의 결과를 비교하게 됩니다.</p>
                <div className="lp-feature-list">
                  <div>
                    <b>01</b>
                    <div>
                      <strong>보유 기여도</strong>
                      <small>종목별 1일 등락과 원 단위 기여도를 함께 표기합니다.</small>
                    </div>
                  </div>
                  <div>
                    <b>02</b>
                    <div>
                      <strong>시나리오별 경로</strong>
                      <small>선택 시나리오는 실선, 나머지는 점선으로 항상 비교선을 남깁니다.</small>
                    </div>
                  </div>
                  <div>
                    <b>03</b>
                    <div>
                      <strong>대가의 반론</strong>
                      <small>같은 시나리오에 대한 서로 다른 관점을 나란히 붙입니다.</small>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lp-mock">
                <section className="panel twin-assets-panel" style={{ minHeight: 0 }}>
                  <div className="panel-title">
                    <h2>나의 자산 현황</h2>
                    <span className="twin-path-caption">2026.07.28 기준</span>
                  </div>
                  <div className="twin-assets-grid" style={{ minHeight: 0, gridTemplateColumns: "1fr 1fr" }}>
                    <div className="twin-metric">
                      <span>총 자산(평가금액)</span>
                      <strong>128,450,000원</strong>
                      <small>
                        전일 대비 <b className="up">+1,250,000원 (+0.98%)</b>
                      </small>
                    </div>
                    <div className="twin-metric" style={{ borderRight: 0 }}>
                      <span>목표 달성률</span>
                      <strong>
                        62<em>%</em>
                      </strong>
                      <div className="twin-progress">
                        <i style={{ width: "62%" }} />
                      </div>
                      <small>목표 금액 200,000,000원</small>
                    </div>
                  </div>
                  <div className="twin-selected-path" style={{ margin: "0 16px 16px" }}>
                    <div className="twin-selected-path-head">
                      <div>
                        <span>선택 시나리오</span>
                        <strong>{hero.title}</strong>
                      </div>
                      <b className="up">
                        {hero.twinTarget.toFixed(1)} ({hero.twinNote})
                      </b>
                    </div>
                    <svg className="twin-path-chart" viewBox="0 0 540 170" role="img" aria-label="시나리오별 자산 경로">
                      {[28, 60, 92, 124].map((gy) => (
                        <line key={gy} x1={24} y1={gy} x2={520} y2={gy} stroke="var(--line)" />
                      ))}
                      <polygon points={tg.band} fill={tg.bandFill} />
                      {tg.lines.map((l, i) => (
                        <path
                          key={i}
                          d={l.d}
                          fill="none"
                          stroke={l.color}
                          strokeWidth={l.selected ? 2.8 : 1.6}
                          strokeDasharray={l.selected ? undefined : "5 4"}
                          strokeLinecap="round"
                          opacity={l.selected ? 1 : 0.72}
                        />
                      ))}
                      <circle cx={24} cy={tg.startY} r={4} fill="var(--ink)" />
                      {tg.lines.map((l, i) => (
                        <text key={i} x={452} y={l.labelY} fill={l.color} fontSize={11} fontWeight={700}>
                          {l.label}
                        </text>
                      ))}
                      <text x={18} y={160} fill="#a1a1aa" fontSize={10}>
                        현재
                      </text>
                      <text x={252} y={160} fill="#a1a1aa" fontSize={10}>
                        14일 후
                      </text>
                      <text x={470} y={160} fill="#a1a1aa" fontSize={10}>
                        1개월 후
                      </text>
                    </svg>
                  </div>
                </section>
              </div>
            </div>
          </section>

          <section className="lp-section" id="scenarios" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="lp-section-head" data-reveal>
              <span>SCENARIO LIBRARY</span>
              <h2>준비된 시장 환경으로 시작하거나, 직접 질문을 세우세요.</h2>
              <p>세 개의 기본 시나리오는 각각 다른 원인에서 출발합니다. 원하는 조건이 없다면 질문과 기간을 입력해 직접 만들 수 있습니다.</p>
            </div>
            <div className="scenario-grid" style={{ marginTop: 34 }} data-reveal>
              {scenarios.map((s, i) => (
                <ScenarioCard
                  key={s.id}
                  title={s.title}
                  tags={[s.duration, ...s.tags]}
                  forecast={s.forecast}
                  tone={s.tone}
                  active={i === 0}
                  icon={scenarioIcon[s.icon]}
                />
              ))}
              <Link className="custom-scenario-card" href="/insights#scenarios">
                <Plus size={24} />
                <div>
                  <strong>내 시나리오 예측하기</strong>
                  <p>원하는 시장 조건과 기간을 직접 선택하세요.</p>
                </div>
                <ArrowRight size={18} />
              </Link>
            </div>
          </section>

          <section className="lp-close">
            <div className="lp-close-card" data-reveal>
              <div>
                <h2>오늘의 조건부터 확인하세요.</h2>
                <p>2026.07.28 KRX 장마감 기준 데이터로 바로 시작할 수 있습니다.</p>
              </div>
              <div className="lp-close-actions">
                <Link className="lp-solid" href="/insights">
                  시장 인사이트 열기
                </Link>
                <Link className="lp-ghost" href="/twin">
                  마이 금융 트윈
                </Link>
              </div>
            </div>
            <p className="lp-footer">
              {DISCLAIMER} 모든 시나리오는 가상 시뮬레이션이며 실제 수익률을 보장하지 않습니다.
              <br />
              FINVERSE · AI DECISION LAB
            </p>
          </section>
        </div>
      </div>
    </Reveal>
  );
}
