-- FINVERSE 온톨로지 파생 계산 — 사건 노드와 해석 엣지.
--
-- docs/ontology/scenario-ontology.md §2 와 §4. 여기서 만드는 것은 전부
-- "재계산이 지워도 되는 것"이고, 해석 엣지는 method/computed_at/
-- pipeline_version 3종을 달고 나간다(§6-4). 관측(§3)은 건드리지 않는다.
--
--   scripts/project_ontology.py --derive
--
-- 판정 규칙과 임계값은 노드·엣지에 문자열로 박힌다. 임계값을 바꾸면 이전
-- 결과와 구분되어 나란히 남는다.

BEGIN;

CREATE SCHEMA IF NOT EXISTS derive;

-- 파생 파라미터를 한 곳에서 관리한다. 하드코딩하면 detected_by 문자열과
-- 실제 임계값이 따로 놀기 시작한다.
CREATE TABLE IF NOT EXISTS derive.params (
    key   text PRIMARY KEY,
    value numeric NOT NULL,
    note  text
);

INSERT INTO derive.params (key, value, note) VALUES
    ('pipeline_version',      1,   'derive.* 버전. 규칙을 바꾸면 올린다'),
    ('spike_z_index',       3.0,   '지수 250일 z 임계'),
    ('spike_abs_index',     3.0,   '지수 절대 일간변동 %'),
    ('spike_z_stock',       4.0,   '종목 250일 z 임계'),
    ('spike_abs_stock',    15.0,   '종목 절대 일간변동 %'),
    ('zscore_window',       250,   'z 계산 창(거래일)'),
    ('zscore_min_obs',       60,   '창이 덜 찼을 때 최소 관측수'),
    ('comove_window',       250,   '동조성 계산 창(거래일)'),
    ('comove_min_obs',      120,   '동조성 최소 겹치는 거래일'),
    ('comove_min_corr',     0.6,   '동조성 상관 하한'),
    ('comove_max_universe', 500,   '동조성 대상 종목 수(시총 상위)')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION derive.param(k text) RETURNS numeric AS $$
    SELECT value FROM derive.params WHERE key = k;
$$ LANGUAGE sql STABLE;


-- ---------------------------------------------------------------------------
-- 일간 지표. analyze.py 의 daily_metrics 를 창 함수로 옮긴 것이다. pandas 로
-- 970만 행을 올리면 3.7GB 머신에서 OOM 이 나지만 창 함수는 메모리가 평평하다.
--
-- 창은 현재 행을 포함한다 -- pandas rolling 과 같은 정의라야 임계값이 그대로
-- 옮겨진다. 창이 덜 찬 구간은 n_obs 로 걸러낸다(min_periods).

-- 비율 지표는 제외한다. 백분율 변화는 0에서 멀리 떨어진 양수 수열에서만 뜻이 있는데,
-- KRX 지수 시리즈에는 가격이 아닌 것이 섞여 있다. K-샤프지수는 위험조정 수익률이라
-- -2.27~3.54 를 오가며 0 을 지나가고, 0.02 -> 0.24 가 "+1100%" 로 잡힌다. 실제로
-- 그렇게 잡혔다: 상위 급등 8건이 전부 K-샤프지수였다.
--
-- 이름으로 거르지 않는다. 분류(`kind`)는 이름 패턴 규칙이라 K-샤프지수와 KRX TMI
-- 를 똑같이 `factor` 로 묶어놨는데, TMI 는 887~5,763 짜리 멀쩡한 가격지수다.
-- 수열이 한 번이라도 0 이하로 내려갔는지로 판단하면 둘이 정확히 갈리고, 앞으로
-- 새 비율 지표가 들어와도 자동으로 걸러진다.
CREATE OR REPLACE VIEW derive.index_metrics AS
WITH price_like AS (
    SELECT idx_class, idx_name, source
    FROM core.index_daily
    GROUP BY 1, 2, 3
    HAVING min(close) > 0
),
base AS (
    SELECT d.bas_dd, d.idx_class, d.idx_name, d.source, d.price_basis, d.close,
           d.record_id,
           (d.close / nullif(lag(d.close) OVER w, 0) - 1) * 100 AS ret_1d
    FROM core.index_daily d
    JOIN price_like p
      ON p.idx_class = d.idx_class AND p.idx_name = d.idx_name AND p.source = d.source
    WHERE d.close IS NOT NULL AND d.close > 0
    WINDOW w AS (PARTITION BY d.idx_class, d.idx_name, d.source ORDER BY d.bas_dd)
)
SELECT base.*,
       (ret_1d - avg(ret_1d) OVER w250)
           / nullif(stddev_samp(ret_1d) OVER w250, 0) AS zscore_250d,
       count(ret_1d) OVER w250                        AS n_obs
FROM base
WINDOW w250 AS (PARTITION BY idx_class, idx_name, source ORDER BY bas_dd
                ROWS BETWEEN 249 PRECEDING AND CURRENT ROW);

CREATE OR REPLACE VIEW derive.price_metrics AS
WITH base AS (
    SELECT bas_dd, ticker, source, price_basis, close, record_id,
           (close / nullif(lag(close) OVER w, 0) - 1) * 100 AS ret_1d
    FROM core.price_daily
    WHERE close IS NOT NULL AND close > 0
    WINDOW w AS (PARTITION BY ticker, source ORDER BY bas_dd)
)
SELECT base.*,
       (ret_1d - avg(ret_1d) OVER w250)
           / nullif(stddev_samp(ret_1d) OVER w250, 0) AS zscore_250d,
       count(ret_1d) OVER w250                        AS n_obs
FROM base
WINDOW w250 AS (PARTITION BY ticker, source ORDER BY bas_dd
                ROWS BETWEEN 249 PRECEDING AND CURRENT ROW);


-- ---------------------------------------------------------------------------
-- MarketMove — 큰 상승·하락 (§2)
--
-- 지수와 종목의 임계값이 다르다. 지수 ±3σ 또는 ±3%, 종목 ±4σ 또는 ±15%.
-- 종목 쪽이 느슨한 이유는 개별 종목의 일간 변동이 원래 크기 때문이다.
--
-- 기준주가에 대하여: 종목은 수정주가(naver_finance)로만 탐지한다. 원주가로
-- 계산하면 액면분할일마다 가짜 폭락이 잡힌다 -- 삼성전자 2018-05-04 가 -98%
-- 로 보인다. 지수는 분할의 영향을 받지 않으므로 KRX 원지수를 그대로 쓴다.

CREATE OR REPLACE FUNCTION derive.detect_moves() RETURNS jsonb AS $$
DECLARE
    z_index    numeric := derive.param('spike_z_index');
    abs_index  numeric := derive.param('spike_abs_index');
    z_stock    numeric := derive.param('spike_z_stock');
    abs_stock  numeric := derive.param('spike_abs_stock');
    min_obs    int     := derive.param('zscore_min_obs')::int;
    rule_index text    := format('spike:z>=%s|abs>=%s%%', z_index, abs_index);
    rule_stock text    := format('spike:z>=%s|abs>=%s%%', z_stock, abs_stock);
    stamp      timestamptz := now();
    version    text    := 'derive/v' || derive.param('pipeline_version')::int;
BEGIN
    DELETE FROM graph.edge WHERE type = 'MOVED';
    DELETE FROM graph.node WHERE label = 'MarketMove';

    -- 지수
    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'move:' || n.uid || ':' || m.bas_dd || ':' || kind,
           'MarketMove',
           jsonb_build_object(
               'bas_dd', m.bas_dd, 'kind', kind,
               'direction', CASE WHEN m.ret_1d > 0 THEN 'UP' ELSE 'DOWN' END,
               'magnitude', round(m.ret_1d, 4),
               'duration_days', 1,
               'peak_zscore', round(m.zscore_250d, 4),
               'target_uid', n.uid, 'target_label', 'Index',
               'detected_by', rule_index,
               'source', m.source, 'price_basis', m.price_basis,
               'computed_at', stamp, 'pipeline_version', version),
           ARRAY[m.record_id]
    FROM (SELECT *, CASE WHEN ret_1d > 0 THEN 'SPIKE_UP' ELSE 'SPIKE_DOWN' END AS kind
          FROM derive.index_metrics
          WHERE ret_1d IS NOT NULL AND n_obs >= min_obs
            AND (abs(zscore_250d) >= z_index OR abs(ret_1d) >= abs_index)) m
    JOIN graph.node n
      ON n.label = 'Index'
     AND n.props->>'idx_name' = m.idx_name
     AND n.props->>'idx_class' = m.idx_class
     AND n.props->>'source' = m.source
    ON CONFLICT (uid) DO NOTHING;

    -- 종목. 수정주가가 없으면 여기서 0건이 나온다 -- 원주가로 대신하지 않는다.
    INSERT INTO graph.node (uid, label, props, evidence)
    SELECT 'move:' || n.uid || ':' || m.bas_dd || ':' || kind,
           'MarketMove',
           jsonb_build_object(
               'bas_dd', m.bas_dd, 'kind', kind,
               'direction', CASE WHEN m.ret_1d > 0 THEN 'UP' ELSE 'DOWN' END,
               'magnitude', round(m.ret_1d, 4),
               'duration_days', 1,
               'peak_zscore', round(m.zscore_250d, 4),
               'target_uid', n.uid, 'target_label', 'Security',
               'detected_by', rule_stock,
               'source', m.source, 'price_basis', m.price_basis,
               'computed_at', stamp, 'pipeline_version', version),
           ARRAY[m.record_id]
    FROM (SELECT *, CASE WHEN ret_1d > 0 THEN 'SPIKE_UP' ELSE 'SPIKE_DOWN' END AS kind
          FROM derive.price_metrics
          WHERE ret_1d IS NOT NULL AND n_obs >= min_obs
            AND price_basis = 'adjusted'
            AND (abs(zscore_250d) >= z_stock OR abs(ret_1d) >= abs_stock)) m
    JOIN graph.node n
      ON n.label = 'Security' AND n.props->>'ticker' = m.ticker
    ON CONFLICT (uid) DO NOTHING;

    INSERT INTO graph.edge (type, src_uid, dst_uid, props)
    SELECT 'MOVED', mv.uid, mv.props->>'target_uid',
           jsonb_build_object('source', mv.props->>'source')
    FROM graph.node mv
    WHERE mv.label = 'MarketMove'
    ON CONFLICT DO NOTHING;

    RETURN jsonb_build_object(
        'moves', (SELECT count(*) FROM graph.node WHERE label = 'MarketMove'),
        'by_target', (SELECT coalesce(jsonb_object_agg(t, n), '{}'::jsonb)
                      FROM (SELECT props->>'target_label' t, count(*) n
                            FROM graph.node WHERE label = 'MarketMove'
                            GROUP BY 1) x),
        'by_kind', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                    FROM (SELECT props->>'kind' k, count(*) n
                          FROM graph.node WHERE label = 'MarketMove'
                          GROUP BY 1) y),
        'rules', jsonb_build_object('index', rule_index, 'stock', rule_stock));
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- CO_MOVES_WITH — 종목 동조성 (§4)
--
-- 온톨로지의 "섹터" 축을 실제로 쓰는 첫 엣지다. 같은 섹터 안에서만 짝을 만든다:
-- 전 종목 쌍은 2,800개면 390만 쌍이라 계산이 무의미하게 커지고, 섹터를 넘는
-- 동조성은 그 자체로 다른 질문이다.
--
-- 대상은 시총 상위 comove_max_universe 개로 자른다. 자른 사실은 결과에
-- dropped 로 보고한다 -- 조용히 줄이면 "전 종목을 봤다"로 읽힌다.

CREATE OR REPLACE FUNCTION derive.co_moves() RETURNS jsonb AS $$
DECLARE
    win       int     := derive.param('comove_window')::int;
    min_obs   int     := derive.param('comove_min_obs')::int;
    min_corr  numeric := derive.param('comove_min_corr');
    max_univ  int     := derive.param('comove_max_universe')::int;
    stamp     timestamptz := now();
    version   text    := 'derive/v' || derive.param('pipeline_version')::int;
    eligible  int;
    kept      int;
    made      int;
BEGIN
    DELETE FROM graph.edge WHERE type = 'CO_MOVES_WITH';

    -- 같은 트랜잭션에서 두 번 불릴 수 있다. ON COMMIT DROP 은 커밋 때까지
    -- 남으므로 재생성 전에 직접 치운다.
    DROP TABLE IF EXISTS universe;
    DROP TABLE IF EXISTS rets;

    CREATE TEMP TABLE universe ON COMMIT DROP AS
    WITH latest_cap AS (
        SELECT DISTINCT ON (ticker) ticker, market_cap
        FROM core.price_daily
        WHERE market_cap IS NOT NULL
        ORDER BY ticker, bas_dd DESC
    ),
    member AS (
        SELECT e.src_uid AS sec_uid, e.dst_uid AS sector_uid,
               s.props->>'ticker' AS ticker
        FROM graph.edge e
        JOIN graph.node s ON s.uid = e.src_uid
        WHERE e.type = 'IN_SECTOR'
    )
    SELECT m.sec_uid, m.sector_uid, m.ticker
    FROM member m
    JOIN latest_cap c ON c.ticker = m.ticker
    ORDER BY c.market_cap DESC
    LIMIT max_univ;

    SELECT count(*) INTO eligible FROM graph.edge WHERE type = 'IN_SECTOR';
    SELECT count(*) INTO kept FROM universe;

    CREATE TEMP TABLE rets ON COMMIT DROP AS
    SELECT u.sec_uid, u.sector_uid, p.bas_dd,
           (p.close / nullif(lag(p.close) OVER (PARTITION BY p.ticker
                                                ORDER BY p.bas_dd), 0) - 1) AS ret
    FROM core.price_daily p
    JOIN universe u ON u.ticker = p.ticker
    WHERE p.price_basis = 'adjusted'
      AND p.bas_dd > (SELECT max(bas_dd) FROM core.price_daily) - win;

    CREATE INDEX ON rets (sector_uid, bas_dd);

    INSERT INTO graph.edge (type, src_uid, dst_uid, props)
    SELECT 'CO_MOVES_WITH', a.sec_uid, b.sec_uid,
           jsonb_build_object(
               'corr', round(corr(a.ret, b.ret)::numeric, 4),
               'window_days', win,
               'observations', count(*),
               'sector_uid', a.sector_uid,
               'method', format('pearson:window=%sd|min_obs=%s|min_corr=%s',
                                win, min_obs, min_corr),
               'computed_at', stamp,
               'pipeline_version', version)
    FROM rets a
    JOIN rets b
      ON a.sector_uid = b.sector_uid AND a.bas_dd = b.bas_dd
     -- pk 작은->큰 단방향 저장. 조회는 양방향으로 한다.
     AND a.sec_uid < b.sec_uid
    WHERE a.ret IS NOT NULL AND b.ret IS NOT NULL
    GROUP BY a.sec_uid, b.sec_uid, a.sector_uid
    HAVING count(*) >= min_obs AND corr(a.ret, b.ret) >= min_corr
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS made = ROW_COUNT;

    RETURN jsonb_build_object(
        'edges', made,
        'universe', kept,
        'dropped', greatest(eligible - kept, 0),
        'note', format('IN_SECTOR %s건 중 시총 상위 %s종목만 계산', eligible, kept));
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION derive.run() RETURNS jsonb AS $$
    SELECT jsonb_build_object('moves', derive.detect_moves(),
                              'co_moves', derive.co_moves());
$$ LANGUAGE sql;

COMMIT;
