import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

// lib/ 는 번들러 해석 규칙(확장자 없는 상대 경로)을 쓰므로 node 로 직접 불러올 때만 .ts 를 붙인다.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("./") && !specifier.endsWith(".ts")) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});

const { runBacktest, valuate, buyHoldPath, CASH } = await import("../lib/twin/backtest.ts");
const { deriveProfile, buildReport, characterFor, demoPortfolios } = await import("../lib/twin/profile.ts");

const snapshot = JSON.parse(readFileSync(new URL("../public/twin/shock-prices.json", import.meta.url), "utf8"));
const holdings = demoPortfolios[0].holdings;
const panicky = deriveProfile({ threshold: "shallow", action: "all", crowd: "high", profit: "part", reentry: "quarter", chase: "much" });
const steady = deriveProfile({ threshold: "deep", action: "hold", crowd: "low", profit: "keep", reentry: "month", chase: "none" });

test("스냅샷은 실제 거래일과 종가를 담고 있다", () => {
  for (const id of ["imf-1997", "gfc-2008", "covid-2020", "recent"]) {
    const window = snapshot.windows[id];
    assert.ok(window.dates.length > 200, `${id} 거래일 부족`);
    assert.equal(window.dates.length, window.closes.KOSPI.length);
    assert.ok(window.closes.KOSPI.every((value) => value === null || value > 0));
  }
});

test("버티기 경로는 100에서 시작하고 미상장 종목은 지수로 대체된다", () => {
  const base = buyHoldPath(snapshot, snapshot.windows["imf-1997"], holdings);
  assert.ok(Math.abs(base.path[0] - 100) < 1e-9);
  // 1997년에는 KODEX 200 이 상장 전이므로 대체 목록에 잡혀야 한다.
  assert.ok(base.proxied.some((item) => item.symbol === "069500"));
});

test("현금만 담으면 어떤 구간에서도 값이 변하지 않는다", () => {
  const result = runBacktest(snapshot, "covid-2020", [{ symbol: CASH, amount: 1_000_000 }], panicky);
  assert.ok(Math.abs(result.buyHoldReturn) < 1e-9);
  assert.ok(Math.abs(result.twinReturn) < 1e-9);
  assert.equal(result.events.length, 0);
});

test("버티기 성향은 매도 없이 시장 경로를 그대로 따라간다", () => {
  const result = runBacktest(snapshot, "covid-2020", holdings, steady);
  assert.equal(result.events.filter((event) => event.type === "panic-sell").length, 0);
  assert.ok(Math.abs(result.behaviorGap) < 1e-9);
});

test("코로나 급락에서 공포 성향은 매도하고 버티기보다 뒤처진다", () => {
  const result = runBacktest(snapshot, "covid-2020", holdings, panicky);
  const sells = result.events.filter((event) => event.type === "panic-sell");
  assert.ok(sells.length >= 1, "매도 이벤트가 없다");
  assert.ok(result.maxDrawdown < -0.2, `MDD ${result.maxDrawdown}`);
  assert.ok(result.twinReturn < result.buyHoldReturn, "공포 매도가 오히려 유리하게 계산됐다");
  assert.ok(result.recoveryDays !== null && result.recoveryDays > 0);
});

test("편향 리포트와 캐릭터가 만들어진다", () => {
  const result = runBacktest(snapshot, "covid-2020", holdings, panicky);
  const cards = buildReport(result, panicky);
  assert.ok(cards.length >= 3);
  assert.ok(cards.every((card) => card.headline && card.body));
  assert.equal(characterFor(panicky).key, "exit");
  assert.equal(characterFor(steady).key, "steady");
});

test("현재 평가금액은 최근 종가 기준으로 계산된다", () => {
  const valuation = valuate(snapshot, holdings);
  assert.equal(valuation.asOf, snapshot.windows.recent.dates.at(-1));
  assert.ok(valuation.total > 0);
  assert.ok(Math.abs(valuation.rows.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-9);
});

const { marketMood } = await import("../lib/twin/market-mood.ts");
const { simulateGoal, monthlyReturns } = await import("../lib/twin/goal.ts");
const { mentorVerdicts, harshest } = await import("../lib/twin/mentor.ts");

test("시장 온도계는 0~100 범위와 네 개 구성요소를 낸다", () => {
  const mood = marketMood(snapshot, holdings, panicky);
  assert.ok(mood, "온도를 계산하지 못했다");
  assert.equal(mood.asOf, snapshot.windows.recent.dates.at(-1));
  assert.ok(mood.score >= 0 && mood.score <= 100);
  assert.equal(mood.components.length, 4);
  for (const component of mood.components) assert.ok(component.score >= 0 && component.score <= 100, `${component.key} 범위 초과`);
  assert.ok(mood.drawdown <= 0, "낙폭은 0 이하여야 한다");
  assert.ok(Math.abs(mood.distance - (mood.drawdown - mood.trigger)) < 1e-12);
});

test("매도 규칙이 없는 성향은 온도계에서 트리거되지 않는다", () => {
  const mood = marketMood(snapshot, holdings, steady);
  assert.equal(mood.triggered, false);
});

test("목표 시뮬레이션은 같은 입력에 같은 결과를 준다", () => {
  const goal = { amount: 1_000_000_000, years: 10, monthly: 1_000_000 };
  const first = simulateGoal(snapshot, holdings, panicky, goal, 500_000_000);
  const second = simulateGoal(snapshot, holdings, panicky, goal, 500_000_000);
  assert.ok(first, "시뮬레이션 실패");
  assert.deepEqual(first, second, "같은 입력인데 결과가 흔들린다");
  assert.equal(first.months, 120);
  assert.equal(first.paths, 1000);
  assert.ok(first.sampleMonths > 100, `표본 ${first.sampleMonths}개월`);
  for (const outcome of [first.hold, first.twin]) {
    assert.ok(outcome.successRate >= 0 && outcome.successRate <= 1);
    assert.ok(outcome.low <= outcome.median && outcome.median <= outcome.high);
  }
});

test("월간 수익률 표본은 실제 구간에서 나온다", () => {
  const samples = monthlyReturns(snapshot, holdings);
  assert.ok(samples.length > 100);
  assert.ok(samples.every((value) => Number.isFinite(value) && value > -1));
});

test("대가 진단은 세 개의 서로 다른 점수를 낸다", () => {
  const input = { cashWeight: 0.02, topWeight: 0.63, topName: "SK하이닉스", herfindahl: 0.49, assetCount: 4, sectorCount: 3, moodScore: 22, moodLabel: "극단적 공포", drawdown: -0.18, behaviorGap: -0.4, windowLabel: "2020 코로나 급락", tradeCount: 11, character: "공포 이탈형" };
  const verdicts = mentorVerdicts(input);
  assert.equal(verdicts.length, 3);
  for (const verdict of verdicts) assert.ok(verdict.score >= 5 && verdict.score <= 95, `${verdict.key} ${verdict.score}`);
  assert.equal(harshest(verdicts).score, Math.min(...verdicts.map((verdict) => verdict.score)));
  // 집중도가 높으면 분산 원칙 점수가 집중을 허용하는 원칙보다 낮게 나와야 한다.
  const spread = mentorVerdicts({ ...input, topWeight: 0.25, herfindahl: 0.2, sectorCount: 5 });
  assert.ok(spread.find((v) => v.key === "dalio").score > verdicts.find((v) => v.key === "dalio").score);
});

test("목표 금액만 바꾸면 분포는 그대로고 달성률만 움직인다", () => {
  const base = { years: 10, monthly: 1_000_000 };
  const low = simulateGoal(snapshot, holdings, panicky, { ...base, amount: 1_000_000_000 }, 500_000_000);
  const high = simulateGoal(snapshot, holdings, panicky, { ...base, amount: 3_000_000_000 }, 500_000_000);
  assert.equal(low.hold.median, high.hold.median, "목표만 바꿨는데 경로가 달라졌다");
  assert.equal(low.twin.high, high.twin.high);
  assert.ok(low.hold.successRate > high.hold.successRate, "목표가 커졌는데 달성률이 안 떨어졌다");
});
