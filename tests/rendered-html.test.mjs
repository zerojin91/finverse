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
  assert.match(html, /종목이 아니라, 연결을 봅니다/);
  assert.match(html, /오늘의 주요 연결/);
  assert.match(html, /KOSPI 연결 지도/);
  assert.match(html, /삼성전기/);
  assert.match(html, /전력망 투자 정책/);
  assert.match(html, /글로벌 방산 예산/);
  assert.match(html, /51(?:<!-- -->)?개 노드/);
  assert.match(html, /148(?:<!-- -->)?개 관계/);
  assert.match(html, /노드를 직접 이동/);
  assert.match(html, /기준금리 경로/);
  assert.match(html, /그래프 확대 축소/);
  assert.match(html, /Properties/);
  assert.match(html, /Relations/);
  assert.match(html, /연결 강도 높은 순/);
  assert.match(html, /연관 뉴스/);
  assert.match(html, /영향 시뮬레이션/);
  assert.match(html, /시장 인사이트\(예비\)/);
  assert.match(html, /마이 금융 트윈/);
  assert.doesNotMatch(html, /관련 뉴스 2건/);
  assert.doesNotMatch(html, /예측 근거와 연결된 뉴스/);
  assert.doesNotMatch(html, /에이전트의 가정과 조건을 직접 조정하세요/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});
