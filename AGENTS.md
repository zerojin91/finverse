# 작업 규칙

## Git 커밋 및 푸시

- 코드나 설정을 변경한 뒤에는 필요한 검증을 거쳐 로컬 Git 커밋까지 만든다.
- 사용자가 명시적으로 "푸시해줘"라고 요청하기 전에는 원격 저장소(GitHub)에 `git push`를 실행하지 않는다.
- 여러 커밋은 사용자의 푸시 요청 시점에 한 번에 푸시할 수 있도록 로컬에 보관한다.

## 하네스 최신화 규칙 (중요)

- 사용자의 요청으로 코드·설정·배치·데이터 경로·외부 서비스 연동·원격 서버 운영 방식이 바뀌면, 작업을 끝내기 전에 이 파일의 해당 하네스를 함께 갱신한다.
- 변경으로 서비스 구조, 실행 명령, 접속 절차, 환경변수의 **이름 또는 역할**, 배치 시각, 데이터 소스, 장애 점검 순서가 달라진 경우에는 하네스 갱신을 필수 완료 조건으로 취급한다.
- 실수, 실패, 설정 누락, 배포 충돌처럼 되돌리거나 수정한 일이 있으면 `운영 변경·사고 기록`에 날짜, 증상, 원인, 조치, 재발 방지 원칙을 짧게 기록한다. 같은 문제가 다시 생겼을 때 바로 피할 수 있을 정도로 구체적으로 쓴다.
- 기록에는 API 키, 비밀번호, 토큰, 개인 정보, 원문 `.env` 값 등 비밀값을 절대로 넣지 않는다.
- 단순 문구·스타일 변경처럼 구조나 운영에 영향을 주지 않는 변경은 기록하지 않아도 된다.

## 프로젝트 하네스: 빠른 운영·개발 맥락

### 서비스 구성

```
브라우저
  └─ Next.js 앱 (포트 3000, app/)
       ├─ 대시보드·KOSPI·장중지수 API
       │    └─ FINVERSE_DATABASE_URL → Tailscale 사설망 PostgreSQL
       ├─ 온톨로지·MiroFish API
       │    └─ MiroFish 로컬 게이트웨이 (포트 5440, scripts/mirofish_gateway.mjs)
       └─ 모의 투자 API 프록시 (/api/paper-trading/*)
            └─ Flask 서비스 (포트 5055, services/paper_trading_api.py)

원격 수집 서버
  ├─ collectors/*.py → data/*.jsonl
  ├─ scripts/load_postgres.py → PostgreSQL lake.records
  ├─ scripts/bedrock_signal_update.py → OpenRouter 요약 → lake.records
  └─ scripts/sync_ontology.sh → lake → core → graph 동기화
```

- 프론트엔드 진입점은 `app/page.tsx`이고, Next.js API 라우트는 `app/api/`에 있다.
- 로컬 개발은 `npm run dev`로 시작한다. Next.js, MiroFish 로컬 게이트웨이, 모의 투자 Flask API를 함께 띄운다.
- DB는 원격 서버의 Docker 컨테이너 `finverse-db`, 데이터베이스 `finverse`다. 수집 원본과 AI 분석 결과의 중심 저장소는 `lake.records`다.
- 대시보드·KOSPI·장중지수·모의투자·MiroFish A2A의 DB 접근은 모두 `FINVERSE_DATABASE_URL`을 사용한다. 이 값은 `.env`에만 두며, 코드·문서·로그에는 값 자체를 기록하지 않는다.

### 데이터·AI 흐름

- 시장·경제·뉴스·커뮤니티 수집기는 `collectors/`에 있다. `scripts/run_ingest.sh`가 수집과 PostgreSQL 적재를 묶는다.
- 대시보드는 `app/api/dashboard/route.ts`에서 KOSPI·거시지표·뉴스·수급을 읽고, 최신 `market_signal_analysis` 레코드의 OpenRouter 분석을 사용한다.
- AI 요약 레코드가 없으면 UI는 “요약을 불러오고 있다” 기본 문구를 표시한다. 레코드 형식은 `record_type='market_signal_analysis'`, `source='openrouter'`이다.
- `scripts/bedrock_signal_update.py`라는 파일명은 과거 호환 이름일 뿐, 현재 구현은 AWS Bedrock이 아니라 OpenRouter Chat Completions API를 사용한다.
- 요약·시나리오·모의 투자 LLM은 `OPENROUTER_API_KEY`를 사용한다. 키나 `.env` 값은 절대로 로그·커밋·응답에 노출하지 않는다.

### 데이터 연결과 원격 배포

- `FINVERSE_DATABASE_URL`은 서버 사이드 전용 읽기 계정으로 사용한다. 브라우저에는 절대 전달하지 않으며 Tailscale 사설망에서만 연결한다.
- 원격 서버의 작업 경로는 `/home/ubuntu/finverse`다. 원격 `.env`에는 로컬에 없는 Docker 전용 값(예: `POSTGRES_PASSWORD`)이 포함될 수 있다. 환경 파일을 갱신할 때는 서버 전용 값을 보존·병합한 뒤 `chmod 600 .env`를 적용한다.
- 배포 전에는 원격의 수정·미추적 파일을 백업 및 stash로 보존한다. `git reset --hard`나 `git clean`을 백업 없이 실행하지 않는다.

### 원격 배치 운영

- 원격 cron은 `deploy/crontab`에서 관리하고 `crontab deploy/crontab`으로 설치한다. 서버 시간은 UTC다.
- 평일 10:00 UTC(19:00 KST): 시장 수집·DB 적재 성공 후 같은 작업에서 OpenRouter 시장 요약을 생성한다. 따라서 수집이 끝난 직후에만 요약이 실행된다.
- 매일 20:30 UTC(05:30 KST): 경제·뉴스 수집 및 적재.
- 매일 22:00 UTC(07:00 KST): `scripts/sync_ontology.sh`로 lake → core → graph 동기화.
- 배치 장애 확인은 원격 `logs/cron.log`와 아래의 읽기 전용 입력 점검을 우선 사용한다.

```bash
cd /home/ubuntu/finverse
scripts/run_bedrock_signal_update.sh --dry-run
```

- 실제 요약 생성은 시장·뉴스 기반 입력을 OpenRouter로 전송하고 결과를 DB에 저장한다. 명시적으로 승인된 경우에만 수동 `--force` 실행을 한다.

### 현재 배포 기준과 점검 순서

- 2026-08-30 기준 원격 코드는 `origin/main`의 `df294d8`로 배포됐다. 이후 로컬에서 만든 커밋은 사용자의 푸시 요청 전까지 원격 GitHub에는 올리지 않는다.
- 원격에는 배포 전 상태 백업과 stash가 있을 수 있다. 복구가 필요할 때만 해당 백업을 사용하며, 일상 작업에서는 건드리지 않는다.
- UI 이상은 다음 순서로 본다: `GET /api/dashboard` 응답 → `FINVERSE_DATABASE_URL` 연결 상태 → `lake.records` 데이터/배치 로그 → OpenRouter 키·모델 설정.

### 운영 변경·사고 기록

#### 2026-08-30 — 모의투자 종목 검색의 DB 연결 누락

- 증상: 모의투자 설정 화면에서 종목명을 입력하면 `FINVERSE_DATABASE_URL이 설정되지 않았습니다` 오류가 표시됐다.
- 원인: 모의투자 Flask 서비스는 SSH 브리지가 아니라 `psycopg`로 읽기 전용 PostgreSQL에 직접 연결하도록 구현됐는데, 로컬 `.env`에 해당 연결 문자열이 없었다.
- 조치: 로컬 `.env`에 Tailscale 사설망의 읽기 전용 DB 연결을 설정하고 서비스를 재시작했다.
- 재발 방지: 모의투자 관련 오류는 먼저 `/health`의 설정 상태와 `FINVERSE_DATABASE_URL`의 존재 여부(값 비노출)를 확인한다. 공개 클라이언트에는 이 연결 문자열을 절대 전달하지 않는다.

#### 2026-08-31 — SSH DB 브리지 제거 및 직접 PostgreSQL 연결 통합

- 변경: 대시보드·KOSPI·장중지수·지수 적재·MiroFish A2A의 DB 접근을 모두 `FINVERSE_DATABASE_URL`로 전환했다.
- 이유: 다단계 원격 명령 실행에 따른 지연과 운영 복잡도를 제거하고, 모의투자와 같은 데이터 연결 방식을 사용한다.
- 재발 방지: 새 DB 기능은 서버 전용 `FINVERSE_DATABASE_URL`과 파라미터 바인딩 또는 내부 고정 SQL을 사용한다.

#### 2026-08-30 — 원격 `.env` 전체 덮어쓰기 후 DB 비밀번호 누락

- 증상: 로컬 `.env`를 원격에 복사한 뒤 수집·요약 배치가 `POSTGRES_PASSWORD` 누락으로 PostgreSQL에 연결하지 못했다.
- 원인: 원격 Docker 환경에는 로컬에 없는 서버 전용 환경값이 존재했다.
- 조치: 실행 중인 `finverse-db` 컨테이너의 기존 환경에서 누락된 값만 비노출 방식으로 복원하고 파일 권한을 `600`으로 설정했다.
- 재발 방지: 원격 `.env`는 전체 덮어쓰기 대신 서버 전용 값을 보존·병합한다. 배포 후에는 외부 호출 없는 `scripts/run_bedrock_signal_update.sh --dry-run`으로 DB 접근을 검증한다.

#### 2026-08-30 — Windows 줄바꿈으로 인한 cron 설치 실패

- 증상: Windows에서 복사한 crontab 파일을 원격 Ubuntu에 설치할 때 `bad minute` 오류가 발생했다.
- 원인: CRLF 줄바꿈이 포함된 파일을 cron이 올바르게 해석하지 못했다.
- 조치: 원격에서 CRLF를 LF로 변환한 뒤 `crontab deploy/crontab`으로 설치했다.
- 재발 방지: Windows에서 원격 cron 파일을 전송할 때는 설치 전에 LF 줄바꿈으로 정규화하고, 설치 후 `crontab -l`로 실제 스케줄을 확인한다.
