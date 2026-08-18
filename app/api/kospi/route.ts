import postgres from "postgres";

export const dynamic = "force-dynamic";

type Row = { date: string; open: number; high: number; low: number; close: number; change_pct: number | null };
const compact = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");

export async function GET() {
  const host = process.env.FINVERSE_DB_HOST;
  const database = process.env.FINVERSE_DB_NAME;
  const username = process.env.FINVERSE_DB_USER;
  const password = process.env.FINVERSE_DB_PASSWORD;
  if (!host || !database || !username || !password) return Response.json({ error: "FINVERSE DB 환경변수가 설정되지 않았습니다." }, { status: 503 });

  const sql = postgres({ host, port: Number(process.env.FINVERSE_DB_PORT || 5432), database, username, password, max: 1, connect_timeout: 6, idle_timeout: 5, prepare: false, ssl: false });
  const end = new Date();
  const start = new Date(end.getTime() - 40 * 24 * 60 * 60_000);
  try {
    const rows = await sql<Row[]>`
      select
        payload->>'bas_dd' as date,
        (payload->>'open')::double precision as open,
        (payload->>'high')::double precision as high,
        (payload->>'low')::double precision as low,
        (payload->>'close')::double precision as close,
        nullif(payload->>'change_pct', '')::double precision as change_pct
      from lake.records
      where payload ? 'bas_dd'
        and payload->>'bas_dd' between ${compact(start)} and ${compact(end)}
        and record_type = 'market_index_daily'
        and payload->>'idx_name' = 'KOSPI'
      order by payload->>'bas_dd'
    `;
    if (!rows.length) return Response.json({ error: "DB에 KOSPI 일봉이 없습니다." }, { status: 503 });
    const latest = rows.at(-1)!;
    const previous = rows.at(-2)?.close ?? latest.open;
    const rate = latest.change_pct ?? (previous ? (latest.close / previous - 1) * 100 : 0);
    return Response.json({
      latestDate: `${latest.date.slice(0, 4)}-${latest.date.slice(4, 6)}-${latest.date.slice(6)}`,
      latestLabel: `${Number(latest.date.slice(4, 6))}/${Number(latest.date.slice(6))}`,
      value: Number(latest.close), change: Number(latest.close) - Number(previous), rate: Number(rate),
      candles: rows.map((row) => ({ date: row.date, label: `${Number(row.date.slice(4, 6))}/${Number(row.date.slice(6))}`, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) })),
      source: "FINVERSE PostgreSQL",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FINVERSE KOSPI query failed", error);
    return Response.json({ error: "FINVERSE DB KOSPI 조회에 실패했습니다." }, { status: 503 });
  } finally {
    await sql.end({ timeout: 1 });
  }
}
