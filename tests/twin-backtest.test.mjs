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
