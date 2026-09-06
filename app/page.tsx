"use client";

import {
  Activity,
  ArrowRight,
  BarChart3,
  Bookmark,
  CalendarDays,
  CalendarClock,
  CandlestickChart,
  ChevronRight,
  CircleDollarSign,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  FileUp,
  GitBranch,
  Globe2,
  LoaderCircle,
  MessageCircle,
  Network,
  Plus,
  Radio,
  Send,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { PaperEvidenceMarkdown, PaperTradingModal, type Security } from "@/components/paper-trading";
import { AuthModal, type AuthUser, useAuthUser } from "@/components/auth";
import { MockMarketSimulation } from "@/components/mock-market-simulation";

const SimulationMessageResponse = dynamic(
  () => import("@/components/ai-elements/message").then((module) => module.MessageResponse),
  { ssr: false },
);

type MainTab = "market" | "twin";

type MarketSignalKey = "economy" | "country" | "event" | "community";
type DashboardSource = { title: string; publisher: string; url: string | null; publishedAt?: string | null };
type DashboardSignal = {
  key: MarketSignalKey;
  label: string;
  evidenceCount: number;
  evidenceUnit: string;
  source: "database" | "dummy";
  keywords: { label: string; count: number }[];
  impactSummary: string;
  topics: { title: string; summary: string; importance?: number; sources?: DashboardSource[] }[];
  sources: DashboardSource[];
  analysisSource?: "openrouter" | "rules";
  analysisGeneratedAt?: string | null;
  analysisModel?: string | null;
};

type Scenario = {
  id: string;
  title: string;
  duration: string;
  tags: string[];
  forecast: string;
  tone: "up" | "down";
  image: string;
  summary: string;
  thesis: string;
  context: string;
  chapters: { title: string; body: string; evidence: string }[];
  investorGuide: { stance: string; action: string; rationale: string }[];
  studyGuide: { topic: string; question: string }[];
  biasChecks: { bias: string; trap: string; counter: string }[];
  path: number[];
  events: { week: string; category: string; title: string; body: string; impact: string }[];
  agentInsights: { role: string; title: string; body: string }[];
  riskPoints: string[];
};

type ScenarioEditorial = {
  ui: { theme: "sunny" | "forest" | "cobalt" | "berry"; rhythm: "calm" | "bold" | "playful" };
  badge: string;
  headline: string;
  subhead: string;
  cards: Array<{
    kicker: string;
    title: string;
    body: string;
    stat: string;
    statLabel: string;
    layout: "hero" | "split" | "reverse" | "spotlight" | "stacked";
    visual: "market-path" | "capital-flow" | "earnings" | "calendar" | "risk-radar";
  }>;
  explanation: { title: string; lead: string; paragraphs: string[] };
};

type EditorialState = "fallback" | "loading" | "ready";

const marketSignals: DashboardSignal[] = [
  { key: "economy", label: "경제", evidenceCount: 2, evidenceUnit: "지표", source: "dummy", keywords: [{ label: "금리 정책", count: 1 }, { label: "원화 약세", count: 1 }], impactSummary: "금리·환율 변화는 기업 조달비용과 수출주 이익 전망을 바꿔 KOSPI 적정 가치에 연결됩니다.", topics: [{ title: "금리 정책", summary: "기준금리 경로가 성장주의 할인율과 시장 밸류에이션에 영향을 줍니다.", importance: 3 }, { title: "환율 변동성", summary: "원화 가치 변화는 수출주 이익과 외국인 자금 흐름에 함께 연결됩니다.", importance: 2 }], sources: [] },
  { key: "country", label: "국가", evidenceCount: 2, evidenceUnit: "기사", source: "dummy", keywords: [{ label: "미국 정책", count: 1 }, { label: "중국 경기", count: 1 }], impactSummary: "주요국 정책과 경기는 글로벌 위험선호, 환율과 한국 수출 전망을 통해 KOSPI에 연결됩니다.", topics: [{ title: "미국 금리 정책", summary: "미국의 금리 기대는 외국인 자금과 성장주 할인율에 영향을 줍니다.", importance: 3 }, { title: "중국 경기", summary: "중국 수요 변화는 한국 수출 및 경기 민감주의 이익 전망에 반영됩니다.", importance: 2 }], sources: [] },
  { key: "event", label: "이벤트", evidenceCount: 2, evidenceUnit: "분류", source: "dummy", keywords: [{ label: "외국인 수급", count: 1 }, { label: "반도체 실적", count: 1 }], impactSummary: "수급과 기업 실적 이벤트는 대형주 비중이 높은 KOSPI의 단기 변동성을 빠르게 바꿀 수 있습니다.", topics: [{ title: "외국인 수급", summary: "외국인 현물·선물 수급 변화가 지수 방향과 변동성에 연결됩니다.", importance: 3 }, { title: "반도체 실적", summary: "반도체 이익 기대는 KOSPI의 실적 전망에 큰 비중으로 반영됩니다.", importance: 3 }], sources: [] },
  { key: "community", label: "커뮤니티", evidenceCount: 2, evidenceUnit: "댓글", source: "dummy", keywords: [{ label: "반도체 투자심리", count: 1 }, { label: "국내 증시 신뢰", count: 1 }], impactSummary: "온라인 투자심리는 단기 거래 집중을 보여주는 보조 신호이며 지수 움직임의 원인으로 단정하지 않습니다.", topics: [{ title: "반도체 투자심리", summary: "대형 반도체주에 대한 기대와 경계가 단기 거래 집중에 연결될 수 있습니다.", importance: 2 }, { title: "국내 증시 신뢰", summary: "국내 증시와 외국인 수급에 대한 인식은 위험선호의 보조 지표입니다.", importance: 1 }], sources: [] },
];

const marketSignalIcons = { economy: Activity, country: Globe2, event: CalendarClock, community: UsersRound };
const importanceScore = (value?: number) => Math.max(1, Math.min(3, Math.round(value ?? 2)));

type WatchSymbol = { ticker: string; name: string };
type TickerSource = { key: "market" | "economy" | "events" | "community"; label: string; status: "ready" | "missing"; count: number; unit: string; updated_at: string | null; detail: string };
const tickerSourceIcons = { market: BarChart3, economy: Activity, events: CalendarClock, community: UsersRound };
const followedSymbols: WatchSymbol[] = [
  { ticker: "005930", name: "삼성전자" },
  { ticker: "000660", name: "SK하이닉스" },
  { ticker: "005380", name: "현대차" },
  { ticker: "009150", name: "삼성전기" },
  { ticker: "373220", name: "LG에너지솔루션" },
  { ticker: "207940", name: "삼성바이오로직스" },
  { ticker: "105560", name: "KB금융" },
];
const marketOverview = [
  { key: "KOSPI", name: "코스피", value: "6,023.66", change: "-732.09", rate: "-10.84%", tone: "down", badge: "시장 하락", points: [6244, 6312, 6388, 6460, 6380, 6428, 6375, 6160, 6128, 6038, 6048, 6024, 6085, 6032, 5920, 5980, 6002, 6024] },
  { key: "KOSDAQ", name: "코스닥", value: "834.20", change: "-30.45", rate: "-3.52%", tone: "down", badge: "유가 금리 부담", points: [862, 856, 849, 852, 844, 840, 836, 834] },
  { key: "SPX", name: "S&P 500", value: "5,982.72", change: "-54.21", rate: "-0.90%", tone: "down", badge: "위험 회피", points: [6068, 6052, 6040, 6024, 6012, 6002, 5991, 5983] },
  { key: "NASDAQ", name: "나스닥", value: "19,546.73", change: "-187.42", rate: "-0.95%", tone: "down", badge: "기술주 조정", points: [19840, 19812, 19790, 19752, 19720, 19680, 19622, 19547] },
] as const;
const marketChartDates = ["7/22", "7/23", "7/24", "7/27", "7/28"];
const defaultMarketBrief = [
  "장마감 후 생성된 시장 요약을 불러오고 있습니다.",
  "최신 배치가 아직 없으면 다음 장마감 이후 자동으로 갱신됩니다.",
];
const actualPath = [
  5224.36, 5350, 5480, 5610, 5760, 5920, 6080, 6244.13, 6000, 5700, 5350,
  5052.46, 5450, 5900, 6300, 6598.87, 7100, 7600, 8050, 8476.15, 8420,
  8300, 8200, 8476.48, 7900, 7400, 7000, 6720, 6500, 6250, 6100, 6023.66,
];

const makeTradingDates = (endDate: string, count: number) => {
  const cursor = new Date(`${endDate}T12:00:00`);
  const dates: string[] = [];
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) dates.unshift(`${cursor.getMonth() + 1}/${cursor.getDate()}`);
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
};

const actualDates = makeTradingDates("2026-07-28", actualPath.length);
type KospiCandle = { date: string; label: string; open: number; high: number; low: number; close: number };
type KospiMarketData = { latestDate: string; latestLabel: string; value: number; change: number; rate: number; candles: KospiCandle[] };
type IntradayIndex = {
  key: "KOSPI" | "KOSDAQ" | "SP500" | "NASDAQ";
  name: string;
  source: "database";
  points: Array<{ date: string; close: number; changePct: number; open?: number; high?: number; low?: number }>;
};
const formatIndexValue = (value: number) => value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatSignedIndex = (value: number) => `${value >= 0 ? "+" : ""}${formatIndexValue(value)}`;
const fallbackKospiCandles: KospiCandle[] = actualPath.map((close, index) => {
  const open = index === 0 ? close - 55 : actualPath[index - 1];
  return { date: actualDates[index].replace("/", ""), label: actualDates[index], open, high: Math.max(open, close) + 28, low: Math.min(open, close) - 28, close };
});
const scenarioAssetBase = "https://raw.githubusercontent.com/zerojin91/finverse/main/public/scenarios";

const scenarios: Scenario[] = [
  {
    id: "kospi-rebound",
    title: "KOSPI 조건부 반등",
    duration: "1개월",
    tags: ["외국인 순매수", "AI CapEx"],
    forecast: "KOSPI +24.5%",
    tone: "up",
    image: `${scenarioAssetBase}/kospi-rebound.png`,
    summary:
      "2026년 7월 28일 종가 6,023.66에서 출발하는 조건부 전망입니다. 외국인 수급 회복, 7월 29일 SK하이닉스 영업이익의 컨센서스 10% 이상 상회(약 70.5조원), Microsoft·Meta의 AI CapEx 유지·확대가 모두 확인되면 1주 6,650, 2주 7,050, 1개월 7,500까지 반등을 시도합니다. 선행 PER 5.7~5.8배와 RSI 31~34의 과매도 구간은 반등 여지를 주지만, MACD 하락과 연환산 변동성 80%는 큰 변동성을 경고합니다.",
    thesis: "반도체 실적과 외국인 수급이 함께 돌아올 때만, 7월 28일의 급락은 ‘추세 붕괴’가 아니라 ‘재평가를 위한 리셋’이 됩니다.",
    context: "이 시나리오는 좋은 뉴스 하나를 맞히는 이야기가 아닙니다. 수급이 먼저 바뀌고, 실적이 확인되고, 빅테크의 투자 의지가 이어지는 세 장면이 순서대로 나타날 때 KOSPI가 6,023.66에서 회복 경로로 전환된다는 조건부 이야기입니다.",
    chapters: [
      { title: "1장 · 급락 다음 날, 무엇이 달라져야 하나", body: "7월 28일 KOSPI는 외국인 약 5조원 순매도와 반도체주 급락으로 6,000선을 밑돌았습니다. 그래서 첫 반등 캔들만 보고 바닥을 선언하면 안 됩니다. 현물과 선물에서 외국인이 3거래일 이상 순매수로 돌아오는지, 원·달러 환율이 안정되는지를 먼저 확인해야 합니다.", evidence: "출발점 6,023.66 · 첫 관문 외국인 수급 3~5거래일" },
      { title: "2장 · 실적은 숫자보다 기대의 방향을 바꾼다", body: "SK하이닉스 영업이익이 컨센서스 64.1조원을 10% 이상 웃돌면 시장은 단순한 한 분기 서프라이즈가 아니라 HBM 수요가 아직 살아 있다는 신호로 읽을 수 있습니다. 다만 가이던스가 보수적이면 주가는 발표 당일 올라도 추세는 이어지지 않을 수 있어, 다음 분기 전망까지 함께 봐야 합니다.", evidence: "컨센서스 64.1조원 · 시나리오 기준 약 70.5조원" },
      { title: "3장 · AI CapEx가 지수 멀티플을 다시 여는 과정", body: "Microsoft와 Meta가 AI CapEx를 유지하거나 확대하면 메모리·HBM 수요의 지속성이 확인됩니다. 이때 저평가된 선행 PER 5.7~5.8배가 6배 이상으로 재평가될 여지가 생깁니다. 반등의 엔진은 실적 하나가 아니라 이익 추정치와 멀티플이 동시에 움직이는 데 있습니다.", evidence: "1주 6,650 · 2주 7,050 · 1개월 중심값 7,500" },
      { title: "4장 · 개인 투자자는 언제 판단을 바꿀까", body: "가격이 빠르게 오를 때 뒤늦게 추격하기보다 세 관문을 체크리스트로 두세요. 수급 회복이 끊기거나, 가이던스가 낮아지거나, AI CapEx가 비용 통제로 바뀌면 반등 시나리오는 즉시 보류합니다. 조건이 유지될 때만 분할 접근하고, 예측보다 검증 속도를 우선하는 것이 이 시나리오의 핵심 학습입니다.", evidence: "반증 신호: 외국인 재순매도 · MACD 하락 지속 · 20일선 7,232 회복 실패" },
    ],
    investorGuide: [
      { stance: "확인 전", action: "현금 비중을 유지하고 첫 반등을 관찰", rationale: "과매도는 반등할 수 있지만 수급이 확인되기 전에는 바닥 신호가 아닙니다." },
      { stance: "조건 충족", action: "반도체·지수 노출을 2~3회로 나눠 접근", rationale: "세 관문이 동시에 맞을 때만 기대수익과 실패 비용을 나눌 수 있습니다." },
      { stance: "조건 이탈", action: "매수 논리를 취소하고 손실 한도를 재점검", rationale: "좋은 이야기보다 실제 가이던스와 수급의 변화가 우선입니다." },
    ],
    studyGuide: [
      { topic: "외국인 수급", question: "현물·선물 순매수가 며칠 지속돼야 추세 신호로 볼 수 있을까?" },
      { topic: "메모리 사이클", question: "HBM 수요와 메모리 가격이 SK하이닉스 이익에 어떻게 연결될까?" },
      { topic: "밸류에이션", question: "PER 재평가가 실적 증가와 별개로 지수를 얼마나 움직일 수 있을까?" },
    ],
    biasChecks: [
      { bias: "FOMO", trap: "첫 양봉을 놓칠까 봐 조건 확인 전에 추격 매수", counter: "매수 조건을 숫자로 적고, 충족된 뒤에만 행동" },
      { bias: "확증 편향", trap: "AI 낙관 뉴스만 모아 하락 신호를 무시", counter: "반증 신호를 같은 화면에 함께 기록" },
      { bias: "기준점 편향", trap: "과거 고점 8,476을 목표가처럼 고정", counter: "현재 이익·수급·멀티플로 기준점을 다시 설정" },
    ],
    path: [6023.66, 6200, 6400, 6650, 6800, 6900, 7050, 7180, 7300, 7400, 7460, 7500],
    events: [
      { week: "8/4 전후", category: "수급·실적", title: "외국인 순매수 회복과 SK하이닉스 서프라이즈", body: "외국인 수급이 회복되고 영업이익이 컨센서스 64.1조원을 10% 이상 웃돌면 1주 중심값 6,650을 시험합니다.", impact: "+10.0%" },
      { week: "8/11 전후", category: "빅테크·AI", title: "Microsoft·Meta AI CapEx 유지·확대", body: "메모리·HBM 수요가 재확인되고 밸류에이션 재평가가 겹치면 2주 중심값 7,050까지 반등이 이어집니다.", impact: "+17.0%" },
      { week: "8/28 전후", category: "분기점", title: "20일 이동평균 7,232 회복 여부", body: "조건이 모두 유지될 때 1개월 중심값은 7,500, 기본 시나리오 밴드는 6,700~8,300입니다.", impact: "+24.5%" },
    ],
    agentInsights: [
      { role: "뉴스 수집가", title: "반도체 실적과 수급의 동시 확인", body: "외국인 순매수 전환과 SK하이닉스 실적 서프라이즈가 동시에 확인될 때 반등 신호의 질이 높아집니다." },
      { role: "애널리스트", title: "저평가 구간의 멀티플 회복", body: "선행 PER 5.7~5.8배에서 6배 이상으로 재평가되면 실적 상향분이 지수에 더 빠르게 반영될 수 있습니다." },
      { role: "퀀트 트레이더", title: "과매도 이후의 기술적 반등", body: "RSI 31~34의 과매도와 20일선 7,232 회복 시도가 반등의 속도를 결정하는 분기점입니다." },
    ],
    riskPoints: ["외국인 순매수가 3~5거래일 안에 꺾이는 경우", "AI CapEx 확대가 실제 수요로 연결되지 않는 경우", "MACD 하락과 높은 변동성이 계속되는 경우"],
  },
  {
    id: "chip-miss",
    title: "반도체 실적 미스·AI CapEx 둔화",
    duration: "1개월",
    tags: ["SK하이닉스 실적 하회", "AI 투자 재평가"],
    forecast: "KOSPI -13.8%",
    tone: "down",
    image: `${scenarioAssetBase}/chip-miss.png`,
    summary:
      "7월 29일 SK하이닉스 영업이익이 컨센서스 64.1조원을 밑돌거나 가이던스가 보수적으로 제시되고, Microsoft·Meta가 AI CapEx의 수익성 검증을 이유로 투자 속도를 늦추는 조건부 하방 경로입니다. 7월 28일 급락을 만든 CXMT 경쟁 우려와 AI 투자수익성 논란이 실적 확인 뒤에도 이어지면 반도체 중심으로 이익 추정치와 멀티플이 함께 낮아질 수 있습니다. 적용 가중치: 뉴스 20% · 애널리스트 55% · 퀀트 25%.",
    thesis: "실적 미스 하나가 무서운 이유는 숫자가 작아서가 아니라, 시장이 믿고 있던 ‘AI 수요의 지속성’ 자체를 흔들기 때문입니다.",
    context: "이 시나리오는 반도체가 나쁘다는 선언이 아니라 기대가 낮아지는 순서를 보여줍니다. 실적과 가이던스가 먼저 꺾이고, 빅테크의 투자 속도가 느려지고, 마지막으로 이익 추정치와 멀티플이 함께 내려가는 경로입니다.",
    chapters: [
      { title: "1장 · 발표 전에는 숫자보다 기대를 읽는다", body: "현재 주가에는 HBM 수요와 AI CapEx가 계속 커질 것이라는 기대가 포함돼 있습니다. 따라서 영업이익이 컨센서스를 조금 밑도는 것보다, 다음 분기 가이던스가 보수적으로 바뀌는지가 더 큰 충격이 될 수 있습니다. 발표 전에는 ‘얼마나 벌었나’와 ‘앞으로 얼마나 벌 수 있나’를 분리해 보세요.", evidence: "컨센서스 64.1조원 · 핵심 관찰값 가이던스와 HBM 가격" },
      { title: "2장 · 빅테크의 말이 수요의 선행지표가 된다", body: "Microsoft와 Meta가 AI 인프라를 계속 늘리더라도 투자 회수 기간과 효율성을 강조하면 메모리 공급사에 적용되던 프리미엄은 낮아질 수 있습니다. 시장은 CapEx 금액보다 증가율, 감가상각 부담, 실제 매출 전환을 함께 비교합니다.", evidence: "1주 5,900 · 2주 5,300 · 투자 확대보다 효율성 강조" },
      { title: "3장 · 공급 경쟁은 이익의 바닥을 다시 계산하게 한다", body: "CXMT의 메모리 공급 확대가 현실적인 경쟁으로 받아들여지면 메모리 가격과 HBM 점유율의 상단이 낮아집니다. 이때 시장은 과거의 높은 이익을 그대로 적용하지 않고, 정상화된 마진과 보수적인 멀티플로 기업가치를 다시 계산합니다.", evidence: "1개월 중심값 5,190 · 하단 4,600까지 열어둔 경로" },
      { title: "4장 · 개인 투자자는 ‘싸졌다’와 ‘싸게 보인다’를 구분한다", body: "주가가 많이 내렸다는 이유만으로 평균단가를 낮추면 손실 회피 심리가 매수 논리를 대신할 수 있습니다. 실적 추정치가 바닥을 만들었는지, 공급 경쟁이 가격에 반영됐는지 확인되기 전에는 관망·분할·현금화 중 하나를 명시적으로 선택해야 합니다.", evidence: "반증 신호: 가이던스 상향 · AI CapEx 재가속 · 메모리 가격 반등" },
    ],
    investorGuide: [
      { stance: "발표 전", action: "기대치와 실제 보유 비중을 분리해 기록", rationale: "컨센서스가 높을수록 작은 미스도 가격에는 크게 반영될 수 있습니다." },
      { stance: "미스 확인", action: "추가 매수보다 가이던스와 공급 지표를 확인", rationale: "싸진 가격이 아니라 낮아진 이익 추정치가 기준이 될 수 있습니다." },
      { stance: "바닥 신호", action: "실적·수요·멀티플이 함께 안정될 때만 분할 접근", rationale: "단기 반등과 추세 전환을 구분해야 평균단가 낮추기 함정을 피할 수 있습니다." },
    ],
    studyGuide: [
      { topic: "컨센서스 읽기", question: "발표된 숫자와 시장 기대치 중 주가에는 무엇이 더 중요한가?" },
      { topic: "AI CapEx", question: "투자액 증가가 실제 서버·메모리 매출로 전환되는 시차는 얼마인가?" },
      { topic: "공급 경쟁", question: "CXMT 공급 확대가 가격·마진·점유율에 미치는 경로는 무엇인가?" },
    ],
    biasChecks: [
      { bias: "손실 회피", trap: "손실을 확정하기 싫어 ‘조금만 더’ 기다림", counter: "가이던스·이익 추정치가 바뀌면 논리를 새로 작성" },
      { bias: "평균단가 집착", trap: "내 매수가를 회복하는 것을 투자 목표로 착각", counter: "오늘 처음 본 종목이라면 살지부터 다시 질문" },
      { bias: "낙관적 과신", trap: "AI라는 큰 흐름이 모든 실적 미스를 상쇄한다고 믿음", counter: "수요·가격·현금흐름 세 숫자로 낙관을 검증" },
    ],
    path: [6023.66, 5900, 5750, 5650, 5480, 5380, 5300, 5230, 5180, 5150, 5180, 5190],
    events: [
      { week: "8/4 전후", category: "실적", title: "SK하이닉스 실적 미스 또는 보수적 가이던스", body: "컨센서스 64.1조원 하회가 확인되면 HBM 수요와 메모리 가격 추정치가 함께 낮아집니다.", impact: "-5.5%" },
      { week: "8/11 전후", category: "빅테크·AI", title: "AI CapEx 수익성 검증 국면", body: "Microsoft·Meta가 투자 확대보다 회수 속도를 강조하면 반도체 밸류에이션 재평가가 지연되고 2주 중심값은 5,300까지 낮아질 수 있습니다.", impact: "-9.8%" },
      { week: "8/28 전후", category: "산업", title: "CXMT 경쟁 우려와 이익 추정치 하향", body: "중국 메모리 공급 확대 우려가 지속되면 1개월 중심값 5,190, 하단 4,600까지 열어둡니다.", impact: "-13.8%" },
    ],
    agentInsights: [
      { role: "뉴스 수집가", title: "실적 확인 뒤에도 남는 공급 경쟁", body: "CXMT 공급 확대 우려와 AI 투자수익성 논란이 실적 발표 이후에도 이어지는지 확인합니다." },
      { role: "애널리스트", title: "이익 추정치와 멀티플 동반 하향", body: "컨센서스 하회가 확인되면 HBM 수요와 메모리 가격 전망이 낮아져 지수 상단이 함께 낮아집니다." },
      { role: "퀀트 트레이더", title: "하락 추세 속 단기 반등", body: "과매도에 따른 기술적 반등은 가능하지만 5일·10일·20일 이동평균 아래에서는 추세 전환으로 보기 어렵습니다." },
    ],
    riskPoints: ["SK하이닉스 가이던스가 컨센서스를 밑도는 경우", "빅테크가 CapEx 확대보다 회수 속도를 강조하는 경우", "메모리 공급 경쟁이 예상보다 빨라지는 경우"],
  },
  {
    id: "risk-off",
    title: "외국인 매도·원화 약세 재확산",
    duration: "1개월",
    tags: ["외국인 순매도", "원·달러·금리"],
    forecast: "KOSPI -8.7%",
    tone: "down",
    image: `${scenarioAssetBase}/risk-off.png`,
    summary:
      "외국인 매도가 3~5거래일 이상 이어지고 원화 약세가 재확산되는 조건부 충격 경로입니다. 한국은행이 기준금리를 2.75%로 올린 가운데 미국 금리·에너지·지정학 리스크가 겹치면 위험 프리미엄과 선물 베이시스가 동시에 악화될 수 있습니다. 7월 28일처럼 프로그램 매매 중단과 레버리지 포지션 청산이 반복되는 수급형 시나리오라 뉴스 40% · 애널리스트 20% · 퀀트 40%를 적용합니다.",
    thesis: "이 경로의 핵심은 기업 실적이 아니라 돈의 방향입니다. 외국인·환율·금리가 동시에 위험 회피를 가리키면 좋은 종목도 먼저 현금화 대상이 됩니다.",
    context: "외국인 순매도와 원화 약세가 한 번 겹친 뒤에는 뉴스 하나가 아니라 포지션 청산의 연쇄가 시장을 움직입니다. 이 시나리오는 충격을 맞히기보다, 언제 방어 모드로 바꿔야 하는지 연습하는 교육용 경로입니다.",
    chapters: [
      { title: "1장 · 첫 신호는 지수보다 환율과 수급에 나온다", body: "현물과 선물에서 외국인 매도가 3거래일 이상 이어지고 원·달러 환율이 다시 오르면 대형주에 붙어 있던 위험 프리미엄이 빠르게 빠질 수 있습니다. 지수가 이미 하락한 뒤 따라가기보다, 순매수·환율·선물 베이시스의 방향을 먼저 기록합니다.", evidence: "1주 중심값 5,650 · 외국인 순매도 3거래일 이상" },
      { title: "2장 · 금리와 에너지는 할인율을 바꾼다", body: "미국 금리와 에너지 가격이 함께 오르면 기업 이익이 그대로여도 미래 현금흐름의 현재가치가 낮아집니다. 성장주와 고밸류 종목이 먼저 흔들리고, 반도체 대형주가 지수 변동성을 키울 수 있습니다.", evidence: "2주 중심값 5,525 · 할인율·위험 프리미엄 동반 상승" },
      { title: "3장 · 프로그램 매매가 하락을 증폭하는 순간", body: "변동성이 커지면 레버리지 포지션 청산과 프로그램 매도가 같은 방향으로 겹칩니다. 이때 장중 저점을 맞히려는 시도는 유동성 부족으로 더 불리해질 수 있어, 현금·분할·손실한도라는 사전 규칙이 중요해집니다.", evidence: "1개월 중심값 5,500 · 하단 4,900까지의 충격 밴드" },
      { title: "4장 · 개인 투자자는 방어를 소극성으로 오해하지 않는다", body: "방어 모드는 시장을 포기하는 행동이 아니라 판단을 늦춰 선택권을 지키는 행동입니다. 수급이 안정되고 환율이 꺾인 뒤에도 첫 반등을 바로 추격하지 말고, 금리와 변동성이 함께 낮아지는지 확인한 뒤 노출을 다시 늘립니다.", evidence: "반증 신호: 외국인 순매수 전환 · 원화 안정 · 변동성 하락" },
    ],
    investorGuide: [
      { stance: "위험 신호", action: "현금·단기채 비중을 늘리고 레버리지 축소", rationale: "하락장에서 생존하면 반등 시 선택권을 보존할 수 있습니다." },
      { stance: "충격 진행", action: "가격보다 유동성과 손실한도를 관리", rationale: "프로그램 매매가 겹치는 구간에서는 좋은 종목도 함께 매도될 수 있습니다." },
      { stance: "안정 확인", action: "수급·환율·금리 세 축을 확인하며 천천히 복귀", rationale: "첫 반등보다 위험 프리미엄이 실제로 낮아졌는지가 중요합니다." },
    ],
    studyGuide: [
      { topic: "환율과 외국인", question: "원화 약세가 외국인 주식 매도와 기업 이익에 어떻게 연결되는가?" },
      { topic: "할인율", question: "미국 10년물 금리 변화가 성장주 가치에 미치는 영향은 무엇인가?" },
      { topic: "변동성·포지션", question: "사이드카·선물 베이시스·레버리지 청산은 어떤 순서로 나타나는가?" },
    ],
    biasChecks: [
      { bias: "처분 효과", trap: "오른 종목은 팔고 떨어진 종목만 끝까지 보유", counter: "지금 처음 산다면 보유할지 동일한 기준으로 평가" },
      { bias: "군집 행동", trap: "모두가 매도할 때 이유 없이 따라가거나 반대로 버팀", counter: "수급·환율·금리라는 세 지표로 내 판단을 분리" },
      { bias: "통제 착각", trap: "장중 저점과 반등 시점을 맞힐 수 있다고 믿음", counter: "사전 손실한도와 재진입 조건을 먼저 정하고 실행" },
    ],
    path: [6023.66, 5920, 5780, 5650, 5600, 5550, 5525, 5480, 5460, 5480, 5490, 5500],
    events: [
      { week: "8/1 전후", category: "수급·환율", title: "외국인 순매도 3거래일 이상 지속", body: "현물과 선물에서 매도가 겹치고 원·달러 환율이 상승하면 1주 중심값 5,650을 시험합니다.", impact: "-3.2%" },
      { week: "8/8 전후", category: "금리·매크로", title: "금리·에너지·지정학 리스크 재부각", body: "할인율과 위험 프리미엄이 함께 올라 대형주 중심의 반등 시도가 제한되고 2주 중심값은 5,525를 가리킵니다.", impact: "-6.1%" },
      { week: "8/28 전후", category: "변동성", title: "레버리지 청산과 프로그램 매매 재충격", body: "사이드카·서킷브레이커가 반복되면 1개월 중심값 5,500, 하단 4,900까지 열어둡니다.", impact: "-8.7%" },
    ],
    agentInsights: [
      { role: "뉴스 수집가", title: "수급과 환율이 만드는 충격", body: "현물·선물 동반 매도와 원화 약세가 겹치면 대형주 중심의 위험 회피가 빠르게 번질 수 있습니다." },
      { role: "애널리스트", title: "할인율 상승과 위험 프리미엄", body: "미국 금리와 에너지 가격이 동시에 오르면 실적보다 할인율 변화가 지수 방향을 먼저 결정합니다." },
      { role: "퀀트 트레이더", title: "변동성 확대와 포지션 청산", body: "변동성 급등 구간에서는 레버리지 포지션 청산이 하락을 증폭시키고 장중 회복을 어렵게 만듭니다." },
    ],
    riskPoints: ["외국인 순매도가 3~5거래일 이상 지속되는 경우", "원·달러 환율과 미국 금리가 함께 상승하는 경우", "프로그램 매매 중단과 레버리지 청산이 재발하는 경우"],
  },
];

const chapterLessonMap: Record<string, string[]> = {
  "kospi-rebound": [
    "기초 개념 · KOSPI는 국내 주요 상장사의 움직임을 하나의 숫자로 압축한 지수입니다. 지수가 하루 반등했다고 해서 기업의 이익 전망까지 바로 좋아진 것은 아니므로, ‘가격의 방향’과 ‘돈이 들어오는 이유’를 나눠서 봐야 합니다. 개인 투자자는 종가보다 외국인 현물·선물 수급, 원·달러 환율, 거래대금이 같은 방향으로 움직이는지를 먼저 기록해 보세요.",
    "기초 개념 · 컨센서스는 여러 증권사가 예상한 이익의 평균이고, 가이던스는 회사가 직접 제시하는 다음 분기 힌트입니다. 실제 이익이 예상보다 좋아도 가이던스가 낮아지면 주가는 오를 재료를 잃을 수 있습니다. 숫자를 볼 때는 ‘이번 분기 실적 → 다음 분기 전망 → HBM 가격과 출하량’의 순서로 한 줄씩 연결해 읽는 연습이 필요합니다.",
    "기초 개념 · AI CapEx는 빅테크가 데이터센터·GPU·네트워크에 쓰는 자본적 지출이며, 메모리 기업에는 미래 주문의 선행 신호입니다. 다만 투자액이 커지는 것과 실제 매출·현금흐름이 늘어나는 것은 시간 차가 있습니다. PER은 이익 대비 주가의 배수이므로, 이익 추정치와 배수가 함께 올라갈 때만 지수의 반등이 오래가는지 확인해야 합니다.",
    "기초 개념 · 조건부 전망은 맞히는 예언이 아니라, ‘어떤 신호가 나오면 판단을 바꿀지’를 미리 적는 도구입니다. 세 관문 중 하나라도 깨지면 반등 확률을 낮추고, 두세 개가 동시에 맞을 때만 노출을 조금씩 늘리는 식으로 행동을 설계할 수 있습니다. 이렇게 기준을 숫자로 남기면 상승장에서 생기는 FOMO와 사후 합리화를 줄이는 데 도움이 됩니다.",
  ],
  "chip-miss": [
    "기초 개념 · 실적 미스는 회사가 적자를 냈다는 뜻이 아니라, 시장이 기대한 숫자보다 실제 숫자가 낮았다는 뜻입니다. 주가는 이미 미래의 좋은 뉴스까지 선반영하므로 작은 미스도 큰 조정으로 이어질 수 있습니다. 발표 전에는 컨센서스, 회사 가이던스, 직전 분기 대비 변화율을 표로 적어 두면 놀람을 줄일 수 있습니다.",
    "기초 개념 · CapEx의 핵심은 금액 자체보다 그 돈이 서버·GPU·메모리 매출로 전환되는 속도입니다. 빅테크가 투자 확대를 말해도 수익성 검증과 감가상각 부담을 강조하면 공급사의 프리미엄은 낮아질 수 있습니다. 개인 투자자는 ‘투자액 증가율, 데이터센터 가동률, 메모리 주문 가시성’ 세 지표를 함께 확인해 보세요.",
    "기초 개념 · 메모리 산업은 가격이 조금만 바뀌어도 재고와 마진이 크게 흔들리는 경기순환 산업입니다. 공급 경쟁이 심해지면 제품 가격이 내려가고, 가격 하락은 매출보다 빠르게 영업이익을 줄일 수 있습니다. 그래서 과거 고점의 이익을 그대로 적용하기보다 정상화된 마진과 경쟁사의 출하 계획을 기준으로 기업가치를 다시 계산해야 합니다.",
    "기초 개념 · ‘싸졌다’는 가격이 내렸다는 사실이고, ‘싸게 보인다’는 미래 이익까지 낮아진 뒤에도 저평가라는 판단입니다. 평균단가를 낮추려는 행동은 손실 회피와 기준점 편향을 키울 수 있습니다. 처음 보는 종목이라고 가정하고, 실적 추정치가 두 번 연속 하향되는 동안에도 새로 살 것인지 스스로 질문해 보세요.",
  ],
  "risk-off": [
    "기초 개념 · 외국인 수급은 한국 주식시장에 들어오고 나가는 큰 자금의 방향을 보여주는 지표입니다. 원화 약세가 겹치면 외국인 입장에서는 주가가 그대로여도 환차손이 커져 매도 유인이 생깁니다. 지수 차트만 보지 말고 현물·선물 순매수, 원·달러, 선물 베이시스를 한 화면에서 같은 시간축으로 확인해 보세요.",
    "기초 개념 · 할인율은 미래의 이익을 오늘 가치로 바꿀 때 적용하는 금리입니다. 미국 10년물 금리와 에너지 가격이 오르면 안전자산 선호와 비용 부담이 동시에 커져 성장주의 현재가치가 낮아질 수 있습니다. 숫자를 볼 때는 금리 방향 하나보다 ‘금리 상승 + 달러 강세 + 위험 프리미엄 확대’가 함께 나타나는지 살피는 것이 중요합니다.",
    "기초 개념 · 프로그램 매매는 여러 종목을 규칙에 따라 한꺼번에 사고파는 거래이고, 레버리지 청산은 빌린 돈으로 투자한 포지션을 강제로 줄이는 과정입니다. 두 흐름이 같은 방향으로 겹치면 기업 뉴스보다 유동성이 가격을 움직이는 시간이 생깁니다. 이런 구간에서는 장중 저점을 맞히려 하기보다 현금 비중, 손실 한도, 재진입 조건을 미리 정해 두는 편이 안전합니다.",
    "기초 개념 · 방어 모드는 시장을 포기하는 것이 아니라 다시 선택할 수 있는 시간을 사는 행동입니다. 외국인 수급이 안정되고 환율이 꺾인 뒤에도 하루 반등만으로 위험이 끝났다고 결론 내리지 말아야 합니다. 변동성 하락과 금리 안정까지 확인한 뒤 노출을 단계적으로 복원하면 군집 행동과 통제 착각을 줄일 수 있습니다.",
  ],
};

type ScenarioArticle = {
  title: string;
  lead: string;
  metrics: { label: string; value: string; note: string }[];
  sections: { title: string; paragraphs: string[]; takeaway: string }[];
};

const scenarioArticleMap: Record<string, ScenarioArticle> = {
  "kospi-rebound": {
    title: "KOSPI 조건부 반등을 읽는 법",
    lead: "이 시나리오는 ‘급락했으니 곧 오른다’는 낙관론이 아닙니다. 시장이 기대를 다시 쌓는 과정을 외국인 수급, 반도체 이익, 빅테크 투자라는 세 개의 연결 고리로 나눠서 읽는 학습용 리포트입니다.",
    metrics: [
      { label: "출발 지수", value: "6,023.66", note: "7/28 종가 · 전일 대비 -10.84%" },
      { label: "1주 중심값", value: "6,650", note: "외국인 수급과 실적 확인" },
      { label: "1개월 중심값", value: "7,500", note: "CapEx·멀티플 재평가" },
      { label: "핵심 확인", value: "3개 관문", note: "수급 · 이익 · 투자 지속성" },
    ],
    sections: [
      {
        title: "1. 급락 뒤 반등은 숫자보다 ‘확인 순서’가 중요합니다",
        paragraphs: [
          "7월 28일 KOSPI의 급락은 한 기업의 악재라기보다 외국인 대규모 매도, 반도체주 조정, AI 투자수익성 논란이 같은 날 겹친 결과로 해석할 수 있습니다. 이런 날에는 다음 날 양봉 하나가 바닥을 증명하지 않습니다. 가격은 가장 먼저 움직이지만, 추세를 바꾸는 돈은 며칠에 걸쳐 들어오기 때문입니다.",
          "따라서 첫 번째 질문은 ‘얼마나 반등했나’가 아니라 ‘누가 사고 있는가’입니다. 현물과 선물에서 외국인 순매수가 3~5거래일 이어지고 원·달러 환율이 안정되면, 급한 청산이 멈추고 다시 위험을 감수할 자금이 생겼다고 볼 수 있습니다. 이 순서를 이해하면 반등 초기에 무작정 따라붙는 대신, 확인할 데이터와 기다릴 시간을 스스로 정할 수 있습니다.",
        ],
        takeaway: "공부 포인트 · 지수 차트 옆에 외국인 현물·선물, 환율, 거래대금을 같은 날짜로 기록해 보세요.",
      },
      {
        title: "2. HBM과 AI CapEx는 어떻게 KOSPI로 전달될까요?",
        paragraphs: [
          "HBM은 GPU가 계산할 데이터를 빠르게 공급하는 초고속 메모리입니다. GPU를 엔진이라고 하면 HBM은 엔진에 연료를 밀어 넣는 분사 장치에 가깝습니다. 그래서 AI 데이터센터가 늘어날수록 HBM의 용량과 대역폭에 대한 주문이 늘고, 공급사는 가격과 출하량을 통해 이익을 얻게 됩니다.",
          "하지만 빅테크의 투자 발표가 곧바로 국내 기업의 이익이 되는 것은 아닙니다. Microsoft와 Meta가 말한 CapEx가 실제 서버 설치와 메모리 주문으로 이어지는지, SK하이닉스가 다음 분기에도 높은 마진을 유지할 수 있는지 확인해야 합니다. 이 연결 고리가 확인될 때 낮은 PER이 다시 평가되고, 실적 증가와 투자자들의 지불 의향이 겹치면서 지수의 반등 폭이 커집니다.",
        ],
        takeaway: "공부 포인트 · CapEx 금액만 보지 말고 증가율, 감가상각, HBM 출하·가격을 한 묶음으로 읽으세요.",
      },
      {
        title: "3. 개인 투자자는 반등을 어떻게 연습할까요?",
        paragraphs: [
          "조건부 전망을 사용할 때 가장 중요한 것은 목표가를 맞히는 일이 아니라 반증 신호를 미리 정하는 일입니다. 외국인 순매수가 다시 꺾이거나, 실적 가이던스가 낮아지거나, 빅테크가 AI 투자를 비용 통제로 바꾸면 이 시나리오의 확률은 즉시 낮아집니다. 그 순간에는 ‘내가 틀렸다’고 인정하는 것이 손실을 키우지 않는 행동입니다.",
          "반대로 세 조건이 순서대로 확인되면 한 번에 베팅하기보다 1주·2주·1개월의 시간축을 나눠 판단할 수 있습니다. 이 방식은 상승장에서 생기는 FOMO를 줄이고, 뉴스 하나에 확신이 흔들리는 대신 스스로 만든 체크리스트로 결정을 내리게 도와줍니다.",
        ],
        takeaway: "공부 포인트 · 매수 전에 ‘조건 충족’, ‘조건 보류’, ‘조건 이탈’의 행동을 세 줄로 써 보세요.",
      },
    ],
  },
  "chip-miss": {
    title: "반도체 실적 미스와 AI CapEx 둔화를 읽는 법",
    lead: "좋은 산업의 주식도 기대가 너무 높아지면 실적 발표 하나로 재평가를 받습니다. 이 시나리오는 HBM 수요가 사라진다는 이야기가 아니라, 기대·가이던스·공급 경쟁이 순서대로 이익의 바닥을 다시 계산하는 과정을 설명합니다.",
    metrics: [
      { label: "출발 지수", value: "6,023.66", note: "7/28 종가 · 급락 이후" },
      { label: "1주 중심값", value: "5,900", note: "컨센서스 하회 확인" },
      { label: "1개월 중심값", value: "5,190", note: "수요·마진 동반 재평가" },
      { label: "핵심 확인", value: "3개 단서", note: "가이던스 · CapEx · 공급" },
    ],
    sections: [
      {
        title: "1. 실적 발표에서 가장 먼저 읽을 것은 가이던스입니다",
        paragraphs: [
          "컨센서스는 시장이 합의한 기대치이기 때문에, 실제 영업이익이 흑자인지보다 그 기대를 넘었는지가 주가에 더 큰 영향을 줍니다. 특히 HBM처럼 시장이 빠르게 성장한다고 믿는 산업에서는 ‘이번 분기 숫자’보다 ‘다음 분기에도 같은 속도로 팔 수 있는가’가 가격에 먼저 반영됩니다.",
          "SK하이닉스가 컨센서스 64.1조원을 밑돌거나 가이던스를 보수적으로 제시하면, 투자자는 수요가 꺾였는지 아니면 생산·원가 문제인지 구분해야 합니다. 회사의 설명에서 출하량, 평균판매가격, 재고, 다음 분기 주문을 따로 적어 보면 단순한 숫자 미스와 구조적인 수요 둔화를 구분하는 데 도움이 됩니다.",
        ],
        takeaway: "공부 포인트 · 실적표를 볼 때 ‘실제치-컨센서스-다음 분기 가이던스’를 한 줄에 나란히 적으세요.",
      },
      {
        title: "2. AI CapEx가 줄면 메모리 가격도 바로 내려갈까요?",
        paragraphs: [
          "빅테크가 AI 인프라 투자를 늦춘다고 해서 메모리 수요가 즉시 사라지는 것은 아닙니다. 데이터센터 건설에는 주문과 설치 사이의 시차가 있고, 이미 계약된 물량도 있기 때문입니다. 다만 투자 증가율이 낮아지면 공급사들이 미래 주문을 근거로 붙였던 프리미엄부터 먼저 줄어들 수 있습니다.",
          "이때 시장은 CapEx의 총액보다 투자 효율을 묻습니다. GPU 사용률이 오르는지, 서비스 매출이 늘어나는지, 감가상각 부담을 감당할 현금흐름이 있는지에 따라 다음 주문의 속도가 달라집니다. 개인 투자자는 ‘투자 발표’와 ‘매출 전환’ 사이의 시간을 기다리는 연습을 해야 합니다.",
        ],
        takeaway: "공부 포인트 · 빅테크 실적 발표에서 CapEx, 데이터센터 매출, 감가상각비를 함께 찾아보세요.",
      },
      {
        title: "3. 공급 경쟁은 기업의 ‘정상 이익’을 다시 묻게 합니다",
        paragraphs: [
          "메모리는 가격 변동이 큰 경기순환 산업입니다. CXMT의 공급 확대가 실제 경쟁으로 받아들여지면 시장은 과거 고점의 마진을 미래에도 적용하지 않고, 가격 하락과 점유율 변화를 반영해 정상화된 이익을 다시 계산합니다. 주가가 많이 내려도 이익 추정치가 더 빠르게 내려가면 밸류에이션은 오히려 비싸질 수 있습니다.",
          "따라서 ‘AI라는 큰 흐름이 있으니 언젠가 회복한다’는 문장만으로 평균단가를 낮추면 안 됩니다. 공급사의 증설 속도, 고객 인증 기간, HBM 세대 전환, 메모리 가격의 방향을 확인하면서 회복의 근거를 쌓아야 합니다. 이런 자료를 직접 찾아보는 과정이 낙관적 과신을 줄이는 가장 좋은 훈련입니다.",
        ],
        takeaway: "공부 포인트 · 매출·마진·점유율을 각각 따로 적고, 세 숫자가 같은 방향인지 확인하세요.",
      },
    ],
  },
  "risk-off": {
    title: "외국인 매도와 원화 약세를 읽는 법",
    lead: "이 시나리오의 질문은 ‘어떤 종목이 좋은가’가 아니라 ‘좋은 종목도 왜 함께 팔리는가’입니다. 돈의 방향, 환율, 금리, 레버리지 청산이 한 방향으로 겹칠 때 시장이 방어 모드로 바뀌는 과정을 초보자도 따라갈 수 있도록 정리했습니다.",
    metrics: [
      { label: "출발 지수", value: "6,023.66", note: "7/28 종가 · 위험 회피 확대" },
      { label: "1주 중심값", value: "5,650", note: "수급·환율 동반 악화" },
      { label: "1개월 중심값", value: "5,500", note: "청산·변동성 재충격" },
      { label: "핵심 확인", value: "3축", note: "외국인 · 환율 · 금리" },
    ],
    sections: [
      {
        title: "1. 외국인이 팔면 왜 KOSPI가 더 크게 흔들릴까요?",
        paragraphs: [
          "외국인 투자자는 한국 주식의 수익률뿐 아니라 원화로 바꿨을 때의 환차익까지 함께 계산합니다. 원·달러 환율이 오르면 원화 자산의 달러 가치가 줄어들기 때문에, 주가가 그대로여도 위험을 줄이려는 매도가 나올 수 있습니다. 대형주와 선물에 집중된 자금이 움직이면 지수 전체가 개별 기업의 실적보다 먼저 반응합니다.",
          "현물과 선물 순매도가 며칠 이어지는지, 선물 베이시스가 약해지는지, 환율이 같은 시간에 오르는지를 함께 보세요. 이 세 지표가 같은 방향이면 단순한 하루 조정이 아니라 포지션을 줄이는 흐름일 수 있습니다. 숫자를 묶어서 보는 습관이 공포 뉴스에 휩쓸리지 않게 해 줍니다.",
        ],
        takeaway: "공부 포인트 · 환율 차트와 외국인 순매수 표를 같은 날짜로 겹쳐 보며 상관관계를 직접 적어보세요.",
      },
      {
        title: "2. 금리와 에너지는 기업의 현재가치를 어떻게 바꿀까요?",
        paragraphs: [
          "할인율은 미래에 벌 돈을 오늘의 가치로 환산할 때 쓰는 금리입니다. 미국 10년물 금리가 오르면 먼 미래의 성장 기대가 큰 기업일수록 현재가치가 더 많이 낮아지고, 에너지 가격이 오르면 제조업의 비용 부담까지 커집니다. 실적이 당장 변하지 않아도 주가가 먼저 조정받는 이유가 여기에 있습니다.",
          "금리 한 가지를 보고 공포에 빠지기보다 금리 상승, 달러 강세, 위험 프리미엄 확대가 동시에 나타나는지 확인해야 합니다. 세 요인이 겹치면 좋은 종목과 나쁜 종목을 가르는 분석보다 현금흐름과 부채가 튼튼한지를 먼저 보는 방어적 분석이 유효해집니다.",
        ],
        takeaway: "공부 포인트 · 금리 변화가 성장주·은행주·수출주에 각각 어떤 방향으로 작용하는지 비교표를 만들어 보세요.",
      },
      {
        title: "3. 방어 모드는 시장을 포기하는 행동이 아닙니다",
        paragraphs: [
          "프로그램 매매와 레버리지 청산이 겹치는 날에는 기업의 적정가치를 계산할 시간보다 유동성을 확보하는 속도가 중요해집니다. 장중 저점을 맞히려는 시도는 거래량이 부족한 구간에서 불리한 가격으로 체결될 가능성을 키울 수 있습니다. 그래서 방어 모드는 현금·단기채·분할 매수라는 선택권을 남겨두는 전략입니다.",
          "외국인 수급이 돌아오고 환율이 안정되어도 첫 반등을 곧바로 추세 전환으로 해석하지 마세요. 변동성이 낮아지고 금리 방향이 안정되는지 확인한 뒤 노출을 단계적으로 복원하면, ‘남들도 사니까 나도 사야 한다’는 군집 행동과 ‘내가 맞힐 수 있다’는 통제 착각을 줄일 수 있습니다.",
        ],
        takeaway: "공부 포인트 · 매수보다 먼저 손실 한도와 재진입 조건을 숫자로 정해두는 연습을 해보세요.",
      },
    ],
  },
};

function ScenarioLearningArticle({ scenario }: { scenario: Scenario }) {
  const article = scenarioArticleMap[scenario.id] ?? scenarioArticleMap["kospi-rebound"];
  const min = Math.min(...scenario.path);
  const max = Math.max(...scenario.path);
  const span = Math.max(1, max - min);

  return (
    <section className="scenario-learning-article" aria-label="시나리오 학습 리포트">
      <header className="scenario-learning-header">
        <span>LEARNING REPORT · BEGINNER FRIENDLY</span>
        <h3>{article.title}</h3>
        <p>{article.lead}</p>
      </header>
      <div className="scenario-learning-overview">
        <div className="scenario-learning-table-wrap">
          <div className="scenario-learning-label">숫자로 먼저 읽기</div>
          <table className="scenario-learning-table">
            <thead><tr><th>지표</th><th>현재·예상</th><th>이 숫자가 뜻하는 것</th></tr></thead>
            <tbody>{article.metrics.map((metric) => <tr key={metric.label}><th scope="row">{metric.label}</th><td>{metric.value}</td><td>{metric.note}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="scenario-learning-chart-card">
          <div className="scenario-learning-label">조건부 경로 그래프</div>
          <div className={`scenario-mini-chart ${scenario.tone}`} role="img" aria-label={`${scenario.title} 예상 경로 막대 그래프`}>
            {scenario.path.map((value, index) => <div className="scenario-mini-column" key={`${scenario.id}-bar-${index}`}><span style={{ height: `${24 + ((value - min) / span) * 68}%` }} /><small>{index === 0 ? "현재" : index === scenario.path.length - 1 ? "1개월" : ""}</small></div>)}
          </div>
          <p className="scenario-chart-note">현재 지수에서 시나리오 중심값까지의 상대적 경로입니다. 실제 값이 아니라 조건부 비교를 위한 교육용 그래프입니다.</p>
        </div>
      </div>
      <div className="scenario-learning-sections">
        {article.sections.map((section, index) => <article key={section.title} className="scenario-learning-section"><div className="scenario-learning-section-index">0{index + 1}</div><div><h4>{section.title}</h4>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<div className="scenario-learning-takeaway"><strong>학습 메모</strong><span>{section.takeaway}</span></div></div></article>)}
      </div>
    </section>
  );
}

function ScenarioDetailLearning({ scenario }: { scenario: Scenario }) {
  return (
    <div className="scenario-modal-learning">
      <section className="scenario-narrative" aria-label="시나리오 상세 전개">
        <div className="scenario-detail-label">시나리오를 읽는 순서</div>
        <div className="scenario-narrative-list">
          {scenario.chapters.map((chapter, index) => <article key={`${scenario.id}-${chapter.title}`} className="scenario-narrative-card"><div className="scenario-narrative-index">0{index + 1}</div><div><h4>{chapter.title}</h4><p>{chapter.body}</p>{chapterLessonMap[scenario.id]?.[index] && <p className="scenario-narrative-lesson">{chapterLessonMap[scenario.id][index]}</p>}<span>{chapter.evidence}</span></div></article>)}
        </div>
      </section>

      <ScenarioLearningArticle scenario={scenario} />

      <section className="scenario-decision-grid" aria-label="개인 투자자 학습 가이드">
        <article className="scenario-decision-panel"><div className="scenario-detail-label">개인 투자자의 선택지</div><p className="scenario-section-note">예측을 따라 하기보다 조건이 바뀔 때 어떤 행동을 선택할지 미리 적어보세요.</p><div className="scenario-choice-list">{scenario.investorGuide.map((guide) => <div key={`${scenario.id}-${guide.stance}`} className="scenario-choice-row"><strong>{guide.stance}</strong><div><h4>{guide.action}</h4><p>{guide.rationale}</p></div></div>)}</div></article>
        <article className="scenario-decision-panel"><div className="scenario-detail-label">다음에 공부할 질문</div><p className="scenario-section-note">이 시나리오의 숫자를 직접 검증할 수 있는 질문입니다.</p><div className="scenario-study-list">{scenario.studyGuide.map((study) => <div key={`${scenario.id}-${study.topic}`}><span>{study.topic}</span><p>{study.question}</p></div>)}</div></article>
      </section>

      <section className="scenario-bias-section" aria-label="인지 편향 체크"><div className="scenario-detail-label">판단 전, 인지 편향 체크</div><p className="scenario-section-note">같은 뉴스도 내 포지션과 기대에 따라 다르게 보입니다. 아래 함정을 먼저 확인하세요.</p><div className="scenario-bias-grid">{scenario.biasChecks.map((item) => <article key={`${scenario.id}-${item.bias}`} className="scenario-bias-card"><span>{item.bias}</span><strong>{item.trap}</strong><p><b>대응:</b> {item.counter}</p></article>)}</div></section>
    </div>
  );
}

function fallbackEditorial(scenario: Scenario): ScenarioEditorial {
  return {
    ui: { theme: scenario.tone === "up" ? "sunny" : "cobalt", rhythm: "playful" },
    badge: "TODAY'S MONEY STORY · 5 CUTS",
    headline: scenario.thesis,
    subhead: `숫자만 보면 어렵지만, 순서대로 넘기면 보입니다. ${scenario.duration}의 조건과 반증 신호를 5장으로 읽어보세요.`,
    cards: [
      {
        kicker: "01 · ONE-LINE THESIS",
        title: scenario.title,
        body: scenario.context,
        stat: scenario.forecast,
        statLabel: `${scenario.duration} 조건부 중심 경로`,
        layout: "hero",
        visual: "market-path",
      },
      ...scenario.events.slice(0, 3).map((event, index) => ({
        kicker: `0${index + 2} · ${event.category}`,
        title: event.title,
        body: event.body,
        stat: event.impact,
        statLabel: event.week,
        layout: (["split", "reverse", "spotlight"] as const)[index],
        visual: (["capital-flow", "earnings", "calendar"] as const)[index],
      })),
      {
        kicker: "05 · INVALIDATION",
        title: "이 세 신호가 깨지면 시나리오를 다시 쓸 때입니다",
        body: scenario.riskPoints.join(" · "),
        stat: `${scenario.riskPoints.length} SIGNALS`,
        statLabel: "예측보다 먼저 확인할 반증 조건",
        layout: "stacked",
        visual: "risk-radar",
      },
    ],
    explanation: {
      title: `${scenario.title}을 판단의 순서로 읽는 법`,
      lead: scenario.thesis,
      paragraphs: [scenario.summary, scenario.context],
    },
  };
}

function EditorialIllustration({
  card,
  scenario,
  index,
}: {
  card: ScenarioEditorial["cards"][number];
  scenario: Scenario;
  index: number;
}) {
  if (card.visual === "market-path") return (
    <div className="story-image-visual">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={scenario.image} alt={`${scenario.title} 시나리오 일러스트`} />
      <div className="story-image-bars" aria-hidden="true">{scenario.path.slice(0, 8).map((value, pathIndex, values) => {
        const min = Math.min(...values);
        const max = Math.max(...values);
        return <i key={`${scenario.id}-story-bar-${pathIndex}`} style={{ height: `${20 + ((value - min) / Math.max(1, max - min)) * 80}%` }} />;
      })}</div>
    </div>
  );

  if (card.visual === "capital-flow") return (
    <div className="story-flow-visual" aria-label="자금 흐름 그림">
      <span>외국인</span><b>→</b><span>수급</span><b>→</b><span>KOSPI</span>
    </div>
  );

  if (card.visual === "earnings") return (
    <div className="story-earnings-visual" aria-label="실적 전달 경로 그림">
      <span>HBM</span><span>실적</span><span>가이던스</span><strong>{card.stat}</strong>
    </div>
  );

  if (card.visual === "calendar") return (
    <div className="story-calendar-visual" aria-label="시나리오 일정 그림">
      <span>CHECK DAY</span><strong>{card.statLabel}</strong><i>{card.stat}</i>
    </div>
  );

  return (
    <div className="story-radar-visual" aria-label="반증 신호 레이더 그림">
      <i /><i /><i /><span>!</span><strong>{String(index + 1).padStart(2, "0")}</strong>
    </div>
  );
}

function PremiumScenarioBrief({
  scenario,
  editorial,
  state,
  meta,
}: {
  scenario: Scenario;
  editorial: ScenarioEditorial;
  state: EditorialState;
  meta: { generatedAt: string; model: string } | null;
}) {
  return (
    <div className="premium-brief">
      <header className="premium-brief-intro">
        <div>
          <span>{editorial.badge}</span>
          <h2>{editorial.headline}</h2>
          <p>{editorial.subhead}</p>
        </div>
        <div className={`premium-ai-status ${state}`} aria-live="polite">
          <Sparkles size={14} />
          <span>{state === "loading" ? "DeepSeek 편집 중" : state === "ready" ? "DeepSeek 에디토리얼" : "안전 프리뷰"}</span>
        </div>
      </header>

      <section className={`daily-story theme-${editorial.ui.theme} rhythm-${editorial.ui.rhythm}`} aria-label={`${scenario.title} 매일 카드뉴스`}>
        <div className="card-news-label"><span>DAILY CARD STORY · 5 SCENES</span><small>오늘 시장에 맞춰 DeepSeek가 레이아웃과 그림을 골랐어요</small></div>
        <div className="daily-story-stack">
          {editorial.cards.map((card, index) => (
            <article className={`daily-story-card layout-${card.layout} visual-${card.visual}`} key={`${scenario.id}-${card.kicker}`}>
              <div className="daily-card-art">
                <EditorialIllustration card={card} scenario={scenario} index={index} />
              </div>
              <div className="daily-card-copy">
                <div className="editorial-card-top"><span>{card.kicker}</span><b>0{index + 1}</b></div>
                <div className="editorial-stat"><strong>{card.stat}</strong><span>{card.statLabel}</span></div>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <footer><span>FINVERSE DAILY</span><b>{index + 1} / 5</b></footer>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="daily-detail-report" aria-label="시나리오 상세 설명">
        <article className="daily-editor-note">
          <span>DEEP DIVE · 상세 해설</span>
          <h3>{editorial.explanation.title}</h3>
          <strong>{editorial.explanation.lead}</strong>
          {editorial.explanation.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </article>
        <div className="daily-original-report">
          <div className="daily-original-report-heading"><span>FULL REPORT</span><h3>기존 시나리오를 근거부터 판단 기준까지 이어서 읽어보세요.</h3></div>
          <ScenarioDetailLearning scenario={scenario} />
        </div>
      </section>

      <footer className="premium-brief-footer">
        <span>{state === "ready" && meta ? `OpenRouter · ${meta.model} · ${new Date(meta.generatedAt).toLocaleString("ko-KR")}` : "OpenRouter 연결 전에는 검증된 시나리오 프리뷰를 표시합니다."}</span>
        <span>실제 시장 흐름과 전제가 달라지면 결론도 함께 바뀌어야 합니다.</span>
      </footer>
    </div>
  );
}

type EnvironmentSeed = {
  id: string;
  label: string;
  category: string;
  detail: string;
};

const environmentSeeds: EnvironmentSeed[] = [
  { id: "foreign-buying", label: "외국인 순매수 회복", category: "수급", detail: "현물·선물에서 3거래일 이상 순매수 전환" },
  { id: "hynix-surprise", label: "SK하이닉스 실적 서프라이즈", category: "기업실적", detail: "영업이익 컨센서스 대비 10% 이상 상회" },
  { id: "ai-capex", label: "AI CapEx 유지·확대", category: "산업", detail: "글로벌 빅테크의 AI 인프라 투자 가이던스 유지" },
  { id: "won-weakness", label: "원·달러 1,450원 상회", category: "환율", detail: "원화 약세가 외국인 위험 프리미엄을 자극" },
  { id: "us-rates", label: "미국 금리 상승", category: "금리", detail: "미 10년물 상승으로 할인율과 변동성 확대" },
  { id: "cxmt-supply", label: "CXMT 메모리 공급 확대", category: "경쟁", detail: "중국 메모리 공급 우려로 이익 추정치 재평가" },
  { id: "exports", label: "반도체 수출 증가", category: "수출", detail: "메모리 가격과 HBM 출하량 회복 신호" },
  { id: "china-slowdown", label: "중국 경기 둔화", category: "매크로", detail: "대중 수요 둔화로 국내 대형주 위험선호 약화" },
];

type UploadedSeed = { name: string; size: number; preview?: string };
type OntologyRunState = "idle" | "running" | "complete" | "error";
type OntologyLog = { source: "system" | "stdout" | "stderr"; line: string };
type OntologyDocument = { name: string; content: string };
type MirofishRun = { simulationId: string; profileCount?: number; entityCount?: number; nodeCount?: number; edgeCount?: number; initialPostsCount?: number };
type MirofishProgress = { stage: BuildStage; percent: number; message?: string };
type OntologySchema = { entityTypes: string[]; relationTypes: string[] };
type LiveGraphSnapshot = {
  nodes: { id: string; label: string; type: string }[];
  edges: { source: string; target: string; label: string }[];
  nodeCount: number;
  edgeCount: number;
};

type SimulationAction = {
  round_num: number;
  timestamp?: string;
  platform: string;
  agent_id: number;
  agent_name: string;
  action_type: string;
  action_args: Record<string, unknown>;
  result?: unknown;
  success: boolean;
};

type SimulationRuntime = {
  simulation_id: string;
  runner_status: string;
  current_round: number;
  total_rounds: number;
  progress_percent: number;
  twitter_current_round?: number;
  reddit_current_round?: number;
  twitter_actions_count?: number;
  reddit_actions_count?: number;
  total_actions_count: number;
  env_alive?: boolean;
  recent_actions: SimulationAction[];
  active_batch?: {
    status?: "running" | "completed" | "failed";
    label?: string;
    actions_count?: number;
    completed_actions?: number;
    started_at?: string;
    elapsed_seconds?: number;
  } | null;
  started_at?: string;
  completed_at?: string;
};

type SimulationChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  model?: string;
  at?: string;
};

type SimulationSession = {
  job_id: string;
  status: string;
  query: string;
  period: string;
  simulation_id: string;
  runtime: SimulationRuntime | null;
  chat_ready: boolean;
  chat_messages: SimulationChatMessage[];
  error?: string | null;
};

type GraphPreviewNode = {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  color: string;
};

const graphPreviewNodes: GraphPreviewNode[] = [
  { id: "kospi", label: "KOSPI", type: "지수", x: 320, y: 250, color: "#0b0d14" },
  { id: "semiconductor", label: "반도체", type: "섹터", x: 162, y: 130, color: "#0769ff" },
  { id: "samsung", label: "삼성전자", type: "종목", x: 78, y: 268, color: "#0f766e" },
  { id: "hynix", label: "SK하이닉스", type: "종목", x: 135, y: 400, color: "#0f766e" },
  { id: "auto", label: "자동차", type: "섹터", x: 460, y: 90, color: "#0769ff" },
  { id: "internet", label: "인터넷", type: "섹터", x: 560, y: 180, color: "#0769ff" },
  { id: "finance", label: "금융", type: "섹터", x: 525, y: 340, color: "#0769ff" },
  { id: "hyundai", label: "현대차", type: "종목", x: 490, y: 30, color: "#0f766e" },
  { id: "naver", label: "NAVER", type: "종목", x: 615, y: 165, color: "#0f766e" },
  { id: "kb", label: "KB금융", type: "종목", x: 615, y: 355, color: "#0f766e" },
  { id: "lg-energy", label: "LG에너지솔루션", type: "종목", x: 50, y: 70, color: "#0f766e" },
  { id: "foreign", label: "외국인 수급", type: "수급", x: 310, y: 90, color: "#d97706" },
  { id: "fx", label: "원·달러", type: "환율", x: 470, y: 120, color: "#7c3aed" },
  { id: "ai", label: "AI CapEx", type: "이벤트", x: 560, y: 260, color: "#dc2626" },
  { id: "rates", label: "미국 금리", type: "금리", x: 520, y: 420, color: "#64748b" },
  { id: "exports", label: "반도체 수출", type: "수출", x: 340, y: 455, color: "#0891b2" },
  { id: "cxmt", label: "CXMT 경쟁", type: "경쟁", x: 80, y: 500, color: "#be123c" },
  { id: "memory", label: "메모리 가격", type: "지표", x: 210, y: 520, color: "#4f46e5" },
  { id: "risk", label: "위험 프리미엄", type: "리스크", x: 565, y: 520, color: "#52525b" },
  { id: "fomc", label: "FOMC 결정", type: "이벤트", x: 430, y: 510, color: "#dc2626" },
  { id: "earnings", label: "실적 발표", type: "이벤트", x: 245, y: 75, color: "#dc2626" },
  { id: "policy", label: "산업 정책", type: "규제", x: 55, y: 385, color: "#ea580c" },
  { id: "china", label: "중국 경기", type: "매크로", x: 34, y: 175, color: "#ea580c" },
  { id: "export-data", label: "수출 데이터", type: "데이터", x: 330, y: 555, color: "#0891b2" },
  { id: "valuation", label: "선행 PER", type: "밸류에이션", x: 370, y: 180, color: "#4f46e5" },
  { id: "rsi", label: "RSI14", type: "기술지표", x: 205, y: 300, color: "#4f46e5" },
  { id: "sentiment", label: "시장 심리", type: "심리", x: 390, y: 350, color: "#a21caf" },
  { id: "hbm", label: "HBM 수요", type: "수요", x: 170, y: 190, color: "#0891b2" },
  { id: "won", label: "원화 강세", type: "환율", x: 430, y: 40, color: "#7c3aed" },
];

const graphPreviewEdges = [
  ["kospi", "semiconductor", "구성"], ["kospi", "foreign", "수급영향"], ["kospi", "fx", "환율영향"],
  ["kospi", "ai", "이벤트영향"], ["kospi", "rates", "할인율"], ["kospi", "exports", "실적연결"],
  ["semiconductor", "samsung", "대표종목"], ["semiconductor", "hynix", "대표종목"], ["semiconductor", "memory", "가격연결"],
  ["semiconductor", "cxmt", "경쟁구도"], ["foreign", "samsung", "순매수"], ["foreign", "hynix", "순매수"],
  ["fx", "foreign", "자금흐름"], ["rates", "fx", "달러강세"], ["ai", "memory", "수요견인"],
  ["exports", "memory", "출하량"], ["cxmt", "memory", "공급압력"], ["rates", "risk", "위험회피"],
  ["kospi", "auto", "구성"], ["kospi", "internet", "구성"], ["kospi", "finance", "구성"],
  ["auto", "hyundai", "대표종목"], ["auto", "lg-energy", "공급망"], ["internet", "naver", "대표종목"], ["finance", "kb", "대표종목"],
  ["foreign", "auto", "순매수"], ["foreign", "internet", "순매수"], ["fx", "rates", "환율전이"], ["fx", "won", "원화강세"],
  ["ai", "hynix", "HBM수요"], ["ai", "naver", "클라우드수요"], ["rates", "finance", "조달비용"], ["rates", "valuation", "할인율"],
  ["earnings", "samsung", "실적연결"], ["earnings", "hynix", "실적연결"], ["earnings", "hyundai", "실적연결"],
  ["fomc", "rates", "금리결정"], ["fomc", "risk", "위험회피"], ["policy", "semiconductor", "지원정책"], ["policy", "auto", "보조금"],
  ["china", "cxmt", "경쟁심화"], ["china", "exports", "수요둔화"], ["export-data", "exports", "월별발표"], ["export-data", "kospi", "선행신호"],
  ["valuation", "kospi", "멀티플"], ["rsi", "kospi", "과매도"], ["sentiment", "foreign", "위험선호"], ["sentiment", "kospi", "심리"],
  ["hbm", "memory", "수요견인"], ["hbm", "hynix", "제품믹스"], ["won", "foreign", "자금유입"], ["won", "samsung", "환차익"],
] as const;

type BuildStage = 1 | 2 | 3 | 4 | 5 | 6;

function GraphGenerationPlaceholder({ stage }: { stage: BuildStage }) {
  const waitingForGraph = stage === 3;
  return <div className="graph-generation-placeholder" aria-label="시나리오 지식그래프 생성 대기 중">
    <div className="ontology-wait-icon" aria-hidden="true"><i /><i /><i /><i /></div>
    <strong>{waitingForGraph ? "Building knowledge graph..." : "Waiting for ontology generation..."}</strong>
  </div>;
}

function KnowledgeGraphPreview({ seeds, prompt, stage, progress, graphSnapshot }: { seeds: string[]; prompt: string; stage: BuildStage; progress: MirofishProgress | null; graphSnapshot: LiveGraphSnapshot | null }) {
  const graphProgress = stage === 3 ? Math.max(5, Math.min(100, progress?.stage === 3 ? progress.percent : 5)) : 100;
  const hasGraphSnapshot = Boolean(graphSnapshot?.nodes.length);
  const graphNodes = hasGraphSnapshot ? graphSnapshot!.nodes.map((node, index) => ({
    ...node,
    x: 50 + ((index * 137) % 545),
    y: 55 + ((Math.floor(index * 137 / 545) * 93 + index * 41) % 465),
    color: ["#0769ff", "#0f766e", "#7c3aed", "#dc2626", "#d97706", "#0891b2"][index % 6],
  })) : [];
  const graphEdges = hasGraphSnapshot ? graphSnapshot!.edges.map((edge) => [edge.source, edge.target, edge.label] as const) : [];
  const visibleNodeCount = graphNodes.length;
  const visibleNodes = graphNodes.slice(0, visibleNodeCount);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graphEdges.filter(([source, target]) => visibleNodeIds.has(source) && visibleNodeIds.has(target));
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() =>
    Object.fromEntries(graphNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
  );
  const [selectedNode, setSelectedNode] = useState("kospi");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ active: boolean; x: number; y: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const velocity = Object.fromEntries(visibleNodes.map((node) => [node.id, { x: 0, y: 0 }])) as Record<string, { x: number; y: number }>;
    let frame = 0;
    let last = performance.now();
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(2.5, Math.max(.3, (now - last) / 16.67));
      last = now;
      const next = Object.fromEntries(visibleNodes.map((node) => [node.id, { ...(positions[node.id] ?? { x: node.x, y: node.y }) }])) as Record<string, { x: number; y: number }>;
      visibleNodes.forEach((node, index) => {
        const current = next[node.id];
        visibleNodes.slice(index + 1).forEach((other) => {
          const otherPosition = next[other.id];
          const dx = current.x - otherPosition.x;
          const dy = current.y - otherPosition.y;
          const distance = Math.max(18, Math.hypot(dx, dy));
          const force = 115 / (distance * distance);
          const nx = (dx / distance) * force * dt;
          const ny = (dy / distance) * force * dt;
          velocity[node.id].x += nx;
          velocity[node.id].y += ny;
          velocity[other.id].x -= nx;
          velocity[other.id].y -= ny;
        });
      });
      visibleEdges.forEach(([source, target]) => {
        const from = next[source];
        const to = next[target];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const force = (distance - 105) * .0019 * dt;
        const nx = (dx / distance) * force;
        const ny = (dy / distance) * force;
        velocity[source].x += nx;
        velocity[source].y += ny;
        velocity[target].x -= nx;
        velocity[target].y -= ny;
      });
      visibleNodes.forEach((node) => {
        const p = next[node.id];
        const v = velocity[node.id];
        v.x *= .88;
        v.y *= .88;
        p.x = Math.max(28, Math.min(612, p.x + v.x));
        p.y = Math.max(28, Math.min(552, p.y + v.y));
      });
      if (frame % 2 === 0) setPositions(next);
      frame += 1;
      if (frame < 220) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
    // The graph gets one deterministic settling pass when a new build stage appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, visibleNodeCount]);

  const handlePointerDown = (id: string) => {
    dragRef.current = { id, moved: false };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    if (!dragRef.current) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(30, Math.min(610, (event.clientX - rect.left - 320) / zoom + 320));
    const y = Math.max(36, Math.min(540, (event.clientY - rect.top - 250) / zoom + 250));
    dragRef.current.moved = true;
    setPositions((current) => ({ ...current, [dragRef.current!.id]: { x, y } }));
  };

  const handlePointerUp = (id: string) => {
    if (dragRef.current?.id === id && !dragRef.current.moved) setSelectedNode(id);
    dragRef.current = null;
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && (event.target as Element).tagName !== "rect") return;
    panRef.current = { active: true, x: pan.x, y: pan.y, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!panRef.current?.active) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPan({
      x: panRef.current.x + ((event.clientX - panRef.current.startX) / rect.width) * 640,
      y: panRef.current.y + ((event.clientY - panRef.current.startY) / rect.height) * 570,
    });
  };

  return (
    <div className="knowledge-graph-wrap">
      <div className="knowledge-graph-toolbar">
        <span><Network size={14} /> 지식그래프 구성요소</span>
        <span>{stage === 3 ? `GraphRAG ${graphProgress}% · ${visibleNodeCount} nodes` : `${seeds.length} seeds · ${prompt ? "prompt linked" : "prompt empty"}`}</span>
      </div>
      <svg className="knowledge-graph-svg" viewBox="0 0 640 570" role="img" aria-label="환경 시드 기반 KOSPI 지식그래프" onPointerDown={handleCanvasPointerDown} onPointerMove={handleCanvasPointerMove} onPointerUp={() => { panRef.current = null; }} onWheel={(event) => { event.preventDefault(); setZoom((current) => Math.max(.72, Math.min(1.55, current + (event.deltaY > 0 ? -.06 : .06)))); }}>
        <defs>
          <pattern id="graph-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#e4e4e7" /></pattern>
        </defs>
        <rect width="640" height="570" fill="url(#graph-grid)" />
        <g transform={`translate(${pan.x + 320} ${pan.y + 250}) scale(${zoom}) translate(-320 -250)`}>
          {!hasGraphSnapshot && <text x="320" y="285" textAnchor="middle" className="knowledge-node-type">Neo4j 첫 그래프 배치를 기다리는 중…</text>}
          {visibleEdges.map(([source, target, label], edgeIndex) => {
            const from = positions[source] ?? { x: 320, y: 250 };
            const to = positions[target] ?? { x: 320, y: 250 };
            return <g key={`${source}-${target}-${label}-${edgeIndex}`}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#c7c7cc" strokeWidth="1.35" /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4} className="knowledge-edge-label">{label}</text></g>;
          })}
          {visibleNodes.map((node) => {
            const position = positions[node.id] ?? { x: 320, y: 250 };
            const active = selectedNode === node.id;
            return <g key={node.id} className="knowledge-node" transform={`translate(${position.x} ${position.y})`} onPointerDown={() => handlePointerDown(node.id)} onPointerMove={handlePointerMove} onPointerUp={() => handlePointerUp(node.id)} onPointerCancel={() => { dragRef.current = null; }}>
              <circle r={active ? 15 : 11} fill={node.color} stroke="#fff" strokeWidth="3" />
              <text x="17" y="4" className={active ? "knowledge-node-label active" : "knowledge-node-label"}>{node.label}</text>
              <text x="17" y="17" className="knowledge-node-type">{node.type}</text>
            </g>;
          })}
        </g>
      </svg>
      <div className="knowledge-graph-footer"><span>{hasGraphSnapshot ? "Neo4j에 적재된 실제 노드·관계" : "실제 그래프 데이터가 도착하면 여기서 바로 갱신됩니다."}</span><span>휠 확대·축소 · 선택: {graphNodes.find((node) => node.id === selectedNode)?.label ?? "—"}</span></div>
    </div>
  );
}

function EvidenceMarkdown({ content }: { content: string }) {
  const inline = (value: string): ReactNode => value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return part;
  });

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  const isTableDivider = (value: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(value);
  const tableCells = (value: string) => value.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(<Tag key={`heading-${index}`}>{inline(heading[2])}</Tag>);
      index += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().includes("|")) { rows.push(tableCells(lines[index])); index += 1; }
      blocks.push(<div className="evidence-markdown-table-wrap" key={`table-${index}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const listMatch = line.match(/^([-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].trim().match(ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</List>);
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+|^([-*]|\d+\.)\s+|^(-{3,}|\*{3,}|_{3,})$/.test(lines[index].trim())) { paragraph.push(lines[index].trim()); index += 1; }
    blocks.push(<p key={`paragraph-${index}`}>{inline(paragraph.join(" "))}</p>);
  }

  return <div className="evidence-markdown">{blocks}</div>;
}

function ScenarioBuildScreen({
  seeds,
  prompt,
  uploadedFile,
  stage,
  period,
  runState,
  logs,
  documents,
  outputDir,
  mirofishRun,
  mirofishProgress,
  ontologySchema,
  graphSnapshot,
  simulationStarting,
  simulationStarted,
  onStartSimulation,
  onClose,
}: {
  seeds: string[];
  prompt: string;
  uploadedFile: UploadedSeed | null;
  stage: BuildStage;
  period: string;
  runState: OntologyRunState;
  logs: OntologyLog[];
  documents: OntologyDocument[];
  outputDir: string | null;
  mirofishRun: MirofishRun | null;
  mirofishProgress: MirofishProgress | null;
  ontologySchema: OntologySchema | null;
  graphSnapshot: LiveGraphSnapshot | null;
  simulationStarting: boolean;
  simulationStarted: boolean;
  onStartSimulation: () => void;
  onClose: () => void;
}) {
  const complete = runState === "complete";
  const [selectedEvidence, setSelectedEvidence] = useState<OntologyDocument | null>(null);
  // Ontology types are intentionally blank until the running pipeline returns
  // the schema generated from this session's evidence documents.
  const entityTypes = ontologySchema?.entityTypes ?? [];
  const relationTypes = ontologySchema?.relationTypes ?? [];
  const sourceDocuments = [
    { name: "market-evidence.md", label: "Market" },
    { name: "economic-evidence.md", label: "Economy" },
    { name: "external-event-evidence.md", label: "Events" },
    { name: "psychology-evidence.md", label: "Community" },
  ];
  const evidenceDocumentByName = new Map(documents.map((document) => [document.name, document]));
  const allEvidenceReady = sourceDocuments.every((source) => Boolean(evidenceDocumentByName.get(source.name)?.content.trim()));
  const pendingEvidenceSources = sourceDocuments.filter((source) => !evidenceDocumentByName.get(source.name)?.content.trim());
  const importantLog = (line: string) => {
    const detail = line.includes(" | ") ? line.split(" | ").at(-1) ?? "" : "";
    let fields: Record<string, unknown> = {};
    try { fields = JSON.parse(detail) as Record<string, unknown>; } catch { /* plain process line */ }
    if (line.includes("run_start")) return "데이터 수집을 위한 작업을 시작했습니다.";
    if (line.includes("agent_build_start")) return "시장 분석 에이전트를 준비하고 있습니다.";
    if (line.includes("agent_build_complete")) return "데이터 수집 에이전트 준비가 완료되었습니다.";
    if (line.includes("tool_query_start")) {
      const domain = { market: "시장", economy: "경제", events: "이벤트", psychology: "커뮤니티" }[String(fields.domain)] ?? "데이터";
      return `${domain} 데이터를 수집하고 있습니다.`;
    }
    if (line.includes("database_view_complete")) return `${String(fields.view ?? "데이터 view")}에서 ${Number(fields.rows ?? 0).toLocaleString("ko-KR")}건을 읽었습니다.`;
    if (line.includes("evidence_saved")) {
      const domain = { market: "시장", economy: "경제", events: "이벤트", psychology: "커뮤니티" }[String(fields.domain)] ?? "데이터";
      return `${domain} Evidence 문서를 생성했습니다.`;
    }
    if (line.includes("evidence_gap_saved")) return "커뮤니티 데이터 공백 문서를 기록했습니다.";
    if (line.includes("agent_invoke_complete")) return "온톨로지 Evidence 문서 생성이 완료되었습니다.";
    if (line.includes("free-models-per-day")) return "OpenRouter 무료 모델의 일일 요청 한도가 소진되었습니다.";
    if (line.includes("run_error")) return "실행 중 오류가 발생했습니다. 아래 상태를 확인해주세요.";
    return null;
  };
  const activityLogs = logs.map((log) => importantLog(log.line)).filter((line): line is string => Boolean(line)).filter((line, index, items) => items.indexOf(line) === index).slice(-4);
  const latestActivity = allEvidenceReady ? "시장·경제·이벤트·커뮤니티 Evidence 문서 수집이 완료되었습니다." : pendingEvidenceSources.length === 1 ? `${pendingEvidenceSources[0].label} Evidence 문서를 생성하고 있습니다.` : activityLogs.at(-1) ?? "데이터 수집을 위한 작업을 시작했습니다.";
  const documentPreview = (content: string) => content.replace(/^#{1,6}\s+.*$/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^\s*[-*]\s+/gm, "").replace(/\n{2,}/g, " ").replace(/\s+/g, " ").trim().slice(0, 170);
  const stepCompleted = (step: number) => stage > step || (complete && stage === step);
  const statusFor = (step: number) => stepCompleted(step) ? "COMPLETED" : stage === step ? "IN PROGRESS" : "WAITING";
  const cardClass = (step: number) => `build-step-card ${stepCompleted(step) ? "done" : stage === step ? "active" : "waiting"}`;
  const ontologyGraphStatus = stage < 2 ? "WAITING" : stage >= 4 ? "COMPLETED" : "IN PROGRESS";
  const ontologyGraphCardClass = `build-step-card ${stage < 2 ? "waiting" : stage >= 4 ? "done" : "active"}`;
  const profileCards = [
    { name: "외국인 수급 에이전트", handle: "@foreign_flow_01", type: "Flow Analyst", stance: "SUPPORTIVE", body: "글로벌 자금 흐름과 원·달러 변화를 추적해 순매수 전환의 지속성을 판단합니다." },
    { name: "반도체 실적 에이전트", handle: "@semiconductor_02", type: "Earnings Analyst", stance: "BULLISH", body: "삼성전자·SK하이닉스의 실적, HBM 수요, 메모리 가격을 연결해 섹터 반응을 계산합니다." },
    { name: "거시경제 에이전트", handle: "@macro_policy_03", type: "Macro Agent", stance: "NEUTRAL", body: "미국 금리와 중국 경기, 환율을 바탕으로 위험 프리미엄과 할인율 변화를 반영합니다." },
    { name: "시장 심리 에이전트", handle: "@sentiment_04", type: "Sentiment Agent", stance: "CAUTIOUS", body: "뉴스의 방향성과 투자자 심리를 읽어 과매도 반등과 추세 전환을 구분합니다." },
  ];
  return (
    <div className="scenario-build-screen">
      <header className="scenario-build-header">
        <div><span>FINVERSE · ONTOLOGY RUN</span><h2>{complete ? "시뮬레이션 준비가 완료되었습니다" : "온톨로지 문서를 생성하고 있습니다"}</h2><p>{complete ? "생성된 지식그래프와 에이전트 설정을 확인하고 시나리오를 시작할 수 있습니다." : "시장·경제·이벤트 근거를 수집해 MiroFish 실행에 사용할 문서를 만듭니다."}</p></div>
        <button className="scenario-modal-close" type="button" onClick={onClose} aria-label="시나리오 빌더 닫기"><X size={20} /></button>
      </header>
      <div className="scenario-build-meta"><span><Database size={14} /> 원격 시장 데이터</span><span><GitBranch size={14} /> {period} 예측 구간</span><span><Sparkles size={14} /> OpenRouter 분석</span></div>
      <div className="scenario-build-grid">
        <section className="knowledge-graph-panel" aria-label="시나리오 지식그래프">
          <div className="build-panel-heading"><div><span>GRAPH RELATIONSHIP VISUALIZATION</span><h3>시나리오 지식그래프</h3></div><span className="build-live-badge">{complete ? "BUILD COMPLETE" : "BUILDING"}</span></div>
          {stage < 3 ? <GraphGenerationPlaceholder stage={stage} /> : <KnowledgeGraphPreview seeds={seeds} prompt={prompt} stage={stage} progress={mirofishProgress} graphSnapshot={graphSnapshot} />}
        </section>
        <section className="build-process-panel" aria-label="온톨로지 빌드 진행 상태">
          <article className={cardClass(1)}>
            <div className="build-step-header"><span className="build-step-number">01</span><div><h3>Data Collection</h3><small>REMOTE DATABASE · WEB EVIDENCE</small></div><strong>{statusFor(1)}</strong></div>
            <div className={`data-collection-activity ${allEvidenceReady ? "complete" : ""}`}><div>{allEvidenceReady ? <CheckCircle2 size={15} /> : <LoaderCircle size={15} className={runState === "running" ? "spin" : ""} />}<strong>{latestActivity}</strong></div></div>
            <p>시뮬레이션을 진행하기 위한 시장·경제·이벤트·커뮤니티 데이터를 수집합니다.</p>
            <div className="evidence-source-grid">{sourceDocuments.map((source) => {
              const document = evidenceDocumentByName.get(source.name);
              const preview = document?.content ? documentPreview(document.content) : "";
              return <button key={source.name} type="button" className={`evidence-source-card ${preview ? "ready" : runState === "running" ? "collecting" : ""}`} disabled={!preview} onClick={() => document?.content && setSelectedEvidence(document)} aria-label={preview ? `${source.label} Evidence 문서 전체 보기` : `${source.label} Evidence 문서 준비 중`}><div><span>{source.label}</span><em>{preview ? "READY" : runState === "running" ? "COLLECTING" : "WAITING"}</em></div><p>{preview || "문서 생성 전"}</p>{preview && <span className="evidence-detail-link" aria-hidden="true">상세 보기 <ChevronRight size={12} /></span>}</button>;
            })}</div>
          </article>
          <article className={ontologyGraphCardClass}>
            <div className="build-step-header"><span className="build-step-number">02</span><div><h3>Ontology &amp; GraphRAG Build</h3><small>POST /api/graph/ontology/generate → /api/graph/build</small></div><strong>{ontologyGraphStatus}</strong></div>
            <p>{stage < 3 ? "수집한 근거를 엔터티·관계 타입으로 구성한 뒤, Neo4j 지식그래프로 순차 적재합니다." : "생성된 온톨로지를 바탕으로 문서 청크에서 엔터티·관계를 추출하고 Neo4j 지식그래프를 실시간 구축합니다."}</p>
            {stage === 2 && <div className="build-progress-line"><LoaderCircle size={15} className="spin" /> 시나리오 문맥에서 구성요소를 추출하는 중</div>}
            {stage === 3 && <div className="build-progress-line"><LoaderCircle size={15} className="spin" /> {mirofishProgress?.message ?? "Neo4j 지식그래프에 문서 청크를 적재하는 중"}</div>}
            <div className="build-chip-group"><small>GENERATED ENTITY TYPES</small><div>{entityTypes.map((item) => <span key={item}>{item}</span>)}</div></div>
            <div className="build-chip-group"><small>GENERATED RELATION TYPES</small><div>{relationTypes.map((item) => <span key={item}>{item}</span>)}</div></div>
            <div className="build-result-grid"><div><b>{graphSnapshot?.nodeCount ?? mirofishRun?.nodeCount ?? "—"}</b><small>ENTITY NODES</small></div><div><b>{graphSnapshot?.edgeCount ?? mirofishRun?.edgeCount ?? "—"}</b><small>RELATION EDGES</small></div><div><b>{entityTypes.length || "—"}</b><small>SCHEMA TYPES</small></div></div>
          </article>
          <article className={cardClass(4)}>
            <div className="build-step-header"><span className="build-step-number">03</span><div><h3>Generate Agent Profiles</h3><small>POST /api/simulation/prepare</small></div><strong>{statusFor(4)}</strong></div>
            <p>환경 시드와 연결된 엔터티를 역할별 에이전트로 바꾸고, 각자의 관점·활동량·편향을 설정합니다.</p>
            <div className="build-result-grid"><div><b>{mirofishRun?.profileCount ?? "—"}</b><small>CURRENT AGENTS</small></div><div><b>{mirofishRun?.entityCount ?? "—"}</b><small>EXPECTED TOTAL</small></div><div><b>{mirofishRun ? "READY" : "—"}</b><small>PROFILE OUTPUT</small></div></div>
            {stage >= 4 && <div className="agent-profile-grid">{profileCards.map((profile) => <article key={profile.handle} className="agent-profile-card"><div className="agent-profile-top"><span className="agent-avatar"><UserRound size={16} /></span><div><strong>{profile.name}</strong><small>{profile.handle}</small></div><em>{profile.stance}</em></div><span className="agent-profile-type">{profile.type}</span><p>{profile.body}</p><div className="agent-topic-row"><span>반도체</span><span>수급</span><span>변동성</span></div></article>)}</div>}
            {stage === 4 && <div className="build-progress-line"><LoaderCircle size={15} className="spin" /> 에이전트 프로필과 관련 토픽을 생성하는 중</div>}
          </article>
          <article className={cardClass(5)}>
            <div className="build-step-header"><span className="build-step-number">04</span><div><h3>Generate Config</h3><small>POST /api/simulation/prepare</small></div><strong>{statusFor(5)}</strong></div>
            <p>시나리오 요구사항과 에이전트 프로필을 바탕으로 시장 환경값, 라운드, 활동 시간과 모델 설정을 계산합니다.</p>
            <div className="config-metric-grid"><div><span>Duration</span><b>{period === "7일" ? "7 days" : period === "3개월" ? "90 days" : "30 days"}</b></div><div><span>Round Duration</span><b>60 min</b></div><div><span>Total Rounds</span><b>{period === "7일" ? "168" : period === "3개월" ? "2160" : "720"} rounds</b></div><div><span>Active / Hour</span><b>12–34</b></div></div>
            <div className="config-row-list"><div><strong>Peak Hours</strong><span>19:00, 20:00, 21:00, 22:00</span><em>×1.5</em></div><div><strong>Work Hours</strong><span>09:00–18:00</span><em>×0.7</em></div><div><strong>Morning Hours</strong><span>06:00–08:00</span><em>×0.4</em></div><div><strong>Off-Peak Hours</strong><span>00:00–05:00</span><em>×0.05</em></div></div>
            {stage === 5 && <div className="build-progress-line"><LoaderCircle size={15} className="spin" /> 시뮬레이션 환경값을 계산하는 중</div>}
            {stage >= 5 && <div className="llm-reasoning"><small>LLM CONFIG REASONING</small><p><strong>Time config:</strong> KOSPI 시나리오는 장중 수급과 미국 시장 반응이 겹치는 30일을 기준으로 설정했습니다. 저녁 피크에는 미국 금리·AI CapEx 뉴스가 집중되고, 장 시작 전에는 환율과 외국인 선물 수급이 반영되도록 활동량을 조정합니다.</p><p><strong>Event config:</strong> SK하이닉스 실적과 외국인 순매수 회복을 초기 이벤트로 두고, 원·달러와 CXMT 경쟁 심화가 반대 방향의 변동성을 만들도록 구성했습니다.</p></div>}
          </article>
          <article className={cardClass(6)}>
            <div className="build-step-header"><span className="build-step-number">05</span><div><h3>Initial Activation Orchestration</h3><small>POST /api/simulation/prepare</small></div><strong>{statusFor(6)}</strong></div>
            <p>에이전트의 첫 행동과 시장 내러티브 방향을 정해 시뮬레이션의 출발점을 고정합니다.</p>
            <div className="narrative-guide"><span><Sparkles size={14} /> NARRATIVE GUIDE DIRECTION</span><p>외국인 수급이 돌아오고 반도체 실적이 기대를 웃돌면서 KOSPI가 기술적 반등을 시도합니다. 다만 환율과 금리 변수에 따라 반등의 폭은 달라집니다.</p></div>
            <div className="hot-topic-row"><small>INITIAL HOT TOPICS</small><div><span>{mirofishRun ? `${mirofishRun.initialPostsCount ?? 0} INITIAL POSTS` : "시뮬레이션 설정 생성 후 표시"}</span></div></div>
            {stage >= 6 && <div className="activation-sequence"><small>INITIAL ACTIVATION SEQUENCE (4)</small>{["SK하이닉스 실적 발표가 컨센서스를 웃돌았습니다.","외국인 현물·선물 순매수가 동시에 포착됩니다.","미국 빅테크가 AI CapEx 유지 계획을 발표합니다.","원·달러 환율이 안정되며 위험 선호가 회복됩니다."].map((item,index)=><div key={item}><b>0{index+1}</b><span>{item}</span></div>)}</div>}
            <div className={`simulation-ready-summary ${complete && mirofishRun ? "ready" : ""}`}><div><span>SIMULATION READY</span><strong>{runState === "complete" && mirofishRun ? "시나리오 실행 준비가 완료되었습니다" : runState === "error" ? "준비 작업을 완료하지 못했습니다" : "시뮬레이션 준비 작업 진행 중"}</strong><p>{mirofishRun ? `지식그래프 ${mirofishRun.nodeCount ?? 0}개 노드 · ${mirofishRun.edgeCount ?? 0}개 관계 · 에이전트 ${mirofishRun.profileCount ?? 0}명` : "온톨로지, 그래프, 에이전트, 초기 활성화 결과를 정리하고 있습니다."}</p></div><div className="simulation-ready-action"><div className="ready-rounds"><b>{period === "7일" ? "168" : period === "3개월" ? "2160" : "720"}</b><span>rounds</span><em>Est. {period === "7일" ? "~6 min" : period === "3개월" ? "~72 min" : "~24 min"}</em></div>{runState === "complete" && mirofishRun ? <button className="build-continue-button" type="button" onClick={onStartSimulation} disabled={simulationStarting || simulationStarted}>{simulationStarting ? <><LoaderCircle size={17} className="spin" /> 시나리오를 시작하고 있습니다</> : simulationStarted ? <><CheckCircle2 size={17} /> 시나리오 실행을 시작했습니다</> : <><Network size={17} /> 시나리오 시작하기</>}</button> : <div className="build-continue-button build-result-status">{runState === "running" ? <><LoaderCircle size={17} className="spin" /> 준비 작업 진행 중</> : runState === "error" ? <>실행 오류 · 로그 확인 필요</> : <>실행 준비 중</>}</div>}</div></div>
          </article>
        </section>
      </div>
      {selectedEvidence && <div className="evidence-document-backdrop" role="presentation" onMouseDown={() => setSelectedEvidence(null)}><section className="evidence-document-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-document-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>EVIDENCE DOCUMENT</span><h3 id="evidence-document-title">{selectedEvidence.name}</h3><p>수집이 완료된 원문 전체를 확인합니다.</p></div><button className="scenario-modal-close" type="button" onClick={() => setSelectedEvidence(null)} aria-label="Evidence 문서 닫기"><X size={18} /></button></header><EvidenceMarkdown content={selectedEvidence.content} /></section></div>}
    </div>
  );
}

const simulationActionLabels: Record<string, string> = {
  CREATE_POST: "게시물 작성",
  CREATE_COMMENT: "댓글 작성",
  LIKE_POST: "게시물 반응",
  LIKE_COMMENT: "댓글 반응",
  REPOST: "게시물 공유",
  QUOTE_POST: "인용 게시물",
  FOLLOW: "에이전트 팔로우",
  SEARCH: "정보 탐색",
  DO_NOTHING: "관망",
};

function simulationActionContent(action: SimulationAction) {
  for (const key of ["content", "text", "body", "query", "comment", "reason"]) {
    const value = action.action_args?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const target = action.action_args?.target_user_id ?? action.action_args?.post_id ?? action.action_args?.comment_id;
  if (target !== undefined && target !== null) return `대상 ${String(target)}`;
  return action.success ? "시뮬레이션 행동이 반영되었습니다." : "행동 처리 결과를 확인하고 있습니다.";
}

function simulationTimeLabel(timestamp?: string) {
  if (!timestamp) return "방금";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "방금";
  return parsed.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ScenarioRunScreen({
  prompt,
  period,
  mirofishRun,
  session,
  chatMessages,
  chatSending,
  chatError,
  simulationStarting,
  onSendMessage,
  onRetry,
  onClose,
}: {
  prompt: string;
  period: string;
  mirofishRun: MirofishRun | null;
  session: SimulationSession | null;
  chatMessages: SimulationChatMessage[];
  chatSending: boolean;
  chatError: string | null;
  simulationStarting: boolean;
  onSendMessage: (message: string) => Promise<void>;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const runtime = session?.runtime;
  const status = session?.status ?? "starting";
  const completed = status === "completed" || runtime?.runner_status === "completed";
  const failed = status === "failed" || runtime?.runner_status === "failed";
  const running = !completed && !failed;
  const progress = completed ? 100 : Math.max(0, Math.min(100, runtime?.progress_percent ?? 0));
  const currentRound = runtime?.current_round ?? 0;
  const totalRounds = runtime?.total_rounds ?? (period === "7일" ? 168 : period === "3개월" ? 2160 : 720);
  const actions = runtime?.recent_actions ?? [];
  const activeBatch = runtime?.active_batch;
  const activeBatchMatch = activeBatch?.label?.match(/^(twitter|reddit)-round-(\d+)$/);
  const activePlatform = activeBatchMatch?.[1] === "twitter" ? "Twitter" : activeBatchMatch?.[1] === "reddit" ? "Reddit" : null;
  const batchTotal = activeBatch?.actions_count ?? 0;
  const batchCompleted = activeBatch?.completed_actions ?? 0;
  const batchActionCopy = batchCompleted > 0
    ? `${batchTotal.toLocaleString("ko-KR")}명 중 ${batchCompleted.toLocaleString("ko-KR")}명 처리 중`
    : `${batchTotal.toLocaleString("ko-KR")}개 에이전트 행동을 계산하고 있습니다`;
  const progressCopy = running && activeBatch?.status === "running"
    ? `${activePlatform ? `${activePlatform} · ` : ""}${activeBatchMatch?.[2] ? `${activeBatchMatch[2]}라운드 · ` : ""}${batchActionCopy}`
    : running ? "에이전트 행동을 계산하고 있습니다" : completed ? "모든 라운드 계산이 끝났습니다" : "실행 상태를 확인할 수 없습니다";
  const intro = completed
    ? "시뮬레이션이 완료되었습니다. 수집 근거, 지식그래프, 전체 에이전트 행동을 함께 살펴보며 질문에 답해드릴게요."
    : "시뮬레이션이 진행 중입니다. 현재까지 누적된 실제 Evidence와 가상 에이전트 행동을 구분해 답해드릴게요.";
  const suggestions = completed
    ? ["시뮬레이션의 핵심 결론을 요약해줘", "상승·하락을 가른 핵심 관계는 뭐야?", "실제 확인해야 할 지표를 정리해줘"]
    : ["현재까지 어떤 흐름이 나타났어?", "에이전트 반응이 가장 큰 이슈는 뭐야?", "실제 근거와 가상 행동을 구분해줘"];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || chatSending || !session?.chat_ready) return;
    setDraft("");
    await onSendMessage(message);
  };

  return (
    <div className="scenario-run-screen">
      <header className="scenario-run-header">
        <div>
          <span>FINVERSE · LIVE SIMULATION</span>
          <h2 id="scenario-run-title">{completed ? "시나리오 실행이 완료되었습니다" : failed ? "시나리오 실행을 확인해주세요" : "시나리오가 실행되고 있습니다"}</h2>
          <p>{prompt}</p>
        </div>
        <div className="scenario-run-header-actions">
          <span className={`scenario-run-status ${completed ? "complete" : failed ? "failed" : "live"}`}>{running && <i />} {completed ? "COMPLETED" : failed ? "ERROR" : "LIVE"}</span>
          <button className="scenario-modal-close" type="button" onClick={onClose} aria-label="시뮬레이션 화면 닫기"><X size={20} /></button>
        </div>
      </header>

      <section className="scenario-run-overview" aria-label="시뮬레이션 실행 현황">
        <div className="scenario-run-progress-copy"><span>{progressCopy}</span><strong>{progress.toFixed(progress % 1 ? 1 : 0)}%</strong></div>
        <div className="scenario-run-progress"><i style={{ width: `${progress}%` }} /></div>
        <div className="scenario-run-metrics">
          <div><Clock3 size={17} /><span>ROUND</span><strong>{currentRound.toLocaleString("ko-KR")} <em>/ {totalRounds.toLocaleString("ko-KR")}</em></strong></div>
          <div><UsersRound size={17} /><span>AGENTS</span><strong>{(mirofishRun?.profileCount ?? 0).toLocaleString("ko-KR")}</strong></div>
          <div><Activity size={17} /><span>ACTIONS</span><strong>{(runtime?.total_actions_count ?? 0).toLocaleString("ko-KR")}</strong></div>
          <div><Network size={17} /><span>KNOWLEDGE</span><strong>{(mirofishRun?.nodeCount ?? 0).toLocaleString("ko-KR")} <em>nodes</em></strong></div>
        </div>
        {failed && <div className="scenario-run-error"><span>{session?.error ?? "시뮬레이션 실행 중 오류가 발생했습니다."}</span><button type="button" onClick={onRetry} disabled={simulationStarting}>{simulationStarting ? <><LoaderCircle size={13} className="spin" /> 다시 시작하는 중</> : <>시뮬레이션 다시 시작</>}</button></div>}
      </section>

      <div className="scenario-run-grid">
        <section className="scenario-action-panel" aria-label="실시간 에이전트 행동">
          <div className="scenario-run-panel-heading"><div><Radio size={16} /><span>LIVE AGENT ACTIVITY</span></div><em>{actions.length ? `최근 ${actions.length}개` : "연결 중"}</em></div>
          <div className="scenario-action-stream">
            {actions.length ? [...actions].reverse().map((action, index) => (
              <article className="scenario-action-item" key={`${action.platform}-${action.round_num}-${action.agent_id}-${action.timestamp ?? index}-${index}`}>
                <div className={`scenario-action-avatar ${action.platform}`}><UserRound size={15} /></div>
                <div className="scenario-action-body">
                  <div><strong>{action.agent_name || `Agent ${action.agent_id}`}</strong><span>{action.platform === "twitter" ? "X / Twitter" : action.platform === "reddit" ? "Reddit" : action.platform}</span><time>{simulationTimeLabel(action.timestamp)}</time></div>
                  <p>{simulationActionContent(action)}</p>
                  <footer><span>{simulationActionLabels[action.action_type] ?? action.action_type.replaceAll("_", " ")}</span><em>Round {action.round_num}</em></footer>
                </div>
              </article>
            )) : (
              <div className="scenario-action-empty"><span><LoaderCircle size={22} className={running ? "spin" : ""} /></span><strong>{running ? "첫 에이전트 행동을 기다리고 있습니다" : "기록된 에이전트 행동이 없습니다"}</strong><p>실행 환경이 준비되면 게시물, 댓글, 반응이 이곳에 실시간으로 나타납니다.</p></div>
            )}
          </div>
        </section>

        <section className="scenario-chat-panel" aria-label="시뮬레이션 AI 채팅">
          <div className="scenario-run-panel-heading"><div><MessageCircle size={16} /><span>SCENARIO CHAT</span></div><em>{session?.chat_ready ? "EVIDENCE CONNECTED" : "연결 준비 중"}</em></div>
          <Conversation className="scenario-chat-conversation">
            <ConversationContent className="scenario-chat-content">
              <div className="scenario-chat-message assistant">
                <div className="scenario-chat-assistant"><SimulationMessageResponse>{intro}</SimulationMessageResponse></div>
              </div>
              {chatMessages.map((message) => (
                <div className={`scenario-chat-message ${message.role}`} key={message.id}>
                  <div className={message.role === "assistant" ? "scenario-chat-assistant" : "scenario-chat-user"}>
                    {message.role === "assistant" ? <SimulationMessageResponse>{message.content}</SimulationMessageResponse> : <p>{message.content}</p>}
                    {message.role === "assistant" && Boolean(message.sources?.length) && <div className="scenario-chat-sources">{message.sources?.map((source) => <span key={`${message.id}-${source}`}>{source}</span>)}</div>}
                  </div>
                </div>
              ))}
              {chatSending && <div className="scenario-chat-message assistant"><div className="scenario-chat-thinking"><LoaderCircle size={15} className="spin" /> 근거와 시뮬레이션 행동을 함께 확인하고 있습니다.</div></div>}
            </ConversationContent>
            <ConversationScrollButton className="scenario-chat-scroll" />
          </Conversation>
          {!chatMessages.length && <div className="scenario-chat-suggestions">{suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={!session?.chat_ready || chatSending} onClick={() => void onSendMessage(suggestion)}>{suggestion}</button>)}</div>}
          {chatError && <p className="scenario-chat-error">{chatError}</p>}
          <form className="scenario-chat-form" onSubmit={submit}>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={!session?.chat_ready || chatSending} placeholder={session?.chat_ready ? "현재 시뮬레이션에 대해 질문해보세요" : "실행 환경이 연결되면 채팅할 수 있습니다"} rows={2} />
            <button type="submit" disabled={!draft.trim() || !session?.chat_ready || chatSending} aria-label="질문 보내기">{chatSending ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}</button>
          </form>
          <p className="scenario-chat-note">실제 Evidence와 Neo4j 관계, 가상 에이전트 행동을 구분해 답변합니다.</p>
        </section>
      </div>
      <footer className="scenario-run-footer"><span>SESSION {session?.job_id ? session.job_id.slice(0, 18) : "연결 중"}</span><span>{period} 예측 · 실제 투자 결과를 보장하지 않는 조건부 시뮬레이션입니다.</span></footer>
    </div>
  );
}

function MarketLineChart({ values, labels, large = false, name }: { values: readonly number[]; labels?: readonly string[]; large?: boolean; name: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = large ? 368 : 138;
  const height = large ? 132 : 64;
  const plotTop = large ? 10 : 7;
  const plotBottom = large ? 107 : 56;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = 2 + (index / Math.max(values.length - 1, 1)) * (width - 4);
    const y = plotTop + ((max - value) / range) * (plotBottom - plotTop);
    return { x, y, value };
  });
  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
  const labelIndexes = labels ? [0, Math.round((values.length - 1) * .25), Math.round((values.length - 1) * .5), Math.round((values.length - 1) * .75), values.length - 1] : [];
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex];
  const tooltipWidth = large ? 78 : 66;
  const tooltipX = hoveredPoint ? Math.min(Math.max(hoveredPoint.x - tooltipWidth / 2, 2), width - tooltipWidth - 2) : 0;
  const tooltipDate = hoveredIndex === null || !labels ? "최근" : labels[Math.round((hoveredIndex / Math.max(values.length - 1, 1)) * (labels.length - 1))];

  return (
    <svg className={large ? "market-overview-chart" : undefined} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${name} 데이터 포인트 흐름`}>
      {large && <line className="market-axis-line" x1="2" y1="113" x2="366" y2="113" />}
      <polyline points={pointString} />
      {points.map((point, index) => <circle key={`${name}-${index}`} cx={point.x} cy={point.y} r={large ? 2.5 : 2} aria-label={`${name} ${point.value}`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} />)}
      {labels && labelIndexes.map((pointIndex, labelIndex) => <text key={labels[labelIndex]} x={points[pointIndex].x} y="129" textAnchor={labelIndex === 0 ? "start" : labelIndex === labels.length - 1 ? "end" : "middle"}>{labels[labelIndex]}</text>)}
      {hoveredPoint && <g className="market-chart-tooltip" pointerEvents="none">
        <rect x={tooltipX} y={Math.max(2, hoveredPoint.y - 34)} width={tooltipWidth} height="27" rx="4" />
        <text x={tooltipX + tooltipWidth / 2} y={Math.max(13, hoveredPoint.y - 21)} textAnchor="middle">{tooltipDate} · {hoveredPoint.value.toLocaleString("ko-KR")}</text>
      </g>}
    </svg>
  );
}

function ForecastChart({ scenario, marketData, liveSeries }: { scenario: Scenario; marketData: KospiMarketData | null; liveSeries?: IntradayIndex }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const pad = { top: 22, right: 24, bottom: 36, left: 50 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      const splitX = pad.left + plotW * 0.58;
      const rightX = width - pad.right;
      const candles = [...(marketData?.candles?.length ? marketData.candles : fallbackKospiCandles)];
      const liveLatest = liveSeries?.points.at(-1);
      if (liveLatest && liveSeries?.points.length) {
        const prices = liveSeries.points;
        const isoDate = liveLatest.date.slice(0, 10);
        const label = `${Number(isoDate.slice(5, 7))}/${Number(isoDate.slice(8, 10))}`;
        const liveCandle = {
          date: isoDate.replaceAll("-", ""), label,
          open: prices[0].open || prices[0].close,
          high: Math.max(...prices.map((point) => point.high || point.close)),
          low: Math.min(...prices.map((point) => point.low || point.close)),
          close: liveLatest.close,
        };
        if (candles.at(-1)?.label === label) candles[candles.length - 1] = liveCandle;
        else candles.push(liveCandle);
      }
      const closes = candles.map((candle) => candle.close);
      const scaleRatio = closes[closes.length - 1] / scenario.path[0];
      const forecastPath = scenario.path.map((value) => value * scaleRatio);
      const outerUpper = forecastPath.map((value, index) => value * (1 + .015 + index * .011));
      const outerLower = forecastPath.map((value, index) => value * (1 - .015 - index * .011));
      const innerUpper = forecastPath.map((value, index) => value * (1 + .008 + index * .006));
      const innerLower = forecastPath.map((value, index) => value * (1 - .008 - index * .006));
      const all = [...closes, ...outerUpper, ...outerLower];
      const rawSpan = Math.max(...all) - Math.min(...all);
      const rawStep = rawSpan / 6;
      const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1))));
      const niceStep = [1, 2, 5, 10].map((mult) => mult * magnitude).find((step) => rawStep <= step) ?? 10 * magnitude;
      const axisStep = niceStep;
      const min = Math.floor((Math.min(...all) - rawSpan * .06) / axisStep) * axisStep;
      const max = Math.ceil((Math.max(...all) + rawSpan * .06) / axisStep) * axisStep;
      const xActual = (index: number) => pad.left + (index / Math.max(candles.length - 1, 1)) * (splitX - pad.left);
      const xForecast = (index: number) => splitX + (index / Math.max(forecastPath.length - 1, 1)) * (rightX - splitX);
      const y = (value: number) => pad.top + ((max - value) / (max - min)) * plotH;

      ctx.clearRect(0, 0, width, height);
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.textAlign = "right";
      ctx.fillStyle = "#9aa0ab";
      ctx.strokeStyle = "#e8eaf0";
      ctx.lineWidth = 1;
      const tickCount = Math.round((max - min) / axisStep);
      for (let i = 0; i <= tickCount; i += 1) {
        const value = max - axisStep * i;
        const py = y(value);
        ctx.beginPath();
        ctx.moveTo(pad.left, py);
        ctx.lineTo(width - pad.right, py);
        ctx.stroke();
        ctx.fillText(Math.round(value).toLocaleString("ko-KR"), pad.left - 10, py + 4);
      }

      const drawBand = (upper: number[], lower: number[], opacity: number) => {
        ctx.beginPath();
        upper.forEach((value, index) => {
          const px = xForecast(index);
          const py = y(value);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        for (let index = lower.length - 1; index >= 0; index -= 1) {
          ctx.lineTo(xForecast(index), y(lower[index]));
        }
        ctx.closePath();
        ctx.fillStyle = scenario.tone === "up" ? `rgba(214,76,83,${opacity})` : `rgba(7,105,255,${opacity})`;
        ctx.fill();
      };

      drawBand(outerUpper, outerLower, 0.08);
      drawBand(innerUpper, innerLower, 0.12);

      const candleWidth = Math.max(3, Math.min(7, (splitX - pad.left) / candles.length * 0.58));
      candles.slice(1).forEach((candle, index) => {
        const px = xActual(index + 1);
        const color = candle.close >= candle.open ? "#d64c53" : "#0769ff";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, y(candle.high));
        ctx.lineTo(px, y(candle.low));
        ctx.stroke();
        const bodyTop = Math.min(y(candle.open), y(candle.close));
        const bodyHeight = Math.max(2, Math.abs(y(candle.open) - y(candle.close)));
        ctx.fillStyle = color;
        ctx.fillRect(px - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      });

      const currentY = y(closes[closes.length - 1]);
      ctx.strokeStyle = "#9aa0ab";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, currentY);
      ctx.lineTo(rightX, currentY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      forecastPath.forEach((value, index) => {
        const px = xForecast(index);
        const py = y(value);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      const forecastColor = scenario.tone === "up" ? "#d64c53" : "#0769ff";
      ctx.strokeStyle = forecastColor;
      ctx.lineWidth = 3;
      ctx.stroke();
      forecastPath.forEach((value, index) => {
        const px = xForecast(index);
        const py = y(value);
        ctx.beginPath();
        ctx.fillStyle = "#fff";
        ctx.arc(px, py, index === forecastPath.length - 1 ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = forecastColor;
        ctx.stroke();
      });

      ctx.strokeStyle = "#0b0d14";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(splitX, pad.top);
      ctx.lineTo(splitX, height - pad.bottom);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.fillStyle = "#6d7380";
      const actualLabelIndexes = [0, .25, .5, .75, 1].map((ratio) => Math.round((candles.length - 1) * ratio));
      actualLabelIndexes.forEach((pathIndex) => {
        ctx.fillText(candles[pathIndex].label, xActual(pathIndex), height - 12);
      });
      ctx.fillStyle = "#fff";
      ctx.fillRect(splitX - 20, height - 29, 40, 24);
      ctx.fillStyle = "#0b0d14";
      ctx.fillRect(splitX - 20, height - 29, 40, 24);
      ctx.fillStyle = "#fff";
      ctx.font = '700 10px "Pretendard Variable", sans-serif';
      ctx.fillText(candles[candles.length - 1].label, splitX, height - 13);
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.fillStyle = "#9aa0ab";
      ["+7일", "+14일", "+21일", "+1개월"].forEach((label, index, labels) => {
        ctx.fillText(label, splitX + ((index + 1) / labels.length) * (rightX - splitX), height - 12);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scenario, marketData, liveSeries]);

  return <canvas ref={canvasRef} className="forecast-canvas" aria-label={`${scenario.title} 조건부 KOSPI 예상 경로`} />;
}

/* ============================================================
 * 나의 투자 일지 — event-scenario paper trading, real data only.
 * Backed by services/paper_trading/api.py + scenario_trading.py +
 * scenario_investor_analyzer.py via the /api/paper-trading proxy.
 * ============================================================ */

type TwinGameSummary = {
  game_id: string;
  mode?: string;
  ticker: string;
  name: string;
  status: string;
  phase: string;
  created_at?: string;
  updated_at?: string;
  scenario_premise?: string;
  current_event_index: number;
  total_events: number;
  market_days: number;
  current_price: number | null;
  total_return_pct: number | null;
};

type TwinOntologySource = {
  origin?: "macro" | "micro";
  event_types?: string[];
  headline?: string;
  original_date?: string;
};

type TwinRevealedEvent = {
  event_id: string;
  sequence: number;
  title: string;
  description?: string;
  pre_brief?: string;
  event_date: string;
  ontology_source?: TwinOntologySource | null;
};

type TwinPricePoint = {
  step: number;
  label: string;
  phase: string;
  price: number;
  market_date?: string;
  return_pct?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

type TwinHistoryCandle = { market_date: string; open: number; high: number; low: number; close: number; volume: number };
type TwinDailyPerformance = { market_date: string; equity: number; daily_pnl: number; total_return_pct: number };

type TwinGameDetail = {
  game_id: string;
  ticker: string;
  name: string;
  status: string;
  phase: string;
  current_price: number;
  initial_reference_price: number;
  simulation_days?: number;
  scenario_premise?: string;
  history_candles?: TwinHistoryCandle[];
  price_history?: TwinPricePoint[];
  revealed_events?: TwinRevealedEvent[];
  initial_context?: {
    watch_points?: string[];
    positive_factors?: string[];
    risk_factors?: string[];
  };
  world?: { memory?: { active_momenta?: string[] } };
  portfolio?: { total_return_pct: number };
  daily_performance?: TwinDailyPerformance[];
  llm_reports?: {
    investment?: { report_markdown?: string; summary?: string; behavior_pattern?: string; investor_type?: "anchor" | "adapter" | "defender" | "chaser" };
    scenario?: {
      report_markdown?: string;
      summary?: string;
      environment_evolution?: string;
      event_reviews?: { date?: string; event?: string; impact?: string }[];
      stock_flow?: string;
      group_behavior?: Record<string, string>;
      key_turning_points?: string[];
    };
  };
};

type TwinAssessmentMetrics = {
  completed_events?: number;
  trade_count?: number;
  pre_event_trades?: number;
  post_event_trades?: number;
  autonomous_market_days?: number;
  max_abs_market_sentiment?: number;
  turnover_ratio?: number;
  total_return_pct?: number;
  max_price_drawdown_pct?: number;
  average_confidence?: number | null;
};

type TwinAssessment = {
  style?: string;
  metrics?: TwinAssessmentMetrics;
  findings?: string[];
  lessons?: { topic: string; message: string }[];
};

type TwinSession = { game: TwinGameSummary; assessment: TwinAssessment };
type TwinBar = { key: string; date: string; open: number; high: number; low: number; close: number; real: boolean };

const TWIN_INVESTOR_TYPE_META = {
  anchor: { label: "원칙형 · The Anchor", image: "/investor-types/anchor.png" },
  adapter: { label: "전략형 · The Adapter", image: "/investor-types/adapter.png" },
  defender: { label: "고집 반응형 · The Defender", image: "/investor-types/defender.png" },
  chaser: { label: "추격형 · The Chaser", image: "/investor-types/chaser.png" },
} as const;

const TWIN_GROUP_LABEL: Record<string, string> = {
  retail: "개인",
  foreign: "외국인",
  institution: "기관",
  pension: "연기금",
};

function inferTwinInvestorType(report?: NonNullable<TwinGameDetail["llm_reports"]>["investment"]): keyof typeof TWIN_INVESTOR_TYPE_META | null {
  const declaredType = String(report?.investor_type ?? "").trim().toLowerCase();
  const aliases: Record<string, keyof typeof TWIN_INVESTOR_TYPE_META> = {
    anchor: "anchor", "원칙형": "anchor",
    adapter: "adapter", "전략형": "adapter", "적응형": "adapter",
    defender: "defender", "고집 반응형": "defender",
    chaser: "chaser", "추격형": "chaser",
  };
  if (aliases[declaredType]) return aliases[declaredType];
  const text = `${report?.report_markdown ?? ""} ${report?.behavior_pattern ?? ""} ${report?.summary ?? ""}`;
  if (/The Anchor|원칙형/i.test(text)) return "anchor";
  if (/The Adapter|전략형|적응형/i.test(text)) return "adapter";
  if (/The Defender|고집 반응형/i.test(text)) return "defender";
  if (/The Chaser|추격형/i.test(text)) return "chaser";
  if (/추격 매수|FOMO|고점.*매수/i.test(text)) return "chaser";
  return null;
}

function TwinScenarioReport({ detail, scenario }: {
  detail: TwinGameDetail;
  scenario?: NonNullable<TwinGameDetail["llm_reports"]>["scenario"];
}) {
  if (!scenario) return null;
  const hasStructuredContent = Boolean(
    scenario.summary || scenario.environment_evolution || scenario.stock_flow || scenario.event_reviews?.length || scenario.group_behavior || scenario.key_turning_points?.length,
  );
  if (!hasStructuredContent) {
    return scenario.report_markdown
      ? <PaperEvidenceMarkdown content={scenario.report_markdown} />
      : <p className="journal-history-note">저장된 시나리오 보고서를 불러오지 못했습니다.</p>;
  }
  const eventCount = scenario.event_reviews?.length ?? detail.revealed_events?.length ?? 0;
  return (
    <article className="paper-report-card scenario journal-scenario-report">
      <header><div><span>02 · WORLD REPORT</span><h3>시나리오 보고서</h3></div><span>환경 변화·에이전트 흐름</span></header>
      <section className="paper-scenario-overview" aria-label="시나리오 핵심 요약">
        <div className="paper-scenario-highlight"><span>시뮬레이션 기간</span><strong>{detail.simulation_days ?? 0}<small>거래일</small></strong><p>{scenario.summary ?? "기록된 시장 환경을 바탕으로 시나리오 경로를 정리했습니다."}</p></div>
        <div className="paper-scenario-summary-grid">
          <div><span>시작 기준가</span><strong>{detail.initial_reference_price.toLocaleString("ko-KR")}원</strong><small>{detail.name} · 시뮬레이션 시작</small></div>
          <div><span>종료 기준가</span><strong>{detail.current_price.toLocaleString("ko-KR")}원</strong><small>종료 시점 종가</small></div>
          <div><span>World State 변화</span><p>{scenario.environment_evolution ?? "기록된 환경 변화가 없습니다."}</p></div>
          <div><span>공개 이벤트</span><strong>{eventCount}<small>개</small></strong><small>실제 유사 근거 확인 후 공개</small></div>
        </div>
      </section>
      {scenario.stock_flow && <p className="paper-report-detail"><b>종목 흐름</b>{scenario.stock_flow}</p>}
      {scenario.event_reviews?.length ? <div className="paper-report-events"><b>발생 이벤트</b>{scenario.event_reviews.map((row, index) => <article key={`${row.date}-${index}`}><div><span>{row.date}</span><strong>{row.event}</strong></div><p>{row.impact}</p></article>)}</div> : null}
      {scenario.group_behavior && <div className="paper-report-groups">{Object.entries(scenario.group_behavior).map(([key, value]) => <p key={key}><b>{TWIN_GROUP_LABEL[key] ?? key}</b>{value}</p>)}</div>}
      {scenario.key_turning_points?.length ? <div className="paper-report-list plan"><b>주요 전환점</b><ul>{scenario.key_turning_points.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div> : null}
    </article>
  );
}

function TwinStoredReports({ detail, regenerating, onRegenerate }: {
  detail: TwinGameDetail;
  regenerating?: boolean;
  onRegenerate?: () => void;
}) {
  const reports = detail.llm_reports;
  const [openReport, setOpenReport] = useState<"investment" | "scenario" | null>(null);
  const investment = reports?.investment;
  const scenario = reports?.scenario;
  const active = openReport === "scenario" ? scenario : investment;
  const reportTitle = openReport === "scenario" ? "해당 시나리오" : "나의 투자 일지";
  const investorType = inferTwinInvestorType(investment);
  if (!investment && !scenario) return <p className="journal-history-note">이 실행은 아직 완료된 보고서를 생성하지 않았습니다.</p>;
  return (
    <section className="journal-stored-reports" aria-label="저장된 완료 보고서">
      <div className="journal-stored-reports-head"><h4>저장된 완료 보고서</h4><span>이 계정의 투자 성향 히스토리에 저장됨</span></div>
      <div className="journal-stored-report-tabs">
        <button type="button" disabled={!investment} onClick={() => setOpenReport("investment")}>나의 투자 일지 열기</button>
        <button type="button" disabled={!scenario} onClick={() => setOpenReport("scenario")}>해당 시나리오 열기</button>
        {onRegenerate && <button className="journal-report-regenerate" type="button" onClick={onRegenerate} disabled={regenerating}>{regenerating ? "새 형식 보고서 생성 중…" : "새 형식으로 두 보고서 다시 생성"}</button>}
      </div>
      {openReport && <div className="journal-report-dialog-backdrop" role="presentation" onMouseDown={() => setOpenReport(null)}>
        <section className="journal-report-dialog" role="dialog" aria-modal="true" aria-labelledby="journal-report-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>COMPLETED REPORT</span><h5 id="journal-report-title">{reportTitle}</h5></div><button type="button" aria-label="보고서 닫기" onClick={() => setOpenReport(null)}>×</button></header>
          <div className="journal-report-dialog-body">
            {openReport === "investment" && investorType && <figure className="journal-report-investor-type">
              <figcaption><span>나의 투자 유형</span><strong>{TWIN_INVESTOR_TYPE_META[investorType].label}</strong></figcaption>
              <img src={TWIN_INVESTOR_TYPE_META[investorType].image} alt={TWIN_INVESTOR_TYPE_META[investorType].label} />
            </figure>}
            {openReport === "scenario"
              ? <TwinScenarioReport detail={detail} scenario={scenario} />
              : active?.report_markdown
                ? <PaperEvidenceMarkdown content={active.report_markdown} />
                : <p className="journal-history-note">저장된 요약: {active?.summary ?? "보고서 내용을 불러오지 못했습니다."}</p>}
          </div>
        </section>
      </div>}
    </section>
  );
}

// analyze_scenario_investor()의 4가지 스타일. 관찰형(기본)→사전 포지셔닝→추종→고회전
// 순서로 매매 개입도가 커진다는 분석 로직 순서를 그대로 pill 음영 단계에 반영한다.
const TWIN_STYLE_ORDER = ["이벤트 반응 관찰형", "사전 포지셔닝형", "이벤트 추종형", "이벤트 고회전형"];
// 세션이 많아지면 판정 API를 세션 수만큼 부르게 된다. 최근 N건만 부르고 나머지는
// 히스토리 노트로 알린다.
const TWIN_ASSESSMENT_CAP = 8;

async function fetchPaperTradingJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api/paper-trading${path}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: string } | null;
  if (!response.ok || !payload || payload.success === false) throw new Error(payload?.error ?? "요청을 처리하지 못했습니다.");
  return payload.data as T;
}

async function postPaperTradingJson<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/paper-trading${path}`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: string } | null;
  if (!response.ok || !payload || payload.success === false) throw new Error(payload?.error ?? "요청을 처리하지 못했습니다.");
  return payload.data as T;
}

function twinStyleShade(style?: string) {
  const idx = style ? TWIN_STYLE_ORDER.indexOf(style) : -1;
  const pct = 14 + Math.max(0, idx) * 24;
  return `color-mix(in srgb, var(--ink) ${pct}%, var(--soft))`;
}
function twinStyleTextColor(style?: string) {
  const idx = style ? TWIN_STYLE_ORDER.indexOf(style) : -1;
  return idx >= 2 ? "#fff" : "var(--ink)";
}
function twinCategoryLabel(source?: TwinOntologySource | null) {
  if (!source) return "이벤트";
  if (source.event_types?.length) return source.event_types[0];
  if (source.origin === "macro") return "거시 지표";
  if (source.origin === "micro") return "종목 뉴스";
  return "이벤트";
}
const twinTone = (value: number) => (value > 0 ? "up" : value < 0 ? "down" : "");
const twinSignedPct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

function TwinReviewMilestoneRail({ detail }: { detail: TwinGameDetail }) {
  const milestones = useMemo(() => {
    const snapshots = [...(detail.daily_performance ?? [])].sort((left, right) => left.market_date.localeCompare(right.market_date));
    if (!snapshots.length) return [];
    const uniformIndexes = [
      Math.max(0, Math.ceil(snapshots.length / 3) - 1),
      Math.max(0, Math.ceil((snapshots.length * 2) / 3) - 1),
      snapshots.length - 1,
    ];
    const eventIndexes = (detail.revealed_events ?? [])
      .map((event) => snapshots.findIndex((snapshot) => snapshot.market_date === event.event_date))
      .filter((index) => index >= 0);
    // 사건이 공개된 날은 반드시 남기고, 남은 칸만 호라이즌을 균등 분할한 시점으로 채운다.
    const checkpointIndexes = [...new Set([...eventIndexes, ...uniformIndexes])].sort((left, right) => left - right).slice(0, 3);
    return checkpointIndexes.map((snapshotIndex) => {
      const snapshot = snapshots[snapshotIndex];
      const event = (detail.revealed_events ?? []).find((item) => item.event_date === snapshot.market_date);
      return { snapshot, event };
    });
  }, [detail.daily_performance, detail.revealed_events]);
  return (
    <aside className="journal-review-milestones" aria-label="발생 가능 이벤트">
      <header><h4>발생 가능 이벤트</h4><span>시뮬레이션 기준</span></header>
      {milestones.length ? <div className="journal-review-milestone-list">
        {milestones.map(({ snapshot, event }) => (
          <article key={snapshot.market_date}>
            <div className={`journal-review-milestone-dot ${twinTone(snapshot.total_return_pct)}`} />
            <div>
              <div className="journal-review-milestone-meta"><small>D+{snapshotIndexForDate(detail.daily_performance, snapshot.market_date)} · {formatTwinShortDate(snapshot.market_date)}</small><b className={twinTone(snapshot.total_return_pct)}>{twinSignedPct(snapshot.total_return_pct)}</b></div>
              <h5>{event?.title ?? "시뮬레이션 진행 시점"}</h5>
              <p>{event
                ? event.description ?? "공개된 시장 사건을 반영했습니다."
                : "이 시점까지의 실제 판단과 자산 변화를 기준으로 확인합니다."}</p>
            </div>
          </article>
        ))}
      </div> : <p className="journal-review-milestone-empty">완료된 거래일 기록을 불러오는 중입니다.</p>}
    </aside>
  );
}
function snapshotIndexForDate(snapshots: TwinDailyPerformance[] | undefined, marketDate: string) {
  const index = (snapshots ?? []).findIndex((snapshot) => snapshot.market_date === marketDate);
  return Math.max(0, index + 1);
}
const twinWon = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
function formatTwinDate(iso?: string) {
  if (!iso || iso.length < 10) return iso ?? "";
  return `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
}
function formatTwinShortDate(iso?: string) {
  if (!iso || iso.length < 10) return "";
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}
function twinCssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function twinStyleNarrative(sessions: TwinSession[]): string {
  if (sessions.length === 0) return "";
  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const firstDate = formatTwinDate(first.game.created_at ?? first.game.updated_at);
  const lastDate = formatTwinDate(last.game.created_at ?? last.game.updated_at);
  const latestFinding = last.assessment.findings?.[0];
  if (sessions.length === 1) {
    return `${lastDate} ${last.game.name} 모의투자에서 '${last.assessment.style ?? "판정 전"}' 성향으로 판정됐습니다.${latestFinding ? ` ${latestFinding}` : ""} 세션이 더 쌓이면 성향 변화 흐름을 함께 보여드립니다.`;
  }
  const distinctStyles = Array.from(new Set(
    sessions.map((session) => session.assessment.style).filter((style): style is string => Boolean(style)),
  ));
  const middle = distinctStyles.length <= 1
    ? "그 사이 스타일 변화 없이 동일한 성향을 유지했습니다."
    : `그 사이 ${distinctStyles.join(", ")} 등 총 ${distinctStyles.length}가지 스타일을 오갔습니다.`;
  return `${firstDate} ${first.game.name} 세션에서는 '${first.assessment.style ?? "판정 전"}'으로 시작해, ${middle} 가장 최근인 ${lastDate} ${last.game.name} 세션에서는 '${last.assessment.style ?? "판정 전"}'으로 판정됐습니다.${latestFinding ? ` ${latestFinding}` : ""}`;
}

/** history_candles(실제 이력)과 price_history(시뮬레이션 라운드)를 하나의 캔들 배열로 합친다.
 *  둘 다 이미 open/high/low/close를 들고 있으므로 목업의 합성 캔들 기법은 필요 없다. */
function buildTwinBars(detail: TwinGameDetail): TwinBar[] {
  const bars: TwinBar[] = [];
  const seen = new Set<string>();
  for (const row of detail.history_candles ?? []) {
    if (!row.close || !row.market_date || seen.has(row.market_date)) continue;
    seen.add(row.market_date);
    bars.push({ key: `real-${row.market_date}`, date: row.market_date, open: row.open, high: row.high, low: row.low, close: row.close, real: true });
  }
  for (const point of detail.price_history ?? []) {
    const close = point.close ?? point.price;
    if (!close) continue;
    if (point.step === 0 && point.market_date && seen.has(point.market_date)) continue;
    bars.push({
      key: `sim-${point.step}`, date: point.market_date ?? "",
      open: point.open ?? close, high: point.high ?? close, low: point.low ?? close, close,
      real: point.step === 0,
    });
  }
  return bars;
}

function TwinEmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="journal-empty">
      <CandlestickChart size={26} />
      <strong>아직 진행한 이벤트 시나리오 모의투자가 없습니다.</strong>
      <p>모의 투자에서 이벤트 시나리오를 한 번 진행하면 이곳에 투자 성향 분석과 종목별 실험 결과가 쌓입니다.</p>
      <button type="button" onClick={onOpen}>모의 투자 시작하기</button>
    </div>
  );
}

type TwinRiskSurveyChoice = { label: string; score: number };
type TwinRiskSurveyQuestion = { prompt: string; choices: TwinRiskSurveyChoice[] };

// Grable & Lytton의 다차원 위험감수 성향 척도에서 다루는 손실 반응·기간·변동성
// 수용·수익 추구 요소를 학습용 5문항으로 간소화했다. 금융상품 적합성 평가는 아니다.
const TWIN_RISK_SURVEY_QUESTIONS: TwinRiskSurveyQuestion[] = [
  {
    prompt: "투자에서 가장 피하고 싶은 상황은 무엇인가요?",
    choices: [
      { label: "원금이 조금이라도 줄어드는 상황", score: 1 },
      { label: "예상보다 큰 손실이 나는 상황", score: 2 },
      { label: "회복을 기다려야 하는 단기 손실", score: 3 },
      { label: "높은 수익 기회를 놓치는 상황", score: 4 },
    ],
  },
  {
    prompt: "한 달 만에 투자금이 10% 하락했다면 어떻게 하겠어요?",
    choices: [
      { label: "바로 정리하고 손실을 멈춘다", score: 1 },
      { label: "일부를 줄이고 상황을 지켜본다", score: 2 },
      { label: "처음 계획을 유지하며 기다린다", score: 3 },
      { label: "분석 근거가 있으면 추가 매수를 검토한다", score: 4 },
    ],
  },
  {
    prompt: "이 투자 자금을 묶어둘 수 있는 기간은 어느 정도인가요?",
    choices: [
      { label: "1년 이내", score: 1 },
      { label: "1~3년", score: 2 },
      { label: "3~5년", score: 3 },
      { label: "5년 이상", score: 4 },
    ],
  },
  {
    prompt: "수익을 위해 감수할 수 있는 가격 변동 폭에 가까운 것은 무엇인가요?",
    choices: [
      { label: "거의 없는 변동", score: 1 },
      { label: "작고 예측 가능한 변동", score: 2 },
      { label: "중간 수준의 등락", score: 3 },
      { label: "큰 등락도 장기 수익을 위해 감수", score: 4 },
    ],
  },
  {
    prompt: "두 투자안 중 더 마음이 가는 쪽은 무엇인가요?",
    choices: [
      { label: "수익은 낮아도 결과가 안정적인 투자", score: 1 },
      { label: "안정성과 수익을 균형 있게 고려한 투자", score: 2 },
      { label: "손실 가능성은 있지만 성장 여지가 큰 투자", score: 3 },
      { label: "손실 가능성이 커도 기대수익이 높은 투자", score: 4 },
    ],
  },
];

type TwinRiskSurveyResult = { score: number; completedAt: string };
const LEGACY_TWIN_RISK_SURVEY_STORAGE_KEY = "finverse-twin-risk-survey-v1";

function twinRiskProfile(score: number) {
  if (score <= 8) return { label: "안정형", description: "손실 회피와 자금 안정성을 우선하는 편입니다. 변동성이 큰 상황에서는 투자 근거와 손실 한도를 먼저 점검해 보세요.", tone: "steady" };
  if (score <= 12) return { label: "안정추구형", description: "안정성을 우선하되, 충분한 근거가 있으면 제한적인 변동은 감수하는 편입니다. 목표와 투자 기간을 분리해 판단해 보세요.", tone: "balanced" };
  if (score <= 16) return { label: "위험중립형", description: "성장 기회와 손실 가능성을 함께 비교하는 편입니다. 시장 변동 때도 처음 세운 기준을 유지하는지 모의투자로 확인해 보세요.", tone: "growth" };
  return { label: "적극투자형", description: "장기 성장 기회와 높은 기대수익을 더 중시하는 편입니다. 큰 변동을 감수할 때는 자금 배분과 손실 관리 기준을 분명히 해 보세요.", tone: "active" };
}

function TwinRiskProfileSurvey() {
  const [phase, setPhase] = useState<"loading" | "intro" | "questions" | "result">("loading");
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<TwinRiskSurveyResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/investor-profile", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { profile?: TwinRiskSurveyResult | null; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? "투자 성향 기록을 불러오지 못했습니다.");
        if (!active) return;
        if (payload?.profile) {
          setResult(payload.profile);
          setPhase("result");
        } else {
          // 이전 버전은 브라우저에만 결과를 보관했다. 기존 사용자가 첫 화면에서
          // 다시 답하지 않도록 유효한 점수만 계정 기록으로 한 번 옮긴다.
          let legacy: TwinRiskSurveyResult | null = null;
          try {
            const saved = window.localStorage.getItem(LEGACY_TWIN_RISK_SURVEY_STORAGE_KEY);
            const parsed = saved ? JSON.parse(saved) as TwinRiskSurveyResult : null;
            if (parsed && Number.isInteger(parsed.score) && parsed.score >= 5 && parsed.score <= 20) legacy = parsed;
          } catch { /* 이전 브라우저 기록이 없으면 새 진단으로 진행한다. */ }
          if (!legacy) { setPhase("intro"); return; }
          const migration = await fetch("/api/investor-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score: legacy.score }) });
          const migrated = await migration.json().catch(() => null) as { profile?: TwinRiskSurveyResult } | null;
          if (!migration.ok || !migrated?.profile) throw new Error("기존 투자 성향 기록을 이전하지 못했습니다.");
          if (!active) return;
          setResult(migrated.profile);
          setPhase("result");
        }
      })
      .catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : "투자 성향 기록을 불러오지 못했습니다."); setPhase("intro"); } });
    return () => { active = false; };
  }, []);

  const start = () => {
    setAnswers([]);
    setResult(null);
    setPhase("questions");
  };
  const selectAnswer = async (score: number) => {
    const next = [...answers, score];
    setAnswers(next);
    if (next.length !== TWIN_RISK_SURVEY_QUESTIONS.length) return;
    const completed = { score: next.reduce((sum, value) => sum + value, 0), completedAt: new Date().toISOString() };
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/investor-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score: completed.score }) });
      const payload = await response.json().catch(() => null) as { profile?: TwinRiskSurveyResult; error?: string } | null;
      if (!response.ok || !payload?.profile) throw new Error(payload?.error ?? "투자 성향 기록을 저장하지 못했습니다.");
      setResult(payload.profile);
      setPhase("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "투자 성향 기록을 저장하지 못했습니다.");
      setAnswers((current) => current.slice(0, -1));
    } finally { setSaving(false); }
  };

  if (phase === "loading") return <div className="journal-risk-survey-intro"><div><span>현재 나의 투자 성향</span><strong>진단 기록을 확인하고 있습니다.</strong><p>첫 시뮬레이션 전 5개 질문을 한 번 완료해야 합니다.</p></div><LoaderCircle size={18} className="spin" /></div>;

  if (phase === "intro") {
    return <div className="journal-risk-survey-intro">
      <div><span>간편 투자 성향 진단</span><strong>5개 선택으로 내 위험감수 성향을 알아보세요.</strong><p>약 1분 소요 · 모의투자 학습용 참고 진단</p></div>
      <button type="button" onClick={start}>진단 시작하기 <ArrowRight size={15} /></button>
    </div>;
  }

  if (phase === "questions") {
    const questionIndex = answers.length;
    const question = TWIN_RISK_SURVEY_QUESTIONS[questionIndex];
    return <div className="journal-risk-survey" aria-live="polite">
      <div className="journal-risk-survey-head"><span>간편 투자 성향 진단</span><b>{questionIndex + 1} / {TWIN_RISK_SURVEY_QUESTIONS.length}</b></div>
      <div className="journal-risk-survey-progress"><i style={{ width: `${((questionIndex + 1) / TWIN_RISK_SURVEY_QUESTIONS.length) * 100}%` }} /></div>
      <h3>{question.prompt}</h3>
      <div className="journal-risk-survey-choices">
        {question.choices.map((choice) => <button key={choice.label} type="button" disabled={saving} onClick={() => { void selectAnswer(choice.score); }}>{choice.label}<ChevronRight size={15} /></button>)}
      </div>
      {questionIndex > 0 && <button type="button" className="journal-risk-survey-back" onClick={() => setAnswers((current) => current.slice(0, -1))}>이전 질문</button>}
      {error && <p className="journal-risk-survey-error">{error}</p>}
    </div>;
  }

  const profile = twinRiskProfile(result?.score ?? 0);
  return <div className={`journal-risk-survey-result ${profile.tone}`}>
    <div><span>진단 결과 · {result?.score ?? 0} / 20점</span><h3>나의 투자 성향은 <b>{profile.label}</b>입니다.</h3><p>{profile.description}</p></div>
    <button type="button" onClick={start}>다시 진단하기</button>
    <small>이 결과는 금융상품 권유나 법정 적합성 평가가 아닌 모의투자 학습용 참고 정보입니다.</small>
  </div>;
}

type TwinPinDatum = { event: TwinRevealedEvent; index: number; barIndex: number; bar: TwinBar; cumulativePct: number; isUp: boolean; category: string };

/** ForecastChart와 같은 캔버스 패턴(그리드, 심지+몸통 캔들, 실제/시뮬레이션 분할선)으로
 *  선택한 실행의 캔들 경로를 그리고, 공개된 이벤트를 번호 핀으로 오버레이한다. */
function TwinCandleChart({ detail }: { detail: TwinGameDetail }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<{ x: (index: number) => number; y: (value: number) => number; bars: TwinBar[] } | null>(null);
  const bars = useMemo(() => buildTwinBars(detail), [detail]);
  const events = useMemo(
    () => (detail.revealed_events ?? []).slice().sort((a, b) => a.sequence - b.sequence),
    [detail.revealed_events],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bars.length < 2) { setLayout(null); return; }

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const pad = { top: 20, right: 22, bottom: 40, left: 68 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;

      const rawMax = Math.max(...bars.map((bar) => bar.high), detail.initial_reference_price);
      const rawMin = Math.min(...bars.map((bar) => bar.low), detail.initial_reference_price);
      const vpad = (rawMax - rawMin) * 0.14 || rawMax * 0.02;
      const max = rawMax + vpad;
      const min = rawMin - vpad;

      const x = (index: number) => pad.left + (index / Math.max(bars.length - 1, 1)) * plotW;
      const y = (value: number) => pad.top + ((max - value) / (max - min)) * plotH;

      const lineColor = twinCssVar("--line", "#e8eaf0");
      const lightColor = twinCssVar("--light", "#9aa0ab");
      const mutedColor = twinCssVar("--muted", "#6d7380");
      const upColor = twinCssVar("--up", "#d64c53");
      const downColor = twinCssVar("--down", "#0769ff");
      const inkColor = twinCssVar("--ink", "#0b0d14");

      ctx.clearRect(0, 0, width, height);
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.fillStyle = lightColor;
      ctx.textAlign = "right";
      const ticks = 4;
      for (let i = 0; i <= ticks; i += 1) {
        const value = min + (i / ticks) * (max - min);
        const py = y(value);
        ctx.beginPath();
        ctx.moveTo(pad.left, py);
        ctx.lineTo(width - pad.right, py);
        ctx.stroke();
        ctx.fillText(Math.round(value).toLocaleString("ko-KR"), pad.left - 10, py + 3);
      }

      const candleWidth = Math.max(2.5, Math.min(14, (plotW / bars.length) * 0.6));
      const simStart = bars.findIndex((bar) => !bar.real);
      bars.forEach((bar, index) => {
        const px = x(index);
        const color = bar.close >= bar.open ? upColor : downColor;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, y(bar.high));
        ctx.lineTo(px, y(bar.low));
        ctx.stroke();
        const bodyTop = Math.min(y(bar.open), y(bar.close));
        const bodyHeight = Math.max(1.5, Math.abs(y(bar.open) - y(bar.close)));
        ctx.fillStyle = color;
        ctx.fillRect(px - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      });

      ctx.textAlign = "center";
      ctx.fillStyle = lightColor;
      ctx.font = '10px "Pretendard Variable", sans-serif';
      [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round((bars.length - 1) * ratio)).forEach((idx) => {
        const label = formatTwinShortDate(bars[idx]?.date);
        if (label) ctx.fillText(label, x(idx), height - 12);
      });

      if (simStart > 0) {
        const splitX = (x(simStart - 1) + x(simStart)) / 2;
        ctx.strokeStyle = inkColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(splitX, pad.top);
        ctx.lineTo(splitX, height - pad.bottom);
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.fillStyle = mutedColor;
        ctx.font = '9.5px "Pretendard Variable", sans-serif';
        ctx.fillText("시뮬레이션 시작", splitX, height - pad.bottom + 14);

        ctx.fillStyle = inkColor;
        ctx.fillRect(splitX - 22, height - 24, 44, 20);
        ctx.fillStyle = "#fff";
        ctx.font = '700 10px "Pretendard Variable", sans-serif';
        ctx.fillText(formatTwinShortDate(bars[simStart]?.date), splitX, height - 10);
      }

      setLayout({ x, y, bars });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [bars, detail.initial_reference_price]);

  const pins = useMemo<TwinPinDatum[]>(() => {
    if (!layout) return [];
    return events.flatMap((event, index) => {
      const barIndex = layout.bars.findIndex((bar) => !bar.real && bar.date === event.event_date);
      if (barIndex < 0) return [];
      const bar = layout.bars[barIndex];
      const cumulativePct = ((bar.close - detail.initial_reference_price) / detail.initial_reference_price) * 100;
      return [{ event, index, barIndex, bar, cumulativePct, isUp: cumulativePct >= 0, category: twinCategoryLabel(event.ontology_source) }];
    });
  }, [layout, events, detail.initial_reference_price]);

  if (bars.length < 2) {
    return (
      <div className="journal-empty">
        <CandlestickChart size={24} />
        <strong>표시할 캔들 데이터가 없습니다</strong>
        <p>이 실행에는 아직 가격 이력이 충분하지 않습니다.</p>
      </div>
    );
  }

  return (
    <>
      <div className="journal-candle-wrap">
        <canvas ref={canvasRef} className="journal-candle-canvas" aria-label={`${detail.name} 시나리오 캔들 차트`} />
        {layout && (
          <div className="journal-event-pins">
            {pins.map((pin) => {
              const anchorPrice = pin.isUp ? pin.bar.high : pin.bar.low;
              const px = layout.x(pin.barIndex);
              const py = layout.y(anchorPrice) + (pin.isUp ? -16 : 16);
              return (
                <div key={pin.event.event_id} className="journal-event-pin" style={{ left: px, top: py }}>
                  <button type="button" className={`journal-event-pin-badge ${pin.isUp ? "journal-badge-up" : "journal-badge-down"}`} aria-label={`이벤트 ${pin.index + 1} 상세 보기`}>
                    {pin.index + 1}
                  </button>
                  <div className="journal-event-tooltip">
                    <div className="journal-event-tooltip-top">
                      <span>{formatTwinShortDate(pin.event.event_date)} · {pin.category}</span>
                      <b className={pin.isUp ? "up" : "down"}>{twinSignedPct(pin.cumulativePct)}</b>
                    </div>
                    <h4>{pin.event.title}</h4>
                    <p>{pin.event.description || pin.event.pre_brief || "세부 설명이 제공되지 않았습니다."}</p>
                    <em>이 시점 누적 수익률 {twinSignedPct(pin.cumulativePct)}</em>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="journal-event-strip">
        {pins.map((pin) => (
          <div key={pin.event.event_id} className="journal-event-chip">
            <button type="button" className="journal-event-chip-btn">
              <span className={`journal-event-chip-idx ${pin.isUp ? "journal-badge-up" : "journal-badge-down"}`}>{pin.index + 1}</span>
              {formatTwinShortDate(pin.event.event_date)} · {pin.category}
            </button>
            <div className="journal-event-tooltip">
              <div className="journal-event-tooltip-top">
                <span>{formatTwinShortDate(pin.event.event_date)} · {pin.category}</span>
                <b className={pin.isUp ? "up" : "down"}>{twinSignedPct(pin.cumulativePct)}</b>
              </div>
              <h4>{pin.event.title}</h4>
              <p>{pin.event.description || pin.event.pre_brief || "세부 설명이 제공되지 않았습니다."}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TwinPage({ onRequireAuth }: { onRequireAuth?: (action: () => void) => void }) {
  const [games, setGames] = useState<TwinGameSummary[]>([]);
  const [gamesState, setGamesState] = useState<"loading" | "ready" | "error">("loading");
  const [twinSessions, setTwinSessions] = useState<TwinSession[]>([]);
  const [assessmentsState, setAssessmentsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [gameDetails, setGameDetails] = useState<Record<string, TwinGameDetail | "error">>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [regeneratingReportId, setRegeneratingReportId] = useState<string | null>(null);
  const [journalPaperTradingOpen, setJournalPaperTradingOpen] = useState(false);
  const detailRequest = useRef(0);

  useEffect(() => {
    let active = true;
    setGamesState("loading");
    fetchPaperTradingJson<TwinGameSummary[]>("/games?summary=1")
      .then((data) => {
        if (!active) return;
        const scenarioGames = data
          .filter((game) => game.mode === "scenario" || game.mode === "world")
          .sort((a, b) => (a.created_at ?? a.updated_at ?? "").localeCompare(b.created_at ?? b.updated_at ?? ""));
        setGames(scenarioGames);
        setGamesState("ready");
      })
      .catch(() => { if (active) setGamesState("error"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (gamesState !== "ready" || games.length === 0) return;
    let active = true;
    const targets = games.slice(-TWIN_ASSESSMENT_CAP);
    setAssessmentsState("loading");
    Promise.allSettled(
      targets.map((game) => fetchPaperTradingJson<TwinAssessment>(`/scenarios/${game.game_id}/assessment`).then((assessment) => ({ game, assessment }))),
    ).then((results) => {
      if (!active) return;
      const sessions = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      setTwinSessions(sessions);
      setAssessmentsState(sessions.length > 0 ? "ready" : "error");
    });
    return () => { active = false; };
  }, [gamesState, games]);

  const loadDetail = useCallback((gameId: string) => {
    const requestId = ++detailRequest.current;
    setLoadingDetailId(gameId);
    fetchPaperTradingJson<TwinGameDetail>(`/games/${gameId}`)
      .then((detail) => { if (detailRequest.current === requestId) setGameDetails((current) => ({ ...current, [gameId]: detail })); })
      .catch(() => { if (detailRequest.current === requestId) setGameDetails((current) => ({ ...current, [gameId]: "error" })); })
      .finally(() => { if (detailRequest.current === requestId) setLoadingDetailId(null); });
  }, []);

  const regenerateReports = useCallback(async (gameId: string) => {
    setRegeneratingReportId(gameId);
    try {
      const job = await postPaperTradingJson<{ job_id: string }>(`/scenarios/${gameId}/actions`, { action: "report" });
      const poll = async () => {
        const current = await fetchPaperTradingJson<{ status?: string; error?: string }>(`/scenario-jobs/${job.job_id}`);
        if (current.status === "completed") {
          loadDetail(gameId);
          setRegeneratingReportId(null);
          return;
        }
        if (current.status === "failed") {
          setRegeneratingReportId(null);
          return;
        }
        window.setTimeout(() => { void poll(); }, 1400);
      };
      await poll();
    } catch {
      setRegeneratingReportId(null);
    }
  }, [loadDetail]);

  useEffect(() => {
    if (games.length === 0 || selectedGameId) return;
    setSelectedGameId(games[games.length - 1].game_id);
  }, [games, selectedGameId]);

  useEffect(() => {
    if (!selectedGameId || selectedGameId in gameDetails || loadingDetailId === selectedGameId) return;
    loadDetail(selectedGameId);
  }, [selectedGameId, gameDetails, loadingDetailId, loadDetail]);

  const stockGroups = useMemo(() => {
    const groups = new Map<string, { ticker: string; name: string; games: TwinGameSummary[] }>();
    games.forEach((game) => {
      const group = groups.get(game.ticker) ?? { ticker: game.ticker, name: game.name, games: [] };
      group.games.push(game);
      groups.set(game.ticker, group);
    });
    return Array.from(groups.values())
      .map((group) => ({ ...group, games: group.games.slice().sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")) }))
      .sort((a, b) => (b.games.at(-1)?.updated_at ?? "").localeCompare(a.games.at(-1)?.updated_at ?? ""));
  }, [games]);

  const currentSession = twinSessions.at(-1);
  const selectedSummary = games.find((game) => game.game_id === selectedGameId);
  const selectedDetail = selectedGameId ? gameDetails[selectedGameId] : undefined;
  const openPaperTrading = () => {
    const open = () => setJournalPaperTradingOpen(true);
    if (onRequireAuth) onRequireAuth(open);
    else open();
  };

  return (
    <div className="journal-page">
      <header className="page-heading journal-heading">
        <div><h1>모의투자로 알게 된 내 투자 성향과, 종목별 실험 결과를 한눈에 확인하세요.</h1></div>
      </header>

      <section className="panel">
        <div className="panel-title">
          <div><h2>현재 나의 투자 성향</h2></div>
        </div>
        <div className="journal-summary-body">
          <TwinRiskProfileSurvey />
          {gamesState === "loading" || (gamesState === "ready" && games.length > 0 && (assessmentsState === "loading" || assessmentsState === "idle")) ? (
            <div className="journal-investment-style-status journal-loading"><LoaderCircle size={16} className="spin" /> 모의투자 기록 기반 성향을 불러오는 중…</div>
          ) : gamesState === "error" ? (
            <div className="journal-investment-style-status journal-error">모의투자 기록 기반 성향을 불러오지 못했습니다.</div>
          ) : games.length === 0 ? (
            <p className="journal-investment-style-status">모의투자를 완료하면 실제 선택과 거래 기록을 바탕으로 한 성향 분석도 함께 표시됩니다.</p>
          ) : currentSession ? (
            <div className="journal-investment-style-status">
              <div className="journal-current-style-row">
                <span className="journal-current-style-label">모의투자 기반 관찰</span>
                <span className="journal-style-pill journal-style-pill-lg" style={{ background: twinStyleShade(currentSession.assessment.style), color: twinStyleTextColor(currentSession.assessment.style) }}>
                  {currentSession.assessment.style ?? "판정 전"}
                </span>
                <span className="journal-current-style-date">{formatTwinDate(currentSession.game.created_at ?? currentSession.game.updated_at)} 기준</span>
              </div>
              <p className="journal-current-style-desc">{twinStyleNarrative(twinSessions)}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div><h2>종목별 이벤트 시나리오 실험</h2></div>
        </div>
        {gamesState === "loading" ? (
          <div className="journal-loading"><LoaderCircle size={16} className="spin" /> 불러오는 중…</div>
        ) : gamesState === "error" ? (
          <div className="journal-error">실험 목록을 불러오지 못했습니다.</div>
        ) : games.length === 0 ? (
          <TwinEmptyState onOpen={openPaperTrading} />
        ) : (
          <div className="journal-lab-body">
            <nav className="journal-lab-sidebar" aria-label="종목·실행 선택">
              {stockGroups.map((group) => (
                <div className="journal-lab-stock-group" key={group.ticker}>
                  <div className="journal-lab-stock-group-head"><strong>{group.name}</strong><span>{group.ticker}</span></div>
                  {group.games.map((game, index) => (
                    <button key={game.game_id} type="button" className={`journal-lab-run-btn ${selectedGameId === game.game_id ? "active" : ""}`} onClick={() => setSelectedGameId(game.game_id)}>
                      <span className="journal-lab-run-btn-top"><b>실행 {index + 1}</b></span>
                      <span className="journal-lab-run-btn-meta">
                        <span>{formatTwinDate(game.created_at ?? game.updated_at)} 시작</span>
                        <span className={game.total_return_pct == null ? "" : twinTone(game.total_return_pct)}>
                          {game.total_return_pct == null ? (game.phase === "completed" ? "-" : "진행 중") : twinSignedPct(game.total_return_pct)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            <div className="journal-lab-main">
              {!selectedSummary ? null : loadingDetailId === selectedGameId || selectedDetail === undefined ? (
                <div className="journal-loading"><LoaderCircle size={16} className="spin" /> 불러오는 중…</div>
              ) : selectedDetail === "error" ? (
                <div className="journal-error">실행 데이터를 불러오지 못했습니다. <button type="button" onClick={() => loadDetail(selectedSummary.game_id)}>다시 시도</button></div>
              ) : (
                <>
                  <div className="journal-lab-run-head">
                    <div>
                      <h3>{selectedDetail.name} ({selectedDetail.ticker})</h3>
                      <p>{formatTwinDate(selectedSummary.created_at ?? selectedSummary.updated_at)} 시작 · 시작가 {twinWon(selectedDetail.initial_reference_price)} · 이벤트 {(selectedDetail.revealed_events ?? []).length}/{selectedSummary.total_events}개 공개</p>
                    </div>
                    <div className="journal-lab-run-return">
                      <span>누적 수익률</span>
                      <b className={twinTone(selectedDetail.portfolio?.total_return_pct ?? 0)}>{twinSignedPct(selectedDetail.portfolio?.total_return_pct ?? 0)}</b>
                    </div>
                  </div>
                  <div className="journal-lab-chart-layout">
                    <div className="journal-lab-chart-column">
                      <TwinCandleChart detail={selectedDetail} />
                    </div>
                    <TwinReviewMilestoneRail detail={selectedDetail} />
                  </div>
                  <TwinStoredReports detail={selectedDetail} regenerating={regeneratingReportId === selectedDetail.game_id} onRegenerate={() => { void regenerateReports(selectedDetail.game_id); }} />
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {journalPaperTradingOpen && <PaperTradingModal onClose={() => setJournalPaperTradingOpen(false)} onProfileRequired={() => setJournalPaperTradingOpen(false)} />}
    </div>
  );
}

function MockNavigation({ activeTab, onActivate, onShowIntro, user, onLogin, onLogout }: {
  activeTab: MainTab;
  onActivate: (tab: MainTab) => void;
  onShowIntro: () => void;
  user: AuthUser | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="mock-journal-header">
      <button className="mock-journal-brand" type="button" onClick={() => onActivate("market")} aria-label="FINVERSE 홈">
        finverse<span>.</span>
      </button>
      <nav className="mock-journal-nav" aria-label="주 메뉴">
        <button type="button" onClick={onShowIntro}>서비스 소개</button>
        <button type="button" onClick={() => onActivate("market")} aria-current={activeTab === "market" ? "page" : undefined}>시장 시뮬레이션</button>
        <button type="button" onClick={() => onActivate("twin")} aria-current={activeTab === "twin" ? "page" : undefined}>나의 투자 일지</button>
      </nav>
      {user ? (
        <div className="mock-journal-account">
          <span title={user.email}>{user.email}</span>
          <button type="button" onClick={onLogout}>로그아웃</button>
        </div>
      ) : <button className="mock-journal-login" type="button" onClick={onLogin} aria-label="로그인">로그인</button>}
    </header>
  );
}

function ServiceIntro({ onEnter, onOpenJournal }: { onEnter: () => void; onOpenJournal: () => void }) {
  return (
    <main className="intro-smoke">
      <header className="intro-smoke-topbar">
        <div className="intro-smoke-wrap intro-smoke-topbar-inner">
          <button className="intro-smoke-brand" type="button" onClick={onEnter}>finverse<span>.</span></button>
        </div>
      </header>

      <section className="intro-smoke-hero" aria-labelledby="service-intro-title">
        <div className="intro-smoke-wrap intro-smoke-hero-inner">
          <div className="intro-smoke-hero-copy">
            <h1 id="service-intro-title">아는 것과,<br />행동하는 것은 다릅니다.</h1>
            <div className="intro-smoke-rule" />
            <p className="intro-smoke-hero-close">FINVERSE는 판단과 행동의 간격을 훈련합니다.</p>
            <p className="intro-smoke-hero-lede">사람은 불안, 손실 회피, 군집 심리와 정보 과부하 속에서 세워 둔 원칙을 지키기 어렵습니다.<br /><b>FINVERSE</b>는 그 판단 오류를 안전하게 발견하고 다음 행동 기준으로 바꾸도록 돕습니다.</p>
            <div className="intro-smoke-hero-actions">
              <button className="intro-smoke-cta" type="button" onClick={onEnter}>시장 시뮬레이션 시작하기 <ArrowRight size={17} /></button>
              <p className="intro-smoke-note">실제 계좌와 연결하지 않는 모의투자 학습 서비스입니다.</p>
            </div>
          </div>
          <div className="intro-smoke-hero-preview-wrap">
            <figure className="intro-smoke-hidden-chart intro-smoke-real-preview">
              <img src="/intro/conditional-simulation.png" alt="삼성전자 조건부 반등 시뮬레이션과 발생 가능 이벤트 예시" />
            </figure>
          </div>
        </div>
      </section>

      <section className="intro-smoke-gap intro-smoke-wrap">
        <div className="intro-smoke-gap-heading"><div><span>계획과 실제</span><h2>알고 있는 것과<br />행동하는 것 사이</h2><p>FINVERSE가 다루는 것은 지식의 부족이 아닙니다.<br />시장이 급등락하는 순간에는 불안과 손실 회피 때문에 알고 있던 원칙을 지키기 어렵습니다.</p></div></div>
        <div className="intro-smoke-gap-row"><em>01</em><div><p>세운 원칙</p><strong>손절선을 정해두고,</strong></div><i>→</i><div><p>실제 순간</p><strong>막상 그 가격이 오면 물타기를 합니다.</strong></div></div>
        <div className="intro-smoke-gap-row"><em>02</em><div><p>세운 원칙</p><strong>뉴스 보고는 안 산다면서,</strong></div><i>→</i><div><p>실제 순간</p><strong>뉴스가 뜨면 이미 판단을 바꿉니다.</strong></div></div>
      </section>

      <section className="intro-smoke-errors">
        <div className="intro-smoke-wrap">
          <span className="intro-smoke-tag">풀고자 하는 금융 현안</span>
          <h2>불확실한 순간에는,<br />판단 오류가 반복됩니다.</h2>
          <p className="intro-smoke-errors-lede">시장 급등락과 금리·환율 변화처럼 불확실성이 큰 순간에는 장기 목표와 위험 감내 수준보다 감정과 주변 정보가 먼저 판단을 이끌기 쉽습니다. FINVERSE는 아래와 같은 순간을 안전한 가상 환경에서 먼저 마주하게 합니다.</p>
          <div className="intro-smoke-error-grid">
            <article><span>급등</span><h3>“더 오를 것 같아” 추격합니다</h3><p>삼성전자 실적 기대가 커지며 주가가 급등한 날, 놓칠까 봐 불안해 계획보다 큰 비중을 한 번에 매수하는 상황입니다.</p><b>확인할 것 · 이미 반영된 기대와 실적 근거는 다른가?</b></article>
            <article><span>급락</span><h3>“더 떨어지기 전에” 포기합니다</h3><p>SK하이닉스가 수급 악화나 시장 공포로 하락한 날, 정해둔 기준을 점검하기 전에 공포 매도로 장기 계획을 끝내는 상황입니다.</p><b>확인할 것 · 가격 하락과 투자 근거 훼손을 구분했는가?</b></article>
            <article><span>미루기</span><h3>기준 점검을 다음으로 미룹니다</h3><p>보유 비중, 현금 여력, 손실 감내 범위는 평소에 정리하지 않고 사건이 터진 뒤에야 대응하려는 상황입니다.</p><b>확인할 것 · 판단 전에 나의 가상 투자 상태를 확인했는가?</b></article>
            <article><span>추종</span><h3>내 기준보다 타인의 확신을 따릅니다</h3><p>뉴스·커뮤니티·주변 의견이 강해질수록 삼성전자나 SK하이닉스의 흐름을 내 목표와 무관하게 따라가는 상황입니다.</p><b>확인할 것 · 정보의 출처와 내 판단 근거를 분리했는가?</b></article>
          </div>
          <p className="intro-smoke-errors-note">종목명은 판단 연습을 위한 예시이며, 특정 종목이나 금융상품의 매수·매도를 권유하지 않습니다.</p>
        </div>
      </section>

      <section className="intro-smoke-feature">
        <div className="intro-smoke-wrap intro-smoke-feature-grid">
          <div><span className="intro-smoke-tag">아는 것</span><h2>가격이 아니라<br />조건을 봅니다</h2><p>종목을 고르면 시장·경제·사건·커뮤니티의 정보를 <b>온톨로지</b>로 연결합니다. 같은 원인에서 나온 뉴스와 지표를 하나의 흐름으로 묶어, 가격 뒤에 있는 사건·주체·영향을 함께 볼 수 있게 합니다.</p><p>숫자를 정답처럼 던지지 않고, <b>사건·주체·영향이 어떻게 연결되는지</b>와 그 흐름을 확인할 근거를 함께 보여줍니다.</p></div>
          <div className="intro-smoke-mock"><header><span>시장 시뮬레이션 · 초기 상황</span><span>최근 한 달 · 실제 근거 기반</span></header><strong>삼성전자 <small>005930</small></strong><ul className="intro-smoke-ontology"><li><b>시장</b><span>삼성전자 주가·거래량과 외국인·기관 수급의 최근 흐름을 요약합니다.</span></li><li><b>경제</b><span>한국은행 기준금리 인상과 환율·거시지표가 업종에 미치는 영향을 정리합니다.</span></li><li><b>사건</b><span>주주환원 확대, 반도체 실적 등 종목과 직접 연결된 주요 사건을 묶습니다.</span></li><li><b>커뮤니티</b><span>온라인 투자 반응과 참여 추이를 통해 시장 심리의 변화를 살펴봅니다.</span></li></ul><footer>4개 온톨로지 정보의 Evidence 문서를 바탕으로 초기 상황을 요약합니다.</footer></div>
        </div>
      </section>

      <section className="intro-smoke-feature intro-smoke-primary">
        <div className="intro-smoke-wrap intro-smoke-feature-grid">
          <div><span className="intro-smoke-tag">하는 것</span><h2>결과를 모른 채,<br />판단을 남깁니다</h2><p><b>World Agent</b>는 실제 시장 근거와 초기 상황을 바탕으로 아직 일어나지 않은 사건과 시장 환경을 가상 미래로 구성합니다. 그 환경을 거래일마다 한 단계씩 진행하며 가격·수급·사건의 공개 시점을 갱신합니다. 중요한 사건은 공개되기 전 사용자의 판단을 먼저 남깁니다.</p><p><b>개인·외국인·기관·연기금으로 나뉜 멀티 에이전트</b>가 서로 다른 투자 기준과 위험 감내 수준으로 반응하고, 그 행동이 다음 거래일의 가상 가격과 수급을 만듭니다. 사용자의 판단은 시장을 바꾸지 않는 학습 기록으로만 보존됩니다.</p></div>
          <div className="intro-smoke-mock"><header><span>투자 시뮬레이션 · 오늘의 판단</span><span>D-1</span></header><strong>중요한 사건이 다가오고 있습니다.</strong><p>내용은 아직 공개되지 않았습니다.</p><div className="intro-smoke-choice"><span>내일 매수 고려</span><b>관찰 계속</b><span>내일 매도 고려</span></div><footer>사용자 판단은 시장 가격이나 수급에 영향을 주지 않는 학습 기록입니다.</footer></div>
        </div>
      </section>

      <section className="intro-smoke-feature">
        <div className="intro-smoke-wrap intro-smoke-feature-grid intro-smoke-reverse">
          <div><span className="intro-smoke-tag">그 사이</span><h2>당신은 어떤<br />투자자인가요?</h2><p><b>수익률만 보지 않습니다.</b> 알고 있던 원칙을 실제 시장 상황에서도 행동으로 옮겼는지, 사건 전후에 판단 기준이 어떻게 바뀌었는지를 함께 돌아봅니다.</p><p>급등할 때 계획보다 크게 추격했는지, 급락할 때 근거를 확인하기 전에 포기했는지, 점검을 미뤘는지, 다른 사람의 확신을 내 판단처럼 따랐는지를 실제 일자별 기록과 비교합니다.</p><p>완료된 모의투자의 나의 투자 일지와 시나리오 보고서에서 <b>내가 알고 있던 것·실제로 선택한 행동·그 다음 결과</b>를 나란히 확인할 수 있습니다.</p><button className="intro-smoke-link" type="button" onClick={onOpenJournal}>나의 투자 일지 보기 <ArrowRight size={16} /></button></div>
          <div className="intro-smoke-mock"><header><span>나의 투자 일지</span><span>완료 보고서</span></header><p>현재 나의 투자 성향</p><strong className="intro-smoke-type">판단 패턴을 돌아볼 차례입니다.</strong><div className="intro-smoke-report-lines"><i /><i /><i /></div><footer>가상 시나리오의 행동을 바탕으로 한 교육용 분석입니다.</footer></div>
        </div>
      </section>

      <section className="intro-smoke-solution">
        <div className="intro-smoke-wrap">
          <span className="intro-smoke-tag">FINVERSE의 해결</span>
          <h2>정답을 주는 대신,<br />판단하는 힘을 기릅니다.</h2>
          <p>FINVERSE는 금융소비자의 비합리성을 없애거나 미래 시장을 정확히 예측하려 하지 않습니다. 시장을 이해하는 단계부터 개인의 판단을 돌아보는 단계까지 하나의 경험으로 연결합니다.</p>
          <ol>
            <li><b>01</b><strong>사건과 뉴스를 구조화합니다</strong><span>복잡한 시장 정보와 금융 용어를 근거별로 나누어 현재 맥락을 읽기 쉽게 만듭니다.</span></li>
            <li><b>02</b><strong>시장과 종목의 환경을 확인합니다</strong><span>가격만 보지 않고 수급·경제·사건·심리의 조건을 함께 살펴봅니다.</span></li>
            <li><b>03</b><strong>조건과 불확실성을 함께 봅니다</strong><span>단일 숫자를 정답처럼 제시하지 않고, 관찰할 조건과 경로가 달라지는 신호를 확인합니다.</span></li>
            <li><b>04</b><strong>시장 변화 속에서 판단을 연습합니다</strong><span>World Agent 시뮬레이션에서 중요한 사건과 시장 참여자 반응을 마주하며 판단을 기록합니다.</span></li>
            <li><b>05</b><strong>나의 가상 투자 상태에 연결합니다</strong><span>시작 자금 또는 기존 보유를 기준으로, 시장 변화가 내 가상 포트폴리오에 미치는 영향을 확인합니다.</span></li>
            <li><b>06</b><strong>AI가 판단 과정을 되돌려 줍니다</strong><span>완료 보고서에서 선택의 흐름과 반복된 판단 패턴을 살피고 다음 행동 기준을 정리합니다.</span></li>
          </ol>
        </div>
      </section>

      <section className="intro-smoke-closing"><h2>멀티 AI 에이전트가 만드는 가상 미래에서,<br />나의 기준으로 판단해 보세요.</h2><button className="intro-smoke-cta" type="button" onClick={onEnter}>시장 시뮬레이션 시작하기 <ArrowRight size={17} /></button></section>
      <footer className="intro-smoke-footer">AI 분석 기반 참고 자료이며 투자 판단의 최종 책임은 본인에게 있습니다. FINVERSE는 실제 계좌와 연동하지 않습니다.</footer>
    </main>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>("market");
  const [introVisible, setIntroVisible] = useState(true);
  const [paperTradingOpen, setPaperTradingOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authIntent, setAuthIntent] = useState<(() => void) | null>(null);
  const { user: authUser, refresh: refreshAuthUser, logout: logoutAuthUser } = useAuthUser();

  const requireAuth = (action: () => void) => {
    if (authUser) {
      action();
      return;
    }
    setAuthIntent(() => action);
    setAuthOpen(true);
  };
  const [kospiData, setKospiData] = useState<KospiMarketData | null>(null);
  const [intradayIndices, setIntradayIndices] = useState<IntradayIndex[]>([]);
  const [dashboardSignals, setDashboardSignals] = useState<DashboardSignal[]>(marketSignals);
  const [marketBrief, setMarketBrief] = useState<string[]>(defaultMarketBrief);
  const [marketBriefExpanded, setMarketBriefExpanded] = useState(false);
  const [selectedMarketSignal, setSelectedMarketSignal] = useState<DashboardSignal | null>(null);
  const [watchlist, setWatchlist] = useState<WatchSymbol[]>(followedSymbols);
  const [selectedSymbol, setSelectedSymbol] = useState<WatchSymbol>(followedSymbols[0]);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [symbolResults, setSymbolResults] = useState<Security[]>([]);
  const [symbolSearching, setSymbolSearching] = useState(false);
  const [tickerSources, setTickerSources] = useState<TickerSource[] | null>(null);
  const [tickerSourcesError, setTickerSourcesError] = useState<string | null>(null);
  const [symbolCandles, setSymbolCandles] = useState<{ ticker: string; data: KospiMarketData } | null>(null);
  const [selectedScenario, setSelectedScenario] = useState(scenarios[0]);
  const [scenarioDetailOpen, setScenarioDetailOpen] = useState(false);
  const [scenarioEditorial, setScenarioEditorial] = useState<ScenarioEditorial>(() => fallbackEditorial(scenarios[0]));
  const [editorialState, setEditorialState] = useState<EditorialState>("fallback");
  const [editorialMeta, setEditorialMeta] = useState<{ generatedAt: string; model: string } | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<"form" | "build" | "run">("form");
  const [buildStage, setBuildStage] = useState<BuildStage>(1);
  const [ontologyRunState, setOntologyRunState] = useState<OntologyRunState>("idle");
  const [ontologyLogs, setOntologyLogs] = useState<OntologyLog[]>([]);
  const [ontologyDocuments, setOntologyDocuments] = useState<OntologyDocument[]>([]);
  const [ontologyOutputDir, setOntologyOutputDir] = useState<string | null>(null);
  const [mirofishRun, setMirofishRun] = useState<MirofishRun | null>(null);
  const [mirofishProgress, setMirofishProgress] = useState<MirofishProgress | null>(null);
  const [ontologySchema, setOntologySchema] = useState<OntologySchema | null>(null);
  const [graphSnapshot, setGraphSnapshot] = useState<LiveGraphSnapshot | null>(null);
  const [simulationStarting, setSimulationStarting] = useState(false);
  const [simulationStarted, setSimulationStarted] = useState(false);
  const [simulationSession, setSimulationSession] = useState<SimulationSession | null>(null);
  const [simulationChatMessages, setSimulationChatMessages] = useState<SimulationChatMessage[]>([]);
  const [simulationChatSending, setSimulationChatSending] = useState(false);
  const [simulationRuntimeError, setSimulationRuntimeError] = useState<string | null>(null);
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(["외국인 순매수 회복", "SK하이닉스 실적 서프라이즈"]);
  const [period, setPeriod] = useState("30일");
  const [scenarioPrompt, setScenarioPrompt] = useState("현재 코스피 시장에서 반도체 실적과 외국인 수급 변화가 향후 1개월 코스피에 미칠 영향은 무엇인가");
  const [uploadedSeedFile, setUploadedSeedFile] = useState<UploadedSeed | null>(null);
  const scenarioScrollY = useRef<number | null>(null);
  const buildTimer = useRef<number | null>(null);
  const editorialRequest = useRef(0);
  const editorialCache = useRef(new Map<string, { editorial: ScenarioEditorial; generatedAt: string; model: string }>());
  const liveKospi = intradayIndices.find((index) => index.key === "KOSPI");
  const liveKospiLatest = liveKospi?.points.at(-1);
  const liveKospiPreviousClose = liveKospiLatest ? liveKospiLatest.close / (1 + liveKospiLatest.changePct / 100) : undefined;
  const kospiValue = liveKospiLatest?.close ?? kospiData?.value ?? 6023.66;
  const kospiChange = liveKospiLatest && liveKospiPreviousClose !== undefined
    ? liveKospiLatest.close - liveKospiPreviousClose
    : kospiData?.change ?? -732.09;
  const kospiRate = liveKospiLatest?.changePct ?? kospiData?.rate ?? -10.84;
  const kospiTone = kospiChange >= 0 ? "up" : "down";
  const kospiAsOf = liveKospiLatest?.date.slice(0, 10) ?? kospiData?.latestDate ?? "2026-07-28";
  const kospiAsOfDigits = kospiAsOf.replace(/-/g, "");
  const kospiAsOfLabel = `${kospiAsOfDigits.slice(0, 4)}.${Number(kospiAsOfDigits.slice(4, 6))}.${Number(kospiAsOfDigits.slice(6, 8))}`;

  const enterService = useCallback((tab: MainTab = "market") => {
    setActiveTab(tab);
    setIntroVisible(false);
  }, []);

  useEffect(() => {
    let active = true;
    const loadDashboardSignals = async () => {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { signals?: DashboardSignal[]; marketBrief?: { lines?: string[] } | null };
        if (active && payload.signals?.length === 4) setDashboardSignals(payload.signals);
        if (active && payload.marketBrief?.lines && payload.marketBrief.lines.length >= 2) {
          setMarketBrief(payload.marketBrief.lines.slice(0, 3));
        }
      } catch {
        // Keep the static preview while the database is unavailable.
      }
    };
    loadDashboardSignals();
    const timer = window.setInterval(loadDashboardSignals, 5 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const loadKospi = async () => {
      try {
        const response = await fetch("/api/kospi", { cache: "no-store" });
        if (!response.ok) return;
        const nextData = await response.json() as KospiMarketData;
        if (active) setKospiData(nextData);
      } catch {
        // Keep the static preview while the remote PostgreSQL bridge is unavailable.
      }
    };
    loadKospi();
    const timer = window.setInterval(loadKospi, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const loadIntradayIndices = async () => {
      try {
        const response = await fetch("/api/market-indices", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { indices: IntradayIndex[] };
        if (active) setIntradayIndices(payload.indices);
      } catch {
        // Keep the main-branch preview values while the live source is unavailable.
      }
    };
    loadIntradayIndices();
    const timer = window.setInterval(loadIntradayIndices, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    setTickerSources(null);
    setTickerSourcesError(null);
    const loadTickerContext = async () => {
      try {
        const response = await fetch(`/api/paper-trading/securities/${encodeURIComponent(selectedSymbol.ticker)}/scenario-context`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as { data?: { sources?: TickerSource[] }; success?: boolean; error?: string } | null;
        if (!response.ok || !payload || payload.success === false) throw new Error(payload?.error ?? "종목 연결 데이터를 불러오지 못했습니다.");
        if (active) setTickerSources(payload.data?.sources ?? []);
      } catch (error) {
        if (active) setTickerSourcesError(error instanceof Error ? error.message : "종목 연결 데이터를 불러오지 못했습니다.");
      }
    };
    loadTickerContext();
    return () => { active = false; };
  }, [selectedSymbol.ticker]);

  useEffect(() => {
    let active = true;
    const ticker = selectedSymbol.ticker;
    const loadSymbolCandles = async () => {
      try {
        const response = await fetch(`/api/paper-trading/securities/${encodeURIComponent(ticker)}/candles?limit=40`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as { data?: { candles?: Array<{ market_date: string; open: number; high: number; low: number; close: number }> } } | null;
        const rows = payload?.data?.candles ?? [];
        if (!response.ok || !rows.length || !active) return;
        const candles: KospiCandle[] = rows.map((row) => {
          const parsed = new Date(row.market_date);
          return { date: row.market_date.replaceAll("-", ""), label: `${parsed.getMonth() + 1}/${parsed.getDate()}`, open: row.open, high: row.high, low: row.low, close: row.close };
        });
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        setSymbolCandles({
          ticker,
          data: {
            latestDate: last.date, latestLabel: last.label, value: last.close,
            change: prev ? last.close - prev.close : 0,
            rate: prev ? ((last.close - prev.close) / prev.close) * 100 : 0,
            candles,
          },
        });
      } catch {
        // keep the previous symbol's chart on screen (dimmed via the "불러오는 중" state below) rather than flashing the unrelated KOSPI placeholder
      }
    };
    loadSymbolCandles();
    return () => { active = false; };
  }, [selectedSymbol.ticker]);

  useEffect(() => {
    const keyword = symbolQuery.trim();
    if (!keyword) { setSymbolResults([]); setSymbolSearching(false); return; }
    let cancelled = false;
    setSymbolSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/paper-trading/securities?q=${encodeURIComponent(keyword)}&limit=8`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as { data?: Security[] } | null;
        if (!cancelled) setSymbolResults(response.ok && payload?.data ? payload.data : []);
      } catch {
        if (!cancelled) setSymbolResults([]);
      } finally {
        if (!cancelled) setSymbolSearching(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [symbolQuery]);

  useLayoutEffect(() => {
    if (scenarioScrollY.current === null) return;
    const scrollTop = scenarioScrollY.current;
    scenarioScrollY.current = null;
    window.scrollTo(0, scrollTop);
    window.requestAnimationFrame(() => window.scrollTo(0, scrollTop));
  }, [selectedScenario]);

  const activateTab = (tab: MainTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const activateProtectedTab = (tab: MainTab) => {
    if (tab === "twin") {
      requireAuth(() => activateTab(tab));
      return;
    }
    activateTab(tab);
  };

  const authModal = authOpen ? (
    <AuthModal
      onClose={() => { setAuthOpen(false); setAuthIntent(null); }}
      onAuthenticated={(user) => {
        refreshAuthUser(user);
        setAuthOpen(false);
        if (authIntent) {
          authIntent();
          setAuthIntent(null);
        }
      }}
    />
  ) : null;

  const selectSymbol = (item: WatchSymbol) => {
    setSelectedSymbol(item);
    setWatchlist((current) => current.some((row) => row.ticker === item.ticker) ? current : [...current, item]);
    setSymbolQuery("");
    setSymbolResults([]);
  };

  const removeSymbol = (ticker: string) => {
    setWatchlist((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((row) => row.ticker !== ticker);
      if (selectedSymbol.ticker === ticker && next.length) setSelectedSymbol(next[0]);
      return next;
    });
  };

  const toggleSeed = (seed: string) => {
    setSelectedSeeds((current) =>
      current.includes(seed) ? current.filter((item) => item !== seed) : [...current, seed],
    );
  };

  const openBuilder = () => {
    if (buildTimer.current) window.clearTimeout(buildTimer.current);
    setBuilderMode("form");
    setBuildStage(1);
    setOntologyRunState("idle");
    setOntologyLogs([]);
    setOntologyDocuments([]);
    setOntologyOutputDir(null);
    setMirofishRun(null);
    setSimulationStarting(false);
    setSimulationStarted(false);
    setSimulationSession(null);
    setSimulationChatMessages([]);
    setSimulationChatSending(false);
    setSimulationRuntimeError(null);
    setBuilderOpen(true);
  };

  const closeBuilder = () => {
    if (buildTimer.current) window.clearTimeout(buildTimer.current);
    setBuilderOpen(false);
    setBuilderMode("form");
  };

  const handleSeedUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    let preview = "";
    if (file.type.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(file.name)) {
      preview = (await file.text()).replace(/\s+/g, " ").slice(0, 180);
    }
    setUploadedSeedFile({ name: file.name, size: file.size, preview });
    event.target.value = "";
  };

  const selectScenario = (scenario: Scenario) => {
    scenarioScrollY.current = window.scrollY;
    setSelectedScenario(scenario);
    setScenarioDetailOpen(false);
  };

  const openScenarioDetail = (scenario: Scenario) => {
    scenarioScrollY.current = window.scrollY;
    setSelectedScenario(scenario);
    const cacheKey = `${scenario.id}:${kospiAsOf}`;
    const cached = editorialCache.current.get(cacheKey);
    setScenarioEditorial(cached?.editorial ?? fallbackEditorial(scenario));
    setEditorialMeta(cached ? { generatedAt: cached.generatedAt, model: cached.model } : null);
    setEditorialState(cached ? "ready" : "loading");
    setScenarioDetailOpen(true);
    if (cached) return;

    const requestId = ++editorialRequest.current;
    fetch("/api/scenario-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailyContext: {
          asOf: kospiAsOf,
          market: { value: kospiValue, change: kospiChange, rate: kospiRate },
          brief: marketBrief,
          signals: dashboardSignals.map((signal) => ({
            category: signal.label,
            impact: signal.impactSummary,
            keywords: signal.keywords.slice(0, 2),
          })),
          globalIndices: intradayIndices.map((index) => ({ name: index.name, latest: index.points.at(-1) })),
        },
        scenario: {
          title: scenario.title,
          duration: scenario.duration,
          forecast: scenario.forecast,
          thesis: scenario.thesis,
          context: scenario.context,
          summary: scenario.summary,
          tags: scenario.tags,
          events: scenario.events,
          investorGuide: scenario.investorGuide,
          riskPoints: scenario.riskPoints,
        },
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("scenario brief request failed");
        return response.json() as Promise<{ editorial: ScenarioEditorial; generatedAt: string; model: string }>;
      })
      .then((brief) => {
        editorialCache.current.set(cacheKey, brief);
        if (editorialRequest.current !== requestId) return;
        setScenarioEditorial(brief.editorial);
        setEditorialMeta({ generatedAt: brief.generatedAt, model: brief.model });
        setEditorialState("ready");
      })
      .catch(() => {
        if (editorialRequest.current === requestId) setEditorialState("fallback");
      });
  };

  const runCustomScenario = () => {
    const question = scenarioPrompt.trim();
    if (question.length < 8) {
      setOntologyLogs([{ source: "system", line: "예측 시나리오 질문을 8자 이상 입력해주세요." }]);
      return;
    }
    setSelectedScenario({
      ...scenarios[0],
      id: "custom",
      title: "사용자 예측 시나리오",
      duration: period,
      tags: ["사용자 질문", period],
      summary: `${period} 동안 KOSPI와 연결된 시장·경제·이벤트 근거를 수집하는 사용자 지정 시나리오입니다. ${question}`,
      forecast: "조건부 경로 계산",
    });
    setBuilderMode("build");
    setBuildStage(1);
    setOntologyRunState("running");
    setOntologyOutputDir(null);
    setOntologyDocuments([]);
    setOntologyLogs([{ source: "system", line: "데이터 수집을 위한 작업을 시작했습니다." }]);
    setMirofishRun(null);
    setMirofishProgress(null);
    setOntologySchema(null);
    setGraphSnapshot(null);
    setSimulationStarting(false);
    setSimulationStarted(false);
    setSimulationSession(null);
    setSimulationChatMessages([]);
    setSimulationChatSending(false);
    setSimulationRuntimeError(null);
    setScenarioDetailOpen(false);
    const sessionStorageKey = "finverse.ontology-session-id";
    let sessionId = window.localStorage.getItem(sessionStorageKey);
    if (!sessionId) {
      sessionId = window.crypto.randomUUID();
      window.localStorage.setItem(sessionStorageKey, sessionId);
    }
    fetch("/api/ontology/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: question, period, sessionId }),
    }).then(async (response) => {
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error ?? "온톨로지 실행을 시작하지 못했습니다.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reachedTerminalEvent = false;
      type GraphEventPayload = { nodes?: unknown; edges?: unknown; node_count?: unknown; edge_count?: unknown; progress?: unknown; message?: string };
      const applyGraphEvent = (payload: GraphEventPayload) => {
        if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) return;
        const nodes = payload.nodes.flatMap((node) => {
          if (!node || typeof node !== "object") return [];
          const item = node as { id?: unknown; label?: unknown; type?: unknown };
          return typeof item.id === "string" && typeof item.label === "string" ? [{ id: item.id, label: item.label, type: typeof item.type === "string" ? item.type : "Entity" }] : [];
        });
        const edges = payload.edges.flatMap((edge) => {
          if (!edge || typeof edge !== "object") return [];
          const item = edge as { source?: unknown; target?: unknown; label?: unknown };
          return typeof item.source === "string" && typeof item.target === "string" ? [{ source: item.source, target: item.target, label: typeof item.label === "string" ? item.label : "RELATED_TO" }] : [];
        });
        setGraphSnapshot({
          nodes,
          edges,
          nodeCount: typeof payload.node_count === "number" ? payload.node_count : nodes.length,
          edgeCount: typeof payload.edge_count === "number" ? payload.edge_count : edges.length,
        });
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const event = JSON.parse(raw) as { type?: string; source?: OntologyLog["source"]; line?: string; message?: string; outputDir?: string; items?: OntologyDocument[]; stage?: number; progress?: number; entity_types?: unknown; relation_types?: unknown; nodes?: unknown; edges?: unknown; graph_snapshot?: unknown; simulation_id?: string; profile_count?: number; entity_count?: number; node_count?: number; edge_count?: number; initial_posts_count?: number };
          const line = event.line ?? event.message;
          if (line) {
            setOntologyLogs((current) => [...current.slice(-159), { source: event.source ?? "system", line }]);
            if (line.includes("free-models-per-day")) {
              setOntologyLogs((current) => [...current.slice(-159), { source: "system", line: "OpenRouter 무료 모델의 일일 요청 한도가 소진되었습니다. 일일 초기화 후 다시 실행하거나 OpenRouter 크레딧을 추가해주세요." }]);
            }
            try {
              const result = JSON.parse(line) as { output_dir?: string };
              if (result.output_dir) setOntologyOutputDir(result.output_dir);
            } catch { /* regular text log */ }
          }
          if (event.type === "complete") {
            reachedTerminalEvent = true;
            setBuildStage(6);
            setOntologyRunState("complete");
          }
          if (event.type === "error") {
            reachedTerminalEvent = true;
            setOntologyRunState("error");
          }
          if (event.type === "mirofish_stage" && event.stage && event.stage >= 2 && event.stage <= 6) {
            setBuildStage(event.stage as BuildStage);
            if (typeof event.progress === "number") setMirofishProgress({ stage: event.stage as BuildStage, percent: event.progress, message: event.message });
            if (event.stage === 2 && Array.isArray(event.entity_types)) {
              setOntologySchema({
                entityTypes: event.entity_types.filter((item): item is string => typeof item === "string" && Boolean(item.trim())),
                relationTypes: Array.isArray(event.relation_types) ? event.relation_types.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [],
              });
            }
            if (event.message) setOntologyLogs((current) => [...current.slice(-159), { source: "system", line: event.message! }]);
          }
          if (event.type === "mirofish_ready") {
            reachedTerminalEvent = true;
            setBuildStage(6);
            setOntologyRunState("complete");
            setMirofishRun({ simulationId: event.simulation_id ?? "", profileCount: event.profile_count, entityCount: event.entity_count, nodeCount: event.node_count, edgeCount: event.edge_count, initialPostsCount: event.initial_posts_count });
            if (Array.isArray(event.entity_types)) {
              setOntologySchema({
                entityTypes: event.entity_types.filter((item): item is string => typeof item === "string" && Boolean(item.trim())),
                relationTypes: Array.isArray(event.relation_types) ? event.relation_types.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [],
              });
            }
            if (event.graph_snapshot && typeof event.graph_snapshot === "object") {
              applyGraphEvent(event.graph_snapshot as GraphEventPayload);
            }
          }
          if (event.type === "mirofish_graph_snapshot" && Array.isArray(event.nodes) && Array.isArray(event.edges)) {
            setBuildStage((current) => Math.max(current, 3) as BuildStage);
            if (typeof event.progress === "number") {
              setMirofishProgress({ stage: 3, percent: event.progress, message: event.message });
            }
            applyGraphEvent(event);
          }
          if (event.type === "mirofish_error") {
            reachedTerminalEvent = true;
            setOntologyRunState("error");
          }
          if (event.type === "documents") {
            if (event.outputDir) setOntologyOutputDir(event.outputDir);
            if (Array.isArray(event.items)) setOntologyDocuments(event.items);
          }
        }
        if (done) {
          if (!reachedTerminalEvent) {
            setOntologyRunState("error");
            setOntologyLogs((current) => [...current.slice(-159), {
              source: "system",
              line: "작업 연결이 예기치 않게 종료되었습니다. 진행 중이던 작업은 중단됐을 수 있으니 시뮬레이션을 다시 시작해주세요.",
            }]);
          }
          break;
        }
      }
    }).catch((error: unknown) => {
      setOntologyRunState("error");
      setOntologyLogs((current) => [...current, { source: "system", line: error instanceof Error ? error.message : "온톨로지 실행 중 알 수 없는 오류가 발생했습니다." }]);
    });
  };

  const startPreparedSimulation = () => {
    if (!ontologyOutputDir || !mirofishRun?.simulationId) return;
    setSimulationStarting(true);
    setSimulationRuntimeError(null);
    fetch("/api/mirofish/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputDir: ontologyOutputDir, period }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as { job_id?: string; status?: string; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "시나리오를 시작하지 못했습니다.");
      if (!payload?.job_id) throw new Error("시나리오 실행 작업 ID를 확인하지 못했습니다.");
      setSimulationStarted(true);
      setSimulationSession({
        job_id: payload.job_id,
        status: payload.status ?? "starting",
        query: scenarioPrompt,
        period,
        simulation_id: mirofishRun.simulationId,
        runtime: null,
        chat_ready: payload.status === "running" || payload.status === "completed",
        chat_messages: [],
        error: null,
      });
      setSimulationChatMessages([]);
      setBuilderMode("run");
      setOntologyLogs((current) => [...current, { source: "system", line: "MiroFish 시나리오 실행을 시작했습니다." }]);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "시나리오 실행 중 오류가 발생했습니다.";
      setSimulationRuntimeError(message);
      setOntologyLogs((current) => [...current, { source: "system", line: message }]);
    }).finally(() => setSimulationStarting(false));
  };

  useEffect(() => {
    if (!builderOpen || builderMode !== "run" || !ontologyOutputDir) return;
    let active = true;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const response = await fetch("/api/mirofish/runtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outputDir: ontologyOutputDir }),
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null) as SimulationSession | { error?: string } | null;
        if (!response.ok) throw new Error(payload && "error" in payload ? payload.error ?? "실행 상태를 불러오지 못했습니다." : "실행 상태를 불러오지 못했습니다.");
        if (!active || !payload || !("job_id" in payload)) return;
        setSimulationSession(payload);
        setSimulationChatMessages(Array.isArray(payload.chat_messages) ? payload.chat_messages : []);
        setSimulationRuntimeError(payload.error ?? null);
        if (payload.status === "starting" || payload.status === "running") timer = window.setTimeout(poll, 1_500);
      } catch (error) {
        if (!active) return;
        setSimulationRuntimeError(error instanceof Error ? error.message : "실행 상태 연결이 잠시 끊겼습니다.");
        timer = window.setTimeout(poll, 3_000);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [builderMode, builderOpen, ontologyOutputDir]);

  const sendSimulationMessage = async (message: string) => {
    const content = message.trim();
    if (!content || !ontologyOutputDir || simulationChatSending) return;
    const optimistic: SimulationChatMessage = { id: `local-${Date.now()}`, role: "user", content };
    setSimulationChatSending(true);
    setSimulationRuntimeError(null);
    setSimulationChatMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch("/api/mirofish/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputDir: ontologyOutputDir, message: content }),
      });
      const payload = await response.json().catch(() => null) as { message?: SimulationChatMessage; error?: string } | null;
      if (!response.ok || !payload?.message) throw new Error(payload?.error ?? "시뮬레이션 답변을 생성하지 못했습니다.");
      setSimulationChatMessages((current) => [...current, payload.message!]);
    } catch (error) {
      setSimulationRuntimeError(error instanceof Error ? error.message : "시뮬레이션 채팅 연결에 실패했습니다.");
    } finally {
      setSimulationChatSending(false);
    }
  };

  if (introVisible) {
    return <ServiceIntro onEnter={() => enterService("market")} onOpenJournal={() => enterService("twin")} />;
  }

  if (activeTab === "market") {
    return (
      <div className="mock-journal-app">
        <MockNavigation activeTab={activeTab} onActivate={activateProtectedTab} onShowIntro={() => setIntroVisible(true)} user={authUser} onLogin={() => setAuthOpen(true)} onLogout={logoutAuthUser} />
        <MockMarketSimulation
          onOpenJournal={() => requireAuth(() => activateTab("twin"))}
          onOpenJudgement={() => requireAuth(() => setPaperTradingOpen(true))}
          onOpenLogin={() => setAuthOpen(true)}
          hideHeader
        />
        {paperTradingOpen && <PaperTradingModal onClose={() => setPaperTradingOpen(false)} onProfileRequired={() => { setPaperTradingOpen(false); setIntroVisible(false); activateTab("twin"); }} />}
        {authModal}
      </div>
    );
  }

  if (activeTab === "twin") {
    return (
      <div className="mock-journal-app">
        <MockNavigation activeTab={activeTab} onActivate={activateProtectedTab} onShowIntro={() => setIntroVisible(true)} user={authUser} onLogin={() => setAuthOpen(true)} onLogout={logoutAuthUser} />
        <main className="mock-journal-main">
          <TwinPage onRequireAuth={requireAuth} />
        </main>
        {authModal}
      </div>
    );
  }

  return (
    <div className="finverse-app">
      <header className="top-header">
        <button className="brand" onClick={() => activateTab("market")} aria-label="FINVERSE 시장 인사이트 홈">
          FINVERSE<span>.</span>
        </button>
        <nav className="top-nav" aria-label="FINVERSE 탐색">
          <button className={activeTab === "market" ? "active" : ""} onClick={() => activateTab("market")} aria-current={activeTab === "market" ? "page" : undefined}>시장 시뮬레이션</button>
          <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")} aria-current={activeTab === "twin" ? "page" : undefined}>나의 투자 일지</button>
          <button onClick={() => setPaperTradingOpen(true)}>모의 투자</button>
          <button onClick={() => setIntroVisible(true)}>서비스 소개</button>
        </nav>
        <div className="top-header-actions">
          <button className="header-help" type="button" onClick={() => setPaperTradingOpen(true)} aria-label="모의 투자 열기"><UserRound size={16} /></button>
        </div>
      </header>

      <main className="main-content">
          {activeTab === "market" ? (
            <div className="market-page">
              <div className="market-layout">
                <aside className="symbol-sidebar" aria-label="종목 선택">
                  <div className="symbol-search">
                    <div className="symbol-search-row">
                      <input type="search" value={symbolQuery} onChange={(event) => setSymbolQuery(event.target.value)} placeholder="종목 검색" aria-label="종목 검색" />
                    </div>
                    {symbolQuery.trim() && (
                      <div className="search-results" aria-live="polite">
                        {symbolSearching ? (
                          <p className="search-empty">검색 중…</p>
                        ) : symbolResults.length ? symbolResults.map((item) => (
                          <button key={item.ticker} className="search-result" type="button" onClick={() => selectSymbol({ ticker: item.ticker, name: item.name })}>
                            <span><strong>{item.name}</strong><small>{item.ticker}</small></span>
                          </button>
                        )) : <p className="search-empty">검색 결과가 없습니다.</p>}
                      </div>
                    )}
                  </div>
                  <div className="symbol-list">
                    {watchlist.map((item) => (
                      <div className="symbol-row" key={item.ticker}>
                        <button className="symbol" type="button" aria-pressed={selectedSymbol.ticker === item.ticker} onClick={() => setSelectedSymbol(item)}>
                          <span className="symbol-mark"><em>{item.name.slice(0, 1)}</em><img src={`/stock-logos/${item.ticker}.png`} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /></span>
                          <span className="symbol-name"><strong>{item.name}</strong><small>{item.ticker}</small></span>
                        </button>
                        {watchlist.length > 1 && <button className="symbol-remove" type="button" aria-label={`${item.name} 제거`} onClick={() => removeSymbol(item.ticker)}>×</button>}
                      </div>
                    ))}
                  </div>
                  <div className="symbol-connection">
                    <div className="symbol-connection-heading"><span>DATA COVERAGE</span><strong>{selectedSymbol.name} 데이터 연결</strong></div>
                    {tickerSourcesError ? (
                      <p className="symbol-connection-empty">데이터 준비 중입니다.</p>
                    ) : tickerSources ? (
                      tickerSources.length ? tickerSources.map((source) => {
                        const Icon = tickerSourceIcons[source.key];
                        return (
                          <article key={source.key} className={`symbol-source ${source.status}`}>
                            <header><Icon size={12} /><strong>{source.label}</strong><em>{source.status === "ready" ? "READY" : "MISSING"}</em></header>
                            <b>{source.count.toLocaleString("ko-KR")}<small>{source.unit}</small></b>
                            <p>{source.detail}</p>
                          </article>
                        );
                      }) : <p className="symbol-connection-empty">데이터 준비 중입니다.</p>
                    ) : Array.from({ length: 4 }).map((_, index) => (
                      <article key={index} className="symbol-source waiting"><LoaderCircle size={12} className="spin" /></article>
                    ))}
                  </div>
                </aside>
                <div className="market-content">
              <header className="page-heading">
                <div><span>MARKET INSIGHT</span><h1>시장의 주요 지표는 다음과 같이 움직였습니다.</h1></div>
                <div className="market-stamp"><CalendarDays size={15} />{kospiAsOfLabel} 최신 기준</div>
              </header>

              <section className="market-indicators" aria-label="시장 주요 지표">
                <div className="indicator-grid">
                  {marketOverview.map((item) => {
                    const isKospi = item.key === "KOSPI";
                    const live = intradayIndices.find((index) => index.name === item.name);
                    const latest = live?.points.at(-1);
                    const values = isKospi ? undefined : (live?.points.map((point) => point.close) ?? item.points);
                    const rate = isKospi ? kospiRate : latest?.changePct;
                    const previousClose = !isKospi && latest && typeof rate === "number" && rate !== -100 ? latest.close / (1 + rate / 100) : latest?.close;
                    const change = isKospi ? kospiChange : (latest && previousClose !== undefined ? latest.close - previousClose : undefined);
                    const tone = rate === undefined ? item.tone : rate >= 0 ? "up" : "down";
                    return (
                      <article className="indicator-tile" data-tone={tone} key={item.key}>
                        <header>
                          <h3>{item.name}</h3>
                          <strong>{isKospi ? formatIndexValue(kospiValue) : latest ? formatIndexValue(latest.close) : item.value}</strong>
                        </header>
                        <div className="indicator-change">
                          {change === undefined || rate === undefined ? (
                            <><b className={tone}>{item.change}</b><span>{item.rate}</span></>
                          ) : (
                            <><b className={tone}>{formatSignedIndex(change)}</b><span>{Math.abs(rate).toFixed(2)}%</span></>
                          )}
                        </div>
                        <div className="indicator-spark"><MarketLineChart values={isKospi ? actualPath.slice(-20) : values ?? []} name={`${item.name} 당일`} /></div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <div className="page-heading stock-condition-heading">
                <div><h1><span className="stock-heading-symbol">{selectedSymbol.name}</span>, 당신이 선택한 조건에서 어떻게 움직일까요?</h1></div>
              </div>
              <section className="scenario-section">
                <div className="scenario-grid">
                  {scenarios.map((scenario, index) => (
                    <article key={scenario.id} className={`scenario-card ${scenario.tone} ${selectedScenario.id === scenario.id ? "active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectScenario(scenario)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectScenario(scenario); }} role="button" tabIndex={0} aria-pressed={selectedScenario.id === scenario.id}>
                      <div className="scenario-card-head">
                        <span className="scenario-card-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="scenario-card-meta"><i>{scenario.duration}</i><em className={scenario.tone}>{scenario.forecast.replace(/^KOSPI\s*/, "")}</em></span>
                      </div>
                      <div className="scenario-card-body">
                        <strong>{scenario.title}</strong>
                        <small>{scenario.tags.join(" · ")}</small>
                      </div>
                      <div className={`scenario-card-action ${scenario.tone}`}>
                        <button type="button" onClick={(event) => { event.stopPropagation(); openScenarioDetail(scenario); }}>시나리오 상세</button>
                      </div>
                    </article>
                  ))}
                  <article className="custom-scenario-card">
                    <button type="button" onClick={() => setPaperTradingOpen(true)}>
                      <Plus size={26} />
                      <span>내가 생각한<br />시나리오로 보기</span>
                    </button>
                  </article>
                </div>

                <section className="panel chart-panel conditional-chart">
                  <header className="chart-title-row">
                    <div><h2>시나리오 - <span>{selectedSymbol.name} {selectedScenario.title}</span></h2></div>
                    <div className={`chart-meta ${selectedScenario.tone}`}><span>{selectedScenario.duration}</span><strong>{selectedScenario.forecast.replace(/^KOSPI\s*/, "")}</strong></div>
                  </header>
                  <div className="chart-content">
                    <div className={`chart-wrap ${symbolCandles?.ticker === selectedSymbol.ticker ? "" : "loading"}`}>
                      <ForecastChart scenario={selectedScenario} marketData={symbolCandles?.ticker === selectedSymbol.ticker ? symbolCandles.data : symbolCandles?.data ?? kospiData} />
                      {symbolCandles?.ticker !== selectedSymbol.ticker && <div className="chart-loading-overlay"><LoaderCircle size={18} className="spin" /><span>{selectedSymbol.name} 데이터 불러오는 중…</span></div>}
                    </div>
                    <aside className="event-rail" aria-label="발생 가능 이벤트">
                      <header><h2>발생 가능 이벤트</h2><span>{selectedScenario.duration}</span></header>
                      <div className="event-timeline">
                        {selectedScenario.events.map((event) => (
                          <article key={event.title}>
                            <div className="event-week">{event.week}</div>
                            <div className="event-dot" />
                            <div className="event-copy">
                              <span>{event.category}</span>
                              <h3>{event.title}</h3>
                              <p>{event.body}</p>
                              <div className="event-impact">
                                <span>예상 영향</span>
                                <strong className={event.impact.startsWith("+") ? "up" : "down"}>{event.impact}</strong>
                              </div>
                              <button type="button" aria-label={`${event.title} 시나리오에 포함됨`}>
                                <span>시나리오에 포함됨</span>
                                <Bookmark size={14} />
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </aside>
                  </div>
                </section>

                <span className="visually-hidden">SELECTED SCENARIO · 시나리오 전제 · 예상 전개</span>

                {false && <section className="scenario-detail" id="scenario-detail" aria-live="polite" aria-label="선택한 시나리오 상세 내용">
                  <header className="scenario-detail-header">
                    <div>
                      <span>SELECTED SCENARIO</span>
                      <h3>{selectedScenario.title}</h3>
                      <p>핵심 결론부터 반증 신호까지, 선택한 조건이 실제로 이어졌을 때의 KOSPI 흐름을 이야기로 정리했습니다.</p>
                    </div>
                    <div className={`scenario-detail-forecast ${selectedScenario.tone}`}>
                      <small>{selectedScenario.duration} 예상</small>
                      <strong>{selectedScenario.forecast}</strong>
                    </div>
                  </header>

                  <section className="scenario-detail-lead" aria-label="시나리오 핵심 결론">
                    <span>ONE-LINE THESIS</span>
                    <strong>{selectedScenario.thesis}</strong>
                    <p>{selectedScenario.context}</p>
                  </section>

                  <div className="scenario-detail-body">
                    <article className="scenario-story">
                      <div className="scenario-detail-visual">
                        <img src={selectedScenario.image} alt={`${selectedScenario.title} 시나리오 이미지`} />
                        <span>CONDITIONAL MARKET PATH</span>
                      </div>
                      <div className="scenario-detail-label">시나리오 전제</div>
                      <p>{selectedScenario.summary}</p>
                      <div className="scenario-signal-list">
                        <span>핵심 전제</span>
                        {selectedScenario.tags.map((tag) => <em key={tag}>{tag}</em>)}
                      </div>
                    </article>

                    <div className="scenario-milestones">
                      <div className="scenario-detail-label">예상 전개</div>
                      <div className="scenario-milestone-list">
                        {selectedScenario.events.map((event, index) => (
                          <article key={`${selectedScenario.id}-${event.title}`} className="scenario-milestone">
                            <div className="scenario-milestone-index">0{index + 1}</div>
                            <div className="scenario-milestone-copy">
                              <div className="scenario-milestone-meta"><span>{event.week}</span><em>{event.category}</em></div>
                              <h4>{event.title}</h4>
                              <p>{event.body}</p>
                            </div>
                            <strong className={event.impact.startsWith("+") ? "up" : "down"}>{event.impact}</strong>
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>

                  <section className="scenario-narrative" aria-label="시나리오 상세 전개">
                    <div className="scenario-detail-label">시나리오를 읽는 순서</div>
                    <div className="scenario-narrative-list">
                      {selectedScenario.chapters.map((chapter, index) => (
                        <article key={`${selectedScenario.id}-${chapter.title}`} className="scenario-narrative-card">
                          <div className="scenario-narrative-index">0{index + 1}</div>
                          <div>
                            <h4>{chapter.title}</h4>
                            <p>{chapter.body}</p>
                            {chapterLessonMap[selectedScenario.id]?.[index] && <p className="scenario-narrative-lesson">{chapterLessonMap[selectedScenario.id][index]}</p>}
                            <span>{chapter.evidence}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <ScenarioLearningArticle scenario={selectedScenario} />

                  <section className="scenario-decision-grid" aria-label="개인 투자자 학습 가이드">
                    <article className="scenario-decision-panel">
                      <div className="scenario-detail-label">개인 투자자의 선택지</div>
                      <p className="scenario-section-note">예측을 따라 하기보다 조건이 바뀔 때 어떤 행동을 선택할지 미리 적어보세요.</p>
                      <div className="scenario-choice-list">
                        {selectedScenario.investorGuide.map((guide) => (
                          <div key={`${selectedScenario.id}-${guide.stance}`} className="scenario-choice-row">
                            <strong>{guide.stance}</strong>
                            <div><h4>{guide.action}</h4><p>{guide.rationale}</p></div>
                          </div>
                        ))}
                      </div>
                    </article>
                    <article className="scenario-decision-panel">
                      <div className="scenario-detail-label">다음에 공부할 질문</div>
                      <p className="scenario-section-note">이 시나리오의 숫자를 직접 검증할 수 있는 질문입니다.</p>
                      <div className="scenario-study-list">
                        {selectedScenario.studyGuide.map((study) => (
                          <div key={`${selectedScenario.id}-${study.topic}`}><span>{study.topic}</span><p>{study.question}</p></div>
                        ))}
                      </div>
                    </article>
                  </section>

                  <section className="scenario-bias-section" aria-label="인지 편향 체크">
                    <div className="scenario-detail-label">판단 전, 인지 편향 체크</div>
                    <p className="scenario-section-note">같은 뉴스도 내 포지션과 기대에 따라 다르게 보입니다. 아래 함정을 먼저 확인하세요.</p>
                    <div className="scenario-bias-grid">
                      {selectedScenario.biasChecks.map((item) => (
                        <article key={`${selectedScenario.id}-${item.bias}`} className="scenario-bias-card">
                          <span>{item.bias}</span>
                          <strong>{item.trap}</strong>
                          <p><b>대응:</b> {item.counter}</p>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="scenario-detail-intelligence" aria-label="멀티 에이전트 해석">
                    <div className="scenario-detail-label">멀티 에이전트 해석</div>
                    <div className="scenario-agent-grid">
                      {selectedScenario.agentInsights.map((insight) => (
                        <article key={`inline-${selectedScenario.id}-${insight.role}`} className="scenario-agent-card">
                          <span>{insight.role}</span>
                          <h3>{insight.title}</h3>
                          <p>{insight.body}</p>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="scenario-detail-risks" aria-label="핵심 리스크">
                    <div className="scenario-detail-label">이 시나리오가 빗나갈 수 있는 지점</div>
                    <div className="scenario-risk-list">
                      {selectedScenario.riskPoints.map((risk) => <span key={`inline-risk-${risk}`}>{risk}</span>)}
                    </div>
                  </section>
                </section>}
              </section>
                </div>
              </div>
            </div>
          ) : <TwinPage />}
      </main>

      <nav className="mobile-tabs" aria-label="모바일 주요 메뉴">
        <button className={activeTab === "market" ? "active" : ""} onClick={() => activateTab("market")}><BarChart3 size={18} /><span>시장 시뮬레이션</span></button>
        <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}><UserRound size={18} /><span>나의 투자 일지</span></button>
      </nav>

      {builderOpen && (
        <div className="modal-backdrop scenario-builder-backdrop" onMouseDown={closeBuilder}>
          {builderMode === "form" ? (
            <section className="scenario-modal scenario-builder-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-modal-title" onMouseDown={(event) => event.stopPropagation()}>
              <header className="scenario-builder-header"><div><span>MY SCENARIO LAB</span><h2 id="scenario-modal-title">내 시나리오를 예측해보세요</h2><p>질문과 예측 기간을 입력하면 최신 시장 근거로 온톨로지 문서를 생성합니다.</p></div><button className="scenario-modal-close" type="button" onClick={closeBuilder} aria-label="시나리오 빌더 닫기"><X size={20} /></button></header>
              <div className="builder-question-section"><div className="builder-section-heading"><div><span>01 · FORECAST QUESTION</span><h3>예측 시나리오 질문</h3></div></div><textarea className="scenario-prompt" value={scenarioPrompt} onChange={(event) => setScenarioPrompt(event.target.value)} placeholder="예: 외국인 수급과 반도체 실적 변화가 향후 30일 코스피에 미칠 영향은 무엇일까?" rows={6} /><div className="builder-prompt-hint"><Sparkles size={14} /> 질문은 시장·경제·이벤트 Evidence 문서 생성에 사용됩니다.</div></div>
              <div className="builder-period-row"><div><span>예측 기간</span><small>지식그래프에서 경로를 계산할 구간</small></div><div className="builder-period-options">{["7일", "30일", "3개월"].map((item) => <button key={item} type="button" className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
              <button className="run-custom-button" type="button" onClick={runCustomScenario}><Network size={18} /> 시뮬레이션 시작하기 <ArrowRight size={17} /></button>
            </section>
          ) : builderMode === "build" ? (
            <section className="scenario-modal scenario-build-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-build-title" onMouseDown={(event) => event.stopPropagation()}>
              <ScenarioBuildScreen seeds={["사용자 질문"]} prompt={scenarioPrompt} uploadedFile={null} stage={buildStage} period={period} runState={ontologyRunState} logs={ontologyLogs} documents={ontologyDocuments} outputDir={ontologyOutputDir} mirofishRun={mirofishRun} mirofishProgress={mirofishProgress} ontologySchema={ontologySchema} graphSnapshot={graphSnapshot} simulationStarting={simulationStarting} simulationStarted={simulationStarted} onStartSimulation={startPreparedSimulation} onClose={closeBuilder} />
            </section>
          ) : (
            <section className="scenario-modal scenario-run-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-run-title" onMouseDown={(event) => event.stopPropagation()}>
              <ScenarioRunScreen prompt={scenarioPrompt} period={period} mirofishRun={mirofishRun} session={simulationSession} chatMessages={simulationChatMessages} chatSending={simulationChatSending} chatError={simulationRuntimeError} simulationStarting={simulationStarting} onSendMessage={sendSimulationMessage} onRetry={startPreparedSimulation} onClose={closeBuilder} />
            </section>
          )}
        </div>
      )}

      {paperTradingOpen && <PaperTradingModal onClose={() => setPaperTradingOpen(false)} onProfileRequired={() => { setPaperTradingOpen(false); activateTab("twin"); }} />}

      {selectedMarketSignal && (
        <div className="modal-backdrop market-signal-backdrop" onMouseDown={() => setSelectedMarketSignal(null)}>
          <section className="market-signal-modal" role="dialog" aria-modal="true" aria-labelledby="market-signal-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="market-signal-modal-header">
              <div>
                <span>MARKET CONNECTION · DETAIL</span>
                <h2 id="market-signal-modal-title">{selectedMarketSignal.label}</h2>
                <p>오늘 KOSPI에 연결된 핵심 키워드와 시장 영향을 확인하세요.</p>
              </div>
              <button className="scenario-modal-close" type="button" onClick={() => setSelectedMarketSignal(null)} aria-label="시장 연결 상세 닫기"><X size={20} /></button>
            </header>
            <div className="market-signal-modal-section"><span>현재 KOSPI 영향 요약</span><p>{selectedMarketSignal.impactSummary}</p></div>
            <div className="market-signal-modal-keywords">
              {selectedMarketSignal.topics.slice(0, 2).map((topic, index) => (
                <article key={topic.title}>
                  <div className="market-signal-topic-copy"><span>대주제 {index + 1}</span><strong>{topic.title}</strong></div>
                  <b aria-label={`중요도 ${importanceScore(topic.importance)}점`}>{"★".repeat(importanceScore(topic.importance))}{"☆".repeat(3 - importanceScore(topic.importance))}</b>
                  <p>{topic.summary}</p>
                  <div className="market-signal-topic-sources">
                    <span>이 대주제에 사용된 데이터</span>
                    {topic.sources?.filter((source) => source.url).map((source) => (
                      <a key={`${source.publisher}-${source.title}`} href={source.url!} target="_blank" rel="noreferrer">
                        <span><strong>{source.title}</strong><small>{source.publisher}{source.publishedAt ? ` · ${source.publishedAt.slice(0, 10)}` : ""}</small></span>
                        <ExternalLink size={13} />
                      </a>
                    ))}
                    {!topic.sources?.some((source) => source.url) && <small>이 대주제의 원천 링크를 확인 중입니다.</small>}
                  </div>
                </article>
              ))}
            </div>
            <small className="market-signal-modal-note">{selectedMarketSignal.analysisSource === "openrouter" ? `OpenRouter Gemma 4 분석 · ${selectedMarketSignal.analysisGeneratedAt ? new Date(selectedMarketSignal.analysisGeneratedAt).toLocaleString("ko-KR") : "최신 배치"}` : "DB 원천을 규칙 기반으로 정리한 결과입니다."}</small>
          </section>
        </div>
      )}

      {scenarioDetailOpen && (
        <div className="modal-backdrop scenario-detail-backdrop" onMouseDown={() => setScenarioDetailOpen(false)}>
          <section className="scenario-detail-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-detail-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="scenario-detail-modal-header">
              <div>
                <span>SCENARIO PREVIEW</span>
                <h2 id="scenario-detail-modal-title">{selectedScenario.title}</h2>
                <p>핵심 조건부터 반증 신호까지 5장으로 읽고, 아래에서 흐름을 자세히 풀어보세요.</p>
              </div>
              <button className="scenario-modal-close" type="button" onClick={() => setScenarioDetailOpen(false)} aria-label="시나리오 상세 닫기"><X size={20} /></button>
            </header>

            <PremiumScenarioBrief scenario={selectedScenario} editorial={scenarioEditorial} state={editorialState} meta={editorialMeta} />
          </section>
        </div>
      )}
    </div>
  );
}
