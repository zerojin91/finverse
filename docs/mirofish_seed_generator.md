# MiroFish Seed Generator

`agents/mirofish_a2a.py`는 사용자 시나리오를 입력받아 MiroFish용 시드 Markdown을 생성하는 LangChain·DeepAgents 기반 A2A 파이프라인이다.

## 구조

```text
argparse CLI → Moderator Deep Agent
  ├─ market_agent     (market.*)
  ├─ economy_agent    (economy.*)
  ├─ events_agent     (events.*)
  └─ web_search_agent (DuckDuckGo 검색 및 원문 검증)
                         ↓
                  mirofish-input.md
```

각 전문 Agent는 LangChain `create_agent()`로 독립 구성되고 DeepAgents `CompiledSubAgent`로 Moderator에 등록된다. 전문 Agent는 자기 도메인의 Evidence Markdown만 작성하며, Moderator가 네 문서를 검토하고 최종 MiroFish 입력을 생성한다.

Moderator는 다음을 통제한다.

- `record_id`와 URL을 이용한 중복 증거 탐지
- 도메인별 사실 소유권
- Agent별 최대 1회 보완
- 정보 절단일 이후 데이터 차단
- 상승·기준·하락 조건부 시나리오 구성
- 확정적인 가격 전망과 투자 추천 금지

## 과거 유사 사례 Attention

Moderator는 검색 전에 사용자 시나리오를 `scenario_signature`로 구조화하고 도메인별 Attention 가중치를 정한다.

각 전문 Agent는 과거 사례를 다음 방식으로 다룬다.

1. 과거 후보를 최소 5개 탐색한다.
2. 각 후보의 기준일 당시 알 수 있었던 정보만으로 유사도를 계산한다.
3. 상위 3개 유사 사례와 반례 1개를 선정한다.
4. 사례를 선정한 후에만 기준일 이후의 사후 경로를 조회한다.
5. 사후 관측 구간 전체가 `as_of` 이전에 끝난 경우만 사용한다.
6. 일치점과 차이점, 현재 적용 조건과 시나리오가 깨지는 조건을 함께 기록한다.

유사 사례는 예측값이 아니라 조건부 시나리오를 구성하기 위한 참고 근거다.

## 시장 원시 시계열

Market Agent는 기간 수익률 같은 요약값만 작성하지 않는다. 정량 판단에 쓴 지수·종목의 일별
원시 관측치를 Raw Time Series 섹션에 날짜 오름차순으로 보존한다. 각 행은 시계열 식별자,
거래일, 필드, 값, 단위 또는 price basis, source, record ID를 포함한다.

사용자가 기간을 지정하면 그 기간의 전 행을, 기간이 없으면 기준일 전 최근 60거래일의 전 행을
가져온다. 단일 DB 조회가 100행을 넘으면 연속된 날짜 청크로 나누며, 누락값을 보간하거나
요약값으로 원시 관측치를 대체하지 않는다. 수익률·변동성·최대 낙폭 등은 원시 행을 바탕으로
계산식, 시작·종료 관측일, 행 수와 함께 별도 기재한다.

## 실행 환경

프로젝트 루트의 `.env`에 다음 값을 설정한다. 실제 자격증명은 버전 관리에 포함하지 않는다.

```dotenv
DATABASE_URL=postgresql://fvread:PASSWORD@HOST:5432/finverse?sslmode=prefer
FINVERSE_DB_STATEMENT_TIMEOUT_MS=60000
OPENAI_API_KEY=...
FINVERSE_AGENT_MODEL=openai:gpt-5.6-terra
FINVERSE_AGENT_REASONING_EFFORT=medium
```

OpenAI 모델은 LangChain의 Responses API 경로로 초기화되어 reasoning과 function tools를 함께 사용한다.
`FINVERSE_AGENT_REASONING_EFFORT`는 `none`, `low`, `medium`, `high`, `xhigh`, `max` 중 하나로
조정할 수 있으며 기본값은 `medium`이다. OpenAI API 키는 untracked `.env`에만 기록한다.

저비용 점검에는 `FINVERSE_AGENT_MODEL=openai:gpt-5.6-luna`와
`FINVERSE_AGENT_REASONING_EFFORT=low`를 설정할 수 있다. 최종 기능 검증에는
`gpt-5.6-terra`와 `medium` 이상을 사용한다.

DB 조회 제한시간은 기본 60초다. 원격 DB가 느리면 `FINVERSE_DB_STATEMENT_TIMEOUT_MS`를
최대 `300000`(5분)까지 늘릴 수 있다. 시간 초과가 발생하면 DB Agent는 기간과 검색 조건을
좁혀 한 번만 재조회하고, 다시 실패하면 전체 실행을 중단하지 않고 `Limitations`에 데이터 부족으로 남긴다.

의존성을 설치한다.

```bash
uv sync
```

## 실행

시나리오만 전달하면 된다.

Jupyter에서 단계별로 실행하려면
[`agents/mirofish_seed_generator_openai.ipynb`](../agents/mirofish_seed_generator_openai.ipynb)를 사용한다.

```bash
uv run python -m agents.mirofish_a2a \
  "반도체 수출 둔화가 한국 증시에 미칠 수 있는 영향"
```

기본값은 다음과 같다.

- `as_of`: 실행 당일
- `horizon`: `365d`
- `target`: `KOSPI`

특정 기준일과 대상을 지정할 수도 있다.

```bash
uv run python -m agents.mirofish_a2a \
  "반도체 수출 둔화가 한국 증시에 미칠 수 있는 영향" \
  --as-of 2026-08-01 \
  --horizon 365d \
  --target KOSPI
```

출력 경로를 직접 지정하려면 `--output-dir`을 사용한다.

```bash
uv run python -m agents.mirofish_a2a \
  "원·달러 환율 상승이 KOSPI에 미칠 수 있는 영향" \
  --output-dir output/examples/kospi-fx-shock
```

## Python에서 실행

```python
from datetime import date
from pathlib import Path

from agents.mirofish_a2a import run


output_dir = run(
    query="반도체 수출 둔화가 한국 증시에 미칠 수 있는 영향",
    target="KOSPI",
    as_of_date=date(2026, 8, 1),
    horizon="365d",
    output_dir=Path("output/examples/semiconductor-export-slowdown"),
)

print(output_dir / "mirofish-input.md")
```

## 산출물

기본적으로 `output/mirofish/<scenario>-asof-<date>/` 아래에 생성된다.

```text
market-evidence.md
economic-evidence.md
external-event-evidence.md
web-search-evidence.md
mirofish-input.md
```

각 Evidence 문서는 관측 사실, 해석, 유사 과거 사례, 후보 관계, 불확실성, 출처 식별자를 포함한다. `mirofish-input.md`는 Moderator가 중복과 충돌을 검토한 최종 MiroFish 시드 문서다.

특정 Agent가 timeout, 빈 조회 또는 원문 검증 실패로 채택 가능한 증거를 얻지 못한 경우에는
근거를 만들어내지 않는다. 해당 Evidence Register는 빈 표로 저장되고 `Limitations`에
`data gap`이 기록되며, Moderator는 나머지 Agent의 검증된 증거만 사용해 작업을 계속한다.
