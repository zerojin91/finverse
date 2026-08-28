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

## 조사·피드백 루프

Moderator는 먼저 scenario scheme, 후보 사례 조건, 사례별 시계열 창, Web Search의 primary·secondary
조사 범위를 포함한 historical_retrieval_plan을 만든다. 각 Subagent는 1차 Evidence에 후보 사례,
anchor date, 조회 범위, 데이터 가용성, 범위 확장 사유를 남긴다.

Moderator는 이 1차 조사본을 읽고 사례 유사성, 도메인 중복, 원시 시계열 누락, 웹 근거의 시간적
관련성을 검토한다. 필요한 경우에만 CASE_SELECTION, RANGE_EXPAND, RANGE_NARROW,
RAW_SERIES_MISSING, DUPLICATE_OWNERSHIP 중 하나의 구조화된 피드백을 Agent별 한 번 전달한다.
Subagent는 같은 Evidence를 한 번 보완하며, 적용 결과와 남은 data gap을 기록한다. 사후 수익률,
사후 사건, 사후 기사 결과를 근거로 사례를 고르거나 범위를 조정하는 것은 금지한다.

## 시장 원시 시계열

Market Agent는 기간 수익률 같은 요약값만 작성하지 않는다. 정량 판단에 쓴 지수·종목의 일별
원시 관측치를 Raw Time Series 섹션에 날짜 오름차순으로 보존한다. 현재 구간과 Moderator가 선정한
과거 사례의 각 anchor date에 대해 기본 관측 구간은 기준일 전 60거래일이며, 이 시계열을 단기
20일·중기 60일 창으로 구분한다. 각 행은 case ID, anchor date, 시계열 식별자,
거래일, 필드, 값, 단위 또는 price basis, source, record ID를 포함한다.

사용자가 더 긴 기간을 지정해도 현재 구간과 사례별 기준일 전 60거래일까지만 원시 행을 가져온다.
단일 DB 조회가 100행을 넘으면 연속된 날짜 청크로 나누며, 누락값을 보간하거나
요약값으로 원시 관측치를 대체하지 않는다. 수익률·변동성·최대 낙폭 등은 원시 행을 바탕으로
계산식, 시작·종료 관측일, 행 수와 함께 별도 기재한다. 같은 close·price basis에 대해서만
MA20·MA60을 계산하며, 필요한 관측치가 부족하면 data gap으로 기록한다.

## 출력 언어

모든 Agent Evidence와 최종 MiroFish 문서는 한국어로 작성한다. Web Search는 한국어 검색어와
한국어 출처를 우선 사용하며, 영어 원문만 확인 가능한 경우에도 제목·snippet·직접 인용을 복사하지
않고 사실 관계를 보존한 한국어 요약으로 기록한다. URL, record ID, ticker, 단위, 공식 약어만
원문 표기를 허용한다.

Web Search는 Moderator가 지정한 primary 조사 범위에서 시작한다. 범위 밖의 먼 과거 자료는 제도·정책·
산업 구조의 지속성과 현재 scenario scheme의 전달 경로가 모두 확인될 때만 secondary 자료로 확장한다.
이 경우 범위 확장 사유와 더 최근 대체자료가 없는 이유를 Evidence에 기록한다.

## 실행 환경

프로젝트 루트의 `.env`에 다음 값을 설정한다. 실제 자격증명은 버전 관리에 포함하지 않는다.

```dotenv
DATABASE_URL=postgresql://fvread:PASSWORD@HOST:5432/finverse?sslmode=prefer
FINVERSE_DB_STATEMENT_TIMEOUT_MS=60000
AWS_REGION=<Bedrock model access가 활성화된 리전>
# AWS_PROFILE=finverse-bedrock
# IAM role/profile 대신 Bedrock API key를 쓸 경우에만 설정
# AWS_BEARER_TOKEN_BEDROCK=<Bedrock API key>
BEDROCK_MODEL_ID=amazon.nova-lite-v1:0
FINVERSE_AGENT_MODEL=openrouter:z-ai/glm-5.3-flash
FINVERSE_BEDROCK_MAX_TOKENS=4096
FINVERSE_BEDROCK_TEMPERATURE=0
FINVERSE_BEDROCK_TIMEOUT_SECONDS=3600
OPENROUTER_API_KEY=<OpenRouter API key>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_APP_NAME=FINVERSE
FINVERSE_OPENROUTER_MAX_TOKENS=8192
FINVERSE_OPENROUTER_TIMEOUT_SECONDS=3600
FINVERSE_OPENROUTER_REASONING_EFFORT=high
```

Bedrock 모델은 LangChain의 `ChatBedrockConverse`를 통해 Converse API와 function tools를 사용한다.
동료 AWS 계정에서 Bedrock model access를 켜고, 실행 환경에는 IAM role 또는 `AWS_PROFILE`로
`bedrock:InvokeModel` 권한을 제공해야 한다. AWS access key·secret을 `.env`나 노트북에 기록하지 않는다.

`BEDROCK_MODEL_ID`는 계정과 리전에서 접근 가능한 모델로 바꿀 수 있다. 기본값인
`amazon.nova-lite-v1:0`은 비용 중심의 디버깅 기본값이며, 더 높은 품질이 필요하면
`amazon.nova-pro-v1:0` 등 승인된 모델 ID로 교체한다.

OpenRouter를 사용할 때는 `FINVERSE_AGENT_MODEL=openrouter:z-ai/glm-5.3-flash`로 설정한다.
이 경로는 OpenRouter의 OpenAI-compatible **Chat Completions** endpoint를 사용하므로 `openai:`
prefix와 호환되지 않는다. `OPENROUTER_API_KEY`가 필요하며, 이전 `stealth/ox-alpha` 별칭 대신
현재 공개 모델 ID인 `z-ai/glm-5.3-flash`를 사용한다. 이 모델은 reasoning effort에 `low`, `high`,
`max`를 지원하므로 `FINVERSE_OPENROUTER_REASONING_EFFORT=high`를 기본값으로 둔다.

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
[`agents/mirofish_seed_generator_bedrock.ipynb`](../agents/mirofish_seed_generator_bedrock.ipynb)를 사용한다.

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
