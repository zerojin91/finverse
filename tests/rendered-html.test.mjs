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

test("server-renders the empty FINVERSE redesign shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>FINVERSE \| 시장 인사이트와 마이 금융 트윈<\/title>/i);
  assert.match(html, /FINVERSE/);
  assert.match(html, /시장 인사이트/);
  assert.match(html, /마이 금융 트윈/);
  assert.match(html, /금융 판단 실험실/);
  assert.match(html, /empty-tab-content/);
  assert.doesNotMatch(html, /내 금융 상태/);
  assert.doesNotMatch(html, /종목이 아니라, 연결을 봅니다/);
  assert.doesNotMatch(html, /KOSPI 연결 지도/);
  assert.doesNotMatch(html, /Properties|Relations/);
  assert.doesNotMatch(html, /영향 시뮬레이션/);
  assert.doesNotMatch(html, /시장 인사이트\(예비\)/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});
