-- FINVERSE 시나리오 온톨로지 — 스키마
--
-- docs/ontology/scenario-ontology.md 가 단일 진실이고, 이 파일은 그 문서의
-- 불변식 중 DB가 강제할 수 있는 것을 제약으로 옮긴 것이다. 문서를 고치면 이
-- 파일도 같이 고친다. 반대 방향은 없다.
--
--   docker compose exec -T db psql -U finverse -d finverse < db/ontology.sql
--
-- 그래프를 Apache AGE가 아니라 관계형 두 테이블로 표현한다. 실체 노드는
-- 종목 2.8천 + 지수·지표·사건 수백 규모라 그래프 확장이 주는 이점보다
-- 커스텀 이미지와 AGE 1.6의 제약(MERGE ON CREATE 미지원, shortestpath 없음,
-- 가변 홉 제한)이 더 비싸다. 분기 트리 순회는 재귀 CTE로 충분하다.

BEGIN;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS graph;

-- ---------------------------------------------------------------------------
-- core — 그래프에 넣지 않는 것 (문서 §0)
--
-- market_price_daily 하나가 970만 행이다. 종목 × 거래일로 노드를 만들면
-- 그래프가 아니라 시계열 덤프가 된다. 값은 여기 있고, 그래프는 참조만 한다.

CREATE TABLE IF NOT EXISTS core.price_daily (
    bas_dd          date    NOT NULL,
    ticker          text    NOT NULL,
    source          text    NOT NULL,
    price_basis     text    NOT NULL,
    open            numeric, high numeric, low numeric, close numeric,
    volume          bigint, trading_value numeric, market_cap numeric,
    listed_shares   bigint, change_pct numeric,
    record_id       text    NOT NULL,
    -- source 가 키의 일부다(문서 §6-5). 같은 날 같은 종목이라도 KRX(원주가)와
    -- Naver(수정주가)는 각각 남고 서로 덮어쓰지 않는다.
    PRIMARY KEY (bas_dd, ticker, source)
);

CREATE TABLE IF NOT EXISTS core.index_daily (
    bas_dd          date    NOT NULL,
    idx_class       text    NOT NULL,
    idx_name        text    NOT NULL,
    source          text    NOT NULL,
    price_basis     text    NOT NULL,
    open            numeric, high numeric, low numeric, close numeric,
    volume          bigint, trading_value numeric, market_cap numeric,
    change_pct      numeric,
    record_id       text    NOT NULL,
    PRIMARY KEY (bas_dd, idx_class, idx_name, source)
);

CREATE TABLE IF NOT EXISTS core.investor_flow_daily (
    bas_dd          date    NOT NULL,
    target_type     text    NOT NULL CHECK (target_type IN ('MARKET', 'STOCK')),
    target          text    NOT NULL,
    investor        text    NOT NULL,
    source          text    NOT NULL,
    -- 시장 전체는 금액, 종목별은 수량이다. 단위가 달라 합산하면 안 되므로
    -- 한 컬럼에 뭉치지 않는다.
    net_value_krw   numeric,
    net_volume      bigint,
    record_id       text    NOT NULL,
    PRIMARY KEY (bas_dd, target_type, target, investor, source),
    CONSTRAINT flow_unit_matches_level CHECK (
        (target_type = 'MARKET' AND net_volume IS NULL) OR
        (target_type = 'STOCK'  AND net_value_krw IS NULL))
);

CREATE TABLE IF NOT EXISTS core.foreign_holding_daily (
    bas_dd          date    NOT NULL,
    ticker          text    NOT NULL,
    source          text    NOT NULL,
    held_shares     bigint,
    held_pct        numeric,
    record_id       text    NOT NULL,
    PRIMARY KEY (bas_dd, ticker, source)
);

CREATE TABLE IF NOT EXISTS core.economic_observation (
    source              text NOT NULL,
    external_series_id  text NOT NULL,
    period              text NOT NULL,
    period_start        date,
    value               numeric,
    value_text          text,
    unit                text,
    cycle               text,
    record_id           text NOT NULL,
    PRIMARY KEY (source, external_series_id, period)
);

-- 시나리오 원장. 재계산이 만들 수 없는 것은 여기 있고, projection 은 읽기만
-- 한다(문서 §6-2). 그래프를 drop 해도 이 테이블은 살아남는다.
CREATE TABLE IF NOT EXISTS core.scenario_question (
    uid         text PRIMARY KEY,
    text        text NOT NULL,
    asked_at    timestamptz NOT NULL,
    scope       jsonb NOT NULL DEFAULT '{}',
    horizon_days int
);

CREATE TABLE IF NOT EXISTS core.scenario_run (
    uid             text PRIMARY KEY,
    question_uid    text NOT NULL REFERENCES core.scenario_question(uid),
    engine          text NOT NULL,
    run_id          text NOT NULL,
    config_digest   text,
    started_at      timestamptz NOT NULL,
    finished_at     timestamptz,
    result          jsonb
);

-- ---------------------------------------------------------------------------
-- graph — 온톨로지 (문서 §1–§5)

CREATE TABLE IF NOT EXISTS graph.node (
    uid          text PRIMARY KEY,
    label        text NOT NULL,
    props        jsonb NOT NULL DEFAULT '{}',
    -- 유래한 lake.records.record_id. 어떤 노드든 원본으로 되짚을 수 있어야 한다.
    evidence     text[] NOT NULL DEFAULT '{}',
    projected_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT node_label_known CHECK (label IN (
        -- §1 실체
        'Market', 'Index', 'Sector', 'Security', 'Indicator', 'Actor',
        -- §2 사건
        'MarketMove', 'Release', 'Event', 'SentimentWindow', 'Regime',
        -- §5 시나리오
        'Question', 'Situation', 'Brief', 'Simulation', 'Branch', 'Assumption')),

    -- §6-5. 어느 소스의 어느 주가 기준으로 탐지했는지 없는 MarketMove 는
    -- 수익률 해석이 불가능하다. 분할일 가짜 폭락과 진짜 폭락을 못 가른다.
    CONSTRAINT marketmove_declares_basis CHECK (
        label <> 'MarketMove'
        OR (props ? 'source' AND props ? 'price_basis' AND props ? 'detected_by')),

    -- §6-7. 심리는 사실이 아니다. 표본과 오염도 없이는 노드로 만들지 않는다.
    CONSTRAINT sentiment_declares_quality CHECK (
        label <> 'SentimentWindow'
        OR (props ? 'sample_size' AND props ? 'bot_ratio' AND props ? 'dedup_ratio')),

    -- §6-10. 기준 시점과 발표 시점은 다르다.
    CONSTRAINT release_separates_period_and_release CHECK (
        label <> 'Release' OR (props ? 'period' AND props ? 'released_at')),

    -- §6-11. 사실·해석·시장반응을 한 필드에 뭉치면 근거와 추측을 못 가른다.
    CONSTRAINT event_separates_fact CHECK (
        label <> 'Event' OR props ? 'fact'),

    -- §6-9. 확률값은 교육용 시뮬레이션을 예측 단정으로 읽히게 만든다.
    -- 조건과 범위와 한계만 둔다.
    CONSTRAINT branch_states_conditions_not_probability CHECK (
        label <> 'Branch'
        OR (NOT (props ? 'probability')
            AND props ? 'conditions' AND props ? 'range' AND props ? 'limits')),

    CONSTRAINT node_uid_matches_label CHECK (uid ~ '^[a-z_]+:')
);

CREATE INDEX IF NOT EXISTS node_label_idx ON graph.node (label);
CREATE INDEX IF NOT EXISTS node_props_idx ON graph.node USING gin (props);

-- 해석 엣지 — 재계산이 지워도 되는 것. 이 목록에 있으면 method/computed_at/
-- pipeline_version 3종을 반드시 들고 있어야 한다(문서 §4, §6-4).
CREATE TABLE IF NOT EXISTS graph.derived_edge_type (type text PRIMARY KEY);
INSERT INTO graph.derived_edge_type (type) VALUES
    ('INFLUENCED'), ('TRANSMITS_TO'), ('REACTED_TO'), ('AMPLIFIED'),
    ('ANALOGOUS_TO'), ('CO_MOVES_WITH'), ('GROUNDED_IN')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS graph.edge (
    type     text NOT NULL,
    src_uid  text NOT NULL REFERENCES graph.node(uid) ON DELETE CASCADE,
    dst_uid  text NOT NULL REFERENCES graph.node(uid) ON DELETE CASCADE,
    props    jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (type, src_uid, dst_uid),

    CONSTRAINT edge_type_known CHECK (type IN (
        -- §3 관측
        'LISTED_ON', 'IN_SECTOR', 'COMPONENT_OF', 'TRACKS', 'SECTOR_INDEX_OF',
        'MOVED', 'REPORTED', 'MENTIONS', 'ISSUED_BY', 'ABOUT',
        -- §4 해석
        'INFLUENCED', 'TRANSMITS_TO', 'REACTED_TO', 'AMPLIFIED',
        'ANALOGOUS_TO', 'CO_MOVES_WITH',
        -- §5 시나리오
        'SCOPED_BY', 'INCLUDES', 'SIMULATED_AS', 'FED', 'PRODUCED',
        'BRANCHES_FROM', 'ASSUMES', 'GROUNDED_IN')),

    -- §6-4. 3종 속성이 곧 "재계산이 지워도 된다"는 계약이다. 이게 없으면
    -- 관측 엣지와 구분되지 않아 재계산이 사실을 지우게 된다.
    CONSTRAINT derived_edge_declares_method CHECK (
        type NOT IN ('INFLUENCED', 'TRANSMITS_TO', 'REACTED_TO', 'AMPLIFIED',
                     'ANALOGOUS_TO', 'CO_MOVES_WITH', 'GROUNDED_IN')
        OR (props ? 'method' AND props ? 'computed_at' AND props ? 'pipeline_version')),

    -- §6-6. 인과를 주장하지 않는다. 시차 상관 관측이라는 표시를 강제한다.
    CONSTRAINT influence_declares_confidence CHECK (
        type NOT IN ('INFLUENCED', 'TRANSMITS_TO', 'REACTED_TO', 'AMPLIFIED')
        OR (props ? 'confidence' AND props ? 'basis')),

    -- §4. 과거 결과를 미래의 정답으로 쓰지 않는다 — 차이를 반드시 함께 적는다.
    CONSTRAINT analogy_declares_divergence CHECK (
        type <> 'ANALOGOUS_TO' OR props ? 'divergence'),

    -- 관측 엣지는 어느 소스에서 도출됐는지 밝힌다.
    CONSTRAINT observed_edge_declares_source CHECK (
        type NOT IN ('LISTED_ON', 'IN_SECTOR', 'COMPONENT_OF', 'TRACKS',
                     'SECTOR_INDEX_OF', 'MOVED', 'REPORTED', 'MENTIONS',
                     'ISSUED_BY', 'ABOUT')
        OR props ? 'source'),

    -- §5. 검색 원칙 3단이 여기 담긴다. 중립 처리한 항목도 엣지로 남겨야
    -- 무엇을 왜 뺐는지가 시나리오의 한계 설명이 된다.
    CONSTRAINT includes_declares_role CHECK (
        type <> 'INCLUDES'
        OR props->>'role' IN ('user_specified', 'auto_supplemented', 'neutralized')),

    CONSTRAINT edge_not_self_loop CHECK (src_uid <> dst_uid)
);

CREATE INDEX IF NOT EXISTS edge_src_idx ON graph.edge (src_uid, type);
CREATE INDEX IF NOT EXISTS edge_dst_idx ON graph.edge (dst_uid, type);

-- 어떤 라벨 쌍에 어떤 엣지가 허용되는가. CHECK 로는 다른 테이블을 못 보므로
-- 표로 두고 graph.violations() 가 검사한다.
CREATE TABLE IF NOT EXISTS graph.edge_spec (
    type       text NOT NULL,
    src_label  text NOT NULL,
    dst_label  text NOT NULL,
    PRIMARY KEY (type, src_label, dst_label)
);

INSERT INTO graph.edge_spec (type, src_label, dst_label) VALUES
    ('LISTED_ON',       'Security',        'Market'),
    ('IN_SECTOR',       'Security',        'Sector'),
    ('COMPONENT_OF',    'Security',        'Index'),
    ('TRACKS',          'Index',           'Market'),
    ('SECTOR_INDEX_OF', 'Index',           'Sector'),
    ('MOVED',           'MarketMove',      'Index'),
    ('MOVED',           'MarketMove',      'Sector'),
    ('MOVED',           'MarketMove',      'Security'),
    ('REPORTED',        'Release',         'Indicator'),
    ('MENTIONS',        'Event',           'Security'),
    ('MENTIONS',        'Event',           'Sector'),
    ('MENTIONS',        'Event',           'Index'),
    ('MENTIONS',        'Event',           'Indicator'),
    ('ISSUED_BY',       'Event',           'Actor'),
    ('ABOUT',           'SentimentWindow', 'Security'),
    ('ABOUT',           'SentimentWindow', 'Sector'),
    ('ABOUT',           'SentimentWindow', 'Index'),
    ('INFLUENCED',      'Event',           'Indicator'),
    ('INFLUENCED',      'Event',           'MarketMove'),
    ('TRANSMITS_TO',    'Indicator',       'Index'),
    ('TRANSMITS_TO',    'Indicator',       'Sector'),
    ('TRANSMITS_TO',    'Indicator',       'Security'),
    ('REACTED_TO',      'SentimentWindow', 'MarketMove'),
    ('AMPLIFIED',       'SentimentWindow', 'MarketMove'),
    ('ANALOGOUS_TO',    'Situation',       'Regime'),
    ('ANALOGOUS_TO',    'Situation',       'MarketMove'),
    ('CO_MOVES_WITH',   'Security',        'Security'),
    ('SCOPED_BY',       'Situation',       'Question'),
    ('INCLUDES',        'Situation',       'Index'),
    ('INCLUDES',        'Situation',       'Security'),
    ('INCLUDES',        'Situation',       'Sector'),
    ('INCLUDES',        'Situation',       'Indicator'),
    ('INCLUDES',        'Situation',       'Event'),
    ('INCLUDES',        'Situation',       'SentimentWindow'),
    ('SIMULATED_AS',    'Situation',       'Brief'),
    ('FED',             'Brief',           'Simulation'),
    ('PRODUCED',        'Simulation',      'Branch'),
    ('BRANCHES_FROM',   'Branch',          'Branch'),
    ('ASSUMES',         'Branch',          'Assumption'),
    ('GROUNDED_IN',     'Branch',          'Regime'),
    ('GROUNDED_IN',     'Branch',          'MarketMove')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 검증. projection 이 끝나면 이걸 부르고, 비어있지 않으면 실패해야 한다.

CREATE OR REPLACE FUNCTION graph.violations()
RETURNS TABLE (rule text, detail text) AS $$
    -- 스펙에 없는 라벨 조합
    SELECT 'edge_spec',
           e.type || ' (' || s.label || ')->(' || d.label || ')  ' || e.src_uid || ' -> ' || e.dst_uid
    FROM graph.edge e
    JOIN graph.node s ON s.uid = e.src_uid
    JOIN graph.node d ON d.uid = e.dst_uid
    WHERE NOT EXISTS (
        SELECT 1 FROM graph.edge_spec x
        WHERE x.type = e.type AND x.src_label = s.label AND x.dst_label = d.label)

    UNION ALL
    -- uid 접두사가 라벨과 어긋난 노드
    SELECT 'uid_prefix', n.label || '  ' || n.uid
    FROM graph.node n
    WHERE split_part(n.uid, ':', 1) <> CASE n.label
        WHEN 'Market' THEN 'market'          WHEN 'Index' THEN 'index'
        WHEN 'Sector' THEN 'sector'          WHEN 'Security' THEN 'security'
        WHEN 'Indicator' THEN 'indicator'    WHEN 'Actor' THEN 'actor'
        WHEN 'MarketMove' THEN 'move'        WHEN 'Release' THEN 'release'
        WHEN 'Event' THEN 'event'            WHEN 'SentimentWindow' THEN 'senti'
        WHEN 'Regime' THEN 'regime'          WHEN 'Question' THEN 'question'
        WHEN 'Situation' THEN 'situation'    WHEN 'Brief' THEN 'brief'
        WHEN 'Simulation' THEN 'sim'         WHEN 'Branch' THEN 'branch'
        WHEN 'Assumption' THEN 'assumption'  END

    UNION ALL
    -- 근거 없는 관측 노드. 시나리오 계층은 사용자 실행 기록이라 면제된다.
    SELECT 'no_evidence', n.label || '  ' || n.uid
    FROM graph.node n
    WHERE cardinality(n.evidence) = 0
      AND n.label NOT IN ('Question', 'Situation', 'Brief', 'Simulation',
                          'Branch', 'Assumption')

    UNION ALL
    -- 분기 트리에 사이클이 있으면 순회가 끝나지 않는다
    SELECT 'branch_cycle', e.src_uid || ' -> ' || e.dst_uid
    FROM graph.edge e
    WHERE e.type = 'BRANCHES_FROM'
      AND EXISTS (SELECT 1 FROM graph.edge b
                  WHERE b.type = 'BRANCHES_FROM'
                    AND b.src_uid = e.dst_uid AND b.dst_uid = e.src_uid);
$$ LANGUAGE sql STABLE;

COMMIT;
