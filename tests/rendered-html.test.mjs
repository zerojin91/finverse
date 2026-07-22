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

test("server-renders the FINVERSE B2C experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>FINVERSE \| 시장 인사이트와 마이 금융 트윈<\/title>/i);
  assert.match(html, /AI 반도체 랠리 이후/);
  assert.match(html, /시장 고가 저가 종가/);
  assert.match(html, /예측 포인트와 구간/);
  assert.match(html, /예측값을 만든 이유 TOP 3/);
  assert.match(html, /관련 뉴스/);
  assert.match(html, /시나리오에 참여할 에이전트/);
  assert.match(html, /3개 에이전트로/);
  assert.match(html, /마이 금융 트윈/);
  assert.doesNotMatch(html, /관련 뉴스 2건/);
  assert.doesNotMatch(html, /예측 근거와 연결된 뉴스/);
  assert.doesNotMatch(html, /에이전트의 가정과 조건을 직접 조정하세요/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});
