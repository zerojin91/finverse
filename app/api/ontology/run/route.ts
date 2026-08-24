export const dynamic = "force-dynamic";

const bridgeUrl = () => process.env.FINVERSE_KOSPI_BRIDGE_URL?.trim() ?? "http://127.0.0.1:5439";

export async function POST(request: Request) {
  const body = await request.text();
  try {
    const response = await fetch(`${bridgeUrl()}/ontology/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    });
    if (!response.ok || !response.body) {
      return new Response(await response.text(), {
        status: response.status || 503,
        headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
      });
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch {
    return Response.json({ error: "온톨로지 실행 브리지에 연결하지 못했습니다. 로컬 서비스를 다시 실행해주세요." }, { status: 503 });
  }
}
