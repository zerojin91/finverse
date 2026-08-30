export const dynamic = "force-dynamic";

const gatewayUrl = () => process.env.FINVERSE_MIROFISH_GATEWAY_URL?.trim() ?? "http://127.0.0.1:5440";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${gatewayUrl()}/mirofish/runtime`, {
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
