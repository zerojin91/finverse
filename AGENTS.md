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
- 로컬 DB 연결은 SSH 터널을 표준으로 한다. `.env`에 `FINVERSE_DATABASE_TUNNEL=1`, `FINVERSE_DATABASE_TUNNEL_PORT=15432`를 설정하면 `scripts/dev_local.mjs`가 Next.js와 Flask 양쪽의 `FINVERSE_DATABASE_URL`을 실행 시점에 `127.0.0.1:15432`로 통일한다. 터널은 별도 터미널에서 `ssh -i "$FINVERSE_SSH_KEY" -N -L 15432:<DB_TAILSCALE_HOST>:5432 "$FINVERSE_SSH_HOST"`로 먼저 띄운다. 비밀번호·전체 URL은 문서나 로그에 기록하지 않는다.
- DB는 원격 서버의 Docker 컨테이너 `finverse-db`, 데이터베이스 `finverse`다. 수집 원본과 AI 분석 결과의 중심 저장소는 `lake.records`다.
- 대시보드·KOSPI·장중지수·모의투자·MiroFish A2A의 DB 접근은 모두 `FINVERSE_DATABASE_URL`을 사용한다. 이 값은 `.env`에만 두며, 코드·문서·로그에는 값 자체를 기록하지 않는다.
- 모의투자 종목 선택 화면은 `GET /api/paper-trading/securities/:ticker/candles`로 선택 종목의 최근 36거래일 실제 OHLC를 읽어 시작 전 캔들 미리보기를 표시한다. 이 미리보기에는 시뮬레이션·미래 가격을 섞지 않는다.
- 모의투자 설정 흐름은 `종목 선택 → 자료 수집 → 투자 상태 → 시뮬레이션 설정` 순서다. 첫 화면에는 종목 선택만 보이고, 종목 선택 완료 시 자료 수집, 자료 준비 완료 시 투자 상태를 자동으로 순차 공개한다. 캐시로 자료가 즉시 준비돼도 자료 수집 단계는 최소 1.5초간 유지하고, 실제 조회가 더 오래 걸리면 조회 완료 시점에 다음 단계로 넘어간다. 투자 상태는 유효한 금액 또는 보유 정보를 입력한 뒤 `투자 상태 설정 완료` 버튼으로 명시적으로 확정해야 시뮬레이션 설정과 시작 버튼이 공개되며, 확정 후 투자 조건을 수정하면 다시 확정해야 한다. 각 단계가 열리면 해당 섹션을 모달 화면 중앙으로 부드럽게 스크롤한다. 신규 투자는 실제 투자 가능 금액을 받고, 기존 보유는 투자 금액 영역을 숨긴 채 평단·수량만 받아 추가 현금 0원으로 시작한다. 사용자는 10·20·60거래일 기간과 균형·위기 대응·기회 포착·무작위 연습 유형을 선택한다.
- 사건 개수와 시장 참여자 수는 사용자 설정이 아니다. 백엔드가 기간별로 `10일=2개`, `20일=3개`, `60일=5개` 사건을 고르고, 개인 8·외국인 4·기관 4·연기금 2 에이전트를 내부 구성한다. 사건 사이 거래일을 재배치해 선택한 전체 기간과 일치시킨다.
- 기존 보유로 시작하면 `initial_position.quantity`와 `initial_position.average_price`가 게임에 반영된다. 미실현 손익은 평단 기준으로 보여주며 시뮬레이션 수익률은 시작 시점의 현금+현재가 평가액(`initial_equity`)을 기준으로 0%에서 시작한다.
- 모의투자 2단계 `자료 수집`은 `GET /api/paper-trading/securities/:ticker/scenario-context`로 시나리오 엔진과 동일한 종목별 DB 조회를 미리 수행한다. 시장·경제·사건·커뮤니티 네 도메인의 건수·최신 시점을 표시하며, 결과는 로컬 이력 캐시에 남아 시나리오 생성 시 재사용된다. 이 단계는 OpenRouter·온톨로지·MiroFish를 실행하지 않는다.
- 모의투자 4단계는 먼저 `GET /api/paper-trading/securities/:ticker/initial-context/documents`로 같은 실제 이력에서 종목 타깃형 `market/economy/events/community` Evidence Markdown 4종을 준비한다. 네 문서가 모두 준비된 뒤에만 `GET /api/paper-trading/securities/:ticker/initial-context`가 이 문서 묶음을 OpenRouter에 전달해 종목 전체 현황·최근 한 달 이벤트 시퀀스·위험 요인·관찰 포인트를 생성한다. 문서와 분석 결과는 `var/market_cache/initial-context-<지문>/` 및 `initial-context-<지문>.json`에 12시간 캐시되며, 시나리오 시작 시 동일 분석을 게임에 `initial_context`로 저장한다. 이벤트 시퀀스는 문서에 있는 실제 관측 흐름만 표시하고 미래 사건·가격 예측을 섞지 않는다.

### 데이터·AI 흐름

- 시장·경제·뉴스·커뮤니티 수집기는 `collectors/`에 있다. `scripts/run_ingest.sh`가 수집과 PostgreSQL 적재를 묶는다.
- 모의투자는 `GET /api/paper-trading/securities/:ticker/scenario-context`로 선택 종목의 시장·경제·사건·커뮤니티 준비 상태를 먼저 확인한다. 시나리오 생성 시 같은 PostgreSQL 이력을 사용하며 연습 유형에 따라 전체 사건, 악재, 호재, 무작위 사건을 우선 선별한다.
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
- 작업 시작 전 방향 점검: 이 프로젝트의 핵심은 실제 Finverse 데이터로 근거를 만들고, LLM은 해석·시나리오 보조로만 사용하며, 미래 결과를 사실처럼 단정하지 않는 금융 판단 연습이다. UI·API·에이전트 동작을 바꿀 때는 [프로젝트 히스토리](docs/project-history.md)를 먼저 읽고, 기존의 실제 데이터·4개 참여자 범주·순차 설정 흐름·캐시 재사용 원칙에서 벗어나지 않는지 확인한다. 큰 방향이 바뀌면 구현 전에 히스토리에 결정과 이유를 기록한다.

### 운영 변경·사고 기록

#### 2026-09-05 — 로컬 백엔드 재시작 후 PostgreSQL 연결 타임아웃

- 증상: 종목 선택 시 `finverse PostgreSQL 연결에 실패했습니다: connection timeout expired`가 표시되고 5055 캔들 API가 503을 반환했다.
- 원인: SSH 터널 `127.0.0.1:15432`는 살아 있었지만 백엔드를 재시작하면서 `FINVERSE_DATABASE_URL` 터널 오버라이드를 주입하지 않아 `.env`의 Tailscale DB 주소 `100.89.226.42:5432`로 직접 접속했다.
- 조치: 기존 백엔드를 종료하고 `.env`의 연결 문자열을 비밀값 그대로 유지한 채 호스트·포트만 실행 시점에 `127.0.0.1:15432`로 오버라이드해 재실행했다. Flask 직접 API와 Next 프록시 모두 200 및 실제 캔들 응답을 확인했다.
- 재발 방지: 로컬 백엔드 재시작 전 SSH 터널 `15432`와 5055를 확인하고, 터널 사용 실행 시 `FINVERSE_DATABASE_URL`을 실행 프로세스에 반드시 주입한다. 재시작 직후 `/health`와 캔들 API를 함께 점검한다.

#### 2026-09-03 — 새 모의투자 CSS 규칙이 개발 서버 번들에서 누락

- 증상: 투자 상태·금액·기간·연습 유형의 HTML은 최신이었지만 새 CSS만 적용되지 않아 버튼과 문구가 한 줄로 겹쳐 보였다.
- 원인: 실행 중이던 Next 개발 서버의 CSS 변환 캐시가 변경 전 번들을 계속 제공했고, 실제 제공된 스타일시트에도 새 클래스가 포함되지 않았다.
- 조치: 3000 포트의 이전 프론트 프로세스를 종료하고 최신 코드로 재시작한 뒤 `app/globals.css`를 갱신해 CSS를 다시 컴파일했다. 브라우저 계산 스타일과 1108×1315 화면에서 그리드 적용을 확인했다.
- 재발 방지: 새 UI 클래스 추가 후에는 DOM 표시만 보지 말고 실제 제공 CSS와 계산된 `display/grid-template-columns`를 확인한다. 누락되면 프론트 재시작 후 CSS 소스 변경으로 변환 캐시를 갱신한다.

#### 2026-09-03 — 이미 실행 중인 로컬 서비스와 통합 실행 충돌·이전 API 응답

- 증상: `npm run dev`를 다시 실행하자 3000·5440 포트가 이미 사용 중이었고, 5055에는 여러 Python 프로세스가 동시에 남아 새 기간 검증 대신 이전 API가 응답했다.
- 원인: 이전 로컬 서비스가 정상 실행 중인 상태에서 통합 실행기를 중복 실행했고, Flask 상위·하위 프로세스 일부가 5055 포트를 공유했다.
- 조치: 3000·5440 서비스는 유지하고 5055를 점유한 PID를 모두 종료한 뒤, 프로젝트 루트에서 `.venv\\Scripts\\python.exe -u -m services.paper_trading_api`로 하나만 실행했다. 이전 API 확인 과정에서 생성된 로컬 테스트 게임 2개도 정확한 파일을 확인해 제거했다.
- 재발 방지: 통합 실행 전 3000·5055·5440 포트 상태를 확인하고, 일부만 재시작해야 할 때는 해당 서비스를 단독 실행한다.

#### 2026-09-02 — Windows 모의투자 API 재시작 시 이전 라우트 상태 유지

- 증상: 새 종목 캔들 조회 경로를 추가한 뒤 5055 API를 파일 경로로 실행해 모듈을 찾지 못했고, 하위 Python 프로세스만 종료했을 때에는 이전 라우트가 계속 404를 반환했다.
- 원인: `services/paper_trading_api.py`는 프로젝트 루트에서 모듈로 실행해야 하며, Windows 가상환경 실행기는 상위 런처와 실제 Python 하위 프로세스로 나뉜다.
- 조치: 상위 런처까지 종료한 뒤 `.venv\\Scripts\\python.exe -u -m services.paper_trading_api`로 다시 실행하고, 직접 API와 Next 프록시에서 최근 36개 일봉 응답을 확인했다.
- 재발 방지: 로컬 모의투자 API 재시작은 항상 모듈 방식으로 실행하고, 새 라우트는 5055 직접 경로와 3000 프록시 경로를 모두 확인한다.

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
