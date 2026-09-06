-- FINVERSE 사용자 인증 — 스키마
--
-- docs/PRD.md §13 이슈 5: "사용자 계정·소유자 구분 없음 | 마이페이지 아카이브가
-- 성립하지 않음... MVP 필수. 로그인 + game.owner_id". 데모용 최소 인증이라
-- 이메일 인증, 비밀번호 재설정, 소셜 로그인은 없다 — 이메일+비밀번호와
-- 세션 쿠키뿐이다.
--
--   docker compose exec -T db psql -U finverse -d finverse < db/auth.sql
--
-- lake/market/events/economy/psychology 는 수집 파이프라인의 소유고
-- db/roles.sql의 finverse_read/write/loader/admin은 그 다섯 스키마만 안다.
-- auth는 별개 관심사라 별도 스키마 + 별도 전용 역할로 분리해 그 파일은
-- 건드리지 않는다 (수집 워크스트림과의 병합 충돌을 피한다).

BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id            bigserial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- 원문 토큰은 절대 저장하지 않는다. 세션 쿠키에는 원문을, DB에는
-- sha256(원문) 해시만 남겨서 DB가 유출돼도 쿠키를 재구성할 수 없게 한다.
CREATE TABLE IF NOT EXISTS auth.sessions (
    id         bigserial PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON auth.sessions(user_id);

-- ---------------------------------------------------------------------------
-- 전용 역할. lake의 finverse_write(분석가가 데이터를 고치는 역할)와 섞지
-- 않는다 — 이 역할은 auth 스키마 밖은 아무것도 못 본다.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finverse_authapp') THEN
        CREATE ROLE finverse_authapp NOLOGIN;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE finverse TO finverse_authapp;
GRANT USAGE ON SCHEMA auth TO finverse_authapp;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users, auth.sessions TO finverse_authapp;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA auth TO finverse_authapp;

COMMIT;
