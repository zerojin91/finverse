"use client";

import { LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

export type AuthUser = { id: number; email: string };

async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as { user?: AuthUser } | null;
  return payload?.user ?? null;
}

/** 세션 상태를 로드하고, 로그인/회원가입/로그아웃 후 갱신하는 훅. 데모용 최소 인증이라
 * 이메일 인증·비밀번호 재설정은 없다 — 이메일+비밀번호와 세션 쿠키뿐이다. */
export function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setUser(await fetchMe());
  }, []);

  useEffect(() => {
    let active = true;
    fetchMe().then((value) => { if (active) { setUser(value); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }, []);

  return { user, loading, refresh, logout };
}

export function AuthModal({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => null)) as { user?: AuthUser; error?: string } | null;
      if (!response.ok || !payload?.user) throw new Error(payload?.error ?? "요청을 처리하지 못했습니다.");
      onAuthenticated(payload.user);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "요청을 처리하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modal-backdrop auth-backdrop" onMouseDown={onClose}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h3 id="auth-modal-title">{mode === "login" ? "로그인" : "회원가입"}</h3>
          <button className="scenario-modal-close" type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </header>
        <form onSubmit={submit}>
          <label>
            이메일
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label>
            비밀번호
            <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="auth-submit" disabled={pending}>
            {pending ? <LoaderCircle size={16} className="spin" /> : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>
        <button type="button" className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
          {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
        </button>
      </section>
    </div>
  );
}
