import { deleteSessionByTokenHash } from "@/lib/auth-db";
import { clearSessionCookie, hashToken, readSessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = readSessionToken(request);
  if (raw) {
    try {
      deleteSessionByTokenHash(hashToken(raw));
    } catch (error) {
      console.error("FINVERSE logout failed", error);
    }
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
