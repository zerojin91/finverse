# Economic Collector

`collectors/economic_ingest.py`는 FINVERSE의 경제 데이터를 ECOS와 KOSIS OpenAPI에서 수집하는 실행 스크립트다.

현재는 PostgreSQL에 직접 저장하지 않고, 나중에 공통 데이터베이스 스키마로 옮기기 쉬운 JSONL 파일을 `data/economic/`에 만든다.

## Requirements

- Python 3.12 이상
- `uv`
- ECOS API 키
- KOSIS API 키

프로젝트 루트의 `.env`에 API 키를 넣는다. `.env`는 Git에 커밋하지 않는다.

```dotenv
ECOS_API_KEY="발급받은_ECOS_API_키"
KOSIS_API_KEY="발급받은_KOSIS_API_키"
```

따옴표로 값을 감싸도 된다. 스크립트가 양쪽의 같은 따옴표를 제거한 뒤 사용한다.

## Sources

### ECOS

`--source ecos --series all`은 다음 계열을 수집한다.

| 별칭 | 데이터 | 주기 | ECOS table/item |
| --- | --- | --- | --- |
| `base_rate` | 한국은행 기준금리 | 일 | `722Y001 / 0101000` |
| `usd_krw` | 원달러환율 | 일 | `731Y001 / 0000001` |
| `gov_bond_3y` | 국고채 3년 | 일 | `817Y002 / 010200000` |
| `gov_bond_10y` | 국고채 10년 | 일 | `817Y002 / 010210000` |
| `cpi` | 소비자물가지수 | 월 | `901Y009 / 0` |
| `employment_rate` | 고용률 | 월 | `901Y027 / I61E` |
| `unemployment_rate` | 실업률 | 월 | `901Y027 / I61BC` |
| `industrial_production` | 전산업생산지수 계절조정 | 월 | `901Y033 / A00 / 2` |
| `real_gdp` | 실질GDP | 분기 | `200Y104 / 1400` |

### KOSIS

`--source kosis --series all`은 다음 계열을 수집한다.

| 별칭 | 데이터 | 주기 | KOSIS table/selection |
| --- | --- | --- | --- |
| `cpi` | 소비자물가지수 총지수 | 월 | `101 / DT_1J22003 / objL1=T10 / itmId=T` |
| `employment_rate` | 고용률 | 월 | `101 / DT_1DA7001S / objL1=0 / itmId=T90` |
| `unemployment_rate` | 실업률 | 월 | `101 / DT_1DA7001S / objL1=0 / itmId=T80` |
| `industrial_production` | 전산업생산지수 계절조정 | 월 | `101 / DT_1JH20202 / objL1=1 / itmId=T1` |

KOSIS 통계표 선택 방식은 `statisticsParameterData.do`를 사용하고, JSON 배열 응답을 위해 `jsonVD=Y`를 함께 전송한다.

## Commands

모든 명령은 프로젝트 루트(`/Users/hyeon/Documents/finverse`)에서 실행한다.

### Help

```bash
uv run python collectors/economic_ingest.py --help
uv run python collectors/economic_ingest.py backfill --help
```

### 20-year backfill

ECOS 전체 계열:

```bash
uv run python collectors/economic_ingest.py backfill \
  --source ecos \
  --series all \
  --years 20
```

KOSIS 전체 계열:

```bash
uv run python collectors/economic_ingest.py backfill \
  --source kosis \
  --series all \
  --years 20
```

특정 계열만 수집하려면 `--series`를 여러 번 지정한다.

```bash
uv run python collectors/economic_ingest.py backfill \
  --source ecos \
  --series base_rate \
  --series usd_krw \
  --years 20
```

### Daily update

기본값으로 최근 730일을 다시 조회한다. 발표 후 수정될 수 있는 과거 관측값도 이 범위에서 확인한다.

```bash
uv run python collectors/economic_ingest.py update \
  --source ecos \
  --series all

uv run python collectors/economic_ingest.py update \
  --source kosis \
  --series all
```

조회 범위를 줄이려면 `--revision-lookback-days`를 지정한다.

```bash
uv run python collectors/economic_ingest.py update \
  --source ecos \
  --series usd_krw \
  --revision-lookback-days 30
```

### ECOS table discovery

아직 별칭으로 등록하지 않은 ECOS 계열을 찾을 때 사용한다.

```bash
uv run python collectors/economic_ingest.py discover --keyword 기준금리
uv run python collectors/economic_ingest.py items --stat-code 722Y001
```

출력된 코드를 확인한 뒤 다음 형식으로 직접 조회할 수 있다.

```text
STAT_CODE:CYCLE:ITEM_CODE1[:ITEM_CODE2[:ITEM_CODE3[:ITEM_CODE4]]]:NAME
```

예시:

```bash
uv run python collectors/economic_ingest.py backfill \
  --source ecos \
  --series '722Y001:D:0101000:한국은행 기준금리' \
  --years 20
```

## Output files

스크립트가 `data/` 폴더를 찾지 못해도 필요한 폴더를 자동으로 만든다.

```text
data/economic/
├── raw/
├── observations.jsonl
├── latest.jsonl
├── changes.jsonl
├── runs.jsonl
└── state.json
```

| 파일 | 의미 |
| --- | --- |
| `raw/` | API가 반환한 원본 응답. 요청 URL에서는 API 키를 마스킹한다. |
| `observations.jsonl` | 새로 수집되거나 값이 변경된 관측값을 계속 추가하는 이력 파일 |
| `latest.jsonl` | 계열과 기간별 최신 관측값만 저장하는 조회용 파일 |
| `changes.jsonl` | `update`에서 새로 들어오거나 변경된 관측값의 기록 |
| `runs.jsonl` | 백필·업데이트 실행 시각, 출처, 건수, 오류 기록 |
| `state.json` | 계열별 마지막 성공 실행 상태 |

정규화된 관측값에는 다음 정보가 포함된다.

- `source`: `ECOS` 또는 `KOSIS`
- `external_series_id`: 출처의 계열 식별자
- `series_name`: 계열명
- `period`, `period_start`: 관측 기간
- `value`, `value_text`: 숫자값과 원문값
- `unit`: 단위
- `source_row`: 출처 API 원본 행
- `collected_at`: 수집 시각
- `record_hash`: 중복과 변경 판별용 해시

## Update behavior

1. 최근 수정 가능 기간을 API에서 다시 조회한다.
2. 관측값과 원본 행을 포함해 `record_hash`를 계산한다.
3. 기존 해시와 같으면 중복 저장하지 않는다.
4. 새 해시이면 `observations.jsonl`에 추가한다.
5. `latest.jsonl`은 계열과 기간별 최신 행으로 다시 만든다.
6. `update`에서 새로 발견된 행은 `changes.jsonl`에 기록한다.

따라서 같은 update 명령을 반복해도 같은 데이터를 계속 중복 저장하지 않는다.

## Verification

코드 문법 검사:

```bash
python3 -m py_compile collectors/economic_ingest.py
```

도움말 검사:

```bash
uv run python collectors/economic_ingest.py --help
```

처음 실행하는 컴퓨터에서는 API 키를 `.env`에 넣은 뒤, 작은 범위로 먼저 확인한다.

```bash
uv run python collectors/economic_ingest.py backfill \
  --source kosis \
  --series cpi \
  --years 1
```

그 다음 전체 20년 백필을 실행한다.

## Current boundary

현재 스크립트는 JSONL 파일까지 수집한다. PostgreSQL 테이블 생성과 적재는 ECOS, KOSIS, 시장, 이벤트, 감성 수집기의 공통 출력 형식을 모두 확정한 뒤 진행한다.
