export const dynamic = "force-dynamic";

const bridgeUrl = () => process.env.FINVERSE_KOSPI_BRIDGE_URL?.trim() || "http://127.0.0.1:5439";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${bridgeUrl()}/mirofish/runtime`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: "시뮬레이션 상태 서비스에 연결하지 못했습니다." }, { status: 503 });
  }
}
