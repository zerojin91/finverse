import postgres from "postgres";
import { hashToken, readSessionToken } from "@/lib/auth";

export type AuthUser = { id: number; email: string };

let client: postgres.Sql | undefined;

const databaseUrl = () => {
  const value = process.env.FINVERSE_AUTH_DATABASE_URL?.trim();
  if (!value) throw new Error("FINVERSE_AUTH_DATABASE_URL이 설정되지 않았습니다. db/auth.sql 적용 후 쓰기 권한 계정을 .env에 추가하세요.");
  return value;
};

/** Server-only auth database query. Separate connection from the read-only FINVERSE_DATABASE_URL. */
export const authDb = () => {
  if (!client) client = postgres(databaseUrl(), { connect_timeout: 8, idle_timeout: 20, max: 5 });
  return client;
};

/** Resolves the session cookie on `request` to its owning user, or null if absent/expired. */
export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const raw = readSessionToken(request);
  if (!raw) return null;
  const sql = authDb();
  const rows = await sql<AuthUser[]>`
    select u.id, u.email
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.token_hash = ${hashToken(raw)} and s.expires_at > now()
  `;
  return rows[0] ?? null;
}
