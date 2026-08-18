import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the interactive FINVERSE Market Insight", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>FINVERSE \| 시장 인사이트와 마이 금융 트윈<\/title>/i);
  assert.match(html, /FINVERSE/);
  assert.match(html, /시장 인사이트/);
  assert.match(html, /마이 금융 트윈/);
  assert.match(html, /sidebar-brand/);
  assert.doesNotMatch(html, /top-tabs/);
  assert.match(html, /금융 판단 실험실/);
  assert.match(html, /MARKET INSIGHT/);
  assert.match(html, /6,023\.66/);
  assert.match(html, /-732\.09/);
  assert.match(html, /10\.84/);
  assert.match(html, /KOSPI 조건부 반등/);
  assert.match(html, /코스닥/);
  assert.match(html, /S&amp;P 500/);
  assert.match(html, /나스닥/);
  assert.equal((html.match(/class="market-overview-mini"/g) ?? []).length, 3);
  assert.equal((html.match(/>당일<\/em>/g) ?? []).length, 0);
  assert.match(html, /aria-label="AI 요약 전문 보기"/);
  assert.doesNotMatch(html, /AI 요약 · 장마감 배치/);
  assert.match(html, /외국인 순매수 회복/);
  assert.match(html, /AI CapEx/);
  assert.match(html, /반도체 실적 미스·AI CapEx 둔화/);
  assert.match(html, /외국인 매도·원화 약세 재확산/);
  assert.match(html, /SK하이닉스 실적 하회/);
  assert.match(html, /원·달러·금리/);
  assert.match(html, /발생 가능 이벤트/);
  assert.match(html, /내 시나리오 예측하기/);
  assert.match(html, /SELECTED SCENARIO/);
  assert.match(html, /시나리오 전제/);
  assert.match(html, /예상 전개/);
  assert.doesNotMatch(html, /내 금융 상태/);
  assert.doesNotMatch(html, /종목이 아니라, 연결을 봅니다/);
  assert.doesNotMatch(html, /KOSPI 연결 지도/);
  assert.doesNotMatch(html, /Properties|Relations/);
  assert.doesNotMatch(html, /영향 시뮬레이션/);
  assert.doesNotMatch(html, /시장 인사이트\(예비\)/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});
