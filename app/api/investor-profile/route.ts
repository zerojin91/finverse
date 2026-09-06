import { getInvestorProfile, getSessionUser, saveInvestorProfile } from "@/lib/auth-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
    return Response.json({ profile: getInvestorProfile(user.id) });
  } catch (error) {
    console.error("FINVERSE investor profile lookup failed", error);
    return Response.json({ error: "투자 성향 기록을 확인하지 못했습니다." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const body = await request.json().catch(() => null) as { score?: unknown } | null;
    const score = Number(body?.score);
    if (!Number.isInteger(score) || score < 5 || score > 20) {
      return Response.json({ error: "5개 문항을 모두 완료해주세요." }, { status: 400 });
    }
    return Response.json({ profile: saveInvestorProfile(user.id, score) });
  } catch (error) {
    console.error("FINVERSE investor profile save failed", error);
    return Response.json({ error: "투자 성향 기록을 저장하지 못했습니다." }, { status: 503 });
  }
}
