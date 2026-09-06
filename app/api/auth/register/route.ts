import { authDb } from "@/lib/auth-db";
import { hashPassword, newSessionToken, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !EMAIL_RE.test(email)) return Response.json({ error: "올바른 이메일을 입력하세요." }, { status: 400 });
  if (!password || password.length < 8) return Response.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });

  try {
    const sql = authDb();
    const existing = await sql`select id from auth.users where email = ${email}`;
    if (existing.length) return Response.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });

    const passwordHash = hashPassword(password);
    const [user] = await sql<{ id: number; email: string }[]>`
      insert into auth.users (email, password_hash) values (${email}, ${passwordHash})
      returning id, email
    `;
    const { raw, hash, expiresAt } = newSessionToken();
    await sql`insert into auth.sessions (user_id, token_hash, expires_at) values (${user.id}, ${hash}, ${expiresAt})`;

    return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(raw, expiresAt) } });
  } catch (error) {
    console.error("FINVERSE register failed", error);
    return Response.json({ error: "회원가입에 실패했습니다." }, { status: 503 });
  }
}
