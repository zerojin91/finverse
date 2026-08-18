import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

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

const keyPath = process.env.FINVERSE_SSH_KEY;
const sshHost = process.env.FINVERSE_SSH_HOST;
const database = process.env.FINVERSE_DB_NAME || "finverse";
const container = process.env.FINVERSE_DB_CONTAINER || "finverse-db";
if (!keyPath || !sshHost) throw new Error("FINVERSE_SSH_KEY and FINVERSE_SSH_HOST are required");

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

const remotePsql = (query) => new Promise((resolve, reject) => {
  const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15", "-i", keyPath, sshHost, "docker", "exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "finverse", "-d", database, "-f", "-"], { windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `ssh exited with code ${code}`)));
  child.stdin.end(query, "utf8");
});

if (rows.length) {
  const encoded = JSON.stringify(rows).replaceAll("'", "''");
  await remotePsql(`
    insert into lake.records (record_id, collector, record_type, source, schema_version, record_hash, collected_at, payload)
    select record_id, collector, record_type, source, schema_version, record_hash, collected_at::timestamptz, payload::jsonb
    from jsonb_to_recordset('${encoded}'::jsonb) as x(record_id text, collector text, record_type text, source text, schema_version text, record_hash text, collected_at text, payload text)
    on conflict (record_id) do update set record_hash = excluded.record_hash, collected_at = excluded.collected_at, payload = excluded.payload, loaded_at = now()
    where lake.records.record_hash is distinct from excluded.record_hash;
  `);
}
console.log(JSON.stringify({ synced: rows.length, indices: markets.map((market) => market.key), generatedAt: collectedAt }));
