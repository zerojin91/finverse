# FINVERSE Ontology A2A Prototype

이 폴더는 LangChain Deep Agents 기반의 최소 온톨로지 수집 프로토타입이다.

## 실행 준비

`.env`에 다음 값을 설정한다.

```dotenv
DATABASE_URL=postgresql://finverse:PASSWORD@localhost:5432/finverse
ANTHROPIC_API_KEY=...
FINVERSE_AGENT_MODEL=anthropic:claude-sonnet-4-6
```

의존성 설치:

```bash
uv sync
```

실행:

```bash
uv run python -m agents.ontology_a2a "오늘 이후 코스피가 어떻게 변할까?"
```

실행 결과는 기본적으로 다음 위치에 저장된다.

```text
output/<query-slug>/
├── market-evidence.md
├── economic-evidence.md
├── external-event-evidence.md
└── psychology-evidence.md
```

## 현재 범위

- Moderator Deep Agent 1개
- 시장·경제·외부 사건·심리 Subagent 4개
- 각 Subagent의 승인된 PostgreSQL view 조회 도구
- 각 도메인의 Evidence Markdown 저장 도구
- Moderator의 문서 검토 및 1회 보완 요청

심리 view가 아직 PostgreSQL에 없으면 해당 Agent는 오류를 숨기지 않고 `Limitations`에 데이터 부족으로 기록한다.
