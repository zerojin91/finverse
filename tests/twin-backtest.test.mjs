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
const { mentorVerdicts, mostSevere, stanceLabels } = await import("../lib/twin/mentor.ts");

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


const mentorBase = {
  stockWeight: 0.85, cashWeight: 0.15, moodScore: 30, moodLabel: "공포", drawdown: -0.24,
  windowLabel: "2020 코로나 급락", buyHoldReturn: 0.438, behaviorGap: -0.076, tradeCount: 3, soldCount: 1,
  reentered: true, character: "공포 이탈형", panicThreshold: -0.07, reentryDelay: 60,
};

test("네 사람이 서로 다른 것을 보고 입장을 낸다", () => {
  const verdicts = mentorVerdicts(mentorBase);
  assert.deepEqual(verdicts.map((v) => v.key), ["buffett", "marks", "kahneman", "parkhyeonjoo"]);
  for (const verdict of verdicts) {
    assert.ok(["ok", "watch", "risk"].includes(verdict.stance), `${verdict.key} ${verdict.stance}`);
    assert.ok(stanceLabels[verdict.stance]);
    assert.ok(verdict.check.length > 5, `${verdict.key} 확인 항목 없음`);
    assert.ok(verdict.question.length > 5);
  }
  // 네 사람의 본문이 서로 달라야 한다. 같은 말을 반복하면 패널이 의미를 잃는다.
  assert.equal(new Set(verdicts.map((v) => v.body)).size, 4);
  assert.equal(mostSevere(verdicts).stance, "risk");
});

test("입장은 각자 보는 데이터에만 반응한다", () => {
  const stance = (input, key) => mentorVerdicts(input).find((v) => v.key === key).stance;
  // 버핏은 매매 빈도와 비중에 반응한다.
  assert.equal(stance({ ...mentorBase, tradeCount: 5 }, "buffett"), "risk");
  assert.equal(stance({ ...mentorBase, tradeCount: 0, stockWeight: 0.5, cashWeight: 0.5 }, "buffett"), "ok");
  // 막스는 시장 온도와 현금에 반응한다. 매매 횟수를 바꿔도 그대로다.
  assert.equal(stance({ ...mentorBase, cashWeight: 0.05 }, "marks"), "risk");
  assert.equal(stance({ ...mentorBase, tradeCount: 9 }, "marks"), stance(mentorBase, "marks"));
  // 카너먼은 백테스트 결과에 반응한다. 비중을 바꿔도 그대로다.
  assert.equal(stance({ ...mentorBase, soldCount: 1, reentered: false }, "kahneman"), "risk");
  assert.equal(stance({ ...mentorBase, behaviorGap: 0.02, soldCount: 1 }, "kahneman"), "ok");
  assert.equal(stance({ ...mentorBase, stockWeight: 0.2, cashWeight: 0.8 }, "kahneman"), stance(mentorBase, "kahneman"));
  // 박현주는 국내주식 비중에만 반응한다.
  assert.equal(stance({ ...mentorBase, stockWeight: 0.9 }, "parkhyeonjoo"), "risk");
  assert.equal(stance({ ...mentorBase, stockWeight: 0.2 }, "parkhyeonjoo"), "ok");
  assert.equal(stance({ ...mentorBase, moodScore: 90 }, "parkhyeonjoo"), stance(mentorBase, "parkhyeonjoo"));
});

test("시나리오를 가져오면 막스만 그것을 언급한다", () => {
  const scenario = { title: "반도체 실적 미스", forecast: "KOSPI -13.8%", holdReturn: -0.118, myReturn: -0.077, sold: true };
  const withScenario = mentorVerdicts({ ...mentorBase, scenario });
  const mentions = withScenario.filter((v) => v.body.includes("반도체 실적 미스"));
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].key, "marks");
  // 시나리오가 없으면 아무도 언급하지 않는다.
  assert.equal(mentorVerdicts(mentorBase).filter((v) => v.body.includes("시나리오")).length, 0);
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

const { observedTraits } = await import("../lib/twin/games.ts");

test("유형 판정은 관측한 항목만 쓴다", () => {
  const held = { id: "hold", sellDrawdown: null, sellFraction: 0, reentryGap: null, trimmed: 0, chased: 0, finalReturn: 0, buyHoldReturn: 0, records: [] };
  const onlyHold = { hold: held };
  const profile = deriveProfileFromGames(onlyHold);
  // 버티기만 했고 끝까지 안 팔았으면 무던한 장기형이어야 한다.
  // 예전에는 채워 넣은 chase 기본값 0.4 때문에 이 유형에 닿을 수 없었다.
  assert.equal(characterFor(profile, observedTraits(onlyHold)).key, "steady");
  // 관측 범위를 무시하면 기본값이 판정을 가로챈다.
  assert.notEqual(characterFor(profile).key, "steady");
});

test("관측이 모자라면 균형 탐색형이 아니라 판정 보류가 된다", () => {
  const halfSell = { id: "hold", sellDrawdown: -0.12, sellFraction: 0.5, reentryGap: 24, trimmed: 0, chased: 0, finalReturn: 0, buyHoldReturn: 0, records: [] };
  const onlyHold = { hold: halfSell };
  const character = characterFor(deriveProfileFromGames(onlyHold), observedTraits(onlyHold));
  assert.equal(character.key, "unknown");
  assert.equal(character.provisional, true);
  // 아무 게임도 안 했으면 역시 보류다.
  assert.equal(characterFor(deriveProfileFromGames({}), observedTraits({})).key, "unknown");
  // 설문은 여섯 문항을 다 받으므로 보류가 나오지 않는다.
  for (const answers of [
    { threshold: "mid", action: "half", crowd: "mid", profit: "part", reentry: "month", chase: "some" },
    { threshold: "deep", action: "hold", crowd: "low", profit: "keep", reentry: "month", chase: "none" },
  ]) {
    assert.notEqual(characterFor(deriveProfile(answers)).key, "unknown");
  }
});

test("네 게임을 다 하면 판정 보류가 사라진다", () => {
  const full = {
    hold: { id: "hold", sellDrawdown: -0.12, sellFraction: 0.5, reentryGap: 24, trimmed: 0, chased: 0, finalReturn: 0, buyHoldReturn: 0, records: [] },
    crowd: { id: "crowd", sellDrawdown: -0.1, sellFraction: 1, reentryGap: null, trimmed: 0, chased: 0, finalReturn: 0, buyHoldReturn: 0, records: [] },
    profit: { id: "profit", sellDrawdown: null, sellFraction: 0, reentryGap: null, trimmed: 0.5, chased: 0, finalReturn: 0, buyHoldReturn: 0, records: [] },
    lottery: { lambda: 2, consistent: true },
  };
  const character = characterFor(deriveProfileFromGames(full), observedTraits(full));
  assert.notEqual(character.key, "unknown");
  assert.ok(!character.provisional);
});

test("헤드라인이 입장보다 앞서 나가지 않는다", () => {
  // 현금이 넉넉하면 "괜찮습니다"인데 헤드라인이 부족을 지적하면 안 된다.
  const easy = mentorVerdicts({ ...mentorBase, cashWeight: 0.4, stockWeight: 0.6 }).find((v) => v.key === "marks");
  assert.equal(easy.stance, "ok");
  assert.ok(!easy.headline.includes("뿐입니다"), easy.headline);
  const tight = mentorVerdicts({ ...mentorBase, cashWeight: 0.05, stockWeight: 0.95 }).find((v) => v.key === "marks");
  assert.equal(tight.stance, "risk");
  assert.ok(tight.headline.includes("뿐입니다"), tight.headline);
});
