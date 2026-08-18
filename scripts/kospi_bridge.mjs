import { spawn } from "node:child_process";
import { createServer } from "node:http";

const port = Number(process.env.FINVERSE_KOSPI_BRIDGE_PORT || 5439);
const keyPath = process.env.FINVERSE_SSH_KEY || "D:\\finverse_key.pem";
const host = process.env.FINVERSE_SSH_HOST || "ubuntu@44.206.56.75";

const sql = `SELECT DISTINCT ON (payload->>'bas_dd')
  payload->>'bas_dd', payload->>'open', payload->>'high', payload->>'low', payload->>'close'
  FROM lake.records
  WHERE payload ? 'bas_dd'
    AND payload->>'bas_dd' BETWEEN '20260701' AND '20261231'
    AND record_type = 'market_index_daily'
    AND payload->>'idx_name' IN ('KOSPI', '코스피')
  ORDER BY payload->>'bas_dd', collected_at DESC`;
let cache = null;
let cacheTime = 0;
let inFlight = null;

function queryRemote() {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=8",
      "-i", keyPath,
      host,
      "docker exec -i finverse-db psql -U finverse -d finverse -At -F '|'",
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), 45_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `ssh exited with code ${code}`));
    });
    child.stdin.end(sql);
  });
}

const formatDate = (raw) => `${Number(raw.slice(4, 6))}/${Number(raw.slice(6, 8))}`;

async function loadKospi() {
  if (cache && Date.now() - cacheTime < 30_000) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const stdout = await queryRemote();
    const rows = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [date, open, high, low, close] = line.split("|");
      return { date, label: formatDate(date), open: Number(open), high: Number(high), low: Number(low), close: Number(close) };
    }).filter((row) => row.date && [row.open, row.high, row.low, row.close].every(Number.isFinite));
    if (!rows.length) throw new Error("KOSPI records are empty");
    const candles = rows.slice(-45);
    const latest = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const change = previous ? latest.close - previous.close : 0;
    const rate = previous ? (change / previous.close) * 100 : 0;
    cache = { latestDate: latest.date, latestLabel: latest.label, value: latest.close, change, rate, candles };
    cacheTime = Date.now();
    return cache;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

const server = createServer(async (request, response) => {
  if (request.url !== "/kospi") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  try {
    const result = await loadKospi();
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(result));
  } catch (error) {
    console.error("KOSPI bridge failed:", error instanceof Error ? error.message : error);
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Unable to read KOSPI data" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`FINVERSE KOSPI bridge listening on http://127.0.0.1:${port}`);
});
