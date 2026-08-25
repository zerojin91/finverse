// 목표 달성 확률.
//
// "지금 이대로 모으면 목표에 닿는가"를 1,000번의 가상 미래로 답한다.  수익률
// 가정을 임의로 넣지 않고, 사용자가 실제로 담은 자산이 1997~최근 구간에서 실제로
// 겪었던 월간 수익률을 다시 뽑아 쓴다(블록 부트스트랩).  같은 미래를 두 번 계산해
// 하나는 끝까지 버티고, 하나는 트윈의 매도·재진입 규칙을 적용한다.

import { buyHoldPath, effectivePanicThreshold, type BehaviorProfile, type Holding, type PriceSnapshot } from "./backtest";

/** 목표 한 건. amount·monthly 는 원, years 는 년. */
export type Goal = { amount: number; years: number; monthly: number };

export type GoalOutcome = {
  successRate: number;
  median: number;
  low: number;
  high: number;
};

export type GoalResult = {
  paths: number;
  months: number;
  /** 부트스트랩에 쓰인 실제 월 수 */
  sampleMonths: number;
  start: number;
  hold: GoalOutcome;
  twin: GoalOutcome;
};

const SESSIONS_PER_MONTH = 21;
const BLOCK = 3;
const PATHS = 1000;

/** 재현 가능한 난수. 화면을 다시 그릴 때마다 확률이 흔들리면 안 된다. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const seedFrom = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * 담은 자산이 실제로 겪었던 월간 수익률 표본.
 *
 * 어떤 구간도 빼지 않는다.  충격 구간만 뽑으면 미래가 늘 하락처럼 보이고, 최근
 * 상승만 뽑으면 그 반대가 된다.  가진 실제 이력을 전부 쓰는 쪽이 고를 여지가
 * 없어 설명하기 쉽다.  대신 이 표본은 이 포트폴리오의 과거일 뿐 수익률 전망이
 * 아니므로, 화면에서는 중앙값과 함께 10~90% 구간을 같이 보여준다.
 */
export function monthlyReturns(snapshot: PriceSnapshot, holdings: Holding[]) {
  const samples: number[] = [];
  for (const window of Object.values(snapshot.windows)) {
    const base = buyHoldPath(snapshot, window, holdings);
    if (!base) continue;
    for (let session = SESSIONS_PER_MONTH; session < base.path.length; session += SESSIONS_PER_MONTH) {
      const previous = base.path[session - SESSIONS_PER_MONTH];
      if (previous > 0) samples.push(base.path[session] / previous - 1);
    }
  }
  return samples;
}

const quantile = (sorted: number[], ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];

const summarize = (finals: number[], target: number): GoalOutcome => {
  const sorted = [...finals].sort((left, right) => left - right);
  return {
    successRate: finals.filter((value) => value >= target).length / finals.length,
    median: quantile(sorted, 0.5),
    low: quantile(sorted, 0.1),
    high: quantile(sorted, 0.9),
  };
};

export function simulateGoal(
  snapshot: PriceSnapshot,
  holdings: Holding[],
  profile: BehaviorProfile,
  goal: Goal,
  start: number,
): GoalResult | null {
  const samples = monthlyReturns(snapshot, holdings);
  const months = Math.round(goal.years * 12);
  if (samples.length < BLOCK * 2 || months < 1) return null;

  // 목표 금액은 시드에 넣지 않는다.  경로는 목표와 무관하게 같아야 목표만 바꿨을
  // 때 분포가 그대로 있고 달성선만 움직이는 것으로 읽힌다.
  const random = mulberry32(seedFrom(`${JSON.stringify(holdings)}|${goal.years}|${goal.monthly}|${Math.round(start)}`));
  const trigger = effectivePanicThreshold(profile);
  const reentryMonths = Math.max(1, Math.round(profile.reentryDelay / SESSIONS_PER_MONTH));
  const holdFinals: number[] = [];
  const twinFinals: number[] = [];

  for (let path = 0; path < PATHS; path += 1) {
    let hold = start;
    let twin = start;
    // 트윈은 시장이 아니라 자기 계좌의 고점 대비 낙폭을 보고 판단한다.
    let index = 1;
    let peak = 1;
    let position = 1;
    let exitMonth: number | null = null;
    let lowAfterExit = Infinity;
    let block: number[] = [];
    let cursor = 0;

    for (let month = 0; month < months; month += 1) {
      if (cursor >= block.length) {
        const origin = Math.floor(random() * (samples.length - BLOCK));
        block = samples.slice(origin, origin + BLOCK);
        cursor = 0;
      }
      const monthly = block[cursor];
      cursor += 1;

      index *= 1 + monthly;
      const drawdown = index / peak - 1;
      if (position > 0 && profile.panicAction > 0 && drawdown <= trigger && exitMonth === null) {
        position *= 1 - profile.panicAction;
        exitMonth = month;
        lowAfterExit = index;
      } else if (exitMonth !== null) {
        lowAfterExit = Math.min(lowAfterExit, index);
        if (month - exitMonth >= reentryMonths && index / lowAfterExit - 1 >= 0.03) {
          position = 1;
          peak = index;
          exitMonth = null;
        }
      }
      peak = Math.max(peak, index);

      hold = hold * (1 + monthly) + goal.monthly;
      twin = twin * (1 + position * monthly) + goal.monthly;
    }
    holdFinals.push(hold);
    twinFinals.push(twin);
  }

  return {
    paths: PATHS,
    months,
    sampleMonths: samples.length,
    start,
    hold: summarize(holdFinals, goal.amount),
    twin: summarize(twinFinals, goal.amount),
  };
}
