# 접근 안내

FINVERSE 데이터베이스에 붙는 방법입니다. 두 단계를 거칩니다.

1. **Tailscale** — 서버까지 네트워크로 닿기
2. **PostgreSQL 계정** — 닿은 뒤 무엇을 할 수 있는지

층이 다릅니다. 둘 다 개인별로 발급되므로 한 사람만 회수하는 것도 각각 가능합니다.

## 1. Tailscale 설치

데이터베이스는 **공인 인터넷에 열려 있지 않습니다.** 사설 네트워크(tailnet)를 통해서만 닿습니다. IP 주소가 아니라 기기 인증이라, 집·회사·카페 어디서 접속하든 동일하게 동작하고 IP가 바뀌어도 아무 설정을 고칠 필요가 없습니다.

1. 관리자에게 초대 메일을 요청합니다. **계정을 공유하지 않습니다** — 각자 본인 Google/GitHub 계정으로 가입합니다.
2. [tailscale.com/download](https://tailscale.com/download) 에서 앱을 설치하고 초대받은 계정으로 로그인합니다.
3. 연결을 확인합니다.

```bash
tailscale status          # finverse-collector 가 보이면 정상
ping 100.89.226.42
```

| 항목 | 값 |
| --- | --- |
| 서버 이름 | `finverse-collector` |
| 주소 | `100.89.226.42` |
| DNS 이름 | `finverse-collector.taila68873.ts.net` |

ACL 정책에 따라 **데이터베이스 포트(5432)만** 열려 있습니다. 서버의 다른 포트나 tailnet의 다른 기기에는 닿지 않습니다.

## 2. 데이터베이스 접속

관리자에게 계정을 발급받습니다. 비밀번호는 발급 시 한 번만 표시되므로 비밀번호 관리자에 보관하세요.

```bash
psql "postgresql://<사용자>:<비밀번호>@100.89.226.42:5432/finverse"
```

GUI 도구(DBeaver, TablePlus, DataGrip 등)도 같은 정보로 붙습니다.

| 항목 | 값 |
| --- | --- |
| 호스트 | `100.89.226.42` |
| 포트 | `5432` |
| 데이터베이스 | `finverse` |
| SSL | 불필요 (tailnet 구간이 이미 암호화됨) |

## 3. 계정 종류

| 계정 | 할 수 있는 것 | 할 수 없는 것 |
| --- | --- | --- |
| 조회 전용 (`finverse_read`) | `lake`·`market` 스키마 `SELECT` | 모든 쓰기, 스테이징 테이블 조회 |
| 관리자 (`finverse_admin`) | 위 + 데이터 수정, 스키마 변경, 계정 관리 | 슈퍼유저 권한(다른 DB 접근, 서버 파일시스템) |

조회 전용 계정에는 안전장치가 걸려 있습니다.

- 세션이 **읽기 전용으로 강제**됩니다 (`default_transaction_read_only = on`)
- 쿼리가 **10분**을 넘으면 중단됩니다
- 트랜잭션을 열어둔 채 **5분** 이상 놀면 연결이 끊깁니다

무거운 분석 쿼리 하나가 적재 파이프라인을 막지 못하게 하기 위한 것입니다. 10분으로 부족한 작업이 있으면 관리자에게 문의하세요.

실제 동작은 이렇습니다.

```
SELECT count(*) FROM market.price_daily;   -> 13815
DELETE FROM lake.records WHERE false;      -> ERROR: cannot execute DELETE in a read-only transaction
SELECT * FROM lake.staging_records;        -> ERROR: permission denied for table staging_records
CREATE ROLE hacker LOGIN;                  -> ERROR: permission denied to create role
```

## 4. 무엇을 조회할 수 있나

도메인별 뷰가 준비돼 있습니다. `jsonb` 원본을 직접 다룰 필요는 없습니다.

| 뷰 | 내용 |
| --- | --- |
| `market.price_daily` | 종목 일별 시가·고가·저가·종가·거래량, 거래대금, 시가총액, 상장주식수 |
| `market.index_daily` | 지수·업종(섹터) 지수 일별 시세 |
| `market.security` | 종목 마스터 |
| `market.investor_flow_daily` | 외국인·기관 수급 |
| `market.foreign_holding_daily` | 외국인 보유주수·보유율 |
| `lake.coverage` | 수집기·유형·소스별 적재 현황과 기간 |

```sql
-- 무엇이 얼마나 들어와 있는지
SELECT * FROM lake.coverage ORDER BY record_type;

-- 삼성전자 최근 시세
SELECT trade_date, close, volume, trading_value
FROM market.price_daily
WHERE ticker = '005930' AND source = 'krx_open_api'
ORDER BY trade_date DESC LIMIT 10;
```

### 반드시 알아야 할 것: `source`를 지정하세요

같은 날 같은 종목인데 값이 두 벌 있습니다. **오류가 아니라 기준 차이입니다.**

| `source` | 기준 | 삼성전자 2018-04-25 |
| --- | --- | --- |
| `krx_open_api` | **원주가**(실제 체결가) | 2,520,000원 |
| `naver_finance` | **수정주가**(현재 주식수로 소급 보정) | 50,400원 |

2018-05-04 액면분할(50:1) 이후로는 두 값이 일치합니다.

- **수익률·변동성·차트** → `naver_finance`. 원주가를 쓰면 분할일에 가짜 폭락이 생깁니다.
- **거래대금·시가총액·상장주식수** → `krx_open_api`. Naver는 제공하지 않습니다.

`source`를 지정하지 않으면 두 벌이 섞여 나옵니다.

또 하나, 수급은 단위가 다릅니다. 시장 전체는 **금액**(`net_value_krw`), 종목별은 **수량**(`net_volume`)입니다. 합산하면 안 됩니다.

## 5. 관리자용

```bash
scripts/db_user.sh add    minsu read      # 계정 발급 (비밀번호 1회 출력)
scripts/db_user.sh add    sujin admin
scripts/db_user.sh list                   # 계정 목록
scripts/db_user.sh passwd minsu           # 비밀번호 재발급
scripts/db_user.sh revoke minsu           # 로그인 차단 + 진행 중 세션 종료
```

`revoke`는 롤을 지우지 않고 로그인만 막습니다. 객체 소유권이 깨지지 않게 하기 위해서입니다.

부트스트랩 `finverse` 슈퍼유저는 관리용으로만 두고 **공유하지 마세요.** 공유된 비밀번호는 한 사람만 회수할 수 없고, 누가 무엇을 했는지 남지 않습니다.

### Tailscale ACL

기본 설정은 tailnet 안의 기기끼리 모든 포트가 열립니다. 아래 정책으로 좁힙니다. [admin 콘솔 → Access controls](https://login.tailscale.com/admin/acls)에 넣습니다.

```json
{
    "hosts": {
        "finverse-db": "100.89.226.42",
    },
    "groups": {
        "group:analysts": ["팀원이메일@example.com"],
    },
    "grants": [
        // 소유자는 전부 접근 — 관리자 SSH가 끊기지 않게 하는 줄
        {"src": ["autogroup:owner"], "dst": ["*"], "ip": ["*"]},
        // 팀원은 DB 서버의 5432 하나만
        {"src": ["group:analysts"], "dst": ["finverse-db"], "ip": ["tcp:5432"]},
    ],
    "tests": [
        {
            "src": "팀원이메일@example.com",
            "accept": ["finverse-db:5432"],
            "deny": ["finverse-db:22"],
        },
    ],
}
```

`tests` 블록은 정책을 저장할 때마다 "팀원은 5432에 닿고 22에는 못 닿는다"를 자동 검증합니다.

`group:analysts`에 속한 사람은 `100.89.226.42`의 5432만 닿습니다. 소유자 본인은 `autogroup:owner`에도 해당되므로 이 제한을 받지 않습니다 — 제한이 실제로 걸리는지 확인하려면 팀원 기기에서 22번 포트가 막히는지 보세요. 서버 SSH도, tailnet의 다른 기기도 보이지 않습니다.

저장하는 순간 기본 allow-all이 대체되므로, **본인 기기에서 서버 SSH가 유지되는지 먼저 확인하세요** — 위 정책의 첫 줄이 그 역할을 합니다. `hosts`에 IP를 직접 적었으므로 서버를 tailnet에서 제거했다 다시 등록하면 이 값도 갱신해야 합니다.

## 문제 해결

**`tailscale status`에 서버가 안 보임** — 초대를 수락했는지, 로그인한 계정이 초대받은 계정과 같은지 확인하세요.

**포트는 닿는데 인증 실패** — 비밀번호 오타이거나 계정이 회수된 상태입니다. 관리자에게 `scripts/db_user.sh passwd` 재발급을 요청하세요.

**`cannot execute ... in a read-only transaction`** — 조회 전용 계정으로 쓰기를 시도한 것입니다. 정상 동작입니다.

**쿼리가 10분에 잘림** — 조회 전용 계정의 `statement_timeout`입니다. 범위를 좁히거나 관리자에게 문의하세요.

**연결은 되는데 테이블이 비어 있음** — 아직 적재 전일 수 있습니다. `SELECT * FROM lake.coverage;` 로 현재 적재 범위를 확인하세요.
