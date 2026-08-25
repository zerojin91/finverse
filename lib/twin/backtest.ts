// 마이 금융 트윈 계산 엔진.
//
// 두 개의 경로를 만든다.
//   1) 버티기 경로  - 사용자가 담은 자산을 실제 과거 종가로 그대로 평가한 값
//   2) 트윈 경로    - 같은 구간에서 사용자의 행동 성향이 실제로 했을 매매를 반영한 값
//
// 두 경로의 차이가 곧 "시장이 아니라 내 행동이 만든 손익"이다.  가격은 전부
// public/twin/shock-prices.json 의 실제 종가이고, 매매 규칙은 결정적이다.
// 생성형 모델은 이 숫자를 만들지 않는다.

export type SnapshotAsset = { symbol: string; name: string; kind: "stock" | "etf"; sector: string };
export type SnapshotWindow = {
  id: string;
  label: string;
  period: string;
  summary: string;
  start: string;
  end: string;
  dates: string[];
  closes: Record<string, (number | null)[]>;
};
export type PriceSnapshot = { generatedAt: string; source: string; assets: SnapshotAsset[]; windows: Record<string, SnapshotWindow> };

export const CASH = "CASH";

/** 사용자가 담은 자산 한 줄. amount 는 투입 금액(원). */
export type Holding = { symbol: string; amount: number };

/** 온보딩 6문항에서 나오는 행동 파라미터. */
export type BehaviorProfile = {
  /** 이 낙폭에 닿으면 견디지 못한다 (음수, 예: -0.2) */
  panicDrawdown: number;
  /** 그때 파는 비중 0~1. 0 이면 버틴다 */
  panicAction: number;
  /** 커뮤니티·뉴스에 흔들리는 정도 0~1. 높을수록 더 얕은 낙폭에서 판다 */
  herding: number;
  /** 이익 구간에서 조기 익절하는 정도 0~1 */
  disposition: number;
  /** 판 뒤 다시 들어가기까지 걸리는 거래일 */
  reentryDelay: number;
  /** 신고가에서 추격 매수하는 정도 0~1 */
  chase: number;
};

export type TradeEvent = {
  index: number;
  date: string;
  type: "panic-sell" | "reentry" | "take-profit" | "chase-buy";
  position: number;
  detail: string;
};

export type BacktestResult = {
  window: SnapshotWindow;
  dates: string[];
  /** 시작 100 기준 버티기 경로 */
  buyHold: number[];
  /** 시작 100 기준 트윈 경로 */
  twin: number[];
  /** 시작 100 기준 코스피 경로 */
  index: number[];
  buyHoldReturn: number;
  twinReturn: number;
  /** 트윈 - 버티기. 음수면 행동이 손실을 만들었다 */
  behaviorGap: number;
  maxDrawdown: number;
  troughIndex: number;
  /** 저점 직전 고점을 회복하기까지 걸린 거래일. 구간 안에 회복이 없으면 null */
  recoveryDays: number | null;
  events: TradeEvent[];
  /** 구간에 상장돼 있지 않아 코스피 지수로 대체한 종목 */
  proxied: { symbol: string; name: string }[];
};

const seriesFor = (window: SnapshotWindow, symbol: string) => window.closes[symbol] ?? null;

/** 결측을 직전 값으로 메운 정규화 시계열. 첫 값이 비어 있으면 null 을 돌려준다. */
function normalized(closes: (number | null)[] | null): number[] | null {
  if (!closes || closes[0] === null || closes[0] === undefined) return null;
  const base = closes[0] as number;
  let last = base;
  return closes.map((value) => {
    if (value !== null && value !== undefined) last = value;
    return last / base;
  });
}

export function formatSnapshotDate(compact: string) {
  return `${compact.slice(0, 4)}.${compact.slice(4, 6)}.${compact.slice(6, 8)}`;
}

/** 담은 자산을 실제 종가로 평가한 버티기 경로(시작 100). */
export function buyHoldPath(snapshot: PriceSnapshot, window: SnapshotWindow, holdings: Holding[]) {
  const total = holdings.reduce((sum, holding) => sum + holding.amount, 0);
  const indexPath = normalized(seriesFor(window, "KOSPI"));
  if (!indexPath || total <= 0) return null;
  const proxied: { symbol: string; name: string }[] = [];
  const path = window.dates.map(() => 0);
  for (const holding of holdings) {
    const weight = holding.amount / total;
    if (holding.symbol === CASH) {
      for (let day = 0; day < path.length; day += 1) path[day] += weight;
      continue;
    }
    let assetPath = normalized(seriesFor(window, holding.symbol));
    if (!assetPath) {
      // 그 시절에 없던 종목은 코스피 지수 경로로 대체하고 화면에 표시한다.
      assetPath = indexPath;
      const asset = snapshot.assets.find((item) => item.symbol === holding.symbol);
      proxied.push({ symbol: holding.symbol, name: asset?.name ?? holding.symbol });
    }
    for (let day = 0; day < path.length; day += 1) path[day] += weight * assetPath[day];
  }
  return { path: path.map((value) => value * 100), index: indexPath.map((value) => value * 100), proxied };
}

/** 버티기 경로 위에서 행동 성향이 했을 매매를 하루 단위로 재생한다. */
function replayBehavior(dates: string[], buyHold: number[], profile: BehaviorProfile) {
  const events: TradeEvent[] = [];
  const twin = [100];
  let position = 1;
  let peak = 100;
  let value = 100;
  let exitIndex: number | null = null;
  let exitPosition = 1;
  let lowAfterExit = Infinity;
  let profitSteps = 0;
  const threshold = profile.panicDrawdown * (1 - profile.herding * 0.35);

  for (let day = 1; day < buyHold.length; day += 1) {
    const marketReturn = buyHold[day] / buyHold[day - 1] - 1;
    value *= 1 + position * marketReturn;
    const drawdown = value / peak - 1;

    if (position > 0 && profile.panicAction > 0 && drawdown <= threshold) {
      const sold = position * profile.panicAction;
      exitPosition = position;
      position -= sold;
      exitIndex = day;
      lowAfterExit = buyHold[day];
      events.push({
        index: day,
        date: dates[day],
        type: "panic-sell",
        position,
        detail: `고점 대비 ${(drawdown * 100).toFixed(1)}% 구간에서 보유의 ${(profile.panicAction * 100).toFixed(0)}%를 정리`,
      });
    } else if (exitIndex !== null && position < exitPosition) {
      lowAfterExit = Math.min(lowAfterExit, buyHold[day]);
      const waited = day - exitIndex;
      const rebounded = buyHold[day] / lowAfterExit - 1 >= 0.03;
      if (waited >= profile.reentryDelay && rebounded) {
        position = exitPosition;
        // 다시 산 가격이 새로운 기준점이 된다(기준점 의존).  이 초기화가 없으면
        // 예전 고점 대비 낙폭이 그대로 남아 재진입 다음 날 곧바로 되팔게 된다.
        peak = value;
        events.push({
          index: day,
          date: dates[day],
          type: "reentry",
          position,
          detail: `${waited}거래일 기다린 뒤 저점 대비 ${((buyHold[day] / lowAfterExit - 1) * 100).toFixed(1)}% 오른 가격에 재진입`,
        });
        exitIndex = null;
      }
    }

    if (profile.disposition > 0 && position > 0.3) {
      const gain = value / 100 - 1;
      if (gain >= 0.2 * (profitSteps + 1)) {
        profitSteps += 1;
        const sold = position * 0.3 * profile.disposition;
        position -= sold;
        events.push({
          index: day,
          date: dates[day],
          type: "take-profit",
          position,
          detail: `누적 ${(gain * 100).toFixed(0)}% 구간에서 ${(sold * 100).toFixed(0)}%p를 미리 익절`,
        });
      }
    }

    if (profile.chase > 0 && position < 1 && value > peak && exitIndex === null) {
      const added = Math.min(1 - position, 0.5 * profile.chase);
      if (added > 0.05) {
        position += added;
        events.push({ index: day, date: dates[day], type: "chase-buy", position, detail: "신고가를 확인하고 남은 현금으로 추격 매수" });
      }
    }

    peak = Math.max(peak, value);
    twin.push(value);
  }
  return { twin, events };
}

export function runBacktest(
  snapshot: PriceSnapshot,
  windowId: string,
  holdings: Holding[],
  profile: BehaviorProfile,
): BacktestResult | null {
  const window = snapshot.windows[windowId];
  if (!window) return null;
  const base = buyHoldPath(snapshot, window, holdings);
  if (!base) return null;
  const { twin, events } = replayBehavior(window.dates, base.path, profile);

  let peak = base.path[0];
  let maxDrawdown = 0;
  let troughIndex = 0;
  let peakAtTrough = base.path[0];
  for (let day = 0; day < base.path.length; day += 1) {
    peak = Math.max(peak, base.path[day]);
    const drawdown = base.path[day] / peak - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      troughIndex = day;
      peakAtTrough = peak;
    }
  }
  let recoveryDays: number | null = null;
  for (let day = troughIndex; day < base.path.length; day += 1) {
    if (base.path[day] >= peakAtTrough) { recoveryDays = day - troughIndex; break; }
  }

  return {
    window,
    dates: window.dates,
    buyHold: base.path,
    twin,
    index: base.index,
    buyHoldReturn: base.path.at(-1)! / 100 - 1,
    twinReturn: twin.at(-1)! / 100 - 1,
    behaviorGap: (twin.at(-1)! - base.path.at(-1)!) / 100,
    maxDrawdown,
    troughIndex,
    recoveryDays,
    events,
    proxied: base.proxied,
  };
}

/** 현재 평가 상태. 최근 구간 스냅샷의 마지막 종가와 그 전 거래일을 쓴다. */
export type Valuation = {
  asOf: string;
  total: number;
  dayChange: number;
  dayChangePct: number;
  cashWeight: number;
  rows: {
    symbol: string;
    name: string;
    sector: string;
    close: number | null;
    amount: number;
    weight: number;
    changePct: number;
    contribution: number;
  }[];
};

export function valuate(snapshot: PriceSnapshot, holdings: Holding[]): Valuation | null {
  const window = snapshot.windows.recent;
  if (!window) return null;
  const invested = holdings.reduce((sum, holding) => sum + holding.amount, 0);
  if (invested <= 0) return null;
  const rows = holdings.map((holding) => {
    const asset = snapshot.assets.find((item) => item.symbol === holding.symbol);
    const closes = seriesFor(window, holding.symbol);
    const last = closes?.at(-1) ?? null;
    const previous = closes?.at(-2) ?? null;
    const changePct = last !== null && previous !== null && previous !== 0 ? last / previous - 1 : 0;
    const path = normalized(closes);
    // 투입 금액이 지금까지 실제 종가를 따라 움직인 평가금액.
    const amount = holding.symbol === CASH || !path ? holding.amount : holding.amount * path.at(-1)!;
    return {
      symbol: holding.symbol,
      name: holding.symbol === CASH ? "현금" : asset?.name ?? holding.symbol,
      sector: holding.symbol === CASH ? "유동성" : asset?.sector ?? "",
      close: last,
      amount,
      weight: 0,
      changePct,
      contribution: amount * changePct,
    };
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  for (const row of rows) row.weight = total ? row.amount / total : 0;
  const dayChange = rows.reduce((sum, row) => sum + row.contribution, 0);
  return {
    asOf: window.dates.at(-1)!,
    total,
    dayChange,
    dayChangePct: total - dayChange ? dayChange / (total - dayChange) : 0,
    cashWeight: rows.filter((row) => row.symbol === CASH).reduce((sum, row) => sum + row.weight, 0),
    rows,
  };
}
