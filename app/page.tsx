"use client";

import {
  Activity,
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Database,
  FileUp,
  Globe2,
  Network,
  Newspaper,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UsersRound,
  Wifi,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type IndexPoint = {
  date: string;
  close: number;
  changePct: number;
};

type MarketIndex = {
  key: "KOSPI" | "KOSDAQ" | "NASDAQ";
  name: string;
  points: IndexPoint[];
  source: "database" | "dummy";
};

type MarketSeries = {
  key: string;
  name: string;
  points: IndexPoint[];
  source: "database" | "dummy";
};

type SignalGroup = {
  key: "economy" | "country" | "event" | "community";
  label: string;
  share: number;
  source: "database" | "dummy";
  keywords: Array<{ label: string; share: number }>;
};

type Stock = {
  ticker: string;
  name: string;
  close: number;
  changePct: number;
  volume: number;
  points: IndexPoint[];
  source: "database" | "dummy";
};

type Macro = {
  name: string;
  value: number;
  unit: string;
  observedAt: string;
};

type Flow = {
  market: string;
  investor: string;
  netValue: number;
};

type NewsItem = {
  title: string;
  publishedAt: string;
  eventTypes: string[];
  score: number;
  url: string | null;
};

type DashboardData = {
  asOf: string;
  generatedAt: string;
  indices: MarketIndex[];
  stocks: Stock[];
  macros: Macro[];
  flows: Flow[];
  news: NewsItem[];
  signals: SignalGroup[];
};

type Scenario = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  impact: number;
  tone: "positive" | "negative";
  icon: typeof TrendingUp;
  forecast: number[];
  assumptions: string[];
};

type EnvironmentSeed = {
  id: string;
  label: string;
  category: string;
  detail: string;
  direction: 1 | -1;
};

const fallback: DashboardData = {
  asOf: "2026-08-07",
  generatedAt: "2026-08-12T00:00:00.000Z",
  indices: [
    {
      key: "KOSPI",
      name: "코스피",
      source: "dummy",
      points: [
        ["2026-07-20", 6516.27, -4.46],
        ["2026-07-21", 6747.95, 3.56],
        ["2026-07-22", 6797.7, 0.74],
        ["2026-07-23", 7096.89, 4.4],
        ["2026-07-24", 6690.62, -5.72],
        ["2026-07-27", 6755.75, 0.97],
        ["2026-07-28", 6023.66, -10.84],
        ["2026-07-29", 5663.24, -5.98],
        ["2026-07-30", 5593.56, -1.23],
        ["2026-07-31", 6595.45, 17.91],
        ["2026-08-03", 6257.45, -5.12],
        ["2026-08-04", 6358.95, 1.62],
        ["2026-08-05", 6598.26, 3.76],
        ["2026-08-06", 6296.38, -4.58],
        ["2026-08-07", 6258.77, -0.6],
      ].map(([date, close, changePct]) => ({
        date: String(date),
        close: Number(close),
        changePct: Number(changePct),
      })),
    },
    {
      key: "KOSDAQ",
      name: "코스닥",
      source: "dummy",
      points: [
        ["2026-07-20", 749.64, -5.33],
        ["2026-07-21", 753.34, 0.49],
        ["2026-07-22", 751.09, -0.3],
        ["2026-07-23", 790.28, 5.22],
        ["2026-07-24", 748.22, -5.32],
        ["2026-07-27", 764.86, 2.22],
        ["2026-07-28", 705.85, -7.72],
        ["2026-07-29", 662.68, -6.12],
        ["2026-07-30", 644.78, -2.7],
        ["2026-07-31", 719.76, 11.63],
        ["2026-08-03", 737.35, 2.44],
        ["2026-08-04", 780.72, 5.88],
        ["2026-08-05", 799.59, 2.42],
        ["2026-08-06", 801.67, 0.26],
        ["2026-08-07", 798.81, -0.36],
      ].map(([date, close, changePct]) => ({
        date: String(date),
        close: Number(close),
        changePct: Number(changePct),
      })),
    },
    {
      key: "NASDAQ",
      name: "나스닥",
      source: "dummy",
      points: [
        ["2026-07-20", 22418.12, -0.42],
        ["2026-07-21", 22502.3, 0.38],
        ["2026-07-22", 22380.44, -0.54],
        ["2026-07-23", 22612.88, 1.04],
        ["2026-07-24", 22490.15, -0.54],
        ["2026-07-27", 22560.33, 0.31],
        ["2026-07-28", 22240.19, -1.42],
        ["2026-07-29", 22110.51, -0.58],
        ["2026-07-30", 22305.73, 0.88],
        ["2026-07-31", 22698.42, 1.76],
        ["2026-08-03", 22740.13, 0.18],
        ["2026-08-04", 22680.9, -0.26],
        ["2026-08-05", 22810.66, 0.57],
        ["2026-08-06", 22762.44, -0.21],
        ["2026-08-07", 22914.05, 0.67],
      ].map(([date, close, changePct]) => ({
        date: String(date),
        close: Number(close),
        changePct: Number(changePct),
      })),
    },
  ],
  stocks: [
    {
      ticker: "005930", name: "삼성전자", close: 231000, changePct: 0.22, volume: 20546010, source: "dummy",
      points: [
        ["2026-07-27", 218000, -1.1], ["2026-07-28", 222500, 2.06], ["2026-07-29", 227000, 2.02],
        ["2026-07-30", 224500, -1.1], ["2026-07-31", 226000, 0.67], ["2026-08-03", 230500, 1.99],
        ["2026-08-04", 229000, -0.65], ["2026-08-05", 232500, 1.53], ["2026-08-06", 230500, -0.86],
        ["2026-08-07", 231000, 0.22],
      ].map(([date, close, changePct]) => ({ date: String(date), close: Number(close), changePct: Number(changePct) })),
    },
    {
      ticker: "000660", name: "SK하이닉스", close: 1422000, changePct: -4.88, volume: 5002539, source: "dummy",
      points: [
        ["2026-07-27", 1315000, -1.13], ["2026-07-28", 1340000, 1.9], ["2026-07-29", 1385000, 3.36],
        ["2026-07-30", 1360000, -1.81], ["2026-07-31", 1398000, 2.79], ["2026-08-03", 1430000, 2.29],
        ["2026-08-04", 1410000, -1.4], ["2026-08-05", 1448000, 2.7], ["2026-08-06", 1495000, 3.25],
        ["2026-08-07", 1422000, -4.88],
      ].map(([date, close, changePct]) => ({ date: String(date), close: Number(close), changePct: Number(changePct) })),
    },
  ],
  macros: [
    { name: "한국은행 기준금리", value: 2.75, unit: "%", observedAt: "2026-08-10" },
    { name: "원달러환율", value: 1415.3, unit: "KRW", observedAt: "2026-08-11" },
    { name: "국고채3년", value: 3.808, unit: "%", observedAt: "2026-08-11" },
    { name: "국고채10년", value: 4.301, unit: "%", observedAt: "2026-08-11" },
  ],
  flows: [
    { market: "KOSPI", investor: "외국인", netValue: -865100000000 },
    { market: "KOSPI", investor: "개인", netValue: 267500000000 },
    { market: "KOSPI", investor: "기관 합계", netValue: 585400000000 },
  ],
  news: [
    {
      title: "BOK: Inflationary pressures persist; additional rate hikes remain possible",
      publishedAt: "2026-08-11T06:51:00.000Z",
      eventTypes: ["INTEREST_RATES", "REAL_ECONOMY"],
      score: 4,
      url: null,
    },
    {
      title: "Zelensky says Russia war is strengthening North Korea military",
      publishedAt: "2026-08-11T08:04:52.000Z",
      eventTypes: ["GEOPOLITICAL"],
      score: 4,
      url: null,
    },
    {
      title: "Fire at chemical warehouse in Pyeongtaek fully extinguished",
      publishedAt: "2026-08-11T13:31:07.000Z",
      eventTypes: ["GEOPOLITICAL"],
      score: 4,
      url: null,
    },
  ],
  signals: [
    { key: "economy", label: "경제", share: 34, source: "dummy", keywords: [{ label: "기준금리 경계", share: 18 }, { label: "원화 약세", share: 16 }] },
    { key: "country", label: "국가", share: 26, source: "dummy", keywords: [{ label: "미국 금리 정책", share: 14 }, { label: "한국 통화 정책", share: 12 }] },
    { key: "event", label: "이벤트", share: 24, source: "dummy", keywords: [{ label: "금리 인상 경계", share: 13 }, { label: "지정학 리스크", share: 11 }] },
    { key: "community", label: "커뮤니티", share: 16, source: "dummy", keywords: [{ label: "반도체 저가매수", share: 9 }, { label: "환율 불안", share: 7 }] },
  ],
};

const mergeDashboard = (payload: Partial<DashboardData>): DashboardData => {
  const liveIndices = payload.indices ?? [];
  const liveSignals = payload.signals ?? [];
  return {
    ...fallback,
    ...payload,
    indices: fallback.indices.map((item) => liveIndices.find((live) => live.key === item.key) ?? item),
    stocks: fallback.stocks.map((item) => {
      const live = payload.stocks?.find((stock) => stock.ticker === item.ticker);
      return live ? { ...item, ...live, points: live.points?.length ? live.points : item.points } : item;
    }),
    macros: payload.macros?.length ? payload.macros : fallback.macros,
    flows: payload.flows?.length ? payload.flows : fallback.flows,
    news: payload.news?.length ? payload.news : fallback.news,
    signals: fallback.signals.map((item) => liveSignals.find((live) => live.key === item.key) ?? item),
  };
};

const scenarios: Scenario[] = [
  {
    id: "rebound",
    eyebrow: "유동성 회복",
    title: "KOSPI 조건부 반등",
    summary: "외국인 매도 진정과 원화 안정이 동시에 나타나는 경우",
    impact: 8.4,
    tone: "positive",
    icon: TrendingUp,
    forecast: [1, 1.018, 1.045, 1.084],
    assumptions: ["외국인 순매도 축소", "원·달러 1,390원 하회", "반도체 수급 회복"],
  },
  {
    id: "semiconductor",
    eyebrow: "실적 충격",
    title: "AI CapEx 둔화",
    summary: "반도체 실적 기대가 낮아지고 투자 계획이 조정되는 경우",
    impact: -9.6,
    tone: "negative",
    icon: Activity,
    forecast: [1, 0.977, 0.942, 0.904],
    assumptions: ["메모리 가격 약세", "실적 컨센서스 하향", "AI 투자 지연"],
  },
  {
    id: "fx",
    eyebrow: "거시 압력",
    title: "원화 약세 재확산",
    summary: "고금리 장기화와 달러 강세로 외국인 이탈이 커지는 경우",
    impact: -6.2,
    tone: "negative",
    icon: Globe2,
    forecast: [1, 0.986, 0.959, 0.938],
    assumptions: ["원·달러 1,450원 상회", "국고채 금리 상승", "외국인 매도 지속"],
  },
];

const environmentSeeds: EnvironmentSeed[] = [
  { id: "foreign-buying", label: "외국인 순매수 회복", category: "수급", detail: "현물·선물 3거래일 이상 순매수", direction: 1 },
  { id: "hynix-surprise", label: "SK하이닉스 실적 상회", category: "실적", detail: "영업이익 컨센서스 10% 이상 상회", direction: 1 },
  { id: "ai-capex", label: "AI CapEx 유지·확대", category: "산업", detail: "글로벌 빅테크 투자 가이던스 유지", direction: 1 },
  { id: "exports", label: "반도체 수출 증가", category: "수출", detail: "메모리 가격과 HBM 출하 회복", direction: 1 },
  { id: "won-weakness", label: "원·달러 1,450원 상회", category: "환율", detail: "원화 약세와 위험 프리미엄 확대", direction: -1 },
  { id: "us-rates", label: "미국 금리 상승", category: "금리", detail: "미 10년물 상승과 할인율 부담", direction: -1 },
  { id: "cxmt-supply", label: "CXMT 메모리 공급 확대", category: "경쟁", detail: "중국 공급 증가와 이익 추정치 하향", direction: -1 },
  { id: "china-slowdown", label: "중국 경기 둔화", category: "매크로", detail: "대중 수요 둔화와 위험선호 약화", direction: -1 },
];

const gapItems = [
  { icon: CalendarClock, title: "미래 이벤트 캘린더", detail: "실적 발표·정책 일정·경제지표 발표 예정 시각" },
  { icon: UsersRound, title: "커뮤니티 심리", detail: "뉴스 외 투자자 반응, 언급량, 감성 변화" },
  { icon: Globe2, title: "글로벌 시장", detail: "S&P 500·NASDAQ·환율 선물의 동시간 흐름" },
  { icon: Sparkles, title: "검증된 시나리오 모델", detail: "예측값, 신뢰구간, 백테스트와 모델 버전" },
];

const eventLabels: Record<string, string> = {
  INTEREST_RATES: "금리",
  REAL_ECONOMY: "실물경제",
  GEOPOLITICAL: "지정학",
  FX: "환율",
  FOREIGN_EXCHANGE: "환율",
  EARNINGS: "실적",
};

const signalIcons: Record<SignalGroup["key"], typeof Activity> = {
  economy: Activity,
  country: Globe2,
  event: CalendarClock,
  community: UsersRound,
};

const signalImpacts: Record<SignalGroup["key"], string> = {
  economy: "금리·환율 변화는 기업 조달비용과 수출주 이익 전망을 바꿔 지수의 적정 가치에 직접 반영됩니다.",
  country: "미국·한국의 정책 방향은 외국인 자금 흐름, 원화 가치와 성장주 밸류에이션에 영향을 줍니다.",
  event: "뉴스 이벤트는 위험 선호와 변동성을 빠르게 바꾸지만, 영향의 방향과 지속 기간은 사건마다 다릅니다.",
  community: "투자자 관심과 심리는 단기 거래량과 수급 쏠림을 키울 수 있지만 펀더멘털 신호로 단독 사용하지 않습니다.",
};

const formatNumber = (value: number, digits = 2) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);

const formatFlow = (value: number) => {
  const absolute = Math.abs(value);
  const formatted = absolute >= 1_000_000_000_000
    ? `${(absolute / 1_000_000_000_000).toFixed(2)}조`
    : `${Math.round(absolute / 100_000_000).toLocaleString("ko-KR")}억`;
  return `${value < 0 ? "−" : "+"}${formatted}`;
};

const formatDate = (date: string) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(parsed);
};

function Trend({ value }: { value: number }) {
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`trend ${positive ? "positive" : "negative"}`}>
      <Icon aria-hidden="true" size={14} strokeWidth={2.4} />
      {positive ? "+" : ""}{formatNumber(value)}%
    </span>
  );
}

function MarketChart({ series, scenario }: { series: MarketSeries; scenario: Scenario }) {
  const [hoverIndex, setHoverIndex] = useState(series.points.length - 1);
  const chartRef = useRef<HTMLDivElement>(null);

  const chart = useMemo(() => {
    const width = 420;
    const height = 180;
    const top = 12;
    const bottom = 25;
    const actualStart = 10;
    const actualEnd = 286;
    const futureEnd = 410;
    const latest = series.points.at(-1)?.close ?? 0;
    const observedVolatility = Math.sqrt(
      series.points.reduce((sum, point) => sum + (point.changePct / 100) ** 2, 0) / Math.max(series.points.length, 1),
    );
    const forecast = scenario.forecast.map((factor, position) => {
      const center = latest * factor;
      const spread = Math.min(.22, Math.max(observedVolatility, .012) * Math.sqrt(position * 5) * 1.35);
      return {
        center,
        upper: center * (1 + spread),
        lower: center * (1 - spread),
        x: actualEnd + ((futureEnd - actualEnd) * position) / Math.max(scenario.forecast.length - 1, 1),
      };
    });
    const values = [
      ...series.points.map((point) => point.close),
      ...forecast.flatMap((point) => [point.lower, point.upper]),
    ];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * .12, max * .012);
    const y = (value: number) => top + ((max + padding - value) / (max - min + padding * 2)) * (height - top - bottom);
    const actual = series.points.map((point, position) => ({
      ...point,
      x: actualStart + ((actualEnd - actualStart) * position) / Math.max(series.points.length - 1, 1),
      y: y(point.close),
    }));
    const actualPath = actual.map((point, position) => `${position ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    const areaPath = `${actualPath} L ${actualEnd} ${height - bottom} L ${actualStart} ${height - bottom} Z`;
    const medianPath = forecast.map((point, position) => `${position ? "L" : "M"} ${point.x} ${y(point.center)}`).join(" ");
    const bandPath = [
      ...forecast.map((point, position) => `${position ? "L" : "M"} ${point.x} ${y(point.upper)}`),
      ...[...forecast].reverse().map((point) => `L ${point.x} ${y(point.lower)}`),
      "Z",
    ].join(" ");
    return { width, height, top, bottom, actualStart, actualEnd, actual, actualPath, areaPath, medianPath, bandPath };
  }, [series, scenario]);

  const hovered = chart.actual[Math.min(Math.max(0, hoverIndex), chart.actual.length - 1)] ?? chart.actual.at(-1);
  const valueDigits = /^\d+$/.test(series.key) ? 0 : 2;

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const svgX = ((event.clientX - bounds.left) / bounds.width) * chart.width;
    const position = Math.round(
      ((svgX - chart.actualStart) / (chart.actualEnd - chart.actualStart)) * Math.max(series.points.length - 1, 1),
    );
    setHoverIndex(Math.max(0, Math.min(series.points.length - 1, position)));
  };

  return (
    <div
      className="chart-wrap"
      ref={chartRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverIndex(series.points.length - 1)}
    >
      <svg className="market-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${series.name} 최근 흐름과 ${scenario.title} 조건부 분포`}>
        <defs>
          <linearGradient id={`actual-line-${series.key}`} x1="0" x2="1">
            <stop offset="0" stopColor="#86bfff" />
            <stop offset="1" stopColor="#087ff5" />
          </linearGradient>
          <linearGradient id={`area-fill-${series.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3c9cff" stopOpacity=".25" />
            <stop offset="1" stopColor="#3c9cff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = chart.top + ((chart.height - chart.top - chart.bottom) * line) / 3;
          return <line key={line} className="chart-grid" x1="10" x2="410" y1={y} y2={y} />;
        })}
        <path className="chart-area" style={{ fill: `url(#area-fill-${series.key})` }} d={chart.areaPath} />
        <path className="chart-line" style={{ stroke: `url(#actual-line-${series.key})` }} d={chart.actualPath} />
        <line className="forecast-divider" x1={chart.actualEnd} x2={chart.actualEnd} y1="8" y2={chart.height - chart.bottom} />
        <path className={`forecast-band ${scenario.tone}`} d={chart.bandPath} />
        <path className={`forecast-median ${scenario.tone}`} d={chart.medianPath} />
        {hovered && (
          <>
            <line className="hover-line" x1={hovered.x} x2={hovered.x} y1="8" y2={chart.height - chart.bottom} />
            <circle className="hover-dot" cx={hovered.x} cy={hovered.y} r="4" />
          </>
        )}
        <text className="chart-label actual-label" x="10" y="174">{series.source === "database" ? "실제 DB" : "더미"}</text>
        <text className="chart-label forecast-label" x="294" y="174">조건부 분포</text>
      </svg>
      {hovered && (
        <div className="chart-tooltip" style={{ left: `${(hovered.x / chart.width) * 100}%` }}>
          <span>{formatDate(hovered.date)}</span>
          <strong>{formatNumber(hovered.close, valueDigits)}</strong>
          <Trend value={hovered.changePct} />
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<DashboardData>(fallback);
  const [status, setStatus] = useState<"loading" | "live" | "fallback">("fallback");
  const [selectedMarket, setSelectedMarket] = useState<"KOSPI" | "KOSDAQ" | "NASDAQ">("KOSPI");
  const [selectedScenario, setSelectedScenario] = useState(scenarios[0]);
  const [eventMode, setEventMode] = useState<"news" | "conditions">("news");
  const [refreshing, setRefreshing] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(["외국인 순매수 회복", "AI CapEx 유지·확대"]);
  const [period, setPeriod] = useState("30일");
  const [scenarioPrompt, setScenarioPrompt] = useState("외국인 수급과 반도체 실적이 함께 회복되면 시장은 어떻게 움직일까?");
  const [uploadedSource, setUploadedSource] = useState<{ name: string; size: number } | null>(null);

  const loadData = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("dashboard request failed");
      setData(mergeDashboard(await response.json()));
      setStatus("live");
    } catch {
      setData(fallback);
      setStatus("fallback");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("dashboard request failed");
        return response.json() as Promise<DashboardData>;
      })
      .then((payload) => {
        if (!active) return;
        setData(mergeDashboard(payload));
        setStatus("live");
      })
      .catch(() => {
        if (!active) return;
        setData(fallback);
        setStatus("fallback");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!builderOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBuilderOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [builderOpen]);

  const toggleSeed = (label: string) => {
    setSelectedSeeds((current) => current.includes(label)
      ? current.filter((item) => item !== label)
      : [...current, label]);
  };

  const applyCustomScenario = () => {
    const seeds = environmentSeeds.filter((seed) => selectedSeeds.includes(seed.label));
    const periodWeight = period === "7일" ? 0.45 : period === "3개월" ? 1.55 : 1;
    const impact = Number((seeds.reduce((total, seed) => total + seed.direction * 2.1, 0) * periodWeight).toFixed(1));
    const finalRatio = 1 + impact / 100;
    const title = seeds.length
      ? seeds.slice(0, 2).map((seed) => seed.label).join(" · ")
      : "기본 환경 시나리오";

    setSelectedScenario({
      id: "custom",
      eyebrow: `나의 조건 · ${period}`,
      title,
      summary: scenarioPrompt.trim() || "선택한 시장 조건을 기준으로 경로를 비교합니다.",
      impact,
      tone: impact >= 0 ? "positive" : "negative",
      icon: Network,
      forecast: [1, 1 + (finalRatio - 1) * 0.25, 1 + (finalRatio - 1) * 0.58, finalRatio],
      assumptions: seeds.length ? seeds.map((seed) => seed.label) : ["KOSPI 기본 환경"],
    });
    setEventMode("conditions");
    setBuilderOpen(false);
    window.requestAnimationFrame(() => document.querySelector("#insight")?.scrollIntoView({ behavior: "smooth" }));
  };

  const foreignFlow = data.flows.find((flow) => flow.market === "KOSPI" && flow.investor === "외국인");
  const exchangeRate = data.macros.find((item) => item.name.includes("원달러"));
  const signals = data.signals ?? fallback.signals;
  const databaseSignalCount = signals.filter((signal) => signal.source === "database").length;
  const chartSeries: MarketSeries[] = [
    data.indices.find((item) => item.key === "KOSPI") ?? fallback.indices[0],
    data.indices.find((item) => item.key === "KOSDAQ") ?? fallback.indices[1],
    ...(["005930", "000660"] as const).map((ticker) => {
      const stock = data.stocks.find((item) => item.ticker === ticker)
        ?? fallback.stocks.find((item) => item.ticker === ticker)!;
      return { key: stock.ticker, name: stock.name, points: stock.points, source: stock.source };
    }),
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="주요 탐색">
        <a className="sidebar-brand" href="#top" aria-label="FINVERSE 홈">FINVERSE</a>
        <div className="sidebar-context">
          <BarChart3 size={18} />
          <div><span>MARKET BOARD</span><strong>시장 인사이트</strong></div>
        </div>
        <nav className="side-nav" aria-label="페이지 섹션">
          <a className="active" href="#insight"><BarChart3 size={17} />시장 인사이트</a>
          <a href="#scenarios"><Network size={17} />시나리오 분석</a>
          <a href="#data-readiness"><Database size={17} />데이터 준비도</a>
        </nav>
        <div className="sidebar-footer">
          <div>
            <span className={`connection ${status}`}><span className="status-dot" />{status === "live" ? "PostgreSQL 실시간" : status === "loading" ? "DB 확인 중" : "저장 스냅샷"}</span>
            <button className="icon-button" type="button" aria-label="데이터 새로고침" onClick={() => void loadData()} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spinning" : ""} /></button>
          </div>
          <small><ShieldCheck size={13} />LOCAL VIEW</small>
        </div>
      </aside>

      <header className="mobile-header">
        <a className="brand" href="#top"><span className="brand-mark"><BarChart3 size={17} /></span>FINVERSE</a>
        <button className="icon-button" type="button" aria-label="데이터 새로고침" onClick={() => void loadData()} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spinning" : ""} /></button>
      </header>

      <main className="main-content">

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">MARKET OVERVIEW · LOCAL</span>
          <h1>오늘의 시장을 읽고,<br /><span>다음 움직임을 미리 살펴보세요.</span></h1>
          <p>실제 시장 데이터와 조건부 시나리오를 한 화면에서 연결합니다.</p>
        </div>
        <div className="privacy-pill"><ShieldCheck size={15} />내 컴퓨터에서만 실행 중</div>
      </section>

      <section className="dashboard-grid" id="insight">
        <aside className="panel market-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">MARKET PULSE</span>
              <h2>시장 연결</h2>
            </div>
            <Wifi size={18} className="muted-icon" />
          </div>

          <div className="signal-summary">
            <div>
              <h3>오늘의 시장 구성</h3>
              <p>항목을 눌러 비중 근거와 시장 영향 보기</p>
            </div>
            <span>{databaseSignalCount}/4 DB</span>
          </div>

          <div className="signal-stack">
            {signals.map((signal) => {
              const Icon = signalIcons[signal.key];
              const keywords = signal.keywords.slice(0, 2);
              return (
                <details className={`signal-group ${signal.key}`} key={signal.key}>
                  <summary>
                    <span className="signal-group-head">
                      <span className="signal-icon"><Icon size={15} /></span>
                      <strong>{signal.label}</strong>
                      <span className={`source-badge ${signal.source}`}>{signal.source === "database" ? "DB" : "더미"}</span>
                      <span className="signal-share"><b>{signal.share}%</b><ChevronRight className="signal-disclosure" size={12} /></span>
                    </span>
                    <span className="signal-keywords">
                      {keywords.map((keyword) => (
                        <span key={keyword.label}>
                          <span>{keyword.label}</span>
                          <strong>{keyword.share}%</strong>
                        </span>
                      ))}
                    </span>
                    <span className="signal-track" aria-hidden="true">
                      {keywords.map((keyword) => <i key={keyword.label} style={{ width: `${keyword.share}%` }} />)}
                    </span>
                  </summary>
                  <div className="signal-explainer">
                    <div>
                      <span>비중 근거</span>
                      <p>{keywords.map((keyword) => `${keyword.label} ${keyword.share}%`).join(" + ")}의 합계입니다. 현재 퍼센트는 비교용 데모 가중치이며 예측 확률은 아닙니다.</p>
                    </div>
                    <div>
                      <span>시장 영향</span>
                      <p>{signalImpacts[signal.key]}</p>
                    </div>
                    <small>{signal.source === "database" ? "키워드는 DB 수집값, 비중은 데모 기준" : "DB 미연결 시 표시되는 예시 키워드와 비중"}</small>
                  </div>
                </details>
              );
            })}
          </div>

          <div className="index-section">
            <div className="section-row"><h3>주요 지수</h3><span>{formatDate(data.asOf)} 기준</span></div>
            <div className="market-switch" aria-label="시장 선택">
              {data.indices.map((item) => {
                const point = item.points.at(-1);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={selectedMarket === item.key ? "selected" : ""}
                    onClick={() => setSelectedMarket(item.key)}
                  >
                    <span>{item.name}<small className={`index-source ${item.source}`}>{item.source === "database" ? "DB" : "D"}</small></span>
                    <strong>{point ? formatNumber(point.close) : "—"}</strong>
                    {point && <Trend value={point.changePct} />}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <article className="panel chart-panel market-board">
          <div className="chart-heading">
            <div>
              <div className="live-label"><span />LIVE MARKET MONITOR</div>
              <h2>지수·반도체 4종</h2>
              <p>실제 종가와 최근 변동성 기반 조건부 범위</p>
            </div>
            <button className="compact-button" type="button" onClick={() => document.querySelector("#scenarios")?.scrollIntoView({ behavior: "smooth" })}>
              시나리오 변경 <ChevronRight size={15} />
            </button>
          </div>

          <div className="market-card-grid">
            {chartSeries.map((series) => {
              const latest = series.points.at(-1) ?? { date: data.asOf, close: 0, changePct: 0 };
              const valueDigits = /^\d+$/.test(series.key) ? 0 : 2;
              return (
                <section className="market-card" key={series.key} aria-label={`${series.name} 시장 차트`}>
                  <header className="market-card-head">
                    <div>
                      <span>{series.key}</span>
                      <h3>{series.name}</h3>
                    </div>
                    <small className={`market-source ${series.source}`}>{series.source === "database" ? "DB" : "DEMO"}</small>
                  </header>
                  <div className="market-card-value">
                    <strong>{formatNumber(latest.close, valueDigits)}</strong>
                    <Trend value={latest.changePct} />
                  </div>
                  <MarketChart series={series} scenario={selectedScenario} />
                  <div className="distribution-key">
                    <span><i className="actual" />실제</span>
                    <span><i className={`range ${selectedScenario.tone}`} />조건부 분포</span>
                    <time>{formatDate(latest.date)}</time>
                  </div>
                </section>
              );
            })}
          </div>

          <div className="insight-strip">
            <div className="ai-orb"><BarChart3 size={18} /></div>
            <div>
              <span>MARKET BRIEF</span>
              <p>
                외국인은 KOSPI에서 <strong>{foreignFlow ? formatFlow(foreignFlow.netValue) : "집계 중"}</strong>, 원·달러는 <strong>{exchangeRate ? `${formatNumber(exchangeRate.value, 1)}원` : "집계 중"}</strong>입니다.
                현재 범위는 <strong>{selectedScenario.title}</strong> 조건과 최근 변동성을 함께 반영한 교육용 분포입니다.
              </p>
            </div>
          </div>
        </article>

        <aside className="panel event-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SIGNAL STREAM</span>
              <h2>이벤트 흐름</h2>
            </div>
            <Newspaper size={18} className="muted-icon" />
          </div>
          <div className="segmented-control" role="tablist" aria-label="이벤트 표시 방식">
            <button role="tab" aria-selected={eventMode === "news"} className={eventMode === "news" ? "selected" : ""} onClick={() => setEventMode("news")}>최근 뉴스</button>
            <button role="tab" aria-selected={eventMode === "conditions"} className={eventMode === "conditions" ? "selected" : ""} onClick={() => setEventMode("conditions")}>예상 조건</button>
          </div>

          {eventMode === "news" ? (
            <div className="timeline">
              {data.news.slice(0, 5).map((item, position) => (
                <article className="timeline-item" key={`${item.publishedAt}-${position}`}>
                  <div className="timeline-rail"><span /><i /></div>
                  <div className="timeline-content">
                    <time>{formatDate(item.publishedAt)}</time>
                    {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : <h3>{item.title}</h3>}
                    <div className="tag-row">
                      {item.eventTypes.slice(0, 2).map((type) => <span key={type}>{eventLabels[type] ?? type}</span>)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="condition-list">
              <div className="condition-banner"><CircleAlert size={17} /><span>아래는 일정 데이터가 아닌 시나리오 조건입니다.</span></div>
              {selectedScenario.assumptions.map((assumption, index) => (
                <div className="condition-row" key={assumption}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{assumption}</strong><small>발생 시 조건부 경로에 반영</small></div>
                </div>
              ))}
            </div>
          )}
          <div className="event-footnote"><Database size={14} />뉴스는 수집 시점, 시장은 거래일 기준으로 갱신됩니다.</div>
        </aside>
      </section>

      <section className="scenario-section" id="scenarios">
        <div className="section-heading">
          <div><span className="eyebrow">SCENARIO ANALYSIS</span><h2>조건별 시장 경로</h2><p>시장 조건을 선택해 지수와 주요 종목의 변화 범위를 비교하세요.</p></div>
          <span className="disclaimer"><CircleAlert size={14} />투자 권유가 아닌 시장 이해용 데모</span>
        </div>
        <div className="scenario-grid">
          {scenarios.map((scenario) => {
            const Icon = scenario.icon;
            const selected = selectedScenario.id === scenario.id;
            return (
              <button
                type="button"
                key={scenario.id}
                className={`scenario-card ${selected ? "selected" : ""}`}
                onClick={() => setSelectedScenario(scenario)}
                aria-pressed={selected}
              >
                <div className={`scenario-icon ${scenario.tone}`}><Icon size={20} /></div>
                <span className="eyebrow">{scenario.eyebrow}</span>
                <h3>{scenario.title}</h3>
                <p>{scenario.summary}</p>
                <div className="scenario-result">
                  <span>4주 조건부 변화</span>
                  <strong className={scenario.tone}>{scenario.impact > 0 ? "+" : ""}{scenario.impact.toFixed(1)}%</strong>
                </div>
                <div className="scenario-action">차트에 적용 {selected ? <span className="selected-check"><Check size={13} /></span> : <ChevronRight size={15} />}</div>
              </button>
            );
          })}
          <button
            type="button"
            className={`custom-scenario-card ${selectedScenario.id === "custom" ? "selected" : ""}`}
            onClick={() => setBuilderOpen(true)}
            aria-pressed={selectedScenario.id === "custom"}
          >
            <span className="custom-scenario-icon"><Plus size={22} /></span>
            <div>
              <span>MY SCENARIO</span>
              <strong>내 시나리오 예측하기</strong>
              <p>시장 조건·기간·나만의 질문을 직접 설정하세요.</p>
            </div>
            <span className="custom-scenario-action">
              {selectedScenario.id === "custom" ? "적용 중" : "조건 만들기"}
              {selectedScenario.id === "custom" ? <Check size={15} /> : <ArrowRight size={16} />}
            </span>
          </button>
        </div>
      </section>

      <section className="readiness-section" id="data-readiness">
        <div className="readiness-copy">
          <span className="eyebrow">DATA READINESS</span>
          <h2>현재 DB로 가능한 것과<br />더 필요한 것을 구분했습니다.</h2>
          <p>가격·수급·거시지표·뉴스는 연결됐습니다. 미래 예측 품질을 높이려면 아래 네 가지 데이터가 추가로 필요합니다.</p>
          <div className="ready-list">
            {["KRX 지수·종목 일봉", "시장별 투자자 수급", "한국 거시지표", "뉴스·이벤트 분류"].map((item) => <span key={item}><Check size={13} />{item}</span>)}
          </div>
        </div>
        <div className="gap-grid">
          {gapItems.map((item) => {
            const Icon = item.icon;
            return <article className="gap-card" key={item.title}><Icon size={20} /><div><h3>{item.title}</h3><p>{item.detail}</p></div><span>추가 필요</span></article>;
          })}
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark"><BarChart3 size={17} /></span>FINVERSE</div>
        <p>데이터 기준 {data.asOf} · 로컬 전용 프로토타입 · 시나리오는 교육용 예시입니다.</p>
      </footer>

      {builderOpen && (
        <div className="scenario-builder-backdrop" onMouseDown={() => setBuilderOpen(false)}>
          <section
            className="scenario-builder"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scenario-builder-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="scenario-builder-header">
              <div>
                <span>CUSTOM SCENARIO</span>
                <h2 id="scenario-builder-title">내 조건으로 시장 경로 만들기</h2>
                <p>시장 조건과 기간을 지정해 주요 지수와 종목의 조건부 범위를 비교합니다.</p>
              </div>
              <button type="button" onClick={() => setBuilderOpen(false)} aria-label="시나리오 만들기 닫기"><X size={19} /></button>
            </header>

            <div className="builder-section-heading">
              <div><span>01 · MARKET CONDITIONS</span><h3>출발 조건을 선택하세요</h3></div>
              <small>{selectedSeeds.length}개 선택</small>
            </div>
            <div className="builder-seed-grid">
              {environmentSeeds.map((seed) => {
                const selected = selectedSeeds.includes(seed.label);
                return (
                  <button key={seed.id} type="button" className={selected ? "selected" : ""} onClick={() => toggleSeed(seed.label)} aria-pressed={selected}>
                    <span><em>{seed.category}</em>{selected ? <CheckCircle2 size={15} /> : <Plus size={15} />}</span>
                    <strong>{seed.label}</strong>
                    <small>{seed.detail}</small>
                  </button>
                );
              })}
            </div>

            <div className="builder-input-grid">
              <div className="builder-field">
                <div className="builder-section-heading compact"><div><span>02 · SOURCE DATA</span><h3>나만의 데이터</h3></div></div>
                <label className="builder-upload" htmlFor="scenario-source-upload">
                  <FileUp size={19} />
                  <span>{uploadedSource ? uploadedSource.name : "참고 파일 추가"}</span>
                  <small>{uploadedSource ? `${Math.max(1, Math.round(uploadedSource.size / 1024))}KB · 브라우저에서만 보관` : "CSV · JSON · TXT · PDF"}</small>
                </label>
                <input
                  className="visually-hidden"
                  id="scenario-source-upload"
                  type="file"
                  accept=".csv,.json,.txt,.md,.pdf,text/*,application/pdf"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) setUploadedSource({ name: file.name, size: file.size });
                    event.target.value = "";
                  }}
                />
              </div>
              <label className="builder-field" htmlFor="scenario-prompt">
                <div className="builder-section-heading compact"><div><span>03 · QUESTION</span><h3>확인하고 싶은 질문</h3></div></div>
                <textarea id="scenario-prompt" rows={5} value={scenarioPrompt} onChange={(event) => setScenarioPrompt(event.target.value)} />
              </label>
            </div>

            <div className="builder-period-row">
              <div><span>예측 기간</span><small>조건부 분포를 계산할 구간</small></div>
              <div role="group" aria-label="예측 기간">
                {["7일", "30일", "3개월"].map((item) => (
                  <button type="button" key={item} className={period === item ? "selected" : ""} onClick={() => setPeriod(item)}>{item}</button>
                ))}
              </div>
            </div>

            <button className="run-scenario-button" type="button" onClick={applyCustomScenario}>
              <Network size={18} />이 조건을 차트에 적용<ArrowRight size={17} />
            </button>
            <p className="builder-footnote">현재 결과는 선택 조건을 단순 가중한 교육용 데모이며 실제 예측 모델의 출력이 아닙니다.</p>
          </section>
        </div>
      )}
      </main>
    </div>
  );
}
