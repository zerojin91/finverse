import { authDb } from "@/lib/auth-db";
import { newSessionToken, sessionCookie, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) return Response.json({ error: "이메일과 비밀번호를 입력하세요." }, { status: 400 });

  try {
    const sql = authDb();
    const [user] = await sql<{ id: number; email: string; password_hash: string }[]>`
      select id, email, password_hash from auth.users where email = ${email}
    `;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return Response.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    const { raw, hash, expiresAt } = newSessionToken();
    await sql`insert into auth.sessions (user_id, token_hash, expires_at) values (${user.id}, ${hash}, ${expiresAt})`;

    return Response.json(
      { user: { id: user.id, email: user.email } },
      { headers: { "Set-Cookie": sessionCookie(raw, expiresAt) } },
    );
  } catch (error) {
    console.error("FINVERSE login failed", error);
    return Response.json({ error: "로그인에 실패했습니다." }, { status: 503 });
  }
}
