export const dynamic = "force-dynamic";

const bridgeUrl = () => process.env.FINVERSE_KOSPI_BRIDGE_URL?.trim() || "http://127.0.0.1:5439";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${bridgeUrl()}/mirofish/start`, {
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
    return Response.json({ error: "MiroFish 실행 브리지에 연결하지 못했습니다. 로컬 서비스를 다시 실행해주세요." }, { status: 503 });
  }
}
