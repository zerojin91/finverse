import postgres from "postgres";

export const dynamic = "force-dynamic";

type Row = { key: string; name: string; date: string; close: number; change_pct: number; open: number | null; high: number | null; low: number | null };
const keys = ["KOSPI", "KOSDAQ", "SP500", "NASDAQ"];
const compact = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");

const sample = <T,>(points: T[], maximum = 80) => {
  if (points.length <= maximum) return points;
  const step = Math.ceil(points.length / (maximum - 1));
  const sampled = points.filter((_, index) => index % step === 0);
  if (sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1)!);
  return sampled;
};

export async function GET() {
  const host = process.env.FINVERSE_DB_HOST;
  const database = process.env.FINVERSE_DB_NAME;
  const username = process.env.FINVERSE_DB_USER;
  const password = process.env.FINVERSE_DB_PASSWORD;
  if (!host || !database || !username || !password) {
    return Response.json({ error: "FINVERSE DB 환경변수가 설정되지 않았습니다." }, { status: 503 });
  }

  const sql = postgres({ host, port: Number(process.env.FINVERSE_DB_PORT || 5432), database, username, password, max: 1, connect_timeout: 6, idle_timeout: 5, prepare: false, ssl: false });
  const end = new Date();
  const start = new Date(end.getTime() - 5 * 24 * 60 * 60_000);
  try {
    const rows = await sql<Row[]>`
      select payload->>'index_key' as key, payload->>'idx_name' as name,
        payload->>'trade_at' as date, (payload->>'close')::double precision as close,
        (payload->>'change_pct')::double precision as change_pct,
        nullif(payload->>'open', '')::double precision as open,
        nullif(payload->>'high', '')::double precision as high,
        nullif(payload->>'low', '')::double precision as low
      from lake.records
      where payload ? 'bas_dd'
        and payload->>'bas_dd' between ${compact(start)} and ${compact(end)}
        and record_type = 'market_index_intraday'
        and payload->>'index_key' in ${sql(keys)}
      order by key, date
    `;
    const indices = keys.flatMap((key) => {
      const available = rows.filter((row) => row.key === key);
      const latestDate = available.at(-1)?.date.slice(0, 10);
      const points = sample(available.filter((row) => row.date.startsWith(latestDate || "")));
      return points.length ? [{ key, name: points[0].name, source: "database" as const, points: points.map((row) => ({ date: row.date, close: Number(row.close), changePct: Number(row.change_pct), open: row.open === null ? undefined : Number(row.open), high: row.high === null ? undefined : Number(row.high), low: row.low === null ? undefined : Number(row.low) })) }] : [];
    });
    if (!indices.length) return Response.json({ error: "DB에 장중 지수 데이터가 없습니다. sync:indices를 먼저 실행하세요." }, { status: 503 });
    return Response.json({ generatedAt: new Date().toISOString(), indices }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FINVERSE market index query failed", error);
    return Response.json({ error: "FINVERSE DB 지수 조회에 실패했습니다." }, { status: 503 });
  } finally {
    await sql.end({ timeout: 1 });
  }
}
