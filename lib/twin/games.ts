// 행동 실험실.
//
// 6문항 설문은 "나는 버틸 것 같다"를 묻는다.  이 파일은 대신 실제 과거 가격을
// 이름을 가린 채 다시 틀어놓고, 사용자가 그 자리에서 무엇을 눌렀는지를 관측한다.
// 관측한 행동은 설문과 똑같은 BehaviorProfile 로 환산되어 마이 금융 트윈이
// 그대로 받아 쓴다.  말한 것과 한 것이 다르면 그 차이 자체가 결과물이 된다.
//
// 가격은 public/twin/shock-prices.json 의 실제 종가다.  게임이 끝난 뒤에야
// 어느 구간이었는지 알려준다.

import type { BehaviorProfile, PriceSnapshot } from "./backtest";

export type GameId = "hold" | "crowd" | "profit" | "lottery";
export type TurnAction = "sell-all" | "sell-half" | "hold" | "buy";

export type ReplayConfig = {
  id: Exclude<GameId, "lottery">;
  title: string;
  brief: string;
  windowId: string;
  from: string;
  to: string;
  turns: number;
  /** 턴마다 함께 보여줄 커뮤니티 반응. 없으면 가격만 본다. */
  feed?: string[][];
  /** 게임이 끝난 뒤 공개하는 정체 */
  reveal: string;
};

export type TurnRecord = { turn: number; action: TurnAction; drawdown: number; session: number; position: number };

export type ReplayResult = {
  id: Exclude<GameId, "lottery">;
  /** 처음 판 시점의 고점 대비 낙폭. 끝까지 안 팔았으면 null */
  sellDrawdown: number | null;
  /** 그때 판 비중 */
  sellFraction: number;
  /** 매도 후 다시 사기까지 걸린 거래일. 안 돌아왔으면 null */
  reentryGap: number | null;
  /** 이익 구간에서 줄인 비중의 합 */
  trimmed: number;
  /** 신고가 부근에서 추가 매수한 횟수 */
  chased: number;
  finalReturn: number;
  buyHoldReturn: number;
  records: TurnRecord[];
};

export type LotteryResult = {
  /** 손실을 이익보다 몇 배로 느끼는가 */
  lambda: number;
  /** 이익 틀과 손실 틀에서 같은 기준을 유지했는가 */
  consistent: boolean;
};

export type GameResults = { hold?: ReplayResult; crowd?: ReplayResult; profit?: ReplayResult; lottery?: LotteryResult };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** 구간 하나를 잘라 게임판으로 만든다. */
export function loadSlice(snapshot: PriceSnapshot, config: ReplayConfig) {
  const window = snapshot.windows[config.windowId];
  if (!window) return null;
  const start = window.dates.findIndex((date) => date >= config.from);
  const end = window.dates.findIndex((date) => date >= config.to);
  const last = end === -1 ? window.dates.length - 1 : end;
  if (start === -1 || last <= start) return null;
  const raw = window.closes.KOSPI.slice(start, last + 1);
  const dates = window.dates.slice(start, last + 1);
  const closes: number[] = [];
  let previous = raw.find((value) => value !== null) ?? 0;
  for (const value of raw) {
    if (value !== null && value !== undefined) previous = value;
    closes.push(previous);
  }
  if (!closes[0]) return null;
  const step = Math.max(1, Math.floor((closes.length - 1) / config.turns));
  // 각 턴이 끝나는 지점. 마지막 턴은 남은 거래일을 모두 가져간다.
  const stops = Array.from({ length: config.turns }, (_, turn) => Math.min(closes.length - 1, (turn + 1) * step));
  stops[stops.length - 1] = closes.length - 1;
  return { dates, closes, stops, base: closes[0] };
}

/** 사용자가 누른 기록에서 행동 파라미터의 재료를 뽑는다. */
export function summarizeReplay(
  config: ReplayConfig,
  slice: { closes: number[]; stops: number[] },
  records: TurnRecord[],
  finalValue: number,
): ReplayResult {
  const firstSell = records.find((record) => record.action === "sell-all" || record.action === "sell-half");
  const reentry = firstSell ? records.find((record) => record.action === "buy" && record.turn > firstSell.turn) : undefined;
  const peakSoFar = (session: number) => Math.max(...slice.closes.slice(0, session + 1));
  return {
    id: config.id,
    sellDrawdown: firstSell ? firstSell.drawdown : null,
    sellFraction: firstSell ? (firstSell.action === "sell-all" ? 1 : 0.5) : 0,
    reentryGap: firstSell && reentry ? reentry.session - firstSell.session : null,
    trimmed: records
      .filter((record) => (record.action === "sell-all" || record.action === "sell-half") && record.drawdown > -0.02)
      .reduce((sum, record) => sum + (record.action === "sell-all" ? 1 : 0.5), 0),
    chased: records.filter((record) => record.action === "buy" && slice.closes[record.session] >= peakSoFar(record.session) * 0.995).length,
    finalReturn: finalValue / 100 - 1,
    buyHoldReturn: slice.closes.at(-1)! / slice.closes[0] - 1,
    records,
  };
}

/**
 * 관측한 행동을 설문과 같은 형식의 프로필로 환산한다.
 *
 * 플레이하지 않은 게임의 항목은 중립값으로 둔다.  게임을 더 할수록 트윈이
 * 정확해지고, 하나도 안 해도 설문 결과로 돌아갈 수 있다.
 */
export function deriveProfileFromGames(results: GameResults): BehaviorProfile {
  const hold = results.hold;
  const crowd = results.crowd;
  const profit = results.profit;

  // 버티기 게임에서 실제로 판 낙폭이 곧 임계. 끝까지 버텼으면 가장 깊은 값으로 둔다.
  const panicDrawdown = clamp(hold?.sellDrawdown ?? -0.45, -0.5, -0.05);
  const panicAction = hold ? hold.sellFraction : 0.5;
  // 같은 사람이 군중 피드 아래에서 얼마나 더 일찍 팔았는가.
  const shift = crowd && hold ? (crowd.sellDrawdown ?? -0.45) - (hold.sellDrawdown ?? -0.45) : 0;
  const herding = crowd ? clamp(shift / 0.15, 0, 1) : 0.45;
  const reentryDelay = hold ? (hold.reentryGap ?? 250) : 20;
  const disposition = profit ? clamp(profit.trimmed / 2, 0, 1) : 0.5;
  const chase = profit ? clamp(profit.chased / 2, 0, 1) : 0.4;

  // 복권 게임의 손실 민감도는 임계를 앞당기는 쪽으로만 반영한다.
  const lambda = results.lottery?.lambda ?? 2;
  const sensitivity = clamp((lambda - 2) / 4, 0, 0.4);

  return {
    panicDrawdown: clamp(panicDrawdown * (1 - sensitivity * 0.3), -0.5, -0.05),
    panicAction,
    herding,
    reentryDelay,
    disposition,
    chase,
  };
}

/** 어떤 성향을 실제로 관측했는지. 플레이한 게임이 곧 관측 범위다. */
export const observedTraits = (results: GameResults) => ({
  panic: Boolean(results.hold),
  herding: Boolean(results.crowd),
  disposition: Boolean(results.profit),
  chase: Boolean(results.profit),
});

/** 게임 네 개를 다 했는지. 결과 화면에서 신뢰도 표시에 쓴다. */
export const playedCount = (results: GameResults) =>
  [results.hold, results.crowd, results.profit, results.lottery].filter(Boolean).length;

export const replayGames: ReplayConfig[] = [
  {
    id: "hold",
    title: "버티기",
    brief: "1억을 넣은 상태에서 시작합니다. 이름을 가린 실제 시장이 2주씩 흘러갑니다. 언제 무엇을 누를지는 당신이 정합니다.",
    windowId: "covid-2020",
    from: "20200102",
    to: "20200731",
    turns: 12,
    reveal: "2020년 1~7월, 코로나 급락과 그 직후입니다.",
  },
  {
    id: "crowd",
    title: "군중의 목소리",
    brief: "이번에는 같은 방식이지만 커뮤니티 반응이 함께 보입니다. 사람들의 말이 당신의 기준을 바꾸는지 봅니다.",
    windowId: "gfc-2008",
    from: "20080801",
    to: "20090630",
    turns: 10,
    reveal: "2008년 8월~2009년 6월, 글로벌 금융위기입니다.",
    feed: [
      ["조정은 늘 있는 일입니다. 분할매수 구간이라고 봅니다.", "지금 빠지는 건 외국인 수급 때문이지 실적 문제가 아님"],
      ["슬슬 무섭네요. 일단 절반은 뺐습니다.", "아직입니다. 여기서 팔면 바닥에서 파는 겁니다"],
      ["미국이 저러는데 우리가 버틸 수 있나요", "환율 보세요. 이건 다릅니다"],
      ["다 팔았습니다. 마음이 편해요", "저도 오늘 정리했습니다. 더 빠질 것 같아서요"],
      ["지금 안 팔면 반토막 납니다", "주변에서 다 나갔다고 하네요", "저만 물려 있는 것 같습니다"],
      ["끝났습니다. 이 시장은 안 됩니다", "은행 이자가 낫습니다"],
      ["조금씩 사 모으는 분들도 계시네요", "아직 반등은 이르다고 봅니다"],
      ["어제부터 분위기가 좀 다릅니다", "속임수 반등일 수 있습니다"],
      ["결국 버틴 사람이 이기는 것 같네요", "저는 아직 못 들어가겠습니다"],
      ["그때 안 판 사람이 부럽습니다", "다시 사려니 가격이 부담스럽네요"],
    ],
  },
  {
    id: "profit",
    title: "이익 앞에서",
    brief: "이번 판은 오르는 구간입니다. 수익이 났을 때 무엇을 하는지 봅니다.",
    windowId: "covid-2020",
    from: "20200401",
    to: "20210430",
    turns: 8,
    reveal: "2020년 4월~2021년 4월, 급락 이후의 회복 구간입니다.",
  },
];

/** 손실의 무게. 확실한 손실과 도박을 짝지어 전환점에서 손실 민감도를 잰다. */
export const lotteryPairs = [
  { certain: -300_000, risky: -800_000, chance: 0.5 },
  { certain: -300_000, risky: -1_200_000, chance: 0.5 },
  { certain: -300_000, risky: -2_000_000, chance: 0.5 },
  { certain: 300_000, risky: 800_000, chance: 0.5 },
  { certain: 300_000, risky: 1_200_000, chance: 0.5 },
  { certain: 300_000, risky: 2_000_000, chance: 0.5 },
];

/**
 * 손실 쪽에서 도박을 몇 번 골랐는지로 손실 민감도를 추정한다.
 * 손실을 크게 느낄수록 확실한 손실을 피해 도박으로 도망간다(반사효과).
 */
export function scoreLottery(choices: ("certain" | "risky")[]): LotteryResult {
  const lossSide = choices.slice(0, 3);
  const gainSide = choices.slice(3);
  const riskyLosses = lossSide.filter((choice) => choice === "risky").length;
  const riskyGains = gainSide.filter((choice) => choice === "risky").length;
  return {
    lambda: 1 + riskyLosses * 1.5,
    // 손실에선 도박, 이익에선 확실을 고르면 전형적인 반사효과라 기준이 뒤집힌 것이다.
    consistent: !(riskyLosses >= 2 && riskyGains <= 1),
  };
}
