-- Run against a disposable database with db/schema.sql applied:
-- psql -X -v ON_ERROR_STOP=1 -f tests/apify_community_views.sql
-- Both successful and failed runs leave no committed fixture records.
\set ON_ERROR_STOP on
BEGIN;

WITH base AS (
    SELECT '{"category":"community_v2","published_at":"2099-01-02T03:04:05Z",
      "text":"삼성전자 반도체 상승 전망","like_count":7,"reply_count":2,
      "search_tags":["삼성전자"],
      "search_matches":[{"company_name":"삼성전자","stock_code":"005930"}],
      "is_deleted":false}'::jsonb AS payload
), fixtures(name, record_type, extra) AS (
    VALUES
      ('video', 'youtube_video', '{"video_id":"test-apify-view-video",
        "title":"삼성전자 전망","video_filter":"semiconductor",
        "video_filter_terms":["반도체"],"tags":{"source":"youtube"}}'::jsonb),
      ('youtube', 'youtube_comment', '{"video_id":"test-apify-view-video",
        "channel_id":"test-apify-view-channel","tags":{"source":"youtube"},
        "video_like_rank":5,"comments_per_video":5}'::jsonb),
      ('instagram', 'instagram_comment', '{"tags":{"source":"instagram"},
        "source_url":"https://www.instagram.com/p/TestFixture/"}'::jsonb),
      ('x', 'x_comment', '{"tags":{"source":"x"},
        "source_url":"https://x.com/test/status/1"}'::jsonb),
      ('youtube-below-top-five', 'youtube_comment', '{"video_id":"test-apify-view-video",
        "tags":{"source":"youtube"},"video_like_rank":6,"comments_per_video":5}'::jsonb),
      ('instagram-wrong-source', 'instagram_comment', '{"tags":{"source":"x"}}'::jsonb),
      ('x-wrong-source', 'x_comment', '{"tags":{"source":"instagram"}}'::jsonb),
      ('wrong-type', 'news_article', '{"tags":{"source":"instagram"}}'::jsonb),
      ('wrong-category', 'instagram_comment', '{"category":"community_v1",
        "tags":{"source":"instagram"}}'::jsonb),
      ('empty-text', 'instagram_comment', '{"tags":{"source":"instagram"},"text":""}'::jsonb),
      ('deleted', 'x_comment', '{"tags":{"source":"x"},"is_deleted":true}'::jsonb),
      ('no-date', 'x_comment', '{"tags":{"source":"x"},"published_at":null}'::jsonb)
)
INSERT INTO lake.records(record_id, collector, record_type, source, record_hash, collected_at, payload)
SELECT 'test-apify-view:' || name, 'apify_view_test', record_type,
       'synthetic_fixture', 'test-only:' || name, now(), base.payload || extra
FROM base CROSS JOIN fixtures;

DO $$
DECLARE
    actual_ids text[];
BEGIN
    SELECT array_agg(record_id ORDER BY record_id) INTO actual_ids
    FROM psychology.community_v2 WHERE record_id LIKE 'test-apify-view:%';
    IF actual_ids IS DISTINCT FROM ARRAY[
        'test-apify-view:instagram', 'test-apify-view:x', 'test-apify-view:youtube'
    ] THEN
        RAISE EXCEPTION 'community_v2 included invalid or missed valid fixture rows: %', actual_ids;
    END IF;

    SELECT array_agg(record_id ORDER BY record_id) INTO actual_ids
    FROM psychology.youtube_comment WHERE record_id LIKE 'test-apify-view:%';
    IF actual_ids IS DISTINCT FROM ARRAY['test-apify-view:youtube'] THEN
        RAISE EXCEPTION 'YouTube compatibility view leaked SNS or lost its top-five row: %', actual_ids;
    END IF;

    IF (SELECT count(*) FROM psychology.community_v2
        WHERE record_id LIKE 'test-apify-view:%'
          AND category = 'community_v2'
          AND search_tags ? '삼성전자'
          AND search_matches @> '[{"company_name":"삼성전자","stock_code":"005930"}]'
          AND like_count = 7 AND reply_count = 2) <> 3 THEN
        RAISE EXCEPTION 'Company metadata or engagement counts did not survive the common view';
    END IF;

    IF NOT EXISTS (SELECT FROM psychology.youtube_comment
        WHERE record_id = 'test-apify-view:youtube'
          AND video_title = '삼성전자 전망'
          AND video_filter_terms = '["반도체"]'::jsonb
          AND channel_id = 'test-apify-view-channel'
          AND video_like_rank = 5 AND comments_per_video = 5) THEN
        RAISE EXCEPTION 'Existing YouTube video join or ranking metadata changed';
    END IF;

    IF (SELECT count(*) FROM psychology.community_v2
        WHERE record_id IN ('test-apify-view:instagram', 'test-apify-view:x')
          AND tags->>'source' IN ('instagram', 'x')
          AND source_url IS NOT NULL
          AND channel_id IS NULL AND video_id IS NULL AND video_title IS NULL
          AND video_like_rank IS NULL AND comments_per_video IS NULL) <> 2 THEN
        RAISE EXCEPTION 'SNS source provenance or non-video field semantics changed';
    END IF;
    RAISE NOTICE 'PASS: three valid sources, invalid rows excluded, YouTube compatibility and company tags preserved';
END;
$$;

-- Two posts on Instagram and one on X sharing a synthetic post URL each
-- receive seven comments. Each (platform, URL) must keep its own top five.
WITH groups(group_name, platform, post_url) AS (
    VALUES
      ('instagram-a', 'instagram', 'https://example.invalid/apify-test/post-a'),
      ('instagram-b', 'instagram', 'https://example.invalid/apify-test/post-b'),
      ('x-a', 'x', 'https://example.invalid/apify-test/post-a')
), valid_rows(name, record_type, payload) AS (
    SELECT group_name || ':' || number, platform || '_comment',
      jsonb_build_object('category', 'community_v2',
        'tags', jsonb_build_object('source', platform), 'source_url', post_url,
        'text', '삼성전자 테스트 댓글 ' || number,
        'published_at', '2099-01-03T03:04:05Z', 'like_count', number,
        'comments_per_post', 99)
    FROM groups CROSS JOIN generate_series(1, 7) AS number
), invalid_rows(name, record_type, payload) AS (
    SELECT name, record_type,
      '{"category":"community_v2","tags":{"source":"instagram"},
        "source_url":"https://example.invalid/apify-test/post-a",
        "text":"This invalid row must not occupy a ranked slot",
        "published_at":"2099-01-03T03:04:05Z","like_count":1000}'::jsonb || extra
    FROM (VALUES
      ('deleted', 'instagram_comment', '{"is_deleted":true}'::jsonb),
      ('empty', 'instagram_comment', '{"text":""}'::jsonb),
      ('wrong-type', 'x_comment', '{}'::jsonb)
    ) AS invalid(name, record_type, extra)
)
INSERT INTO lake.records(record_id, collector, record_type, source, record_hash, collected_at, payload)
SELECT 'test-apify-ranking:' || name, 'apify_view_test', record_type,
       'synthetic_fixture', 'test-only:' || name, now(), payload
FROM (SELECT * FROM valid_rows UNION ALL SELECT * FROM invalid_rows) AS fixtures;

DO $$
DECLARE
    matched_groups integer;
BEGIN
    SELECT count(*) INTO matched_groups FROM (
      SELECT tags->>'source', source_url
      FROM psychology.community_v2 WHERE record_id LIKE 'test-apify-ranking:%'
      GROUP BY tags->>'source', source_url
      HAVING array_agg(like_count ORDER BY like_count DESC) = ARRAY[7, 6, 5, 4, 3]
    ) AS matching;
    IF matched_groups <> 3 OR (
        SELECT count(*) FROM psychology.community_v2
        WHERE record_id LIKE 'test-apify-ranking:%'
    ) <> 15 THEN
        RAISE EXCEPTION 'Top five must be ranked independently per source and URL, excluding invalid high-like rows';
    END IF;

    IF (SELECT count(*) FROM lake.records WHERE record_id LIKE 'test-apify-ranking:%') <> 24 THEN
        RAISE EXCEPTION 'Ranking must preserve all source records, including below-rank comments';
    END IF;
    RAISE NOTICE 'PASS: each of three source/post groups keeps likes 7..3, invalid high-like rows consume no slots, all 24 source records retained';
END;
$$;

ROLLBACK;
