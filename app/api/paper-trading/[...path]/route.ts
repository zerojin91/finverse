import { getInvestorProfile, getSessionUser } from "@/lib/auth-db";

export const dynamic = "force-dynamic";

// 같은 저장소의 페이퍼 트레이딩 엔진(services/paper_trading)으로 중계합니다.
// `npm run dev`가 함께 띄우고, 배포 시에는 별도 프로세스로 돕니다.
// 엔드포인트가 25개라 개별 라우트 대신 catch-all 프록시 하나로 유지합니다.
const finsimUrl = () =>
  process.env.FINVERSE_FINSIM_API_URL?.trim() ?? "http://127.0.0.1:5055";

const UNREACHABLE = "FinSimulation 백엔드에 연결하지 못했습니다. 로컬 서비스를 다시 실행해주세요.";

// 게임 소유자 구분이 걸리는 경로만 로그인을 요구한다 (docs/PRD.md §13 이슈 5).
// 종목 조회·초기 상황 같은 로그인 전 탐색 단계는 그대로 공개로 둔다.
function needsOwner(segments: string[], method: string): boolean {
  if (segments[0] === "games") return true;
  // 게임 생성과 생성된 게임의 진행·주문·보고서 작업은 모두 소유자별 상태를
  // 읽거나 바꾼다. 특히 첫 거래일 자동 진행은 /scenarios/:id/actions로
  // 이어지므로 이 경로에도 같은 세션 식별자를 전달해야 한다.
  if (segments[0] === "scenarios" && method === "POST") return true;
  return false;
}

async function proxy(request: Request, segments: string[], method: string) {
  const search = new URL(request.url).search;
  const target = `${finsimUrl()}/api/paper-trading/${segments.map(encodeURIComponent).join("/")}${search}`;
  const hasBody = method !== "GET" && method !== "DELETE";
  const headers: Record<string, string> = {};
  if (hasBody) headers["content-type"] = "application/json";

  if (needsOwner(segments, method)) {
    let user;
    try {
      user = await getSessionUser(request);
    } catch (error) {
      console.error("FINVERSE auth lookup failed", error);
      return Response.json({ success: false, error: "인증 서비스에 연결하지 못했습니다." }, { status: 503 });
    }
    if (!user) return Response.json({ success: false, error: "로그인이 필요합니다." }, { status: 401 });
    if (segments[0] === "scenarios" && segments.length === 1 && method === "POST" && !getInvestorProfile(user.id)) {
      return Response.json({ success: false, error: "모의투자를 시작하기 전에 현재 나의 투자 성향 진단을 먼저 완료해주세요." }, { status: 403 });
    }
    headers["X-Finverse-User-Id"] = String(user.id);
  }

  try {
    const response = await fetch(target, {
      method,
      headers,
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
