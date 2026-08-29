export const dynamic = "force-dynamic";

// 트윈이 쓰는 "지금" 값.
//
// 과거 충격 구간은 public/twin/shock-prices.json 에 굳어 있고 바뀌지 않는다.
// 바뀌는 건 최근 며칠뿐이라, 데이터 레이크에서는 그 꼬리만 받아 스냅샷에 이어붙인다.
//
// 범위를 넓게 잡으면 안 된다. lake.records 는 2천만 행이 넘고 bas_dd 범위가
// 넓어질수록 급격히 느려진다(3개월 9초, 5개월 25초, 2년 타임아웃). 스냅샷이
// 이미 대부분을 덮고 있으므로 두 달이면 충분하다.

const LOOKBACK_DAYS = 70;
const CACHE_MS = 5 * 60_000;

type Row = { d: string; c: number };
type Payload = { asOf: string; dates: string[]; closes: number[]; source: "database" };

let cache: { at: number; payload: Payload } | undefined;

// 값이 비어 있는 환경변수는 없는 것으로 본다. 빈 문자열이면 ?? 기본값이 걸리지 않아
// 브리지 주소가 "/query" 가 되어 버린다.
const env = (name: string) => process.env[name]?.trim() || undefined;
const compact = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");

const remotePsql = async (query: string): Promise<Row[]> => {
  const bridgeUrl = env("FINVERSE_KOSPI_BRIDGE_URL") ?? "http://127.0.0.1:5439";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(30, Number(env("FINVERSE_DB_SSH_TIMEOUT_SECONDS") ?? 90)) * 1000);
  try {
    const response = await fetch(`${bridgeUrl}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: query }),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.json() as unknown;
    if (!response.ok) throw new Error(typeof body === "object" && body && "error" in body ? String(body.error) : `브리지 응답 ${response.status}`);
    return Array.isArray(body) ? body as Row[] : [];
  } finally {
    clearTimeout(timer);
  }
};

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) return Response.json(cache.payload, { headers: { "Cache-Control": "no-store" } });
  // PEM 경로를 여기서 미리 확인하지 않는다. dev 서버 런타임에서는 그 변수가 보이지
  // 않아 멀쩡한 연결에도 503 을 내보낸 적이 있다. 브리지가 실제 실패를 알려준다.

  const now = new Date();
  const from = compact(new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60_000));
  const to = compact(new Date(now.getTime() + 24 * 60 * 60_000));
  try {
    // 같은 거래일이 여러 번 적재될 수 있어 가장 최근에 수집한 행만 남긴다.
    const rows = await remotePsql(`
      select distinct on (payload->>'bas_dd')
        payload->>'bas_dd' as d,
        (payload->>'close')::float8 as c
      from lake.records
      where payload ? 'bas_dd'
        and payload->>'bas_dd' between '${from}' and '${to}'
        and record_type = 'market_index_daily'
        and payload->>'idx_name' in ('KOSPI', '코스피')
      order by payload->>'bas_dd', collected_at desc
    `);
    const usable = rows.filter((row) => row.d && Number.isFinite(row.c) && row.c > 0);
    if (!usable.length) return Response.json({ error: "레이크에 최근 코스피 지수가 없습니다." }, { status: 503 });
    const payload: Payload = {
      asOf: usable.at(-1)!.d,
      dates: usable.map((row) => row.d),
      closes: usable.map((row) => row.c),
      source: "database",
    };
    cache = { at: Date.now(), payload };
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FINVERSE twin market query failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "데이터 레이크에서 최근 지수를 읽지 못했습니다." }, { status: 503 });
  }
}
