import { getSessionUser } from "@/lib/auth-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ user: null }, { status: 401 });
    return Response.json({ user });
  } catch (error) {
    console.error("FINVERSE session lookup failed", error);
    return Response.json({ error: "세션 확인에 실패했습니다." }, { status: 503 });
  }
}
