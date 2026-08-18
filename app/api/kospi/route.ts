export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bridgeUrl = process.env.FINVERSE_KOSPI_BRIDGE_URL || "http://127.0.0.1:5439";
    const response = await fetch(`${bridgeUrl}/kospi`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) return Response.json(body, { status: response.status });
    return Response.json({
      ...body,
      source: "PostgreSQL lake.records via SSH bridge",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "KOSPI DB 조회에 실패했습니다.";
    console.error("KOSPI data bridge failed", message);
    return Response.json({ error: "KOSPI 데이터 브리지가 실행 중이 아닙니다." }, { status: 503 });
  }
}
