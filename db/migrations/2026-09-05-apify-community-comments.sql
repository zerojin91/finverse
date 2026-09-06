-- Extend the existing community_v2 view without changing loader functions.
BEGIN;

CREATE OR REPLACE VIEW psychology.community_v2 AS
SELECT
    nullif(c.payload->>'published_at', '')::timestamptz AS published_at,
    nullif(c.payload->>'updated_at', '')::timestamptz   AS updated_at,
    c.payload->>'channel_id'                            AS channel_id,
    c.payload->>'video_id'                              AS video_id,
    c.payload->>'text'                                  AS comment_text,
    coalesce(nullif(c.payload->>'like_count', '')::integer, 0) AS like_count,
    coalesce(nullif(c.payload->>'reply_count', '')::integer, 0) AS reply_count,
    c.payload->>'source_url'                            AS source_url,
    c.collected_at,
    c.record_id,
    v.payload->>'title'                                 AS video_title,
    v.payload->'video_filter_terms'                     AS video_filter_terms,
    v.payload->'search_tags'                            AS search_tags,
    v.payload->'search_matches'                         AS search_matches,
    c.payload->>'category'                              AS category,
    c.payload->'tags'                                   AS tags,
    nullif(c.payload->>'video_like_rank', '')::integer  AS video_like_rank,
    nullif(c.payload->>'comments_per_video', '')::integer AS comments_per_video
FROM lake.records AS c
JOIN lake.records AS v
  ON v.record_type = 'youtube_video'
 AND v.payload->>'video_id' = c.payload->>'video_id'
 AND (v.payload->>'video_filter' = 'semiconductor' OR v.payload ? 'search_tags')
 AND coalesce(nullif(v.payload->>'is_deleted', '')::boolean, false) = false
WHERE c.record_type = 'youtube_comment'
  AND c.payload->>'category' = 'community_v2'
  AND c.payload->'tags'->>'source' = 'youtube'
  AND nullif(c.payload->>'video_like_rank', '')::integer BETWEEN 1
      AND nullif(c.payload->>'comments_per_video', '')::integer
  AND coalesce(nullif(c.payload->>'is_deleted', '')::boolean, false) = false
  AND nullif(c.payload->>'published_at', '') IS NOT NULL
  AND nullif(c.payload->>'text', '') IS NOT NULL
UNION ALL
SELECT
    nullif(c.payload->>'published_at', '')::timestamptz,
    nullif(c.payload->>'updated_at', '')::timestamptz,
    NULL::text AS channel_id,
    NULL::text AS video_id,
    c.payload->>'text' AS comment_text,
    coalesce(nullif(c.payload->>'like_count', '')::integer, 0),
    coalesce(nullif(c.payload->>'reply_count', '')::integer, 0),
    c.payload->>'source_url',
    c.collected_at,
    c.record_id,
    NULL::text AS video_title,
    NULL::jsonb AS video_filter_terms,
    c.payload->'search_tags',
    c.payload->'search_matches',
    c.payload->>'category',
    c.payload->'tags',
    NULL::integer AS video_like_rank,
    NULL::integer AS comments_per_video
FROM (
    SELECT record_id, collected_at, payload,
        row_number() OVER (
            PARTITION BY payload->'tags'->>'source', payload->>'source_url'
            ORDER BY coalesce(nullif(payload->>'like_count', '')::integer, 0) DESC,
                nullif(payload->>'published_at', '')::timestamptz DESC, record_id DESC
        ) AS post_like_rank
    FROM lake.records
    WHERE payload->>'category' = 'community_v2'
      AND ((record_type = 'instagram_comment' AND payload->'tags'->>'source' = 'instagram')
        OR (record_type = 'x_comment' AND payload->'tags'->>'source' = 'x'))
      AND coalesce(nullif(payload->>'is_deleted', '')::boolean, false) = false
      AND nullif(payload->>'source_url', '') IS NOT NULL
      AND nullif(payload->>'published_at', '') IS NOT NULL
      AND nullif(payload->>'text', '') IS NOT NULL
) AS c
WHERE c.post_like_rank <= least(5, greatest(1, coalesce(nullif(c.payload->>'comments_per_post', '')::integer, 5)));

-- Backward-compatible name for existing UI and analysis queries.
CREATE OR REPLACE VIEW psychology.youtube_comment AS
SELECT
    published_at, updated_at, channel_id, video_id, comment_text,
    like_count, reply_count, source_url, collected_at, record_id,
    video_title, video_filter_terms, search_tags, search_matches,
    video_like_rank, comments_per_video
FROM psychology.community_v2
WHERE tags->>'source' = 'youtube';

COMMIT;
