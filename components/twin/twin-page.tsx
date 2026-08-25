"use client";

// 마이 금융 트윈.
//
//   1) 내 포트폴리오를 담는다        (브라우저에만 저장)
//   2) 행동 6문항으로 트윈을 만든다  (매매 규칙으로 변환)
//   3) 실제 과거 충격에 넣어본다     (버티기 경로 vs 트윈 경로)
//
// 가격은 public/twin/shock-prices.json 의 실제 종가이고, 매매 판단은 결정적인
// 규칙이다.  화면에 나오는 수익률·낙폭·회복일은 모두 여기서 계산된 값이다.

import { ArrowRight, ChevronRight, Gauge, LoaderCircle, Quote, RotateCcw, ShieldCheck, Target, TrendingDown, UserRound, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CASH,
  formatSnapshotDate,
  runBacktest,
  valuate,
  type BacktestResult,
  type BehaviorProfile,
  type Holding,
  type PriceSnapshot,
} from "@/lib/twin/backtest";
import { simulateGoal, type Goal, type GoalResult } from "@/lib/twin/goal";
import { marketMood, type MarketMood } from "@/lib/twin/market-mood";
import { behaviorNote, harshest, mentorVerdicts, type MentorInput, type MentorVerdict } from "@/lib/twin/mentor";
import { buildReport, characterFor, demoPortfolios, deriveProfile, questions } from "@/lib/twin/profile";

const STORAGE_KEY = "finverse.twin.v1";
type Saved = { holdings: Holding[]; answers: Record<string, string>; goal?: Goal };

const defaultGoal: Goal = { amount: 1_000_000_000, years: 10, monthly: 1_000_000 };

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
          r={event.type === "panic-sell" ? 4 : 3.2}
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

function SetupWizard({ snapshot, onDone }: { snapshot: PriceSnapshot; onDone: (saved: Saved) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const holdings = Object.entries(amounts).filter(([, amount]) => amount > 0).map(([symbol, amount]) => ({ symbol, amount }));
  const total = holdings.reduce((sum, holding) => sum + holding.amount, 0);
  const answered = questions.filter((question) => answers[question.id]).length;

  return (
    <section className="panel twin-setup">
      <div className="panel-title">
        <div><span>{step === 1 ? "STEP 01 · MY PORTFOLIO" : "STEP 02 · MY BEHAVIOR"}</span><h2>{step === 1 ? "무엇을 얼마나 가지고 있나요?" : "그 상황에서 실제로 무엇을 하나요?"}</h2></div>
        <span className="twin-setup-step">{step} / 2</span>
      </div>

      {step === 1 ? (
        <div className="twin-setup-body">
          <p className="twin-setup-lead">입력한 내용은 이 브라우저에만 저장되고 서버로 전송되지 않습니다. 실제 계좌를 연결하지 않아도 됩니다.</p>
          <div className="twin-demo-row">
            {demoPortfolios.map((demo) => (
              <button key={demo.id} type="button" onClick={() => setAmounts(Object.fromEntries(demo.holdings.map((holding) => [holding.symbol, holding.amount])))}>
                <strong>{demo.name}</strong><small>{demo.detail}</small>
              </button>
            ))}
          </div>
          <div className="twin-asset-grid">
            {[...snapshot.assets, { symbol: CASH, name: "현금", kind: "cash", sector: "유동성" }].map((asset) => (
              <label key={asset.symbol} className={amounts[asset.symbol] ? "active" : ""}>
                <span><strong>{asset.name}</strong><small>{asset.symbol === CASH ? "예금·파킹" : `${asset.symbol} · ${asset.sector}`}</small></span>
                <span className="twin-amount-input">
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={amounts[asset.symbol] ? amounts[asset.symbol] / 10_000 : ""}
                    onChange={(event) => setAmounts((previous) => ({ ...previous, [asset.symbol]: Math.max(0, Number(event.target.value) || 0) * 10_000 }))}
                    placeholder="0"
                  />
                  <em>만원</em>
                </span>
              </label>
            ))}
          </div>
          <div className="twin-setup-footer">
            <span>{holdings.length ? `${holdings.length}개 자산 · 합계 ${korean(total)}` : "담을 자산을 고르거나 예시 구성을 눌러보세요"}</span>
            <button type="button" disabled={total <= 0} onClick={() => setStep(2)}>다음 <ArrowRight size={15} /></button>
          </div>
        </div>
      ) : (
        <div className="twin-setup-body">
          <p className="twin-setup-lead">정답이 없는 질문입니다. 아는 것이 아니라 <b>실제로 하는 행동</b>을 고르세요. 이 답이 그대로 트윈의 매매 규칙이 됩니다.</p>
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
            <button type="button" disabled={answered < questions.length} onClick={() => onDone({ holdings, answers })}>트윈 만들기 <ArrowRight size={15} /></button>
          </div>
        </div>
      )}
    </section>
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
                ? "당신의 트윈은 이미 매도 버튼을 눌렀습니다"
                : `트윈의 매도 버튼까지 ${gap.toFixed(1)}%p`}
          </strong>
          <p>
            내 포트폴리오는 1년 고점 대비 <b>{pct(mood.drawdown)}</b>이고, 트윈이 실제로 파는 지점은 <b>{pct(mood.trigger)}</b>입니다.
            {hasSellRule && !mood.triggered ? " 여기서 그만큼만 더 빠지면 같은 선택이 반복됩니다." : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

function GoalPanel({ goal, onChange, result }: { goal: Goal; onChange: (goal: Goal) => void; result: GoalResult | null }) {
  const holdRate = result ? result.hold.successRate : 0;
  const twinRate = result ? result.twin.successRate : 0;
  const shift = (twinRate - holdRate) * 100;
  const upsideCut = result ? result.twin.high - result.hold.high : 0;

  return (
    <section className="panel twin-side-panel">
      <div className="panel-title"><div><span>GOAL SIMULATION</span><h2>1,000번의 미래</h2></div><Target size={16} /></div>
      <div className="twin-side-body">
        <div className="twin-goal-inputs">
          <label><span>목표 금액</span><input type="number" min={0} step={0.5} value={goal.amount / 100_000_000} onChange={(event) => onChange({ ...goal, amount: Math.max(0, Number(event.target.value) || 0) * 100_000_000 })} /><em>억원</em></label>
          <label><span>기간</span><input type="number" min={1} max={40} step={1} value={goal.years} onChange={(event) => onChange({ ...goal, years: Math.max(1, Math.min(40, Number(event.target.value) || 1)) })} /><em>년</em></label>
          <label><span>월 저축</span><input type="number" min={0} step={10} value={goal.monthly / 10_000} onChange={(event) => onChange({ ...goal, monthly: Math.max(0, Number(event.target.value) || 0) * 10_000 })} /><em>만원</em></label>
        </div>
        {result ? (
          <>
            <div className="twin-goal-bars">
              <div>
                <span>끝까지 버텼다면</span>
                <i><b style={{ width: `${holdRate * 100}%` }} /></i>
                <strong>{(holdRate * 100).toFixed(0)}<em>%</em></strong>
              </div>
              <div className="twin">
                <span>내 트윈의 행동으로는</span>
                <i><b style={{ width: `${twinRate * 100}%` }} /></i>
                <strong>{(twinRate * 100).toFixed(0)}<em>%</em></strong>
              </div>
            </div>
            <p className="twin-goal-copy">
              같은 1,000개의 미래에서 당신의 규칙은 달성 확률을 <b>{shift >= 0 ? "+" : ""}{shift.toFixed(0)}%p</b> 바꿉니다.
              {upsideCut < 0
                ? ` 대신 잘 풀린 경우의 상단이 ${korean(result.hold.high)}에서 ${korean(result.twin.high)}으로 잘립니다.`
                : " 상단도 함께 커졌습니다."}
            </p>
            <ul className="twin-goal-detail">
              <li><span>버티기 중앙값</span><strong>{korean(result.hold.median)}</strong><em>{korean(result.hold.low)} ~ {korean(result.hold.high)}</em></li>
              <li><span>트윈 중앙값</span><strong>{korean(result.twin.median)}</strong><em>{korean(result.twin.low)} ~ {korean(result.twin.high)}</em></li>
            </ul>
            <p className="twin-side-note">{result.months}개월 × {result.paths.toLocaleString("ko-KR")}회. 이 포트폴리오가 실제로 겪은 {result.sampleMonths}개월의 수익률을 3개월 단위로 다시 뽑아 이었습니다. 수익률 전망이 아니라 과거의 재배열입니다.</p>
          </>
        ) : <p className="twin-side-note">목표 금액과 기간을 입력하면 계산합니다.</p>}
      </div>
    </section>
  );
}

function MentorPanel({ verdicts, note, source, loading }: { verdicts: MentorVerdict[]; note: string; source: string; loading: boolean }) {
  const worst = verdicts.length ? harshest(verdicts) : null;
  return (
    <section className="panel twin-side-panel">
      <div className="panel-title">
        <div><span>MENTOR REVIEW</span><h2>세 사람의 다른 채점표</h2></div>
        {loading ? <LoaderCircle size={15} className="spin" /> : <Quote size={16} />}
      </div>
      <div className="twin-side-body">
        {worst && <p className="twin-mentor-worst"><span>가장 낮은 점수</span><strong>{worst.name} {worst.score}점</strong></p>}
        <div className="twin-mentor-list">
          {verdicts.map((verdict) => (
            <article key={verdict.key} className={worst && verdict.key === worst.key ? "worst" : ""}>
              <header>
                <div><strong>{verdict.name}</strong><small>{verdict.principle}</small></div>
                <span className="twin-mentor-score">{verdict.score}</span>
              </header>
              <h3>{verdict.headline}</h3>
              <p>{verdict.body}</p>
            </article>
          ))}
        </div>
        <p className="twin-side-note">{note}</p>
        <p className="twin-side-note">
          공개된 투자 원칙을 이 포트폴리오에 적용한 해석이며 본인의 발언이 아닙니다. 점수는 집중도·현금·업종 수·시장 온도로 계산합니다{source === "openrouter" ? "(문장만 AI가 다시 씀)" : "(모델 미연결 · 규칙 기반 문장)"}.
        </p>
      </div>
    </section>
  );
}

export default function TwinPage({ appliedScenario, onOpenBuilder }: { appliedScenario?: { title: string; forecast: string } | null; onOpenBuilder: () => void }) {
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

  const profile: BehaviorProfile | null = useMemo(() => (saved ? deriveProfile(saved.answers) : null), [saved]);
  const valuation = useMemo(() => (snapshot && saved ? valuate(snapshot, saved.holdings) : null), [snapshot, saved]);
  const result = useMemo(
    () => (snapshot && saved && profile ? runBacktest(snapshot, windowId, saved.holdings, profile) : null),
    [snapshot, saved, profile, windowId],
  );
  const report = useMemo(() => (result && profile ? buildReport(result, profile) : []), [result, profile]);
  const character = useMemo(() => (profile ? characterFor(profile) : null), [profile]);
  const goal = saved?.goal ?? defaultGoal;
  const mood = useMemo(
    () => (snapshot && saved && profile ? marketMood(snapshot, saved.holdings, profile) : null),
    [snapshot, saved, profile],
  );
  const goalResult = useMemo(
    () => (snapshot && saved && profile && valuation ? simulateGoal(snapshot, saved.holdings, profile, goal, valuation.total) : null),
    [snapshot, saved, profile, goal, valuation],
  );
  const mentorInput = useMemo<MentorInput | null>(() => {
    if (!valuation || !mood || !result || !character) return null;
    const top = valuation.rows.reduce((widest, row) => (row.weight > widest.weight ? row : widest), valuation.rows[0]);
    return {
      cashWeight: valuation.cashWeight,
      topWeight: top.weight,
      topName: top.name,
      herfindahl: valuation.rows.reduce((sum, row) => sum + row.weight * row.weight, 0),
      assetCount: valuation.rows.length,
      sectorCount: new Set(valuation.rows.map((row) => row.sector)).size,
      moodScore: mood.score,
      moodLabel: mood.label,
      drawdown: mood.drawdown,
      behaviorGap: result.behaviorGap,
      windowLabel: result.window.label,
      tradeCount: result.events.length,
      character: character.name,
    };
  }, [valuation, mood, result, character]);
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
        <div className="twin-loading"><LoaderCircle size={22} className={snapshot ? "" : "spin"} /><p>{loaded && !snapshot ? "가격 스냅샷을 불러오지 못했습니다. scripts/twin_price_snapshot.mjs 를 실행해주세요." : "실제 가격 스냅샷을 불러오는 중입니다."}</p></div>
      </div>
    );
  }

  const heading = (
    <header className="page-heading twin-heading">
      <div>
        <span>MY FINANCIAL TWIN</span>
        <h1>{saved ? "같은 시장, 다른 결과. 차이를 만든 건 내 행동입니다." : "내 포트폴리오와 내 행동으로 트윈을 만듭니다."}</h1>
      </div>
      <div className="twin-heading-actions">
        <span className="market-stamp"><Wallet size={15} />{formatSnapshotDate(snapshot.windows.recent.dates.at(-1) ?? "")} 종가 기준</span>
        {saved && !editing && <button className="twin-ghost-button" type="button" onClick={() => setEditing(true)}><RotateCcw size={14} /> 다시 설정</button>}
      </div>
    </header>
  );

  if (!saved || editing) {
    return <div className="twin-page">{heading}<SetupWizard snapshot={snapshot} onDone={persist} /></div>;
  }

  return (
    <div className="twin-page">
      {heading}

      <section className="panel twin-assets-panel">
        <div className="panel-title">
          <h2>나의 자산 현황</h2>
          {character && <span className="twin-character-chip"><UserRound size={13} /> {character.name}</span>}
        </div>
        <div className="twin-assets-grid">
          <div className="twin-metric">
            <span>총 평가금액</span>
            <strong>{korean(valuation?.total ?? 0)}</strong>
            <small>전일 대비 <b className={tone(valuation?.dayChange ?? 0)}>{won(valuation?.dayChange ?? 0)} ({pct(valuation?.dayChangePct ?? 0, 2)})</b></small>
          </div>
          <div className="twin-metric">
            <span>현금 비중</span>
            <strong>{((valuation?.cashWeight ?? 0) * 100).toFixed(1)}<em>%</em></strong>
            <small>충격이 왔을 때 쓸 수 있는 여력</small>
          </div>
          <div className="twin-metric">
            <span>최대 종목 집중도</span>
            <strong>{(Math.max(...(valuation?.rows ?? [{ weight: 0 }]).map((row) => row.weight)) * 100).toFixed(1)}<em>%</em></strong>
            <div className="twin-progress"><i style={{ width: `${Math.max(...(valuation?.rows ?? [{ weight: 0 }]).map((row) => row.weight)) * 100}%` }} /></div>
            <small>한 종목에 실린 비중이 클수록 낙폭이 커집니다</small>
          </div>
          <div className="twin-net-chart">
            <div><span>내 행동이 만든 차이 · {result?.window.label}</span><strong className={tone(result?.behaviorGap ?? 0)}>{pct(result?.behaviorGap ?? 0)}p</strong></div>
            <p className="twin-gap-copy">
              같은 자산을 버텼다면 <b>{pct(result?.buyHoldReturn ?? 0)}</b>, 당신의 트윈은 <b className={tone(result?.twinReturn ?? 0)}>{pct(result?.twinReturn ?? 0)}</b>였습니다.
            </p>
            <p className="twin-gap-amount">{won((result?.behaviorGap ?? 0) * (valuation?.total ?? 0))}<em>지금 자산 기준</em></p>
          </div>
        </div>
      </section>

      <section className="twin-main-grid">
        <section className="panel twin-portfolio-panel">
          <div className="panel-title"><h2>보유 현황</h2><span className="twin-path-caption">최근 종가 기준</span></div>
          <div className="twin-table-wrap">
            <table className="twin-table">
              <thead><tr><th>자산</th><th>평가금액</th><th>비중</th><th>등락률(1D)</th><th>기여도(1D)</th></tr></thead>
              <tbody>
                {(valuation?.rows ?? []).map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <div className="twin-holding-name">
                        <span className={`twin-holding-symbol ${tone(row.changePct)}`}>{row.name.slice(0, 1)}</span>
                        <div><strong>{row.name}</strong><small>{row.symbol === CASH ? "유동성" : `${row.symbol} · ${row.sector}`}</small></div>
                      </div>
                    </td>
                    <td>{korean(row.amount)}</td>
                    <td>{(row.weight * 100).toFixed(1)}%</td>
                    <td className={tone(row.changePct)}>{pct(row.changePct, 2)}</td>
                    <td className={tone(row.contribution)}>{won(row.contribution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="twin-table-note">
            * 투입 금액이 실제 수정주가를 따라 움직인 평가금액입니다. 가격 출처는 {snapshot.source}이며 기준일은 {formatSnapshotDate(snapshot.windows.recent.dates.at(-1) ?? "")}입니다.
          </p>
        </section>

        <section className="panel twin-path-panel">
          <div className="panel-title">
            <div><span>TIME MACHINE</span><h2>이 포트폴리오를 그때로 보내면</h2></div>
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
                <div><span>버티기</span><strong className={tone(result.buyHoldReturn)}>{pct(result.buyHoldReturn)}</strong></div>
                <div><span>내 트윈</span><strong className={tone(result.twinReturn)}>{pct(result.twinReturn)}</strong></div>
                <div><span>최대 낙폭</span><strong className="down-text">{pct(result.maxDrawdown)}</strong></div>
                <div><span>고점 회복</span><strong>{result.recoveryDays === null ? "구간 내 미회복" : `${result.recoveryDays}거래일`}</strong></div>
              </div>
              <TimeMachineChart result={result} />
              <div className="twin-chart-legend">
                <span><i className="hold" />버티기</span><span><i className="twin" />내 트윈</span><span><i className="index" />코스피</span>
                <span><i className="sell" />트윈의 매도·재진입</span>
              </div>
              <p className="twin-shock-note">{result.window.summary}{result.proxied.length ? ` 이 구간에 상장 전이던 ${result.proxied.map((item) => item.name).join(", ")}은(는) 코스피 지수 경로로 대체했습니다.` : ""}</p>
              {result.events.length > 0 && (
                <ol className="twin-event-list">
                  {result.events.slice(0, 6).map((event) => (
                    <li key={`${event.type}-${event.index}`} className={event.type}>
                      <time>{formatSnapshotDate(event.date)}</time>
                      <span>{event.detail}</span>
                    </li>
                  ))}
                  {result.events.length > 6 && <li className="twin-event-more">외 {result.events.length - 6}건의 매매가 더 있었습니다</li>}
                </ol>
              )}
            </>
          ) : <div className="twin-loading"><p>이 구간을 계산할 수 없습니다.</p></div>}
        </section>
      </section>

      <div className="twin-lower-grid">
      <div className="twin-report-column">
      <section className="panel twin-experts-panel">
        <div className="panel-title">
          <div><span>BEHAVIOR REPORT</span><h2>트윈이 드러낸 내 판단 습관</h2></div>
          <span>{result?.window.label} 구간에서 실제로 일어난 매매 기준</span>
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
          {appliedScenario && (
            <p className="twin-applied">
              <TrendingDown size={14} /> 시장 인사이트에서 가져온 시나리오: <b>{appliedScenario.title}</b> ({appliedScenario.forecast})
            </p>
          )}
          <button className="twin-text-button" type="button" onClick={onOpenBuilder}>내 시나리오로 앞으로의 구간도 만들어보기 <ChevronRight size={15} /></button>
        </div>
        <div className="twin-disclaimer">
          과거 실제 종가와 응답한 행동 규칙으로 계산한 교육용 결과입니다. 미래 수익을 예측하지 않으며 특정 종목의 매매를 권유하지 않습니다.
        </div>
      </section>
      {shownVerdicts.length > 0 && <MentorPanel verdicts={shownVerdicts} note={shownNote} source={mentor.source} loading={!mentorReady} />}
      </div>

      <aside className="twin-side-rail" aria-label="트윈 부가 진단">
        {mood && <MoodPanel mood={mood} hasSellRule={(profile?.panicAction ?? 0) > 0} />}
        <GoalPanel goal={goal} onChange={(next) => saved && persist({ ...saved, goal: next })} result={goalResult} />
      </aside>
      </div>
    </div>
  );
}
