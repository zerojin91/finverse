"use client";

import {
  ArrowRight,
  BarChart3,
  Bookmark,
  BrainCircuit,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  CheckCircle2,
  Database,
  FileUp,
  GitBranch,
  LoaderCircle,
  Network,
  Plus,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";

type MainTab = "market" | "twin";

type Scenario = {
  id: string;
  title: string;
  duration: string;
  tags: string[];
  forecast: string;
  tone: "up" | "down";
  image: string;
  summary: string;
  path: number[];
  events: { week: string; category: string; title: string; body: string; impact: string }[];
  agentInsights: { role: string; title: string; body: string }[];
  riskPoints: string[];
};

const marketConnections = [
  { symbol: "S", name: "삼성전자", code: "005930 · KOSPI", value: "220,000원", change: "-13.39%", contribution: "-1.68%p", tone: "down" },
  { symbol: "H", name: "SK하이닉스", code: "000660 · KOSPI", value: "1,555,000원", change: "-14.65%", contribution: "-2.42%p", tone: "down" },
  { symbol: "$", name: "원·달러 환율", code: "USD/KRW", value: "1,462.50", change: "-0.41%", contribution: "+0.12%p", tone: "up" },
  { symbol: "F", name: "외국인 수급", code: "KOSPI", value: "-5조 1,200억원", change: "순매도", contribution: "-3.12%p", tone: "down" },
  { symbol: "C", name: "반도체 지수", code: "KRX 반도체", value: "4,318.72", change: "-13.82%", contribution: "-3.46%p", tone: "down" },
] as const;

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

function ForecastChart({ scenario }: { scenario: Scenario }) {
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
      const outerUpper = scenario.path.map((value, index) => value + 80 + index * 60);
      const outerLower = scenario.path.map((value, index) => value - 80 - index * 60);
      const innerUpper = scenario.path.map((value, index) => value + 45 + index * 32);
      const innerLower = scenario.path.map((value, index) => value - 45 - index * 32);
      const all = [...actualPath, ...outerUpper, ...outerLower];
      const axisStep = 500;
      const min = Math.floor((Math.min(...all) - 40) / axisStep) * axisStep;
      const max = Math.ceil((Math.max(...all) + 40) / axisStep) * axisStep;
      const xActual = (index: number) => pad.left + (index / (actualPath.length - 1)) * (splitX - pad.left);
      const xForecast = (index: number) => splitX + (index / (scenario.path.length - 1)) * (rightX - splitX);
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

      const candleWidth = Math.max(3, Math.min(6, (splitX - pad.left) / actualPath.length * 0.58));
      actualPath.slice(1).forEach((value, index) => {
        const previous = actualPath[index];
        const px = xActual(index + 1);
        const high = Math.max(previous, value) + 5 + ((index * 7) % 8);
        const low = Math.min(previous, value) - 5 - ((index * 5) % 7);
        const color = value >= previous ? "#ef4444" : "#2563eb";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, y(high));
        ctx.lineTo(px, y(low));
        ctx.stroke();
        const bodyTop = Math.min(y(previous), y(value));
        const bodyHeight = Math.max(2, Math.abs(y(previous) - y(value)));
        ctx.fillStyle = color;
        ctx.fillRect(px - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      });

      const currentY = y(actualPath[actualPath.length - 1]);
      ctx.strokeStyle = "#a1a1aa";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, currentY);
      ctx.lineTo(rightX, currentY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      scenario.path.forEach((value, index) => {
        const px = xForecast(index);
        const py = y(value);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      const forecastColor = scenario.tone === "up" ? "#ef4444" : "#2563eb";
      ctx.strokeStyle = forecastColor;
      ctx.lineWidth = 3;
      ctx.stroke();
      scenario.path.forEach((value, index) => {
        const px = xForecast(index);
        const py = y(value);
        ctx.beginPath();
        ctx.fillStyle = "#fff";
        ctx.arc(px, py, index === scenario.path.length - 1 ? 4.5 : 3.5, 0, Math.PI * 2);
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
      const actualLabelIndexes = [0, 7, 15, 23, actualPath.length - 1];
      actualLabelIndexes.forEach((pathIndex) => {
        ctx.fillText(actualDates[pathIndex], xActual(pathIndex), height - 12);
      });
      ctx.fillStyle = "#fff";
      ctx.fillRect(splitX - 20, height - 29, 40, 24);
      ctx.fillStyle = "#18181b";
      ctx.fillRect(splitX - 20, height - 29, 40, 24);
      ctx.fillStyle = "#fff";
      ctx.font = '700 10px "Pretendard Variable", sans-serif';
      ctx.fillText("7/28", splitX, height - 13);
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
  }, [scenario]);

  return <canvas ref={canvasRef} className="forecast-canvas" aria-label={`${scenario.title} 조건부 KOSPI 예상 경로`} />;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>("market");
  const [selectedScenario, setSelectedScenario] = useState(scenarios[0]);
  const [scenarioDetailOpen, setScenarioDetailOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<"form" | "build">("form");
  const [buildStage, setBuildStage] = useState<BuildStage>(1);
  const [simulationStarted, setSimulationStarted] = useState(false);
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(["외국인 순매수 회복", "SK하이닉스 실적 서프라이즈"]);
  const [period, setPeriod] = useState("30일");
  const [scenarioPrompt, setScenarioPrompt] = useState("8월 말까지 외국인 수급과 반도체 실적이 KOSPI에 미치는 영향을 비교해줘.");
  const [uploadedSeedFile, setUploadedSeedFile] = useState<UploadedSeed | null>(null);
  const scenarioScrollY = useRef<number | null>(null);
  const buildTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);

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
                <div className="market-stamp"><CalendarDays size={15} />2026.07.28 KRX 장마감 기준</div>
              </header>

              <section className="market-dashboard">
                <section className="panel connection-panel">
                  <div className="panel-title"><h2>시장 연결</h2></div>
                  <div className="connection-list">
                    {marketConnections.map((item) => (
                      <article key={item.name}>
                        <div className="connection-main">
                          <span className={`entity-symbol ${item.tone}`}>{item.symbol}</span>
                          <div><strong>{item.name}</strong><small>{item.code}</small></div>
                          <div className={item.tone}><strong>{item.value}</strong><small>{item.change}</small></div>
                        </div>
                        <div className="connection-contribution">
                          <span>KOSPI 기여도</span>
                          <strong className={item.contribution.startsWith("+") ? "up" : "down"}>{item.contribution}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                  <p className="data-note">* 모든 시장 연결 값은 2026.07.28 KRX 장마감 기준입니다.</p>
                </section>

                <section className="panel chart-panel">
                  <div className="kospi-head">
                      <div>
                        <span>KOSPI LIVE</span>
                        <h2 className="down">6,023.66 <strong>-10.84%</strong></h2>
                        <div className="today-change down">▼ 732.09 <span>(오늘)</span></div>
                    </div>
                    <div><span>선택 시나리오</span><strong>{selectedScenario.title}</strong></div>
                  </div>
                  <div className="chart-legend"><span><i className="actual" />KOSPI</span><span><i className={`forecast ${selectedScenario.tone}`} />예상({selectedScenario.duration})</span><span><i className="range" />신뢰구간(70%)</span></div>
                  <ForecastChart scenario={selectedScenario} />
                  <div className="ai-summary"><Sparkles size={17} /><div><strong>AI 요약</strong><p>{selectedScenario.summary}</p></div></div>
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
                    <button key={scenario.id} className={`scenario-card ${selectedScenario.id === scenario.id ? "active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectScenario(scenario)} aria-pressed={selectedScenario.id === scenario.id}>
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
                      <ChevronRight size={18} />
                    </button>
                  ))}
                  <button className="custom-scenario-card" onClick={openBuilder}>
                    <Plus size={24} /><div><strong>내 시나리오 예측하기</strong><p>원하는 시장 조건과 기간을 직접 선택하세요.</p></div><ArrowRight size={18} />
                  </button>
                </div>

                <section className="scenario-detail" id="scenario-detail" aria-live="polite" aria-label="선택한 시나리오 상세 내용">
                  <header className="scenario-detail-header">
                    <div>
                      <span>SELECTED SCENARIO</span>
                      <h3>{selectedScenario.title}</h3>
                      <p>선택한 조건이 실제로 이어졌을 때 KOSPI에 나타날 수 있는 흐름을 단계별로 정리했습니다.</p>
                    </div>
                    <div className={`scenario-detail-forecast ${selectedScenario.tone}`}>
                      <small>{selectedScenario.duration} 예상</small>
                      <strong>{selectedScenario.forecast}</strong>
                    </div>
                  </header>

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
                </section>
              </section>
            </div>
          ) : <section className="twin-blank" aria-label="마이 금융 트윈 작업 영역" />}
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

      {scenarioDetailOpen && (
        <div className="modal-backdrop scenario-detail-backdrop" onMouseDown={() => setScenarioDetailOpen(false)}>
          <section className="scenario-detail-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-detail-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="scenario-detail-modal-header">
              <div>
                <span>SCENARIO PREVIEW</span>
                <h2 id="scenario-detail-modal-title">{selectedScenario.title}</h2>
                <p>선택한 조건이 이어졌을 때 KOSPI가 어떻게 움직일지, 근거와 이벤트를 한 화면에서 확인하세요.</p>
              </div>
              <button className="scenario-modal-close" type="button" onClick={() => setScenarioDetailOpen(false)} aria-label="시나리오 상세 닫기"><X size={20} /></button>
            </header>

            <div className="scenario-detail-modal-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selectedScenario.image} alt={`${selectedScenario.title} 시나리오를 설명하는 시장 일러스트`} />
              <span>CONDITIONAL MARKET PATH</span>
            </div>

            <div className="scenario-detail-modal-summary">
              <div className={`scenario-detail-modal-forecast ${selectedScenario.tone}`}>
                <small>{selectedScenario.duration} 예상</small>
                <strong>{selectedScenario.forecast}</strong>
              </div>
              <div className="scenario-detail-modal-tags">
                <span>핵심 조건</span>
                {selectedScenario.tags.map((tag) => <em key={tag}>{tag}</em>)}
              </div>
            </div>

            <div className="scenario-detail-modal-grid">
              <article className="scenario-detail-modal-story">
                <div className="scenario-detail-modal-label">시나리오 전제</div>
                <p>{selectedScenario.summary}</p>
                <div className="scenario-modal-note"><Sparkles size={16} /><span>전제와 실제 시장 흐름이 달라지면 전망값도 함께 달라질 수 있습니다.</span></div>
              </article>

              <section className="scenario-detail-modal-events" aria-label="시나리오 예상 이벤트">
                <div className="scenario-detail-modal-label">예상 전개 이벤트</div>
                <div className="scenario-detail-modal-event-list">
                  {selectedScenario.events.map((event, index) => (
                    <article key={`modal-${selectedScenario.id}-${event.title}`} className="scenario-detail-modal-event">
                      <div className="scenario-detail-modal-event-index">0{index + 1}</div>
                      <div>
                        <div className="scenario-detail-modal-event-meta"><span>{event.week}</span><em>{event.category}</em></div>
                        <h3>{event.title}</h3>
                        <p>{event.body}</p>
                      </div>
                      <strong className={event.impact.startsWith("+") ? "up" : "down"}>{event.impact}</strong>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <section className="scenario-detail-modal-intelligence" aria-label="멀티 에이전트 해석">
              <div className="scenario-detail-modal-label">멀티 에이전트 해석</div>
              <div className="scenario-agent-grid">
                {selectedScenario.agentInsights.map((insight) => (
                  <article key={`${selectedScenario.id}-${insight.role}`} className="scenario-agent-card">
                    <span>{insight.role}</span>
                    <h3>{insight.title}</h3>
                    <p>{insight.body}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="scenario-detail-modal-risks" aria-label="핵심 리스크">
              <div className="scenario-detail-modal-label">이 시나리오가 빗나갈 수 있는 지점</div>
              <div className="scenario-risk-list">
                {selectedScenario.riskPoints.map((risk) => <span key={risk}>{risk}</span>)}
              </div>
            </section>
          </section>
        </div>
      )}
    </div>
  );
}
