"use client";

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CandlestickChart,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Landmark,
  LoaderCircle,
  MessageSquare,
  Radio,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

/* ---------------------------------------------------------------- types */

export type Security = { ticker: string; name: string; share_type?: string; listed_on?: string };

const RECOMMENDED_SECURITIES: Security[] = [
  { ticker: "005930", name: "삼성전자" },
  { ticker: "000660", name: "SK하이닉스" },
];

type Portfolio = {
  cash: number;
  quantity: number;
  average_price: number;
  market_value: number;
  equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_return_pct: number;
  mark_price: number;
};

type LeadSignal = {
  signal_id: string;
  sequence: number;
  release_date: string;
  channel: string;
  audience: string;
  reliability: number;
  content: string;
};

type ScenarioEvent = {
  event_id: string;
  sequence: number;
  status: "hidden" | "revealed" | "public" | "absorbed";
  event_date: string;
  pre_brief?: string;
  trading_days_until?: number;
  title?: string;
  description?: string;
  public_signal?: string;
  event_type?: "momentum" | "seasonal" | "surprise";
  is_simulated?: boolean;
  analogue_title?: string;
  released_signals?: LeadSignal[];
  ontology_source?: OntologySource;
};

// 이벤트가 어디서 왔는지. 실제로 있었던 일이라는 근거를 화면에 남기기 위한 것.
type OntologySource = {
  origin?: "macro" | "micro";
  series_name?: string;
  observed_change?: number;
  observed_value?: number;
  headline?: string;
  publisher?: string;
  url?: string | null;
  event_types?: string[];
  scope?: string;
  original_date?: string;
  original_title?: string;
};

type EventProvenance = {
  mode?: string;
  sector?: string | null;
  macro_candidates?: number;
  micro_candidates?: number;
  global_observations?: number;
  event_source_window?: [string, string];
};

type PricePoint = {
  step: number;
  label: string;
  phase: string;
  price: number;
  market_date?: string;
  return_pct?: number;
  // 백엔드가 라운드 종가에서 되살린 일봉. 구버전 게임에는 없을 수 있다.
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

type HistoryCandle = {
  market_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  real?: boolean;
};

type CollectionSource = {
  key: "market" | "economy" | "events" | "community";
  label: string;
  status: "ready" | "missing";
  count: number;
  unit: string;
  updated_at: string | null;
  detail: string;
};

type InitialContextAnalysis = {
  summary: string;
  summary_points: string[];
  market: { trend?: string; assessment?: string; signals?: string[] };
  economy: { condition?: string; assessment?: string; signals?: string[] };
  events: { assessment?: string; themes?: string[]; signals?: string[] };
  community: { sentiment?: string; assessment?: string; signals?: string[] };
  positive_factors: string[];
  risk_factors: string[];
  tensions: string[];
  uncertainties: string[];
  watch_points: string[];
  event_sequence: {
    date: string;
    title: string;
    description: string;
    domain: string;
    market_reaction: string;
    basis: "observed" | "inferred";
  }[];
};

type InitialContextSourceSummary = {
  market_days: number;
  macro_observations: number;
  events: number;
  community_days: number;
  community_comment_count?: number;
  as_of?: { latest_market_date?: string | null };
  document_previews?: Record<string, string>;
};

type InitialContext = {
  context_id: string;
  cached: boolean;
  analysis: InitialContextAnalysis;
  source_summary: InitialContextSourceSummary;
};

type InitialContextDocuments = {
  context_id: string;
  schema_version: string;
  source_summary: InitialContextSourceSummary;
  document_contents?: Record<string, string>;
};

export function PaperEvidenceMarkdown({ content }: { content: string }) {
  const inline = (value: string): ReactNode => value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return part;
  });
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const isTableDivider = (value: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(value);
  const tableCells = (value: string) => value.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  let index = 0;
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
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { blocks.push(<hr key={`rule-${index}`} />); index += 1; continue; }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quote.map((item, quoteIndex) => <p key={quoteIndex}>{inline(item)}</p>)}</blockquote>);
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
  return <div className="evidence-markdown paper-evidence-markdown">{blocks}</div>;
}

type AgentProfileGroup = {
  key: "retail" | "foreign" | "institution" | "pension";
  label: string;
  count: number;
  description: string;
  strategies: string[];
  average_risk_tolerance: number;
  activity_frequency: string;
  market_impact_tier: string;
};

type AgentProfiles = {
  context_id: string;
  schema_version: string;
  profile_count: number;
  cached: boolean;
  groups: AgentProfileGroup[];
};

type AgentProfileDetail = {
  persona_id: string;
  group: AgentProfileGroup["key"];
  group_label: string;
  role_description: string;
  risk_tolerance: number;
  profile: {
    display_name: string;
    investment_thesis: string;
    focus_signals: string[];
    bias: string;
    holding_horizon: string;
    event_response: string;
    risk_rule: string;
    initial_stance: "bullish" | "bearish" | "neutral" | "mixed";
  };
};

type AgentProfileGroupDetails = {
  group: AgentProfileGroup["key"];
  label: string;
  profiles: AgentProfileDetail[];
};

type ContextDocumentProgress = { key: "market" | "economy" | "events" | "community"; label: string; file: string; status: "waiting" | "generating" | "ready" };

const INITIAL_CONTEXT_DOCUMENTS: ContextDocumentProgress[] = [
  { key: "market", label: "시장", file: "market-evidence.md", status: "waiting" },
  { key: "economy", label: "경제", file: "economic-evidence.md", status: "waiting" },
  { key: "events", label: "사건", file: "external-event-evidence.md", status: "waiting" },
  { key: "community", label: "커뮤니티", file: "community-evidence.md", status: "waiting" },
];
const CONTEXT_DOCUMENT_STEP_MS = 1_000;
const CONTEXT_ANALYSIS_MIN_MS = 1_500;

type Observation = {
  investor_group: string;
  platform: string;
  sentiment: number;
  content: string;
};

type PersonaOrder = {
  persona_id: string;
  group: string;
  strategy?: string;
  side: "BUY" | "SELL" | "HOLD";
  quantity: number;
  fill_price?: number;
  notional?: number;
  rationale?: string;
  filled_quantity?: number;
};

type DailyMarketSummaryDetail = {
  summary: string;
  group_actions?: Record<string, string>;
  price_reason?: string;
  uncertainties?: string[];
  source?: string;
};

type GroupState = { sentiment: number; risk_aversion: number; event_conviction?: number };

type AgentRound = {
  round_id: string;
  phase: string;
  label: string;
  market_date?: string;
  previous_price: number;
  price: number;
  return_pct: number;
  buy_notional: number;
  sell_notional: number;
  order_imbalance: number;
  market_pressure: number;
  market_summary?: string;
  market_summary_detail?: DailyMarketSummaryDetail;
  observations?: Observation[];
  persona_orders?: PersonaOrder[];
  risk_flags?: string[];
  psychology?: {
    aggregate_sentiment: number;
    event_impulse?: number;
    groups?: Record<string, GroupState>;
  };
};

type Fill = {
  order_id?: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  phase?: string;
  event_id?: string;
  rationale?: string;
  confidence?: number | null;
  realized_pnl?: number;
  market_date?: string;
  gross_amount?: number;
};

type DailyPerformance = {
  market_date: string;
  mark_price: number;
  cash: number;
  quantity: number;
  market_value: number;
  equity: number;
  daily_pnl: number;
  total_return_pct: number;
};

type PendingOrder = {
  order_id: string;
  side: "BUY" | "SELL";
  quantity: number;
  status: string;
  rationale?: string;
  confidence?: number | null;
};

type LlmReport = {
  report_markdown?: string;
  investor_type?: "anchor" | "adapter" | "defender" | "chaser";
  summary?: string;
  daily_action_review?: { date?: string; action?: string; result?: string }[];
  behavior_pattern?: string;
  strengths?: string[];
  risk_patterns?: string[];
  next_practice?: string[];
  environment_evolution?: string;
  event_reviews?: { date?: string; event?: string; impact?: string }[];
  stock_flow?: string;
  group_behavior?: Record<string, string>;
  key_turning_points?: string[];
  verified_metrics?: { total_return_pct?: number; trade_count?: number; daily_reflection_count?: number; max_price_drawdown_pct?: number };
  portfolio_at_end?: Portfolio;
  initial_equity?: number;
};

type LlmReports = { investment?: LlmReport; scenario?: LlmReport };

const INVESTOR_TYPE_META: Record<NonNullable<LlmReport["investor_type"]>, { label: string; image: string }> = {
  anchor: { label: "원칙형 · The Anchor", image: "/investor-types/anchor.png" },
  adapter: { label: "전략형 · The Adapter", image: "/investor-types/adapter.png" },
  defender: { label: "고집 반응형 · The Defender", image: "/investor-types/defender.png" },
  chaser: { label: "추격형 · The Chaser", image: "/investor-types/chaser.png" },
};

function inferInvestorType(report?: LlmReport): NonNullable<LlmReport["investor_type"]> | null {
  if (report?.investor_type && INVESTOR_TYPE_META[report.investor_type]) return report.investor_type;
  const text = `${report?.report_markdown ?? ""} ${report?.behavior_pattern ?? ""} ${report?.summary ?? ""}`;
  if (/The Anchor|원칙형/i.test(text)) return "anchor";
  if (/The Adapter|전략형|적응형/i.test(text)) return "adapter";
  if (/The Defender|고집 반응형/i.test(text)) return "defender";
  if (/The Chaser|추격형/i.test(text)) return "chaser";
  return null;
}

type Phase = "inter_event_market" | "pre_event_decision" | "post_event_decision" | "world_market" | "world_decision" | "completed";

type ScenarioGame = {
  game_id: string;
  mode?: "scenario" | "world";
  ticker: string;
  name: string;
  phase: Phase;
  status: string;
  current_price: number;
  initial_reference_price: number;
  current_event: ScenarioEvent | null;
  current_event_index: number;
  current_day_index?: number;
  total_events: number;
  portfolio: Portfolio;
  price_history: PricePoint[];
  pending_orders: PendingOrder[];
  released_signals: LeadSignal[];
  scenario_premise?: string;
  simulation_days?: number;
  investment_mode?: InvestmentMode;
  initial_cash?: number;
  initial_equity?: number;
  data_source?: string;
  last_market_date?: string;
  market_psychology?: { aggregate_sentiment?: number };
  settings?: { fee_rate: number; sell_tax_rate: number; slippage_bps: number };
  event_provenance?: EventProvenance;
  history_candles?: HistoryCandle[];
  agent_rounds?: AgentRound[];
  fills?: Fill[];
  revealed_events?: ScenarioEvent[];
  daily_reflections?: DailyReflection[];
  world?: { memory?: { event_ledger?: ScenarioEvent[] } };
  llm_reports?: LlmReports;
  daily_performance?: DailyPerformance[];
};

type DailyReflection = {
  market_date: string;
  event_id?: string | null;
  stance: "BUY_WATCH" | "HOLD_WATCH" | "SELL_WATCH";
  label: string;
  quantity?: number;
  order_side?: "BUY" | "SELL" | null;
  order_id?: string | null;
  market_return_pct?: number;
  market_summary?: string;
  recorded_at?: string;
};

type Job = {
  job_id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  error: string | null;
  updated_at?: string;
};

// 백엔드 작업은 인메모리 스레드풀에서 돈다. 백엔드가 재시작되면 파일에 남은
// 작업 상태는 running 그대로 굳어 UI가 영원히 기다리게 된다. 정상 라운드
// 하나가 수 분 걸리므로 넉넉히 잡되, 이 시간을 넘기면 사용자에게 알린다.
const STALL_NOTICE_MS = 8 * 60 * 1000;

/* -------------------------------------------------------------- helpers */

const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const compactWon = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}억`;
  if (abs >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  return Math.round(value).toLocaleString("ko-KR");
};
const signedPct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
// 백엔드 round_to_krx_tick과 같은 규칙. 체결 예상가를 실제 체결가와 맞춘다.
const krxTick = (price: number) =>
  price < 2000 ? 1 : price < 5000 ? 5 : price < 20000 ? 10
    : price < 50000 ? 50 : price < 200000 ? 100 : price < 500000 ? 500 : 1000;
const toKrxTick = (price: number) => {
  const value = Math.max(1, price);
  const tick = krxTick(value);
  return Math.max(tick, Math.round(value / tick) * tick);
};
// 국내 시장 관례를 따라 상승은 빨강, 하락은 파랑으로 표시한다.
const toneOf = (value: number) => (value > 0 ? "up" : value < 0 ? "down" : "flat");

const GROUP_LABEL: Record<string, string> = {
  retail: "개인", foreign: "외국인", institution: "기관", pension: "연기금",
};
const AGENT_GROUPS = [
  { key: "retail", label: "개인" },
  { key: "foreign", label: "외국인" },
  { key: "institution", label: "기관" },
  { key: "pension", label: "연기금" },
] as const;
const PLATFORM_LABEL: Record<string, string> = { reddit: "커뮤니티", x: "X" };

const PHASE_META: Record<Phase, {
  label: string;
  eyebrow: string;
  action: "advance_days" | "reveal" | "continue" | "advance" | "resolve" | "report";
  cta: string;
  guide: string;
  todo: string[];
  canOrder: boolean;
}> = {
  inter_event_market: {
    label: "자율 거래 구간",
    eyebrow: "INTER-EVENT MARKET",
    action: "advance_days",
    cta: "다음 거래일 진행",
    guide: "에이전트들이 사전 신호만 보고 스스로 거래합니다. 지금은 주문을 낼 수 없고, 흘러나오는 신호를 읽는 것이 과제입니다.",
    todo: [
      "*다음 거래일 진행*으로 한 거래일씩 넘기며 반응을 확인합니다.",
      "하루가 지날 때마다 캔들이 쌓이고, 59명의 에이전트 반응이 오른쪽 피드에 올라옵니다.",
      "이 구간은 관찰 전용입니다. 누가 사고 누가 파는지 보고 다음 판단의 근거를 모으세요.",
    ],
    canOrder: false,
  },
  pre_event_decision: {
    label: "이벤트 전 판단",
    eyebrow: "PRE-EVENT DECISION",
    action: "reveal",
    cta: "주문 확정하고 이벤트 공개",
    guide: "이벤트 내용은 아직 비공개입니다. 지금까지의 신호만으로 포지션을 정하세요.",
    todo: [
      "이벤트 내용은 *아직 비공개*입니다. 지금까지 나온 신호만으로 판단하세요.",
      "주문 티켓에서 매수·매도 수량을 담습니다. 담지 않으면 *관망*으로 기록됩니다.",
      "*이벤트 공개* 버튼을 누르면 담아둔 주문이 체결된 뒤 결과가 드러납니다.",
    ],
    canOrder: true,
  },
  post_event_decision: {
    label: "이벤트 후 대응",
    eyebrow: "POST-EVENT DECISION",
    action: "continue",
    cta: "대응 확정하고 다음 이벤트로",
    guide: "이벤트가 공개되고 시장이 1차 반응했습니다. 과잉 반응인지 추세의 시작인지 판단해 대응하세요.",
    todo: [
      "이벤트가 공개되고 시장이 *1차 반응*을 마쳤습니다. 캔들과 피드에서 반응 강도를 확인하세요.",
      "과잉 반응이면 되돌림을, 추세의 시작이면 추격을 노려 추가 주문을 담습니다.",
      "*다음 이벤트로* 버튼을 누르면 체결 후 다음 구간이 시작됩니다.",
    ],
    canOrder: true,
  },
  world_market: {
    label: "다음 거래일 준비",
    eyebrow: "WORLD AGENT MARKET",
    action: "advance",
    cta: "다음 거래일 진행",
    guide: "World Agent가 초기 맥락과 직전 시장 반응을 기억해 다음 거래일의 공개 환경을 엽니다. 중대 사건이 나오면 사용자 판단을 먼저 기다립니다.",
    todo: [
      "다음 거래일을 열면 World Agent가 외부 환경을 갱신합니다.",
      "59명의 개별 에이전트는 같은 공개 정보와 각자의 기억으로 독립 판단합니다.",
      "중요 사건이 발생하면 시장 반응 전에 내 판단을 기록하는 화면이 열립니다.",
    ],
    canOrder: false,
  },
  world_decision: {
    label: "중요 사건 판단",
    eyebrow: "WORLD EVENT DECISION",
    action: "resolve",
    cta: "판단 반영하고 시장 진행",
    guide: "중요 사건이 공개됐습니다. 같은 공개 정보를 확인하고 세 가지 방향성 중 하나를 선택하면 시장이 진행됩니다.",
    todo: [
      "공개된 사건과 과거 유사 사례의 관계를 확인합니다.",
      "매수 고려·관찰 계속·매도 고려 중 하나를 선택합니다. 매수·매도 시 개인 계좌에 반영할 수량을 입력합니다.",
      "선택한 판단은 학습 기록으로 남고, 59개 에이전트의 반응과 시장 결과가 이어집니다.",
    ],
    canOrder: false,
  },
  completed: {
    label: "시나리오 종료",
    eyebrow: "SCENARIO COMPLETE",
    action: "report",
    cta: "AI 투자 리포트 생성",
    guide: "모든 이벤트가 끝났습니다. 매일 남긴 방향성 판단과 시장 결과를 묶어 교육용 리포트를 만들 수 있습니다.",
    todo: [
      "모든 이벤트가 끝났습니다. 최종 수익률과 캔들 전체 경로를 확인하세요.",
      "*AI 투자 리포트 생성*을 누르면 매일의 판단과 결과를 묶어 회고를 만듭니다.",
    ],
    canOrder: false,
  },
};

async function callApi<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/paper-trading${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success === false) {
    throw new Error(payload?.error ?? "요청을 처리하지 못했습니다.");
  }
  return payload as T;
}

/* ----------------------------------------------------------- candlestick */

type Bar = {
  key: string;
  date: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  real: boolean;
  event: boolean;
  returnPct: number;
};

const CHART_W = 760;
const AXIS_W = 52;
const PRICE_H = 210;

/** 실제 이력 봉과 시뮬레이션 봉을 하나의 시계열로 합친다. */
type CandleChartData = Pick<ScenarioGame, "history_candles" | "price_history" | "initial_reference_price" | "revealed_events" | "fills" | "daily_reflections" | "simulation_days">;

function buildBars(game: CandleChartData, preview = false): Bar[] {
  const history: Bar[] = [];
  const simulation: Bar[] = [];
  const seen = new Set<string>();
  const eventDates = new Set((game.revealed_events ?? []).map((event) => event.event_date).filter(Boolean));

  for (const row of game.history_candles ?? []) {
    if (!row.close || seen.has(row.market_date)) continue;
    seen.add(row.market_date);
    history.push({
      key: `real-${row.market_date}`,
      date: row.market_date,
      label: "시나리오 이전 실제 이력",
      open: row.open, high: row.high, low: row.low, close: row.close,
      volume: row.volume ?? 0, real: true, event: false, returnPct: 0,
    });
  }

  for (const point of game.price_history ?? []) {
    // price_history의 0일차는 실제 이력 끝값을 다시 담는 기준점이다.
    // 실제 봉이 있는 화면에서는 별도 봉으로 그리지 않아 경계선에 겹치지 않게 한다.
    if (point.step === 0 && history.length > 0) continue;
    const close = point.close ?? point.price;
    if (!close) continue;
    // 시작 봉은 실제 이력의 마지막 날과 같은 날짜다. 두 번 그리지 않는다.
    if (point.step === 0 && seen.has(point.market_date ?? "")) continue;
    simulation.push({
      key: `sim-${point.step}`,
      date: point.market_date ?? "",
      label: point.label,
      open: point.open ?? close,
      high: point.high ?? close,
      low: point.low ?? close,
      close,
      volume: point.volume ?? 0,
      real: point.step === 0,
      // World 모드에서는 공개된 사건 원장과 반응 라운드가 분리될 수 있다.
      // 어느 한쪽만 있어도 같은 거래일 캔들에 공개일 마커를 남긴다.
      event: point.phase === "event_reaction" || eventDates.has(point.market_date ?? ""),
      returnPct: point.return_pct ?? 0,
    });
  }

  if (preview) return [...history, ...simulation].slice(-20);

  // 실제 이력은 방향을 읽을 수 있는 만큼만 남기고, 선택한 연습 기간은 오른쪽의
  // 빈 슬롯으로 확보한다. 진행될 때마다 그 슬롯이 시뮬레이션 캔들로 채워진다.
  // 실제 이력은 항상 최근 10거래일만 보여준다. 시뮬레이션 전체 기간은
  // 잘라내지 않고 남겨 두어, 20개 슬롯을 넘으면 가로 스크롤로 확인한다.
  return [...history.slice(-10), ...simulation];
}

function CandleChart({ game, preview = false }: { game: CandleChartData; preview?: boolean }) {
  const bars = useMemo(() => buildBars(game, preview), [game, preview]);
  const [hovered, setHovered] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => {
    if (bars.length < 2) return null;
    const reference = game.initial_reference_price;
    const rawTop = Math.max(...bars.map((bar) => bar.high), reference);
    const rawBottom = Math.min(...bars.map((bar) => bar.low), reference);
    const pad = (rawTop - rawBottom) * 0.12 || Math.max(rawTop * 0.01, 1);
    const top = rawTop + pad;
    const bottom = Math.max(rawBottom - pad, 0);
    const span = top - bottom || 1;
    const simStart = bars.findIndex((bar) => !bar.real);
    const historicalCount = simStart < 0 ? bars.length : simStart;
    const simulatedCount = bars.length - historicalCount;
    const futureSlots = preview ? 0 : Math.max(0, (game.simulation_days ?? 20) - simulatedCount);
    // 실행 차트는 실제 이력 10거래일과 선택한 전체 연습 기간을 하나의 폭에
    // 나눠 그린다. 예를 들어 10일 연습은 과거 10일 : 미래 10일이 1:1이며,
    // 20일 연습도 미래 슬롯 20개가 스크롤 없이 항상 모두 보인다.
    const totalSlots = preview ? Math.max(1, bars.length) : Math.max(1, historicalCount + (game.simulation_days ?? 20));
    const leadingSlots = 0;
    const slot = (CHART_W - AXIS_W) / totalSlots;
    const chartWidth = CHART_W;
    return {
      top, bottom, span, slot, chartWidth, leadingSlots,
      bodyW: Math.max(2, Math.min(13, slot * 0.6)),
      simStart: historicalCount,
      simulatedCount,
      futureSlots,
      remainingSimulationDays: Math.max(0, (game.simulation_days ?? 20) - simulatedCount),
      y: (value: number) => ((top - value) / span) * PRICE_H,
      cx: (index: number) => (leadingSlots + index) * slot + slot / 2,
    };
  }, [bars, game.initial_reference_price, game.simulation_days, preview]);

  useEffect(() => {
    if (preview || !scrollRef.current || !layout) return;
    const container = scrollRef.current;
    // 패널 폭보다 차트가 넓은 화면에서는 새 거래일마다 한 슬롯만큼 최신
    // 캔들을 따라간다. 아직 진행되지 않은 미래 구간 때문에 마지막 봉이
    // 화면 밖에 고정되는 일을 막는다.
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const target = Math.min(maxScroll, Math.max(0, layout.simulatedCount - 1) * layout.slot);
    if (Math.abs(container.scrollLeft - target) < 1) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ left: target, behavior: reduceMotion ? "auto" : "smooth" });
  }, [layout?.simulatedCount, layout?.slot, preview]);

  if (!layout) {
    return (
      <div className="paper-chart-empty">
        <CandlestickChart size={22} />
        <strong>아직 열린 장이 없습니다</strong>
        <p>오른쪽 아래 진행 버튼을 누르면 하루씩 장이 열리고 캔들이 쌓입니다.</p>
      </div>
    );
  }

  const { top, span, slot, chartWidth, bodyW, simStart, futureSlots, remainingSimulationDays, leadingSlots, y, cx } = layout;
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => top - span * ratio);

  // 주문·체결 기록의 시장일을 기준으로 표시한다. 이벤트 순서로 역추적하면
  // 일반 거래일 주문이 마지막 이벤트 봉에 붙는 문제가 생긴다.
  const fillMarkers = (game.fills ?? []).flatMap((fill, index) => {
    const barIndex = bars.findIndex((bar) => !bar.real && bar.date === fill.market_date);
    if (barIndex < 0) return [];
    return [{
      key: fill.order_id ?? `fill-${index}`,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      x: cx(barIndex) + (fill.phase === "pre_event_decision" ? -bodyW : bodyW),
      y: y(fill.price),
      title: `내 ${fill.side === "BUY" ? "매수" : "매도"} ${fill.quantity.toLocaleString("ko-KR")}주 · ${won(fill.price)}${fill.market_date ? ` · ${fill.market_date}` : ""}`,
    }];
  });
  const reflectionMarkers = (game.daily_reflections ?? [])
    .filter((reflection) => reflection.stance !== "HOLD_WATCH")
    .flatMap((reflection, index) => {
      const barIndex = bars.findIndex((bar) => !bar.real && bar.date === reflection.market_date);
      if (barIndex < 0) return [];
      const side = reflection.stance === "BUY_WATCH" ? "BUY" : "SELL";
      const price = bars[barIndex].close;
      return [{
        key: `reflection-${reflection.market_date}-${index}`,
        side,
        quantity: 0,
        price,
        x: cx(barIndex) + (side === "BUY" ? -bodyW : bodyW),
        y: y(price),
        title: `${reflection.label} · ${reflection.market_date}`,
      }];
    });
  const markers = [...fillMarkers, ...reflectionMarkers];

  const active = hovered !== null ? bars[hovered] : bars[bars.length - 1];

  return (
    <div className="paper-chart">
      <div className="paper-chart-readout">
        <strong>{active.date || active.label}</strong>
        <span>시 {active.open.toLocaleString("ko-KR")}</span>
        <span>고 {active.high.toLocaleString("ko-KR")}</span>
        <span>저 {active.low.toLocaleString("ko-KR")}</span>
        <span>종 <b className={toneOf(active.close - active.open)}>{active.close.toLocaleString("ko-KR")}</b></span>
        {!active.real && <em className={toneOf(active.returnPct)}>{signedPct(active.returnPct)}</em>}
      </div>

      <div className="paper-chart-scroll" ref={scrollRef}>
        <svg
          className="paper-chart-svg"
          style={{ width: `${chartWidth}px` }}
          viewBox={`0 0 ${chartWidth} ${PRICE_H + 22}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={preview ? "최근 실제 캔들 차트" : "시나리오 캔들 차트"}
          onMouseLeave={() => setHovered(null)}
        >
        {gridValues.map((value) => (
          <g key={value}>
            <line className="paper-chart-grid" x1={0} y1={y(value)} x2={chartWidth - AXIS_W} y2={y(value)} />
            <text className="paper-chart-axis" x={chartWidth - AXIS_W + 6} y={y(value) + 3}>
              {Math.round(value).toLocaleString("ko-KR")}
            </text>
          </g>
        ))}

        {!preview && (
          <line
            className="paper-chart-reference"
            x1={0} x2={chartWidth - AXIS_W}
            y1={y(game.initial_reference_price)} y2={y(game.initial_reference_price)}
          />
        )}

        {!preview && simStart > 0 && (
          <g>
            <line
              className="paper-chart-divider"
              x1={cx(simStart) - slot / 2} x2={cx(simStart) - slot / 2}
              y1={0} y2={PRICE_H + 6}
            />
            <text className="paper-chart-start-label" x={cx(simStart) - slot / 2 + 5} y={11}>
              시뮬레이션 시작
            </text>
          </g>
        )}

        {!preview && futureSlots > 0 && (
          <g className="paper-candle-future-block">
            <rect
              className="paper-candle-future"
              x={(leadingSlots + bars.length) * slot + 1}
              y={8}
              width={Math.max(1, futureSlots * slot - 2)}
              height={PRICE_H - 3}
            />
          </g>
        )}

        {bars.map((bar, index) => {
          const rising = bar.close >= bar.open;
          const flat = bar.high === bar.low && bar.open === bar.close;
          const bodyTop = y(Math.max(bar.open, bar.close));
          const bodyHeight = Math.max(1.4, Math.abs(y(bar.open) - y(bar.close)));
          const tone = rising ? "up" : "down";
          return (
            <g key={bar.key} className={`paper-candle ${tone} ${bar.real ? "historical" : "simulated"} ${hovered === index ? "hovered" : ""}`}>
              {flat
                // 캐시 이력은 종가만 있어 봉을 그릴 수 없다. 종가선으로 표시한다.
                ? <line className="paper-candle-flat" x1={cx(index) - bodyW / 2} x2={cx(index) + bodyW / 2} y1={y(bar.close)} y2={y(bar.close)} />
                : (
                  <>
                    <line className="paper-candle-wick" x1={cx(index)} x2={cx(index)} y1={y(bar.high)} y2={y(bar.low)} />
                    <rect className="paper-candle-body" x={cx(index) - bodyW / 2} y={bodyTop} width={bodyW} height={bodyHeight} />
                  </>
                )}
              <rect
                className="paper-candle-hit"
                x={(leadingSlots + index) * slot} y={0} width={slot} height={PRICE_H + 12}
                onMouseEnter={() => setHovered(index)}
              />
            </g>
          );
        })}

        {!preview && bars.map((bar, index) => bar.event ? (
          <g key={`event-${bar.key}`} className="paper-event-marker">
            <title>{`${bar.date} · 이벤트 공개일`}</title>
            <line x1={cx(index)} x2={cx(index)} y1={8} y2={PRICE_H - 2} />
            <circle cx={cx(index)} cy={12} r={4} />
          </g>
        ) : null)}

        {markers.map((marker) => (
          <g key={marker.key} className={`paper-fill-marker ${marker.side === "BUY" ? "buy" : "sell"}`}>
            <title>{marker.title}</title>
            <path d={marker.side === "BUY"
              ? `M ${marker.x} ${marker.y - 7} l 5 8 l -10 0 z`
              : `M ${marker.x} ${marker.y + 7} l 5 -8 l -10 0 z`} />
          </g>
        ))}
        </svg>
      </div>

      <div className="paper-chart-dates">
        <span>{bars[0].date}</span>
        {simStart > 0 && <span>{bars[simStart]?.date}</span>}
        <span>{preview ? bars[bars.length - 1].date : remainingSimulationDays ? `남은 ${remainingSimulationDays}거래일` : "연습 완료"}</span>
      </div>

      <div className="paper-chart-legend">
        {preview ? (
          <><span className="up">양봉</span><span className="down">음봉</span></>
        ) : (
          <><span className="real">실제 이력</span><span className="up">상승 캔들</span><span className="down">하락 캔들</span><span className="future">앞으로의 거래일</span><span className="event">이벤트 공개일</span><span className="buy">내 매수 판단</span><span className="sell">내 매도 판단</span></>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- provenance */

const SERIES_UNIT: Record<string, string> = {
  "한국은행 기준금리": "%p", "국고채3년": "%p", "원달러환율": "원",
  "미국 10년물 국채금리": "%p", "WTI 유가": "달러", "달러 인덱스": "p",
};

/** Where an event came from, so a reader can check it actually happened. */
function EventProvenanceStrip({ source }: { source: OntologySource }) {
  const change = source.observed_change;
  const unit = SERIES_UNIT[source.series_name ?? ""] ?? "";
  return (
    <div className="paper-provenance">
      <div className="paper-provenance-head">
        <Landmark size={12} />
        <span>{source.origin === "micro" ? "실제 종목 뉴스" : "실제 시장 지표"}</span>
        {source.original_date && <em>{source.original_date} 발생</em>}
      </div>
      {source.series_name && typeof change === "number" && (
        <p className="paper-provenance-move">
          <b>{source.series_name}</b>
          <span className={toneOf(change)}>
            {change > 0 ? "+" : ""}{change.toFixed(Math.abs(change) < 1 ? 3 : 2)}{unit}
          </span>
          {typeof source.observed_value === "number" && (
            <em>→ {source.observed_value.toLocaleString("ko-KR")}{unit}</em>
          )}
        </p>
      )}
      {source.headline && <p className="paper-provenance-headline">{source.headline}</p>}
      <footer>
        {source.publisher && <span>{source.publisher}</span>}
        {(source.event_types ?? []).slice(0, 3).map((type) => <span key={type}>{type}</span>)}
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer">원문 <ArrowRight size={10} /></a>
        )}
      </footer>
    </div>
  );
}

const DAILY_STANCES: { key: DailyReflection["stance"]; label: string; description: string }[] = [
  { key: "BUY_WATCH", label: "내일 매수 고려", description: "상승 가능성을 더 확인" },
  { key: "HOLD_WATCH", label: "관찰 계속", description: "지금은 근거를 더 모음" },
  { key: "SELL_WATCH", label: "내일 매도 고려", description: "위험 확대 가능성을 점검" },
];

const DAILY_SUMMARY_GROUPS = [
  ["retail", "개인 투자자"],
  ["foreign", "외국인"],
  ["institution", "기관"],
  ["pension", "연기금"],
] as const;

function DailyPracticeCard({
  round, event, reflection, portfolio, disabled, onSelect,
}: {
  round?: AgentRound;
  event?: ScenarioEvent | null;
  reflection?: DailyReflection;
  portfolio: Portfolio;
  disabled: boolean;
  onSelect: (stance: DailyReflection["stance"], quantity?: number) => Promise<void>;
}) {
  const marketDate = event?.event_date ?? round?.market_date ?? "";
  const [draftStance, setDraftStance] = useState<DailyReflection["stance"]>(reflection?.stance ?? "HOLD_WATCH");
  const [draftQuantity, setDraftQuantity] = useState(reflection?.quantity ? String(reflection.quantity) : "");
  const hasSubmittedOrder = Boolean(reflection?.order_id);

  // 거래일이 바뀔 때만 서버에 저장된 판단으로 초안을 다시 맞춘다.
  // 입력 중인 수량을 prop 갱신으로 덮어쓰지 않으면서 이전 거래일의 수량이
  // 다음 거래일에 남아 의도치 않은 주문으로 기록되는 일을 막는다.
  useEffect(() => {
    setDraftStance(reflection?.stance ?? "HOLD_WATCH");
    setDraftQuantity(reflection?.quantity ? String(reflection.quantity) : "");
  }, [marketDate]);

  if (!round && !event) {
    return (
      <div className="paper-daily-practice waiting">
        <span>오늘의 시장 요약</span>
        <strong>첫 거래일을 열면 그날의 시장 상황과 에이전트 반응을 바탕으로 판단을 남길 수 있습니다.</strong>
      </div>
    );
  }
  const chooseStance = (stance: DailyReflection["stance"]) => {
    setDraftStance(stance);
    if (stance === "HOLD_WATCH") {
      setDraftQuantity("");
      onSelect(stance, 0);
    }
  };
  const submitDecision = async () => {
    const quantity = Number.parseInt(draftQuantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1) return;
    await onSelect(draftStance, quantity);
  };
  return (
    <div className="paper-daily-practice">
      <div className="paper-daily-practice-head">
        <span>{event ? "중요 사건 판단" : "오늘의 시장 요약"}</span>
        <em>{event?.event_date ?? round?.market_date}</em>
      </div>
      {event ? (
        <div className="paper-daily-event">
          <b>{event.title || "공개된 중요 사건"}</b>
          <span>{event.description || event.public_signal || "공개된 사건의 내용을 확인하고 다음 방향을 선택하세요."}</span>
        </div>
      ) : (
        <p>{round?.market_summary_detail?.summary || round?.market_summary || "오늘의 공개 정보와 시장 참여자 반응을 확인하세요."}</p>
      )}
      {!event && round?.market_summary_detail?.group_actions && (
        <div className="paper-daily-summary-groups" aria-label="수급 주체별 오늘의 행동 요약">
          {DAILY_SUMMARY_GROUPS.map(([key, label]) => (
            <div className="paper-daily-summary-group" key={key}>
              <b>{label}</b>
              <span>{round?.market_summary_detail?.group_actions?.[key]}</span>
            </div>
          ))}
        </div>
      )}
      {!event && round?.market_summary_detail?.price_reason && (
        <div className="paper-daily-reason">
          <b>주가 변동 이유 추론</b>
          <span>{round?.market_summary_detail?.price_reason}</span>
        </div>
      )}
      {round && (
        <div className="paper-daily-practice-flow">
          <b className={toneOf(round.return_pct)}>{signedPct(round.return_pct)}</b>
          <span>59개 에이전트 반응 후 형성된 오늘의 종가</span>
        </div>
      )}
      <div className="paper-daily-choices" role="group" aria-label="오늘의 방향성 판단">
        {DAILY_STANCES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${item.key.toLowerCase()} ${draftStance === item.key ? "active" : ""}`}
            onClick={() => chooseStance(item.key)}
            disabled={disabled || hasSubmittedOrder}
          >
            <b>{item.label}</b><span>{item.description}</span>
          </button>
        ))}
      </div>
      {draftStance !== "HOLD_WATCH" && (
        <div className="paper-daily-quantity">
          <label htmlFor="daily-decision-quantity">{draftStance === "BUY_WATCH" ? "다음 거래일 매수 수량" : "다음 거래일 매도 수량"}</label>
          <div>
            <input
              id="daily-decision-quantity"
              type="number"
              min="1"
              step="1"
              value={draftQuantity}
              onChange={(input) => setDraftQuantity(input.target.value)}
              onKeyDown={(input) => {
                if (input.key === "Enter") {
                  input.preventDefault();
                  void submitDecision();
                }
              }}
              placeholder="수량 입력"
              disabled={disabled || hasSubmittedOrder}
            />
            <span>주</span>
            <button
              type="button"
              onClick={() => { void submitDecision(); }}
              disabled={disabled || hasSubmittedOrder || !/^[1-9]\d*$/.test(draftQuantity)}
            >
              판단 기록
            </button>
          </div>
          <small>{draftStance === "BUY_WATCH"
            ? `현재 현금 기준 약 ${Math.floor(portfolio.cash / Math.max(portfolio.mark_price, 1)).toLocaleString("ko-KR")}주까지 가능`
            : `현재 보유 ${portfolio.quantity.toLocaleString("ko-KR")}주까지 가능`}</small>
        </div>
      )}
      <small>{hasSubmittedOrder
        ? "오늘의 매수·매도 판단이 기록되었습니다. 다음 거래일에 내 개인 포트폴리오에만 반영됩니다."
        : "매수·매도는 수량을 입력한 뒤 ‘판단 기록’을 눌러야 저장됩니다. 관찰을 유지하면 매매 없이 기록됩니다."}</small>
    </div>
  );
}

function PortfolioSnapshot({ game, compact = false }: { game: ScenarioGame; compact?: boolean }) {
  const portfolio = game.portfolio;
  const initialEquity = game.initial_equity ?? game.initial_cash ?? portfolio.equity;
  return (
    <div className={`paper-portfolio-summary${compact ? " compact" : ""}`} aria-label="내 투자 상태">
      <div className="paper-portfolio-summary-head">
        <strong>내 투자 상태</strong>
        <span>현재가 {won(portfolio.mark_price)}</span>
      </div>
      <div className="paper-portfolio-grid">
        <div><span>시작 기준</span><strong>{won(initialEquity)}</strong></div>
        <div><span>현재 총자산</span><strong>{won(portfolio.equity)}</strong></div>
        <div><span>현금</span><strong>{won(portfolio.cash)}</strong></div>
        <div><span>보유 평가액</span><strong>{won(portfolio.market_value)}</strong><small>{portfolio.quantity.toLocaleString("ko-KR")}주</small></div>
      </div>
      <div className={`paper-portfolio-return ${toneOf(portfolio.total_return_pct)}`}>
        <span>현재 수익률</span><strong>{signedPct(portfolio.total_return_pct)}</strong>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- reaction feed */

function LegacyEventLog({
  currentEvent,
  revealedEvents,
  worldMode,
}: {
  currentEvent: ScenarioEvent | null;
  revealedEvents?: ScenarioEvent[];
  worldMode: boolean;
}) {
  const events = useMemo(() => {
    const byId = new Map<string, ScenarioEvent>();
    for (const event of revealedEvents ?? []) byId.set(event.event_id, event);
    if (currentEvent) byId.set(currentEvent.event_id, currentEvent);
    return [...byId.values()].sort((left, right) => right.sequence - left.sequence);
  }, [currentEvent, revealedEvents]);

  if (!events.length) return null;

  return (
    <section className="paper-event-log" aria-label="시나리오 이벤트 기록">
      <header>
        <div><CalendarClock size={13} /><strong>이벤트 기록</strong></div>
        <em>{events.length}건</em>
      </header>
      {events.map((event) => {
        const visible = event.status !== "hidden" || worldMode;
        const type = event.event_type === "seasonal" ? "계절성" : event.event_type === "surprise" ? "서프라이즈" : "모멘텀";
        return (
          <article className={`paper-event-card ${event.status}`} key={event.event_id}>
            <div className="paper-event-top">
              <span><CalendarClock size={13} /> 이벤트 {event.sequence}</span>
              <em>{worldMode ? `${event.event_date} · ${type}` : visible ? `${event.event_date} 공개` : `${event.event_date} 예정`}</em>
            </div>
            {visible && event.title
              ? <strong>{event.title}</strong>
              : <strong className="masked">아직 공개되지 않은 이벤트</strong>}
            <p>{visible && event.description ? event.description : event.pre_brief}</p>
            {worldMode && event.public_signal && <div className="paper-provenance pending"><Landmark size={12} /><span>{event.public_signal}</span></div>}
            {worldMode && event.analogue_title && <div className="paper-provenance"><Landmark size={12} /><span>시작 전 실제 유사 사례 기반 · {event.analogue_title}</span></div>}
            {visible && event.ontology_source
              ? <EventProvenanceStrip source={event.ontology_source} />
              : event.ontology_source && (
                  <div className="paper-provenance pending">
                    <Landmark size={12} />
                    <span>실제로 일어난 사건입니다. 내용은 공개 시점에 드러납니다.</span>
                  </div>
                )}
          </article>
        );
      })}
    </section>
  );
}

function LegacyReactionFeed({ game, busy, job }: { game: ScenarioGame; busy: boolean; job: Job | null }) {
  const rounds = useMemo(
    () => [...(game.agent_rounds ?? [])].reverse(), [game.agent_rounds]);
  const signalsByDate = useMemo(() => {
    const map = new Map<string, LeadSignal[]>();
    for (const signal of game.released_signals ?? []) {
      map.set(signal.release_date, [...(map.get(signal.release_date) ?? []), signal]);
    }
    return map;
  }, [game.released_signals]);

  // 라운드가 붙지 않은 신호(첫 장이 열리기 전 공개된 것)는 맨 위에 따로 보여준다.
  const roundDates = new Set(rounds.map((round) => round.market_date ?? ""));
  const orphanSignals = (game.released_signals ?? [])
    .filter((signal) => !roundDates.has(signal.release_date)).reverse();

  if (!rounds.length && !orphanSignals.length && !busy) {
    return (
      <div className="paper-feed-empty">
        <MessageSquare size={22} />
        <strong>아직 시장이 열리지 않았습니다</strong>
        <p>장을 진행하면 59명의 에이전트가 독립적으로 판단한 주문과 그날의 수급이 여기에 쌓입니다.</p>
      </div>
    );
  }

  return (
    <div className="paper-feed">
      {busy && (
        <div className="paper-feed-live">
          <i /><i /><i />
          <span>{job?.message ?? "에이전트들이 오늘 장을 거래하는 중"}</span>
        </div>
      )}

      {orphanSignals.map((signal) => <SignalCard key={signal.signal_id} signal={signal} />)}

      {rounds.map((round) => (
        <article className={`paper-round ${round.phase}`} key={round.round_id}>
          <header>
            <div>
              <span className="paper-round-kind">
                {round.phase === "event_reaction" ? "이벤트 반응" : "자율 거래"}
              </span>
              <strong>{round.market_date || round.label}</strong>
            </div>
            <b className={toneOf(round.return_pct)}>{signedPct(round.return_pct)}</b>
          </header>

          {round.market_summary && <p className="paper-round-summary">{round.market_summary}</p>}

          <div className="paper-round-flows">
            <span className="up">매수 {compactWon(round.buy_notional)}</span>
            <span className="down">매도 {compactWon(round.sell_notional)}</span>
            <span className={toneOf(round.market_pressure)}>
              수급 압력 {signedPct(round.market_pressure * 100)}
            </span>
          </div>

          {(signalsByDate.get(round.market_date ?? "") ?? []).map((signal) => (
            <SignalCard key={signal.signal_id} signal={signal} />
          ))}

          {Boolean(round.observations?.length) && (
            <div className="paper-posts">
              {round.observations?.map((post, index) => (
                <div className={`paper-post ${toneOf(post.sentiment)}`} key={`${round.round_id}-${index}`}>
                  <header>
                    <b>{GROUP_LABEL[post.investor_group] ?? post.investor_group}</b>
                    <span>{PLATFORM_LABEL[post.platform] ?? post.platform}</span>
                    <em>{signedPct(post.sentiment * 100)}</em>
                  </header>
                  <p>{post.content}</p>
                </div>
              ))}
            </div>
          )}

          {Boolean(round.risk_flags?.length) && (
            <ul className="paper-round-risks">
              {round.risk_flags?.map((flag) => <li key={flag}>{flag}</li>)}
            </ul>
          )}

          {Boolean(round.persona_orders?.length) && (
            <details className="paper-round-orders">
              <summary>에이전트 주문 {round.persona_orders?.length}건 보기</summary>
              <div>
                {round.persona_orders?.map((order) => (
                  <div key={order.persona_id} className={order.side === "BUY" ? "up" : order.side === "SELL" ? "down" : "flat"}>
                    <b>{GROUP_LABEL[order.group] ?? order.group}</b>
                    <span>{order.side === "HOLD" ? "관망" : `${order.side === "BUY" ? "매수" : "매도"} ${order.quantity.toLocaleString("ko-KR")}주`}</span>
                    {order.rationale && <p>{order.rationale}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}

function eventTypeLabel(event: ScenarioEvent) {
  return event.event_type === "seasonal" ? "계절성" : event.event_type === "surprise" ? "서프라이즈" : "모멘텀";
}

// 이전 게임 데이터와의 호환을 위해 구현을 남겨 둔다. 새 화면은 아래의
// EventTimeline과 AgentActivityFeed를 사용한다.
void LegacyEventLog;
void LegacyReactionFeed;

function EventTimeline({ game, worldMode }: { game: ScenarioGame; worldMode: boolean }) {
  const events = useMemo(() => {
    const byId = new Map<string, ScenarioEvent>();
    for (const event of game.world?.memory?.event_ledger ?? []) byId.set(event.event_id, event);
    for (const event of game.revealed_events ?? []) byId.set(event.event_id, event);
    if (game.current_event && (worldMode || game.current_event.status !== "hidden")) {
      byId.set(game.current_event.event_id, game.current_event);
    }
    return [...byId.values()].sort((left, right) => right.sequence - left.sequence);
  }, [game.current_event, game.revealed_events, game.world?.memory?.event_ledger, worldMode]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const selectedEvent = events.find((event) => event.event_id === selectedEventId) ?? events[0] ?? null;
  const visible = selectedEvent ? selectedEvent.status !== "hidden" || worldMode : false;

  return (
    <section className="paper-record-column paper-event-column" aria-label="시나리오 이벤트 기록">
      <header className="paper-record-heading">
        <div><CalendarClock size={14} /><strong>이벤트 기록</strong></div>
        <em>{events.length ? events.length + "건 누적" : "발생 전"}</em>
      </header>
      {!events.length ? (
        <div className="paper-record-empty">
          <CalendarClock size={20} />
          <strong>아직 발생한 이벤트가 없습니다</strong>
          <p>시뮬레이션 중 중요한 이벤트가 발생하면 이곳에 계속 쌓입니다.</p>
        </div>
      ) : (
        <>
          <div className="paper-event-timeline">
            {events.map((event) => {
              const eventVisible = event.status !== "hidden" || worldMode;
              return (
                <button
                  className={"paper-event-item " + (event.event_id === selectedEvent?.event_id ? "active" : "")}
                  type="button"
                  key={event.event_id}
                  onClick={() => setSelectedEventId(event.event_id)}
                >
                  <i />
                  <span>
                    <small>{event.event_date} · {eventTypeLabel(event)}</small>
                    <b>{eventVisible && event.title ? event.title : "공개 예정 이벤트"}</b>
                  </span>
                  <ChevronRight size={13} />
                </button>
              );
            })}
          </div>
          {selectedEvent && (
            <article className={"paper-event-detail " + selectedEvent.status}>
              <div className="paper-event-detail-top">
                <span>이벤트 {selectedEvent.sequence}</span>
                <em>{selectedEvent.event_date} · {visible ? "공개" : "예정"}</em>
              </div>
              <h4>{visible && selectedEvent.title ? selectedEvent.title : "아직 공개되지 않은 이벤트"}</h4>
              <p>{visible && selectedEvent.description ? selectedEvent.description : selectedEvent.pre_brief || "발생 시 공개되는 이벤트입니다."}</p>
              {visible && selectedEvent.public_signal && <div className="paper-event-signal"><Landmark size={13} /><span>{selectedEvent.public_signal}</span></div>}
              {selectedEvent.analogue_title && <div className="paper-event-source"><Landmark size={13} /><span>실제 유사 사례 기반 · {selectedEvent.analogue_title}</span></div>}
              {visible && selectedEvent.ontology_source && <EventProvenanceStrip source={selectedEvent.ontology_source} />}
            </article>
          )}
        </>
      )}
    </section>
  );
}

function AgentActivityFeed({ game, busy }: { game: ScenarioGame; busy: boolean }) {
  const rounds = useMemo(() => [...(game.agent_rounds ?? [])].reverse(), [game.agent_rounds]);
  const [selectedGroup, setSelectedGroup] = useState<(typeof AGENT_GROUPS)[number]["key"]>("retail");
  const [expandedRoundId, setExpandedRoundId] = useState<string | null>(null);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const round of rounds) {
      for (const order of round.persona_orders ?? []) {
        if (!counts.has(order.group)) counts.set(order.group, new Set());
        counts.get(order.group)?.add(order.persona_id);
      }
    }
    return counts;
  }, [rounds]);
  const totalAgentCount = [...groupCounts.values()].reduce((sum, ids) => sum + ids.size, 0);

  return (
    <section className="paper-record-column paper-agent-column" aria-label="거래일별 에이전트 활동">
      <header className="paper-record-heading">
        <div><Users size={14} /><strong>에이전트 활동</strong></div>
        <em>{rounds.length ? totalAgentCount + "명 기록" : "거래일 대기"}</em>
      </header>
      <p className="paper-agent-intro">범주를 선택하면 해당 거래일에 그 그룹의 개별 에이전트가 내린 판단을 확인할 수 있습니다.</p>
      <div className="paper-agent-tabs" role="tablist" aria-label="시장 참여자 범주">
        {AGENT_GROUPS.map((group) => (
          <button
            className={selectedGroup === group.key ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={selectedGroup === group.key}
            key={group.key}
            onClick={() => setSelectedGroup(group.key)}
          >
            <span>{group.label}</span><em>{groupCounts.get(group.key)?.size ?? 0}명</em>
          </button>
        ))}
      </div>
      {!rounds.length && !busy ? (
        <div className="paper-record-empty compact">
          <MessageSquare size={20} />
          <strong>아직 거래일 기록이 없습니다</strong>
          <p>하루가 진행되면 4개 범주의 판단이 날짜별로 기록됩니다.</p>
        </div>
      ) : (
        <div className="paper-agent-days">
          {rounds.map((round) => {
            const orders = (round.persona_orders ?? []).filter((order) => order.group === selectedGroup);
            const buyOrders = orders.filter((order) => order.side === "BUY");
            const sellOrders = orders.filter((order) => order.side === "SELL");
            const holdOrders = orders.filter((order) => order.side === "HOLD");
            const buyQuantity = buyOrders.reduce((sum, order) => sum + order.quantity, 0);
            const sellQuantity = sellOrders.reduce((sum, order) => sum + order.quantity, 0);
            const expanded = expandedRoundId === round.round_id;
            return (
              <article className={"paper-agent-day " + (expanded ? "expanded" : "")} key={round.round_id}>
                <button className="paper-agent-day-summary" type="button" aria-expanded={expanded} onClick={() => setExpandedRoundId(expanded ? null : round.round_id)}>
                  <span>
                    <small>{round.phase === "event_reaction" ? "이벤트 반응" : "자율 거래"}</small>
                    <b>{round.market_date || round.label}</b>
                  </span>
                  <span className="paper-agent-day-stats">
                    <em className="up">매수 {buyOrders.length}</em>
                    <em className="down">매도 {sellOrders.length}</em>
                    <em>관망 {holdOrders.length}</em>
                  </span>
                  <ChevronRight size={14} />
                </button>
                {expanded && (
                  <div className="paper-agent-day-body">
                    {round.market_summary && <p className="paper-agent-market-summary">{round.market_summary}</p>}
                    <div className="paper-agent-flow"><span>매수 {buyQuantity.toLocaleString("ko-KR")}주</span><span>매도 {sellQuantity.toLocaleString("ko-KR")}주</span><b className={toneOf(buyQuantity - sellQuantity)}>순 {Math.abs(buyQuantity - sellQuantity).toLocaleString("ko-KR")}주 {buyQuantity >= sellQuantity ? "매수 우위" : "매도 우위"}</b></div>
                    {!orders.length ? <p className="paper-record-empty compact">이 거래일에는 선택한 범주의 기록이 없습니다.</p> : (
                      <div className="paper-agent-order-grid">
                        {orders.map((order) => (
                          <div className={"paper-agent-order " + (order.side === "BUY" ? "up" : order.side === "SELL" ? "down" : "flat")} key={order.persona_id}>
                            <header><b>{order.persona_id}</b><span>{order.strategy ? agentStrategyLabel(order.strategy) : "개별 판단"}</span><em>{order.side === "BUY" ? "매수" : order.side === "SELL" ? "매도" : "관망"}</em></header>
                            <strong>{order.side === "HOLD" ? "포지션 유지" : order.quantity.toLocaleString("ko-KR") + "주"}</strong>
                            {order.fill_price && <small>체결 기준 {order.fill_price.toLocaleString("ko-KR")}원</small>}
                            <p>{order.rationale || "공개 정보와 개인 기억을 바탕으로 판단함"}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SignalCard({ signal }: { signal: LeadSignal }) {
  return (
    <div className="paper-signal">
      <div className="paper-signal-channel">{signal.channel}</div>
      <div className="paper-signal-body">
        <p>{signal.content}</p>
        <footer>
          <time>{signal.release_date}</time>
          <span>신뢰도 {Math.round((signal.reliability ?? 0) * 100)}%</span>
        </footer>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- setup */

type InvestmentMode = "new" | "holding";

const CASH_PRESETS = [10_000_000, 50_000_000, 100_000_000];
const PREVIEW_STEP_MIN_MS = 1_500;
const COLLECTION_STEP_MIN_MS = 1_500;
const AGENT_PROFILE_MIN_MS = 1_500;
const DURATION_OPTIONS = [
  { days: 10, label: "10거래일", caption: "단기 흐름" },
  { days: 20, label: "20거래일", caption: "한 달 연습" },
  { days: 60, label: "60거래일", caption: "중기 판단" },
];
const AGENT_GROUP_ICON = { retail: Users, foreign: TrendingUp, institution: Landmark, pension: Wallet };
const agentStrategyLabel = (value: string) => value.replaceAll("_", " ");
const GROUP_ACTION_LABELS: Record<AgentProfileGroup["key"], string[]> = {
  retail: ["관망", "진입 매수", "추세 추격", "물타기", "비중 축소", "손절"],
  foreign: ["관망", "비중 확대", "매크로 로테이션", "환헤지", "위험 축소", "청산"],
  institution: ["관망", "비중 확대·축소", "리밸런싱", "섹터 로테이션", "ETF 추종", "헤지"],
  pension: ["관망", "장기 비중 조정", "전략 리밸런싱", "변동성 축소", "헤지"],
};

const parsePositiveInteger = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0;

function SetupScreen({
  onStart,
  starting,
  error,
  onClose,
}: {
  onStart: (input: {
    ticker: string; name: string; initialCash: number;
    investmentMode: InvestmentMode; initialPosition?: { quantity: number; averagePrice: number };
    simulationDays: number; initialContextId: string;
  }) => void;
  starting: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Security[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Security | null>(null);
  const [previewCandles, setPreviewCandles] = useState<HistoryCandle[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [collectionSources, setCollectionSources] = useState<CollectionSource[] | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [previewDwellComplete, setPreviewDwellComplete] = useState(false);
  const [collectionDwellComplete, setCollectionDwellComplete] = useState(false);
  const [investmentMode, setInvestmentMode] = useState<InvestmentMode | null>(null);
  const [investmentConfirmed, setInvestmentConfirmed] = useState(false);
  const [initialCash, setInitialCash] = useState(50_000_000);
  const [averagePrice, setAveragePrice] = useState(0);
  const [holdingQuantity, setHoldingQuantity] = useState(0);
  const [simulationDays, setSimulationDays] = useState(10);
  const [initialContext, setInitialContext] = useState<InitialContext | null>(null);
  const [initialContextLoading, setInitialContextLoading] = useState(false);
  const [initialContextError, setInitialContextError] = useState<string | null>(null);
  const [initialContextRetryToken, setInitialContextRetryToken] = useState(0);
  const [initialContextRetrying, setInitialContextRetrying] = useState(false);
  const [contextDocuments, setContextDocuments] = useState<ContextDocumentProgress[]>(INITIAL_CONTEXT_DOCUMENTS);
  const [contextDocumentSource, setContextDocumentSource] = useState<InitialContextDocuments | null>(null);
  const [contextDwellComplete, setContextDwellComplete] = useState(false);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfiles | null>(null);
  const [agentProfileJob, setAgentProfileJob] = useState<Job | null>(null);
  const [agentProfileError, setAgentProfileError] = useState<string | null>(null);
  const [agentProfileRetryToken, setAgentProfileRetryToken] = useState(0);
  const [agentProfileStartedAt, setAgentProfileStartedAt] = useState<number | null>(null);
  const [simulationSetupStage, setSimulationSetupStage] = useState(0);
  const [resettingSetup, setResettingSetup] = useState(false);
  const [resetSetupError, setResetSetupError] = useState<string | null>(null);
  const [selectedContextDocument, setSelectedContextDocument] = useState<{ label: string; content: string } | null>(null);
  const [contextDocumentLoading, setContextDocumentLoading] = useState(false);
  const [selectedAgentGroup, setSelectedAgentGroup] = useState<AgentProfileGroup | null>(null);
  const [agentProfileDetails, setAgentProfileDetails] = useState<AgentProfileGroupDetails | null>(null);
  const [agentProfileDetailsLoading, setAgentProfileDetailsLoading] = useState(false);
  const pickedTicker = picked?.ticker;
  const step2Ref = useRef<HTMLElement | null>(null);
  const step3Ref = useRef<HTMLElement | null>(null);
  const step4Ref = useRef<HTMLElement | null>(null);
  const agentStepRef = useRef<HTMLDivElement | null>(null);
  const readyStepRef = useRef<HTMLElement | null>(null);
  const previewReady = Boolean(previewCandles && previewCandles.length >= 2 && !previewError);
  const previewStepVisible = previewReady && previewDwellComplete;
  const collectionReady = Boolean(collectionSources?.every((source) => source.status === "ready"));
  const collectionStepComplete = collectionReady && collectionDwellComplete;
  const initialContextReady = Boolean(initialContext?.analysis?.summary);
  const agentProfilesReady = Boolean(agentProfiles && agentProfiles.profile_count === 59);
  const initialContextReadyForStart = initialContextReady && contextDwellComplete && agentProfilesReady;
  const openContextDocument = (domain: ContextDocumentProgress["key"]) => {
    if (!pickedTicker) return;
    const document = contextDocuments.find((item) => item.key === domain);
    if (!document) return;
    const preparedContent = contextDocumentSource?.document_contents?.[domain];
    if (preparedContent) {
      setSelectedContextDocument({ label: document.label, content: preparedContent });
      return;
    }
    setContextDocumentLoading(true);
    fetch(`/api/paper-trading/securities/${encodeURIComponent(pickedTicker)}/initial-context/documents/${domain}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("문서를 불러오지 못했습니다.");
        return response.text();
      })
      .then((content) => setSelectedContextDocument({ label: document.label, content }))
      .catch(() => setSelectedContextDocument({ label: document.label, content: "문서를 불러오지 못했습니다." }))
      .finally(() => setContextDocumentLoading(false));
  };
  const openAgentProfileGroup = (group: AgentProfileGroup) => {
    if (!pickedTicker) return;
    setSelectedAgentGroup(group);
    setAgentProfileDetails(null);
    setAgentProfileDetailsLoading(true);
    callApi<{ data: AgentProfileGroupDetails }>(`/securities/${encodeURIComponent(pickedTicker)}/agent-profiles/${group.key}`)
      .then((payload) => setAgentProfileDetails(payload.data))
      .catch(() => setAgentProfileDetails({ group: group.key, label: group.label, profiles: [] }))
      .finally(() => setAgentProfileDetailsLoading(false));
  };
  const investmentReady = investmentMode === "new"
    ? initialCash > 0
    : investmentMode === "holding" && averagePrice > 0 && holdingQuantity > 0;
  const activeStep = investmentConfirmed ? 4 : collectionStepComplete ? 3 : previewStepVisible ? 2 : 1;

  const restartSetup = async () => {
    if (!pickedTicker || resettingSetup) return;
    setResettingSetup(true);
    setResetSetupError(null);
    try {
      await callApi(`/securities/${encodeURIComponent(pickedTicker)}/initial-context/cache`, { method: "DELETE" });
      setInitialContext(null);
      setInitialContextError(null);
      setContextDocumentSource(null);
      setContextDocuments(INITIAL_CONTEXT_DOCUMENTS);
      setContextDwellComplete(false);
      setAgentProfiles(null);
      setAgentProfileJob(null);
      setAgentProfileError(null);
      setAgentProfileStartedAt(null);
      setSimulationSetupStage(0);
      setInvestmentConfirmed(false);
      window.setTimeout(() => step3Ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 180);
    } catch (cause) {
      setResetSetupError(cause instanceof Error ? cause.message : "초기 상황 캐시를 비우지 못했습니다.");
    } finally {
      setResettingSetup(false);
    }
  };

  const retryInitialContext = async () => {
    if (!pickedTicker || initialContextLoading || initialContextRetrying) return;
    setInitialContextRetrying(true);
    setInitialContextError(null);
    setInitialContext(null);
    try {
      await callApi(`/securities/${encodeURIComponent(pickedTicker)}/initial-context/retry`, { method: "POST" });
      setInitialContextRetryToken((token) => token + 1);
    } catch (cause) {
      setInitialContextError(cause instanceof Error ? cause.message : "초기 상황 분석을 다시 실행하지 못했습니다.");
    } finally {
      setInitialContextRetrying(false);
    }
  };

  useEffect(() => {
    const keyword = query.trim();
    if (picked?.name === keyword) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!keyword) {
        return;
      }
      setSearching(true);
      try {
        const payload = await callApi<{ data: Security[] }>(`/securities?q=${encodeURIComponent(keyword)}&limit=8`);
        if (!cancelled) {
          setResults(payload.data ?? []);
          setSearchError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setResults([]);
          setSearchError(cause instanceof Error ? cause.message : "종목을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, picked?.name]);

  useEffect(() => {
    if (!pickedTicker) return;
    let cancelled = false;
    callApi<{ data: { candles: HistoryCandle[] } }>(`/securities/${encodeURIComponent(pickedTicker)}/candles?limit=36`)
      .then((payload) => {
        if (!cancelled) setPreviewCandles(payload.data?.candles ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setPreviewError(cause instanceof Error ? cause.message : "최근 시세를 불러오지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, [pickedTicker]);

  useEffect(() => {
    if (!pickedTicker || !previewReady) return;
    const timer = window.setTimeout(() => {
      setPreviewDwellComplete(true);
    }, PREVIEW_STEP_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [pickedTicker, previewReady]);

  useEffect(() => {
    if (!pickedTicker || !previewStepVisible) return;
    const timer = window.setTimeout(() => {
      setCollectionDwellComplete(true);
    }, COLLECTION_STEP_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [pickedTicker, previewStepVisible]);

  useEffect(() => {
    if (!pickedTicker || !collectionStepComplete || !investmentConfirmed) return;
    let cancelled = false;
    const loadInitialContext = async () => {
      setInitialContextLoading(true);
      setInitialContextError(null);
      setInitialContext(null);
      setContextDocumentSource(null);
      setContextDocuments(INITIAL_CONTEXT_DOCUMENTS.map((document, index) => ({ ...document, status: index === 0 ? "generating" : "waiting" })));
      try {
        const documentsPayload = await callApi<{ data: InitialContextDocuments }>(`/securities/${encodeURIComponent(pickedTicker)}/initial-context/documents`);
        if (cancelled) return;
        setContextDocumentSource(documentsPayload.data);
        for (let index = 0; index < INITIAL_CONTEXT_DOCUMENTS.length; index += 1) {
          if (index > 0) await new Promise((resolve) => window.setTimeout(resolve, CONTEXT_DOCUMENT_STEP_MS));
          if (cancelled) return;
          setContextDocuments(INITIAL_CONTEXT_DOCUMENTS.map((document, documentIndex) => ({
            ...document,
            status: documentIndex <= index ? "ready" : documentIndex === index + 1 ? "generating" : "waiting",
          })));
        }
        // 네 Evidence MD가 화면에 모두 준비된 뒤, 그 문서 묶음만 OpenRouter에 전달한다.
        const analysisStartedAt = Date.now();
        const payload = await callApi<{ data: InitialContext }>(`/securities/${encodeURIComponent(pickedTicker)}/initial-context`);
        if (!payload.data?.analysis?.summary?.trim() || !payload.data.analysis.summary_points?.length) {
          throw new Error("초기 상황 분석 결과가 비어 있습니다.");
        }
        const remaining = Math.max(0, CONTEXT_ANALYSIS_MIN_MS - (Date.now() - analysisStartedAt));
        if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining));
        if (!cancelled) {
          setInitialContext(payload.data);
        }
      } catch (cause) {
        if (!cancelled) setInitialContextError(cause instanceof Error ? cause.message : "초기 상황을 분석하지 못했습니다.");
      } finally {
        if (!cancelled) setInitialContextLoading(false);
      }
    };
    void loadInitialContext();
    return () => { cancelled = true; };
  }, [pickedTicker, collectionStepComplete, investmentConfirmed, initialContextRetryToken]);

  useEffect(() => {
    if (!investmentConfirmed || !initialContextReady) return;
    const timer = window.setTimeout(() => setContextDwellComplete(true), 1_500);
    return () => window.clearTimeout(timer);
  }, [investmentConfirmed, initialContextReady]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSimulationSetupStage(investmentConfirmed ? 1 : 0), 0);
    return () => window.clearTimeout(timer);
  }, [investmentConfirmed]);

  useEffect(() => {
    if (!investmentConfirmed || !contextDwellComplete) return;
    // 초기 상황과 에이전트 완료 효과는 비동기로 교차한다. 이미 다음 단계가 열렸다면
    // 늦게 실행된 이전 단계 효과가 화면을 다시 가리지 않도록 단계는 앞으로만 이동한다.
    const timer = window.setTimeout(() => setSimulationSetupStage((stage) => Math.max(stage, 2)), 0);
    return () => window.clearTimeout(timer);
  }, [investmentConfirmed, contextDwellComplete]);

  useEffect(() => {
    if (!investmentConfirmed || !agentProfilesReady) return;
    // 캐시된 프로필 응답에서도 1.5초의 준비 화면을 유지하되, 이전 렌더에서 시작
    // 시각이 유실돼도 완료 화면이 영구히 막히지 않도록 현재 시각을 안전한 기준으로 쓴다.
    const startedAt = agentProfileStartedAt ?? Date.now();
    const remaining = Math.max(0, AGENT_PROFILE_MIN_MS - (Date.now() - startedAt));
    const timer = window.setTimeout(() => setSimulationSetupStage((stage) => Math.max(stage, 3)), remaining);
    return () => window.clearTimeout(timer);
  }, [investmentConfirmed, agentProfilesReady, agentProfileStartedAt]);

  useEffect(() => {
    if (simulationSetupStage < 2) return;
    const target = simulationSetupStage >= 3 ? readyStepRef.current : agentStepRef.current;
    const timer = window.setTimeout(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }), 220);
    return () => window.clearTimeout(timer);
  }, [simulationSetupStage]);

  useEffect(() => {
    const contextId = initialContext?.context_id;
    if (!pickedTicker || !contextId || !contextDwellComplete || agentProfilesReady) return;
    let cancelled = false;
    const prepare = async () => {
      try {
        // Strict Mode 재실행이나 화면 재진입으로 POST 응답을 놓쳐도, 완료된
        // 프로필 매니페스트를 먼저 읽어 즉시 카드 화면을 복구한다.
        const existing = await callApi<{ data: { status: "missing" | "ready" } & Partial<AgentProfiles> }>(
          `/securities/${encodeURIComponent(pickedTicker)}/agent-profiles`);
        if (cancelled) return;
        setAgentProfileError(null);
        if (existing.data.status === "ready" && existing.data.profile_count === 59) {
          setAgentProfiles(existing.data as AgentProfiles);
          setAgentProfileJob(null);
          return;
        }
        setAgentProfileStartedAt((startedAt) => startedAt ?? Date.now());
        const payload = await callApi<{ data: { status: "ready" | "running"; job?: Job } & AgentProfiles }>(
          `/securities/${encodeURIComponent(pickedTicker)}/agent-profiles/prepare`, { method: "POST" });
        if (cancelled) return;
        if (payload.data.status === "ready") {
          setAgentProfiles(payload.data);
          setAgentProfileJob(null);
        } else {
          setAgentProfileJob(payload.data.job ?? null);
        }
      } catch (cause) {
        if (!cancelled) setAgentProfileError(cause instanceof Error ? cause.message : "시장 참여 에이전트 프로필을 만들지 못했습니다.");
      }
    };
    void prepare();
    return () => { cancelled = true; };
  }, [pickedTicker, initialContext?.context_id, contextDwellComplete, agentProfilesReady, agentProfileRetryToken]);

  useEffect(() => {
    if (!pickedTicker || !agentProfileJob || agentProfileJob.status === "completed" || agentProfileJob.status === "failed") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await callApi<{ data: Job }>(`/scenario-jobs/${agentProfileJob.job_id}`);
        if (cancelled) return;
        const next = payload.data;
        if (next.status === "completed") {
          const ready = await callApi<{ data: { status: "ready" } & AgentProfiles }>(`/securities/${encodeURIComponent(pickedTicker)}/agent-profiles`);
          // 완료 상태를 먼저 반영하면 effect cleanup이 실행되어 같은 턴의
          // 프로필 조회 결과가 취소될 수 있다. 프로필을 먼저 저장한 뒤
          // 작업 상태를 갱신해야 완료 화면이 확실히 열린다.
          if (ready.data.status === "ready") setAgentProfiles(ready.data);
          if (!cancelled) setAgentProfileJob(next);
        } else if (next.status === "failed") {
          setAgentProfileJob(next);
          setAgentProfileError(next.error ?? "시장 참여 에이전트 프로필 생성에 실패했습니다.");
        } else {
          const updatedAt = next.updated_at ? Date.parse(next.updated_at) : 0;
          if (updatedAt && Date.now() - updatedAt > STALL_NOTICE_MS) {
            setAgentProfileJob({ ...next, status: "failed", message: "작업이 응답하지 않아 재실행이 필요합니다.", error: "프로필 생성 작업이 제한 시간 동안 진행되지 않았습니다." });
            setAgentProfileError("시장 참여 에이전트 프로필 생성이 오래 진행되지 않았습니다. 다시 실행해주세요.");
          } else {
            setAgentProfileJob(next);
          }
        }
      } catch (cause) {
        if (!cancelled) setAgentProfileError(cause instanceof Error ? cause.message : "프로필 생성 진행 상태를 확인하지 못했습니다.");
      }
    };
    const timer = window.setTimeout(() => { void poll(); }, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pickedTicker, agentProfileJob]);

  useEffect(() => {
    if (!pickedTicker || !previewStepVisible) return;
    let cancelled = false;
    callApi<{ data: { sources: CollectionSource[] } }>(`/securities/${encodeURIComponent(pickedTicker)}/scenario-context`)
      .then((payload) => {
        if (!cancelled) setCollectionSources(payload.data?.sources ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setCollectionError(cause instanceof Error ? cause.message : "시나리오 자료를 수집하지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, [pickedTicker, previewStepVisible]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!picked || !investmentMode || !investmentConfirmed || !initialContextReadyForStart || starting || initialCash < 0) return;
    if (investmentMode === "new" && initialCash <= 0) return;
    if (investmentMode === "holding" && (!averagePrice || !holdingQuantity)) return;
    onStart({
      ticker: picked.ticker, name: picked.name,
      initialCash: investmentMode === "new" ? initialCash : 0,
      investmentMode, simulationDays,
      initialContextId: initialContext?.context_id ?? "",
      initialPosition: investmentMode === "holding"
        ? { quantity: holdingQuantity, averagePrice }
        : undefined,
    });
  };

  const selectSecurity = (item: Security) => {
    if (picked?.ticker !== item.ticker) {
      setInvestmentMode(null);
      setInvestmentConfirmed(false);
      setContextDwellComplete(false);
      setAveragePrice(0);
      setHoldingQuantity(0);
    }
    setPreviewCandles(null);
    setPreviewError(null);
    setPreviewDwellComplete(false);
    setCollectionSources(null);
    setCollectionError(null);
    setCollectionDwellComplete(false);
    setInitialContext(null);
    setInitialContextError(null);
    setInitialContextLoading(false);
    setContextDocuments(INITIAL_CONTEXT_DOCUMENTS);
    setContextDocumentSource(null);
    setResetSetupError(null);
    setContextDwellComplete(false);
    setAgentProfiles(null);
    setAgentProfileJob(null);
    setAgentProfileError(null);
    setAgentProfileStartedAt(null);
    setSimulationSetupStage(0);
    setPicked(item);
    setQuery(item.name);
    setResults([]);
    setSearchError(null);
  };

  const isQuickPicked = Boolean(picked && RECOMMENDED_SECURITIES.some((item) => item.ticker === picked.ticker));

  useEffect(() => {
    if (activeStep === 1) return;
    const timer = window.setTimeout(() => {
      const target = activeStep === 2 ? step2Ref.current
        : activeStep === 3 ? step3Ref.current
          : step4Ref.current;
      target?.scrollIntoView({ behavior: "smooth", block: activeStep === 4 ? "start" : "center" });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [activeStep]);

  return (
    <form className="paper-setup" onSubmit={submit}>
      <header className="paper-setup-header">
        <div>
          <span>FINVERSE · PAPER TRADING</span>
          <h2 id="paper-trading-title">이벤트 시나리오로 투자 판단을 연습하세요</h2>
          <p>실제 KOSPI 시세로 시장을 만들고, 아직 일어나지 않은 이벤트를 하나씩 마주하며 매매합니다.</p>
        </div>
        <button className="scenario-modal-close" type="button" onClick={onClose} aria-label="모의 투자 닫기"><X size={20} /></button>
      </header>

      <section className="paper-setup-block">
        <div className="paper-setup-heading"><span>01 · 종목 선택</span><h3>어떤 종목으로 연습할까요?</h3></div>
        <div className="paper-security-quick-pick" aria-label="자주 선택하는 종목">
          <div className="paper-security-quick-pick-heading">
            <span>빠른 선택</span>
            <small>자주 선택하는 종목</small>
          </div>
          <div className="paper-security-quick-pick-options">
            {RECOMMENDED_SECURITIES.map((item) => {
              const selected = picked?.ticker === item.ticker;
              return (
                <button
                  key={item.ticker}
                  type="button"
                  className={selected ? "active" : ""}
                  aria-pressed={selected}
                  onClick={() => selectSecurity(item)}
                >
                  <div><strong>{item.name}</strong><small>{item.ticker}</small></div>
                  <span>{selected ? <><CheckCircle2 size={13} /> 선택됨</> : "선택"}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="paper-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (!nextQuery.trim()) {
                setResults([]);
                setSearchError(null);
              }
              if (picked && nextQuery !== picked.name) {
                setPicked(null);
                setPreviewCandles(null);
                setPreviewError(null);
                setPreviewDwellComplete(false);
                setCollectionSources(null);
                setCollectionError(null);
                setInitialContext(null);
                setInitialContextError(null);
                setContextDocuments(INITIAL_CONTEXT_DOCUMENTS);
                setContextDwellComplete(false);
                setAgentProfiles(null);
                setAgentProfileJob(null);
                setAgentProfileError(null);
                setAgentProfileStartedAt(null);
                setSimulationSetupStage(0);
              }
            }}
            placeholder="종목명 또는 티커로 검색 (예: 삼성전자, 005930)"
            aria-label="종목 검색"
          />
          {searching && <LoaderCircle size={14} className="spin" />}
        </div>
        {searchError && <p className="paper-inline-error">{searchError}</p>}
        {Boolean(results.length) && (
          <div className="paper-search-results">
            {results.map((item) => (
              <button
                key={item.ticker}
                type="button"
                className={picked?.ticker === item.ticker ? "picked" : ""}
                onClick={() => selectSecurity(item)}
              >
                <strong>{item.name}</strong>
                <em>{item.ticker}</em>
                {item.share_type && <span>{item.share_type}</span>}
              </button>
            ))}
          </div>
        )}
        {picked && !isQuickPicked && (
          <div className="paper-picked">
            <CheckCircle2 size={15} />
            <div><strong>{picked.name}</strong><span>{picked.ticker}</span></div>
            {picked.ticker === "005930" && <em>캐시 리플레이 이력 사용 가능</em>}
          </div>
        )}
        {picked && (
          <section className="paper-security-preview" aria-live="polite">
            <header>
              <div><CandlestickChart size={15} /><strong>{picked.name} 최근 시세</strong></div>
              <span>최근 36거래일 · 실제 일봉</span>
            </header>
            {previewCandles === null && (
              <div className="paper-security-preview-loading"><LoaderCircle size={15} className="spin" /> 최근 시세를 불러오는 중입니다.</div>
            )}
            {previewError && <p className="paper-inline-error">{previewError}</p>}
            {previewCandles && previewCandles.length < 2 && !previewError && (
              <div className="paper-security-preview-empty">표시할 최근 일봉 데이터가 충분하지 않습니다.</div>
            )}
            {previewCandles && previewCandles.length >= 2 && (
              <CandleChart
                preview
                game={{
                  history_candles: previewCandles,
                  price_history: [],
                  initial_reference_price: previewCandles[previewCandles.length - 1].close,
                  revealed_events: [], fills: [], daily_reflections: [],
                }}
              />
            )}
          </section>
        )}
      </section>

      {picked && previewStepVisible && (
      <section ref={step2Ref} className="paper-setup-block paper-setup-reveal">
        <div className="paper-setup-heading"><span>02 · 자료 수집</span><h3>{picked.name} 시나리오 자료를 준비하고 있어요</h3></div>
        <div className={`paper-collection-status ${collectionReady ? "ready" : ""}`} aria-live="polite">
          <div>
            {collectionSources ? <CheckCircle2 size={15} /> : <LoaderCircle size={15} className={picked ? "spin" : ""} />}
            <strong>{collectionSources ? (collectionReady ? "시나리오 자료 준비가 완료되었습니다." : "일부 자료가 부족합니다.") : picked ? "선택 종목과 연결된 자료를 수집하고 있습니다." : "종목을 선택하면 자료 수집을 시작합니다."}</strong>
          </div>
          <span>시나리오 시작에 같은 자료를 사용합니다</span>
        </div>
        <div className="paper-collection-grid">
          {collectionSources ? collectionSources.map((source) => (
            <article key={source.key} className={`paper-collection-source ${source.status}`}>
              <header>
                {source.key === "market" ? <CandlestickChart size={15} /> : source.key === "economy" ? <Landmark size={15} /> : source.key === "events" ? <CalendarClock size={15} /> : <Users size={15} />}
                <strong>{source.label}</strong>
                <em>{source.status === "ready" ? "READY" : "MISSING"}</em>
              </header>
              <b>{source.count.toLocaleString("ko-KR")}<small>{source.unit}</small></b>
              <p>{source.detail}</p>
              <span>{source.updated_at ? `${source.updated_at} 기준` : "기준 시점 없음"}</span>
            </article>
          )) : ["시장", "경제", "사건", "커뮤니티"].map((label) => (
            <article key={label} className="paper-collection-source waiting"><header><LoaderCircle size={15} /><strong>{label}</strong><em>WAITING</em></header><b>—</b><p>종목 선택 후 준비</p></article>
          ))}
        </div>
        {collectionError && <p className="paper-inline-error">{collectionError}</p>}
      </section>
      )}

      {collectionStepComplete && (
      <section ref={step3Ref} className="paper-setup-block paper-setup-reveal">
        <div className="paper-setup-heading"><span>03 · 투자 상태</span><h3>지금 내 투자 조건을 입력해주세요</h3></div>
        <div className="paper-investment-mode" aria-label="투자 상태">
          <button type="button" className={investmentMode === "new" ? "active" : ""} aria-pressed={investmentMode === "new"} onClick={() => { setInvestmentMode("new"); setInvestmentConfirmed(false); setContextDwellComplete(false); }}>
            <CircleDollarSign size={15} /><span><strong>새로 투자하기</strong><small>현금으로 처음 시작</small></span>
          </button>
          <button type="button" className={investmentMode === "holding" ? "active" : ""} aria-pressed={investmentMode === "holding"} onClick={() => { setInvestmentMode("holding"); setInvestmentConfirmed(false); setContextDwellComplete(false); }}>
            <Wallet size={15} /><span><strong>이미 보유 중</strong><small>내 평단과 수량 반영</small></span>
          </button>
        </div>
        {investmentMode === "new" && (
          <div className="paper-money-panel">
            <label htmlFor="paper-initial-cash">
              <span>투자할 금액</span>
              <small>실제 연습에 사용할 수 있는 현금</small>
            </label>
            <div className="paper-money-input">
              <input id="paper-initial-cash" inputMode="numeric" value={initialCash ? initialCash.toLocaleString("ko-KR") : ""} onChange={(event) => { setInitialCash(parsePositiveInteger(event.target.value)); setInvestmentConfirmed(false); setContextDwellComplete(false); }} aria-label="투자할 금액" />
              <span>원</span>
            </div>
            <div className="paper-money-presets" aria-label="투자 금액 빠른 선택">
              {CASH_PRESETS.map((cash) => (
                <button key={cash} type="button" className={initialCash === cash ? "active" : ""} aria-pressed={initialCash === cash} onClick={() => { setInitialCash(cash); setInvestmentConfirmed(false); setContextDwellComplete(false); }}>+ {compactWon(cash)}원</button>
              ))}
            </div>
          </div>
        )}
        {investmentMode === "holding" && (
          <div className="paper-holding-inputs">
            <label htmlFor="paper-average-price"><span>평균 매입가</span><div><input id="paper-average-price" inputMode="numeric" value={averagePrice ? averagePrice.toLocaleString("ko-KR") : ""} onChange={(event) => { setAveragePrice(parsePositiveInteger(event.target.value)); setInvestmentConfirmed(false); setContextDwellComplete(false); }} /><em>원</em></div></label>
            <label htmlFor="paper-holding-quantity"><span>보유 수량</span><div><input id="paper-holding-quantity" inputMode="numeric" value={holdingQuantity ? holdingQuantity.toLocaleString("ko-KR") : ""} onChange={(event) => { setHoldingQuantity(parsePositiveInteger(event.target.value)); setInvestmentConfirmed(false); setContextDwellComplete(false); }} /><em>주</em></div></label>
          </div>
        )}
        {investmentMode && (
          <div className="paper-investment-actions">
            <p className="paper-setting-note"><CheckCircle2 size={13} /> {investmentMode === "holding" ? "입력한 보유 종목만으로 시작하며 추가 투자금은 사용하지 않습니다." : "실제 주문이나 계좌 연결 없이 입력한 조건으로만 연습합니다."}</p>
            <button className="paper-start-button paper-investment-confirm-button" type="button" disabled={!investmentReady} onClick={() => setInvestmentConfirmed(true)}>
              투자 상태 설정 완료 <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>
      )}

      {investmentConfirmed && (
      <section ref={step4Ref} className="paper-setup-block paper-setup-reveal">
        <div className="paper-setup-heading"><span>04 · 시뮬레이션 설정</span><h3>초기 상황</h3></div>
        <section className="paper-context-field" aria-live="polite">
          <div className="paper-context-documents" aria-label="초기 맥락 문서 생성 상태">
            {contextDocuments.map((document) => (
              <button key={document.key} type="button" className={`paper-context-document ${document.status}`} onClick={() => openContextDocument(document.key)} disabled={document.status !== "ready"} aria-label={`${document.label} Evidence Markdown 열기`}>
                {document.status === "ready" ? <CheckCircle2 size={14} /> : <LoaderCircle size={14} className="spin" />}
                <div className="paper-context-document-body">
                  <header><strong>{document.label}</strong><small>{document.status === "ready" ? "문서 준비 완료" : document.status === "generating" ? "문서 생성 중" : "생성 대기 중"}</small></header>
                  <p>{contextDocumentSource?.source_summary.document_previews?.[document.key] || (document.status === "waiting" ? "자료를 확인하고 있습니다." : "수집된 자료를 문서로 정리하고 있습니다…")}</p>
                </div>
              </button>
            ))}
          </div>
          {initialContextLoading && contextDocuments.every((document) => document.status === "ready") && <div className="paper-context-loading"><LoaderCircle size={15} className="spin" /> 네 개의 근거 문서를 바탕으로 종목 전체 현황과 최근 이벤트 흐름을 분석하고 있습니다.</div>}
          {!initialContextLoading && !initialContext && !initialContextError && contextDocuments.every((document) => document.status === "ready") && (
            <p className="paper-inline-error"><span>초기 상황 분석 결과를 불러오지 못했습니다.</span><button type="button" onClick={retryInitialContext} disabled={initialContextRetrying}>{initialContextRetrying ? "재실행 중…" : "분석 재실행"}</button></p>
          )}
          {initialContextError && (
            <p className="paper-inline-error">
              <span>{initialContextError}</span>
              <button type="button" onClick={retryInitialContext} disabled={initialContextRetrying}>{initialContextRetrying ? "재실행 중…" : "분석 재실행"}</button>
            </p>
          )}
          {initialContext && (
            <>
              <section className="paper-context-summary" aria-label="초기 상황 5줄 요약">
                <h4>5줄 요약</h4>
                <ul>{initialContext.analysis.summary_points.slice(0, 5).map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul>
              </section>
              <section className="paper-event-sequence" aria-label="종목 이벤트 시퀀스">
                <header><strong>종목 이벤트 시퀀스</strong><small>최근 한 달 · 실제 근거 문서 기반</small></header>
                {initialContext.analysis.event_sequence.length ? (
                  <ol>
                    {initialContext.analysis.event_sequence.map((item, index) => (
                      <li key={`${item.date}-${item.title}-${index}`}>
                        <span className={`paper-event-sequence-dot ${item.basis}`} />
                        <article>
                          <header><div><time>{item.date || "날짜 확인 필요"}</time><em>{item.domain}</em></div><small>{item.basis === "observed" ? "자료 확인" : "문서 종합"}</small></header>
                          <strong>{item.title}</strong>
                          {item.description && <p>{item.description}</p>}
                          <footer><span>시장 반응</span><p>{item.market_reaction}</p></footer>
                        </article>
                      </li>
                    ))}
                  </ol>
                ) : <p className="paper-event-sequence-empty">최근 한 달 내 순서화할 사건 근거가 충분하지 않습니다.</p>}
                <small className="paper-event-sequence-note">표시된 이벤트는 수집 문서에서 확인된 흐름이며, 미래 사건이나 가격 예측이 아닙니다.</small>
              </section>
              <div className="paper-context-points">
                <div><strong>위험 요인</strong><span>{initialContext.analysis.risk_factors.slice(0, 3).join(" · ") || "추가 확인 필요"}</span></div>
                <div><strong>관찰 포인트</strong><span>{initialContext.analysis.watch_points.slice(0, 3).join(" · ") || "시나리오 진행 중 변화"}</span></div>
              </div>
              <small className="paper-context-source">시장 {initialContext.source_summary.market_days}일 · 경제 {initialContext.source_summary.macro_observations}개 · 사건 {initialContext.source_summary.events}건 · 커뮤니티 {initialContext.source_summary.community_comment_count ?? initialContext.source_summary.community_days}{initialContext.source_summary.community_comment_count != null ? "댓글" : "일"} · {initialContext.cached ? "캐시된 분석" : "새로 분석"}</small>
            </>
          )}
        </section>
        {simulationSetupStage >= 2 && <div ref={agentStepRef} className="paper-agent-field paper-setup-reveal">
          <div className="paper-simulation-label">
            <span>시장 참여 에이전트</span>
            <small>{agentProfilesReady ? "총 59명 · 개별 프로필 준비 완료" : agentProfileJob ? `개별 프로필 생성 ${agentProfileJob.progress}%` : "초기 맥락을 바탕으로 개별 프로필 준비 중"}</small>
          </div>
          {agentProfilesReady ? (
            <div className="paper-agent-grid">
              {agentProfiles?.groups.map((agent) => {
                const Icon = AGENT_GROUP_ICON[agent.key];
                return (
                  <article className={`paper-agent-card ${agent.key}`} key={agent.key} role="button" tabIndex={0} onClick={() => openAgentProfileGroup(agent)} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openAgentProfileGroup(agent);
                    }
                  }} aria-label={`${agent.label} ${agent.count}명 개별 프로필 보기`}>
                    <header>
                      <div className="paper-agent-title"><Icon size={15} /><strong>{agent.label}</strong></div>
                      <b>{agent.count}명</b>
                    </header>
                    <p>{agent.description}</p>
                    <div className="paper-agent-actions" aria-label={`${agent.label} 가능한 행동`}>
                      <span className="paper-agent-actions-label">가능한 행동</span>
                      <div>{GROUP_ACTION_LABELS[agent.key].map((action) => <span className="paper-agent-action-chip" key={action}>{action}</span>)}</div>
                    </div>
                    <dl className="paper-agent-metrics">
                      <div><dt>위험 허용</dt><dd>{agent.average_risk_tolerance.toFixed(2)}</dd></div>
                      <div><dt>행동 빈도</dt><dd>{agent.activity_frequency === "high" ? "높음" : agent.activity_frequency === "medium" ? "보통" : "낮음"}</dd></div>
                      <div><dt>시장 영향</dt><dd>{agent.market_impact_tier === "very_high" ? "매우 큼" : agent.market_impact_tier === "high" ? "큼" : agent.market_impact_tier === "medium" ? "중간" : "낮음"}</dd></div>
                    </dl>
                    <span className="paper-agent-card-link">개별 프로필 {agent.count}명 보기 <ArrowRight size={13} /></span>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="paper-agent-progress" role="status">
              <LoaderCircle size={16} className="spin" />
              <div><strong>{agentProfileJob?.message ?? "59개 개별 에이전트가 초기 상황을 읽고 있습니다."}</strong><span>각 에이전트는 다른 에이전트와 분리된 LLM 호출과 자신의 투자 특성으로 생성됩니다.</span></div>
            </div>
          )}
          {agentProfileError && (
            <p className="paper-inline-error">
              <span>{agentProfileError}</span>
              <button type="button" onClick={() => { setAgentProfileError(null); setAgentProfileJob(null); setAgentProfileRetryToken((token) => token + 1); }}>다시 시도</button>
            </p>
          )}
        </div>}
      </section>
      )}

      {investmentConfirmed && simulationSetupStage >= 3 && (
        <section ref={readyStepRef} className="paper-setup-block paper-setup-reveal">
          <div className="paper-setup-heading"><span>05 · 시작 준비</span><h3>연습 기간을 정하고 모의 투자를 시작하세요</h3></div>
          <section className="paper-ready-block">
            <div className="paper-ready-duration">
              <div className="paper-ready-duration-head"><strong>연습 기간</strong><small>거래일 기준</small></div>
              <div className="paper-duration-options">
                {DURATION_OPTIONS.map((option) => (
                  <button key={option.days} type="button" className={simulationDays === option.days ? "active" : ""} aria-pressed={simulationDays === option.days} onClick={() => setSimulationDays(option.days)}>
                    <strong>{option.label}</strong><small>{option.caption}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="paper-ready-copy">
              <p>선택한 종목의 실제 흐름과 시장 정보를 바탕으로, 앞으로의 거래일을 가상으로 경험합니다.</p>
              <p>매일 매수·매도·관망을 선택하며 나만의 투자 판단을 기록하고 돌아볼 수 있습니다.</p>
            </div>
            <div className="paper-ready-actions">
              <button className="paper-reset-button" type="button" onClick={() => void restartSetup()} disabled={starting || resettingSetup}>
                {resettingSetup ? <><LoaderCircle size={15} className="spin" /> 초기화 중</> : <>다시 설정하기</>}
              </button>
              <button className="paper-start-button" type="submit" disabled={starting || resettingSetup || !initialContextReadyForStart}>
                {starting
                  ? <><LoaderCircle size={17} className="spin" /> World Agent 시뮬레이션을 준비하고 있습니다</>
                  : <>모의 투자 시작하기 <ArrowRight size={16} /></>}
              </button>
            </div>
            {resetSetupError && <p className="paper-inline-error">{resetSetupError}</p>}
            {starting && (
              <p className="paper-start-note">
                초기 상황과 59개 개별 에이전트 프로필을 불러오고 있습니다. 최초 생성은 잠시 걸릴 수 있습니다.
              </p>
            )}
          </section>
        </section>
      )}

      {error && <p className="paper-error"><AlertTriangle size={14} /> {error}</p>}
      {contextDocumentLoading && <div className="paper-document-loading" role="status"><LoaderCircle size={15} className="spin" /> 문서를 불러오는 중입니다.</div>}
      {selectedContextDocument && (
        <div className="paper-document-backdrop" role="presentation" onMouseDown={() => setSelectedContextDocument(null)}>
          <section className="paper-document-modal" role="dialog" aria-modal="true" aria-labelledby="paper-document-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>EVIDENCE DOCUMENT</span><h3 id="paper-document-title">{picked?.name} · {selectedContextDocument.label}</h3><p>선택 종목의 실제 자료를 정리한 Markdown 문서입니다.</p></div>
              <button className="scenario-modal-close" type="button" onClick={() => setSelectedContextDocument(null)} aria-label="Evidence 문서 닫기"><X size={18} /></button>
            </header>
            <PaperEvidenceMarkdown content={selectedContextDocument.content} />
          </section>
        </div>
      )}
      {selectedAgentGroup && (
        <div className="paper-document-backdrop" role="presentation" onMouseDown={() => setSelectedAgentGroup(null)}>
          <section className="paper-agent-modal" role="dialog" aria-modal="true" aria-labelledby="paper-agent-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>MARKET AGENT PROFILES</span><h3 id="paper-agent-modal-title">{picked?.name} · {selectedAgentGroup.label}</h3><p>초기 상황과 역할 정책을 바탕으로 각각 생성된 독립 에이전트 프로필입니다.</p></div>
              <button className="scenario-modal-close" type="button" onClick={() => setSelectedAgentGroup(null)} aria-label="개별 에이전트 프로필 닫기"><X size={18} /></button>
            </header>
            {agentProfileDetailsLoading ? <div className="paper-agent-modal-loading"><LoaderCircle size={18} className="spin" /> 개별 프로필을 불러오는 중입니다.</div> : agentProfileDetails?.profiles.length ? (
              <div className="paper-agent-profile-list">
                {agentProfileDetails.profiles.map((agent) => <article className="paper-agent-profile-detail" key={agent.persona_id}>
                  <header><div><small>{agent.persona_id}</small><h4>{agent.profile.display_name}</h4><p>{agent.role_description}</p></div><span className={`paper-agent-stance ${agent.profile.initial_stance}`}>{agent.profile.initial_stance}</span></header>
                  <p className="paper-agent-thesis">{agent.profile.investment_thesis}</p>
                  <dl><div><dt>편향</dt><dd>{agent.profile.bias}</dd></div><div><dt>보유 관점</dt><dd>{agent.profile.holding_horizon}</dd></div><div><dt>위험 허용</dt><dd>{agent.risk_tolerance.toFixed(2)}</dd></div></dl>
                  <div className="paper-agent-profile-signals"><strong>주로 보는 신호</strong><div>{agent.profile.focus_signals.map((signal) => <span key={signal}>{signal}</span>)}</div></div>
                  <p className="paper-agent-rule"><b>사건 반응</b>{agent.profile.event_response}</p>
                  <p className="paper-agent-rule"><b>위험 규칙</b>{agent.profile.risk_rule}</p>
                </article>)}
              </div>
            ) : <div className="paper-agent-modal-loading">개별 프로필을 불러오지 못했습니다. 다시 시도해 주세요.</div>}
          </section>
        </div>
      )}
      {activeStep > 1 && <div className="paper-setup-focus-space" aria-hidden="true" />}
    </form>
  );
}

/* -------------------------------------------------------------- trading */

function OrderDesk({
  game,
  disabled,
  onSubmit,
  submitting,
}: {
  game: ScenarioGame;
  disabled: boolean;
  onSubmit: (input: { side: "BUY" | "SELL"; quantity: number; rationale: string; confidence: number }) => void;
  submitting: boolean;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState(10);
  const [rationale, setRationale] = useState("");
  const [confidence, setConfidence] = useState(60);

  const settings = game.settings;
  const slippage = (settings?.slippage_bps ?? 5) / 10_000;
  // 체결은 다음 단계에서 현재가에 슬리피지를 얹어 이뤄진다. 실제 앱처럼 미리 보여준다.
  const fillPrice = toKrxTick(game.current_price * (1 + (side === "BUY" ? slippage : -slippage)));
  const gross = fillPrice * quantity;
  const fee = Math.round(gross * (settings?.fee_rate ?? 0.00015));
  const tax = side === "SELL" ? Math.round(gross * (settings?.sell_tax_rate ?? 0.0018)) : 0;
  const settle = side === "BUY" ? gross + fee : gross - fee - tax;
  const affordable = side === "BUY"
    ? Math.floor(game.portfolio.cash / Math.max(fillPrice, 1))
    : game.portfolio.quantity;
  const exceeds = quantity > affordable;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || submitting || quantity <= 0 || exceeds) return;
    onSubmit({ side, quantity, rationale: rationale.trim(), confidence });
    setRationale("");
  };

  return (
    <form className={`paper-order ${disabled ? "locked" : ""}`} onSubmit={submit}>
      <div className="paper-order-side">
        <button type="button" className={side === "BUY" ? "buy active" : "buy"} onClick={() => setSide("BUY")} disabled={disabled}>
          <TrendingUp size={14} /> 매수
        </button>
        <button type="button" className={side === "SELL" ? "sell active" : "sell"} onClick={() => setSide("SELL")} disabled={disabled}>
          <TrendingDown size={14} /> 매도
        </button>
      </div>

      <label className="paper-order-field">
        <span>수량<em>{side === "BUY" ? "매수가능" : "보유"} {affordable.toLocaleString("ko-KR")}주</em></span>
        <div className="paper-quantity">
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            disabled={disabled}
          />
          <div className="paper-quantity-quick">
            {[0.25, 0.5, 1].map((ratio) => (
              <button key={ratio} type="button" disabled={disabled || affordable < 1} onClick={() => setQuantity(Math.max(1, Math.floor(affordable * ratio)))}>
                {ratio === 1 ? "최대" : `${ratio * 100}%`}
              </button>
            ))}
          </div>
        </div>
      </label>

      <label className="paper-order-field">
        <span>확신도<em>{confidence}%</em></span>
        <input
          className="paper-confidence"
          type="range"
          min={0}
          max={100}
          step={5}
          value={confidence}
          onChange={(event) => setConfidence(Number(event.target.value))}
          disabled={disabled}
        />
      </label>

      <label className="paper-order-field">
        <span>판단 근거<em>회고에 사용됩니다</em></span>
        <textarea
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          rows={3}
          disabled={disabled}
          placeholder="지금 이 주문을 내는 이유를 한 문장으로 남겨보세요"
        />
      </label>

      <div className="paper-order-estimate">
        <div><span>예상 체결가<em>슬리피지 {settings?.slippage_bps ?? 5}bp</em></span><b>{fillPrice.toLocaleString("ko-KR")}원</b></div>
        <div><span>거래 대금</span><b>{won(gross)}</b></div>
        <div><span>수수료{tax ? " · 거래세" : ""}</span><b>{won(fee + tax)}</b></div>
        <div className="total">
          <span>{side === "BUY" ? "총 매수금액" : "총 수령금액"}</span>
          <strong>{won(settle)}</strong>
        </div>
        <div className="after">
          <span>주문 후 현금</span>
          <b>{compactWon(side === "BUY" ? game.portfolio.cash - settle : game.portfolio.cash + settle)}</b>
        </div>
      </div>
      {exceeds && <p className="paper-inline-error">{side === "BUY" ? "현금이 부족합니다." : "보유 수량을 초과했습니다."}</p>}

      <button className="paper-order-submit" type="submit" disabled={disabled || submitting || exceeds}>
        {submitting ? <><LoaderCircle size={15} className="spin" /> 주문 접수 중</> : <>{side === "BUY" ? "매수" : "매도"} 주문 담기</>}
      </button>
      <p className="paper-order-note">주문은 다음 단계 진행 시 함께 체결됩니다.</p>
    </form>
  );
}

const COACH_KEY = "finverse.paper-trading.coach";

function CoachOverlay({ onDone, worldMode = false }: { onDone: () => void; worldMode?: boolean }) {
  return (
    <div className="paper-coach" role="dialog" aria-label="모의 투자 사용 방법">
      <div className="paper-coach-card">
        <span>HOW IT WORKS</span>
        <h3>{worldMode ? "거래일마다 이렇게 연습하세요" : "한 번의 이벤트를 네 단계로 겪습니다"}</h3>
        {worldMode ? (
          <ol>
            <li><b>오늘의 시장 확인</b><p className="paper-coach-lines"><span>‘다음 거래일 진행’을 누르면 오늘의 시황과 새로 공개된 정보를 확인합니다.</span><span>평소 거래일에는 내 포트폴리오 변화와 시장 흐름을 읽는 데 집중하면 됩니다.</span></p></li>
            <li><b>중요 사건에서 직접 판단</b><p className="paper-coach-lines"><span>가격에 큰 영향을 줄 사건이 오면 게임이 멈추고 판단 화면이 열립니다.</span><span>매수 고려·관찰 계속·매도 고려 중 하나를 선택합니다. 매수·매도 고려를 고르면 다음 거래일 개인 계좌에 반영할 수량도 입력합니다.</span></p></li>
            <li><b>내 선택은 기록으로 남음</b><p className="paper-coach-lines"><span>내 판단과 개인 계좌 주문은 학습 기록으로 저장되며 시장 가격이나 수급을 직접 움직이지 않습니다.</span><span>시장 변화는 World Agent가 갱신한 환경·공개 사건과 59개 에이전트의 전체 반응으로 만들어집니다.</span></p></li>
            <li><b>다음 거래일로 이어가기</b><p className="paper-coach-lines"><span>각 거래일에는 개인·외국인·기관·연기금이 각자 다른 방식으로 반응합니다.</span><span>결과를 확인한 뒤 다음 거래일을 열어 변화가 이어지는 모습을 관찰하세요.</span></p></li>
            <li><b>마지막에 내 판단 돌아보기</b><p className="paper-coach-lines"><span>연습이 끝나면 수익률과 함께 기록한 판단을 분석합니다.</span><span>추격 매수, 손실 회피, 과신, 과도한 매매 같은 패턴을 확인할 수 있습니다.</span></p></li>
          </ol>
        ) : (
        <ol>
          <li><b>관망</b><p>이벤트 직전까지 하루씩 장이 열립니다. 59명의 에이전트가 스스로 거래하고, 공개 정보가 순서대로 흘러나옵니다. 주문은 낼 수 없습니다.</p></li>
          <li><b>사전 판단</b><p>이벤트 내용은 아직 비공개입니다. 신호만 보고 매수·매도를 담습니다. 담지 않으면 관망으로 기록됩니다.</p></li>
          <li><b>공개와 대응</b><p>이벤트가 드러나고 시장이 반응합니다. 과잉 반응인지 추세인지 판단해 다시 주문합니다.</p></li>
          <li><b>회고</b><p>모든 이벤트가 끝나면 매 판단의 근거와 결과를 묶은 리포트를 받습니다.</p></li>
        </ol>
        )}
        <button type="button" onClick={onDone}>시작하기 <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

function ReportList({ title, items, tone = "" }: { title: string; items?: string[]; tone?: string }) {
  if (!items?.length) return null;
  return <div className={`paper-report-list ${tone}`}><b>{title}</b><ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>;
}

function CompletedReports({ reports, portfolio, initialEquity, game, onBack }: { reports?: LlmReports; portfolio: Portfolio; initialEquity?: number; game: ScenarioGame; onBack: () => void }) {
  const investment = reports?.investment;
  const scenario = reports?.scenario;
  const investorType = inferInvestorType(investment);
  const [tab, setTab] = useState<"investment" | "scenario">("investment");
  if (!investment && !scenario) return null;
  const end = investment?.portfolio_at_end ?? portfolio;
  const starting = investment?.initial_equity ?? initialEquity ?? 0;
  const profit = end.equity - starting;
  return (
    <section className="paper-completed-reports" aria-label="AI 시뮬레이션 보고서">
      <div className="paper-completed-reports-heading"><div className="paper-report-heading-row"><div><span>SIMULATION REPORTS</span><h2>시뮬레이션이 끝났습니다</h2><p>기록된 판단과 변화한 시장 환경을 바탕으로 두 가지 보고서를 만들었습니다.</p></div><button type="button" className="paper-report-back" onClick={onBack}>시뮬레이션으로 돌아가기</button></div></div>
      <nav className="paper-report-tabs" aria-label="보고서 종류">
        <button type="button" className={tab === "investment" ? "active" : ""} onClick={() => setTab("investment")} disabled={!investment}>나의 투자 일지</button>
        <button type="button" className={tab === "scenario" ? "active" : ""} onClick={() => setTab("scenario")} disabled={!scenario}>시나리오</button>
      </nav>
      {investment && tab === "investment" && <article className="paper-report-card">
        {investorType && <figure className="paper-investor-type-card">
          <figcaption><span>나의 투자 유형</span><strong>{INVESTOR_TYPE_META[investorType].label}</strong></figcaption>
          <img src={INVESTOR_TYPE_META[investorType].image} alt={INVESTOR_TYPE_META[investorType].label} />
        </figure>}
        <header><div><span>01 · USER REPORT</span><h3>나의 투자보고서</h3></div><b className={toneOf(profit)}>{signedPct(end.total_return_pct ?? 0)}</b></header>
        {investment.report_markdown ? <PaperEvidenceMarkdown content={investment.report_markdown} /> : null}
        <div className="paper-report-metrics"><div><span>최종 투자금액</span><strong>{won(end.equity)}</strong></div><div><span>종료일 평가손익</span><strong className={toneOf(profit)}>{won(profit)}</strong></div><div><span>실현손익</span><strong>{won(end.realized_pnl)}</strong></div><div><span>판단 횟수</span><strong>{investment.verified_metrics?.daily_reflection_count ?? investment.verified_metrics?.trade_count ?? 0}회</strong></div></div>
        {!investment.report_markdown && <>
          <p className="paper-report-summary">{investment.summary}</p>
          {investment.behavior_pattern && <p className="paper-report-detail"><b>행동 패턴</b>{investment.behavior_pattern}</p>}
          {investment.daily_action_review?.length ? <div className="paper-report-daily"><b>일자별 판단과 결과</b>{investment.daily_action_review.map((row, index) => <p key={`${row.date}-${index}`}><strong>{row.date}</strong> <span>{row.action}</span> — {row.result}</p>)}</div> : null}
          <div className="paper-report-columns"><ReportList title="잘한 점" items={investment.strengths} tone="good" /><ReportList title="다음에 점검할 점" items={investment.risk_patterns} tone="risk" /><ReportList title="다음 연습 원칙" items={investment.next_practice} tone="plan" /></div>
        </>}
      </article>}
      {scenario && tab === "scenario" && <article className="paper-report-card scenario">
        <header><div><span>02 · WORLD REPORT</span><h3>시나리오 보고서</h3></div><span>환경 변화·에이전트 흐름</span></header>
        <section className="paper-scenario-overview" aria-label="시나리오 핵심 요약">
          <div className="paper-scenario-highlight"><span>시뮬레이션 기간</span><strong>{game.simulation_days ?? 0}<small>거래일</small></strong><p>{scenario.summary ?? "기록된 시장 환경을 바탕으로 시나리오 경로를 정리했습니다."}</p></div>
          <div className="paper-scenario-summary-grid">
            <div><span>시작 기준가</span><strong>{won(game.initial_reference_price)}</strong><small>{game.name} · 시뮬레이션 시작</small></div>
            <div><span>종료 기준가</span><strong>{won(game.current_price)}</strong><small>종료 시점 종가</small></div>
            <div><span>World State 변화</span><p>{scenario.environment_evolution ?? "기록된 환경 변화가 없습니다."}</p></div>
            <div><span>공개 이벤트</span><strong>{scenario.event_reviews?.length ?? game.revealed_events?.length ?? 0}<small>개</small></strong><small>실제 유사 근거 확인 후 공개</small></div>
          </div>
        </section>
        {scenario.environment_evolution && <p className="paper-report-detail"><b>World State 변화</b>{scenario.environment_evolution}</p>}
        {scenario.stock_flow && <p className="paper-report-detail"><b>종목 흐름</b>{scenario.stock_flow}</p>}
        {scenario.event_reviews?.length ? <div className="paper-report-events"><b>발생 이벤트</b>{scenario.event_reviews.map((row, index) => <p key={`${row.date}-${index}`}><strong>{row.date} · {row.event}</strong>{row.impact}</p>)}</div> : null}
        {scenario.group_behavior && <div className="paper-report-groups">{Object.entries(scenario.group_behavior).map(([key, value]) => <p key={key}><b>{GROUP_LABEL[key] ?? key}</b>{value}</p>)}</div>}
        <ReportList title="주요 전환점" items={scenario.key_turning_points} tone="plan" />
      </article>}
    </section>
  );
}

function TradingScreen({
  game,
  busy,
  stalled,
  error,
  orderSubmitting,
  onOrder,
  onDailyReflection,
  onAdvance,
}: {
  game: ScenarioGame;
  busy: boolean;
  stalled: boolean;
  error: string | null;
  orderSubmitting: boolean;
  onOrder: (input: { side: "BUY" | "SELL"; quantity: number; rationale: string; confidence: number }) => void;
  onDailyReflection: (stance: DailyReflection["stance"], quantity?: number) => Promise<void>;
  onAdvance: (days?: number) => void;
}) {
  // 모달은 사용자가 열었을 때만 마운트되므로 첫 렌더에서 바로 읽어도 안전하다.
  // 저장소 접근이 막힌 브라우저에서는 안내를 띄우지 않는다.
  const [coach, setCoach] = useState(() => {
    try { return window.localStorage.getItem(COACH_KEY) !== "done"; } catch { return false; }
  });
  const [showReports, setShowReports] = useState(true);
  useEffect(() => {
    if (game.phase === "completed" && game.llm_reports) setShowReports(true);
  }, [game.phase, game.llm_reports]);
  const dismissCoach = useCallback(() => {
    setCoach(false);
    try { window.localStorage.setItem(COACH_KEY, "done"); } catch { /* 무시 */ }
  }, []);

  const meta = PHASE_META[game.phase] ?? PHASE_META.inter_event_market;
  const worldMode = game.mode === "world";
  const totalProgressUnits = worldMode ? (game.simulation_days ?? 0) : game.total_events;
  const currentProgressUnits = worldMode
    ? (game.phase === "completed" ? totalProgressUnits : game.current_day_index ?? 0)
    : (game.phase === "completed" ? game.total_events : game.current_event_index);
  const eventProgress = totalProgressUnits ? Math.min(100, (currentProgressUnits / totalProgressUnits) * 100) : 0;
  const latestRound = game.agent_rounds?.[game.agent_rounds.length - 1];
  const reflectionMarketDate = game.phase === "world_decision"
    ? game.current_event?.event_date
    : latestRound?.market_date;
  const latestReflection = useMemo(() => {
    return (game.daily_reflections ?? []).find((item) => item.market_date === reflectionMarketDate);
  }, [game.daily_reflections, reflectionMarketDate]);
  const dailyFillSummaries = useMemo(() => {
    const grouped = new Map<string, { market_date: string; buy_quantity: number; buy_amount: number; sell_quantity: number; sell_amount: number }>();
    for (const fill of game.fills ?? []) {
      const marketDate = fill.market_date ?? "거래일 미상";
      const current = grouped.get(marketDate) ?? { market_date: marketDate, buy_quantity: 0, buy_amount: 0, sell_quantity: 0, sell_amount: 0 };
      const amount = fill.gross_amount ?? fill.price * fill.quantity;
      if (fill.side === "BUY") {
        current.buy_quantity += fill.quantity;
        current.buy_amount += amount;
      } else {
        current.sell_quantity += fill.quantity;
        current.sell_amount += amount;
      }
      grouped.set(marketDate, current);
    }
    return [...grouped.values()].sort((left, right) => right.market_date.localeCompare(left.market_date));
  }, [game.fills]);
  const reflectionSaveRef = useRef<Promise<void>>(Promise.resolve());
  const saveDailyReflection = useCallback((stance: DailyReflection["stance"], quantity?: number) => {
    const request = onDailyReflection(stance, quantity);
    reflectionSaveRef.current = request;
    return request;
  }, [onDailyReflection]);
  const advanceAfterReflection = useCallback(async (days?: number) => {
    await reflectionSaveRef.current;
    onAdvance(days);
  }, [onAdvance]);
  const reportView = game.phase === "completed" && Boolean(game.llm_reports) && showReports;
  const startFromCoach = useCallback(() => {
    dismissCoach();
    if (worldMode && game.phase === "world_market" && (game.current_day_index ?? 0) === 0 && !busy) {
      onAdvance(1);
    }
  }, [busy, dismissCoach, game.current_day_index, game.phase, onAdvance, worldMode]);

  return (
    <div className={`paper-run${reportView ? " report-view" : ""}`}>
      {coach && <CoachOverlay onDone={startFromCoach} worldMode={worldMode} />}

      <header className="paper-run-header">
        <div className="paper-header-dashboard" aria-label="시나리오 진행 현황">
          <div className="paper-header-progress">
            <strong>{worldMode
              ? `시나리오 ${currentProgressUnits} / ${totalProgressUnits} 거래일`
              : `${game.phase === "completed" ? game.total_events : game.current_event_index + 1} / ${game.total_events} 이벤트`}</strong>
            <div className="paper-progress"><i style={{ width: `${eventProgress}%` }} /></div>
          </div>
          {worldMode && <PortfolioSnapshot game={game} compact />}
          {error && <div className="paper-run-error"><AlertTriangle size={14} /> <span>{error}</span></div>}
          {stalled && !error && (
            <div className="paper-run-warning">
              <AlertTriangle size={14} />
              <span>응답이 8분 넘게 갱신되지 않았습니다. 백엔드가 재시작되었을 수 있습니다. 창을 닫았다 다시 열면 최신 상태를 불러옵니다.</span>
            </div>
          )}
        </div>
      </header>

      <div className="paper-run-grid">
        <section className="paper-panel paper-chart-panel" aria-label="가격 차트">
          <div className="paper-panel-heading">
            <div><CandlestickChart size={15} /><span>시나리오 캔들</span></div>
            <em>{(game.last_market_date ?? latestRound?.market_date) ? `${game.last_market_date ?? latestRound?.market_date} 기준` : "시작 전"}</em>
          </div>
          <CandleChart game={game} />
        </section>

        <section className="paper-panel paper-desk-panel" aria-label="투자 시뮬레이션">
          <div className="paper-panel-heading">
            <div><CircleDollarSign size={15} /><span>투자 시뮬레이션</span></div>
            <em>{meta.eyebrow}</em>
          </div>

          <div className="paper-desk-scroll">
            {worldMode && (
              <>
                <DailyPracticeCard
                  key={`${reflectionMarketDate ?? "waiting"}-${game.phase}`}
                  round={latestRound}
                  event={game.phase === "world_decision" ? game.current_event : null}
                  reflection={latestReflection}
                  portfolio={game.portfolio}
                  disabled={busy || !["world_market", "world_decision"].includes(game.phase)}
                  onSelect={saveDailyReflection}
                />
              </>
            )}
            {meta.canOrder && !worldMode
              ? <OrderDesk game={game} disabled={busy} onSubmit={onOrder} submitting={orderSubmitting} />
              : (!worldMode && (
                <div className="paper-locked-note">
                  <strong>{meta.label}에는 주문할 수 없습니다</strong>
                  <p>{meta.guide}</p>
                </div>
              ))}

            {Boolean(game.pending_orders?.length) && (
              <div className="paper-pending">
                <span>담아둔 주문 {game.pending_orders.length}건 · 다음 단계에서 체결</span>
                {game.pending_orders.map((order) => (
                  <div key={order.order_id}>
                    <b className={order.side === "BUY" ? "up" : "down"}>{order.side === "BUY" ? "매수" : "매도"}</b>
                    <strong>{order.quantity.toLocaleString("ko-KR")}주</strong>
                    {typeof order.confidence === "number" && <em>확신 {order.confidence}%</em>}
                  </div>
                ))}
              </div>
            )}

            {Boolean(game.fills?.length) && (
              <div className="paper-trade-records">
                <section className="paper-holding-record" aria-label="현재 보유 현황">
                  <div className="paper-record-title">현재 보유 현황</div>
                  <div className="paper-holding-record-grid">
                    <div><span>보유 수량</span><strong>{game.portfolio.quantity.toLocaleString("ko-KR")}주</strong></div>
                    <div><span>평균 매입단가</span><strong>{game.portfolio.quantity ? won(game.portfolio.average_price) : "-"}</strong></div>
                    <div><span>현재 평가액</span><strong>{won(game.portfolio.market_value)}</strong></div>
                    <div><span>평가손익</span><strong className={toneOf(game.portfolio.unrealized_pnl)}>{won(game.portfolio.unrealized_pnl)}</strong></div>
                  </div>
                </section>
                <section className="paper-fills" aria-label="일자별 체결 기록">
                  <div className="paper-record-title">일자별 거래 기록 <small>{game.fills?.length}건</small></div>
                  <div className="paper-fill-table-head"><span>거래일</span><span>매수</span><span>매도</span></div>
                  {dailyFillSummaries.map((day) => (
                    <div className="paper-fill-day-row" key={day.market_date}>
                      <strong>{day.market_date}</strong>
                      <span className={day.buy_quantity ? "up" : "muted"}>{day.buy_quantity ? `${day.buy_quantity.toLocaleString("ko-KR")}주 · ${won(day.buy_amount)}` : "-"}</span>
                      <span className={day.sell_quantity ? "down" : "muted"}>{day.sell_quantity ? `${day.sell_quantity.toLocaleString("ko-KR")}주 · ${won(day.sell_amount)}` : "-"}</span>
                    </div>
                  ))}
                </section>
              </div>
            )}

            {Boolean(game.daily_performance?.length) && (
              <div className="paper-daily-performance">
                <span>일별 투자 성과</span>
                {[...(game.daily_performance ?? [])].reverse().slice(0, 10).map((day) => (
                  <div key={day.market_date}>
                    <strong>{day.market_date}</strong>
                    <span>{day.quantity.toLocaleString("ko-KR")}주 · 평가액 {day.market_value.toLocaleString("ko-KR")}원</span>
                    <b className={toneOf(day.daily_pnl)}>{day.daily_pnl >= 0 ? "+" : ""}{day.daily_pnl.toLocaleString("ko-KR")}원</b>
                  </div>
                ))}
              </div>
            )}

          </div>

          <div className="paper-advance-row">
            {game.phase === "completed" && game.llm_reports && !showReports && (
              <button className="paper-advance-fast" type="button" onClick={() => setShowReports(true)}>
                보고서 다시 보기
              </button>
            )}
            {meta.action === "advance_days" && !busy && (
              <button className="paper-advance-day" type="button" onClick={() => { void advanceAfterReflection(1); }}>
                <CalendarClock size={15} /> 다음 거래일 진행
              </button>
            )}
            <button
              className={`paper-advance${game.phase === "completed" && game.llm_reports ? " report-generated" : ""}`}
              type="button"
              onClick={() => { void advanceAfterReflection(); }}
              disabled={busy || (game.phase === "completed" && Boolean(game.llm_reports))}
            >
              {busy
                ? <><LoaderCircle size={16} className="spin" /> 오늘의 시장을 준비하는 중</>
                : <>{game.phase === "completed" && game.llm_reports ? "AI 투자 리포트 생성 완료" : worldMode && meta.action === "advance" ? "다음 거래일 진행" : meta.cta} {!game.llm_reports && <ChevronRight size={16} />}</>}
            </button>
          </div>
        </section>

        <section className="paper-panel paper-feed-panel" aria-label="시장 기록">
          <div className="paper-panel-heading">
            <div><Radio size={13} /><span>시장 기록</span></div>
            <em>{game.agent_rounds?.length ? game.agent_rounds.length + "개 거래일" : "대기"}</em>
          </div>

          <div className="paper-feed-scroll">
            <div className="paper-record-layout">
              <EventTimeline game={game} worldMode={worldMode} />
              <AgentActivityFeed game={game} busy={busy} />
            </div>
          </div>
        </section>
      </div>

      {game.phase === "completed" && game.llm_reports && showReports && (
        <CompletedReports
          reports={game.llm_reports}
          portfolio={game.portfolio}
          initialEquity={game.initial_equity}
          game={game}
          onBack={() => {
            setShowReports(false);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}

      <footer className="paper-run-footer">
        <span>GAME {game.game_id.slice(0, 22)}</span>
        <span>
          {worldMode
            ? "World Agent의 사건은 시작 전 실제 유사 사례를 검색해 만든 교육용 가상 전개"
            : game.event_provenance?.mode === "ontology_events"
            ? `실제 시장 사건 기반${game.event_provenance.sector ? ` · ${game.event_provenance.sector}` : ""}` +
              ` · 후보 ${(game.event_provenance.macro_candidates ?? 0) + (game.event_provenance.micro_candidates ?? 0)}건`
            : "AI 생성 가상 이벤트"} · 실제 투자 결과를 보장하지 않는 교육용 시뮬레이션입니다.
        </span>
      </footer>
    </div>
  );
}

/* ----------------------------------------------------------------- main */

export function PaperTradingModal({ onClose }: { onClose: () => void }) {
  const [game, setGame] = useState<ScenarioGame | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [stalled, setStalled] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const busy = job?.status === "queued" || job?.status === "running";

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refreshGame = useCallback(async (gameId: string) => {
    const payload = await callApi<{ data: ScenarioGame }>(`/games/${gameId}`);
    setGame(payload.data);
    return payload.data;
  }, []);

  const pollJob = useCallback((jobId: string, gameId: string): Promise<ScenarioGame | null> => {
    let lastStamp = "";
    let lastMessage = "";
    let lastChangeAt = Date.now();
    return new Promise((resolve) => {
      const tick = async () => {
        try {
        const payload = await callApi<{ data: Job }>(`/scenario-jobs/${jobId}`);
        const next = payload.data;
        setJob(next);

        const stamp = next.updated_at ?? "";
        if (stamp !== lastStamp) {
          lastStamp = stamp;
          lastChangeAt = Date.now();
          setStalled(false);
        }
        // 진행 메시지가 바뀌면 거래일 하나가 끝난 것이다. 그때마다 게임을 다시
        // 읽어 캔들과 반응 피드가 작업 중에도 자라게 한다.
        if (next.message !== lastMessage) {
          lastMessage = next.message;
          if (next.status === "running") void refreshGame(gameId).catch(() => undefined);
        }
        if (stamp === lastStamp && Date.now() - lastChangeAt > STALL_NOTICE_MS) {
          setStalled(true);
        }
        if (next.status === "completed") {
          const latest = await refreshGame(gameId);
          setJob(null);
          setStalled(false);
          resolve(latest);
          return;
        }
        if (next.status === "failed") {
          setError(next.error ?? "작업이 실패했습니다.");
          setJob(null);
          setStalled(false);
          await refreshGame(gameId).catch(() => undefined);
          resolve(null);
          return;
        }
        pollRef.current = setTimeout(tick, 1400);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "진행 상태를 확인하지 못했습니다.");
        setJob(null);
        setStalled(false);
        resolve(null);
        }
      }
      pollRef.current = setTimeout(tick, 900);
    });
  }, [refreshGame]);

  const start = useCallback(async (input: {
    ticker: string; name: string; initialCash: number;
    investmentMode: InvestmentMode; initialPosition?: { quantity: number; averagePrice: number };
    simulationDays: number; initialContextId: string;
  }) => {
    setStarting(true);
    setError(null);
    try {
      const payload = await callApi<{ data: ScenarioGame }>("/scenarios", {
        method: "POST",
        body: JSON.stringify({
          ticker: input.ticker,
          initial_cash: input.initialCash,
          initial_position: input.initialPosition
            ? { quantity: input.initialPosition.quantity, average_price: input.initialPosition.averagePrice }
            : undefined,
          investment_mode: input.investmentMode,
          simulation_days: input.simulationDays,
          context_id: input.initialContextId,
          // 캐시 리플레이 이력은 종가만 있어 캔들이 선으로 뭉개진다.
          // finverse는 실제 OHLC를 쓰고, DB가 죽었을 때만 백엔드가 캐시로 내려간다.
          prefer_live_finverse: true,
        }),
      });
      setGame(payload.data);

      // 시작 화면에서는 0일차를 보여주지 않고 첫 거래일을 한 번 자동 진행한다.
      // 이후 거래일은 사용자가 다음 거래일 진행 버튼으로 한 번씩 연다.
      const firstAction = payload.data.mode === "world"
        ? "advance"
        : payload.data.phase === "inter_event_market"
          ? "advance_days"
          : null;
      if (firstAction) {
        try {
          const actionPayload = await callApi<{ data: Job }>(`/scenarios/${payload.data.game_id}/actions`, {
            method: "POST",
            body: JSON.stringify({ action: firstAction, days: 1 }),
          });
          setJob(actionPayload.data);
          pollJob(actionPayload.data.job_id, payload.data.game_id);
        } catch (cause) {
          setError(cause instanceof Error
            ? `첫 거래일을 자동으로 진행하지 못했습니다: ${cause.message}`
            : "첫 거래일을 자동으로 진행하지 못했습니다. 다음 거래일 진행 버튼으로 다시 시도해주세요.");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "시나리오를 만들지 못했습니다.");
    } finally {
      setStarting(false);
    }
  }, [pollJob]);

  const advance = useCallback(async (days?: number): Promise<ScenarioGame | null> => {
    if (!game || busy) return null;
    setError(null);
    setStalled(false);
    const meta = PHASE_META[game.phase];
    try {
      const payload = await callApi<{ data: Job }>(`/scenarios/${game.game_id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: meta.action, ...(days ? { days } : {}) }),
      });
      setJob(payload.data);
      return await pollJob(payload.data.job_id, game.game_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "다음 단계를 시작하지 못했습니다.");
      return null;
    }
  }, [game, busy, pollJob]);

  const submitOrder = useCallback(async (input: { side: "BUY" | "SELL"; quantity: number; rationale: string; confidence: number }) => {
    if (!game) return;
    setOrderSubmitting(true);
    setError(null);
    try {
      const payload = await callApi<{ game: ScenarioGame }>(`/scenarios/${game.game_id}/orders`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      setGame(payload.game);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "주문을 접수하지 못했습니다.");
    } finally {
      setOrderSubmitting(false);
    }
  }, [game]);

  const recordDailyReflection = useCallback(async (stance: DailyReflection["stance"], quantity = 0) => {
    if (!game || busy) return;
    setError(null);
    try {
      const payload = await callApi<{ game: ScenarioGame }>(`/scenarios/${game.game_id}/daily-reflections`, {
        method: "POST",
        body: JSON.stringify({ stance, quantity }),
      });
      setGame(payload.game);
      if (payload.game.phase === "world_decision") {
        const actionPayload = await callApi<{ data: Job }>(`/scenarios/${game.game_id}/actions`, {
          method: "POST",
          body: JSON.stringify({ action: "resolve" }),
        });
        setJob(actionPayload.data);
        pollJob(actionPayload.data.job_id, game.game_id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "오늘의 판단을 기록하지 못했습니다.");
    }
  }, [busy, game, pollJob]);

  return (
    <div className="modal-backdrop paper-trading-backdrop" onMouseDown={onClose}>
      <section
        className={`scenario-modal paper-trading-modal ${game ? "running" : "setup"}`}
        role="dialog"
        aria-modal="true"
        aria-label="모의 투자 시뮬레이션"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {game
          ? <TradingScreen
              game={game}
              busy={busy}
              stalled={stalled}
              error={error}
              orderSubmitting={orderSubmitting}
              onOrder={submitOrder}
              onDailyReflection={recordDailyReflection}
              onAdvance={advance}
            />
          : <SetupScreen onStart={start} starting={starting} error={error} onClose={onClose} />}
      </section>
    </div>
  );
}
