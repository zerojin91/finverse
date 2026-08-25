// 시장 온도계.
//
// "지금 시장이 얼마나 겁먹었는가"를 실제 종가에서 계산하고, 그 온도에서 내
// 트윈이 매도 버튼까지 몇 %p 남았는지 붙인다.  과거 백테스트가 "그때 나였다면"
// 이라면 이 패널은 "지금 나는"이다.
//
// 네 가지 구성요소는 모두 public/twin/shock-prices.json 의 최근 구간 종가에서
// 나온다.  외부 지수를 가져오지 않으므로 값의 출처를 화면에서 그대로 설명할 수 있다.

import { buyHoldPath, effectivePanicThreshold, type BehaviorProfile, type Holding, type PriceSnapshot } from "./backtest";

export type MoodComponent = { key: string; label: string; score: number; detail: string };

export type MarketMood = {
  asOf: string;
  /** 0(극단적 공포) ~ 100(극단적 탐욕) */
  score: number;
  label: string;
  components: MoodComponent[];
  /** 최근 1년 고점 대비 내 포트폴리오의 현재 낙폭 */
  drawdown: number;
  /** 트윈이 실제로 매도를 누르는 낙폭 */
  trigger: number;
  /** 매도 버튼까지 남은 거리(%p 단위 소수). 음수면 이미 지났다 */
  distance: number;
  triggered: boolean;
};

const SESSION_YEAR = 250;

/** 값을 lo~hi 구간에 대응시켜 0~100 으로 만든다. hi < lo 이면 방향이 뒤집힌다. */
const scale = (value: number, lo: number, hi: number) => {
  const ratio = (value - lo) / (hi - lo);
  return Math.max(0, Math.min(100, ratio * 100));
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** 일간 수익률의 표준편차를 연율화한 변동성. */
function volatility(closes: number[]) {
  if (closes.length < 3) return 0;
  const returns = closes.slice(1).map((close, index) => close / closes[index] - 1);
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252);
}

const filled = (closes: (number | null)[] | undefined) => {
  if (!closes) return [];
  const output: number[] = [];
  let last: number | null = null;
  for (const value of closes) {
    if (value !== null && value !== undefined) last = value;
    if (last !== null) output.push(last);
  }
  return output;
};

const labelFor = (score: number) =>
  score < 25 ? "극단적 공포" : score < 45 ? "공포" : score <= 55 ? "중립" : score <= 75 ? "탐욕" : "극단적 탐욕";

export function marketMood(snapshot: PriceSnapshot, holdings: Holding[], profile: BehaviorProfile): MarketMood | null {
  const window = snapshot.windows.recent;
  if (!window) return null;
  const index = filled(window.closes.KOSPI);
  if (index.length < 130) return null;

  const last = index.at(-1)!;
  const movingAverage = average(index.slice(-120));
  const recentVolatility = volatility(index.slice(-21));
  const yearVolatility = median(
    Array.from({ length: Math.max(1, Math.min(SESSION_YEAR, index.length - 21)) }, (_, offset) =>
      volatility(index.slice(index.length - 21 - offset, index.length - offset)),
    ),
  );
  const yearHigh = Math.max(...index.slice(-SESSION_YEAR));
  const indexDrawdown = last / yearHigh - 1;
  const above = snapshot.assets.filter((asset) => {
    const closes = filled(window.closes[asset.symbol]);
    return closes.length >= 21 && closes.at(-1)! > average(closes.slice(-20));
  }).length;

  const components: MoodComponent[] = [
    {
      key: "momentum",
      label: "추세",
      score: scale(last / movingAverage - 1, -0.1, 0.1),
      detail: `120일 평균 대비 ${((last / movingAverage - 1) * 100).toFixed(1)}%`,
    },
    {
      key: "volatility",
      label: "변동성",
      score: scale(recentVolatility / (yearVolatility || recentVolatility || 1), 2, 0.5),
      detail: `최근 20일 변동성이 1년 중앙값의 ${(recentVolatility / (yearVolatility || 1)).toFixed(2)}배`,
    },
    {
      key: "drawdown",
      label: "고점 대비",
      score: scale(indexDrawdown, -0.3, 0),
      detail: `코스피가 1년 고점보다 ${(indexDrawdown * 100).toFixed(1)}%`,
    },
    {
      key: "breadth",
      label: "시장 폭",
      score: scale(above / snapshot.assets.length, 0, 1),
      detail: `${snapshot.assets.length}개 종목 중 ${above}개가 20일 평균 위`,
    },
  ];

  const score = Math.round(average(components.map((component) => component.score)));

  const base = buyHoldPath(snapshot, window, holdings);
  const path = base?.path.slice(-SESSION_YEAR) ?? [];
  const peak = path.length ? Math.max(...path) : 0;
  const drawdown = path.length && peak ? path.at(-1)! / peak - 1 : 0;
  const trigger = effectivePanicThreshold(profile);

  return {
    asOf: window.dates.at(-1)!,
    score,
    label: labelFor(score),
    components,
    drawdown,
    trigger,
    distance: drawdown - trigger,
    triggered: profile.panicAction > 0 && drawdown <= trigger,
  };
}
