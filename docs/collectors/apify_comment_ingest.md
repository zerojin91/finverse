# Apify Instagram·X 댓글 수집기

`collectors/apify_comment_ingest.py`는 `config/apify_community_targets.json`에 승인된 Instagram·X 원게시물의 댓글을 가져온다. 결과는 PostgreSQL에 직접 쓰지 않고 먼저 `data/apify_comments/`의 버전 관리 JSONL에 저장한다.

저장 레코드는 `category=community_v2`, `source=apify`다. Instagram은 `record_type=instagram_comment`, `tags.source=instagram`; X는 `record_type=x_comment`, `tags.source=x`다. 작성자·프로필·댓글 링크는 저장하지 않고, 댓글·부모·스레드 ID는 HMAC-SHA256으로 가명화한다. 본문의 이메일·휴대전화·IPv4·`@mention`도 가린다.

## 수집 데이터와 API

- Instagram: [Apify Instagram Comment Scraper](https://apify.com/apify/instagram-comment-scraper), 게시물별 최신 댓글 최대 15개
- X: [Xquik X Tweet Scraper](https://apify.com/xquik/x-tweet-scraper), 원게시물의 직접 답글
- 대상 종목: `config/youtube_companies.json`의 10개 기업
- 대상 게시물과 종목 연결: `config/apify_community_targets.json`

각 게시물에서 API가 반환한 후보를 좋아요 수, 게시 시각, 가명 ID 순으로 정렬해 최대 5개를 저장한다. 이는 수집 후보 중 Top 5이며 원사이트 전체 댓글의 절대 Top 5는 아니다. 여러 기업이 언급된 게시물의 댓글은 해당 기업 검색 태그를 함께 가지지만, 개별 댓글이 모든 기업을 직접 언급한다는 뜻은 아니다.

필요한 환경변수는 다음과 같다. 운영 서버에서는 `/home/ubuntu/finverse/.env`에 두고 권한을 `600`으로 유지한다.

```dotenv
APIFY_TOKEN=...
COMMUNITY_ID_HASH_SALT=...
```

`COMMUNITY_ID_HASH_SALT`가 없으면 기존 `YOUTUBE_ID_HASH_SALT`를 사용한다. salt는 32자 이상이어야 하며 한번 저장을 시작한 뒤 바꾸면 기존 ID와 연결되지 않으므로 수집기가 거부한다. 토큰과 salt 값을 코드·Git·로그에 넣지 않는다.

Actor 실행에는 `Authorization: Bearer` 헤더를 사용한다. 토큰을 URL에 넣지 않는다. 기본 실행당 비용 상한은 Instagram `$0.50`, X `$0.10`이다. 계정 전체 무료 잔액은 별도이므로 정기 실행 전에 Apify Billing에서 확인한다.

## backfill 실행 방법

현재 대상 파일에 등록된 모든 게시물의 사용 가능한 과거 댓글을 처음 수집한다.

```bash
cd /home/ubuntu/finverse
python3 collectors/apify_comment_ingest.py backfill --dry-run
python3 collectors/apify_comment_ingest.py backfill
```

플랫폼 하나만 실행할 수 있다.

```bash
python3 collectors/apify_comment_ingest.py backfill --platform instagram
python3 collectors/apify_comment_ingest.py backfill --platform x
```

Instagram 무료 Actor는 게시물별 최신 댓글 최대 15개만 반환한다. 오래된 전체 댓글이 필요한 경우 Actor 플랜·입력 한도를 먼저 검토한다.

## update 실행 방법

`update`는 등록된 게시물을 다시 조회해 새 댓글과 API가 다시 반환한 과거 댓글의 본문·좋아요·답글 수 변경을 반영한다. 동일 ID·동일 내용은 중복 저장하지 않고, 내용이 달라진 레코드만 `records.jsonl`과 `changes.jsonl`에 새 버전으로 남긴다.

```bash
cd /home/ubuntu/finverse
python3 collectors/apify_comment_ingest.py update --dry-run
python3 collectors/apify_comment_ingest.py update
python3 scripts/load_postgres.py --collector apify_comment_ingest
```

`--dry-run`은 대상과 종목 연결을 검증하며 API를 호출하거나 비용을 발생시키지 않는다. 기본 한도는 다음 옵션으로 낮출 수 있다.

```bash
python3 collectors/apify_comment_ingest.py update \
  --instagram-limit 10 --x-limit 10 \
  --instagram-max-cost-usd 0.30 --x-max-cost-usd 0.05
```

대상 게시물 자체는 자동으로 추가하지 않는다. 새 게시물을 검토한 뒤 `config/apify_community_targets.json`에 공개 URL과 종목 코드를 추가해야 다음 `update`부터 포함된다.

## 결과 파일과 데이터 형식

`IndexedJsonlStore`가 아래 파일을 만든다.

- `data/apify_comments/latest.jsonl`: ID별 최신 상태
- `data/apify_comments/records.jsonl`: 최초 및 변경 버전 이력
- `data/apify_comments/changes.jsonl`: insert/update 변경 기록
- `data/apify_comments/runs.jsonl`: 실행 결과
- `data/apify_comments/index.sqlite3`: 중복 방지·증분 처리 인덱스

JSONL 한 줄은 JSON 객체 하나다. 주요 필드는 `record_id`, `record_type`, `source`, `category`, `tags`, `text`, `like_count`, `reply_count`, `published_at`, `source_url`, `search_tags`, `search_matches`, `post_like_rank`, `comments_per_post`다. 원본 API 응답은 저장하지 않는다.

로컬 Apify export를 다시 가져와야 할 때는 호환 `import` 명령을 쓴다.

```bash
python3 collectors/apify_comment_ingest.py import \
  --platform instagram --input /private/tmp/comments.json \
  --post-url 'https://www.instagram.com/p/POST_ID/' \
  --stock-code 005930
```

## PostgreSQL 적재

최초 배포에서 뷰 migration을 한 번 적용한 뒤 JSONL loader를 실행한다.

```bash
docker compose exec -T db psql -U finverse -d finverse -v ON_ERROR_STOP=1 \
  < db/migrations/2026-09-05-apify-community-comments.sql
python3 scripts/load_postgres.py --collector apify_comment_ingest
```

저장 흐름은 `Apify API → IndexedJsonlStore → lake.records → psychology.community_v2`다. `psychology.youtube_comment`는 이전 호환성을 위해 YouTube 행만 유지한다.

```sql
SELECT tags->>'source' AS source, count(*), count(DISTINCT source_url)
FROM psychology.community_v2
WHERE tags->>'source' IN ('instagram', 'x')
GROUP BY 1;
```

2026-09-05 최초 적재 결과는 Instagram 46개·12게시물, X 45개·9게시물이다.

## 다른 컴퓨터에서 실행

1. 저장소의 `main` 브랜치를 받고 Python 3.12 이상을 준비한다.
2. `.env`에 `APIFY_TOKEN`과 기존 서버와 같은 ID salt를 설정한다.
3. `config/apify_community_targets.json`을 검토한다.
4. 기존 이력을 이어갈 경우 `data/apify_comments/` 전체를 안전하게 복사한다. 복사하지 않으면 빈 저장소로 시작하므로 `backfill`이 필요하다.
5. `python3 collectors/apify_comment_ingest.py update --dry-run` 후 실제 명령을 실행한다.

검증은 다음과 같이 실행한다.

```bash
python3 -m unittest tests.test_apify_comment_ingest
```
