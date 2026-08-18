export const dynamic = "force-dynamic";

type MarketKey = "KOSPI" | "KOSDAQ" | "SP500" | "NASDAQ";
type PricePoint = { date: string; close: number; changePct: number; open?: number; high?: number; low?: number };

const markets = [
  { key: "KOSPI", name: "코스피", kind: "domestic", code: "KOSPI" },
  { key: "KOSDAQ", name: "코스닥", kind: "domestic", code: "KOSDAQ" },
  { key: "SP500", name: "S&P 500", kind: "foreign", code: ".INX", exchange: "NYSE" },
  { key: "NASDAQ", name: "나스닥", kind: "foreign", code: ".IXIC", exchange: "NASDAQ" },
] as const;

let marketCache: { expiresAt: number; payload: unknown } | undefined;

const number = (value: unknown) => Number(String(value ?? "").replaceAll(",", ""));
const changePct = (price: number, previousClose: number) => previousClose ? (price / previousClose - 1) * 100 : 0;
const compactUtc = (date: Date) => date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
const domesticIso = (value: string) =>
  `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:00+09:00`;

const sample = (points: PricePoint[], maximum = 80) => {
  if (points.length <= maximum) return points;
  const step = Math.ceil(points.length / (maximum - 1));
  const sampled = points.filter((_, index) => index % step === 0);
  const latest = points.at(-1)!;
  if (sampled.at(-1)?.date !== latest.date) sampled.push(latest);
  return sampled;
};

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", Referer: "https://stock.naver.com/" },
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`market data response ${response.status}`);
  return response.json();
}

async function fetchMarket(market: typeof markets[number]) {
  if (market.kind === "domestic") {
    const payload = await fetchJson(
      `https://stock.naver.com/api/securityService/chart/domestic/index/${market.code}?periodType=day`,
    ) as { lastClosePrice?: number; priceInfos?: Array<{ localDateTime: string; currentPrice: number; openPrice?: number; highPrice?: number; lowPrice?: number }> };
    const previousClose = number(payload.lastClosePrice);
    const points = sample((payload.priceInfos ?? []).map((point) => {
      const close = number(point.currentPrice);
      return {
        date: domesticIso(point.localDateTime), close, changePct: changePct(close, previousClose),
        open: number(point.openPrice), high: number(point.highPrice), low: number(point.lowPrice),
      };
    }));
    if (!points.length) throw new Error(`${market.key} intraday data is empty`);
    return { key: market.key as MarketKey, name: market.name, source: "naver" as const, points };
  }

  const end = new Date(Date.now() + 24 * 60 * 60_000);
  const start = new Date(Date.now() - 4 * 24 * 60 * 60_000);
  const payload = await fetchJson(
    `https://stock.naver.com/api/securityService/chart/foreign/INDEX/${market.exchange}/${market.code}/interval/5` +
      `?startDateTime=${compactUtc(start)}&endDateTime=${compactUtc(end)}&utc=true`,
  ) as { lastClosePrice?: number; candleList?: Array<{ tradeAt: string; closePrice: number }> };
  const candles = payload.candleList ?? [];
  const latestSession = candles.reduce((latest, point) => point.tradeAt.slice(0, 10) > latest ? point.tradeAt.slice(0, 10) : latest, "");
  const previousClose = number(payload.lastClosePrice);
  const points = sample(candles
    .filter((point) => point.tradeAt.startsWith(latestSession))
    .map((point) => {
      const close = number(point.closePrice);
      return { date: point.tradeAt, close, changePct: changePct(close, previousClose) };
    }));
  if (!points.length) throw new Error(`${market.key} intraday data is empty`);
  return { key: market.key as MarketKey, name: market.name, source: "naver" as const, points };
}

export async function GET() {
  if (marketCache && marketCache.expiresAt > Date.now()) {
    return Response.json(marketCache.payload, { headers: { "Cache-Control": "public, max-age=30", "X-Market-Cache": "HIT" } });
  }

  const results = await Promise.allSettled(markets.map(fetchMarket));
  const indices = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!indices.length) return Response.json({ error: "당일 지수 데이터를 불러오지 못했습니다." }, { status: 502 });

  const payload = { generatedAt: new Date().toISOString(), indices };
  marketCache = { expiresAt: Date.now() + 60_000, payload };
  return Response.json(payload, { headers: { "Cache-Control": "public, max-age=30", "X-Market-Cache": "MISS" } });
}
