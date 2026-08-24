# FINVERSE 원격 시뮬레이션 API

수집 서버의 Docker 내부에서 다음 순서로 작동합니다.

`Evidence Markdown 4종 → 온톨로지 → Neo4j 지식그래프 → 에이전트 프로필 → 시뮬레이션 설정 → OASIS 실행`

`finverse-simulation-api`만 서버의 `127.0.0.1:8010`에 바인딩합니다. Neo4j는 Docker 네트워크 내부에만 남기며, 임베딩은 OpenRouter의 `baai/bge-m3` API로 생성합니다. 로컬 개발 환경은 PEM SSH 터널을 통해 API를 호출합니다.

## 배포 준비

수집 서버에서 `finverse`와 `MiroFish-Offline`이 같은 상위 폴더에 있어야 합니다. 이 구성은 오프라인 소스의 내부 서비스 계층을 활용하지만, 외부 API와 작업 폴더는 FINVERSE 전용입니다.

```bash
cd /path/to/finverse
cp deploy/finverse-simulation.env.example deploy/finverse-simulation.env
# deploy/finverse-simulation.env에 OpenRouter 키, Neo4j 비밀번호, API 토큰을 입력
docker compose --env-file deploy/finverse-simulation.env -f deploy/finverse-simulation.compose.yml up -d --build
```

API 확인은 수집 서버 내부에서만 합니다.

```bash
curl http://127.0.0.1:8010/health
```

## 로컬 PEM 터널

```bash
ssh -N -L 8010:127.0.0.1:8010 -i D:/finverse_key.pem ubuntu@44.206.56.75
```

로컬 `.env`에는 다음만 둡니다.

```dotenv
FINVERSE_SIMULATION_API_URL=http://127.0.0.1:8010
FINVERSE_SIMULATION_API_TOKEN=수집서버의_동일한_API_토큰
FINVERSE_SIMULATION_TUNNEL_ENABLED=1
```

## API

- `POST /v1/scenario-jobs`: Evidence 문서 4종과 질문·기간을 받아 준비 작업을 시작합니다. 동일 내용은 기존 준비 작업을 재사용합니다.
- `GET /v1/scenario-jobs/{job_id}?after={seq}`: 단계·로그·완료 상태를 조회합니다.
- `GET /v1/scenario-jobs/{job_id}/graph`: Neo4j 적재 뒤 저장한 그래프 데이터입니다.
- `POST /v1/scenario-jobs/{job_id}/start`: 준비된 OASIS 시뮬레이션을 시작합니다.

MiroFish-Offline은 AGPL-3.0 코드이므로, 해당 런타임을 수정·네트워크 서비스로 제공할 때에는 원본 라이선스와 소스 제공 의무를 함께 검토해야 합니다.
