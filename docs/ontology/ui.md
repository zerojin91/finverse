# 온톨로지 탐색 UI

`graph.node` / `graph.edge`에 투영된 온톨로지를 브라우저에서 탐색한다.
API(`api/`)와 웹(`web/`)의 두 조각이고, 구조는 hi-universe의 그래프 탐색부를 따랐다.

```
Postgres(graph 스키마) → API(fin_api, FastAPI :8030) → Web(React+Cytoscape :5174)
```

## 띄우기

```bash
scripts/dev_ui.sh          # DB 터널 → API → Web, 한 번에
scripts/dev_ui.sh --stop   # 종료
```

`web/`는 첫 실행에서 `npm install`이 자동으로 돌고, API는 `uv`가 의존성을 즉석에서 받는다.
브라우저에서 <http://127.0.0.1:5174>.

| | 주소 |
|---|---|
| Web (Vite) | <http://127.0.0.1:5174> |
| API (FastAPI) | <http://127.0.0.1:8030/docs> |
| DB 터널 | `127.0.0.1:15432` → 수집 서버의 `100.89.226.42:5432` |

수집 서버 Postgres는 tailscale 주소에만 바인딩돼 있다. tailscale이 켜져 있으면 그 주소를
`.env`의 `FINVERSE_API_DSN`에 바로 적어도 되고, 꺼져 있어도 되도록 `dev_ui.sh`는 수집 서버를
경유하는 SSH 포워딩을 기본 경로로 쓴다.

`.env` (커밋 금지):

```
FINVERSE_API_DSN=postgresql://finverse:<password>@127.0.0.1:15432/finverse
```

## 설계에서 지킨 것

**API는 그래프에 쓰지 않는다.** `scenario-ontology.md` §6의 불변식이고, 유일한 작성자는
`graph.rebuild()`다. 문서로만 두면 언젠가 깨지므로 커넥션 자체를 read-only로 고정했다
(`api/src/fin_api/deps.py`) — 실수로 INSERT를 짜도 DB가 거부한다.

**어휘를 세 번 적지 않는다.** 라벨·엣지 타입의 단일 진실은 `scenario-ontology.md`이고,
그것을 강제하는 곳은 `db/ontology.sql`의 CHECK 제약이다. API는 그 제약 정의를
`pg_get_constraintdef`로 되읽어 어휘 목록을 만든다(`GET /api/ontology/vocabulary`).
파이썬에도 TypeScript에도 라벨 목록을 다시 적지 않는다.

예외가 하나 있다. 프론트의 `graphStyles.ts`는 라벨별 색·모양·한글명을 갖는데, 이건
표시 규칙이지 어휘가 아니다. 다만 어휘와 어긋나면 화면이 조용히 회색 폴백으로 떨어지므로
`graphStyles.test.ts`가 17종 라벨과 정확히 일치하는지 검사한다.

**정의됐지만 비어 있는 자리를 숨기지 않는다.** 라벨 17종 중 11종이 아직 0건이다
(`MarketMove`·`Regime`·시나리오 계층 6종 등). 필터 바에서 이들은 점선 비활성 칩으로,
어휘 페이지에서는 `—`로 남는다. 무엇이 아직 안 만들어졌는지가 이 화면의 정보다.

## 화면

**그래프 탐색** (`/`)

- 라벨 필터는 온톨로지의 세 계층(실체 / 사건 / 시나리오)으로 묶인다.
- 기본 선택은 `Market`·`Index`·`Sector`·`Indicator` — 골격만. `Security`가 2,763개라
  기본으로 켜면 나머지 라벨이 종목 무리에 묻힌다.
- 라벨당 N개로 끊어 뽑는다(전체 상한이 아니라). 전체 상한만 걸면 알파벳순으로 한 라벨이
  화면을 다 먹는다.
- 노드 클릭 = 상세 패널, 더블클릭 = 이웃 확장. 확장은 기존 노드 위치를 흔들지 않는다.
- 점선 엣지 = 파생 엣지(`method`/`computed_at`/`pipeline_version` 보유). "재계산이 지워도
  되는 것"이라는 계약이 선 모양으로 드러난다.
- 상세 패널은 속성·연결 차수와 함께 **`evidence`(lake.records의 record_id)**를 보여준다.
  모든 노드가 어느 수집 레코드에서 나왔는지 들고 있다는 것이 이 온톨로지의 규칙이고,
  화면에서 확인할 수 없으면 지켜지는지 알 수 없다.

**어휘** (`/ontology`) — 정의된 라벨·엣지 타입과 실제 투영량의 대조표.

## API

| 엔드포인트 | 용도 |
|---|---|
| `GET /api/health` | DB 연결 상태 + 노드·엣지 수. DB가 죽어도 200으로 답하고 사유를 본문에 담는다 |
| `GET /api/ontology/vocabulary` | 허용 어휘(CHECK 제약에서 되읽음) + 실제 행수 |
| `GET /api/graph/overview` | 라벨별 표본과 그 사이의 엣지 |
| `GET /api/graph/neighbors` | uid에서 1~2홉 이웃 |
| `GET /api/graph/node/{uid}` | 노드 상세 — 속성·차수·evidence |
| `GET /api/search` | 이름·uid·티커 부분일치 |

`uid`에 슬래시가 들어간다(`Event` uid가 기사 URL이다). 경로 파라미터는 `:path` 컨버터를
쓰고 프론트는 `encodeURIComponent`로 감싼다.

## 테스트

```bash
cd web && npx vitest run     # 14개 — payload 변환, 스타일표 ↔ 어휘 일치
cd api && python -m pytest tests -q   # 5개 — CHECK 제약 파싱
```

DB가 필요한 경로는 아직 자동 테스트가 없다. 지금은 실호출로 확인했다 —
`vocabulary`(라벨 17·엣지 24), `overview`(133노드/109엣지), `node/security:KR7005930003`
(evidence 1건, LISTED_ON 1), `search?q=005930`(티커 매칭).

## 아직 없는 것

- **시계열이 화면에 없다.** `core.*` 테이블이 전부 0행이다 —
  `scripts/project_ontology.py --timeseries`가 한 번도 실행되지 않았다. 시세·수급을 붙이려면
  그 투영이 먼저다.
- 경로 탐색(두 노드 사이 최단 경로), 엣지 방향 필터, 레이아웃 저장.
- `Event` 노드는 어휘에 있고 425건 적재돼 있지만 다른 노드와 연결하는 `MENTIONS`·`ABOUT`
  엣지가 아직 0건이라, 탐색에서는 고립된 점으로만 보인다.
