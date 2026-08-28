// 시나리오 앞으로의 경로.
//
// 시장 인사이트에서 고른 시나리오의 조건부 경로를 내 배분(국내주식 + 현금)에
// 그대로 적용하고, 같은 경로 위에서 내 행동 규칙이 무엇을 했을지 계산한다.
// 과거 타임머신이 "그때 나였다면"이라면 이 계산은 "이 시나리오대로라면"이다.
//
// 과거 구간과 판단 주기가 다르다.  타임머신은 몇 년짜리 구간이라 한 달에 한 번
// 판단하지만, 시나리오는 한 달짜리 경로라 그 리듬으로는 판단이 한 번도 일어나지
// 않는다.  급하게 움직이는 한 달에는 사람도 주 단위로 계좌를 본다고 본다.
//
// 경로 자체는 예측이 아니라 시나리오의 전제다.  화면에서 그렇게 표시한다.

import { effectivePanicThreshold, type BehaviorProfile } from "./backtest";

/** 경로 몇 포인트마다 판단하는가. 12포인트 1개월 경로에서 대략 주 단위가 된다. */
const DECISION_EVERY = 2;
/** 한 번 손대면 이만큼은 쉰다(포인트). */
const COOLDOWN = 3;
/** 저점 대비 이만큼 올라야 다시 들어간다. 한 달 구간이라 과거보다 낮게 잡는다. */
const REENTRY_REBOUND = 0.05;
/** 한 달 안에서 미리 익절하는 기준. */
const PROFIT_TARGET = 0.15;

export type ForwardEvent = { index: number; type: "sell" | "reentry" | "take-profit" | "chase-buy"; detail: string };

export type ForwardResult = {
  /** 시작 100 기준, 손대지 않았을 때의 경로 */
  hold: number[];
  /** 시작 100 기준, 내 행동 규칙을 적용한 경로 */
  mine: number[];
  events: ForwardEvent[];
  holdReturn: number;
  myReturn: number;
  /** 내 경로 - 손대지 않은 경로 */
  gap: number;
  /** 손대지 않았을 때 겪는 최대 낙폭 */
  worstDrawdown: number;
};

export function projectForward(path: number[], stockWeight: number, profile: BehaviorProfile): ForwardResult | null {
  if (path.length < 3 || !path[0]) return null;

  const hold = path.map((value) => 100 * (stockWeight * (value / path[0]) + (1 - stockWeight)));
  const threshold = effectivePanicThreshold(profile);
  const reentryPoints = Math.max(1, Math.ceil(profile.reentryDelay / DECISION_EVERY));

  let stock = 100 * stockWeight;
  let cash = 100 * (1 - stockWeight);
  let targetWeight = stockWeight;
  let peak = 100;
  let exitIndex: number | null = null;
  let lowAfterExit = Infinity;
  let lastAction = -COOLDOWN;
  let tookProfit = false;
  let chased = false;
  const mine = [100];
  const events: ForwardEvent[] = [];

  for (let index = 1; index < path.length; index += 1) {
    stock *= path[index] / path[index - 1];
    let value = stock + cash;
    if (exitIndex !== null) lowAfterExit = Math.min(lowAfterExit, path[index]);

    if (index % DECISION_EVERY === 0 && index - lastAction >= COOLDOWN) {
      const drawdown = value / peak - 1;
      const weight = value ? stock / value : 0;

      if (weight > 0.01 && profile.panicAction > 0 && drawdown <= threshold && exitIndex === null) {
        targetWeight = weight;
        const sold = stock * profile.panicAction;
        stock -= sold;
        cash += sold;
        exitIndex = index;
        lowAfterExit = path[index];
        lastAction = index;
        events.push({
          index,
          type: "sell",
          detail: `${(drawdown * 100).toFixed(1)}% 구간에서 주식의 ${(profile.panicAction * 100).toFixed(0)}%를 정리`,
        });
      } else if (exitIndex !== null) {
        const rebound = path[index] / lowAfterExit - 1;
        if (index - exitIndex >= reentryPoints && rebound >= REENTRY_REBOUND) {
          stock = value * targetWeight;
          cash = value - stock;
          peak = value;
          exitIndex = null;
          lastAction = index;
          events.push({ index, type: "reentry", detail: `저점 대비 ${(rebound * 100).toFixed(1)}% 오른 가격에 다시 매수` });
        }
      } else if (!tookProfit && profile.disposition > 0 && value / 100 - 1 >= PROFIT_TARGET) {
        tookProfit = true;
        const sold = stock * 0.3 * profile.disposition;
        stock -= sold;
        cash += sold;
        lastAction = index;
        events.push({ index, type: "take-profit", detail: `누적 ${((value / 100 - 1) * 100).toFixed(0)}% 구간에서 일부 익절` });
      } else if (!chased && profile.chase > 0 && cash > 1 && value > peak) {
        chased = true;
        const bought = cash * 0.5 * profile.chase;
        cash -= bought;
        stock += bought;
        lastAction = index;
        events.push({ index, type: "chase-buy", detail: "신고가를 확인하고 남은 현금으로 추격 매수" });
      }
    }

    value = stock + cash;
    peak = Math.max(peak, value);
    mine.push(value);
  }

  let holdPeak = hold[0];
  let worstDrawdown = 0;
  for (const value of hold) {
    holdPeak = Math.max(holdPeak, value);
    worstDrawdown = Math.min(worstDrawdown, value / holdPeak - 1);
  }

  return {
    hold,
    mine,
    events,
    holdReturn: hold.at(-1)! / 100 - 1,
    myReturn: mine.at(-1)! / 100 - 1,
    gap: (mine.at(-1)! - hold.at(-1)!) / 100,
    worstDrawdown,
  };
}
