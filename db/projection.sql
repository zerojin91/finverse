-- FINVERSE 온톨로지 projection — lake.records 에서 core·graph 를 만든다.
--
-- 문서 §6-1: 그래프의 유일한 작성자는 이 파일이다. API 도 시뮬레이션도 쓰지 않는다.
-- 문서 §6-2: graph.rebuild() 는 멱등이다. 전량 삭제 후 다시 만들어도 같은 결과가 나온다.
--            사용자 실행 기록(Question·Simulation)은 core.scenario_* 원장에서 다시
--            투영되므로 그래프를 drop 해도 잃지 않는다.
--
--   docker compose exec -T db psql -U finverse -d finverse < db/projection.sql
--   scripts/project_ontology.py

BEGIN;

CREATE OR REPLACE FUNCTION graph.slug(t text) RETURNS text AS $$
    SELECT nullif(trim(both '-' from
        regexp_replace(lower(coalesce(t, '')), '[^a-z0-9가-힣]+', '-', 'g')), '');
$$ LANGUAGE sql IMMUTABLE;

-- evidence 는 추적용 표본이지 전량이 아니다. 지수 하나에 딸린 record_id 는
-- 거래일 수만큼(수천 건) 나오는데, 그걸 다 담으면 노드가 시계열을 다시 들고
-- 있는 꼴이 된다(§0 위반). 소스별 대표 몇 건만 남기고 나머지는 lake 에서 찾는다.
CREATE OR REPLACE FUNCTION graph.sample_evidence(ids text[]) RETURNS text[] AS $$
    SELECT (array_agg(id ORDER BY id))[1:5] FROM unnest(ids) AS id;
$$ LANGUAGE sql IMMUTABLE;

-- 지수 131개는 같은 종류가 아니다(문서 §1-1). 코스피·코스피 200 금융·
-- KRX 삼성전자 지수·코스닥 벤처기업부가 전부 같은 엔드포인트로 들어오므로,
-- 분류 없이 한 라벨로 뭉치면 "지수 평균 변동률" 류의 계산이 곧바로 무의미해진다.
--
-- 규칙 이름을 노드의 classified_by 에 박는다. 지수 코드(IDX_IND_CD)를 수집하게
-- 되면 이 이름 패턴 규칙을 통째로 교체한다(문서 §8).
CREATE OR REPLACE FUNCTION graph.index_kind(nm text) RETURNS text AS $$
    SELECT CASE
        WHEN nm ~ '(대형주|중형주|소형주)$'            THEN 'size'
        WHEN nm ~ '기업부$'                            THEN 'board_segment'
        WHEN nm ~ '^KRX .+ 지수$'                      THEN 'single_stock'
        WHEN nm ~ 'K-샤프지수|TMI'                     THEN 'factor'
        WHEN nm ~ '^(코스피|코스닥)( \(외국주포함\))?$' THEN 'market'
        -- 가중·편입 변형은 섹터가 아니라 전략지수의 파생이다.
        WHEN nm ~ '비중상한|TOP 10|초대형제외|중소형주' THEN 'strategy'
        WHEN nm IN ('코스피 200', '코스피 100', '코스피 50', 'KRX 100', 'KRX 300',
                    '코스닥 150', 'KTOP 30', '코스닥 글로벌', '코리아 밸류업 지수',
                    '코스피200제외 코스피지수')         THEN 'strategy'
        ELSE 'sector'
    END;
$$ LANGUAGE sql IMMUTABLE;

-- 'KRX 300 금융' 에서 '금융' 을 꺼낸다. 같은 섹터를 여러 유니버스가 추종하므로
-- 유니버스는 노드가 아니라 SECTOR_INDEX_OF 엣지의 속성으로 간다.
CREATE OR REPLACE FUNCTION graph.sector_name(nm text) RETURNS text AS $$
    SELECT regexp_replace(nm, '^(코스피 200|KRX 300|코스닥 150|KRX) ', '');
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION graph.sector_scheme(nm text) RETURNS text AS $$
    SELECT CASE
        WHEN nm ~ '^(코스피 200|KRX 300|코스닥 150) ' THEN 'gics_like'
        WHEN nm ~ '^KRX '                             THEN 'krx_thematic'
        ELSE 'krx_industry'
    END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION graph.index_universe(nm text, cls text) RETURNS text AS $$
    SELECT CASE
        WHEN nm ~ '^코스피 200 ' THEN '코스피 200'
        WHEN nm ~ '^KRX 300 '    THEN 'KRX 300'
        WHEN nm ~ '^코스닥 150 ' THEN '코스닥 150'
        WHEN nm ~ '^KRX '        THEN 'KRX'
        ELSE cls
    END;
$$ LANGUAGE sql IMMUTABLE;


CREATE OR REPLACE FUNCTION graph.rebuild() RETURNS jsonb AS $$
DECLARE
    counts jsonb;
BEGIN
    -- 엣지가 노드를 참조하므로 순서가 중요하다.
    DELETE FROM graph.edge;
    DELETE FROM graph.node;

    -- ---------------------------------------------------------------- §1 실체

    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'market:' || graph.slug(m),
           'Market',
           jsonb_build_object('code', m, 'name', m),
           graph.sample_evidence(array_agg(record_id))
    FROM (SELECT payload->>'market' AS m, record_id
          FROM lake.records
          WHERE record_type = 'market_security'
            AND nullif(payload->>'market', '') IS NOT NULL) t
    WHERE graph.slug(m) IS NOT NULL
    GROUP BY m;

    -- §6-8: 키는 isin 이지 ticker 가 아니다. ticker 는 조인용 속성으로만 둔다.
    -- sector_type 은 업종이 아니라 코스닥 소속부다(문서 §1-1). KOSPI 943건은
    -- 비어 있다. board_segment 속성으로 두고 Sector 노드를 만들지 않는다.
    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'security:' || isin,
           'Security',
           jsonb_strip_nulls(jsonb_build_object(
               'isin', isin,
               'ticker',        payload->>'ticker',
               'name',          payload->>'name',
               'short_name',    payload->>'short_name',
               'english_name',  payload->>'english_name',
               'share_type',    payload->>'share_type',
               'listed_on',     payload->>'listed_on',
               'par_value',     payload->>'par_value',
               'board_segment', nullif(payload->>'sector_type', ''),
               'source',        payload->>'source')),
           ARRAY[record_id]
    FROM (
        SELECT DISTINCT ON (payload->>'isin')
               payload->>'isin' AS isin, payload, record_id
        FROM lake.records
        WHERE record_type = 'market_security'
          AND nullif(payload->>'isin', '') IS NOT NULL
        ORDER BY payload->>'isin', collected_at DESC NULLS LAST
    ) t;

    -- §7-2 부채: KRX 지수 코드(IDX_IND_CD)를 수집하지 않아 이름 기반 uid 다.
    -- 코드를 수집하게 되면 여기와 문서 §1 을 함께 고친다.
    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'index:' || graph.slug(src) || ':' || graph.slug(cls) || ':' || graph.slug(nm),
           'Index',
           jsonb_strip_nulls(jsonb_build_object(
               'idx_class', cls, 'idx_name', nm, 'source', src,
               'kind', graph.index_kind(nm),
               'universe', CASE WHEN graph.index_kind(nm) = 'sector'
                                THEN graph.index_universe(nm, cls) END,
               'classified_by', 'name_pattern/v1')),
           graph.sample_evidence(array_agg(record_id))
    FROM (SELECT payload->>'source' AS src, payload->>'idx_class' AS cls,
                 payload->>'idx_name' AS nm, record_id
          FROM lake.records
          WHERE record_type = 'market_index_daily') t
    WHERE graph.slug(src) IS NOT NULL AND graph.slug(cls) IS NOT NULL
      AND graph.slug(nm) IS NOT NULL
    GROUP BY src, cls, nm;

    -- Sector 는 업종지수에서만 나온다(문서 §1-1). 같은 섹터를 코스피 업종과
    -- 코스피 200 하위지수가 각각 추종하므로 scheme 으로 갈라 둔다 -- 정의가
    -- 다른 둘을 같은 노드로 합치면 어느 정의의 '금융'인지 알 수 없게 된다.
    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'sector:' || scheme || ':' || graph.slug(sname),
           'Sector',
           jsonb_build_object('scheme', scheme, 'name', sname),
           graph.sample_evidence(array_agg(ev))
    FROM (SELECT graph.sector_scheme(props->>'idx_name') AS scheme,
                 graph.sector_name(props->>'idx_name')   AS sname,
                 unnest(evidence)                        AS ev
          FROM graph.node
          WHERE label = 'Index' AND props->>'kind' = 'sector') t
    WHERE graph.slug(sname) IS NOT NULL
    GROUP BY scheme, sname;

    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'indicator:' || graph.slug(src) || ':' || sid,
           'Indicator',
           jsonb_strip_nulls(jsonb_build_object(
               'source', src, 'external_series_id', sid,
               'series_name', max(payload->>'series_name'),
               'unit',        max(payload->>'unit'),
               'cycle',       max(payload->>'cycle'),
               'stat_code',   max(payload->>'stat_code'))),
           graph.sample_evidence(array_agg(record_id))
    FROM (SELECT payload->>'source' AS src,
                 payload->>'external_series_id' AS sid,
                 payload, record_id
          FROM lake.records
          WHERE record_type = 'economic_observation'
            AND nullif(payload->>'external_series_id', '') IS NOT NULL) t
    WHERE graph.slug(src) IS NOT NULL
    GROUP BY src, sid;

    -- Naver 업종 분류. KRX 업종지수(krx_industry)와 이름 체계가 다르고 구성종목이
    -- 있다는 점이 다르다 -- IN_SECTOR 를 만들 수 있는 유일한 소스다.
    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'sector:naver_wics:' || graph.slug(sname),
           'Sector',
           jsonb_build_object('scheme', 'naver_wics', 'name', sname,
                              'sector_code', min(scode)),
           graph.sample_evidence(array_agg(record_id))
    FROM (SELECT payload->>'sector_name' AS sname,
                 payload->>'sector_code' AS scode, record_id
          FROM lake.records
          WHERE record_type = 'market_sector_membership'
            AND nullif(payload->>'sector_name', '') IS NOT NULL) t
    WHERE graph.slug(sname) IS NOT NULL
    GROUP BY sname;

    -- ---------------------------------------------------------------- §2 사건
    --
    -- §6-11: 제목만 저장하지 않는다. RSS 가 주는 것은 사실 요약까지이므로
    -- fact 만 채우고 interpretation·market_reaction 은 비워 둔다 -- 채운 척
    -- 하지 않는 것이 요점이다.
    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'event:' || graph.slug(src) || ':' || ext,
           'Event',
           jsonb_strip_nulls(jsonb_build_object(
               'title',         payload->>'title',
               'url',           payload->>'url',
               'published_at',  payload->>'published_at',
               'country_codes', payload->'country_codes',
               'event_types',   payload->'event_types',
               'source',        src,
               'fact',          coalesce(nullif(payload->>'summary', ''),
                                         payload->>'title'))),
           ARRAY[record_id]
    FROM (
        SELECT DISTINCT ON (payload->>'source', payload->>'external_id')
               payload->>'source' AS src, payload->>'external_id' AS ext,
               payload, record_id
        FROM lake.records
        WHERE record_type = 'news_article'
          AND nullif(payload->>'external_id', '') IS NOT NULL
        ORDER BY payload->>'source', payload->>'external_id', collected_at DESC NULLS LAST
    ) t
    WHERE graph.slug(src) IS NOT NULL;

    -- ------------------------------------------------------------ §5 시나리오
    -- 재계산이 만들 수 없는 것. core 원장에서 투영한다(§6-2).

    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT uid, 'Question',
           jsonb_strip_nulls(jsonb_build_object(
               'text', text, 'asked_at', asked_at,
               'scope', scope, 'horizon_days', horizon_days)),
           '{}'
    FROM core.scenario_question;

    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT uid, 'Simulation',
           jsonb_strip_nulls(jsonb_build_object(
               'engine', engine, 'run_id', run_id,
               'config_digest', config_digest, 'started_at', started_at)),
           '{}'
    FROM core.scenario_run;

    -- ---------------------------------------------------------------- §3 관측

    INSERT INTO graph.edge (type, src_uid, dst_uid, props)
    SELECT DISTINCT 'LISTED_ON',
           'security:' || (r.payload->>'isin'),
           'market:' || graph.slug(r.payload->>'market'),
           jsonb_build_object('source', r.payload->>'source')
    FROM lake.records r
    WHERE r.record_type = 'market_security'
      AND nullif(r.payload->>'isin', '') IS NOT NULL
      AND graph.slug(r.payload->>'market') IS NOT NULL
      AND EXISTS (SELECT 1 FROM graph.node n
                  WHERE n.uid = 'security:' || (r.payload->>'isin'))
      AND EXISTS (SELECT 1 FROM graph.node m
                  WHERE m.uid = 'market:' || graph.slug(r.payload->>'market'))
    ON CONFLICT DO NOTHING;

    -- 지수가 어느 시장을 대표하는가. idx_class='KRX' 는 시장이 아니라 거래소라
    -- 대응하는 Market 노드가 없고, EXISTS 가 그 경우를 걸러낸다.
    INSERT INTO graph.edge (type, src_uid, dst_uid, props)
    SELECT DISTINCT 'TRACKS',
           n.uid,
           'market:' || graph.slug(n.props->>'idx_class'),
           jsonb_build_object('source', n.props->>'source')
    FROM graph.node n
    WHERE n.label = 'Index'
      AND EXISTS (SELECT 1 FROM graph.node m
                  WHERE m.uid = 'market:' || graph.slug(n.props->>'idx_class'))
    ON CONFLICT DO NOTHING;

    INSERT INTO graph.edge (type, src_uid, dst_uid, props)
    SELECT 'SECTOR_INDEX_OF',
           n.uid,
           'sector:' || graph.sector_scheme(n.props->>'idx_name') || ':'
                     || graph.slug(graph.sector_name(n.props->>'idx_name')),
           jsonb_strip_nulls(jsonb_build_object(
               'source', n.props->>'source', 'universe', n.props->>'universe'))
    FROM graph.node n
    WHERE n.label = 'Index' AND n.props->>'kind' = 'sector'
      AND graph.slug(graph.sector_name(n.props->>'idx_name')) IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- 종목→섹터. sector_ingest 가 가져온 Naver 업종 분류에서만 나온다.
    -- KRX 업종지수 쪽으로는 여전히 만들 수 없다 -- 구성종목을 주지 않는다.
    -- 매핑은 단축코드로 오고 Security 의 키는 isin 이라 ticker 로 조인한다(§6-8).
    INSERT INTO graph.edge (type, src_uid, dst_uid, props)
    SELECT DISTINCT 'IN_SECTOR',
           s.uid,
           'sector:naver_wics:' || graph.slug(r.payload->>'sector_name'),
           jsonb_build_object('source', r.payload->>'source',
                              'scheme', 'naver_wics')
    FROM lake.records r
    JOIN graph.node s
      ON s.label = 'Security' AND s.props->>'ticker' = r.payload->>'ticker'
    WHERE r.record_type = 'market_sector_membership'
      AND graph.slug(r.payload->>'sector_name') IS NOT NULL
      AND EXISTS (SELECT 1 FROM graph.node x
                  WHERE x.uid = 'sector:naver_wics:'
                              || graph.slug(r.payload->>'sector_name'))
    ON CONFLICT DO NOTHING;

    SELECT jsonb_object_agg(label, n) INTO counts
    FROM (SELECT label, count(*) AS n FROM graph.node GROUP BY label) t;

    RETURN jsonb_build_object(
        'nodes', coalesce(counts, '{}'::jsonb),
        'edges', (SELECT coalesce(jsonb_object_agg(type, n), '{}'::jsonb)
                  FROM (SELECT type, count(*) AS n FROM graph.edge GROUP BY type) e),
        'violations', (SELECT count(*) FROM graph.violations()));
END;
$$ LANGUAGE plpgsql;


-- 시계열은 그래프가 아니라 core 로 간다(§0). 970만 행이라 전량 재적재는
-- 비싸므로 graph.rebuild() 와 분리해 두고 명시적으로 부를 때만 돈다.
CREATE OR REPLACE FUNCTION core.rebuild_timeseries() RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    INSERT INTO core.price_daily AS p (
        bas_dd, ticker, source, price_basis, open, high, low, close,
        volume, trading_value, market_cap, listed_shares, change_pct, record_id)
    SELECT (payload->>'bas_dd')::date, payload->>'ticker',
           payload->>'source', payload->>'price_basis',
           (payload->>'open')::numeric, (payload->>'high')::numeric,
           (payload->>'low')::numeric, (payload->>'close')::numeric,
           (payload->>'volume')::bigint, (payload->>'trading_value')::numeric,
           (payload->>'market_cap')::numeric, (payload->>'listed_shares')::bigint,
           (payload->>'change_pct')::numeric, record_id
    FROM lake.records
    WHERE record_type = 'market_price_daily'
      AND nullif(payload->>'bas_dd', '') IS NOT NULL
    ON CONFLICT (bas_dd, ticker, source) DO UPDATE
        SET close = excluded.close, open = excluded.open, high = excluded.high,
            low = excluded.low, volume = excluded.volume,
            trading_value = excluded.trading_value, market_cap = excluded.market_cap,
            listed_shares = excluded.listed_shares, change_pct = excluded.change_pct,
            record_id = excluded.record_id;

    INSERT INTO core.index_daily AS i (
        bas_dd, idx_class, idx_name, source, price_basis,
        open, high, low, close, volume, trading_value, market_cap, change_pct, record_id)
    SELECT (payload->>'bas_dd')::date, payload->>'idx_class', payload->>'idx_name',
           payload->>'source', payload->>'price_basis',
           (payload->>'open')::numeric, (payload->>'high')::numeric,
           (payload->>'low')::numeric, (payload->>'close')::numeric,
           (payload->>'volume')::bigint, (payload->>'trading_value')::numeric,
           (payload->>'market_cap')::numeric, (payload->>'change_pct')::numeric,
           record_id
    FROM lake.records
    WHERE record_type = 'market_index_daily'
      AND nullif(payload->>'bas_dd', '') IS NOT NULL
    ON CONFLICT (bas_dd, idx_class, idx_name, source) DO UPDATE
        SET close = excluded.close, change_pct = excluded.change_pct,
            record_id = excluded.record_id;

    INSERT INTO core.investor_flow_daily AS f (
        bas_dd, target_type, target, investor, source,
        net_value_krw, net_volume, record_id)
    SELECT (payload->>'bas_dd')::date, payload->>'target_type', payload->>'target',
           payload->>'investor', payload->>'source',
           (payload->>'net_value_krw')::numeric, (payload->>'net_volume')::bigint,
           record_id
    FROM lake.records
    WHERE record_type = 'market_investor_flow_daily'
      AND nullif(payload->>'bas_dd', '') IS NOT NULL
    ON CONFLICT (bas_dd, target_type, target, investor, source) DO UPDATE
        SET net_value_krw = excluded.net_value_krw,
            net_volume = excluded.net_volume, record_id = excluded.record_id;

    INSERT INTO core.foreign_holding_daily AS h (
        bas_dd, ticker, source, held_shares, held_pct, record_id)
    SELECT (payload->>'bas_dd')::date, payload->>'ticker', payload->>'source',
           (payload->>'held_shares')::bigint, (payload->>'held_pct')::numeric,
           record_id
    FROM lake.records
    WHERE record_type = 'market_foreign_holding_daily'
      AND nullif(payload->>'bas_dd', '') IS NOT NULL
    ON CONFLICT (bas_dd, ticker, source) DO UPDATE
        SET held_shares = excluded.held_shares, held_pct = excluded.held_pct,
            record_id = excluded.record_id;

    INSERT INTO core.economic_observation AS e (
        source, external_series_id, period, period_start,
        value, value_text, unit, cycle, record_id)
    SELECT payload->>'source', payload->>'external_series_id', payload->>'period',
           nullif(payload->>'period_start', '')::date,
           (payload->>'value')::numeric, payload->>'value_text',
           payload->>'unit', payload->>'cycle', record_id
    FROM lake.records
    WHERE record_type = 'economic_observation'
      AND nullif(payload->>'external_series_id', '') IS NOT NULL
      AND nullif(payload->>'period', '') IS NOT NULL
    ON CONFLICT (source, external_series_id, period) DO UPDATE
        SET value = excluded.value, value_text = excluded.value_text,
            record_id = excluded.record_id;

    SELECT jsonb_build_object(
        'price_daily',            (SELECT count(*) FROM core.price_daily),
        'index_daily',            (SELECT count(*) FROM core.index_daily),
        'investor_flow_daily',    (SELECT count(*) FROM core.investor_flow_daily),
        'foreign_holding_daily',  (SELECT count(*) FROM core.foreign_holding_daily),
        'economic_observation',   (SELECT count(*) FROM core.economic_observation))
    INTO result;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMIT;
