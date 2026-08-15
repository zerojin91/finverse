import postgres from "postgres";

export const dynamic = "force-dynamic";

type RawIndex = { trade_date: string; index_key: string; index_name: string; close: number; change_pct: number };
type RawCommunity = { label: string; comment_count: number };
type RawStock = { trade_date: string; ticker: string; name: string; close: number; change_pct: number; volume: number };

let dashboardCache: { expiresAt: number; payload: unknown } | undefined;

const env = (name: string) => process.env[name]?.trim();

const compactDate = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

const isoDate = (value: string) => value.length === 8 ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;

export async function GET() {
  if (dashboardCache && dashboardCache.expiresAt > Date.now()) {
    return Response.json(dashboardCache.payload, {
      headers: { "Cache-Control": "no-store, max-age=0", "X-Finverse-Cache": "HIT" },
    });
  }

  const host = env("FINVERSE_DB_HOST");
  const database = env("FINVERSE_DB_NAME");
  const username = env("FINVERSE_DB_USER");
  const password = env("FINVERSE_DB_PASSWORD");

  if (!host || !database || !username || !password) {
    return Response.json({ error: "로컬 DB 환경변수가 설정되지 않았습니다." }, { status: 503 });
  }

  const sql = postgres({
    host,
    port: Number(env("FINVERSE_DB_PORT") ?? 5432),
    database,
    username,
    password,
    // Two connections keep the read replica responsive while reducing the
    // initial local refresh time.
    max: 2,
    connect_timeout: 6,
    idle_timeout: 8,
    prepare: false,
    ssl: false,
  });

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 25);

  try {
    await sql`set statement_timeout to '25s'`;

    const [indexRows, macroRows, newsRows, communityRows, stockRows] = await Promise.all([
      sql<RawIndex[]>`
        select
          payload->>'bas_dd' as trade_date,
          case
            when payload->>'idx_name' = '코스피' then 'KOSPI'
            when payload->>'idx_name' = '코스닥' then 'KOSDAQ'
            else 'NASDAQ'
          end as index_key,
          payload->>'idx_name' as index_name,
          (payload->>'close')::double precision as close,
          (payload->>'change_pct')::double precision as change_pct
        from lake.records
        where payload ? 'bas_dd'
          and payload->>'bas_dd' between ${compactDate(start)} and ${compactDate(end)}
          and record_type = 'market_index_daily'
          and payload->>'idx_name' in ('코스피', '코스닥', 'NASDAQ', '나스닥')
          and nullif(payload->>'change_pct', '') is not null
        order by trade_date, index_key
      `,
      sql`
        select distinct on (series_name)
          series_name as name,
          value::double precision as value,
          unit,
          period_start::text as observed_at
        from economy.observation
        where series_name in ('한국은행 기준금리', '원달러환율', '국고채3년', '국고채10년')
        order by series_name, period_start desc
      `,
      sql`
        select title, published_at::text as published_at, country_codes, event_types, selection_score, url
        from events.news
        where title is not null
        order by collected_at desc
        limit 24
      `,
      sql<RawCommunity[]>`
        select coalesce(payload->>'keyword', payload->>'topic', payload->>'title') as label,
          count(*)::integer as comment_count
        from lake.records
        where record_type in ('community_signal', 'community_sentiment', 'community_post')
          and coalesce(payload->>'keyword', payload->>'topic', payload->>'title') is not null
        group by label
        order by comment_count desc
        limit 20
      `,
      sql<RawStock[]>`
        select
          payload->>'bas_dd' as trade_date,
          payload->>'ticker' as ticker,
          payload->>'name' as name,
          (payload->>'close')::double precision as close,
          (payload->>'change_pct')::double precision as change_pct,
          (payload->>'volume')::double precision as volume
        from lake.records
        where payload ? 'bas_dd'
          and payload->>'bas_dd' between ${compactDate(start)} and ${compactDate(end)}
          and record_type = 'market_price_daily'
          and payload->>'ticker' in ('005930', '000660')
          and nullif(payload->>'change_pct', '') is not null
        order by ticker, trade_date
      `,
    ]);

    if (!indexRows.length) throw new Error("시장 지수 데이터가 없습니다.");

    const latestDate = indexRows.reduce((latest, row) => row.trade_date > latest ? row.trade_date : latest, "");
    const latestFlows = await sql`
        select
          payload->>'target' as market,
          payload->>'investor' as investor,
          (payload->>'net_value_krw')::double precision as net_value
        from lake.records
        where payload ? 'bas_dd'
          and payload->>'bas_dd' = ${latestDate}
          and record_type = 'market_investor_flow_daily'
          and payload->>'target_type' = 'MARKET'
          and payload->>'target' in ('KOSPI', 'KOSDAQ')
          and nullif(payload->>'net_value_krw', '') is not null
        order by market, investor
      `;

    const indices = (["KOSPI", "KOSDAQ", "NASDAQ"] as const).map((key) => ({
      key,
      name: key === "KOSPI" ? "코스피" : key === "KOSDAQ" ? "코스닥" : "나스닥",
      source: "database" as const,
      points: indexRows
        .filter((row) => row.index_key === key)
        .map((row) => ({ date: isoDate(row.trade_date), close: Number(row.close), changePct: Number(row.change_pct) })),
    })).filter((item) => item.points.length);

    const news = [...newsRows]
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
      .slice(0, 8)
      .map((row) => ({
        title: String(row.title),
        publishedAt: String(row.published_at),
        eventTypes: Array.isArray(row.event_types) ? row.event_types.map(String) : [],
        score: Number(row.selection_score ?? 0),
        url: row.url ? String(row.url) : null,
      }));

    const countryCounts = new Map<string, number>();
    const eventCounts = new Map<string, number>();
    for (const row of newsRows) {
      for (const code of Array.isArray(row.country_codes) ? row.country_codes : []) {
        countryCounts.set(String(code), (countryCounts.get(String(code)) ?? 0) + 1);
      }
      for (const type of Array.isArray(row.event_types) ? row.event_types : []) {
        eventCounts.set(String(type), (eventCounts.get(String(type)) ?? 0) + 1);
      }
    }
    const countryNames: Record<string, string> = {
      KR: "한국 통화 정책", US: "미국 금리 정책", KP: "북한 지정학", CN: "중국 경기", JP: "일본 통화 정책",
    };
    const eventNames: Record<string, string> = {
      INTEREST_RATES: "금리 인상 경계", REAL_ECONOMY: "물가·성장", GEOPOLITICAL: "지정학 리스크",
      FOREIGN_EXCHANGE: "환율 변동성", FX: "환율 변동성", EARNINGS: "기업 실적",
    };
    const rankedCountries = [...countryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => countryNames[code] ?? `${code} 정책`);
    const rankedEvents = [...eventCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => eventNames[type] ?? type);
    const communityTopics = communityRows
      .map((row) => ({
        label: row.label.replace(/\s+/g, " ").trim(),
        count: Number(row.comment_count),
      }))
      .filter((topic) => topic.label && topic.count > 0)
      .slice(0, 2);
    const firstCommunityShare = communityTopics.length === 2
      ? Math.min(15, Math.max(1, Math.round(16 * communityTopics[0].count /
          (communityTopics[0].count + communityTopics[1].count))))
      : 9;
    const communityKeywords = communityTopics.length === 2
      ? communityTopics.map((topic, index) => ({
          label: topic.label.length > 36 ? `${topic.label.slice(0, 35)}…` : topic.label,
          share: index === 0 ? firstCommunityShare : 16 - firstCommunityShare,
        }))
      : [{ label: "반도체 저가매수", share: 9 }, { label: "환율 불안", share: 7 }];
    const baseRate = macroRows.find((row) => String(row.name).includes("기준금리"));
    const dollar = macroRows.find((row) => String(row.name).includes("원달러"));
    const signals = [
      {
        key: "economy", label: "경제", share: 34, source: baseRate && dollar ? "database" : "dummy",
        keywords: baseRate && dollar
          ? [{ label: `기준금리 ${Number(baseRate.value).toFixed(2)}%`, share: 18 }, { label: `원·달러 ${Number(dollar.value).toLocaleString("ko-KR")}`, share: 16 }]
          : [{ label: "기준금리 경계", share: 18 }, { label: "원화 약세", share: 16 }],
      },
      {
        key: "country", label: "국가", share: 26, source: rankedCountries.length >= 2 ? "database" : "dummy",
        keywords: (rankedCountries.length >= 2 ? rankedCountries : ["미국 금리 정책", "한국 통화 정책"])
          .slice(0, 2).map((label, index) => ({ label, share: index ? 12 : 14 })),
      },
      {
        key: "event", label: "이벤트", share: 24, source: rankedEvents.length >= 2 ? "database" : "dummy",
        keywords: (rankedEvents.length >= 2 ? rankedEvents : ["금리 인상 경계", "지정학 리스크"])
          .slice(0, 2).map((label, index) => ({ label, share: index ? 11 : 13 })),
      },
      {
        key: "community", label: "커뮤니티", share: 16, source: communityTopics.length >= 2 ? "database" : "dummy",
        keywords: communityKeywords,
      },
    ];

    const payload = {
      asOf: isoDate(latestDate),
      generatedAt: new Date().toISOString(),
      indices,
      stocks: (["005930", "000660"] as const).flatMap((ticker) => {
        const rows = stockRows.filter((row) => row.ticker === ticker);
        const latest = rows.at(-1);
        return latest ? [{
          ticker,
          name: String(latest.name || (ticker === "005930" ? "삼성전자" : "SK하이닉스")),
          close: Number(latest.close),
          changePct: Number(latest.change_pct),
          volume: Number(latest.volume),
          source: "database" as const,
          points: rows.map((row) => ({
            date: isoDate(row.trade_date), close: Number(row.close), changePct: Number(row.change_pct),
          })),
        }] : [];
      }),
      macros: macroRows.map((row) => ({
        name: String(row.name), value: Number(row.value), unit: String(row.unit), observedAt: String(row.observed_at).slice(0, 10),
      })),
      flows: latestFlows.map((row) => ({ market: String(row.market), investor: String(row.investor), netValue: Number(row.net_value) })),
      news,
      signals,
    };
    dashboardCache = { expiresAt: Date.now() + 5 * 60_000, payload };
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0", "X-Finverse-Cache": "MISS" },
    });
  } catch (error) {
    console.error("FINVERSE dashboard query failed", error);
    return Response.json({ error: "DB 조회에 실패했습니다." }, { status: 503 });
  } finally {
    await sql.end({ timeout: 1 });
  }
}
