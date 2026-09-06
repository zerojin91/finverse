import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hashToken, readSessionToken } from "@/lib/auth";

export type AuthUser = { id: number; email: string };
export type InvestorProfile = { score: number; completedAt: string };

// 데모용 최소 인증이라 공유 Postgres에 쓰기 권한 계정을 새로 발급받는 대신,
// 다른 로컬 상태(var/paper_games/*.json)와 같은 위치에 파일 하나로 둔다.
const DB_PATH = resolve(process.cwd(), "var/auth.sqlite3");

let db: DatabaseSync | undefined;

function database(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS investor_profiles (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      score         INTEGER NOT NULL CHECK (score BETWEEN 5 AND 20),
      completed_at  TEXT NOT NULL
    );
  `);
  return db;
}

type UserRow = { id: number; email: string; password_hash: string };

export function findUserByEmail(email: string): UserRow | undefined {
  return database().prepare("select id, email, password_hash from users where email = ?").get(email) as UserRow | undefined;
}

export function createUser(email: string, passwordHash: string): AuthUser {
  const result = database().prepare("insert into users (email, password_hash) values (?, ?)").run(email, passwordHash);
  return { id: Number(result.lastInsertRowid), email };
}

export function createSession(userId: number, tokenHash: string, expiresAt: Date): void {
  database().prepare("insert into sessions (user_id, token_hash, expires_at) values (?, ?, ?)").run(userId, tokenHash, expiresAt.toISOString());
}

export function deleteSessionByTokenHash(tokenHash: string): void {
  database().prepare("delete from sessions where token_hash = ?").run(tokenHash);
}

export function getInvestorProfile(userId: number): InvestorProfile | null {
  const row = database().prepare("select score, completed_at from investor_profiles where user_id = ?").get(userId) as { score: number; completed_at: string } | undefined;
  return row ? { score: row.score, completedAt: row.completed_at } : null;
}

export function saveInvestorProfile(userId: number, score: number): InvestorProfile {
  const completedAt = new Date().toISOString();
  database().prepare(`
    insert into investor_profiles (user_id, score, completed_at) values (?, ?, ?)
    on conflict(user_id) do update set score = excluded.score, completed_at = excluded.completed_at
  `).run(userId, score, completedAt);
  return { score, completedAt };
}

/** Resolves the session cookie on `request` to its owning user, or null if absent/expired. */
export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const raw = readSessionToken(request);
  if (!raw) return null;
  const row = database()
    .prepare(`
      select u.id as id, u.email as email
      from sessions s join users u on u.id = s.user_id
      where s.token_hash = ? and s.expires_at > datetime('now')
    `)
    .get(hashToken(raw)) as AuthUser | undefined;
  return row ?? null;
}
