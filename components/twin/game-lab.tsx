"use client";

// 행동 실험실.
//
// 이름을 가린 실제 시장을 다시 틀어놓고 사용자가 무엇을 누르는지 관측한다.
// 관측 결과는 마이 금융 트윈이 그대로 쓰는 BehaviorProfile 이 된다.
// 설문 응답이 이미 있으면 "말한 것"과 "한 것"을 나란히 보여준다.

import { ArrowRight, Check, LoaderCircle, RotateCcw, Sparkles, TriangleAlert, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BehaviorProfile, PriceSnapshot } from "@/lib/twin/backtest";
import { BUY_COLOR, HOLD_LINE, SELL_COLOR } from "@/lib/twin/chart-colors";
import {
  deriveProfileFromGames,
  loadSlice,
  lotteryPairs,
  observedTraits,
  playedCount,
  replayGames,
  scoreLottery,
  summarizeReplay,
  type GameResults,
  type ReplayConfig,
  type TurnAction,
  type TurnRecord,
} from "@/lib/twin/games";
import { characterFor, deriveProfile } from "@/lib/twin/profile";

const GAMES_KEY = "finverse.twin.games.v1";
const TWIN_KEY = "finverse.twin.v2";

const pct = (value: number, digits = 1) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
const money = (value: number) => `${Math.round(value * 1_000_000).toLocaleString("ko-KR")}원`;
const tone = (value: number) => (value > 0 ? "up" : value < 0 ? "down" : "flat");

const actionLabels: Record<TurnAction, string> = {
  "sell-all": "전부 판다",
  "sell-half": "절반 판다",
  hold: "그대로 둔다",
  buy: "더 산다",
};

/** 지금까지 공개된 구간만 그린다. 앞으로의 값은 축에도 드러내지 않는다. */
function ReplayChart({ closes, upto, records }: { closes: number[]; upto: number; records: TurnRecord[] }) {
  const shown = closes.slice(0, upto + 1);
  const top = Math.max(...shown);
  const bottom = Math.min(...shown);
  const span = (top - bottom) * 1.15 || 1;
  const middle = (top + bottom) / 2;
  const x = (index: number) => 40 + (index / Math.max(1, closes.length - 1)) * 660;
  const y = (value: number) => 130 - ((value - (middle - span / 2)) / span) * 110;
  const path = shown.map((value, index) => `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");

  return (
    <svg className="lab-chart" viewBox="0 0 720 150" role="img" aria-label="지금까지 공개된 시장 경로">
      {[20, 55, 90, 125].map((line) => <line key={line} x1="40" y1={line} x2="700" y2={line} stroke="#ededf0" strokeWidth="1" />)}
      <path d={path} fill="none" stroke={HOLD_LINE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(upto)} cy={y(shown.at(-1)!)} r="4.5" fill={HOLD_LINE} />
      {records.filter((record) => record.session <= upto).map((record) => (
        <circle
          key={`${record.turn}-${record.action}`}
          cx={x(record.session)}
          cy={y(closes[record.session])}
          r="4"
          fill={record.action === "buy" ? BUY_COLOR : record.action === "hold" ? "#fff" : SELL_COLOR}
          stroke={record.action === "buy" ? BUY_COLOR : record.action === "hold" ? "#a1a1aa" : SELL_COLOR}
          strokeWidth="1.6"
        />
      ))}
      <line x1={x(upto)} y1="14" x2={x(upto)} y2="136" stroke="#d4d4d8" strokeWidth="1" strokeDasharray="3 3" />
    </svg>
  );
}

function ReplayGame({
  config,
  snapshot,
  onFinish,
  onQuit,
}: {
  config: ReplayConfig;
  snapshot: PriceSnapshot;
  onFinish: (result: ReturnType<typeof summarizeReplay>) => void;
  onQuit: () => void;
}) {
  const slice = useMemo(() => loadSlice(snapshot, config), [snapshot, config]);
  const [turn, setTurn] = useState(0);
  const [position, setPosition] = useState(1);
  const [value, setValue] = useState(100);
  const [peak, setPeak] = useState(100);
  const [records, setRecords] = useState<TurnRecord[]>([]);

  if (!slice) return <div className="lab-empty"><p>이 구간을 불러오지 못했습니다.</p><button type="button" onClick={onQuit}>돌아가기</button></div>;

  const session = slice.stops[turn];
  const drawdown = value / peak - 1;
  const invested = value * position;

  const choose = (action: TurnAction) => {
    let nextPosition = position;
    if (action === "sell-all") nextPosition = 0;
    if (action === "sell-half") nextPosition = position / 2;
    if (action === "buy") nextPosition = Math.min(1, position + 0.5);
    const record: TurnRecord = { turn, action, drawdown, session, position: nextPosition };
    const nextRecords = [...records, record];

    const isLast = turn >= slice.stops.length - 1;
    if (isLast) {
      setRecords(nextRecords);
      onFinish(summarizeReplay(config, slice, nextRecords, value));
      return;
    }
    const from = slice.closes[session];
    const to = slice.closes[slice.stops[turn + 1]];
    const nextValue = value * (1 + nextPosition * (to / from - 1));
    setRecords(nextRecords);
    setPosition(nextPosition);
    setValue(nextValue);
    setPeak(Math.max(peak, nextValue));
    setTurn(turn + 1);
  };

  const feed = config.feed?.[turn] ?? [];

  return (
    <section className="panel lab-play">
      <div className="panel-title">
        <div><span>{config.title.toUpperCase()} · TURN {turn + 1} / {slice.stops.length}</span><h2>지금 무엇을 하시겠습니까?</h2></div>
        <button className="twin-ghost-button" type="button" onClick={onQuit}>그만두기</button>
      </div>
      <div className="lab-play-body">
        <div className="lab-stats">
          <div><span>내 자산</span><strong className={tone(value - 100)}>{money(value)}</strong><small>시작 1억원</small></div>
          <div><span>수익률</span><strong className={tone(value - 100)}>{pct(value / 100 - 1)}</strong><small>고점 대비 {pct(drawdown)}</small></div>
          <div><span>주식 비중</span><strong>{(position * 100).toFixed(0)}<em>%</em></strong><small>현금 {money(value - invested)}</small></div>
        </div>
        <ReplayChart closes={slice.closes} upto={session} records={records} />
        <div className="lab-progress"><i style={{ width: `${((turn + 1) / slice.stops.length) * 100}%` }} /></div>
        {feed.length > 0 && (
          <div className="lab-feed">
            <span>커뮤니티</span>
            {feed.map((post) => <p key={post}>{post}</p>)}
          </div>
        )}
        <div className="lab-actions">
          {(["sell-all", "sell-half", "hold", "buy"] as TurnAction[]).map((action) => (
            <button
              key={action}
              type="button"
              className={action === "buy" ? "buy" : action === "hold" ? "hold" : "sell"}
              disabled={(action !== "hold" && action !== "buy" && position === 0) || (action === "buy" && position >= 1)}
              onClick={() => choose(action)}
            >
              {actionLabels[action]}
            </button>
          ))}
        </div>
        <p className="lab-note">어느 구간인지는 끝난 뒤에 알려드립니다. 실제 종가로 움직입니다.</p>
      </div>
    </section>
  );
}

function LotteryGame({ onFinish, onQuit }: { onFinish: (choices: ("certain" | "risky")[]) => void; onQuit: () => void }) {
  const [choices, setChoices] = useState<("certain" | "risky")[]>([]);
  const pair = lotteryPairs[choices.length];
  const pick = (choice: "certain" | "risky") => {
    const next = [...choices, choice];
    if (next.length === lotteryPairs.length) onFinish(next);
    else setChoices(next);
  };
  if (!pair) return null;
  const loss = pair.certain < 0;
  const amount = (value: number) => `${Math.abs(value).toLocaleString("ko-KR")}원`;

  return (
    <section className="panel lab-play">
      <div className="panel-title">
        <div><span>손실의 무게 · {choices.length + 1} / {lotteryPairs.length}</span><h2>둘 중 하나를 고르세요</h2></div>
        <button className="twin-ghost-button" type="button" onClick={onQuit}>그만두기</button>
      </div>
      <div className="lab-play-body">
        <p className="lab-lottery-lead">{loss ? "둘 다 손실입니다. 어느 쪽이 덜 괴로운가요?" : "둘 다 이익입니다. 어느 쪽을 택하시겠습니까?"}</p>
        <div className="lab-lottery">
          <button type="button" onClick={() => pick("certain")}>
            <span>확실하게</span>
            <strong className={loss ? "down" : "up"}>{loss ? "-" : "+"}{amount(pair.certain)}</strong>
            <small>100% 확률</small>
          </button>
          <button type="button" onClick={() => pick("risky")}>
            <span>운에 맡기고</span>
            <strong className={loss ? "down" : "up"}>{loss ? "-" : "+"}{amount(pair.risky)}</strong>
            <small>{pair.chance * 100}% 확률 · 나머지는 0원</small>
          </button>
        </div>
        <div className="lab-progress"><i style={{ width: `${((choices.length + 1) / lotteryPairs.length) * 100}%` }} /></div>
        <p className="lab-note">정답이 없는 선택입니다. 두 번 생각하지 말고 먼저 끌리는 쪽을 고르세요.</p>
      </div>
    </section>
  );
}

function Reveal({ config, result, onNext }: { config: ReplayConfig; result: ReturnType<typeof summarizeReplay>; onNext: () => void }) {
  const gap = result.finalReturn - result.buyHoldReturn;
  return (
    <section className="panel lab-play">
      <div className="panel-title"><div><span>RESULT</span><h2>{config.reveal}</h2></div></div>
      <div className="lab-play-body">
        <div className="lab-stats">
          <div><span>끝까지 뒀다면</span><strong className={tone(result.buyHoldReturn)}>{pct(result.buyHoldReturn)}</strong></div>
          <div><span>당신의 결과</span><strong className={tone(result.finalReturn)}>{pct(result.finalReturn)}</strong></div>
          <div><span>차이</span><strong className={tone(gap)}>{pct(gap)}p</strong><small>당신이 누른 버튼이 만든 몫</small></div>
        </div>
        <div className="lab-reveal-copy">
          {result.sellDrawdown === null ? (
            <p>이 판에서는 끝까지 팔지 않았습니다. 최대 낙폭을 그대로 견딘 셈입니다.</p>
          ) : (
            <p>
              고점 대비 <b>{pct(result.sellDrawdown)}</b> 구간에서 처음 {result.sellFraction === 1 ? "전부" : "절반을"} 팔았습니다.
              {result.reentryGap === null
                ? " 그리고 이 판이 끝날 때까지 다시 사지 않았습니다."
                : ` 그리고 ${result.reentryGap}거래일 뒤에 다시 샀습니다.`}
            </p>
          )}
          {result.chased > 0 && <p>신고가 부근에서 {result.chased}번 더 담았습니다.</p>}
          {result.trimmed > 0 && <p>수익 구간에서 미리 줄인 비중이 있습니다.</p>}
        </div>
        <button className="lab-primary" type="button" onClick={onNext}>계속 <ArrowRight size={16} /></button>
      </div>
    </section>
  );
}

export default function GameLab({ onGoToTwin }: { onGoToTwin: () => void }) {
  const [snapshot, setSnapshot] = useState<PriceSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [results, setResults] = useState<GameResults>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string> | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ config: ReplayConfig; result: ReturnType<typeof summarizeReplay> } | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      let stored: GameResults = {};
      let answers: Record<string, string> | null = null;
      try {
        const raw = window.localStorage.getItem(GAMES_KEY);
        if (raw) stored = JSON.parse(raw) as GameResults;
        const twin = window.localStorage.getItem(TWIN_KEY);
        if (twin) answers = (JSON.parse(twin) as { answers?: Record<string, string> }).answers ?? null;
      } catch { /* 저장값이 깨졌으면 새로 시작한다 */ }
      let prices: PriceSnapshot | null = null;
      try {
        const response = await fetch("/twin/shock-prices.json", { cache: "force-cache" });
        if (response.ok) prices = await response.json() as PriceSnapshot;
      } catch { /* 스냅샷이 없으면 안내 화면 */ }
      if (!alive) return;
      setResults(stored);
      setQuizAnswers(answers);
      setSnapshot(prices);
      setLoaded(true);
    };
    void load();
    return () => { alive = false; };
  }, []);

  const save = useCallback((next: GameResults) => {
    setResults(next);
    setApplied(false);
    try { window.localStorage.setItem(GAMES_KEY, JSON.stringify(next)); } catch { /* 시크릿 모드 */ }
  }, []);

  const played = playedCount(results);
  const gameProfile = useMemo(() => (played ? deriveProfileFromGames(results) : null), [results, played]);
  // 유형 판정에는 실제로 플레이한 게임의 항목만 쓴다. 채워 넣은 기본값으로 유형이
  // 갈리면 하지도 않은 행동으로 이름이 붙는다.
  const observed = useMemo(() => observedTraits(results), [results]);
  const saidProfile = useMemo(() => (quizAnswers && Object.keys(quizAnswers).length ? deriveProfile(quizAnswers) : null), [quizAnswers]);

  const applyToTwin = () => {
    if (!gameProfile) return;
    try {
      const raw = window.localStorage.getItem(TWIN_KEY);
      // 자산 배분이 아직 없으면 트윈 화면이 설정부터 묻도록 total 을 0 으로 둔다.
      const twin = raw ? JSON.parse(raw) as Record<string, unknown> : { total: 0, stockWeight: 0.6, answers: {} };
      window.localStorage.setItem(TWIN_KEY, JSON.stringify({ ...twin, gameProfile, gameObserved: observed }));
    } catch { /* 저장 실패해도 화면은 유지 */ }
    setApplied(true);
    onGoToTwin();
  };

  if (!loaded || !snapshot) {
    return (
      <div className="lab-page">
        <div className="twin-loading">
          <LoaderCircle size={22} className={snapshot ? "" : "spin"} />
          <p>{loaded && !snapshot ? "가격 스냅샷을 불러오지 못했습니다. scripts/twin_price_snapshot.mjs 를 실행해주세요." : "실제 시장을 준비하는 중입니다."}</p>
        </div>
      </div>
    );
  }

  if (reveal) {
    return <div className="lab-page"><Reveal config={reveal.config} result={reveal.result} onNext={() => { setReveal(null); setActive(null); }} /></div>;
  }

  if (active === "lottery") {
    return (
      <div className="lab-page">
        <LotteryGame onQuit={() => setActive(null)} onFinish={(choices) => { save({ ...results, lottery: scoreLottery(choices) }); setActive(null); }} />
      </div>
    );
  }

  const activeConfig = replayGames.find((game) => game.id === active);
  if (activeConfig) {
    return (
      <div className="lab-page">
        <ReplayGame
          key={activeConfig.id}
          config={activeConfig}
          snapshot={snapshot}
          onQuit={() => setActive(null)}
          onFinish={(result) => { save({ ...results, [activeConfig.id]: result }); setReveal({ config: activeConfig, result }); }}
        />
      </div>
    );
  }

  const character = gameProfile ? characterFor(gameProfile, observed) : null;
  const saidCharacter = saidProfile ? characterFor(saidProfile) : null;
  const cards = [
    ...replayGames.map((game) => ({ id: game.id, title: game.title, brief: game.brief, done: Boolean(results[game.id]) })),
    { id: "lottery", title: "손실의 무게", brief: "확실한 손실과 도박 중 하나를 고르는 여섯 번의 선택으로, 손실을 이익보다 몇 배로 느끼는지 잽니다.", done: Boolean(results.lottery) },
  ];

  return (
    <div className="lab-page">
      <header className="page-heading twin-heading">
        <div>
          <span>BEHAVIOR LAB</span>
          <h1>말로 답한 성향 말고, 실제로 누른 버튼으로 찾습니다.</h1>
        </div>
        {played > 0 && (
          <button className="twin-ghost-button" type="button" onClick={() => save({})}><RotateCcw size={14} /> 기록 지우기</button>
        )}
      </header>

      <section className="panel lab-intro">
        <div className="panel-title"><div><span>{played} / {cards.length} 완료</span><h2>네 개의 실험</h2></div><Sparkles size={16} /></div>
        <div className="lab-card-grid">
          {cards.map((card) => (
            <button key={card.id} type="button" className={card.done ? "done" : ""} onClick={() => setActive(card.id)}>
              <div><strong>{card.title}</strong>{card.done && <span className="lab-done"><Check size={13} /> 완료</span>}</div>
              <p>{card.brief}</p>
              <em>{card.done ? "다시 하기" : "시작하기"} <ArrowRight size={14} /></em>
            </button>
          ))}
        </div>
        <p className="lab-note">모든 판은 이름을 가린 실제 과거 종가로 움직입니다. 기록은 이 브라우저에만 저장됩니다.</p>
      </section>

      {gameProfile && character && (
        <section className="panel lab-result">
          <div className="panel-title">
            <div><span>OBSERVED PROFILE</span><h2>관측된 당신의 성향</h2></div>
            <span className={`twin-character-chip ${character.provisional ? "provisional" : ""}`}><UserRound size={13} /> {character.name}</span>
          </div>
          <div className="lab-result-body">
            <div className="lab-profile-grid">
              {[
                { label: "견디는 낙폭", value: pct(gameProfile.panicDrawdown), hint: "여기서 손이 움직였습니다", observed: Boolean(results.hold) },
                { label: "그때 파는 비중", value: `${(gameProfile.panicAction * 100).toFixed(0)}%`, hint: "실제로 누른 버튼", observed: Boolean(results.hold) },
                { label: "군중의 영향", value: `${(gameProfile.herding * 100).toFixed(0)}%`, hint: "피드가 있을 때 기준이 앞당겨진 정도", observed: Boolean(results.crowd) },
                { label: "재진입까지", value: gameProfile.reentryDelay >= 250 ? "안 돌아옴" : `${gameProfile.reentryDelay}일`, hint: "판 뒤 다시 사기까지", observed: Boolean(results.hold) },
              ].map((metric) => (
                <div key={metric.label} className={metric.observed ? "" : "assumed"}>
                  <span>{metric.label}<i>{metric.observed ? "관측" : "추정"}</i></span>
                  <strong>{metric.value}</strong>
                  <small>{metric.observed ? metric.hint : "이 실험을 아직 하지 않아 기본값입니다"}</small>
                </div>
              ))}
            </div>

            {saidProfile && saidCharacter && (
              <div className={`lab-compare ${saidCharacter.key === character.key ? "match" : "gap"}`}>
                <div>
                  <span>설문에서 말한 성향</span>
                  <strong>{saidCharacter.name}</strong>
                  <em>견디는 낙폭 {pct(saidProfile.panicDrawdown)} · 매도 비중 {(saidProfile.panicAction * 100).toFixed(0)}%</em>
                </div>
                <div>
                  <span>게임에서 한 행동</span>
                  <strong>{character.name}</strong>
                  <em>견디는 낙폭 {pct(gameProfile.panicDrawdown)} · 매도 비중 {(gameProfile.panicAction * 100).toFixed(0)}%</em>
                </div>
                <p>
                  {character.provisional
                    ? "아직 유형을 정하기엔 관측이 모자랍니다. 남은 실험을 마치면 왼쪽과 제대로 비교할 수 있습니다."
                    : saidCharacter.key === character.key
                      ? "말한 것과 한 것이 같습니다. 자기 기준을 알고 있는 편입니다."
                      : "말한 것과 한 것이 다릅니다. 대부분의 사람이 그렇고, 실제 판단을 만드는 건 오른쪽입니다."}
                </p>
              </div>
            )}

            {results.lottery && (
              <p className="lab-lambda">
                <TriangleAlert size={14} /> <span>손실을 이익보다 <b>{results.lottery.lambda.toFixed(1)}배</b>로 느낍니다.
                {results.lottery.consistent ? " 이익 틀과 손실 틀에서 기준이 일관됩니다." : " 손실 앞에서는 도박을, 이익 앞에서는 안전을 골랐습니다. 전형적인 반사효과입니다."}</span>
              </p>
            )}

            <p className="lab-note">
              {played}개 실험 기준입니다. {character.provisional
                ? "남은 실험을 마치면 추정값이 아니라 관측값으로 유형을 정합니다."
                : "남은 실험을 마치면 나머지 항목도 추정치가 아니라 관측치가 됩니다."}
            </p>
            <button className="lab-primary" type="button" onClick={applyToTwin}>
              {applied ? <><Check size={16} /> 트윈에 적용했습니다</> : <>이 성향으로 내 트윈 만들기 <ArrowRight size={16} /></>}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
