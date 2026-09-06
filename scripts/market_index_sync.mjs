import { createHash } from "node:crypto";
import postgres from "postgres";

for (const path of [".env", ".env.local"]) {
  try { process.loadEnvFile(path); } catch { /* optional */ }
}

const group = process.argv.includes("--group") ? process.argv[process.argv.indexOf("--group") + 1] : "all";
const markets = [
  { key: "KOSPI", name: "코스피", group: "domestic", url: "https://stock.naver.com/api/securityService/chart/domestic/index/KOSPI?periodType=day" },
  { key: "KOSDAQ", name: "코스닥", group: "domestic", url: "https://stock.naver.com/api/securityService/chart/domestic/index/KOSDAQ?periodType=day" },
  { key: "SP500", name: "S&P 500", group: "foreign", code: ".INX", exchange: "NYSE" },
  { key: "NASDAQ", name: "나스닥", group: "foreign", code: ".IXIC", exchange: "NASDAQ" },
].filter((market) => group === "all" || market.group === group);

const number = (value) => Number(String(value ?? "").replaceAll(",", ""));
const compactUtc = (date) => date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
const domesticIso = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:00+09:00`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", Referer: "https://stock.naver.com/" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function fetchMarket(market) {
  let previousClose, points;
  if (market.group === "domestic") {
    const payload = await fetchJson(market.url);
    previousClose = number(payload.lastClosePrice);
    points = (payload.priceInfos ?? []).map((point) => ({ tradeAt: domesticIso(point.localDateTime), close: number(point.currentPrice), open: number(point.openPrice), high: number(point.highPrice), low: number(point.lowPrice) }));
  } else {
    const end = new Date(Date.now() + 24 * 60 * 60_000);
    const start = new Date(Date.now() - 4 * 24 * 60 * 60_000);
    const url = `https://stock.naver.com/api/securityService/chart/foreign/INDEX/${market.exchange}/${market.code}/interval/5?startDateTime=${compactUtc(start)}&endDateTime=${compactUtc(end)}&utc=true`;
    const payload = await fetchJson(url);
    previousClose = number(payload.lastClosePrice);
    const candles = payload.candleList ?? [];
    const latestSession = candles.reduce((latest, point) => point.tradeAt.slice(0, 10) > latest ? point.tradeAt.slice(0, 10) : latest, "");
    points = candles.filter((point) => point.tradeAt.startsWith(latestSession)).map((point) => ({ tradeAt: point.tradeAt, close: number(point.closePrice), open: number(point.openPrice), high: number(point.highPrice), low: number(point.lowPrice) }));
  }
  return points.map((point) => ({ ...point, market, previousClose }));
}

const databaseUrl = process.env.FINVERSE_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("FINVERSE_DATABASE_URL is required");
const db = postgres(databaseUrl, { connect_timeout: 8, idle_timeout: 20, max: 1, prepare: false });

const collectedAt = new Date().toISOString();
const fetched = (await Promise.all(markets.map(fetchMarket))).flat();
const rows = fetched.map(({ market, previousClose, ...point }) => {
  const payload = {
    record_type: "market_index_intraday", source: "naver_finance", schema_version: "1.0",
    bas_dd: point.tradeAt.slice(0, 10).replaceAll("-", ""), trade_at: point.tradeAt,
    index_key: market.key, idx_name: market.name, open: point.open || null, high: point.high || null,
    low: point.low || null, close: point.close,
    change_pct: previousClose ? (point.close / previousClose - 1) * 100 : 0,
  };
  const recordId = hash(`market_index_intraday|${market.key}|${point.tradeAt}`);
  const recordHash = hash(JSON.stringify(payload));
  return { record_id: recordId, collector: "market_index_sync", record_type: payload.record_type, source: payload.source, schema_version: payload.schema_version, record_hash: recordHash, collected_at: collectedAt, payload: JSON.stringify({ ...payload, record_id: recordId, record_hash: recordHash, collected_at: collectedAt }) };
});

try {
  if (rows.length) await db`
    insert into lake.records (record_id, collector, record_type, source, schema_version, record_hash, collected_at, payload)
    select record_id, collector, record_type, source, schema_version, record_hash, collected_at::timestamptz, payload::jsonb
    from jsonb_to_recordset(${db.json(rows)}::jsonb) as x(record_id text, collector text, record_type text, source text, schema_version text, record_hash text, collected_at text, payload text)
    on conflict (record_id) do update set record_hash = excluded.record_hash, collected_at = excluded.collected_at, payload = excluded.payload, loaded_at = now()
    where lake.records.record_hash is distinct from excluded.record_hash;
  `;
  console.log(JSON.stringify({ synced: rows.length, indices: markets.map((market) => market.key), generatedAt: collectedAt }));
} finally {
  await db.end();
}
