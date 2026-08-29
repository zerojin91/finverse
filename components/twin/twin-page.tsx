"use client";

// 마이 금융 트윈.
//
//   1) 총 자산과 주식 비중을 정한다   (브라우저에만 저장)
//   2) 행동 6문항으로 트윈을 만든다   (행동 실험실 결과가 있으면 그쪽이 우선)
//   3) 실제 과거 충격에 넣어본다      (그대로 두기 vs 내 성향대로)
//
// 화면의 매도·재진입은 사용자가 실제로 한 매매가 아니다.  지금의 성향과 배분을
// 그 구간에 넣었을 때 규칙이 만들어낸 시점이므로 문구도 가정법으로 쓴다.
// 실제로 누른 기록은 행동 실험실에만 있다.
//
// 개별 종목은 묻지 않는다.  계좌를 연동하지 않는 이상 종목까지 알 수 없고,
// 매도 트리거를 정하는 건 결국 위험자산 비중 하나이기 때문이다.  국내주식은
// 코스피 지수 경로로 평가한다.
//
// 가격은 public/twin/shock-prices.json 의 실제 종가이고, 매매 판단은 결정적인
// 규칙이다.  화면에 나오는 수익률·낙폭·회복일은 모두 여기서 계산된 값이다.

import { ArrowRight, CheckCircle2, ChevronRight, Gamepad2, Gauge, LoaderCircle, Quote, RotateCcw, Route, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CASH,
  STOCK,
  formatSnapshotDate,
  effectivePanicThreshold,
  runBacktest,
  valuate,
  type BacktestResult,
  type BehaviorProfile,
  type PriceSnapshot,
} from "@/lib/twin/backtest";
import { projectForward, type ForwardResult } from "@/lib/twin/forward";
import { marketMood, type MarketMood } from "@/lib/twin/market-mood";
import { behaviorNote, mentorVerdicts, mostSevere, stanceLabels, type MentorInput, type MentorVerdict } from "@/lib/twin/mentor";
import { allocationHoldings, allocationPresets, buildReport, characterFor, deriveProfile, questions, type ObservedTraits } from "@/lib/twin/profile";

const STORAGE_KEY = "finverse.twin.v2";
type Saved = { total: number; stockWeight: number; answers: Record<string, string>; gameProfile?: BehaviorProfile; gameObserved?: ObservedTraits };

const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const korean = (value: number) => {
  const rounded = Math.round(value);
  const eok = Math.floor(rounded / 100_000_000);
  const man = Math.floor((rounded % 100_000_000) / 10_000);
  if (eok) return `${eok}억${man ? ` ${man.toLocaleString("ko-KR")}만` : ""}원`;
  return `${man.toLocaleString("ko-KR")}만원`;
};
const pct = (value: number, digits = 1) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
const tone = (value: number) => (value > 0 ? "up" : value < 0 ? "down" : "flat");

function TimeMachineChart({ result }: { result: BacktestResult }) {
  const { buyHold, twin, index, dates } = result;
  const all = [...buyHold, ...twin, ...index];
  const top = Math.max(...all);
  const bottom = Math.min(...all);
  const span = top - bottom || 1;
  const x = (position: number) => 46 + (position / (dates.length - 1)) * 654;
  const y = (value: number) => 20 + (1 - (value - bottom) / span) * 196;
  const line = (series: number[]) => series.map((value, position) => `${position ? "L" : "M"} ${x(position).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const yearMarks = dates.reduce<{ position: number; year: string }[]>((marks, date, position) => {
    const year = date.slice(0, 4);
    if (!marks.some((mark) => mark.year === year)) marks.push({ position, year });
    return marks;
  }, []);
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => bottom + span * ratio);

  return (
    <svg className="twin-time-chart" viewBox="0 0 720 250" role="img" aria-label={`${result.window.label} 버티기 경로와 트윈 경로 비교`}>
      {gridValues.map((value) => (
        <g key={value}>
          <line x1="46" y1={y(value)} x2="700" y2={y(value)} stroke="#ededf0" strokeWidth="1" />
          <text x="42" y={y(value) + 3} textAnchor="end" fill="#a1a1aa" fontSize="9">{`${value >= 100 ? "+" : ""}${(value - 100).toFixed(0)}%`}</text>
        </g>
      ))}
      <path d={line(index)} fill="none" stroke="#d4d4d8" strokeWidth="1.6" strokeDasharray="4 4" />
      <path d={line(buyHold)} fill="none" stroke="#111113" strokeWidth="2.4" strokeLinecap="round" />
      <path d={line(twin)} fill="none" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" />
      {result.events.map((event) => (
        <circle
          key={`${event.type}-${event.index}`}
          cx={x(event.index)}
          cy={y(twin[event.index])}
          r={event.type === "panic-sell" ? 4.5 : 3.6}
          fill={event.type === "panic-sell" ? "#ef4444" : event.type === "reentry" ? "#2563eb" : "#fff"}
          stroke={event.type === "panic-sell" ? "#ef4444" : "#2563eb"}
          strokeWidth="1.6"
        >
          <title>{`${formatSnapshotDate(event.date)} · ${event.detail}`}</title>
        </circle>
      ))}
      {yearMarks.map((mark) => <text key={mark.year} x={x(mark.position)} y="240" fill="#a1a1aa" fontSize="9">{mark.year}</text>)}
    </svg>
  );
}

const GAUGE_COLORS = ["#2563eb", "#60a5fa", "#d4d4d8", "#fca5a5", "#ef4444"];

function MoodGauge({ score }: { score: number }) {
  const center = { x: 120, y: 112 };
  const point = (angle: number, radius: number) => [
    (center.x + radius * Math.cos(angle)).toFixed(1),
    (center.y - radius * Math.sin(angle)).toFixed(1),
  ];
  // 왼쪽(공포)에서 오른쪽(탐욕)으로 가는 반원. 점수가 높을수록 각도가 작아진다.
  const angleFor = (value: number) => Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
  const arc = (from: number, to: number, radius: number) => {
    const [startX, startY] = point(angleFor(from), radius);
    const [endX, endY] = point(angleFor(to), radius);
    return `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`;
  };
  const [needleX, needleY] = point(angleFor(score), 74);

  return (
    <svg className="twin-gauge" viewBox="0 0 240 132" role="img" aria-label={`시장 온도 ${score}점`}>
      {GAUGE_COLORS.map((color, index) => (
        <path key={color} d={arc(index * 20, (index + 1) * 20, 92)} fill="none" stroke={color} strokeWidth="13" strokeLinecap="butt" />
      ))}
      <line x1={center.x} y1={center.y} x2={needleX} y2={needleY} stroke="#111113" strokeWidth="3" strokeLinecap="round" />
      <circle cx={center.x} cy={center.y} r="6" fill="#111113" />
      <text x="24" y="128" fill="#a1a1aa" fontSize="9">공포</text>
      <text x="216" y="128" textAnchor="end" fill="#a1a1aa" fontSize="9">탐욕</text>
    </svg>
  );
}

function MoodPanel({ mood, hasSellRule }: { mood: MarketMood; hasSellRule: boolean }) {
  const gap = Math.abs(mood.distance) * 100;
  return (
    <section className="panel twin-side-panel">
      <div className="panel-title"><div><span>MARKET MOOD</span><h2>지금 시장의 온도</h2></div><Gauge size={16} /></div>
      <div className="twin-side-body">
        <MoodGauge score={mood.score} />
        <p className="twin-mood-score"><strong>{mood.score}</strong><em>{mood.label}</em></p>
        <ul className="twin-mood-parts">
          {mood.components.map((component) => (
            <li key={component.key}>
              <span>{component.label}</span>
              <i><b style={{ width: `${component.score}%` }} /></i>
              <em>{component.detail}</em>
            </li>
          ))}
        </ul>
        <div className={`twin-trigger ${!hasSellRule ? "calm" : mood.triggered ? "hot" : ""}`}>
          <strong>
            {!hasSellRule
              ? "이 성향에는 매도 규칙이 없습니다"
              : mood.triggered
                ? "지금이라면 내 매도 기준이 이미 걸립니다"
                : `내 매도 기준까지 ${gap.toFixed(1)}%p`}
          </strong>
          <p>
            내 주식은 1년 고점 대비 <b>{pct(mood.drawdown)}</b>이고, 내 기준이 걸리는 지점은 <b>{pct(mood.trigger)}</b>입니다.
            {hasSellRule && !mood.triggered ? " 여기서 그만큼만 더 빠지면 같은 선택을 마주하게 됩니다." : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

function ForwardChart({ forward }: { forward: ForwardResult }) {
  const all = [...forward.hold, ...forward.mine];
  const top = Math.max(...all);
  const bottom = Math.min(...all);
  const span = (top - bottom) * 1.2 || 1;
  const middle = (top + bottom) / 2;
  const x = (index: number) => 40 + (index / (forward.hold.length - 1)) * 620;
  const y = (value: number) => 118 - ((value - (middle - span / 2)) / span) * 100;
  const line = (series: number[]) => series.map((value, index) => `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  return (
    <svg className="twin-forward-chart" viewBox="0 0 680 136" role="img" aria-label="시나리오 경로에서의 내 자산">
      {[18, 52, 86, 120].map((row) => <line key={row} x1="40" y1={row} x2="660" y2={row} stroke="#ededf0" strokeWidth="1" />)}
      <path d={line(forward.hold)} fill="none" stroke="#111113" strokeWidth="2.4" strokeLinecap="round" />
      <path d={line(forward.mine)} fill="none" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" />
      {forward.events.map((event) => (
        <circle
          key={`${event.type}-${event.index}`}
          cx={x(event.index)}
          cy={y(forward.mine[event.index])}
          r="4.5"
          fill={event.type === "sell" ? "#ef4444" : "#2563eb"}
          stroke={event.type === "sell" ? "#ef4444" : "#2563eb"}
          strokeWidth="1.6"
        ><title>{event.detail}</title></circle>
      ))}
      <text x="36" y="132" textAnchor="end" fill="#a1a1aa" fontSize="9">지금</text>
      <text x="660" y="132" textAnchor="end" fill="#a1a1aa" fontSize="9">종료</text>
    </svg>
  );
}

function ForwardPanel({ scenario, forward, total }: { scenario: AppliedScenario; forward: ForwardResult; total: number }) {
  return (
    <section className="panel twin-forward-panel">
      <div className="panel-title">
        <div><span>SCENARIO FORECAST · 시장 인사이트에서 가져옴</span><h2>이 시나리오대로라면</h2></div>
        <span className="twin-forward-tag"><Route size={14} /> {scenario.title} · {scenario.forecast} · {scenario.duration}</span>
      </div>
      <div className="twin-forward-body">
        <div className="twin-forward-stats">
          <div>
            <span>그대로 뒀다면</span>
            <strong className={tone(forward.holdReturn)}>{korean(total * (1 + forward.holdReturn))}</strong>
            <small className={tone(forward.holdReturn)}>{pct(forward.holdReturn)}</small>
          </div>
          <div className="mine">
            <span>내 성향대로라면</span>
            <strong className={tone(forward.myReturn)}>{korean(total * (1 + forward.myReturn))}</strong>
            <small className={tone(forward.myReturn)}>{pct(forward.myReturn)}</small>
          </div>
          <div>
            <span>내 행동이 만든 차이</span>
            <strong className={tone(forward.gap)}>{pct(forward.gap)}p</strong>
            <small>{won(forward.gap * total)}</small>
          </div>
          <div>
            <span>경로 최대 낙폭</span>
            <strong className={forward.worstDrawdown < 0 ? "down-text" : ""}>{forward.worstDrawdown < 0 ? pct(forward.worstDrawdown) : "없음"}</strong>
            <small>{forward.worstDrawdown < 0 ? "손대지 않았을 때 겪는 낙폭" : "이 경로에는 하락 구간이 없습니다"}</small>
          </div>
        </div>
        <ForwardChart forward={forward} />
        <div className="twin-chart-legend">
          <span><i className="hold" />그대로 두기</span><span><i className="twin" />내 성향대로</span><span><i className="sell" />매도·재진입 시점</span>
        </div>
        {forward.events.length > 0 ? (
          <ol className="twin-event-list">
            {forward.events.map((event) => (
              <li key={`${event.type}-${event.index}`} className={event.type === "sell" ? "panic-sell" : event.type === "reentry" ? "reentry" : ""}>
                <time>{event.index + 1}번째 구간</time>
                <span>{event.detail}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="twin-shock-note">이 경로에서는 내 기준에 닿는 지점이 없어 아무것도 하지 않습니다.</p>
        )}
        <p className="twin-forward-note">
          이 경로는 시장 인사이트가 제시한 <b>조건부 전제</b>이며 예측이 아닙니다. 표시된 매매는 실제 기록이 아니라 <b>지금 성향과 배분</b>으로 계산한 시점이고, 한 달짜리 구간이라 주 단위로 판단한다고 가정했습니다.
        </p>
      </div>
    </section>
  );
}

function MentorPanel({ verdicts, note, source, loading }: { verdicts: MentorVerdict[]; note: string; source: string; loading: boolean }) {
  const worst = verdicts.length ? mostSevere(verdicts) : null;
  return (
    <section className="panel twin-side-panel">
      <div className="panel-title">
        <div><span>MENTOR REVIEW</span><h2>네 사람이 서로 다른 곳을 봅니다</h2></div>
        {loading ? <LoaderCircle size={15} className="spin" /> : <Quote size={16} />}
      </div>
      <div className="twin-side-body">
        {worst && worst.stance !== "ok" && (
          <p className={`twin-mentor-worst ${worst.stance}`}>
            <span>가장 크게 걸리는 지점</span>
            <strong>{worst.name} · {worst.question}</strong>
          </p>
        )}
        <div className="twin-mentor-list">
          {verdicts.map((verdict) => (
            <article key={verdict.key} className={worst && verdict.key === worst.key && verdict.stance !== "ok" ? "worst" : ""}>
              <header>
                <div><strong>{verdict.name}</strong><small>{verdict.question}</small></div>
                <span className={`twin-stance ${verdict.stance}`}>{stanceLabels[verdict.stance]}</span>
              </header>
              <h3>{verdict.headline}</h3>
              <p>{verdict.body}</p>
              <p className="twin-mentor-check"><CheckCircle2 size={13} /> {verdict.check}</p>
            </article>
          ))}
        </div>
        <p className="twin-side-note">{note}</p>
        <p className="twin-side-note">
          공개된 투자 원칙과 연구를 이 상황에 적용한 해석이며 본인의 발언이 아닙니다. 입장은 주식 비중·현금 여력·매매 빈도·시장 온도·백테스트 결과로 계산합니다{source === "openrouter" ? "(문장만 AI가 다시 씀)" : "(모델 미연결 · 규칙 기반 문장)"}.
        </p>
      </div>
    </section>
  );
}

function SetupWizard({ initial, skipBehavior, onDone, onGoToLab }: {
  initial: Saved | null;
  skipBehavior: boolean;
  onDone: (saved: Saved) => void;
  onGoToLab: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [total, setTotal] = useState(initial?.total ?? 100_000_000);
  const [stockWeight, setStockWeight] = useState(initial?.stockWeight ?? 0.6);
  const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers ?? {});
  const answered = questions.filter((question) => answers[question.id]).length;
  const finish = () => onDone({ total, stockWeight, answers, ...(initial?.gameProfile ? { gameProfile: initial.gameProfile } : {}) });

  return (
    <section className="panel twin-setup">
      <div className="panel-title">
        <div>
          <span>{step === 1 ? "STEP 01 · MY MONEY" : "STEP 02 · MY BEHAVIOR"}</span>
          <h2>{step === 1 ? "지금 자산이 얼마이고, 그중 주식은 얼마인가요?" : "그 상황에서 실제로 무엇을 하나요?"}</h2>
        </div>
        <span className="twin-setup-step">{step} / {skipBehavior ? 1 : 2}</span>
      </div>

      {step === 1 ? (
        <div className="twin-setup-body">
          <p className="twin-setup-lead">
            개별 종목은 묻지 않습니다. 충격이 왔을 때 무슨 일이 벌어질지는 <b>주식과 현금의 비율</b>이 정합니다.
            입력한 값은 이 브라우저에만 저장되고 서버로 전송되지 않습니다.
          </p>

          <label className="twin-total-input">
            <span>지금 굴리고 있는 총 자산</span>
            <div>
              <input
                type="number"
                min={0}
                step={100}
                value={total / 10_000}
                onChange={(event) => setTotal(Math.max(0, Number(event.target.value) || 0) * 10_000)}
              />
              <em>만원</em>
            </div>
          </label>

          <div className="twin-demo-row">
            {allocationPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={Math.abs(stockWeight - preset.stockWeight) < 0.001 ? "active" : ""}
                onClick={() => setStockWeight(preset.stockWeight)}
              >
                <strong>{preset.name} · 주식 {(preset.stockWeight * 100).toFixed(0)}%</strong>
                <small>{preset.detail}</small>
              </button>
            ))}
          </div>

          <div className="twin-slider">
            <div className="twin-slider-head">
              <span>주식 비중</span>
              <strong>{(stockWeight * 100).toFixed(0)}<em>%</em></strong>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(stockWeight * 100)}
              onChange={(event) => setStockWeight(Number(event.target.value) / 100)}
              aria-label="주식 비중"
            />
            <div className="twin-slider-split">
              <div className="stock" style={{ width: `${stockWeight * 100}%` }}><span>국내주식 {korean(total * stockWeight)}</span></div>
              <div className="cash"><span>현금 {korean(total * (1 - stockWeight))}</span></div>
            </div>
          </div>

          <div className="twin-setup-footer">
            <span>국내주식은 코스피 지수 경로로 평가합니다.</span>
            {skipBehavior ? (
              <button type="button" disabled={total <= 0} onClick={finish}>트윈 만들기 <ArrowRight size={15} /></button>
            ) : (
              <button type="button" disabled={total <= 0} onClick={() => setStep(2)}>다음 <ArrowRight size={15} /></button>
            )}
          </div>
        </div>
      ) : (
        <div className="twin-setup-body">
          <p className="twin-setup-lead">
            정답이 없는 질문입니다. 아는 것이 아니라 <b>실제로 하는 행동</b>을 고르세요. 이 답이 그대로 내 매매 규칙이 됩니다.
          </p>
          <button className="twin-lab-link" type="button" onClick={onGoToLab}>
            <Gamepad2 size={15} /> 말로 답하는 대신 <b>행동 실험실</b>에서 직접 플레이해 찾을 수도 있습니다 <ChevronRight size={14} />
          </button>
          <div className="twin-question-list">
            {questions.map((question, order) => (
              <fieldset key={question.id}>
                <legend><span>Q{order + 1}</span><strong>{question.prompt}</strong><em>{question.hint}</em></legend>
                <div className="twin-option-row">
                  {question.options.map((option) => (
                    <button key={option.id} type="button" className={answers[question.id] === option.id ? "active" : ""} onClick={() => setAnswers((previous) => ({ ...previous, [question.id]: option.id }))}>
                      <strong>{option.label}</strong><small>{option.detail}</small>
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="twin-setup-footer">
            <button className="twin-ghost-button" type="button" onClick={() => setStep(1)}>이전</button>
            <span>{answered} / {questions.length} 문항 응답</span>
            <button type="button" disabled={answered < questions.length} onClick={finish}>트윈 만들기 <ArrowRight size={15} /></button>
          </div>
        </div>
      )}
    </section>
  );
}

type AppliedScenario = { title: string; forecast: string; duration: string; path: number[] };

export default function TwinPage({ appliedScenario, onOpenBuilder, onGoToLab }: {
  appliedScenario?: AppliedScenario | null;
  onOpenBuilder: () => void;
  onGoToLab: () => void;
}) {
  const [snapshot, setSnapshot] = useState<PriceSnapshot | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [windowId, setWindowId] = useState("covid-2020");
  const [editing, setEditing] = useState(false);
  const [mentor, setMentor] = useState<{ key: string; verdicts: MentorVerdict[]; note: string; source: string }>({ key: "", verdicts: [], note: "", source: "rules" });

  useEffect(() => {
    let active = true;
    const load = async () => {
      let stored: Saved | null = null;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) stored = JSON.parse(raw) as Saved;
      } catch { /* 저장값이 깨졌으면 새로 만든다 */ }
      let prices: PriceSnapshot | null = null;
      try {
        const response = await fetch("/twin/shock-prices.json", { cache: "force-cache" });
        if (response.ok) prices = await response.json() as PriceSnapshot;
      } catch { /* 스냅샷이 없으면 안내 화면을 보여준다 */ }
      if (!active) return;
      setSaved(stored);
      setSnapshot(prices);
      setLoaded(true);
    };
    void load();
    return () => { active = false; };
  }, []);

  const persist = useCallback((next: Saved) => {
    setSaved(next);
    setEditing(false);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 시크릿 모드 등 */ }
  }, []);

  // 행동 실험실에서 관측한 프로필이 있으면 설문보다 우선한다.  말한 것보다 한 것이
  // 실제 판단에 가깝기 때문이다.
  const profile: BehaviorProfile | null = useMemo(
    () => (saved ? saved.gameProfile ?? deriveProfile(saved.answers) : null),
    [saved],
  );
  const holdings = useMemo(() => (saved ? allocationHoldings(saved.total, saved.stockWeight) : []), [saved]);
  const valuation = useMemo(() => (snapshot && holdings.length ? valuate(snapshot, holdings) : null), [snapshot, holdings]);
  const result = useMemo(
    () => (snapshot && holdings.length && profile ? runBacktest(snapshot, windowId, holdings, profile) : null),
    [snapshot, holdings, profile, windowId],
  );
  const report = useMemo(() => (result && profile ? buildReport(result, profile) : []), [result, profile]);
  // 설문은 여섯 문항을 다 받으므로 전부 관측이고, 실험실 프로필은 플레이한 만큼만이다.
  const character = useMemo(
    () => (profile ? characterFor(profile, saved?.gameProfile ? saved.gameObserved ?? {} : undefined) : null),
    [profile, saved],
  );
  const mood = useMemo(
    () => (snapshot && holdings.length && profile ? marketMood(snapshot, holdings, profile) : null),
    [snapshot, holdings, profile],
  );
  const forward = useMemo(
    () => (appliedScenario && saved && profile ? projectForward(appliedScenario.path, saved.stockWeight, profile) : null),
    [appliedScenario, saved, profile],
  );
  const mentorInput = useMemo<MentorInput | null>(() => {
    if (!saved || !mood || !result || !character || !profile) return null;
    const sells = result.events.filter((event) => event.type === "panic-sell");
    return {
      stockWeight: saved.stockWeight,
      cashWeight: 1 - saved.stockWeight,
      moodScore: mood.score,
      moodLabel: mood.label,
      drawdown: mood.drawdown,
      windowLabel: result.window.label,
      buyHoldReturn: result.buyHoldReturn,
      behaviorGap: result.behaviorGap,
      tradeCount: result.events.length,
      soldCount: sells.length,
      reentered: result.events.some((event) => event.type === "reentry"),
      character: character.name,
      panicThreshold: effectivePanicThreshold(profile),
      reentryDelay: profile.reentryDelay,
      ...(appliedScenario && forward
        ? {
            scenario: {
              title: appliedScenario.title,
              forecast: appliedScenario.forecast,
              holdReturn: forward.holdReturn,
              myReturn: forward.myReturn,
              sold: forward.events.some((event) => event.type === "sell"),
            },
          }
        : {}),
    };
  }, [saved, mood, result, character, profile, appliedScenario, forward]);
  const mentorKey = mentorInput ? JSON.stringify(mentorInput) : "";

  useEffect(() => {
    if (!mentorKey) return;
    const input = JSON.parse(mentorKey) as MentorInput;
    let active = true;
    const load = async () => {
      // 모델이 없거나 실패해도 규칙 기반 문장으로 화면을 채운다.
      let next = { verdicts: mentorVerdicts(input), note: behaviorNote(input), source: "rules" };
      try {
        const response = await fetch("/api/twin/mentor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: mentorKey,
        });
        if (response.ok) {
          const payload = await response.json() as { verdicts?: MentorVerdict[]; note?: string; source?: string };
          if (payload.verdicts?.length) next = { verdicts: payload.verdicts, note: payload.note ?? next.note, source: payload.source ?? "rules" };
        }
      } catch { /* 오프라인이면 규칙 기반 문장을 그대로 쓴다 */ }
      if (!active) return;
      setMentor({ key: mentorKey, ...next });
    };
    void load();
    return () => { active = false; };
  }, [mentorKey]);

  const mentorReady = mentor.key === mentorKey && mentor.verdicts.length > 0;
  const shownVerdicts = mentorReady ? mentor.verdicts : mentorInput ? mentorVerdicts(mentorInput) : [];
  const shownNote = mentorReady ? mentor.note : mentorInput ? behaviorNote(mentorInput) : "";
  const shocks = useMemo(() => Object.values(snapshot?.windows ?? {}), [snapshot]);

  if (!loaded || !snapshot) {
    return (
      <div className="twin-page">
        <div className="twin-loading">
          <LoaderCircle size={22} className={snapshot ? "" : "spin"} />
          <p>{loaded && !snapshot ? "가격 스냅샷을 불러오지 못했습니다. scripts/twin_price_snapshot.mjs 를 실행해주세요." : "실제 가격 스냅샷을 불러오는 중입니다."}</p>
        </div>
      </div>
    );
  }

  const heading = (
    <header className="page-heading twin-heading">
      <div>
        <span>MY FINANCIAL TWIN</span>
        <h1>{saved ? "같은 시장, 다른 결과. 차이를 만든 건 내 행동입니다." : "내 자산과 내 행동으로 트윈을 만듭니다."}</h1>
      </div>
      <div className="twin-heading-actions">
        <span className="market-stamp"><Wallet size={15} />{formatSnapshotDate(snapshot.windows.recent.dates.at(-1) ?? "")} 종가 기준</span>
        {saved && !editing && <button className="twin-ghost-button" type="button" onClick={() => setEditing(true)}><RotateCcw size={14} /> 다시 설정</button>}
      </div>
    </header>
  );

  if (!saved || saved.total <= 0 || editing) {
    return (
      <div className="twin-page">
        {heading}
        <SetupWizard
          initial={saved}
          skipBehavior={Boolean(saved?.gameProfile)}
          onDone={persist}
          onGoToLab={onGoToLab}
        />
      </div>
    );
  }

  return (
    <div className="twin-page">
      {heading}

      <section className="panel twin-assets-panel">
        <div className="panel-title">
          <h2>나의 자산 현황</h2>
          {character && <span className={`twin-character-chip ${character.provisional ? "provisional" : ""}`}><UserRound size={13} /> {character.name}</span>}
        </div>
        <div className="twin-assets-grid">
          <div className="twin-metric">
            <span>총 자산</span>
            <strong>{korean(saved.total)}</strong>
            <small>전일 대비 <b className={tone(valuation?.dayChange ?? 0)}>{won(valuation?.dayChange ?? 0)} ({pct(valuation?.dayChangePct ?? 0, 2)})</b></small>
          </div>
          <div className="twin-metric">
            <span>주식 비중</span>
            <strong>{(saved.stockWeight * 100).toFixed(0)}<em>%</em></strong>
            <div className="twin-progress"><i style={{ width: `${saved.stockWeight * 100}%` }} /></div>
            <small>{korean(saved.total * saved.stockWeight)}</small>
          </div>
          <div className="twin-metric">
            <span>현금 비중</span>
            <strong>{((1 - saved.stockWeight) * 100).toFixed(0)}<em>%</em></strong>
            <small>충격이 왔을 때 쓸 수 있는 여력 {korean(saved.total * (1 - saved.stockWeight))}</small>
          </div>
          <div className="twin-net-chart">
            <div><span>내 행동이 만든 차이 · {result?.window.label}</span><strong className={tone(result?.behaviorGap ?? 0)}>{pct(result?.behaviorGap ?? 0)}p</strong></div>
            <p className="twin-gap-copy">
              같은 자산을 그대로 뒀다면 <b>{pct(result?.buyHoldReturn ?? 0)}</b>, 내 성향대로라면 <b className={tone(result?.twinReturn ?? 0)}>{pct(result?.twinReturn ?? 0)}</b>입니다.
            </p>
            <p className="twin-gap-amount">{won((result?.behaviorGap ?? 0) * saved.total)}<em>지금 자산 기준</em></p>
          </div>
        </div>
      </section>

      {appliedScenario && forward && <ForwardPanel scenario={appliedScenario} forward={forward} total={saved.total} />}

      <section className="twin-main-grid">
        <div className="twin-report-column">
          <section className="panel twin-portfolio-panel">
            <div className="panel-title"><h2>보유 현황</h2><span className="twin-path-caption">최근 종가 기준</span></div>
            <div className="twin-table-wrap">
              <table className="twin-table">
                <thead><tr><th>자산</th><th>금액</th><th>비중</th><th>등락률(1D)</th><th>기여도(1D)</th></tr></thead>
                <tbody>
                  {(valuation?.rows ?? []).map((row) => (
                    <tr key={row.symbol}>
                      <td>
                        <div className="twin-holding-name">
                          <span className={`twin-holding-symbol ${row.symbol === CASH ? "flat" : tone(row.changePct)}`}>{row.symbol === STOCK ? "주" : "현"}</span>
                          <div><strong>{row.name}</strong><small>{row.sector}</small></div>
                        </div>
                      </td>
                      <td>{korean(row.amount)}</td>
                      <td>{(row.weight * 100).toFixed(0)}%</td>
                      <td className={tone(row.changePct)}>{pct(row.changePct, 2)}</td>
                      <td className={tone(row.contribution)}>{won(row.contribution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="twin-table-note">
              * 개별 종목 대신 국내주식 전체를 코스피 지수 경로로 평가합니다. 가격 출처는 {snapshot.source}이며 기준일은 {formatSnapshotDate(snapshot.windows.recent.dates.at(-1) ?? "")}입니다.
            </p>
          </section>
          {mood && <MoodPanel mood={mood} hasSellRule={(profile?.panicAction ?? 0) > 0} />}
        </div>

        <section className="panel twin-path-panel">
          <div className="panel-title">
            <div><span>TIME MACHINE</span><h2>이 배분을 그때로 보내면</h2></div>
            <span className="twin-path-caption">실제 종가로 계산</span>
          </div>
          <div className="twin-shock-row">
            {shocks.map((shock) => (
              <button key={shock.id} type="button" className={windowId === shock.id ? "active" : ""} onClick={() => setWindowId(shock.id)}>
                <strong>{shock.label}</strong><small>{shock.period}</small>
              </button>
            ))}
          </div>
          {result ? (
            <>
              <div className="twin-shock-summary">
                <div><span>그대로 두기</span><strong className={tone(result.buyHoldReturn)}>{pct(result.buyHoldReturn)}</strong></div>
                <div><span>내 성향대로</span><strong className={tone(result.twinReturn)}>{pct(result.twinReturn)}</strong></div>
                <div><span>최대 낙폭</span><strong className="down-text">{pct(result.maxDrawdown)}</strong></div>
                <div><span>고점 회복</span><strong>{result.recoveryDays === null ? "구간 내 미회복" : `${result.recoveryDays}거래일`}</strong></div>
              </div>
              <TimeMachineChart result={result} />
              <div className="twin-chart-legend">
                <span><i className="hold" />그대로 두기</span><span><i className="twin" />내 성향대로</span><span><i className="index" />코스피</span>
                <span><i className="sell" />매도·재진입 시점</span>
              </div>
              <p className="twin-shock-note">{result.window.summary} 아래 매매는 실제 기록이 아니라 <b>지금 성향과 배분</b>을 이 구간에 넣었을 때 나오는 시점입니다. 한 달에 한 번 판단하고, 한 번 팔면 최소 3개월은 다시 팔지 않는다고 가정합니다.</p>
              {result.events.length > 0 && (
                <ol className="twin-event-list">
                  {result.events.map((event) => (
                    <li key={`${event.type}-${event.index}`} className={event.type}>
                      <time>{formatSnapshotDate(event.date)}</time>
                      <span>{event.detail}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : <div className="twin-loading"><p>이 구간을 계산할 수 없습니다.</p></div>}
        </section>
      </section>

      <div className="twin-lower-grid">
        <section className="panel twin-experts-panel">
          <div className="panel-title">
            <div><span>BEHAVIOR REPORT</span><h2>내 성향이 이 구간에서 할 선택</h2></div>
            <span>{result?.window.label} 구간에 지금 성향과 배분을 넣은 결과</span>
          </div>
          {character && (
            <div className="twin-character-card">
              <div className="twin-expert-avatar">{character.name.slice(0, 2)}</div>
              <div><span>내 트윈 유형</span><h3>{character.name}</h3><p>{character.tagline}</p><p className="twin-character-watch"><ShieldCheck size={13} /> {character.watch}</p></div>
            </div>
          )}
          <div className="twin-bias-grid">
            {report.map((card) => (
              <article key={card.bias} className={card.tone}>
                <span>{card.bias}</span>
                <h3>{card.headline}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
          <div className="twin-next-row">
            <button className="twin-text-button" type="button" onClick={onOpenBuilder}>내 시나리오로 앞으로의 구간도 만들어보기 <ChevronRight size={15} /></button>
          </div>
          <div className="twin-disclaimer">
            과거 실제 종가에 지금의 성향과 배분을 넣어 계산한 교육용 결과이며, 실제 매매 기록이 아닙니다. 미래 수익을 예측하지 않으며 특정 종목의 매매를 권유하지 않습니다.
          </div>
        </section>

        {shownVerdicts.length > 0 && <MentorPanel verdicts={shownVerdicts} note={shownNote} source={mentor.source} loading={!mentorReady} />}
      </div>
    </div>
  );
}
