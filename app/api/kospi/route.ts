import { finverseQuery } from "@/lib/finverse-db";

export const dynamic = "force-dynamic";

type Candle = { date: string; open: number; high: number; low: number; close: number };

const label = (value: string) => `${Number(value.slice(4, 6))}/${Number(value.slice(6, 8))}`;
const recentDate = () => new Date(Date.now() - 120 * 24 * 60 * 60_000).toISOString().slice(0, 10).replaceAll("-", "");

export async function GET() {
  if (!process.env.FINVERSE_DATABASE_URL?.trim()) {
    return Response.json({ error: "FINVERSE_DATABASE_URL이 설정되지 않았습니다." }, { status: 503 });
  }
  try {
    const rows = await finverseQuery<Candle>(`
      select distinct on (payload->>'bas_dd')
        payload->>'bas_dd' as date,
        (payload->>'open')::double precision as open,
        (payload->>'high')::double precision as high,
        (payload->>'low')::double precision as low,
        (payload->>'close')::double precision as close
      from lake.records
      where payload ? 'bas_dd'
        and record_type = 'market_index_daily'
        and payload->>'idx_name' in ('KOSPI', '코스피')
        and payload->>'bas_dd' >= '${recentDate()}'
      order by payload->>'bas_dd', collected_at desc
    `);
    const candles = rows
      .filter((row) => row.date && [row.open, row.high, row.low, row.close].every(Number.isFinite))
      .slice(-45)
      .map((row) => ({ ...row, label: label(row.date) }));
    if (!candles.length) throw new Error("KOSPI records are empty");
    const latest = candles.at(-1)!;
    const previous = candles.at(-2);
    const change = previous ? latest.close - previous.close : 0;
    return Response.json({
      latestDate: latest.date,
      latestLabel: latest.label,
      value: latest.close,
      change,
      rate: previous ? (change / previous.close) * 100 : 0,
      candles,
      source: "PostgreSQL lake.records",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("KOSPI database query failed", error);
    return Response.json({ error: "KOSPI DB 조회에 실패했습니다." }, { status: 503 });
  }
}
