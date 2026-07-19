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
  assert.match(html, /<title>FINVERSE \| AI 금융 디지털 트윈<\/title>/i);
  assert.match(html, /오늘 시장을 내 미래로 연결합니다/);
  assert.match(html, /AI 반도체 랠리 이후 KOSPI 변곡점/);
  assert.match(html, /내 상황으로 시뮬레이션/);
  assert.match(html, /수익률보다 판단 습관을 기록합니다/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});
