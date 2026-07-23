"use client";

import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  Gauge,
  Landmark,
  LineChart,
  LockKeyhole,
  LocateFixed,
  Minus,
  Network,
  Newspaper,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

type MainTab = "insight" | "graph" | "twin";
type SearchMode = "market" | "stock";
type EntityId = "kospi" | "kosdaq" | "samsung" | "skhynix";

const entities: Record<
  EntityId,
  {
    mode: SearchMode;
    name: string;
    code: string;
    value: number;
    valueLabel: string;
    delta: string;
    summary: string;
    regime: string;
    confidence: number;
    range: string;
  }
> = {
  kospi: {
    mode: "market",
    name: "KOSPI",
    code: "국내 대표지수",
    value: 3248.6,
    valueLabel: "3,248.60",
    delta: "+1.84%",
    summary: "반도체가 상승을 이끌고 있지만, 지수 내부의 쏠림과 환율 부담이 함께 커지는 변곡 구간입니다.",
    regime: "상승 · 변동성 확대",
    confidence: 78,
    range: "3,120 – 3,390",
  },
  kosdaq: {
    mode: "market",
    name: "KOSDAQ",
    code: "국내 성장주 지수",
    value: 842.31,
    valueLabel: "842.31",
    delta: "+0.62%",
    summary: "바이오와 2차전지의 반등이 나타났지만 거래대금 회복이 약해 방향성보다 종목별 차별화가 큰 구간입니다.",
    regime: "중립 · 종목 장세",
    confidence: 71,
    range: "795 – 878",
  },
  samsung: {
    mode: "stock",
    name: "삼성전자",
    code: "005930 · KOSPI",
    value: 92400,
    valueLabel: "92,400원",
    delta: "+2.21%",
    summary: "HBM 공급 확대 기대가 주가를 지지하지만, 실적 발표 전 기대 수준이 빠르게 높아진 상태입니다.",
    regime: "상승 · 실적 확인 대기",
    confidence: 74,
    range: "88,000 – 99,000원",
  },
  skhynix: {
    mode: "stock",
    name: "SK하이닉스",
    code: "000660 · KOSPI",
    value: 341500,
    valueLabel: "341,500원",
    delta: "+3.08%",
    summary: "AI 메모리 수요가 강한 추세를 만들었지만 높은 밸류에이션과 외국인 수급 변화에 민감한 구간입니다.",
    regime: "강세 · 과열 주의",
    confidence: 72,
    range: "318,000 – 371,000원",
  },
};

const predictionDrivers = [
  { rank: "01", label: "반도체 실적 기대", detail: "HBM 수요와 가이던스 상향", contribution: "+1.8%p", width: "82%", tone: "positive" },
  { rank: "02", label: "외국인 순매수", detail: "대형주 중심 수급 유입", contribution: "+0.9%p", width: "58%", tone: "positive" },
  { rank: "03", label: "원·달러 환율", detail: "1,380원대 재진입 부담", contribution: "-0.7%p", width: "43%", tone: "negative" },
];

const driverNews = [
  [
    { source: "산업", time: "34분 전", title: "HBM 수요 전망 상향, 반도체 실적 눈높이도 상승" },
    { source: "시장", time: "2시간 전", title: "반도체 대형주가 KOSPI 상승분의 절반 이상 기여" },
  ],
  [
    { source: "수급", time: "1시간 전", title: "외국인 반도체 순매수 지속, 대형주 중심 자금 유입" },
    { source: "증권", time: "4시간 전", title: "기관 매도에도 외국인 매수세가 지수 하단을 지지" },
  ],
  [
    { source: "환율", time: "48분 전", title: "원·달러 1,380원대 재진입, 외국인 수급에 부담" },
    { source: "글로벌", time: "3시간 전", title: "미 국채금리 반등과 달러 강세가 성장주 변동성 확대" },
  ],
];

const kospiCandleData = [
  { date: "03.06", open: 3042.0, high: 3068.4, low: 2998.1, close: 3028.5, volume: 318200000 },
  { date: "03.13", open: 3026.8, high: 3081.2, low: 3010.4, close: 3062.3, volume: 302450000 },
  { date: "03.20", open: 3060.5, high: 3114.8, low: 3048.9, close: 3098.6, volume: 329810000 },
  { date: "03.27", open: 3097.4, high: 3141.7, low: 3080.2, close: 3128.4, volume: 341600000 },
  { date: "04.03", open: 3126.9, high: 3179.3, low: 3102.6, close: 3164.2, volume: 356740000 },
  { date: "04.10", open: 3162.8, high: 3206.5, low: 3140.3, close: 3192.7, volume: 369200000 },
  { date: "04.17", open: 3190.5, high: 3244.9, low: 3171.4, close: 3228.1, volume: 382440000 },
  { date: "04.24", open: 3226.3, high: 3278.6, low: 3207.8, close: 3261.5, volume: 396530000 },
  { date: "05.01", open: 3258.4, high: 3318.2, low: 3239.7, close: 3306.8, volume: 418920000 },
  { date: "05.08", open: 3308.1, high: 3340.6, low: 3272.8, close: 3289.4, volume: 401120000 },
  { date: "05.15", open: 3287.5, high: 3365.9, low: 3270.1, close: 3341.7, volume: 436750000 },
  { date: "05.22", open: 3344.2, high: 3389.4, low: 3318.6, close: 3368.5, volume: 448620000 },
  { date: "05.29", open: 3370.1, high: 3402.8, low: 3332.4, close: 3346.3, volume: 429780000 },
  { date: "06.05", open: 3344.8, high: 3381.6, low: 3305.7, close: 3322.1, volume: 407330000 },
  { date: "06.12", open: 3320.6, high: 3356.4, low: 3289.8, close: 3302.5, volume: 389410000 },
  { date: "06.19", open: 3300.3, high: 3337.2, low: 3268.9, close: 3281.4, volume: 374220000 },
  { date: "06.26", open: 3278.5, high: 3322.8, low: 3251.6, close: 3298.7, volume: 392170000 },
  { date: "07.03", open: 3296.1, high: 3317.5, low: 3240.2, close: 3264.3, volume: 405860000 },
  { date: "07.07", open: 3262.4, high: 3290.7, low: 3211.5, close: 3228.8, volume: 417250000 },
  { date: "07.10", open: 3225.7, high: 3256.9, low: 3180.4, close: 3190.0, volume: 431940000 },
  { date: "07.17", open: 3195.4, high: 3266.8, low: 3178.2, close: 3248.6, volume: 424280000 },
];

type GraphFilter = "all" | "industry" | "flow" | "macro";
type GraphEntityType = "stock" | "event" | "macro" | "regulation" | "sector";

type MarketGraphNode = {
  id: string;
  name: string;
  ticker: string;
  sector: string;
  x: number;
  y: number;
  size: number;
  change: number;
  value: string;
  kind?: "event";
  entityType?: GraphEntityType;
  summary: string;
  reasons: string[];
  news: { source: string; title: string; time: string }[];
};

type MarketGraphLink = {
  id: string;
  source: string;
  target: string;
  category: Exclude<GraphFilter, "all">;
  strength: number;
  change: number;
  label: string;
  description: string;
  dashed?: boolean;
};

const coreMarketGraphNodes: MarketGraphNode[] = [
  {
    id: "samsung",
    name: "삼성전자",
    ticker: "005930",
    sector: "반도체",
    x: 480,
    y: 310,
    size: 76,
    change: 2.21,
    value: "92,400원",
    summary: "반도체 수요뿐 아니라 AI 투자, 환율, 자동차 전장 수요와 함께 움직이는 시장의 중심 종목입니다.",
    reasons: ["HBM 공급 확대와 메모리 가격 회복", "외국인 대형주 순매수 집중", "원·달러 환율 상승에 따른 수출 환산 효과"],
    news: [
      { source: "산업", title: "HBM 수요 전망 상향, 메모리 실적 눈높이도 상승", time: "34분 전" },
      { source: "수급", title: "외국인 대형 반도체 순매수 사흘째 이어져", time: "1시간 전" },
      { source: "시장", title: "반도체가 KOSPI 상승분의 절반 이상 기여", time: "2시간 전" },
    ],
  },
  {
    id: "skhynix",
    name: "SK하이닉스",
    ticker: "000660",
    sector: "반도체",
    x: 660,
    y: 185,
    size: 68,
    change: 3.08,
    value: "341,500원",
    summary: "AI 메모리 수요의 직접 수혜 종목으로 삼성전자와 업황·수급 연결이 가장 강합니다.",
    reasons: ["AI 가속기용 HBM 출하 증가", "메모리 공급사의 가격 협상력 회복", "미국 기술주와 높은 동조성"],
    news: [
      { source: "반도체", title: "차세대 HBM 공급 일정 앞당겨질 가능성", time: "22분 전" },
      { source: "글로벌", title: "AI 데이터센터 투자 계획 연이어 상향", time: "1시간 전" },
      { source: "증권", title: "메모리 가격 반등 구간 진입 분석", time: "3시간 전" },
    ],
  },
  {
    id: "hanmi",
    name: "한미반도체",
    ticker: "042700",
    sector: "장비",
    x: 770,
    y: 315,
    size: 52,
    change: 4.12,
    value: "172,800원",
    summary: "HBM용 장비 투자 일정이 실적을 좌우해 메모리 업체의 증설 뉴스에 빠르게 반응합니다.",
    reasons: ["HBM 생산능력 증설 기대", "TC 본더 수주 가시성", "반도체 장비주 수급 확산"],
    news: [
      { source: "장비", title: "HBM 증설 경쟁에 후공정 장비 수요 확대", time: "18분 전" },
      { source: "기업", title: "신규 장비 수주 기대감에 거래대금 증가", time: "2시간 전" },
      { source: "시장", title: "반도체 상승세가 장비주로 확산", time: "4시간 전" },
    ],
  },
  {
    id: "naver",
    name: "NAVER",
    ticker: "035420",
    sector: "플랫폼",
    x: 690,
    y: 475,
    size: 56,
    change: 1.36,
    value: "248,000원",
    summary: "AI 서비스 투자와 데이터센터 비용이 동시에 반영되어 반도체 공급망과 새롭게 연결되는 종목입니다.",
    reasons: ["생성형 AI 서비스 투자 확대", "데이터센터 인프라 수요 증가", "성장주 할인율 하락 기대"],
    news: [
      { source: "플랫폼", title: "국내 AI 서비스 투자 계획 구체화", time: "41분 전" },
      { source: "산업", title: "데이터센터용 반도체 수요 장기화 전망", time: "2시간 전" },
      { source: "금리", title: "성장주 할인율 부담 일부 완화", time: "5시간 전" },
    ],
  },
  {
    id: "hyundai",
    name: "현대차",
    ticker: "005380",
    sector: "자동차",
    x: 292,
    y: 470,
    size: 58,
    change: -0.74,
    value: "286,500원",
    summary: "환율과 수출 실적, 차량용 반도체 수급을 통해 IT 대형주와 간접적으로 연결됩니다.",
    reasons: ["원화 약세의 수출 채산성 효과", "미국 판매 인센티브 변화", "차량용 반도체 공급 안정"],
    news: [
      { source: "자동차", title: "북미 판매 증가에도 인센티브 비용 주시", time: "50분 전" },
      { source: "환율", title: "원화 약세가 수출주 실적 방어", time: "2시간 전" },
      { source: "부품", title: "차량용 반도체 공급 정상화 지속", time: "6시간 전" },
    ],
  },
  {
    id: "lgenergy",
    name: "LG에너지솔루션",
    ticker: "373220",
    sector: "2차전지",
    x: 120,
    y: 365,
    size: 60,
    change: -1.18,
    value: "376,000원",
    summary: "전기차 수요와 원자재 가격, 원·달러 환율이 함께 작동하는 대표적인 교차 섹터 종목입니다.",
    reasons: ["전기차 재고 조정 장기화", "리튬 가격 안정 여부", "북미 생산 보조금 효과"],
    news: [
      { source: "배터리", title: "북미 전기차 재고 조정 속도에 관심", time: "27분 전" },
      { source: "원자재", title: "리튬 가격 하단 확인 기대", time: "3시간 전" },
      { source: "정책", title: "미국 생산세액공제 효과 재평가", time: "7시간 전" },
    ],
  },
  {
    id: "kb",
    name: "KB금융",
    ticker: "105560",
    sector: "금융",
    x: 235,
    y: 215,
    size: 48,
    change: 0.82,
    value: "91,600원",
    summary: "금리 기대와 외국인 수급을 통해 성장주·수출주와 반대 또는 보완 관계를 만듭니다.",
    reasons: ["시장금리 변화에 따른 이자이익 기대", "밸류업 수급 유입", "성장주와의 순환매 관계"],
    news: [
      { source: "금융", title: "은행주 주주환원 기대 재부각", time: "1시간 전" },
      { source: "금리", title: "장기금리 반등에 순이자마진 기대", time: "3시간 전" },
      { source: "수급", title: "외국인 금융주 순매수 확대", time: "5시간 전" },
    ],
  },
  {
    id: "hanwha",
    name: "한화에어로스페이스",
    ticker: "012450",
    sector: "방산",
    x: 405,
    y: 105,
    size: 54,
    change: 2.64,
    value: "782,000원",
    summary: "수출 계약과 지정학 이벤트가 중심이며, 환율과 대형 수출주 수급을 공유합니다.",
    reasons: ["해외 수주 잔고 증가", "유럽 방산 예산 확대", "수출주로 유입되는 외국인 자금"],
    news: [
      { source: "방산", title: "유럽 방산 예산 확대 논의 가속", time: "16분 전" },
      { source: "수주", title: "장기 공급 계약 기대감 유지", time: "2시간 전" },
      { source: "환율", title: "원화 약세가 수출 채산성에 우호적", time: "4시간 전" },
    ],
  },
  {
    id: "ai-event",
    name: "AI 데이터센터 투자",
    ticker: "MARKET EVENT",
    sector: "산업 이벤트",
    x: 885,
    y: 115,
    size: 62,
    change: 0,
    value: "영향 확산 중",
    kind: "event",
    entityType: "event",
    summary: "반도체에서 플랫폼·전력 인프라까지 연결되는 오늘의 핵심 시장 이벤트입니다.",
    reasons: ["글로벌 빅테크 설비투자 상향", "AI 가속기와 HBM 동반 수요", "데이터센터 전력·냉각 투자 확대"],
    news: [
      { source: "글로벌", title: "빅테크, AI 인프라 투자 계획 잇달아 상향", time: "12분 전" },
      { source: "산업", title: "데이터센터 투자가 반도체·전력주로 확산", time: "1시간 전" },
      { source: "전망", title: "AI 인프라 지출 성장세 내년까지 지속", time: "4시간 전" },
    ],
  },
  {
    id: "fx-event",
    name: "원·달러 1,380원",
    ticker: "MACRO EVENT",
    sector: "거시 이벤트",
    x: 105,
    y: 115,
    size: 58,
    change: 0,
    value: "전일 대비 +6.2원",
    kind: "event",
    entityType: "macro",
    summary: "외국인 수급과 수출기업 실적을 동시에 흔드는 공통 변수입니다.",
    reasons: ["미국 금리 인하 기대 후퇴", "달러 강세 재개", "외국인 환차손 부담 증가"],
    news: [
      { source: "외환", title: "원·달러 환율 장중 1,380원 재진입", time: "8분 전" },
      { source: "채권", title: "미 국채금리 반등에 달러 강세", time: "1시간 전" },
      { source: "수급", title: "환율 상승 구간 외국인 매매 변화 주시", time: "3시간 전" },
    ],
  },
  {
    id: "rate-event",
    name: "기준금리 경로",
    ticker: "MACRO EVENT",
    sector: "거시 이벤트",
    x: 205,
    y: 45,
    size: 54,
    change: 0,
    value: "동결 우세",
    kind: "event",
    entityType: "macro",
    summary: "할인율과 자금 이동을 통해 금융주·성장주·바이오의 상대 강도를 바꾸는 공통 변수입니다.",
    reasons: ["물가 둔화 속도 정체", "미국 금리 인하 기대 후퇴", "국내 가계대출 증가 부담"],
    news: [
      { source: "금리", title: "시장, 연내 인하 횟수 전망 다시 낮춰", time: "25분 전" },
      { source: "채권", title: "장기금리 반등에 성장주 할인율 부담", time: "2시간 전" },
    ],
  },
  {
    id: "hyundai-rotem",
    name: "현대로템",
    ticker: "064350",
    sector: "방산",
    x: 320,
    y: 50,
    size: 42,
    change: 3.42,
    value: "196,200원",
    summary: "철도와 방산 수주 기대가 겹치며 한화에어로스페이스와 수급 동조성이 커진 종목입니다.",
    reasons: ["유럽 방산 수출 기대", "장기 철도 수주 잔고", "대형 방산주 순환매"],
    news: [
      { source: "방산", title: "유럽 지상무기 수요 확대 전망", time: "31분 전" },
      { source: "수급", title: "방산 대형주로 기관 매수 확산", time: "3시간 전" },
    ],
  },
  {
    id: "shinhan",
    name: "신한지주",
    ticker: "055550",
    sector: "금융",
    x: 155,
    y: 245,
    size: 41,
    change: 0.48,
    value: "64,800원",
    summary: "금리와 밸류업 정책 기대를 KB금융과 공유하며 금융 섹터의 방향을 보여줍니다.",
    reasons: ["순이자마진 방어 기대", "자사주 소각 확대", "외국인 금융주 순매수"],
    news: [
      { source: "금융", title: "금융지주 주주환원 계획 재평가", time: "46분 전" },
      { source: "수급", title: "외국인 은행주 순매수 지속", time: "4시간 전" },
    ],
  },
  {
    id: "kia",
    name: "기아",
    ticker: "000270",
    sector: "자동차",
    x: 205,
    y: 535,
    size: 49,
    change: -0.32,
    value: "138,900원",
    summary: "현대차와 판매 지역·환율·부품 공급망을 공유하는 가장 직접적인 연결 종목입니다.",
    reasons: ["북미 판매 믹스 개선", "원화 약세 수출 효과", "전기차 인센티브 비용"],
    news: [
      { source: "자동차", title: "북미 판매 호조에도 판촉비 부담 주시", time: "38분 전" },
      { source: "환율", title: "원화 약세가 자동차 이익 방어", time: "3시간 전" },
    ],
  },
  {
    id: "mobis",
    name: "현대모비스",
    ticker: "012330",
    sector: "자동차부품",
    x: 345,
    y: 565,
    size: 42,
    change: 0.91,
    value: "312,000원",
    summary: "완성차 생산과 전장 부품 수요를 연결하며 자동차와 반도체 사이의 가교 역할을 합니다.",
    reasons: ["전장 부품 매출 비중 증가", "현대차·기아 생산량 회복", "부품 원가 안정"],
    news: [
      { source: "부품", title: "전장 부품 수주잔고 증가세 유지", time: "1시간 전" },
      { source: "산업", title: "차량용 반도체 공급 안정화", time: "5시간 전" },
    ],
  },
  {
    id: "samsungsdi",
    name: "삼성SDI",
    ticker: "006400",
    sector: "2차전지",
    x: 55,
    y: 475,
    size: 47,
    change: -1.64,
    value: "238,500원",
    summary: "전기차 수요와 배터리 업황을 LG에너지솔루션과 공유하지만 고객·기술 구성이 다릅니다.",
    reasons: ["프리미엄 전기차 수요 둔화", "차세대 배터리 투자", "유럽 고객사 재고 조정"],
    news: [
      { source: "배터리", title: "유럽 전기차 수요 회복 시점 지연", time: "29분 전" },
      { source: "기술", title: "전고체 배터리 투자 일정 유지", time: "4시간 전" },
    ],
  },
  {
    id: "poscofuture",
    name: "포스코퓨처엠",
    ticker: "003670",
    sector: "2차전지 소재",
    x: 75,
    y: 580,
    size: 40,
    change: -2.08,
    value: "154,600원",
    summary: "배터리 생산량과 광물 가격 변화가 동시에 반영되는 소재 공급망 핵심 종목입니다.",
    reasons: ["양극재 가동률 부담", "리튬 가격 하향 안정", "북미 공급망 현지화"],
    news: [
      { source: "소재", title: "양극재 출하 회복 속도에 관심", time: "53분 전" },
      { source: "원자재", title: "리튬 가격 바닥 확인 기대", time: "5시간 전" },
    ],
  },
  {
    id: "dbhitek",
    name: "DB하이텍",
    ticker: "000990",
    sector: "파운드리",
    x: 555,
    y: 75,
    size: 40,
    change: 1.17,
    value: "83,200원",
    summary: "메모리와 다른 사이클을 가지지만 반도체 섹터 수급과 환율의 영향을 함께 받습니다.",
    reasons: ["8인치 파운드리 가동률 회복", "전력반도체 수요 증가", "반도체 섹터 수급 확산"],
    news: [
      { source: "반도체", title: "8인치 파운드리 주문 회복 조짐", time: "44분 전" },
      { source: "산업", title: "전력반도체 장기 수요 확대 전망", time: "3시간 전" },
    ],
  },
  {
    id: "hpsp",
    name: "HPSP",
    ticker: "403870",
    sector: "반도체 장비",
    x: 805,
    y: 215,
    size: 39,
    change: 2.75,
    value: "42,950원",
    summary: "선단 공정 투자와 고객사 가동률에 민감해 반도체 증설 기대를 빠르게 반영합니다.",
    reasons: ["고압 수소 어닐링 수요", "선단 공정 투자 확대", "장비주 수급 개선"],
    news: [
      { source: "장비", title: "선단 공정 투자 재개 기대 확산", time: "35분 전" },
      { source: "수급", title: "반도체 장비주 거래대금 증가", time: "2시간 전" },
    ],
  },
  {
    id: "isc",
    name: "ISC",
    ticker: "095340",
    sector: "반도체 부품",
    x: 900,
    y: 300,
    size: 38,
    change: 1.92,
    value: "78,400원",
    summary: "AI 반도체 테스트 수요를 통해 메모리·비메모리 업황을 동시에 연결합니다.",
    reasons: ["AI 칩 테스트 소켓 수요", "고부가 제품 믹스 개선", "글로벌 고객사 확대"],
    news: [
      { source: "부품", title: "AI 칩 테스트 수요 확대 전망", time: "21분 전" },
      { source: "기업", title: "고부가 소켓 매출 비중 상승", time: "3시간 전" },
    ],
  },
  {
    id: "kakao",
    name: "카카오",
    ticker: "035720",
    sector: "플랫폼",
    x: 810,
    y: 520,
    size: 45,
    change: -0.86,
    value: "68,700원",
    summary: "AI 투자와 광고 경기, 성장주 할인율을 NAVER와 공유하는 플랫폼 동조 종목입니다.",
    reasons: ["AI 서비스 비용 증가", "광고 경기 회복 속도", "금리 변화에 따른 할인율"],
    news: [
      { source: "플랫폼", title: "AI 서비스 투자 확대 계획 발표", time: "40분 전" },
      { source: "광고", title: "디지털 광고 회복 속도는 완만", time: "4시간 전" },
    ],
  },
  {
    id: "doosan",
    name: "두산에너빌리티",
    ticker: "034020",
    sector: "전력 인프라",
    x: 515,
    y: 505,
    size: 51,
    change: 2.18,
    value: "78,100원",
    summary: "AI 데이터센터의 전력 수요가 원전·가스터빈 투자 기대와 연결되는 대표 종목입니다.",
    reasons: ["데이터센터 전력 수요 급증", "원전 수주 기대", "가스터빈 서비스 매출 확대"],
    news: [
      { source: "전력", title: "AI 데이터센터 전력 확보 경쟁 심화", time: "17분 전" },
      { source: "원전", title: "해외 원전 수주 기대감 유지", time: "2시간 전" },
    ],
  },
  {
    id: "hdelectric",
    name: "HD현대일렉트릭",
    ticker: "267260",
    sector: "전력기기",
    x: 450,
    y: 585,
    size: 44,
    change: 3.06,
    value: "588,000원",
    summary: "북미 전력망 투자와 데이터센터 증설로 AI 인프라의 후방 수혜를 받습니다.",
    reasons: ["북미 변압기 공급 부족", "데이터센터 전력망 투자", "높은 수주잔고"],
    news: [
      { source: "전력기기", title: "북미 변압기 공급 부족 장기화", time: "14분 전" },
      { source: "수주", title: "전력망 교체 수주잔고 사상 최대", time: "3시간 전" },
    ],
  },
  {
    id: "lselectric",
    name: "LS ELECTRIC",
    ticker: "010120",
    sector: "전력기기",
    x: 595,
    y: 580,
    size: 40,
    change: 2.33,
    value: "302,500원",
    summary: "배전·자동화 설비를 통해 데이터센터와 국내 공장 증설 투자를 연결합니다.",
    reasons: ["데이터센터 배전 설비 수요", "북미 생산능력 확대", "스마트팩토리 투자"],
    news: [
      { source: "전력", title: "데이터센터 배전 솔루션 수요 증가", time: "26분 전" },
      { source: "산업", title: "북미 전력기기 설비 투자 확대", time: "4시간 전" },
    ],
  },
  {
    id: "celltrion",
    name: "셀트리온",
    ticker: "068270",
    sector: "바이오",
    x: 915,
    y: 430,
    size: 46,
    change: 1.04,
    value: "214,000원",
    summary: "금리와 달러, 수출 실적 기대가 동시에 작동하는 바이오 대표 종목입니다.",
    reasons: ["미국 신제품 처방 확대", "달러 매출 환산 효과", "성장주 할인율 완화"],
    news: [
      { source: "바이오", title: "미국 신제품 처방 지표 개선", time: "37분 전" },
      { source: "환율", title: "달러 강세가 수출 매출에 우호적", time: "5시간 전" },
    ],
  },
  {
    id: "samsungbio",
    name: "삼성바이오로직스",
    ticker: "207940",
    sector: "바이오",
    x: 910,
    y: 575,
    size: 45,
    change: 0.62,
    value: "1,248,000원",
    summary: "글로벌 제약사 수주와 환율을 통해 셀트리온과 다른 형태의 바이오 수출 연결을 만듭니다.",
    reasons: ["대형 위탁생산 수주", "공장 가동률 상승", "달러 매출 비중"],
    news: [
      { source: "바이오", title: "글로벌 위탁생산 수주 기대 지속", time: "49분 전" },
      { source: "기업", title: "신규 공장 가동 준비 순항", time: "6시간 전" },
    ],
  },
  {
    id: "ai-export-rule",
    name: "AI 반도체 수출 규제",
    ticker: "REGULATION",
    sector: "통상·기술 규제",
    x: 960,
    y: 62,
    size: 50,
    change: 0,
    value: "강화 검토",
    entityType: "regulation",
    summary: "첨단 AI 반도체와 장비의 국가별 수출 범위를 제한해 국내 공급망의 고객·매출 구성을 바꿀 수 있습니다.",
    reasons: ["첨단 가속기 국가별 수출 한도", "HBM 최종사용자 확인 강화", "장비 공급망 재편 가능성"],
    news: [
      { source: "규제", title: "미국, AI 반도체 수출 통제 범위 재검토", time: "19분 전" },
      { source: "통상", title: "국내 메모리 업체 영향 제한적이라는 분석", time: "2시간 전" },
    ],
  },
  {
    id: "valueup-policy",
    name: "기업 밸류업 정책",
    ticker: "POLICY",
    sector: "자본시장 정책",
    x: 45,
    y: 225,
    size: 47,
    change: 0,
    value: "시행 중",
    entityType: "regulation",
    summary: "자본효율성과 주주환원 확대를 유도해 저평가 금융·지주 종목의 가치평가 기준을 바꾸는 정책입니다.",
    reasons: ["자사주 소각 확대", "ROE·PBR 개선 목표 공시", "기관 장기자금 유입 기대"],
    news: [
      { source: "정책", title: "밸류업 공시 참여 기업 증가", time: "32분 전" },
      { source: "금융", title: "금융지주 주주환원 기대 재부각", time: "3시간 전" },
    ],
  },
  {
    id: "lithium-price",
    name: "리튬 가격",
    ticker: "COMMODITY",
    sector: "원자재",
    x: 18,
    y: 590,
    size: 44,
    change: 0,
    value: "9,850달러/t",
    entityType: "macro",
    summary: "배터리 원가와 재고평가에 직접 반영되어 셀·소재 기업의 수익성 기대를 동시에 움직입니다.",
    reasons: ["중국 공급 과잉 지속", "전기차 수요 회복 지연", "광산 감산 가능성"],
    news: [
      { source: "원자재", title: "리튬 가격 하단 확인 기대 확산", time: "24분 전" },
      { source: "배터리", title: "재고평가손실 부담은 점차 완화", time: "4시간 전" },
    ],
  },
];

type SupplementalGraphNodeInput = Omit<MarketGraphNode, "reasons" | "news"> & {
  reasons: string[];
  headline: string;
};

const makeSupplementalGraphNode = ({
  headline,
  reasons,
  ...node
}: SupplementalGraphNodeInput): MarketGraphNode => ({
  ...node,
  reasons,
  news: [
    { source: node.sector, title: headline, time: "1시간 전" },
    { source: "시장 연결", title: `${node.name}과 연관된 시장 변수의 연결 강도 변화`, time: "4시간 전" },
  ],
});

const supplementalMarketGraphNodes: MarketGraphNode[] = [
  makeSupplementalGraphNode({
    id: "samsung-electro", name: "삼성전기", ticker: "009150", sector: "전자부품",
    x: 735, y: 270, size: 43, change: 1.42, value: "188,600원",
    summary: "AI 서버와 스마트폰에 들어가는 적층세라믹콘덴서와 기판을 공급해 반도체·플랫폼·자동차를 연결합니다.",
    reasons: ["AI 서버용 기판 수요", "스마트폰 부품 업황", "전장용 MLCC 성장"],
    headline: "AI 서버용 고부가 기판 수요가 전자부품 업황 견인",
  }),
  makeSupplementalGraphNode({
    id: "lgchem", name: "LG화학", ticker: "051910", sector: "화학·배터리소재",
    x: 92, y: 410, size: 44, change: -0.58, value: "326,000원",
    summary: "석유화학 경기와 배터리 소재 수요를 함께 반영해 중국 수요와 전기차 정책 사이를 연결합니다.",
    reasons: ["양극재 출하 회복", "중국 화학제품 수요", "원재료 가격 안정"],
    headline: "양극재 출하 회복과 석유화학 스프레드 변화 주목",
  }),
  makeSupplementalGraphNode({
    id: "posco-holdings", name: "POSCO홀딩스", ticker: "005490", sector: "철강·소재",
    x: 120, y: 540, size: 47, change: -0.92, value: "286,500원",
    summary: "철강 가격과 중국 경기, 리튬 사업을 통해 산업재와 배터리 소재를 동시에 잇는 종목입니다.",
    reasons: ["중국 철강 수요", "리튬 사업 가치", "원·달러 환율"],
    headline: "중국 철강 수요와 리튬 사업 가치가 동시에 재평가",
  }),
  makeSupplementalGraphNode({
    id: "kepco", name: "한국전력", ticker: "015760", sector: "전력",
    x: 415, y: 545, size: 43, change: 0.74, value: "31,450원",
    summary: "전력요금과 연료비, 데이터센터 전력 수요를 발전·송배전 기업과 연결하는 중심 노드입니다.",
    reasons: ["전력 판매단가", "연료비 조정", "데이터센터 전력 수요"],
    headline: "AI 데이터센터 확대로 전력 수요 장기 전망 상향",
  }),
  makeSupplementalGraphNode({
    id: "skinno", name: "SK이노베이션", ticker: "096770", sector: "에너지·배터리",
    x: 148, y: 470, size: 41, change: -1.06, value: "117,800원",
    summary: "정유 마진과 배터리 투자 부담이 함께 작동해 원유·환율·전기차 수요를 연결합니다.",
    reasons: ["정제마진 변화", "배터리 투자 속도", "북미 전기차 수요"],
    headline: "정제마진 반등에도 배터리 투자 속도는 선별적으로 조정",
  }),
  makeSupplementalGraphNode({
    id: "samsungcnt", name: "삼성물산", ticker: "028260", sector: "지주·건설",
    x: 390, y: 255, size: 40, change: 0.66, value: "182,400원",
    summary: "삼성그룹 지분가치와 밸류업 정책, 대형주 수급을 연결하는 지주회사 노드입니다.",
    reasons: ["보유 지분가치", "주주환원 정책", "건설 수주"],
    headline: "지주사 밸류업 기대와 보유 지분가치 재평가",
  }),
  makeSupplementalGraphNode({
    id: "kakaobank", name: "카카오뱅크", ticker: "323410", sector: "인터넷은행",
    x: 275, y: 285, size: 38, change: 0.31, value: "29,850원",
    summary: "금리와 대출 성장, 플랫폼 수급을 통해 금융과 인터넷 산업을 잇는 교차 종목입니다.",
    reasons: ["대출 성장률", "조달금리 안정", "플랫폼 고객 유입"],
    headline: "주택대출 성장과 조달비용 안정이 실적 기대 지지",
  }),
  makeSupplementalGraphNode({
    id: "alteogen", name: "알테오젠", ticker: "196170", sector: "바이오",
    x: 852, y: 430, size: 42, change: 2.48, value: "486,000원",
    summary: "기술수출과 성장주 할인율을 통해 대형 바이오 종목과 글로벌 제약 이벤트에 연결됩니다.",
    reasons: ["기술수출 마일스톤", "피하주사 제형 전환", "성장주 할인율"],
    headline: "글로벌 제약사 제형 전환 수요가 기술가치 기대 확대",
  }),
  makeSupplementalGraphNode({
    id: "hanwhaocean", name: "한화오션", ticker: "042660", sector: "조선·방산",
    x: 325, y: 78, size: 42, change: 2.06, value: "96,800원",
    summary: "상선 발주와 해양 방산 수요를 환율·방산 예산·조선 업황에 연결합니다.",
    reasons: ["LNG선 발주", "함정 수출 기대", "원화 약세"],
    headline: "상선 수주와 함정 수출 기대가 함께 부각",
  }),
  makeSupplementalGraphNode({
    id: "hdksoe", name: "HD한국조선해양", ticker: "009540", sector: "조선",
    x: 238, y: 112, size: 44, change: 1.73, value: "398,500원",
    summary: "글로벌 선박 발주와 환율을 통해 방산·철강·수출주 수급과 이어지는 조선 대표 종목입니다.",
    reasons: ["고선가 수주잔고", "LNG선 발주", "환율 환산 효과"],
    headline: "고선가 수주잔고가 조선 업종 실적 가시성 높여",
  }),
  makeSupplementalGraphNode({
    id: "hyosungheavy", name: "효성중공업", ticker: "298040", sector: "전력기기",
    x: 655, y: 545, size: 41, change: 2.82, value: "1,268,000원",
    summary: "초고압 변압기와 전력망 투자를 통해 AI 데이터센터·북미 인프라 수요에 연결됩니다.",
    reasons: ["북미 변압기 수요", "초고압 제품 믹스", "전력망 교체"],
    headline: "북미 초고압 변압기 공급 부족이 수주잔고 확대",
  }),
  makeSupplementalGraphNode({
    id: "sktelecom", name: "SK텔레콤", ticker: "017670", sector: "통신·AI",
    x: 748, y: 505, size: 40, change: 0.44, value: "68,400원",
    summary: "통신 현금흐름과 AI 데이터센터 투자를 통해 플랫폼과 전력 인프라를 잇습니다.",
    reasons: ["AI 데이터센터 투자", "통신 배당", "기업용 AI 수요"],
    headline: "AI 데이터센터와 기업용 AI 서비스 투자 확대",
  }),
  makeSupplementalGraphNode({
    id: "foreign-flow", name: "외국인 순매수", ticker: "FLOW", sector: "수급 이벤트",
    x: 405, y: 405, size: 49, change: 0, value: "+8,420억원",
    entityType: "event",
    summary: "대형주와 업종 간 자금 이동을 한 번에 보여주는 KOSPI 핵심 수급 변수입니다.",
    reasons: ["반도체 비중 확대", "수출주 선호", "환율 변동성"],
    headline: "외국인 순매수가 반도체와 대형 수출주에 집중",
  }),
  makeSupplementalGraphNode({
    id: "us-tech", name: "미국 기술주", ticker: "GLOBAL", sector: "글로벌 시장",
    x: 842, y: 58, size: 48, change: 0, value: "동조성 0.78",
    entityType: "macro",
    summary: "AI 투자와 위험선호를 통해 국내 반도체·플랫폼·성장주의 방향에 영향을 줍니다.",
    reasons: ["나스닥 위험선호", "빅테크 설비투자", "미 국채금리"],
    headline: "미국 빅테크 투자 계획이 국내 AI 밸류체인에 확산",
  }),
  makeSupplementalGraphNode({
    id: "china-demand", name: "중국 경기", ticker: "MACRO", sector: "글로벌 경기",
    x: 58, y: 315, size: 47, change: 0, value: "회복 지연",
    entityType: "macro",
    summary: "철강·화학·배터리·반도체의 수요 기대를 동시에 바꾸는 대표적인 대외 변수입니다.",
    reasons: ["제조업 지표", "부동산 경기", "소비 회복"],
    headline: "중국 제조업 회복 속도에 소재·산업재 민감도 확대",
  }),
  makeSupplementalGraphNode({
    id: "ev-policy", name: "전기차 보조금", ticker: "POLICY", sector: "산업 정책",
    x: 26, y: 432, size: 43, change: 0, value: "개편 논의",
    entityType: "regulation",
    summary: "지역별 전기차 수요와 배터리 공급망의 생산 위치를 바꾸는 정책 노드입니다.",
    reasons: ["북미 세액공제", "유럽 보조금 축소", "현지조달 요건"],
    headline: "주요국 전기차 보조금 개편이 배터리 공급망에 영향",
  }),
  makeSupplementalGraphNode({
    id: "defense-budget", name: "글로벌 방산 예산", ticker: "MARKET EVENT", sector: "지정학 이벤트",
    x: 255, y: 24, size: 46, change: 0, value: "확대 추세",
    entityType: "event",
    summary: "유럽과 중동의 국방비 확대를 국내 방산·조선 수출 기업과 연결합니다.",
    reasons: ["유럽 재무장", "탄약·지상체계 수요", "함정 수출"],
    headline: "유럽 국방비 확대가 국내 방산 수주 파이프라인 강화",
  }),
  makeSupplementalGraphNode({
    id: "grid-policy", name: "전력망 투자 정책", ticker: "POLICY", sector: "인프라 정책",
    x: 555, y: 603, size: 44, change: 0, value: "투자 확대",
    entityType: "regulation",
    summary: "노후 전력망 교체와 데이터센터 연결 투자를 전력기기·발전 기업으로 전달합니다.",
    reasons: ["송배전망 교체", "데이터센터 계통 연결", "북미 인프라 예산"],
    headline: "전력망 교체와 데이터센터 계통 투자 계획 확대",
  }),
  makeSupplementalGraphNode({
    id: "kospi-index", name: "KOSPI", ticker: "INDEX", sector: "시장 지수",
    x: 500, y: 210, size: 64, change: 1.84, value: "3,248.60",
    entityType: "sector",
    summary: "대형 종목과 외국인 수급, 글로벌 위험선호가 모이는 시장 전체의 기준 노드입니다.",
    reasons: ["반도체 지수 기여", "외국인 수급", "글로벌 위험선호"],
    headline: "반도체와 외국인 순매수가 KOSPI 상승을 주도",
  }),
  makeSupplementalGraphNode({
    id: "semiconductor-sector", name: "반도체 생태계", ticker: "SECTOR", sector: "섹터",
    x: 620, y: 300, size: 54, change: 2.36, value: "도미넌스 34.8%",
    entityType: "sector",
    summary: "메모리·장비·부품 종목과 AI 투자 이벤트를 묶어 보여주는 섹터 노드입니다.",
    reasons: ["HBM 수요", "장비 투자", "외국인 수급"],
    headline: "HBM 중심의 반도체 상승세가 장비와 부품으로 확산",
  }),
  makeSupplementalGraphNode({
    id: "export-sector", name: "수출 대형주", ticker: "SECTOR", sector: "섹터",
    x: 250, y: 385, size: 50, change: 1.12, value: "환율 민감도 높음",
    entityType: "sector",
    summary: "자동차·방산·조선·바이오를 환율과 외국인 수급으로 묶는 교차 섹터 노드입니다.",
    reasons: ["원화 약세", "글로벌 수주", "외국인 자금"],
    headline: "원화 약세와 수주 모멘텀이 수출 대형주 수급을 지지",
  }),
  makeSupplementalGraphNode({
    id: "growth-sector", name: "성장주", ticker: "SECTOR", sector: "섹터",
    x: 770, y: 390, size: 49, change: 0.94, value: "금리 민감도 높음",
    entityType: "sector",
    summary: "플랫폼·바이오·AI 종목을 금리와 기술주 위험선호로 연결하는 섹터 노드입니다.",
    reasons: ["할인율 변화", "AI 투자", "글로벌 기술주"],
    headline: "금리 안정과 AI 투자 기대가 성장주 위험선호를 회복",
  }),
];

const marketGraphNodes: MarketGraphNode[] = [
  ...coreMarketGraphNodes,
  ...supplementalMarketGraphNodes,
];

const denseGraphLinkSeeds: [string, string, Exclude<GraphFilter, "all">, number, string, boolean?][] = [
  ["samsung-electro", "samsung", "industry", 76, "전자부품 공급망"],
  ["samsung-electro", "skhynix", "industry", 58, "AI 기판 수요", true],
  ["samsung-electro", "hyundai", "industry", 51, "전장 부품", true],
  ["samsung-electro", "ai-event", "industry", 64, "AI 서버 부품"],
  ["lgchem", "lgenergy", "industry", 88, "배터리 밸류체인"],
  ["lgchem", "samsungsdi", "flow", 62, "배터리 소재 수급", true],
  ["lgchem", "lithium-price", "macro", 79, "원재료 가격"],
  ["lgchem", "skinno", "industry", 67, "화학·배터리 업황"],
  ["posco-holdings", "poscofuture", "industry", 91, "소재 공급망"],
  ["posco-holdings", "china-demand", "macro", 83, "중국 철강 수요"],
  ["posco-holdings", "fx-event", "macro", 57, "수출 환산 효과", true],
  ["posco-holdings", "lgchem", "flow", 48, "소재주 순환매", true],
  ["kepco", "doosan", "industry", 72, "발전 설비 투자"],
  ["kepco", "hdelectric", "industry", 78, "송배전 투자"],
  ["kepco", "lselectric", "industry", 74, "배전 자동화"],
  ["kepco", "grid-policy", "macro", 89, "전력망 정책"],
  ["kepco", "ai-event", "industry", 61, "데이터센터 전력", true],
  ["skinno", "lgenergy", "flow", 69, "배터리 업황"],
  ["skinno", "ev-policy", "macro", 75, "북미 보조금"],
  ["skinno", "lithium-price", "macro", 66, "원재료 원가"],
  ["samsungcnt", "valueup-policy", "macro", 84, "지주사 밸류업"],
  ["samsungcnt", "kb", "flow", 47, "저평가주 수급", true],
  ["samsungcnt", "samsung", "industry", 72, "그룹 지분가치"],
  ["kakaobank", "kakao", "industry", 77, "플랫폼 고객 기반"],
  ["kakaobank", "kb", "flow", 55, "금융 수급"],
  ["kakaobank", "rate-event", "macro", 71, "조달금리"],
  ["alteogen", "celltrion", "flow", 64, "바이오 수급"],
  ["alteogen", "samsungbio", "industry", 52, "글로벌 제약 수요", true],
  ["alteogen", "rate-event", "macro", 59, "성장주 할인율", true],
  ["hanwhaocean", "hanwha", "industry", 79, "방산 그룹 수주"],
  ["hanwhaocean", "hyundai-rotem", "flow", 61, "방산 수급"],
  ["hanwhaocean", "defense-budget", "macro", 86, "함정 수요"],
  ["hdksoe", "hanwhaocean", "industry", 92, "조선 업황"],
  ["hdksoe", "fx-event", "macro", 73, "수주 환산 효과"],
  ["hdksoe", "defense-budget", "industry", 58, "특수선 수요", true],
  ["hyosungheavy", "hdelectric", "industry", 90, "초고압 변압기"],
  ["hyosungheavy", "lselectric", "industry", 81, "전력기기 업황"],
  ["hyosungheavy", "ai-event", "industry", 72, "데이터센터 전력", true],
  ["hyosungheavy", "grid-policy", "macro", 85, "전력망 교체"],
  ["sktelecom", "naver", "industry", 56, "AI 서비스 인프라", true],
  ["sktelecom", "kakao", "flow", 43, "플랫폼 수급", true],
  ["sktelecom", "ai-event", "industry", 77, "AI 데이터센터"],
  ["foreign-flow", "samsung", "flow", 93, "대형주 순매수"],
  ["foreign-flow", "skhynix", "flow", 91, "반도체 순매수"],
  ["foreign-flow", "hyundai", "flow", 68, "수출주 수급"],
  ["foreign-flow", "kb", "flow", 63, "금융주 수급"],
  ["foreign-flow", "kospi-index", "flow", 95, "지수 수급"],
  ["us-tech", "skhynix", "flow", 87, "AI 기술주 동조"],
  ["us-tech", "naver", "flow", 70, "성장주 위험선호"],
  ["us-tech", "kakao", "flow", 57, "플랫폼 동조", true],
  ["us-tech", "ai-event", "industry", 94, "빅테크 설비투자"],
  ["us-tech", "rate-event", "macro", 76, "미 국채금리"],
  ["china-demand", "poscofuture", "macro", 69, "소재 수요"],
  ["china-demand", "lgchem", "macro", 82, "화학제품 수요"],
  ["china-demand", "lgenergy", "macro", 58, "전기차 수요", true],
  ["china-demand", "samsung", "macro", 46, "IT 수요", true],
  ["ev-policy", "lgenergy", "macro", 90, "생산 세액공제"],
  ["ev-policy", "samsungsdi", "macro", 81, "유럽 보조금"],
  ["ev-policy", "hyundai", "macro", 74, "전기차 판매"],
  ["ev-policy", "kia", "macro", 71, "친환경차 인센티브"],
  ["defense-budget", "hanwha", "industry", 94, "국방비 확대"],
  ["defense-budget", "hyundai-rotem", "industry", 88, "지상체계 수요"],
  ["defense-budget", "hanwhaocean", "industry", 84, "함정 수요"],
  ["grid-policy", "hdelectric", "macro", 92, "송전망 투자"],
  ["grid-policy", "lselectric", "macro", 86, "배전망 투자"],
  ["grid-policy", "doosan", "macro", 65, "발전원 투자", true],
  ["kospi-index", "samsung", "flow", 96, "지수 기여도"],
  ["kospi-index", "skhynix", "flow", 94, "지수 기여도"],
  ["kospi-index", "hyundai", "flow", 66, "대형주 비중"],
  ["kospi-index", "kb", "flow", 61, "금융 비중"],
  ["kospi-index", "valueup-policy", "macro", 57, "정책 프리미엄", true],
  ["kospi-index", "us-tech", "flow", 73, "글로벌 위험선호"],
  ["semiconductor-sector", "samsung", "industry", 98, "핵심 구성"],
  ["semiconductor-sector", "skhynix", "industry", 98, "핵심 구성"],
  ["semiconductor-sector", "hanmi", "industry", 84, "장비 밸류체인"],
  ["semiconductor-sector", "hpsp", "industry", 76, "공정 장비"],
  ["semiconductor-sector", "dbhitek", "industry", 65, "파운드리"],
  ["semiconductor-sector", "isc", "industry", 72, "테스트 부품"],
  ["semiconductor-sector", "samsung-electro", "industry", 60, "AI 기판", true],
  ["semiconductor-sector", "ai-event", "industry", 91, "AI 수요"],
  ["semiconductor-sector", "ai-export-rule", "macro", 78, "수출 규제"],
  ["semiconductor-sector", "kospi-index", "flow", 93, "지수 도미넌스"],
  ["export-sector", "hyundai", "industry", 90, "완성차 수출"],
  ["export-sector", "kia", "industry", 86, "완성차 수출"],
  ["export-sector", "hanwha", "industry", 74, "방산 수출"],
  ["export-sector", "hdksoe", "industry", 79, "조선 수출"],
  ["export-sector", "celltrion", "industry", 55, "바이오 수출", true],
  ["export-sector", "fx-event", "macro", 94, "환율 민감도"],
  ["export-sector", "foreign-flow", "flow", 82, "외국인 수급"],
  ["export-sector", "kospi-index", "flow", 71, "지수 기여"],
  ["growth-sector", "naver", "industry", 88, "플랫폼 성장주"],
  ["growth-sector", "kakao", "industry", 81, "플랫폼 성장주"],
  ["growth-sector", "celltrion", "industry", 62, "바이오 성장주"],
  ["growth-sector", "samsungbio", "industry", 58, "바이오 성장주"],
  ["growth-sector", "alteogen", "industry", 73, "기술수출 성장주"],
  ["growth-sector", "sktelecom", "industry", 49, "AI 서비스", true],
  ["growth-sector", "rate-event", "macro", 91, "할인율"],
  ["growth-sector", "us-tech", "flow", 83, "기술주 동조"],
  ["growth-sector", "ai-event", "industry", 89, "AI 투자"],
  ["growth-sector", "kospi-index", "flow", 68, "성장주 비중"],
];

const supplementalMarketGraphLinks: MarketGraphLink[] = denseGraphLinkSeeds.map(
  ([source, target, category, strength, label, dashed], index) => ({
    id: `dense-${index + 1}`,
    source,
    target,
    category,
    strength,
    change: Math.round((strength - 63) / 4),
    label,
    description: `${label}을 통해 두 엔터티의 시장 영향이 연결됩니다.`,
    dashed,
  }),
);

const coreMarketGraphLinks: MarketGraphLink[] = [
  { id: "samsung-sk", source: "samsung", target: "skhynix", category: "industry", strength: 92, change: 8, label: "메모리 업황", description: "HBM 수요와 메모리 가격이 두 종목의 실적 기대를 동시에 움직입니다." },
  { id: "sk-ai", source: "skhynix", target: "ai-event", category: "industry", strength: 89, change: 12, label: "AI 인프라 수요", description: "빅테크 설비투자가 AI 가속기용 HBM 주문으로 직접 이어집니다." },
  { id: "sk-hanmi", source: "skhynix", target: "hanmi", category: "industry", strength: 84, change: 10, label: "HBM 증설", description: "메모리 생산능력 확대가 후공정 장비 발주로 연결됩니다." },
  { id: "samsung-hanmi", source: "samsung", target: "hanmi", category: "industry", strength: 76, change: 6, label: "장비 투자", description: "HBM 생산 확대 계획이 장비 업체의 수주 기대를 높입니다.", dashed: true },
  { id: "ai-naver", source: "ai-event", target: "naver", category: "industry", strength: 68, change: 15, label: "AI 서비스 투자", description: "인프라 투자 확대가 국내 AI 서비스와 데이터센터 비용 구조에 영향을 줍니다.", dashed: true },
  { id: "samsung-naver", source: "samsung", target: "naver", category: "flow", strength: 54, change: 7, label: "대형 성장주 수급", description: "외국인 성장주 바스켓 안에서 두 종목의 수급 동조성이 커졌습니다.", dashed: true },
  { id: "fx-samsung", source: "fx-event", target: "samsung", category: "macro", strength: 63, change: -4, label: "환율 민감도", description: "원화 약세는 수출 환산이익에 우호적이지만 외국인 수급에는 부담입니다." },
  { id: "fx-hyundai", source: "fx-event", target: "hyundai", category: "macro", strength: 81, change: 9, label: "수출 채산성", description: "환율 상승이 완성차 수출의 원화 환산 실적에 직접 영향을 줍니다." },
  { id: "fx-lg", source: "fx-event", target: "lgenergy", category: "macro", strength: 57, change: 3, label: "북미 생산 비용", description: "환율과 원자재 결제 비용이 배터리 수익성 기대에 함께 반영됩니다.", dashed: true },
  { id: "samsung-hyundai", source: "samsung", target: "hyundai", category: "industry", strength: 45, change: 5, label: "전장 반도체", description: "차량 전동화가 늘수록 고성능 차량용 반도체 수요도 확대됩니다.", dashed: true },
  { id: "samsung-kb", source: "samsung", target: "kb", category: "flow", strength: 39, change: -6, label: "대형주 순환매", description: "금리 기대가 바뀔 때 성장주와 금융주 사이의 자금 이동이 나타납니다.", dashed: true },
  { id: "fx-kb", source: "fx-event", target: "kb", category: "macro", strength: 51, change: 4, label: "금리·환율 경로", description: "환율 방어 기대가 시장금리와 은행주 이익 전망에 영향을 줍니다." },
  { id: "fx-hanwha", source: "fx-event", target: "hanwha", category: "macro", strength: 61, change: 8, label: "수출 계약 환산", description: "원화 약세가 장기 방산 수출 계약의 원화 환산가치를 높입니다." },
  { id: "hanwha-hyundai", source: "hanwha", target: "hyundai", category: "flow", strength: 42, change: 11, label: "수출주 수급", description: "글로벌 매출 비중이 높은 대형 수출주로 자금이 함께 이동하고 있습니다.", dashed: true },
  { id: "rate-kb", source: "rate-event", target: "kb", category: "macro", strength: 82, change: 5, label: "순이자마진", description: "기준금리 경로가 은행의 조달비용과 순이자마진 기대를 바꿉니다." },
  { id: "rate-naver", source: "rate-event", target: "naver", category: "macro", strength: 66, change: -7, label: "성장주 할인율", description: "금리 상승은 미래 이익의 현재가치를 낮춰 플랫폼 성장주의 할인율을 높입니다.", dashed: true },
  { id: "rate-celltrion", source: "rate-event", target: "celltrion", category: "macro", strength: 54, change: -3, label: "바이오 할인율", description: "장기금리 변화가 바이오 성장주의 밸류에이션에 영향을 줍니다.", dashed: true },
  { id: "hanwha-rotem", source: "hanwha", target: "hyundai-rotem", category: "industry", strength: 78, change: 14, label: "방산 수출", description: "유럽 방산 예산과 대형 수출 계약 기대가 두 종목을 함께 움직입니다." },
  { id: "kb-shinhan", source: "kb", target: "shinhan", category: "industry", strength: 88, change: 4, label: "은행 업황", description: "순이자마진과 주주환원 기대를 공유하는 금융 섹터의 직접 관계입니다." },
  { id: "hyundai-kia", source: "hyundai", target: "kia", category: "industry", strength: 94, change: 3, label: "완성차 판매", description: "판매 지역, 환율, 부품 공급망을 공유해 실적과 주가의 동조성이 높습니다." },
  { id: "hyundai-mobis", source: "hyundai", target: "mobis", category: "industry", strength: 86, change: 6, label: "완성차 생산", description: "현대차 생산량과 전장 부품 채택률이 현대모비스 매출로 이어집니다." },
  { id: "samsung-mobis", source: "samsung", target: "mobis", category: "industry", strength: 48, change: 9, label: "차량용 반도체", description: "차량 전장화가 반도체와 전장 부품 수요를 동시에 확대합니다.", dashed: true },
  { id: "fx-kia", source: "fx-event", target: "kia", category: "macro", strength: 76, change: 7, label: "수출 환산 효과", description: "원화 약세가 기아의 해외 판매 이익을 원화 기준으로 높입니다." },
  { id: "lg-sdi", source: "lgenergy", target: "samsungsdi", category: "industry", strength: 83, change: 2, label: "배터리 업황", description: "전기차 수요와 배터리 가격이 국내 셀 업체의 실적 기대를 함께 바꿉니다." },
  { id: "lg-posco", source: "lgenergy", target: "poscofuture", category: "industry", strength: 72, change: -5, label: "양극재 수요", description: "배터리 가동률이 양극재 출하량과 소재 업체의 실적에 직접 연결됩니다." },
  { id: "sdi-posco", source: "samsungsdi", target: "poscofuture", category: "industry", strength: 64, change: -2, label: "소재 공급망", description: "차세대 배터리 생산계획이 국내 양극재 수요 기대를 움직입니다.", dashed: true },
  { id: "samsung-db", source: "samsung", target: "dbhitek", category: "flow", strength: 46, change: 8, label: "반도체 수급 확산", description: "대형 반도체주로 유입된 자금이 파운드리와 중소형주로 확산됩니다.", dashed: true },
  { id: "sk-hpsp", source: "skhynix", target: "hpsp", category: "industry", strength: 69, change: 11, label: "선단 공정 투자", description: "메모리 선단 공정 투자가 고압 공정 장비 수요로 이어집니다." },
  { id: "hanmi-hpsp", source: "hanmi", target: "hpsp", category: "flow", strength: 52, change: 13, label: "장비주 순환매", description: "반도체 장비주 안에서 수주 기대에 따라 자금이 순환합니다.", dashed: true },
  { id: "hanmi-isc", source: "hanmi", target: "isc", category: "industry", strength: 58, change: 7, label: "후공정 수요", description: "고성능 반도체 생산 확대가 패키징 장비와 테스트 부품 수요를 함께 높입니다.", dashed: true },
  { id: "sk-isc", source: "skhynix", target: "isc", category: "industry", strength: 67, change: 10, label: "AI 칩 테스트", description: "AI 메모리와 가속기 출하 증가가 테스트 소켓 수요로 이어집니다." },
  { id: "naver-kakao", source: "naver", target: "kakao", category: "industry", strength: 79, change: -1, label: "플랫폼 업황", description: "광고 경기, AI 투자비, 금리 할인율을 공유하는 플랫폼 동조 관계입니다." },
  { id: "ai-doosan", source: "ai-event", target: "doosan", category: "industry", strength: 74, change: 18, label: "데이터센터 전력", description: "AI 데이터센터 전력 수요가 원전과 가스터빈 투자 기대를 높입니다.", dashed: true },
  { id: "ai-hdelectric", source: "ai-event", target: "hdelectric", category: "industry", strength: 81, change: 21, label: "전력망 증설", description: "데이터센터 증설이 변압기와 초고압 전력기기 수요를 자극합니다." },
  { id: "ai-ls", source: "ai-event", target: "lselectric", category: "industry", strength: 71, change: 16, label: "배전 인프라", description: "AI 시설의 배전·자동화 투자가 전력 솔루션 수요로 연결됩니다.", dashed: true },
  { id: "doosan-hd", source: "doosan", target: "hdelectric", category: "flow", strength: 57, change: 12, label: "전력 인프라 수급", description: "전력 부족 테마 안에서 발전과 송배전 종목으로 자금이 함께 유입됩니다.", dashed: true },
  { id: "hd-ls", source: "hdelectric", target: "lselectric", category: "industry", strength: 85, change: 8, label: "전력기기 업황", description: "북미 전력망 교체와 데이터센터 수요를 공유하는 직접 관계입니다." },
  { id: "fx-celltrion", source: "fx-event", target: "celltrion", category: "macro", strength: 49, change: 5, label: "달러 매출", description: "달러 매출 비중이 높은 바이오 수출주의 원화 환산 실적에 영향을 줍니다.", dashed: true },
  { id: "fx-samsungbio", source: "fx-event", target: "samsungbio", category: "macro", strength: 55, change: 4, label: "수주 환산 효과", description: "글로벌 위탁생산 수주의 달러 매출이 환율 변화의 영향을 받습니다." },
  { id: "celltrion-bio", source: "celltrion", target: "samsungbio", category: "flow", strength: 62, change: 6, label: "바이오 대형주 수급", description: "바이오 섹터로 유입되는 기관·외국인 자금이 두 대형주를 함께 움직입니다.", dashed: true },
  { id: "rule-sk", source: "ai-export-rule", target: "skhynix", category: "macro", strength: 73, change: 9, label: "수출 통제 영향", description: "AI 가속기와 HBM의 최종 수요처 제한이 메모리 출하 구성에 영향을 줍니다." },
  { id: "rule-samsung", source: "ai-export-rule", target: "samsung", category: "macro", strength: 68, change: 7, label: "고객 구성 변화", description: "첨단 반도체 수출 규제가 고객·지역별 매출 구성 변화로 이어질 수 있습니다.", dashed: true },
  { id: "rule-ai", source: "ai-export-rule", target: "ai-event", category: "macro", strength: 81, change: 12, label: "AI 투자 제약", description: "국가별 반도체 접근성이 데이터센터 투자 속도와 위치를 바꿉니다." },
  { id: "valueup-kb", source: "valueup-policy", target: "kb", category: "macro", strength: 86, change: 14, label: "주주환원 확대", description: "밸류업 정책이 금융지주의 자사주 소각과 배당 확대 기대를 높입니다." },
  { id: "valueup-shinhan", source: "valueup-policy", target: "shinhan", category: "macro", strength: 82, change: 11, label: "자본효율 개선", description: "ROE 개선 목표와 주주환원 공시가 금융주의 가치평가 기준을 바꿉니다." },
  { id: "lithium-lg", source: "lithium-price", target: "lgenergy", category: "macro", strength: 77, change: -2, label: "배터리 원가", description: "리튬 가격 변화가 배터리 셀 원가와 재고평가에 직접 반영됩니다." },
  { id: "lithium-sdi", source: "lithium-price", target: "samsungsdi", category: "macro", strength: 74, change: -3, label: "원재료 부담", description: "원재료 가격이 프리미엄 배터리의 수익성 기대를 움직입니다." },
  { id: "lithium-posco", source: "lithium-price", target: "poscofuture", category: "macro", strength: 91, change: 5, label: "소재 판가", description: "리튬 가격이 양극재 판매가격과 소재 기업의 마진에 가장 직접적으로 연결됩니다." },
];

const marketGraphLinks: MarketGraphLink[] = [
  ...coreMarketGraphLinks,
  ...supplementalMarketGraphLinks,
];

const graphFeaturedLinks = ["samsung-sk", "sk-ai", "fx-hyundai", "ai-naver"];

const graphEntityMeta: Record<GraphEntityType, { label: string; short: string }> = {
  stock: { label: "종목", short: "" },
  event: { label: "시장 이벤트", short: "" },
  macro: { label: "환율·금리·원자재", short: "" },
  regulation: { label: "정책·규제", short: "" },
  sector: { label: "지수·섹터", short: "" },
};

const graphMarketCaps: Record<string, string> = {
  samsung: "552조원",
  skhynix: "249조원",
  hanmi: "21조원",
  naver: "39조원",
  hyundai: "60조원",
  lgenergy: "88조원",
  kb: "36조원",
  hanwha: "39조원",
  "hyundai-rotem": "21조원",
  shinhan: "32조원",
  kia: "55조원",
  mobis: "29조원",
  samsungsdi: "16조원",
  poscofuture: "12조원",
  dbhitek: "3.7조원",
  hpsp: "3.5조원",
  isc: "1.7조원",
  kakao: "30조원",
  doosan: "49조원",
  hdelectric: "21조원",
  lselectric: "11조원",
  celltrion: "47조원",
  samsungbio: "89조원",
};

const getGraphEntityType = (node: MarketGraphNode): GraphEntityType =>
  node.entityType ?? (node.kind === "event" ? "event" : "stock");

function MarketGraphView({ onSimulate }: { onSimulate: () => void }) {
  const [selectedNodeId, setSelectedNodeId] = useState("samsung");
  const [selectedLinkId, setSelectedLinkId] = useState("samsung-sk");
  const [activeFilter, setActiveFilter] = useState<GraphFilter>("all");
  const [graphQuery, setGraphQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragAnchor, setDragAnchor] = useState<{ x: number; y: number } | null>(null);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() =>
    Object.fromEntries(marketGraphNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
  );
  const [nodeDrag, setNodeDrag] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const nodeById = useMemo(
    () => Object.fromEntries(marketGraphNodes.map((node) => [node.id, node])) as Record<string, MarketGraphNode>,
    [],
  );
  const visibleLinks = activeFilter === "all"
    ? marketGraphLinks
    : marketGraphLinks.filter((link) => link.category === activeFilter);
  const selectedNode = nodeById[selectedNodeId];
  const selectedEntityType = getGraphEntityType(selectedNode);
  const selectedEntityMeta = graphEntityMeta[selectedEntityType];
  const selectedRelations = marketGraphLinks
    .filter((link) => link.source === selectedNodeId || link.target === selectedNodeId)
    .sort((a, b) => b.strength - a.strength);
  const connectedNodeIds = new Set(
    visibleLinks
      .filter((link) => link.source === selectedNodeId || link.target === selectedNodeId)
      .flatMap((link) => [link.source, link.target]),
  );
  const selectedNodeProperties = selectedEntityType === "stock"
    ? [
        ["현재가", selectedNode.value],
        ["등락률", `${selectedNode.change > 0 ? "+" : ""}${selectedNode.change}%`],
        ["종목코드", selectedNode.ticker],
        ["시가총액", graphMarketCaps[selectedNode.id] ?? "교육용 추정값"],
        ["업종", selectedNode.sector],
      ]
    : selectedEntityType === "regulation"
      ? [
          ["상태", selectedNode.value],
          ["주관", selectedNode.id === "valueup-policy" ? "금융위원회·거래소" : "미국 상무부"],
          ["적용 범위", selectedNode.sector],
          ["업데이트", "오늘"],
        ]
      : selectedEntityType === "macro"
        ? [
            ["현재 수준", selectedNode.value],
            ["지표 유형", selectedNode.sector],
            ["시장 영향", selectedRelations.length >= 4 ? "높음" : "보통"],
            ["업데이트", "10분 전"],
          ]
        : [
            ["상태", selectedNode.value],
            ["이벤트 유형", selectedNode.sector],
            ["영향 범위", `${selectedRelations.length}개 직접 연결`],
            ["업데이트", "오늘"],
          ];

  const chooseNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    const filteredLink = visibleLinks
      .filter((link) => link.source === nodeId || link.target === nodeId)
      .sort((a, b) => b.strength - a.strength)[0];
    const nextLink = filteredLink
      ?? marketGraphLinks.find((link) => link.source === nodeId || link.target === nodeId);
    if (!filteredLink && activeFilter !== "all") setActiveFilter("all");
    if (nextLink) setSelectedLinkId(nextLink.id);
  };

  const chooseLink = (link: MarketGraphLink) => {
    setSelectedLinkId(link.id);
    if (link.source !== selectedNodeId && link.target !== selectedNodeId) setSelectedNodeId(link.source);
  };

  const changeFilter = (filter: GraphFilter) => {
    setActiveFilter(filter);
    const filteredLinks = filter === "all" ? marketGraphLinks : marketGraphLinks.filter((link) => link.category === filter);
    const nextLink = filteredLinks.find((link) => link.source === selectedNodeId || link.target === selectedNodeId)
      ?? filteredLinks[0];
    if (nextLink) {
      setSelectedLinkId(nextLink.id);
      if (nextLink.source !== selectedNodeId && nextLink.target !== selectedNodeId) setSelectedNodeId(nextLink.source);
    }
  };

  const submitGraphSearch = () => {
    const normalized = graphQuery.trim().toLowerCase();
    const found = marketGraphNodes.find((node) =>
      `${node.name} ${node.ticker} ${node.sector}`.toLowerCase().includes(normalized),
    );
    if (found) chooseNode(found.id);
  };

  const resetGraphView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNodePositions(Object.fromEntries(marketGraphNodes.map((node) => [node.id, { x: node.x, y: node.y }])));
  };

  const changeZoom = (nextZoom: number) => {
    setZoom(Math.max(0.78, Math.min(1.55, Math.round(nextZoom * 100) / 100)));
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragAnchor({ x: event.clientX - pan.x, y: event.clientY - pan.y });
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragAnchor) return;
    setPan({
      x: Math.max(-240, Math.min(240, event.clientX - dragAnchor.x)),
      y: Math.max(-150, Math.min(150, event.clientY - dragAnchor.y)),
    });
  };

  const stopPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragAnchor(null);
  };

  const getGraphPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 500, y: 310 };
    return {
      x: (((clientX - rect.left - rect.width / 2 - pan.x) / zoom + rect.width / 2) / rect.width) * 1000,
      y: (((clientY - rect.top - rect.height / 2 - pan.y) / zoom + rect.height / 2) / rect.height) * 620,
    };
  };

  const startNodeDrag = (event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getGraphPoint(event.clientX, event.clientY);
    const position = nodePositions[nodeId];
    setNodeDrag({ id: nodeId, offsetX: point.x - position.x, offsetY: point.y - position.y });
  };

  const moveNode = (event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) => {
    if (!nodeDrag || nodeDrag.id !== nodeId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getGraphPoint(event.clientX, event.clientY);
    setNodePositions((currentPositions) => ({
      ...currentPositions,
      [nodeId]: {
        x: Math.max(18, Math.min(982, point.x - nodeDrag.offsetX)),
        y: Math.max(18, Math.min(602, point.y - nodeDrag.offsetY)),
      },
    }));
  };

  const stopNodeDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setNodeDrag(null);
  };

  const zoomWithWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((currentZoom) => {
      const nextZoom = currentZoom + (event.deltaY < 0 ? 0.09 : -0.09);
      return Math.max(0.62, Math.min(1.85, Math.round(nextZoom * 100) / 100));
    });
  };

  return (
    <div className="view-shell graph-view">
      <section className="graph-heading">
        <div>
          <span>CONNECTED MARKET MAP</span>
          <h1>종목이 아니라, 연결을 봅니다</h1>
          <p>산업·수급·거시 변수로 이어진 KOSPI의 관계를 한눈에 탐색하세요.</p>
        </div>
        <div className="graph-legend" aria-label="그래프 범례">
          <span><b className="entity-stock" /> 종목</span>
          <span><b className="entity-event" /> 이벤트</span>
          <span><b className="entity-macro" /> 환율·금리</span>
          <span><b className="entity-regulation" /> 정책·규제</span>
          <span><i className="solid" /> 연결 강도</span>
        </div>
      </section>

      <section className="graph-searchbar" aria-label="시장 관계 검색과 필터">
        <div className="graph-search-input">
          <Search size={18} aria-hidden="true" />
          <input
            value={graphQuery}
            onChange={(event) => setGraphQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submitGraphSearch()}
            placeholder="종목명, 코드, 섹터를 검색하세요"
            aria-label="시장 관계 검색"
          />
          <button onClick={submitGraphSearch}>검색</button>
        </div>
        <div className="graph-filters" aria-label="관계 유형 필터">
          {([
            ["all", "전체 관계"],
            ["industry", "산업 관계"],
            ["flow", "수급 동조"],
            ["macro", "거시 변수"],
          ] as [GraphFilter, string][]).map(([id, label]) => (
            <button key={id} className={activeFilter === id ? "active" : ""} onClick={() => changeFilter(id)} aria-pressed={activeFilter === id}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="market-network-shell">
        <aside className="network-discovery" aria-labelledby="network-discovery-title">
          <div className="network-panel-title">
            <span>01 · DISCOVERY</span>
            <h2 id="network-discovery-title">오늘의 주요 연결</h2>
            <p>평소보다 관계 강도가 빠르게 변한 조합입니다.</p>
          </div>
          <div className="featured-relations">
            {graphFeaturedLinks.map((id, index) => {
              const link = marketGraphLinks.find((item) => item.id === id)!;
              const source = nodeById[link.source];
              const target = nodeById[link.target];
              return (
                <button key={id} className={selectedLinkId === id ? "active" : ""} onClick={() => chooseLink(link)}>
                  <span className="relation-rank">0{index + 1}</span>
                  <div>
                    <strong>{source.name} <i>↔</i> {target.name}</strong>
                    <small>{link.label}</small>
                  </div>
                  <span className={link.change >= 0 ? "up" : "down"}>{link.change >= 0 ? "+" : ""}{link.change}%</span>
                </button>
              );
            })}
          </div>
          <div className="discovery-note">
            <Sparkles size={16} />
            <p>점의 크기는 시장 영향력, 선의 굵기는 관계 강도를 뜻합니다.</p>
          </div>
        </aside>

        <div className="network-canvas-wrap">
          <div className="network-canvas-heading">
            <div><span>02 · MARKET NETWORK</span><h2>KOSPI 연결 지도</h2></div>
            <div className="network-canvas-actions">
              <button className={focusMode ? "active" : ""} onClick={() => setFocusMode((currentMode) => !currentMode)} aria-pressed={focusMode}>
                <LocateFixed size={13} /> 연결 집중
              </button>
              <span>{marketGraphNodes.length}개 노드 · {visibleLinks.length}개 관계</span>
            </div>
          </div>
          <div
            ref={canvasRef}
            className={`network-canvas ${dragAnchor || nodeDrag ? "dragging" : ""}`}
            role="group"
            aria-label="KOSPI 금융 지식그래프. 빈 공간을 드래그해 이동하고, 마우스 휠로 확대 축소하며, 노드를 직접 이동할 수 있습니다."
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
            onWheel={zoomWithWheel}
            onDoubleClick={resetGraphView}
          >
            <div className="graph-navigation-controls" aria-label="그래프 확대 축소">
              <button onClick={() => changeZoom(zoom - 0.12)} aria-label="축소"><Minus size={15} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => changeZoom(zoom + 0.12)} aria-label="확대"><Plus size={15} /></button>
              <button onClick={resetGraphView} aria-label="그래프 위치 초기화"><LocateFixed size={15} /></button>
            </div>
            <div className="graph-interaction-hint">노드 드래그 · 빈 공간 이동 · 마우스 휠 확대/축소</div>

            <div className="network-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <div className="sector-cloud cloud-chip"><span>반도체 생태계</span></div>
              <div className="sector-cloud cloud-export"><span>수출·환율</span></div>
              <div className="sector-cloud cloud-growth"><span>AI·성장주</span></div>
              <div className="sector-cloud cloud-power"><span>전력 인프라</span></div>

              <svg className="network-edges" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-label="시장 엔터티 관계선">
                {visibleLinks.map((link) => {
                  const sourceNode = nodeById[link.source];
                  const targetNode = nodeById[link.target];
                  const source = nodePositions[link.source];
                  const target = nodePositions[link.target];
                  const isActive = link.id === selectedLinkId;
                  const isRelated = link.source === selectedNodeId || link.target === selectedNodeId;
                  const mutedClass = focusMode && !isRelated ? "muted" : "ambient";
                  const edgeLabel = `${sourceNode.name}과 ${targetNode.name}의 ${link.label} 관계, 강도 ${link.strength}`;

                  return (
                    <g
                      key={link.id}
                      className="graph-edge-group"
                      role="button"
                      tabIndex={0}
                      aria-label={edgeLabel}
                      onClick={() => chooseLink(link)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") chooseLink(link);
                      }}
                    >
                      <title>{edgeLabel}</title>
                      <line
                        className={`graph-edge ${link.dashed ? "dashed" : ""} ${isActive ? "active" : ""} ${isRelated ? "related" : mutedClass}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        className="graph-edge-hit"
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              </svg>

              {marketGraphNodes.map((node) => {
                const isSelected = node.id === selectedNodeId;
                const isConnected = connectedNodeIds.has(node.id);
                const isDimmed = focusMode && !isSelected && !isConnected;
                const entityType = getGraphEntityType(node);
                const entityMeta = graphEntityMeta[entityType];
                const position = nodePositions[node.id];
                const nodeDiameter = Math.max(14, Math.min(34, Math.round(node.size * 0.43)));
                const isLabelVisible = isSelected || isConnected || node.size >= 44;
                return (
                  <button
                    className={`graph-node entity-${entityType} ${node.id === "samsung" ? "origin" : ""} ${isSelected ? "selected" : ""} ${isConnected ? "connected" : ""} ${isDimmed ? "dimmed" : ""}`}
                    key={node.id}
                    style={{ left: `${position.x / 10}%`, top: `${position.y / 6.2}%`, width: `${nodeDiameter}px`, height: `${nodeDiameter}px` }}
                    onPointerDown={(event) => startNodeDrag(event, node.id)}
                    onPointerMove={(event) => moveNode(event, node.id)}
                    onPointerUp={stopNodeDrag}
                    onPointerCancel={stopNodeDrag}
                    onClick={() => chooseNode(node.id)}
                    aria-pressed={isSelected}
                    aria-label={`${node.name}, ${entityMeta.label}, ${node.sector}`}
                    title={`${node.name} · ${node.sector} · ${node.value}`}
                  >
                    <span aria-hidden="true" />
                    <strong className={isLabelVisible ? "visible" : ""}>{node.name}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="network-detail knowledge-inspector" aria-labelledby="network-detail-title">
          <div className="inspector-title">
            <div><i className={`entity-${selectedEntityType}`} /><strong>Node</strong><span>{selectedEntityMeta.label}</span></div>
            <Network size={18} aria-hidden="true" />
          </div>

          <div className="inspector-entity">
            <div className={`inspector-entity-mark entity-${selectedEntityType}`}>{selectedEntityMeta.short}</div>
            <div>
              <span>{selectedNode.ticker}</span>
              <h2 id="network-detail-title">{selectedNode.name}</h2>
              <p>{selectedNode.sector}</p>
            </div>
          </div>

          <dl className="inspector-core">
            <div><dt>ID</dt><dd>{selectedNode.id}</dd></div>
            <div><dt>Labels</dt><dd>{selectedEntityMeta.label}</dd></div>
            <div><dt>Degree</dt><dd>{selectedRelations.length}</dd></div>
          </dl>

          <section className="inspector-section inspector-properties">
            <div className="inspector-section-heading">
              <span>Properties</span>
              <small>선택 노드 속성</small>
            </div>
            <p className="inspector-description">{selectedNode.summary}</p>
            <dl>
              {selectedNodeProperties.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
            <div className="inspector-news">
              <span>연관 뉴스</span>
              {selectedNode.news.slice(0, 3).map((news) => (
                <article key={news.title}>
                  <i>{news.source}</i>
                  <div><strong>{news.title}</strong><small>{news.time}</small></div>
                </article>
              ))}
            </div>
          </section>

          <section className="inspector-section inspector-relations">
            <div className="inspector-section-heading">
              <span>Relations</span>
              <small>연결 강도 높은 순</small>
            </div>
            <div className="inspector-relation-list">
              {selectedRelations.map((link) => {
                const peerNodeId = link.source === selectedNodeId ? link.target : link.source;
                const peerNode = nodeById[peerNodeId];
                const peerType = getGraphEntityType(peerNode);
                return (
                  <button
                    key={link.id}
                    className={selectedLinkId === link.id ? "active" : ""}
                    onClick={() => {
                      setSelectedNodeId(peerNodeId);
                      setSelectedLinkId(link.id);
                      setActiveFilter("all");
                    }}
                  >
                    <i className={`entity-${peerType}`} />
                    <div><strong>{peerNode.name}</strong><small>{graphEntityMeta[peerType].label} · {link.label}</small></div>
                    <span>{link.strength}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <button className="graph-simulate-button" onClick={onSimulate}>
            <span><small>NEXT STEP</small><strong>{selectedNode.name} 영향 시뮬레이션</strong></span>
            <ArrowRight size={18} />
          </button>
        </aside>
      </section>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>("graph");
  const [searchMode, setSearchMode] = useState<SearchMode>("market");
  const [selectedEntity, setSelectedEntity] = useState<EntityId>("kospi");
  const [activeDriver, setActiveDriver] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [appliedToTwin, setAppliedToTwin] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [rateChange, setRateChange] = useState(0);
  const [fxLevel, setFxLevel] = useState(1380);
  const [earningsExpectation, setEarningsExpectation] = useState(8);
  const [foreignFlow, setForeignFlow] = useState(0.8);
  const [shockLevel, setShockLevel] = useState(3);
  const [semiconductorRatio, setSemiconductorRatio] = useState(42);
  const [goal, setGoal] = useState("전세자금");
  const [goalMonths, setGoalMonths] = useState(36);
  const [riskStyle, setRiskStyle] = useState("균형형");

  const current = entities[selectedEntity];
  const availableEntities = (Object.keys(entities) as EntityId[]).filter(
    (id) => entities[id].mode === searchMode,
  );

  const simulation = useMemo(() => {
    const marketMove =
      earningsExpectation * 0.075 +
      foreignFlow * 0.82 -
      rateChange * 0.011 -
      Math.max(0, fxLevel - 1380) * 0.012 -
      (shockLevel - 3) * 0.62;
    const center = current.value * (1 + marketMove / 100);
    const band = 2.1 + shockLevel * 0.72;
    const confidence = Math.max(54, Math.min(86, current.confidence - (shockLevel - 3) * 4));

    return {
      move: Math.round(marketMove * 10) / 10,
      confidence,
      optimistic: center * (1 + band / 100),
      base: center,
      risk: center * (1 - (band + 1.3) / 100),
    };
  }, [current, earningsExpectation, foreignFlow, fxLevel, rateChange, shockLevel]);

  const currentDeltaTone = current.delta.trim().startsWith("-") ? "down" : "up";
  const simulationTone = simulation.move > 0 ? "up" : simulation.move < 0 ? "down" : "flat";

  const chartModel = useMemo(() => {
    const scale = current.value / 3248.6;
    const candles = kospiCandleData.map((candle) => ({
      ...candle,
      open: candle.open * scale,
      high: candle.high * scale,
      low: candle.low * scale,
      close: candle.close * scale,
    }));
    const latest = candles[candles.length - 1];
    const rawMin = Math.min(...candles.map((candle) => candle.low), simulation.risk);
    const rawMax = Math.max(...candles.map((candle) => candle.high), simulation.optimistic);
    const padding = (rawMax - rawMin) * 0.09;
    const step = current.mode === "stock" ? 1000 : 10;
    const min = Math.floor((rawMin - padding) / step) * step;
    const max = Math.ceil((rawMax + padding) / step) * step;
    const range = Math.max(1, max - min);
    const y = (value: number) => ((max - value) / range) * 100;
    const ticks = Array.from({ length: 5 }, (_, index) => max - (range / 4) * index);

    return { candles, latest, min, max, ticks, y };
  }, [current.mode, current.value, simulation.optimistic, simulation.risk]);

  const goalStability = Math.max(
    32,
    Math.min(92, Math.round(88 - semiconductorRatio * 0.48 - shockLevel * 3 + goalMonths * 0.18)),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activateTab = (tab: MainTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const changeSearchMode = (mode: SearchMode) => {
    setSearchMode(mode);
    setSelectedEntity(mode === "market" ? "kospi" : "samsung");
    setQuery("");
    setHasRun(false);
  };

  const chooseEntity = (id: EntityId) => {
    setSelectedEntity(id);
    setQuery(entities[id].name);
    setHasRun(false);
  };

  const submitSearch = () => {
    const normalized = query.trim().toLowerCase();
    const found = availableEntities.find((id) =>
      `${entities[id].name} ${entities[id].code}`.toLowerCase().includes(normalized),
    );
    if (found) chooseEntity(found);
  };

  const runSimulation = () => {
    setHasRun(true);
    window.setTimeout(
      () => document.getElementById("simulation-result")?.scrollIntoView({ behavior: "smooth", block: "center" }),
      80,
    );
  };

  const applyToTwin = () => {
    setAppliedToTwin(true);
    activateTab("twin");
  };

  const openSimulator = () => {
    setSimulatorOpen(true);
    window.setTimeout(
      () => document.getElementById("market-simulator")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  };

  const openGraphSimulator = () => {
    setSelectedEntity("samsung");
    setSimulatorOpen(true);
    activateTab("insight");
    window.setTimeout(
      () => document.getElementById("market-simulator")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      120,
    );
  };

  const formatValue = (value: number) => {
    const rounded = current.mode === "stock" ? Math.round(value / 100) * 100 : Math.round(value * 100) / 100;
    return `${rounded.toLocaleString("ko-KR")}${current.mode === "stock" ? "원" : ""}`;
  };

  const formatChartValue = (value: number) => current.mode === "stock"
    ? `${Math.round(value / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatVolume = (volume: number) => `${Math.floor(volume / 100000000)}억 ${Math.round((volume % 100000000) / 10000).toLocaleString("ko-KR")}만`;

  const predictionRange = `${formatValue(simulation.risk)} – ${formatValue(simulation.optimistic)}`;

  return (
    <div className="finverse-app">
      <header className="topbar">
        <button className="brand" onClick={() => activateTab("graph")} aria-label="FINVERSE 시장 인사이트 홈">
          <span className="brand-mark">F</span>
          <span>FINVERSE</span>
        </button>

        <nav className="top-tabs" aria-label="주요 메뉴">
          <button className={activeTab === "graph" ? "active" : ""} onClick={() => activateTab("graph")}>
            시장 인사이트
          </button>
          <button className={activeTab === "insight" ? "active" : ""} onClick={() => activateTab("insight")}>
            시장 인사이트(예비)
          </button>
          <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}>
            마이 금융 트윈
          </button>
        </nav>

        <button className="profile-button" onClick={() => setProfileOpen(true)}>
          <UserRound size={17} aria-hidden="true" />
          <span>내 금융 상태</span>
        </button>
      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="FINVERSE 탐색">
          <div className="sidebar-label">
            <BrainCircuit size={19} aria-hidden="true" />
            <div><span>AI DECISION LAB</span><strong>금융 판단 실험실</strong></div>
          </div>
          <nav className="side-tabs">
            <button className={activeTab === "graph" ? "active" : ""} onClick={() => activateTab("graph")}>
              <Network size={18} aria-hidden="true" />
              시장 인사이트
            </button>
            <button className={activeTab === "insight" ? "active" : ""} onClick={() => activateTab("insight")}>
              <LineChart size={18} aria-hidden="true" />
              시장 인사이트(예비)
            </button>
            <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}>
              <UserRound size={18} aria-hidden="true" />
              마이 금융 트윈
            </button>
          </nav>
          <div className="sidebar-note">
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <strong>교육용 가상 데이터</strong>
              <p>조건과 불확실성을 비교하는 판단 훈련이며 투자 권유가 아닙니다.</p>
            </div>
          </div>
        </aside>

        <main className="main-content">
          {activeTab === "insight" ? (
            <div className="view-shell insight-view">
              <section className="market-hero" aria-labelledby="market-hero-title">
                <div className="market-hero-copy">
                  <span>MARKET DECISION LAB</span>
                  <h1 id="market-hero-title">AI 반도체 랠리 이후,<br />지금 어떤 판단을 하시겠어요?</h1>
                  <p>시장의 정답을 맞히는 대신 내 목표에 남을 영향을 먼저 비교합니다.</p>
                </div>
                <div className="hero-orbit" aria-hidden="true">
                  <i className="orbit orbit-outer" />
                  <i className="orbit orbit-inner" />
                  <i className="orbit-node node-a" />
                  <i className="orbit-node node-b" />
                  <span><BrainCircuit size={34} /></span>
                </div>
              </section>

              <section className="search-card" aria-label="시장 및 종목 검색">
                <div className="search-modes" role="tablist" aria-label="검색 범위">
                  <button className={searchMode === "market" ? "active" : ""} onClick={() => changeSearchMode("market")}>
                    시장
                  </button>
                  <button className={searchMode === "stock" ? "active" : ""} onClick={() => changeSearchMode("stock")}>
                    개별 종목
                  </button>
                </div>
                <div className="search-input-wrap">
                  <Search size={20} aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && submitSearch()}
                    placeholder={searchMode === "market" ? "KOSPI, KOSDAQ을 검색하세요" : "삼성전자, SK하이닉스를 검색하세요"}
                    aria-label={searchMode === "market" ? "시장 검색" : "개별 종목 검색"}
                  />
                  <button onClick={submitSearch}>조회</button>
                </div>
                <div className="quick-searches" aria-label="빠른 검색">
                  <span>빠른 검색</span>
                  {availableEntities.map((id) => (
                    <button key={id} className={selectedEntity === id ? "active" : ""} onClick={() => chooseEntity(id)}>
                      {entities[id].name}
                    </button>
                  ))}
                </div>
              </section>

              <section className="terminal-workspace" aria-label={`${current.name} 시장 차트와 AI 분석`}>
                <section className="market-chart-panel" aria-labelledby="terminal-chart-title">
                  <div className="chart-market-header">
                    <div>
                      <div className="chart-title-line">
                        <h2 id="terminal-chart-title">{current.name} <strong>{current.valueLabel}</strong></h2>
                        <span className={`chart-delta ${currentDeltaTone}`}>{current.delta}</span>
                      </div>
                      <p>전일대비 <strong className={currentDeltaTone}>{current.delta}</strong> · 🇰🇷 한국 <CircleAlert size={12} /></p>
                    </div>
                    <div className="chart-market-stats">
                      <div><span>거래량</span><strong>{formatVolume(chartModel.latest.volume)}</strong></div>
                      <div><span>시가</span><strong>{formatChartValue(chartModel.latest.open)}</strong></div>
                      <div><span>1일 최저</span><strong>{formatChartValue(chartModel.latest.low)}</strong></div>
                      <div><span>1일 최고</span><strong>{formatChartValue(chartModel.latest.high)}</strong></div>
                    </div>
                  </div>

                  <div className="chart-toolbar">
                    <div className="timeframes"><button>1분</button><button className="active">일</button><button>주</button><button>월</button><button>년</button></div>
                    <div className="chart-tools"><i className="candle-tool" /><span>▦</span><span>⚙</span></div>
                  </div>

                  <div className="market-data-chart" role="img" aria-label={`${current.name} 실제 OHLC 데이터와 AI 30일 예측구간`}>
                    <div className="data-chart-legend">
                      <div><span className="actual-key" />시장 고가 저가 종가</div>
                      <div><span className="forecast-key" />AI 30일 예측구간</div>
                    </div>
                    <div className="data-chart-plot">
                      <div className="forecast-surface" />
                      {chartModel.ticks.map((tick) => (
                        <div className="data-grid-line" style={{ top: `${chartModel.y(tick)}%` }} key={tick}>
                          <span>{formatChartValue(tick)}</span>
                        </div>
                      ))}
                      {chartModel.candles.map((candle, index) => {
                        const x = 3 + (index / (chartModel.candles.length - 1)) * 62;
                        const openY = chartModel.y(candle.open);
                        const closeY = chartModel.y(candle.close);
                        const highY = chartModel.y(candle.high);
                        const lowY = chartModel.y(candle.low);
                        const rising = candle.close >= candle.open;
                        return (
                          <span className={`data-candle ${rising ? "rising" : "falling"}`} style={{ left: `${x}%` }} key={candle.date} title={`${candle.date} 시가 ${formatChartValue(candle.open)} 고가 ${formatChartValue(candle.high)} 저가 ${formatChartValue(candle.low)} 종가 ${formatChartValue(candle.close)}`}>
                            <i className="data-wick" style={{ top: `${highY}%`, height: `${Math.max(1, lowY - highY)}%` }} />
                            <i className="data-body" style={{ top: `${Math.min(openY, closeY)}%`, height: `${Math.max(1.4, Math.abs(openY - closeY))}%` }} />
                          </span>
                        );
                      })}
                      <div className="data-today-line" style={{ left: "68%" }}><span>오늘</span></div>
                      <div className="data-current-point" style={{ left: "68%", top: `${chartModel.y(chartModel.latest.close)}%` }}><i /><strong>{formatChartValue(chartModel.latest.close)}</strong></div>
                      <div className="data-forecast-band" style={{ clipPath: `polygon(68% ${chartModel.y(chartModel.latest.close)}%, 92% ${chartModel.y(simulation.optimistic)}%, 92% ${chartModel.y(simulation.risk)}%)` }} />
                      <div className="data-forecast-stroke upper" style={{ clipPath: `polygon(68% ${chartModel.y(chartModel.latest.close)}%, 92% ${chartModel.y(simulation.optimistic)}%, 92% ${chartModel.y(simulation.optimistic) + 0.25}%, 68% ${chartModel.y(chartModel.latest.close) + 0.25}%)` }} />
                      <div className="data-forecast-stroke center" style={{ clipPath: `polygon(68% ${chartModel.y(chartModel.latest.close)}%, 92% ${chartModel.y(simulation.base)}%, 92% ${chartModel.y(simulation.base) + 0.35}%, 68% ${chartModel.y(chartModel.latest.close) + 0.35}%)` }} />
                      <div className="data-forecast-stroke lower" style={{ clipPath: `polygon(68% ${chartModel.y(chartModel.latest.close)}%, 92% ${chartModel.y(simulation.risk)}%, 92% ${chartModel.y(simulation.risk) + 0.25}%, 68% ${chartModel.y(chartModel.latest.close) + 0.25}%)` }} />
                      <div className="data-prediction-interval" style={{ left: "92%", top: `${chartModel.y(simulation.optimistic)}%`, height: `${chartModel.y(simulation.risk) - chartModel.y(simulation.optimistic)}%` }}><span className="upper-value">{formatChartValue(simulation.optimistic)}</span><span className="lower-value">{formatChartValue(simulation.risk)}</span></div>
                      <div className="data-prediction-point" style={{ left: "92%", top: `${chartModel.y(simulation.base)}%` }}><i /><strong>{formatValue(simulation.base)}</strong><small className={simulationTone}>{simulation.move > 0 ? "+" : ""}{simulation.move}%</small></div>
                      <div className="data-forecast-caption"><span>AI 30일 전망</span><strong>신뢰도 {simulation.confidence}%</strong></div>
                      <div className="data-chart-months"><span>3월</span><span>4월</span><span>5월</span><span>6월</span><span>오늘</span><span>30일 후</span></div>
                    </div>
                  </div>
                </section>

                <aside className="ai-terminal-panel prediction-panel" aria-label="AI 예측 근거와 멀티 에이전트 시뮬레이션">
                  <section className="prediction-overview">
                    <div className="panel-section-heading">
                      <div><span>01 · AI FORECAST</span><h3>예측 포인트와 구간</h3></div>
                      <span className="prediction-confidence">신뢰도 {current.confidence}%</span>
                    </div>
                    <div className="prediction-numbers">
                      <div><span>30일 예측값</span><strong>{formatValue(simulation.base)}</strong><small className={simulationTone}>{simulation.move > 0 ? "+" : ""}{simulation.move}%</small></div>
                      <div><span>예측구간</span><strong>{predictionRange}</strong><small>{current.regime}</small></div>
                    </div>
                  </section>

                  <section className="prediction-drivers">
                    <div className="panel-section-heading"><div><span>02 · TOP 3 DRIVERS</span><h3>예측값을 만든 이유 TOP 3</h3></div><BrainCircuit size={17} /></div>
                    <p>어제 예측값과 비교해 각 요인이 변화에 기여한 비중입니다.</p>
                    <div className="driver-list" aria-label="예측 근거별 관련 뉴스">
                      {predictionDrivers.map((driver, index) => (
                        <div className={`driver-entry ${activeDriver === index ? "active" : ""}`} key={driver.rank}>
                          <button
                            type="button"
                            className={activeDriver === index ? "active" : ""}
                            onClick={() => setActiveDriver((currentDriver) => currentDriver === index ? null : index)}
                            aria-expanded={activeDriver === index}
                            aria-controls={`driver-news-${index}`}
                          >
                            <span className="driver-rank">{driver.rank}</span>
                            <div className="driver-copy"><strong>{driver.label}</strong><small>{driver.detail}</small><div><i className={driver.tone} style={{ width: driver.width }} /></div></div>
                            <strong className={`driver-contribution ${driver.tone}`}>{driver.contribution}</strong>
                            <ChevronRight className="driver-chevron" size={15} />
                          </button>
                          {activeDriver === index && (
                            <div className="driver-news-drawer" id={`driver-news-${index}`} aria-live="polite">
                              <div className="driver-news-title"><div><Newspaper size={15} /><strong>관련 뉴스 2건</strong></div><span>{driver.label} 근거</span></div>
                              <div className="driver-news-list">
                                {driverNews[index].map((news) => (
                                  <article key={news.title}>
                                    <span>{news.source}</span>
                                    <div><strong>{news.title}</strong><small>{news.time}</small></div>
                                    <ChevronRight size={14} aria-hidden="true" />
                                  </article>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="agent-preview-panel">
                    <div className="panel-section-heading"><div><span>03 · MULTI-AGENT READY</span><h3>시나리오에 참여할 에이전트</h3></div><Sparkles size={17} /></div>
                    <p className="agent-intro">선택한 근거와 뉴스를 서로 다른 관점으로 검증합니다.</p>
                    <div className="agent-list">
                      <article><i><Newspaper size={16} /></i><div><strong>시장 해석 에이전트</strong><small>실적·뉴스 신호 분석</small></div><span>준비</span></article>
                      <article><i><Landmark size={16} /></i><div><strong>수급·거시 에이전트</strong><small>외국인·환율 압력 분석</small></div><span>준비</span></article>
                      <article><i><UserRound size={16} /></i><div><strong>금융 트윈 에이전트</strong><small>내 목표와 자산 영향 분석</small></div><span>연결</span></article>
                    </div>
                    <div className="agent-context"><BrainCircuit size={15} /><p>{current.summary}</p></div>
                  </section>

                  <button className="terminal-cta agent-simulation-cta" onClick={openSimulator}><span><small>MULTI-AGENT SIMULATOR</small><strong>3개 에이전트로 {current.name} 시나리오 검증</strong></span><i><Play size={14} fill="currentColor" /> 시뮬레이션 시작 <ArrowRight size={14} /></i></button>
                </aside>
              </section>

              {simulatorOpen && (
                <section className="simulator" id="market-simulator" aria-labelledby="simulator-title">
                  <div className="simulator-heading">
                    <div><span>MULTI-AGENT SIMULATOR</span><h2 id="simulator-title">에이전트의 가정과 조건을 직접 조정하세요</h2><p>시장·수급·금융 트윈 에이전트가 변경된 조건으로 경로를 다시 계산합니다.</p></div>
                    <SlidersHorizontal size={24} aria-hidden="true" />
                  </div>
                  <div className="simulator-grid">
                    <div className="control-panel">
                      <label><span>기준금리 변화 <strong>{rateChange > 0 ? "+" : ""}{rateChange}bp</strong></span><input type="range" min="-50" max="50" step="10" value={rateChange} onChange={(event) => { setRateChange(Number(event.target.value)); setHasRun(false); }} /><small><span>-50bp</span><span>+50bp</span></small></label>
                      <label><span>원·달러 환율 <strong>{fxLevel.toLocaleString()}원</strong></span><input type="range" min="1320" max="1450" step="5" value={fxLevel} onChange={(event) => { setFxLevel(Number(event.target.value)); setHasRun(false); }} /><small><span>1,320원</span><span>1,450원</span></small></label>
                      <label><span>반도체 실적 기대 <strong>{earningsExpectation > 0 ? "+" : ""}{earningsExpectation}%</strong></span><input type="range" min="-20" max="20" step="2" value={earningsExpectation} onChange={(event) => { setEarningsExpectation(Number(event.target.value)); setHasRun(false); }} /><small><span>-20%</span><span>+20%</span></small></label>
                      <label><span>외국인 순매수 <strong>{foreignFlow > 0 ? "+" : ""}{foreignFlow.toFixed(1)}조</strong></span><input type="range" min="-3" max="3" step="0.2" value={foreignFlow} onChange={(event) => { setForeignFlow(Number(event.target.value)); setHasRun(false); }} /><small><span>-3조</span><span>+3조</span></small></label>
                      <label><span>시장 충격 강도 <strong>{shockLevel}/5</strong></span><input type="range" min="1" max="5" step="1" value={shockLevel} onChange={(event) => { setShockLevel(Number(event.target.value)); setHasRun(false); }} /><small><span>낮음</span><span>높음</span></small></label>
                      <button className="run-button" onClick={runSimulation}><RefreshCw size={17} /> 에이전트 시뮬레이션 실행</button>
                    </div>

                    <div className={`simulation-result ${hasRun ? "ready" : ""}`} id="simulation-result" aria-live="polite">
                      {!hasRun ? (
                        <div className="result-placeholder">
                          <Gauge size={36} aria-hidden="true" />
                          <span>에이전트 준비 완료</span>
                          <h3>실행하면 세 가지 경로가 열립니다</h3>
                          <p>현재 입력값을 기준으로 상단·중심·하단 범위와 영향을 받는 섹터를 비교합니다.</p>
                        </div>
                      ) : (
                        <>
                          <div className="result-top"><div><span>30일 중심 경로</span><strong>{formatValue(simulation.base)}</strong><small className={simulationTone}>{simulation.move > 0 ? "+" : ""}{simulation.move}%</small></div><div className="result-confidence"><span>신뢰도</span><strong>{simulation.confidence}%</strong></div></div>
                          <div className="scenario-cards">
                            <div><span>상단 경로</span><strong>{formatValue(simulation.optimistic)}</strong><p>실적 기대 상회<br />외국인 수급 유지</p></div>
                            <div className="base"><span>중심 경로</span><strong>{formatValue(simulation.base)}</strong><p>현재 기대 유지<br />변동성 지속</p></div>
                            <div><span>하단 경로</span><strong>{formatValue(simulation.risk)}</strong><p>환율·금리 부담<br />기술주 조정</p></div>
                          </div>
                          <div className="result-reason"><BrainCircuit size={20} /><div><span>에이전트 합의</span><p>시장 해석과 수급 에이전트는 실적 기대가 환율 부담을 상쇄한다고 판단했습니다. 금융 트윈은 충격 강도가 커질수록 목표자금의 하단 위험이 빠르게 넓어지는 점을 경고합니다.</p></div></div>
                          <button className="apply-twin-button" onClick={applyToTwin}>이 결과를 내 금융 트윈에 적용하기 <ArrowRight size={18} /></button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="simulator-disclaimer"><LockKeyhole size={14} /> 모든 수치는 서비스 경험을 위한 교육용 조건부 범위이며 실제 시장 예측이나 투자 권유가 아닙니다.</p>
                </section>
              )}
            </div>
          ) : activeTab === "graph" ? (
            <MarketGraphView onSimulate={openGraphSimulator} />
          ) : (
            <div className="view-shell twin-view">
              <div className="view-heading">
                <div><span className="eyebrow">MY FINANCIAL TWIN</span><h1>같은 시장도 나에게 미치는 영향은 다릅니다</h1><p>시장 시뮬레이션 위에 나의 자산, 목표와 행동 특성을 겹쳐 봅니다.</p></div>
                <button className="edit-profile" onClick={() => setProfileOpen(true)}><Pencil size={16} /> 금융 상태 수정</button>
              </div>

              {!appliedToTwin ? (
                <section className="twin-empty">
                  <div className="twin-empty-icon"><UserRound size={34} /></div>
                  <span>연결된 시장 시나리오가 없습니다</span>
                  <h2>시장 환경을 먼저 시뮬레이션해 주세요</h2>
                  <p>시장 인사이트에서 조건을 바꿔본 뒤 결과를 금융 트윈에 적용하면 개인 영향 분석이 시작됩니다.</p>
                  <button onClick={() => activateTab("insight")}>시장 인사이트로 이동 <ArrowRight size={17} /></button>
                </section>
              ) : (
                <>
                  <section className="twin-overview">
                    <div className="twin-overview-copy"><span>적용된 시장 환경</span><h2>{current.name} · 중심 경로 {simulation.move > 0 ? "+" : ""}{simulation.move}%</h2><p>실적 기대 {earningsExpectation > 0 ? "+" : ""}{earningsExpectation}%, 원·달러 {fxLevel.toLocaleString()}원, 시장 충격 {shockLevel}/5 조건을 적용했습니다.</p><div className="twin-route"><span>시장 이벤트</span><ChevronRight size={15} /><span>{current.name}</span><ChevronRight size={15} /><span>나의 자산</span><ChevronRight size={15} /><span className="active">{goal}</span></div></div>
                    <div className="stability-score"><span>목표 안정성</span><strong>{goalStability}</strong><small>/100</small><div><i style={{ width: `${goalStability}%` }} /></div><p>{goalStability >= 70 ? "현재 조건에서 목표 방어력이 비교적 안정적입니다." : "시장 충격이 목표자금에 전달될 가능성이 큽니다."}</p></div>
                  </section>

                  <div className="twin-grid">
                    <section className="card profile-card">
                      <div className="card-heading"><div><span>01 · MY PROFILE</span><h2>나의 가상 금융 상태</h2></div><WalletCards size={20} /></div>
                      <div className="profile-metrics"><div><span>투자 성향</span><strong>{riskStyle}</strong></div><div><span>반도체·성장주</span><strong>{semiconductorRatio}%</strong></div><div><span>생활 목표</span><strong>{goal}</strong></div><div><span>목표까지</span><strong>{goalMonths}개월</strong></div></div>
                      <div className="asset-bar" aria-label="가상 자산 구성"><i className="asset-risk" style={{ width: `${semiconductorRatio}%` }} /><i className="asset-safe" style={{ width: `${Math.max(18, 68 - semiconductorRatio)}%` }} /><i className="asset-cash" /></div>
                      <div className="asset-legend"><span><i className="risk" />성장자산</span><span><i className="safe" />안전자산</span><span><i className="cash" />현금성</span></div>
                    </section>

                    <section className="card impact-card">
                      <div className="card-heading"><div><span>02 · GOAL IMPACT</span><h2>내 목표에 전달되는 영향</h2></div><Target size={20} /></div>
                      <div className="impact-metrics"><div><span>기준 경로 자산 영향</span><strong>{(simulation.move * semiconductorRatio / 100).toFixed(1)}%</strong><small>시장 변화 × 위험자산 비중</small></div><div><span>하단 경로 최대 충격</span><strong>-{Math.max(4.8, shockLevel * semiconductorRatio * 0.045).toFixed(1)}%</strong><small>목표 시점 전 회복 기간 필요</small></div></div>
                      <div className="impact-message"><CircleAlert size={18} /><p>반도체 비중이 {semiconductorRatio}%인 현재 구성에서는 업종 조정이 {goal} 목표자금 변동으로 빠르게 전달됩니다.</p></div>
                    </section>

                    <section className="card bias-card">
                      <div className="card-heading"><div><span>03 · BEHAVIOR CHECK</span><h2>지금 작동하기 쉬운 판단 편향</h2></div><BrainCircuit size={20} /></div>
                      <div className="bias-primary"><span>주의 편향</span><strong>과신 · 최근성 편향</strong><p>최근 반도체 상승과 긍정적 뉴스가 앞으로도 그대로 이어질 가능성을 실제보다 크게 느낄 수 있습니다.</p></div>
                      <ul><li><Check size={15} /> 기대수익보다 감당 가능한 손실을 먼저 적기</li><li><Check size={15} /> 목표 시점과 무관한 단기 뉴스는 분리하기</li><li><Check size={15} /> 매수 전 하단 경로의 행동 기준 정하기</li></ul>
                    </section>

                    <section className="card next-action-card">
                      <div className="card-heading"><div><span>04 · NEXT QUESTION</span><h2>결정 전에 확인할 질문</h2></div><Landmark size={20} /></div>
                      <blockquote>“수익 기회를 놓칠까 두려운가요, 아니면 {goal}을 지키는 기준이 있나요?”</blockquote>
                      <div className="decision-checks"><div><span>목표 기준</span><strong>{goalMonths}개월 안에 쓸 자금은 변동성에서 분리했는가</strong></div><div><span>실행 기준</span><strong>하단 경로 도달 시 무엇을 할지 미리 정했는가</strong></div></div>
                      <button onClick={() => activateTab("insight")}>다른 시장 환경 시뮬레이션 <ArrowRight size={16} /></button>
                    </section>
                  </div>
                </>
              )}
            </div>
          )}

          <footer>
            <div><span className="brand-mark small">F</span><strong>FINVERSE</strong></div>
            <p>불확실성을 이해하고 더 나은 금융 판단을 연습하는 AI 시뮬레이션</p>
            <span>2026 금융 AI Challenge MVP</span>
          </footer>
        </main>
      </div>

      <nav className="mobile-tabs" aria-label="모바일 주요 메뉴">
        <button className={activeTab === "graph" ? "active" : ""} onClick={() => activateTab("graph")}><Network size={18} /><span>시장 인사이트</span></button>
        <button className={activeTab === "insight" ? "active" : ""} onClick={() => activateTab("insight")}><LineChart size={18} /><span>시장 인사이트(예비)</span></button>
        <button className={activeTab === "twin" ? "active" : ""} onClick={() => activateTab("twin")}><UserRound size={18} /><span>마이 금융 트윈</span></button>
      </nav>

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setProfileOpen(false)}>
          <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><span>MY FINANCIAL TWIN</span><h2 id="profile-modal-title">내 가상 금융 상태</h2><p>실제 계좌정보 없이 대략적인 상태만 입력합니다.</p></div><button onClick={() => setProfileOpen(false)} aria-label="닫기"><X size={19} /></button></div>
            <div className="profile-form">
              <label><span>투자 성향</span><select value={riskStyle} onChange={(event) => setRiskStyle(event.target.value)}><option>안정형</option><option>균형형</option><option>성장형</option></select></label>
              <label><span>가장 중요한 금융 목표</span><select value={goal} onChange={(event) => setGoal(event.target.value)}><option>비상금</option><option>전세자금</option><option>주택 마련</option><option>학자금 상환</option></select></label>
              <label className="range-label"><span>반도체·성장주 비중 <strong>{semiconductorRatio}%</strong></span><input type="range" min="0" max="80" step="2" value={semiconductorRatio} onChange={(event) => setSemiconductorRatio(Number(event.target.value))} /><small><span>0%</span><span>80%</span></small></label>
              <label className="range-label"><span>목표까지 남은 기간 <strong>{goalMonths}개월</strong></span><input type="range" min="6" max="84" step="6" value={goalMonths} onChange={(event) => setGoalMonths(Number(event.target.value))} /><small><span>6개월</span><span>84개월</span></small></label>
            </div>
            <div className="modal-notice"><LockKeyhole size={17} /><p>입력값은 이 MVP 화면에서만 사용되며 실제 금융계좌와 연결되지 않습니다.</p></div>
            <button className="modal-submit" onClick={() => setProfileOpen(false)}><Check size={17} /> 내 상태 적용하기</button>
          </section>
        </div>
      )}
    </div>
  );
}
