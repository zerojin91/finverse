# YouTube 국내 주식 댓글 수집기

`collectors/youtube_comment_ingest.py`는 국내 주식 관련 YouTube 채널 30개를 고정하고, 각 채널의 공개 업로드 영상 전체와 YouTube Data API v3에서 조회 가능한 공개 댓글·답글 전체를 수집한다. 실행용 셸은 `scripts/youtube_comment_ingest.sh`다.

“전체”는 API 키로 접근 가능한 공개 데이터 전체다. 비공개·삭제 영상, 검토 대기·스팸 댓글, API가 반환하지 않는 댓글은 수집할 수 없다.

## 수집 데이터

- 채널: 채널 ID, 이름, 국가, 누적 조회수, 구독자 수, 영상 수, 업로드 플레이리스트, 선정 순위
- 영상: 영상 ID, 채널 ID, 제목, 게시 시각, 공개 영상 URL, 마지막 댓글 전체 스캔 상태
- 댓글과 답글: 가명화된 댓글·부모·스레드 ID, 채널·영상 ID, 본문, 좋아요·답글 수, 게시·수정 시각, ETag
- 변경 기록: 신규·수정·삭제 상태, 이전/현재 레코드 해시, 관측 시각
- 실행 상태: 업로드·댓글·답글별 다음 페이지 토큰, 남은 영상 수, 호출 수와 종료 사유

작성자 이름, 작성자 채널 ID, 프로필 URL은 API 응답 필드에서 제외한다. 원본 댓글 ID와 댓글 deep-link도 저장하지 않는다. 댓글·부모·스레드 ID는 `YOUTUBE_ID_HASH_SALT`를 사용한 HMAC-SHA256으로 가명화한다. 본문의 이메일, 국내 휴대전화 번호와 IPv4 주소는 대체 문자열로 가린다.

## 채널 30개 선정과 고정

운영 환경에서는 검토가 끝난 정확히 30개 채널 ID를 `config/youtube_channels.json`에 고정하는 방식을 권장한다. `config/youtube_channels.example.json`을 복사해 채운다.

```json
{
  "channel_ids": [
    "UCxxxxxxxxxxxxxxxxxxxxxx",
    "UCyyyyyyyyyyyyyyyyyyyyyy"
  ]
}
```

```bash
./scripts/youtube_comment_ingest.sh backfill \
  --channel-file config/youtube_channels.json
```

또는 `--channel-id UC...`를 정확히 30번 반복한다. `--channel-count`를 바꾸면 고정 ID 수도 그 값과 정확히 같아야 한다.

고정 목록이 없으면 먼저 후보만 발견한다. 이 단계에서는 영상이나 댓글을 수집하지 않는다.

```bash
./scripts/youtube_comment_ingest.sh discover
```

`discover`는 다음 방식으로 `data/youtube_comments/channel_candidates.json`을 만든다.

1. `search.list(type=channel, order=viewCount)`로 `--query`의 채널 후보를 찾는다.
2. `channels.list`로 후보의 현재 통계를 조회한다.
3. 후보 중 `statistics.viewCount` 내림차순 상위 30개를 고른다.
4. 검토용 후보 파일에 29일 만료 정보와 함께 저장한다.

자동 결과는 “YouTube 전체의 국내 주식 전문 채널 절대 상위 30개”가 아니라 **검색 후보 중 채널 누적 조회수 상위 30개**다. 일반 방송사나 종합 경제 채널이 포함될 수 있으므로 최초 실제 backfill 전에 후보를 사람이 검토해야 한다. 후보를 다시 고르려면 `discover`를 다시 실행한다.

후보 파일의 채널명·URL·조회수를 검토한 다음 승인된 정확히 30개 ID만 `config/youtube_channels.json`에 둔다. 이 운영 파일은 `.gitignore` 대상이며 서버에만 둔다. 검토 없이 `backfill`을 실행하면 수집기는 종료한다. 원본 후보 파일은 29일 뒤 자동 삭제되며, 승인된 목록의 현재 통계는 수집할 때마다 다시 조회한다.

```bash
cp config/youtube_channels.example.json config/youtube_channels.json
vi config/youtube_channels.json
```

## 사용하는 API와 환경변수

Google Cloud 프로젝트에서 **YouTube Data API v3**를 활성화한 API 키가 필요하다.

| API | 용도 |
| --- | --- |
| `search.list` | 최초 채널 후보 생성 |
| `channels.list` | 채널 통계와 업로드 플레이리스트 조회 |
| `playlistItems.list` | 공개 업로드 영상 전체 페이지 순회 |
| `commentThreads.list` | 영상별 최상위 댓글 전체 페이지 순회, update의 최신 댓글 빠른 확인 |
| `comments.list` | 각 최상위 댓글의 답글 전체 페이지 순회 |

필수 환경변수:

```dotenv
YOUTUBE_API_KEY=발급받은_API_키
YOUTUBE_ID_HASH_SALT=최소_32자_이상의_랜덤_문자열
```

`YOUTUBE_ID_HASH_SALT`가 바뀌면 같은 댓글의 가명 ID가 달라진다. 최초 실행에 사용한 값을 백업하고 모든 수집 서버에서 동일하게 사용해야 한다. 수집기는 기존 데이터의 salt fingerprint와 다른 값으로 실행되는 것을 거부한다. 선택 환경변수 `FINVERSE_COLLECTOR_USER_AGENT`로 HTTP User-Agent를 바꿀 수 있다.

AWS 수집 서버에서는 실제 값은 다음 파일에만 넣는다.

```text
/home/ubuntu/finverse/.env
```

```bash
cd /home/ubuntu/finverse
chmod 600 .env
vi .env
```

키와 salt를 명령 인자, 코드, Git, 실행 로그에 남기지 않는다. API 키에는 YouTube Data API v3 제한과 서버의 고정 egress IP 제한을 적용한다.

## backfill 실행 방법

기본값은 채널 30개, 과거 공개 업로드 전체, 공개 최상위 댓글과 모든 공개 답글이다. `--start`가 없으므로 최초 공개 업로드까지 거슬러 올라간다. `--end`를 생략하면 작업을 처음 시작한 날짜로 고정되므로 여러 날 걸리는 backfill도 같은 범위에서 이어진다.

```bash
cd /home/ubuntu/finverse
./scripts/youtube_comment_ingest.sh backfill \
  --channel-file config/youtube_channels.json \
  --quota-budget 9000
```

영상 게시일 범위를 제한하려면 다음처럼 실행한다.

```bash
./scripts/youtube_comment_ingest.sh backfill \
  --channel-file config/youtube_channels.json \
  --start 2024-01-01 \
  --end 2026-08-09
```

수집기는 다음 위치를 각각 체크포인트로 기록한다.

- 현재 채널의 업로드 플레이리스트 `pageToken`
- 현재 영상의 최상위 댓글 `pageToken`
- 현재 댓글의 답글 `pageToken`
- 현재 댓글 페이지 안의 스레드 위치

페이지 응답은 즉시 중복 제거·병합한 뒤 다음 토큰을 기록한다. 처리 후 토큰 기록 전에 프로세스가 중단돼도 같은 페이지를 다시 읽을 뿐 중복 버전을 만들지 않는다. 쿼터 또는 `--quota-budget`에 도달하면 종료 코드 `75`, `status=paused`로 끝나며 같은 명령을 다음 날 실행하면 정확한 단계부터 이어간다.

진행 중인 작업과 다른 기간·명령·채널 목록으로 실행하면 안전을 위해 거부한다. 의도적으로 체크포인트를 버리고 새 범위로 시작할 때만 `--restart`를 사용한다. 이미 확정된 JSONL 데이터는 `--restart`로 삭제되지 않는다.

## update 실행 방법

```bash
./scripts/youtube_comment_ingest.sh update \
  --channel-file config/youtube_channels.json
```

`update`는 다음 작업을 한다.

1. 고정 채널의 통계와 최신 업로드 페이지를 먼저 갱신한다.
2. 채널별 최신 최상위 댓글 페이지를 먼저 반영한다.
3. 업로드 플레이리스트 전체를 재순회해 신규·수정·삭제 의심 영상을 찾는다.
4. 신규 영상 우선, 그다음 전체 스캔이 오래된 영상 순으로 모든 최상위 댓글과 답글을 순회한다.
5. 오류 없이 끝난 영상 스캔에서 보이지 않은 댓글을 변경 후보로 반영한다.

전체 재검사가 여러 날 이어져도 기본 `--end`를 사용한 빠른 갱신은 매일 오늘까지 확인하고, 새 영상은 댓글 큐 최우선으로 넣는다. 사용자가 `--end`를 명시한 과거 범위 작업은 그 날짜를 넘지 않는다.

`--quick-pages`는 update 시작 시 채널별로 먼저 확인할 최신 업로드 페이지 수다. 기본값은 1이며 `0`이면 빠른 갱신을 끈다.

```bash
./scripts/youtube_comment_ingest.sh update --quick-pages 2
```

YouTube 댓글 API에는 `updated_since` 필터가 없다. 최신 최상위 댓글은 매 실행 먼저 반영하지만, 오래된 스레드의 새 답글·수정·삭제는 해당 영상의 전체 스캔 때 확인된다. 매일 모든 과거 변경을 즉시 반영해야 한다면 30개 채널 전체를 매일 완주할 만큼의 쿼터가 필요하다.

## 중복 방지, 변경 이력, 삭제 안전성

- `record_id`는 채널·영상 ID 또는 가명화된 댓글 ID로 고정한다.
- 정규화 레코드의 canonical JSON SHA-256을 `record_hash`로 사용한다.
- 갱신·만료 시각과 스캔 운영 필드는 해시에서 제외한다.
- 같은 ID와 같은 해시는 새 이력·변경 이벤트를 만들지 않고 최신 만료 시각만 갱신한다.
- 오래된 체크포인트 페이지가 최신 빠른 업데이트보다 늦게 처리돼도 `refreshed_at` 비교로 최신 값을 되돌리지 않는다.
- 신규·수정 데이터는 `records.jsonl`과 `changes.jsonl`에 기록한다.
- 영상·댓글 삭제는 서로 다른 두 번의 오류 없는 전체 스캔에서 연속으로 보이지 않을 때 확정한다.
- 삭제가 확정되면 과거 댓글 본문 버전은 즉시 물리 제거하고, 본문이 없는 tombstone과 해시 변경 기록만 유지한다.
- `commentsDisabled`, 접근 거부, 답글 조회 중 삭제 경합은 완전한 삭제 근거로 사용하지 않는다.

Linux 실행 셸은 `flock`으로 backfill과 update의 동시 실행을 막는다.

## 결과 파일과 데이터 형식

PostgreSQL 연결 전의 이식 가능한 결과는 UTF-8 JSONL이다.

```text
data/youtube_comments/
├── records.jsonl
├── latest.jsonl
├── changes.jsonl
├── runs.jsonl
├── state.json
├── channel_candidates.json
├── channel_manifest.json
├── index.sqlite3
└── work/
    ├── thread_page.json
    └── salt_fingerprint.json
```

| 파일 | 의미 |
| --- | --- |
| `records.jsonl` | 신규·수정·삭제 레코드의 보관 기간 내 버전 이력 |
| `latest.jsonl` | `record_id`별 최신 상태 |
| `changes.jsonl` | insert/update 및 삭제 상태 변경 감사 기록 |
| `runs.jsonl` | 실행별 상태, 호출 수, 처리 건수, 종료 사유 |
| `state.json` | 마지막 실행 상태의 JSON 표현 |
| `channel_candidates.json` | `discover`가 만든 사람 검토용 30채널 후보 |
| `channel_manifest.json` | 현재 고정 채널 목록과 선정 방식 |
| `index.sqlite3` | 대용량 중복 제거와 체크포인트용 내부 디스크 인덱스 |
| `work/thread_page.json` | 답글 중단 재개에 필요한 현재 댓글 페이지 한 장 |

`index.sqlite3`는 PostgreSQL을 대신하는 업무 데이터 출력이 아니라 2GB 서버에서도 전체 JSONL을 메모리에 올리지 않기 위한 내부 인덱스다. 각 실행 종료 시 SQLite cursor로 JSONL 5종을 한 세대 디렉터리에 스트리밍한 뒤 하나의 심볼릭 링크를 교체해 같은 스냅샷으로 공개한다. 다른 시스템으로 전달할 기본 형식은 JSONL이다.

댓글 레코드 예시:

```json
{"record_id":"youtube:comment:hmac-sha256:...","record_type":"youtube_comment","channel_id":"UC...","video_id":"VIDEO_ID","comment_id":"hmac-sha256:...","parent_comment_id":null,"thread_id":"hmac-sha256:...","text":"댓글 본문","like_count":3,"reply_count":1,"published_at":"2026-08-01T01:02:03Z","updated_at":"2026-08-02T01:02:03Z","refreshed_at":"...","expires_at":"...","record_hash":"..."}
```

## 29일 보관과 쿼터 조건

API 키로 받은 공개 YouTube 데이터는 30일 이내에 갱신하거나 삭제해야 하므로 모든 API 레코드에 29일 만료 시각을 넣는다. 실행 시작 시 키가 없더라도 만료 데이터와 과거 댓글 본문을 먼저 정리한다. 현재 댓글 페이지 체크포인트도 29일을 넘기지 않는다.

기본 `--refresh-cycle-days 28` 안에 활성 영상 전체를 다시 확인하지 못하면 수집기는 완전한 성공으로 간주하지 않고 계속 `paused` 상태로 순환한다. 28일 안에 완주할 수 없다면 채널·기간을 줄이거나 Google의 쿼터 증액 심사를 진행해야 한다. 여러 API 프로젝트로 쿼터를 우회하면 안 된다.

## 정책 확인 필요

이 수집기는 재식별 위험을 줄이지만, 투자 댓글 원문에는 사용자가 직접 적은 자산·손익 등 민감한 금융 정보가 포함될 수 있다. 금융 에이전트 학습, 다른 커뮤니티와 결합, 감성·사용자 프로파일 생성에 사용하기 전에 YouTube API Services 정책, 개인정보 처리 근거, 필요한 Compliance Audit 범위를 팀의 법무·정책 담당자가 확인해야 한다. 검토 전에는 실제 30채널 production backfill을 예약 실행하지 않는다.

## 다른 컴퓨터에서 실행하는 방법

1. 저장소를 clone하고 프로젝트 루트로 이동한다.
2. Python 3.12 이상을 설치한다. 외부 Python 패키지는 필요 없다. `uv`가 있으면 자동 사용하고 없으면 `python3`로 실행한다.
3. `.env.example`을 `.env`로 복사하고 API 키와 **기존과 동일한 salt**를 넣은 뒤 권한을 600으로 제한한다.
4. 검토한 채널 ID 파일을 준비한다.
5. 도움말과 1채널 테스트 후 전체 backfill을 시작한다.

```bash
git clone https://github.com/zerojin91/finverse.git
cd finverse
cp .env.example .env
chmod 600 .env
./scripts/youtube_comment_ingest.sh --help
./scripts/youtube_comment_ingest.sh discover
./scripts/youtube_comment_ingest.sh backfill \
  --channel-count 1 \
  --channel-id UCxxxxxxxxxxxxxxxxxxxxxx \
  --quota-budget 20
./scripts/youtube_comment_ingest.sh backfill \
  --channel-file config/youtube_channels.json
```

기존 backfill을 다른 컴퓨터에서 이어가려면 코드뿐 아니라 `.env`의 동일 salt와 `data/youtube_comments/` 전체를 함께 옮긴다. 새로 시작하려면 데이터 폴더를 복사하지 않는다.

backfill 완료와 정책 승인을 확인한 뒤에만 매일 update를 예약한다. 수집기는 채널명·채널 ID를 stdout에 출력하지 않아 cron 로그에 API 데이터가 장기 보관되지 않는다.

```cron
15 18 * * * cd /home/ubuntu/finverse && ./scripts/youtube_comment_ingest.sh update >> /home/ubuntu/finverse/youtube-update.log 2>&1
```

## 검증

```bash
uv run python -m py_compile \
  collectors/_indexed_jsonl_store.py \
  collectors/youtube_comment_ingest.py
uv run python -m unittest tests.test_youtube_comment_ingest
bash -n scripts/youtube_comment_ingest.sh
./scripts/youtube_comment_ingest.sh --help
```

공식 참고 문서:

- [YouTube Data API search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [업로드 영상 목록 구현 가이드](https://developers.google.com/youtube/v3/guides/implementation/videos)
- [commentThreads.list](https://developers.google.com/youtube/v3/docs/commentThreads/list)
- [comments.list](https://developers.google.com/youtube/v3/docs/comments/list)
- [YouTube API Services 정책](https://developers.google.com/youtube/terms/developer-policies)
- [Quota and Compliance Audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
