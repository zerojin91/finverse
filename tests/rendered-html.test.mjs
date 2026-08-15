import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the local FINVERSE market dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>FINVERSE \| Market Intelligence<\/title>/i);
  assert.match(html, /FINVERSE/);
  assert.match(html, /시장 인사이트/);
  assert.match(html, /시나리오 분석/);
  assert.match(html, /class="sidebar"/);
  assert.doesNotMatch(html, /class="topbar/);
  assert.match(html, /내 컴퓨터에서만 실행 중/);
  assert.match(html, /지수·반도체 4종/);
  assert.match(html, /KOSPI/);
  assert.match(html, /코스닥/);
  assert.match(html, /삼성전자/);
  assert.match(html, /SK하이닉스/);
  assert.match(html, /조건부 분포/);
  assert.match(html, /6,258\.77/);
  assert.match(html, /오늘의 시장 구성/);
  assert.match(html, /항목을 눌러 비중 근거와 시장 영향 보기/);
  assert.match(html, /경제/);
  assert.match(html, /국가/);
  assert.match(html, /이벤트/);
  assert.match(html, /커뮤니티/);
  assert.match(html, /반도체 저가매수/);
  assert.match(html, /나스닥/);
  assert.match(html, /조건부 시나리오/);
  assert.match(html, /내 시나리오 예측하기/);
  assert.match(html, /시장 조건·기간·나만의 질문을 직접 설정하세요/);
  assert.match(html, /데이터 준비도/);
  assert.match(html, /미래 이벤트 캘린더/);
  assert.match(html, /커뮤니티 심리/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});
