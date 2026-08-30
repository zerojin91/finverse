export const dynamic = "force-dynamic";

// 같은 저장소의 페이퍼 트레이딩 엔진(services/paper_trading)으로 중계합니다.
// `npm run dev`가 함께 띄우고, 배포 시에는 별도 프로세스로 돕니다.
// 엔드포인트가 25개라 개별 라우트 대신 catch-all 프록시 하나로 유지합니다.
const finsimUrl = () =>
  process.env.FINVERSE_FINSIM_API_URL?.trim() ?? "http://127.0.0.1:5055";

const UNREACHABLE = "FinSimulation 백엔드에 연결하지 못했습니다. 로컬 서비스를 다시 실행해주세요.";

async function proxy(request: Request, segments: string[], method: string) {
  const search = new URL(request.url).search;
  const target = `${finsimUrl()}/api/paper-trading/${segments.map(encodeURIComponent).join("/")}${search}`;
  const hasBody = method !== "GET" && method !== "DELETE";

  try {
    const response = await fetch(target, {
      method,
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("FinSimulation proxy failed", target, error);
    return Response.json({ success: false, error: UNREACHABLE }, { status: 503 });
  }
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Context) {
  return proxy(request, (await params).path, "GET");
}

export async function POST(request: Request, { params }: Context) {
  return proxy(request, (await params).path, "POST");
}

export async function PUT(request: Request, { params }: Context) {
  return proxy(request, (await params).path, "PUT");
}

export async function DELETE(request: Request, { params }: Context) {
  return proxy(request, (await params).path, "DELETE");
}
