"use client";

import {
  Activity,
  ArrowRight,
  BarChart3,
  Bookmark,
  BrainCircuit,
  CalendarDays,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  CheckCircle2,
  Database,
  ExternalLink,
  FileUp,
  GitBranch,
  Globe2,
  LoaderCircle,
  Network,
  Plus,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";

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
  analysisSource?: "bedrock" | "rules";
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
          <span>{state === "loading" ? "Bedrock 편집 중" : state === "ready" ? "Bedrock 에디토리얼" : "안전 프리뷰"}</span>
        </div>
      </header>

      <section className={`daily-story theme-${editorial.ui.theme} rhythm-${editorial.ui.rhythm}`} aria-label={`${scenario.title} 매일 카드뉴스`}>
        <div className="card-news-label"><span>DAILY CARD STORY · 5 SCENES</span><small>오늘 시장에 맞춰 Bedrock이 레이아웃과 그림을 골랐어요</small></div>
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
        <span>{state === "ready" && meta ? `Amazon Bedrock · ${meta.model} · ${new Date(meta.generatedAt).toLocaleString("ko-KR")}` : "Amazon Bedrock 연결 전에는 검증된 시나리오 프리뷰를 표시합니다."}</span>
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

type GraphPreviewNode = {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  color: string;
};

const graphPreviewNodes: GraphPreviewNode[] = [
  { id: "kospi", label: "KOSPI", type: "지수", x: 320, y: 250, color: "#18181b" },
  { id: "semiconductor", label: "반도체", type: "섹터", x: 162, y: 130, color: "#2563eb" },
  { id: "samsung", label: "삼성전자", type: "종목", x: 78, y: 268, color: "#0f766e" },
  { id: "hynix", label: "SK하이닉스", type: "종목", x: 135, y: 400, color: "#0f766e" },
  { id: "auto", label: "자동차", type: "섹터", x: 460, y: 90, color: "#2563eb" },
  { id: "internet", label: "인터넷", type: "섹터", x: 560, y: 180, color: "#2563eb" },
  { id: "finance", label: "금융", type: "섹터", x: 525, y: 340, color: "#2563eb" },
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

function KnowledgeGraphPreview({ seeds, prompt, stage }: { seeds: string[]; prompt: string; stage: BuildStage }) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() =>
    Object.fromEntries(graphPreviewNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
  );
  const [selectedNode, setSelectedNode] = useState("kospi");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ active: boolean; x: number; y: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const velocity = Object.fromEntries(graphPreviewNodes.map((node) => [node.id, { x: 0, y: 0 }])) as Record<string, { x: number; y: number }>;
    let frame = 0;
    let last = performance.now();
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(2.5, Math.max(.3, (now - last) / 16.67));
      last = now;
      const next = Object.fromEntries(graphPreviewNodes.map((node) => [node.id, { ...(positions[node.id] ?? { x: node.x, y: node.y }) }])) as Record<string, { x: number; y: number }>;
      graphPreviewNodes.forEach((node, index) => {
        const current = next[node.id];
        graphPreviewNodes.slice(index + 1).forEach((other) => {
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
      graphPreviewEdges.forEach(([source, target]) => {
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
      graphPreviewNodes.forEach((node) => {
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
  }, [stage]);

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
        <span>{seeds.length} seeds · {prompt ? "prompt linked" : "prompt empty"}</span>
      </div>
      <svg className="knowledge-graph-svg" viewBox="0 0 640 570" role="img" aria-label="환경 시드 기반 KOSPI 지식그래프" onPointerDown={handleCanvasPointerDown} onPointerMove={handleCanvasPointerMove} onPointerUp={() => { panRef.current = null; }} onWheel={(event) => { event.preventDefault(); setZoom((current) => Math.max(.72, Math.min(1.55, current + (event.deltaY > 0 ? -.06 : .06)))); }}>
        <defs>
          <pattern id="graph-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#e4e4e7" /></pattern>
        </defs>
        <rect width="640" height="570" fill="url(#graph-grid)" />
        <g transform={`translate(${pan.x + 320} ${pan.y + 250}) scale(${zoom}) translate(-320 -250)`}>
          {graphPreviewEdges.map(([source, target, label]) => {
            const from = positions[source] ?? { x: 320, y: 250 };
            const to = positions[target] ?? { x: 320, y: 250 };
            return <g key={`${source}-${target}`}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#c7c7cc" strokeWidth="1.35" /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4} className="knowledge-edge-label">{label}</text></g>;
          })}
          {graphPreviewNodes.map((node) => {
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
      <div className="knowledge-graph-footer"><span>노드를 드래그하거나 빈 공간을 끌어 이동하세요</span><span>휠 확대·축소 · 선택: {graphPreviewNodes.find((node) => node.id === selectedNode)?.label}</span></div>
    </div>
  );
}

function ScenarioBuildScreen({
  seeds,
  prompt,
  uploadedFile,
  stage,
  period,
  onStartSimulation,
  simulationStarted,
  onClose,
}: {
  seeds: string[];
  prompt: string;
  uploadedFile: UploadedSeed | null;
  stage: BuildStage;
  period: string;
  onStartSimulation: () => void;
  simulationStarted: boolean;
  onClose: () => void;
}) {
  const complete = stage === 6;
  const entityTypes = ["지수", "종목", "섹터", "이벤트", "환율", "수급", "금리"];
  const relationTypes = ["DRIVES", "IMPACTS", "TRACKS", "CORRELATES_WITH", "CONSTRAINS", "TRIGGERS"];
  const statusFor = (step: number) => stage > step ? "COMPLETED" : stage === step ? "IN PROGRESS" : "WAITING";
  const cardClass = (step: number) => `build-step-card ${stage > step ? "done" : stage === step ? "active" : "waiting"}`;
  const profileCards = [
    { name: "외국인 수급 에이전트", handle: "@foreign_flow_01", type: "Flow Analyst", stance: "SUPPORTIVE", body: "글로벌 자금 흐름과 원·달러 변화를 추적해 순매수 전환의 지속성을 판단합니다." },
    { name: "반도체 실적 에이전트", handle: "@semiconductor_02", type: "Earnings Analyst", stance: "BULLISH", body: "삼성전자·SK하이닉스의 실적, HBM 수요, 메모리 가격을 연결해 섹터 반응을 계산합니다." },
    { name: "거시경제 에이전트", handle: "@macro_policy_03", type: "Macro Agent", stance: "NEUTRAL", body: "미국 금리와 중국 경기, 환율을 바탕으로 위험 프리미엄과 할인율 변화를 반영합니다." },
    { name: "시장 심리 에이전트", handle: "@sentiment_04", type: "Sentiment Agent", stance: "CAUTIOUS", body: "뉴스의 방향성과 투자자 심리를 읽어 과매도 반등과 추세 전환을 구분합니다." },
  ];
  return (
    <div className="scenario-build-screen">
      <header className="scenario-build-header">
        <div><span>FINVERSE · SCENARIO LAB</span><h2>온톨로지와 지식그래프를 준비합니다</h2><p>환경 시드와 사용자 프롬프트에서 KOSPI에 영향을 주는 엔터티와 관계를 추출했습니다.</p></div>
        <button className="scenario-modal-close" type="button" onClick={onClose} aria-label="시나리오 빌더 닫기"><X size={20} /></button>
      </header>
      <div className="scenario-build-meta"><span><Database size={14} /> {seeds.length}개 환경 시드</span><span><FileUp size={14} /> {uploadedFile ? uploadedFile.name : "추가 데이터 없음"}</span><span><GitBranch size={14} /> KOSPI · 2026.08.01</span></div>
      <div className="scenario-build-grid">
        <section className="knowledge-graph-panel" aria-label="시나리오 지식그래프">
          <div className="build-panel-heading"><div><span>GRAPH RELATIONSHIP VISUALIZATION</span><h3>시나리오 지식그래프</h3></div><span className="build-live-badge">{complete ? "BUILD COMPLETE" : "BUILDING"}</span></div>
          <KnowledgeGraphPreview seeds={seeds} prompt={prompt} stage={stage} />
        </section>
        <section className="build-process-panel" aria-label="온톨로지 빌드 진행 상태">
          <article className={cardClass(1)}>
            <div className="build-step-header"><span className="build-step-number">01</span><div><h3>Ontology Generation</h3><small>POST /api/graph/ontology/generate</small></div><strong>{statusFor(1)}</strong></div>
            <p>환경 시드와 예측 요구사항을 분석해 시장에 맞는 엔터티·관계 타입을 구성합니다.</p>
            <div className="build-chip-group"><small>GENERATED ENTITY TYPES</small><div>{entityTypes.map((item) => <span key={item}>{item}</span>)}</div></div>
            {stage === 1 && <div className="build-progress-line"><LoaderCircle size={15} className="spin" /> 시나리오 문맥에서 구성요소를 추출하는 중</div>}
          </article>
          <article className={cardClass(2)}>
            <div className="build-step-header"><span className="build-step-number">02</span><div><h3>GraphRAG Build</h3><small>POST /api/graph/build</small></div><strong>{statusFor(2)}</strong></div>
            <p>추출된 온톨로지를 바탕으로 KOSPI 지수·종목·환율·이벤트 사이의 연결을 그래프로 묶습니다.</p>
            <div className="build-result-grid"><div><b>{stage > 1 ? "42" : "—"}</b><small>ENTITY NODES</small></div><div><b>{stage > 1 ? "68" : "—"}</b><small>RELATION EDGES</small></div><div><b>{stage > 1 ? "7" : "—"}</b><small>SCHEMA TYPES</small></div></div>
            <div className="build-chip-group"><small>GENERATED RELATION TYPES</small><div>{relationTypes.map((item) => <span key={item}>{item}</span>)}</div></div>
          </article>
          <article className={cardClass(3)}>
            <div className="build-step-header"><span className="build-step-number">03</span><div><h3>Generate Agent Profiles</h3><small>POST /api/simulation/prepare</small></div><strong>{statusFor(3)}</strong></div>
            <p>환경 시드와 연결된 엔터티를 역할별 에이전트로 바꾸고, 각자의 관점·활동량·편향을 설정합니다.</p>
            <div className="build-result-grid"><div><b>{stage > 3 ? "24" : "—"}</b><small>CURRENT AGENTS</small></div><div><b>{stage > 3 ? "24" : "—"}</b><small>EXPECTED TOTAL</small></div><div><b>{stage > 3 ? "96" : "—"}</b><small>RELATED TOPICS</small></div></div>
            {stage >= 3 && <div className="agent-profile-grid">{profileCards.map((profile) => <article key={profile.handle} className="agent-profile-card"><div className="agent-profile-top"><span className="agent-avatar"><UserRound size={16} /></span><div><strong>{profile.name}</strong><small>{profile.handle}</small></div><em>{profile.stance}</em></div><span className="agent-profile-type">{profile.type}</span><p>{profile.body}</p><div className="agent-topic-row"><span>반도체</span><span>수급</span><span>변동성</span></div></article>)}</div>}
            {stage === 3 && <div className="build-progress-line"><LoaderCircle size={15} className="spin" /> 에이전트 프로필과 관련 토픽을 생성하는 중</div>}
          </article>
          <article className={cardClass(4)}>
            <div className="build-step-header"><span className="build-step-number">04</span><div><h3>Generate Config</h3><small>POST /api/simulation/prepare</small></div><strong>{statusFor(4)}</strong></div>
            <p>시나리오 요구사항과 에이전트 프로필을 바탕으로 시장 환경값, 라운드, 활동 시간과 모델 설정을 계산합니다.</p>
            <div className="config-metric-grid"><div><span>Duration</span><b>{period === "7일" ? "7 days" : period === "3개월" ? "90 days" : "30 days"}</b></div><div><span>Round Duration</span><b>60 min</b></div><div><span>Total Rounds</span><b>{period === "7일" ? "168" : period === "3개월" ? "2160" : "720"} rounds</b></div><div><span>Active / Hour</span><b>12–34</b></div></div>
            <div className="config-row-list"><div><strong>Peak Hours</strong><span>19:00, 20:00, 21:00, 22:00</span><em>×1.5</em></div><div><strong>Work Hours</strong><span>09:00–18:00</span><em>×0.7</em></div><div><strong>Morning Hours</strong><span>06:00–08:00</span><em>×0.4</em></div><div><strong>Off-Peak Hours</strong><span>00:00–05:00</span><em>×0.05</em></div></div>
            {stage === 4 && <div className="build-progress-line"><LoaderCircle size={15} className="spin" /> 시뮬레이션 환경값을 계산하는 중</div>}
            {stage >= 4 && <div className="llm-reasoning"><small>LLM CONFIG REASONING</small><p><strong>Time config:</strong> KOSPI 시나리오는 장중 수급과 미국 시장 반응이 겹치는 30일을 기준으로 설정했습니다. 저녁 피크에는 미국 금리·AI CapEx 뉴스가 집중되고, 장 시작 전에는 환율과 외국인 선물 수급이 반영되도록 활동량을 조정합니다.</p><p><strong>Event config:</strong> SK하이닉스 실적과 외국인 순매수 회복을 초기 이벤트로 두고, 원·달러와 CXMT 경쟁 심화가 반대 방향의 변동성을 만들도록 구성했습니다.</p></div>}
          </article>
          <article className={cardClass(5)}>
            <div className="build-step-header"><span className="build-step-number">04</span><div><h3>Initial Activation Orchestration</h3><small>POST /api/simulation/prepare</small></div><strong>{statusFor(5)}</strong></div>
            <p>에이전트의 첫 행동과 시장 내러티브 방향을 정해 시뮬레이션의 출발점을 고정합니다.</p>
            <div className="narrative-guide"><span><Sparkles size={14} /> NARRATIVE GUIDE DIRECTION</span><p>외국인 수급이 돌아오고 반도체 실적이 기대를 웃돌면서 KOSPI가 기술적 반등을 시도합니다. 다만 환율과 금리 변수에 따라 반등의 폭은 달라집니다.</p></div>
            <div className="hot-topic-row"><small>INITIAL HOT TOPICS</small><div><span># KOSPI</span><span># 외국인 순매수</span><span># SK하이닉스</span><span># AI CapEx</span><span># 원·달러</span></div></div>
            {stage >= 5 && <div className="activation-sequence"><small>INITIAL ACTIVATION SEQUENCE (4)</small>{["SK하이닉스 실적 발표가 컨센서스를 웃돌았습니다.","외국인 현물·선물 순매수가 동시에 포착됩니다.","미국 빅테크가 AI CapEx 유지 계획을 발표합니다.","원·달러 환율이 안정되며 위험 선호가 회복됩니다."].map((item,index)=><div key={item}><b>0{index+1}</b><span>{item}</span></div>)}</div>}
          </article>
          <article className={`build-step-card build-ready-card ${stage > 6 ? "done" : stage === 6 ? "active" : "waiting"}`}>
            <div className="build-step-header"><span className="build-step-number">05</span><div><h3>Ready</h3><small>POST /api/simulation/start</small></div><strong>{simulationStarted ? "RUNNING" : stage >= 6 ? "READY" : statusFor(6)}</strong></div>
            <p>{simulationStarted ? "시뮬레이션이 시작되었습니다. 에이전트들이 초기 환경에서 상호작용을 생성하고 있습니다." : "시뮬레이션 환경이 준비되었습니다. 설정을 확인한 뒤 실행할 수 있습니다."}</p>
            <div className="ready-rounds"><b>{period === "7일" ? "168" : period === "3개월" ? "2160" : "720"}</b><span>rounds</span><em>Est. {period === "7일" ? "~6 min" : period === "3개월" ? "~72 min" : "~24 min"}</em></div>
            <button className="build-continue-button" type="button" onClick={onStartSimulation} disabled={stage < 6 || simulationStarted}>{simulationStarted ? <>시뮬레이션 실행 중 <LoaderCircle size={17} className="spin" /></> : stage >= 6 ? <>Start KOSPI Scenario Simulation <ArrowRight size={17} /></> : <><LoaderCircle size={17} className="spin" /> 이전 단계 처리 중</>}</button>
          </article>
        </section>
      </div>
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
      const forecastOffset = closes[closes.length - 1] - scenario.path[0];
      const forecastPath = scenario.path.map((value) => value + forecastOffset);
      const outerUpper = forecastPath.map((value, index) => value + 80 + index * 60);
      const outerLower = forecastPath.map((value, index) => value - 80 - index * 60);
      const innerUpper = forecastPath.map((value, index) => value + 45 + index * 32);
      const innerLower = forecastPath.map((value, index) => value - 45 - index * 32);
      const all = [...closes, ...outerUpper, ...outerLower];
      const axisStep = 500;
      const min = Math.floor((Math.min(...all) - 40) / axisStep) * axisStep;
      const max = Math.ceil((Math.max(...all) + 40) / axisStep) * axisStep;
      const xActual = (index: number) => pad.left + (index / Math.max(candles.length - 1, 1)) * (splitX - pad.left);
      const xForecast = (index: number) => splitX + (index / Math.max(forecastPath.length - 1, 1)) * (rightX - splitX);
      const y = (value: number) => pad.top + ((max - value) / (max - min)) * plotH;

      ctx.clearRect(0, 0, width, height);
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.textAlign = "right";
      ctx.fillStyle = "#a1a1aa";
      ctx.strokeStyle = "#ececef";
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
        ctx.fillStyle = scenario.tone === "up" ? `rgba(239,68,68,${opacity})` : `rgba(37,99,235,${opacity})`;
        ctx.fill();
      };

      drawBand(outerUpper, outerLower, 0.08);
      drawBand(innerUpper, innerLower, 0.12);

      const candleWidth = Math.max(3, Math.min(7, (splitX - pad.left) / candles.length * 0.58));
      candles.slice(1).forEach((candle, index) => {
        const px = xActual(index + 1);
        const color = candle.close >= candle.open ? "#ef4444" : "#2563eb";
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
      ctx.strokeStyle = "#a1a1aa";
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
      const forecastColor = scenario.tone === "up" ? "#ef4444" : "#2563eb";
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

      ctx.strokeStyle = "#18181b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(splitX, pad.top);
      ctx.lineTo(splitX, height - pad.bottom);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.fillStyle = "#71717a";
      const actualLabelIndexes = [0, .25, .5, .75, 1].map((ratio) => Math.round((candles.length - 1) * ratio));
      actualLabelIndexes.forEach((pathIndex) => {
        ctx.fillText(candles[pathIndex].label, xActual(pathIndex), height - 12);
      });
      ctx.fillStyle = "#fff";
      ctx.fillRect(splitX - 20, height - 29, 40, 24);
      ctx.fillStyle = "#18181b";
      ctx.fillRect(splitX - 20, height - 29, 40, 24);
      ctx.fillStyle = "#fff";
      ctx.font = '700 10px "Pretendard Variable", sans-serif';
      ctx.fillText(candles[candles.length - 1].label, splitX, height - 13);
      ctx.font = '10px "Pretendard Variable", sans-serif';
      ctx.fillStyle = "#a1a1aa";
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

function TwinPathChart({ scenario }: { scenario: Scenario }) {
  const targets = [140.2, 121.6, 107.8];
  const colors = ["#111113", "#ef4444", "#2563eb"];
  const selectedIndex = scenario.id === "kospi-rebound" ? 0 : scenario.id === "chip-miss" ? 1 : 2;
  const x = (index: number) => 24 + (index / 11) * 496;
  const y = (value: number) => 142 - ((value - 94) / 54) * 110;
  const makeLine = (target: number) => Array.from({ length: 12 }, (_, index) => 128.5 + ((target - 128.5) * index) / 11 + Math.sin(index * 1.25) * .65);
  const lines = targets.map(makeLine);
  const selectedLine = lines[selectedIndex];
  const forecastColor = colors[selectedIndex];
  const selectedPath = selectedLine.map((value, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const upper = selectedLine.map((value, index) => `${x(index).toFixed(1)},${y(value + 4 + index * .45).toFixed(1)}`).join(" ");
  const lower = [...selectedLine].reverse().map((value, reverseIndex) => { const index = 11 - reverseIndex; return `${x(index).toFixed(1)},${y(value - 4 - index * .45).toFixed(1)}`; }).join(" ");
  return (
    <svg className="twin-path-chart" viewBox="0 0 540 170" role="img" aria-label="나의 자산 예상 경로">
      {[28, 60, 92, 124].map((line) => <line key={line} x1="24" y1={line} x2="520" y2={line} stroke="#ededf0" strokeWidth="1" />)}
      <polygon points={`${upper} ${lower}`} fill={forecastColor === "#111113" ? "rgba(17,17,19,.08)" : `${forecastColor}18`} />
      {lines.map((line, index) => <path key={index} d={line.map((value, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${x(pointIndex).toFixed(1)} ${y(value).toFixed(1)}`).join(" ")} fill="none" stroke={colors[index]} strokeWidth={index === selectedIndex ? "2.8" : "1.6"} strokeDasharray={index === selectedIndex ? undefined : "5 4"} strokeLinecap="round" opacity={index === selectedIndex ? 1 : .72} />)}
      <circle cx="24" cy={y(128.5)} r="4" fill="#111113" />
      {targets.map((target, index) => <text key={target} x="468" y={y(target) - (index === 0 ? 7 : index === 1 ? 0 : -9)} fill={colors[index]} fontSize="11" fontWeight="700">{target.toFixed(1)} ({target > 128.5 ? "+9.1%" : target === 121.6 ? "-5.4%" : "-16.1%"})</text>)}
      <text x="18" y="154" fill="#a1a1aa" fontSize="10">현재</text><text x="180" y="154" fill="#a1a1aa" fontSize="10">7일 후</text><text x="342" y="154" fill="#a1a1aa" fontSize="10">14일 후</text><text x="486" y="154" fill="#a1a1aa" fontSize="10">1개월 후</text>
      <text x="32" y={y(128.5) - 9} fill="#27272a" fontSize="11" fontWeight="700">128.5</text>
    </svg>
  );
}

function TwinPage({ selectedScenario, onSelectScenario, onOpenBuilder }: { selectedScenario: Scenario; onSelectScenario: (scenario: Scenario) => void; onOpenBuilder: () => void }) {
  const [twinScenarioId, setTwinScenarioId] = useState(selectedScenario.id);
  const twinScenario = scenarios.find((scenario) => scenario.id === twinScenarioId) ?? selectedScenario;
  const holdings = [
    { symbol: "S", name: "삼성전자", code: "005930", value: "220,000원", weight: "28.6%", change: "+1.03%", contribution: "+286,500원", tone: "up" },
    { symbol: "H", name: "SK하이닉스", code: "000660", value: "1,555,000원", weight: "24.3%", change: "-0.74%", contribution: "-182,400원", tone: "down" },
    { symbol: "E", name: "KODEX 200", code: "069500", value: "34,210원", weight: "18.7%", change: "+0.42%", contribution: "+90,800원", tone: "up" },
    { symbol: "$", name: "USD 현금", code: "KRW 환산", value: "23,600,000원", weight: "18.4%", change: "0.00%", contribution: "0원", tone: "flat" },
  ];
  return (
    <div className="twin-page">
      <header className="page-heading twin-heading"><div><span>MY FINANCIAL TWIN</span><h1>내 금융 상태를 이해하고, 다음 선택을 미리 확인하세요.</h1></div><div className="market-stamp"><CalendarDays size={15} />2026.07.28 KRX 장마감 기준</div></header>
      <section className="panel twin-assets-panel"><div className="panel-title"><h2>나의 자산 현황</h2><span className="twin-profile-chip"><UserRound size={13} /> 김민서님</span></div><div className="twin-assets-grid"><div className="twin-metric"><span>총 자산(평가금액)</span><strong>128,450,000원</strong><small>전일 대비 <b className="up">+1,250,000원 (+0.98%)</b></small></div><div className="twin-metric"><span>현금 비중</span><strong>18.4<em>%</em></strong><small>23,600,000원</small></div><div className="twin-metric"><span>목표 달성률</span><strong>62<em>%</em></strong><div className="twin-progress"><i style={{ width: "62%" }} /></div><small>목표 금액 200,000,000원</small></div><div className="twin-net-chart"><div><span>순자산 추이 (최근 6개월)</span><strong>+18.4%</strong></div><svg viewBox="0 0 280 92" aria-label="최근 6개월 순자산 추이"><line x1="0" y1="22" x2="280" y2="22" /><line x1="0" y1="48" x2="280" y2="48" /><line x1="0" y1="74" x2="280" y2="74" /><path d="M4 71 C19 65 28 69 40 58 S62 62 74 50 S93 46 104 48 S124 38 137 41 S152 29 166 34 S183 22 196 28 S212 21 222 24 S237 11 248 17 S262 8 276 4" /></svg><div className="twin-chart-labels"><span>2월</span><span>3월</span><span>4월</span><span>5월</span><span>6월</span><span>7월</span></div></div></div></section>
      <section className="twin-main-grid"><section className="panel twin-portfolio-panel"><div className="panel-title"><h2>포트폴리오 보유 현황</h2><button className="twin-text-button" type="button">전체 보기 <ChevronRight size={15} /></button></div><div className="twin-table-wrap"><table className="twin-table"><thead><tr><th>종목</th><th>현재가</th><th>비중</th><th>등락률(1D)</th><th>기여도(1D)</th></tr></thead><tbody>{holdings.map((holding) => <tr key={holding.name}><td><div className="twin-holding-name"><span className={`twin-holding-symbol ${holding.tone}`}>{holding.symbol}</span><div><strong>{holding.name}</strong><small>{holding.code} · KOSPI</small></div></div></td><td>{holding.value}</td><td>{holding.weight}</td><td className={holding.tone}>{holding.change}</td><td className={holding.tone}>{holding.contribution}</td></tr>)}</tbody></table></div><p className="twin-table-note">* 가격과 수익률은 2026.07.28 KRX 장마감 기준이며, 실제 계좌와 다를 수 있습니다.</p></section><section className="panel twin-path-panel"><div className="panel-title"><h2>시나리오별 내 자산 경로</h2><span className="twin-path-caption">조건에 따른 가상 경로</span></div><div className="twin-scenario-cards">{scenarios.map((scenario, index) => <button key={scenario.id} className={`twin-scenario-card ${twinScenario.id === scenario.id ? "active" : ""}`} type="button" onClick={() => { setTwinScenarioId(scenario.id); onSelectScenario(scenario); }}><span className="twin-radio" /><span><small>시나리오 {index + 1}</small><strong>{scenario.title}</strong><em>{scenario.forecast}</em></span><i>{scenario.tone === "up" ? "상승" : "하락"}</i></button>)}<button className="twin-scenario-card twin-add-scenario" type="button" onClick={onOpenBuilder}><Plus size={20} /><span><small>내 시나리오</small><strong>직접 만들기</strong></span></button></div><div className="twin-selected-path"><div className="twin-selected-path-head"><div><span>선택 시나리오</span><strong>{twinScenario.title}</strong></div><b className={twinScenario.tone}>{twinScenario.forecast}</b></div><TwinPathChart scenario={twinScenario} /><p>선택한 시나리오에 따라 보유 자산의 예상 경로가 다시 계산됩니다.</p></div></section></section>
      <section className="panel twin-experts-panel"><div className="panel-title"><h2>금융 대가의 한마디</h2><span>시나리오에 대한 서로 다른 관점</span></div><div className="twin-expert-grid"><article><div className="twin-expert-avatar">WB</div><div><span>워런 버핏 관점</span><h3>좋은 기업도 가격보다 이익의 지속성을 먼저 확인하세요.</h3><p>반등을 따라가기보다 HBM 수요와 외국인 수급이 함께 돌아오는지 확인합니다.</p><button type="button">직접 이야기해보기 <ArrowRight size={14} /></button></div></article><article><div className="twin-expert-avatar">HM</div><div><span>하워드 막스 관점</span><h3>낙폭보다 먼저, 기대가 얼마나 낮아졌는지 계산하세요.</h3><p>실적 리스크와 AI CapEx 둔화가 일시적 충격인지 추세 변화인지 구분합니다.</p><button type="button">직접 이야기해보기 <ArrowRight size={14} /></button></div></article><article><div className="twin-expert-avatar">TR</div><div><span>트럼프식 시장 관점</span><h3>정책과 자금 흐름이 바뀌기 전에는 현금을 협상 카드로 두세요.</h3><p>환율·외국인 수급·정책 뉴스가 같은 방향인지 확인하고 행동합니다.</p><button type="button">직접 이야기해보기 <ArrowRight size={14} /></button></div></article></div><div className="twin-disclaimer">상기 정보는 AI 분석 기반 참고 자료이며, 투자 판단의 최종 책임은 본인에게 있습니다.</div></section>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>("market");
  const [kospiData, setKospiData] = useState<KospiMarketData | null>(null);
  const [intradayIndices, setIntradayIndices] = useState<IntradayIndex[]>([]);
  const [dashboardSignals, setDashboardSignals] = useState<DashboardSignal[]>(marketSignals);
  const [marketBrief, setMarketBrief] = useState<string[]>(defaultMarketBrief);
  const [marketBriefExpanded, setMarketBriefExpanded] = useState(false);
  const [selectedMarketSignal, setSelectedMarketSignal] = useState<DashboardSignal | null>(null);
  const [selectedScenario, setSelectedScenario] = useState(scenarios[0]);
  const [scenarioDetailOpen, setScenarioDetailOpen] = useState(false);
  const [scenarioEditorial, setScenarioEditorial] = useState<ScenarioEditorial>(() => fallbackEditorial(scenarios[0]));
  const [editorialState, setEditorialState] = useState<EditorialState>("fallback");
  const [editorialMeta, setEditorialMeta] = useState<{ generatedAt: string; model: string } | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<"form" | "build">("form");
  const [buildStage, setBuildStage] = useState<BuildStage>(1);
  const [simulationStarted, setSimulationStarted] = useState(false);
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(["외국인 순매수 회복", "SK하이닉스 실적 서프라이즈"]);
  const [period, setPeriod] = useState("30일");
  const [scenarioPrompt, setScenarioPrompt] = useState("8월 말까지 외국인 수급과 반도체 실적이 KOSPI에 미치는 영향을 비교해줘.");
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
  const kospiAsOfLabel = `${kospiAsOf.slice(0, 4)}.${Number(kospiAsOf.slice(5, 7))}.${Number(kospiAsOf.slice(8, 10))}`;

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

  const toggleSeed = (seed: string) => {
    setSelectedSeeds((current) =>
      current.includes(seed) ? current.filter((item) => item !== seed) : [...current, seed],
    );
  };

  const openBuilder = () => {
    if (buildTimer.current) window.clearTimeout(buildTimer.current);
    setBuilderMode("form");
    setBuildStage(1);
    setSimulationStarted(false);
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
    const activeSeeds = selectedSeeds.length ? selectedSeeds : ["KOSPI 기본 환경"];
    setSelectedScenario({
      ...scenarios[0],
      id: "custom",
      title: activeSeeds.slice(0, 2).join(" · "),
      duration: period,
      tags: activeSeeds.slice(0, 2),
      summary: `${activeSeeds.join(", ")} 조건을 바탕으로 ${period} 동안 KOSPI와 연결된 종목·환율·수급·이벤트의 상호작용을 분석하는 사용자 지정 시나리오입니다. ${scenarioPrompt}`,
      forecast: "조건부 경로 계산",
    });
    setBuilderMode("build");
    setBuildStage(1);
    setSimulationStarted(false);
    setScenarioDetailOpen(false);
    let nextStage: BuildStage = 1;
    const advanceBuild = () => {
      if (nextStage >= 6) return;
      nextStage = (nextStage + 1) as BuildStage;
      setBuildStage(nextStage);
      if (nextStage < 6) buildTimer.current = window.setTimeout(advanceBuild, 5000);
    };
    buildTimer.current = window.setTimeout(advanceBuild, 5000);
  };

  const startSimulation = () => {
    setSimulationStarted(true);
  };

  return (
    <div className="finverse-app">
      <header className="mobile-header">
        <button className="sidebar-brand" onClick={() => activateTab("market")} aria-label="FINVERSE 시장 인사이트 홈">
          <span className="brand-mark">F</span><span>FINVERSE</span>
        </button>
      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="FINVERSE 탐색">
          <button className="sidebar-brand" onClick={() => activateTab("market")} aria-label="FINVERSE 시장 인사이트 홈">
            <span className="brand-mark">F</span><span>FINVERSE</span>
          </button>
          <div className="sidebar-label"><BrainCircuit size={19} /><div><span>AI DECISION LAB</span><strong>금융 판단 실험실</strong></div></div>
          <nav className="side-tabs">
            <button className={activeTab === "market" ? "active" : ""} onClick={() => activateTab("market")}><BarChart3 size={18} />시장 인사이트</button>
            <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}><UserRound size={18} />마이 금융 트윈</button>
          </nav>
          <button className="sidebar-help" type="button"><CircleHelp size={20} /><span>도움말</span><ChevronRight size={17} /></button>
        </aside>

        <main className="main-content">
          {activeTab === "market" ? (
            <div className="market-page">
              <header className="page-heading">
                <div><span>MARKET INSIGHT</span><h1>오늘의 시장을 이해하고, 다음 움직임을 미리 살펴보세요.</h1></div>
                <div className="market-stamp"><CalendarDays size={15} />{kospiAsOfLabel} 최신 기준</div>
              </header>

              <section className="market-dashboard">
                <section className="panel connection-panel market-signal-panel">
                  <div className="panel-title">
                    <div><span>MARKET PULSE</span><h2>시장 연결</h2></div>
                  </div>
                  <div className="signal-stack">
                    {dashboardSignals.map((signal) => {
                      const Icon = marketSignalIcons[signal.key];
                      return (
                        <article className={`signal-group ${signal.key}`} key={signal.key}>
                          <button className="signal-group-button" type="button" onClick={() => setSelectedMarketSignal(signal)} aria-label={`${signal.label} 상세 보기`}>
                            <span className="signal-group-head">
                              <span className="signal-icon"><Icon size={15} /></span>
                              <strong>{signal.label}</strong>
                              <span className="signal-share"><ChevronRight className="signal-disclosure" size={12} /></span>
                            </span>
                            <span className="signal-events">
                              {signal.topics.slice(0, 2).map((topic) => {
                                const importance = importanceScore(topic.importance);
                                return <span key={topic.title}><span><strong>{topic.title}</strong><small>근거 {topic.sources?.length ?? 0}개</small></span><b aria-label={`중요도 ${importance}점`}>{"★".repeat(importance)}{"☆".repeat(3 - importance)}</b></span>;
                              })}
                            </span>
                            <span className="signal-track" aria-hidden="true">
                              {signal.topics.slice(0, 2).map((topic) => <i key={topic.title} />)}
                            </span>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="panel chart-panel">
                  <div className="market-overview">
                    <article className="market-overview-primary kospi-classic-primary">
                      <div className="kospi-head">
                        <div>
                          <div className="kospi-title-line"><span>코스피</span></div>
                          <div className="kospi-value-line"><b>{formatIndexValue(kospiValue)}</b><strong className={kospiTone}>{formatSignedIndex(kospiChange)} ({Math.abs(kospiRate).toFixed(2)}%)</strong></div>
                        </div>
                        <div className="scenario-preview-meta">
                          <span>선택 시나리오</span>
                          <button className="scenario-preview-card" type="button" onClick={() => openScenarioDetail(selectedScenario)} aria-label={`${selectedScenario.title} 상세 보기`}>
                            <strong>{selectedScenario.title}</strong>
                            <b className={selectedScenario.tone}>{selectedScenario.forecast}</b>
                          </button>
                        </div>
                      </div>
                      <ForecastChart scenario={selectedScenario} marketData={kospiData} liveSeries={liveKospi} />
                    </article>
                    <div className="market-overview-side">
                      {marketOverview.slice(1).map((item) => {
                        const live = intradayIndices.find((index) => index.name === item.name);
                        const latest = live?.points.at(-1);
                        const values = live?.points.map((point) => point.close) ?? item.points;
                        const rate = latest?.changePct;
                        const previousClose = latest && rate !== -100 ? latest.close / (1 + rate / 100) : latest?.close;
                        const change = latest && previousClose !== undefined ? latest.close - previousClose : undefined;
                        const tone = rate === undefined ? item.tone : rate >= 0 ? "up" : "down";
                        return (
                          <article className="market-overview-mini" key={item.key}>
                            <MarketLineChart values={values} name={`${item.name} 당일`} />
                            <div>
                              <header><span>{item.name}</span></header>
                              <div className="market-overview-mini-value">
                                <b>{latest ? formatIndexValue(latest.close) : item.value}</b>
                                <span className={tone}>
                                  {change === undefined || rate === undefined
                                    ? `${item.change} (${item.rate})`
                                    : `${formatSignedIndex(change)} (${Math.abs(rate).toFixed(2)}%)`}
                                </span>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                  <div className={`ai-summary ${marketBriefExpanded ? "expanded" : ""}`}>
                    <Sparkles size={17} />
                    <button className="ai-summary-copy" type="button" aria-expanded={marketBriefExpanded} aria-label={`AI 요약 전문 ${marketBriefExpanded ? "접기" : "보기"}`} onClick={() => setMarketBriefExpanded((expanded) => !expanded)}>
                      <strong>AI 요약</strong>
                      <p>{marketBrief.map((line) => <span key={line}>{line}</span>)}</p>
                    </button>
                  </div>
                </section>

                <aside className="panel event-panel">
                  <div className="panel-title"><div><span>가상 시뮬레이션</span><h2>발생 가능 이벤트</h2></div><span className="scenario-period">{selectedScenario.duration}</span></div>
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
              </section>

              <section className="scenario-section">
                <div className="scenario-heading"><div><span>SCENARIO LIBRARY</span><h2>시나리오별 KOSPI 경로를 비교하세요</h2><p>준비된 시장 환경을 선택하면 발생 가능 이벤트와 조건부 예상 경로가 열립니다.</p></div><span><CircleDollarSign size={15} />가상 시뮬레이션</span></div>
                <div className="scenario-grid">
                  {scenarios.map((scenario) => (
                    <article key={scenario.id} className={`scenario-card ${scenario.id} ${selectedScenario.id === scenario.id ? "active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectScenario(scenario)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectScenario(scenario); }} role="button" tabIndex={0} aria-pressed={selectedScenario.id === scenario.id}>
                      <div className="scenario-card-main">
                        <span className={`scenario-icon ${scenario.tone}`}>
                          {scenario.id === "kospi-rebound" ? <BarChart3 size={22} /> : scenario.id === "chip-miss" ? <BrainCircuit size={22} /> : scenario.id === "risk-off" ? <CircleDollarSign size={22} /> : <UserRound size={22} />}
                        </span>
                        <div>
                          <h3>{scenario.title}</h3>
                          <div className="scenario-tags"><span>{scenario.duration}</span>{scenario.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                        </div>
                      </div>
                      <small>조건부 예상</small>
                      <strong className={scenario.tone}>{scenario.forecast}</strong>
                      <button className="scenario-card-detail-button" type="button" onClick={(event) => { event.stopPropagation(); openScenarioDetail(scenario); }}>상세 보기 <ChevronRight size={15} /></button>
                    </article>
                  ))}
                  <button className="custom-scenario-card" onClick={openBuilder}>
                    <Plus size={24} /><div><strong>내 시나리오 예측하기</strong><p>원하는 시장 조건과 기간을 직접 선택하세요.</p></div><ArrowRight size={18} />
                  </button>
                </div>
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
          ) : <TwinPage selectedScenario={selectedScenario} onSelectScenario={setSelectedScenario} onOpenBuilder={openBuilder} />}
        </main>
      </div>

      <nav className="mobile-tabs" aria-label="모바일 주요 메뉴">
        <button className={activeTab === "market" ? "active" : ""} onClick={() => activateTab("market")}><BarChart3 size={18} /><span>시장 인사이트</span></button>
        <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}><UserRound size={18} /><span>마이 금융 트윈</span></button>
      </nav>

      {builderOpen && (
        <div className="modal-backdrop scenario-builder-backdrop" onMouseDown={closeBuilder}>
          {builderMode === "form" ? (
            <section className="scenario-modal scenario-builder-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-modal-title" onMouseDown={(event) => event.stopPropagation()}>
              <header className="scenario-builder-header"><div><span>MY SCENARIO LAB · 2026.08.01</span><h2 id="scenario-modal-title">내 시나리오를 설계해보세요</h2><p>환경 시드와 나만의 질문을 입력하면 KOSPI 지식그래프를 만들고 미래 경로를 비교합니다.</p></div><button className="scenario-modal-close" type="button" onClick={closeBuilder} aria-label="시나리오 빌더 닫기"><X size={20} /></button></header>
              <div className="builder-section-heading"><div><span>01 · ENVIRONMENT SEEDS</span><h3>시장의 출발 조건을 골라주세요</h3></div><small>26년 8월 1일 기준 준비된 변수</small></div>
              <div className="builder-seed-grid">
                {environmentSeeds.map((seed) => <button key={seed.id} type="button" className={selectedSeeds.includes(seed.label) ? "active" : ""} onClick={() => toggleSeed(seed.label)}><span className="builder-seed-top"><em>{seed.category}</em>{selectedSeeds.includes(seed.label) ? <CheckCircle2 size={15} /> : <Plus size={15} />}</span><strong>{seed.label}</strong><small>{seed.detail}</small></button>)}
              </div>
              <div className="builder-input-grid">
                <div className="builder-group builder-upload-group"><div className="builder-section-heading compact"><div><span>02 · SOURCE DATA</span><h3>나만의 데이터 추가</h3></div></div><label className="upload-dropzone" htmlFor="scenario-seed-upload"><FileUp size={18} /><span>{uploadedSeedFile ? uploadedSeedFile.name : "파일을 끌어오거나 눌러 업로드"}</span><small>{uploadedSeedFile ? `${Math.max(1, Math.round(uploadedSeedFile.size / 1024))}KB · 그래프 시드로 사용` : "TXT · MD · CSV · JSON · PDF"}</small></label><input id="scenario-seed-upload" className="visually-hidden" type="file" accept=".txt,.md,.csv,.json,.pdf,text/*,application/pdf" onChange={handleSeedUpload} />{uploadedSeedFile?.preview && <p className="upload-preview">{uploadedSeedFile.preview}</p>}</div>
                <div className="builder-group"><div className="builder-section-heading compact"><div><span>03 · SIMULATION PROMPT</span><h3>예측 시나리오 질문</h3></div></div><textarea className="scenario-prompt" value={scenarioPrompt} onChange={(event) => setScenarioPrompt(event.target.value)} placeholder="예: 외국인 수급이 회복되고 반도체 수출이 늘면 8월 말 KOSPI는 어떻게 움직일까?" rows={5} /><div className="builder-prompt-hint"><Sparkles size={14} /> 선택한 시드와 함께 에이전트 분석에 전달됩니다.</div></div>
              </div>
              <div className="builder-period-row"><div><span>예측 기간</span><small>지식그래프에서 경로를 계산할 구간</small></div><div className="builder-period-options">{["7일", "30일", "3개월"].map((item) => <button key={item} type="button" className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
              <button className="run-custom-button" type="button" onClick={runCustomScenario}><Network size={18} /> 시나리오 시작하기 <ArrowRight size={17} /></button>
            </section>
          ) : (
            <section className="scenario-modal scenario-build-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-build-title" onMouseDown={(event) => event.stopPropagation()}>
              <ScenarioBuildScreen seeds={selectedSeeds.length ? selectedSeeds : ["KOSPI 기본 환경"]} prompt={scenarioPrompt} uploadedFile={uploadedSeedFile} stage={buildStage} period={period} simulationStarted={simulationStarted} onStartSimulation={startSimulation} onClose={closeBuilder} />
            </section>
          )}
        </div>
      )}

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
            <small className="market-signal-modal-note">{selectedMarketSignal.analysisSource === "bedrock" ? `Amazon Bedrock 분석 · ${selectedMarketSignal.analysisGeneratedAt ? new Date(selectedMarketSignal.analysisGeneratedAt).toLocaleString("ko-KR") : "최신 배치"}` : "DB 원천을 규칙 기반으로 정리한 결과입니다."}</small>
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
