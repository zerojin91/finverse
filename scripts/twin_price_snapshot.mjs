// 마이 금융 트윈 타임머신 백테스트용 실제 가격 스냅샷 생성기.
//
// collectors/market_ingest.py 의 naver_finance 경로와 같은 siseJson 엔드포인트에서
// 수정주가 일별 종가를 받아 public/twin/shock-prices.json 으로 굳힌다.  과거 충격
// 구간의 가격은 더 이상 변하지 않으므로 데이터 레이크(SSH 브리지) 없이도 배포
// 환경에서 동일한 결과가 나오도록 정적 파일로 둔다.
//
//   node scripts/twin_price_snapshot.mjs
//   node scripts/twin_price_snapshot.mjs --window covid-2020

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const NAVER_API_ROOT = "https://api.finance.naver.com";
const NAVER_ROOT = "https://finance.naver.com";
const SISE_ROW = /\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)/g;

// 트윈이 담을 수 있는 종목.  상장 시점이 서로 달라야 "그 시절엔 없던 종목"을
// 지수로 대체하는 경로가 실제로 동작한다.
const assets = [
  { symbol: "005930", name: "삼성전자", kind: "stock", sector: "반도체" },
  { symbol: "000660", name: "SK하이닉스", kind: "stock", sector: "반도체" },
  { symbol: "005380", name: "현대차", kind: "stock", sector: "자동차" },
  { symbol: "005490", name: "POSCO홀딩스", kind: "stock", sector: "철강" },
  { symbol: "015760", name: "한국전력", kind: "stock", sector: "유틸리티" },
  { symbol: "035420", name: "NAVER", kind: "stock", sector: "인터넷" },
  { symbol: "035720", name: "카카오", kind: "stock", sector: "인터넷" },
  { symbol: "051910", name: "LG화학", kind: "stock", sector: "화학·2차전지" },
  { symbol: "207940", name: "삼성바이오로직스", kind: "stock", sector: "바이오" },
  { symbol: "105560", name: "KB금융", kind: "stock", sector: "금융" },
  { symbol: "069500", name: "KODEX 200", kind: "etf", sector: "국내 지수" },
  { symbol: "133690", name: "TIGER 미국나스닥100", kind: "etf", sector: "해외 지수" },
];

// 충격 구간.  start 는 충격 직전의 고점 부근, end 는 회복 여부까지 확인할 수 있는
// 지점으로 잡는다.  실제 고점·저점·회복일은 데이터에서 계산한다.
const windows = [
  {
    id: "imf-1997",
    label: "1997 IMF 외환위기",
    period: "1997.06 ~ 1999.06",
    start: "19970601",
    end: "19990630",
    summary: "환율 급등과 금융기관 연쇄 부실로 코스피가 반토막 난 구간입니다.",
  },
  {
    id: "dotcom-2000",
    label: "2000 닷컴 버블 붕괴",
    period: "2000.01 ~ 2001.12",
    start: "20000101",
    end: "20011231",
    summary: "기대가 먼저 오르고 실적이 따라오지 못한 기술주 조정 구간입니다.",
  },
  {
    id: "gfc-2008",
    label: "2008 글로벌 금융위기",
    period: "2008.05 ~ 2010.06",
    start: "20080501",
    end: "20100630",
    summary: "신용 경색이 실물로 번지며 전 자산군이 함께 하락한 구간입니다.",
  },
  {
    id: "covid-2020",
    label: "2020 코로나 급락",
    period: "2020.01 ~ 2021.06",
    start: "20200102",
    end: "20210630",
    summary: "한 달 만에 급락하고 유동성으로 빠르게 되돌린 구간입니다.",
  },
  {
    id: "tightening-2022",
    label: "2022 인플레이션·긴축",
    period: "2021.06 ~ 2023.12",
    start: "20210601",
    end: "20231229",
    summary: "금리 인상이 길게 이어지며 하락이 느리게 진행된 구간입니다.",
  },
  {
    id: "recent",
    label: "최근 구간",
    period: "최근 2년",
    start: compact(new Date(Date.now() - 730 * 24 * 60 * 60_000)),
    end: compact(new Date()),
    summary: "현재 평가금액과 최근 흐름을 계산하는 기준 구간입니다.",
  },
];

function compact(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchCloses(symbol, start, end) {
  const query = new URLSearchParams({ symbol, requestType: "1", startTime: start, endTime: end, timeframe: "day" });
  const response = await fetch(`${NAVER_API_ROOT}/siseJson.naver?${query}`, {
    headers: { Referer: `${NAVER_ROOT}/` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${symbol} ${start}-${end}: ${response.status}`);
  const body = await response.text();
  const closes = new Map();
  for (const row of body.matchAll(SISE_ROW)) closes.set(row[1], Number(row[5]));
  return closes;
}

const only = process.argv.includes("--window") ? process.argv[process.argv.indexOf("--window") + 1] : null;
const selected = only ? windows.filter((window) => window.id === only) : windows;
if (!selected.length) throw new Error(`알 수 없는 구간: ${only}`);

const snapshot = { generatedAt: new Date().toISOString(), source: "naver_finance siseJson (수정주가 일별 종가)", assets, windows: {} };

for (const window of selected) {
  // 코스피 지수의 거래일을 구간의 기준 달력으로 쓴다.  미상장 종목은 그 자리가
  // 비고, 백테스트에서 지수 경로로 대체된다.
  const index = await fetchCloses("KOSPI", window.start, window.end);
  const dates = [...index.keys()].sort();
  if (!dates.length) throw new Error(`${window.id}: 코스피 거래일을 받지 못했습니다.`);
  const closes = { KOSPI: dates.map((date) => index.get(date) ?? null) };
  let listed = 0;
  for (const asset of assets) {
    await sleep(300);
    const series = await fetchCloses(asset.symbol, window.start, window.end);
    const aligned = dates.map((date) => series.get(date) ?? null);
    closes[asset.symbol] = aligned;
    if (aligned.some((value) => value !== null)) listed += 1;
  }
  snapshot.windows[window.id] = { ...window, dates, closes };
  console.log(`${window.id.padEnd(18)} ${dates.length}거래일 · ${dates[0]}~${dates.at(-1)} · 상장 종목 ${listed}/${assets.length}`);
}

await mkdir(resolve(root, "public/twin"), { recursive: true });
const target = resolve(root, "public/twin/shock-prices.json");
await writeFile(target, JSON.stringify(snapshot), "utf8");
console.log(`\n${target} 저장 완료`);
