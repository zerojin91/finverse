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
const { deriveProfile, buildReport, characterFor, allocationHoldings } = await import("../lib/twin/profile.ts");

const snapshot = JSON.parse(readFileSync(new URL("../public/twin/shock-prices.json", import.meta.url), "utf8"));
// 기본 배분: 국내주식 80% / 현금 20%
const holdings = allocationHoldings(100_000_000, 0.8);
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
  // 종목을 직접 지정한 경우에도 그 시절 없던 종목은 지수로 대체된다.
  const withEtf = [{ symbol: "005930", amount: 50_000_000 }, { symbol: "069500", amount: 50_000_000 }];
  const base = buyHoldPath(snapshot, snapshot.windows["imf-1997"], withEtf);
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


test("대가 진단은 주식·현금 비중으로 세 점수를 낸다", () => {
  const input = { stockWeight: 0.95, cashWeight: 0.05, moodScore: 22, moodLabel: "극단적 공포", drawdown: -0.18, behaviorGap: -0.4, windowLabel: "2020 코로나 급락", tradeCount: 3, character: "공포 이탈형" };
  const verdicts = mentorVerdicts(input);
  assert.equal(verdicts.length, 3);
  for (const verdict of verdicts) assert.ok(verdict.score >= 5 && verdict.score <= 95, `${verdict.key} ${verdict.score}`);
  assert.equal(harshest(verdicts).score, Math.min(...verdicts.map((verdict) => verdict.score)));
  const score = (list, key) => list.find((verdict) => verdict.key === key).score;
  // 한쪽으로 몰릴수록 균형 점수가 낮아야 한다.
  const balanced = mentorVerdicts({ ...input, stockWeight: 0.6, cashWeight: 0.4 });
  assert.ok(score(balanced, "dalio") > score(verdicts, "dalio"));
  assert.ok(score(mentorVerdicts({ ...input, stockWeight: 0.05, cashWeight: 0.95 }), "dalio") < score(balanced, "dalio"));
  // 자주 손댈수록 "오래 들고 갈 수 있는가" 점수가 낮아야 한다.
  assert.ok(score(mentorVerdicts({ ...input, tradeCount: 0 }), "buffett") > score(verdicts, "buffett"));
});

const { loadSlice, replayGames, summarizeReplay, deriveProfileFromGames, scoreLottery, lotteryPairs, playedCount } = await import("../lib/twin/games.ts");

test("게임 구간은 실제 거래일로 잘리고 턴이 끝까지 덮는다", () => {
  for (const config of replayGames) {
    const slice = loadSlice(snapshot, config);
    assert.ok(slice, `${config.id} 슬라이스 실패`);
    assert.ok(slice.closes.length > config.turns, `${config.id} 거래일 부족`);
    assert.equal(slice.closes.length, slice.dates.length);
    assert.ok(slice.closes.every((value) => value > 0), `${config.id} 결측 종가`);
    assert.equal(slice.stops.length, config.turns);
    assert.equal(slice.stops.at(-1), slice.closes.length - 1, `${config.id} 마지막 턴이 끝을 못 덮는다`);
    for (let turn = 1; turn < slice.stops.length; turn += 1) assert.ok(slice.stops[turn] > slice.stops[turn - 1]);
    if (config.feed) assert.ok(config.feed.length >= config.turns, `${config.id} 피드가 턴보다 적다`);
  }
});

test("누른 기록에서 매도 낙폭과 재진입 간격을 뽑아낸다", () => {
  const config = replayGames[0];
  const slice = loadSlice(snapshot, config);
  const records = [
    { turn: 0, action: "hold", drawdown: 0, session: slice.stops[0], position: 1 },
    { turn: 1, action: "sell-all", drawdown: -0.18, session: slice.stops[1], position: 0 },
    { turn: 4, action: "buy", drawdown: -0.18, session: slice.stops[4], position: 1 },
  ];
  const result = summarizeReplay(config, slice, records, 92);
  assert.equal(result.sellDrawdown, -0.18);
  assert.equal(result.sellFraction, 1);
  assert.equal(result.reentryGap, slice.stops[4] - slice.stops[1]);
  assert.ok(Math.abs(result.finalReturn - -0.08) < 1e-9);
  assert.ok(Math.abs(result.buyHoldReturn - (slice.closes.at(-1) / slice.closes[0] - 1)) < 1e-12);
});

test("관측 결과가 설문과 같은 프로필로 환산된다", () => {
  const hold = { id: "hold", sellDrawdown: -0.2, sellFraction: 1, reentryGap: 40, trimmed: 0, chased: 0, finalReturn: 0, buyHoldReturn: 0, records: [] };
  const only = deriveProfileFromGames({ hold });
  assert.equal(only.panicDrawdown, -0.2);
  assert.equal(only.panicAction, 1);
  assert.equal(only.reentryDelay, 40);
  // 군중 피드에서 15%p 더 일찍 팔면 군집성이 최대가 된다.
  const crowd = { ...hold, id: "crowd", sellDrawdown: -0.05 };
  assert.equal(deriveProfileFromGames({ hold, crowd }).herding, 1);
  // 늦게 팔았으면 군집성은 0.
  assert.equal(deriveProfileFromGames({ hold, crowd: { ...crowd, sellDrawdown: -0.3 } }).herding, 0);
  // 끝까지 안 팔면 가장 깊은 임계로 둔다.
  assert.equal(deriveProfileFromGames({ hold: { ...hold, sellDrawdown: null, reentryGap: null } }).panicDrawdown, -0.45);
  // 아무 게임도 안 하면 중립값.
  assert.deepEqual(deriveProfileFromGames({}), { panicDrawdown: -0.45, panicAction: 0.5, herding: 0.45, reentryDelay: 20, disposition: 0.5, chase: 0.4 });
});

test("복권 선택에서 손실 민감도와 반사효과를 잡아낸다", () => {
  assert.equal(lotteryPairs.length, 6);
  const reflex = scoreLottery(["risky", "risky", "risky", "certain", "certain", "certain"]);
  assert.equal(reflex.lambda, 5.5);
  assert.equal(reflex.consistent, false);
  const steadyHand = scoreLottery(["certain", "certain", "certain", "certain", "certain", "certain"]);
  assert.equal(steadyHand.lambda, 1);
  assert.equal(steadyHand.consistent, true);
  assert.equal(playedCount({ hold: {}, lottery: reflex }), 2);
});

test("트윈은 판단일에만 움직이고 매도 뒤에는 쉰다", () => {
  const twoBucket = allocationHoldings(100_000_000, 0.8);
  for (const id of Object.keys(snapshot.windows)) {
    const result = runBacktest(snapshot, id, twoBucket, panicky);
    // 개수를 못박지 않는다. 성향이 정하는 값이고, 보장해야 할 건 리듬이다.
    for (const event of result.events) assert.equal(event.index % 21, 0, `${id} 판단일이 아닌 날 매매`);
    const sells = result.events.filter((event) => event.type === "panic-sell");
    for (let index = 1; index < sells.length; index += 1) {
      assert.ok(sells[index].index - sells[index - 1].index >= 63, `${id} 매도 간격이 3개월 미만`);
    }
    // 100거래일당 2건을 넘지 않는다. 하루 단위로 재생하던 시절엔 이 값을 넘겼다.
    const rate = (result.events.length / result.dates.length) * 100;
    assert.ok(rate <= 2, `${id} 100거래일당 ${rate.toFixed(2)}건 — 너무 잦다`);
  }
});

test("재진입은 매도 직전 비중으로 되돌아간다", () => {
  const half = deriveProfile({ threshold: "shallow", action: "half", crowd: "low", profit: "keep", reentry: "month", chase: "none" });
  const twoBucket = [{ symbol: "KOSPI", amount: 100_000_000 }];
  for (const id of Object.keys(snapshot.windows)) {
    const result = runBacktest(snapshot, id, twoBucket, half);
    for (const event of result.events.filter((item) => item.type === "reentry")) {
      // 부분 매도(50%) 뒤 재진입이면 다시 100% 여야 한다. 연속 매도로 깎이면 안 된다.
      assert.ok(event.position > 0.99, `${id} 재진입 비중 ${event.position}`);
    }
  }
});

const { projectForward } = await import("../lib/twin/forward.ts");

test("시나리오 경로를 내 배분에 적용한다", () => {
  const down = [6023.66, 5900, 5750, 5650, 5520, 5400, 5330, 5260, 5220, 5200, 5180, 5190];
  const up = [6023.66, 6200, 6400, 6650, 6800, 6950, 7050, 7180, 7280, 7380, 7460, 7500];
  // 주식 85% 이면 지수 -13.8% 는 내 자산 -11.7% 쯤이 된다. 현금이 나머지를 붙든다.
  const hold = projectForward(down, 0.85, steady);
  assert.ok(Math.abs(hold.holdReturn - 0.85 * (down.at(-1) / down[0] - 1)) < 1e-9);
  assert.equal(hold.events.length, 0, "버티기 성향인데 매매가 생겼다");
  assert.ok(Math.abs(hold.gap) < 1e-9);
  // 현금만 있으면 어떤 경로에서도 값이 변하지 않는다.
  const allCash = projectForward(down, 0, panicky);
  assert.ok(Math.abs(allCash.holdReturn) < 1e-9);
  assert.ok(Math.abs(allCash.myReturn) < 1e-9);
  // 공포 성향은 하락 경로에서 팔고, 그래서 그대로 둔 경우보다 덜 잃는다.
  const panicked = projectForward(down, 0.85, panicky);
  assert.ok(panicked.events.some((event) => event.type === "sell"), "하락 경로인데 매도가 없다");
  assert.ok(panicked.myReturn > panicked.holdReturn);
  // 상승 경로에서는 낙폭이 없어 매도가 나오지 않는다.
  assert.equal(projectForward(up, 0.85, panicky).events.filter((event) => event.type === "sell").length, 0);
  assert.ok(projectForward(up, 0.85, panicky).worstDrawdown === 0);
  // 포인트가 너무 적으면 계산하지 않는다.
  assert.equal(projectForward([100, 101], 0.5, panicky), null);
});
