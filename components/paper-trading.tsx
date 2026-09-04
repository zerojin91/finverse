"use client";

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CandlestickChart,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Flag,
  Landmark,
  LoaderCircle,
  MessageSquare,
  Radio,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

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
  status: "hidden" | "revealed";
  event_date: string;
  pre_brief: string;
  trading_days_until: number;
  title?: string;
  description?: string;
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
  rationale?: string;
  filled_quantity?: number;
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
};

type PendingOrder = {
  order_id: string;
  side: "BUY" | "SELL";
  quantity: number;
  status: string;
  rationale?: string;
  confidence?: number | null;
};

type Phase = "inter_event_market" | "pre_event_decision" | "post_event_decision" | "completed";

type ScenarioGame = {
  game_id: string;
  ticker: string;
  name: string;
  phase: Phase;
  status: string;
  current_price: number;
  initial_reference_price: number;
  current_event: ScenarioEvent | null;
  current_event_index: number;
  total_events: number;
  portfolio: Portfolio;
  price_history: PricePoint[];
  pending_orders: PendingOrder[];
  released_signals: LeadSignal[];
  scenario_premise?: string;
  simulation_days?: number;
  practice_mode?: PracticeMode;
  investment_mode?: InvestmentMode;
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

type LlmReport = {
  quantitative_summary?: string;
  executive_summary?: string;
  investor_profile?: string;
  event_reviews?: { event: string; market_reaction: string; user_decision: string; lesson: string }[];
  strengths?: string[];
  risk_patterns?: string[];
  action_plan?: string[];
};

type Assessment = {
  style?: string;
  metrics?: Record<string, number | null>;
  findings?: string[];
  lessons?: { topic: string; message: string }[];
  llm_report?: LlmReport | null;
  disclaimer?: string;
};

type GameSummary = {
  game_id: string;
  ticker: string;
  name: string;
  phase: Phase;
  scenario_premise?: string;
  current_event_index: number;
  total_events: number;
  market_days: number;
  total_return_pct: number | null;
  updated_at?: string;
};

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
const PLATFORM_LABEL: Record<string, string> = { reddit: "커뮤니티", x: "X" };

const PHASE_META: Record<Phase, {
  label: string;
  eyebrow: string;
  action: "advance_days" | "reveal" | "continue" | "report";
  cta: string;
  guide: string;
  todo: string[];
  canOrder: boolean;
}> = {
  inter_event_market: {
    label: "자율 거래 구간",
    eyebrow: "INTER-EVENT MARKET",
    action: "advance_days",
    cta: "이벤트 직전까지 장 진행",
    guide: "에이전트들이 사전 신호만 보고 스스로 거래합니다. 지금은 주문을 낼 수 없고, 흘러나오는 신호를 읽는 것이 과제입니다.",
    todo: [
      "*하루만* 버튼으로 한 거래일씩 넘기며 반응을 보거나, *장 진행*으로 이벤트 직전까지 한 번에 갈 수 있습니다.",
      "하루가 지날 때마다 캔들이 쌓이고, 40명의 에이전트 반응이 오른쪽 피드에 올라옵니다.",
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
  completed: {
    label: "시나리오 종료",
    eyebrow: "SCENARIO COMPLETE",
    action: "report",
    cta: "AI 투자 리포트 생성",
    guide: "모든 이벤트가 끝났습니다. 매 판단의 근거와 결과를 묶어 교육용 리포트를 만들 수 있습니다.",
    todo: [
      "모든 이벤트가 끝났습니다. 최종 수익률과 캔들 전체 경로를 확인하세요.",
      "*AI 투자 리포트 생성*을 누르면 매 판단의 근거와 결과를 묶어 회고를 만듭니다.",
    ],
    canOrder: false,
  },
};

const STEP_ORDER: Phase[] = [
  "inter_event_market", "pre_event_decision", "post_event_decision", "completed",
];
const STEP_LABEL: Record<Phase, string> = {
  inter_event_market: "관망",
  pre_event_decision: "사전 판단",
  post_event_decision: "사후 대응",
  completed: "회고",
};

/** `*강조*` 표기만 굵게 바꿔 안내 문구를 읽기 쉽게 만든다. */
function emphasise(text: string) {
  return text.split(/\*([^*]+)\*/g).map((chunk, index) =>
    index % 2 ? <b key={index}>{chunk}</b> : <span key={index}>{chunk}</span>);
}

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
const VOLUME_H = 42;

/** 실제 이력 봉과 시뮬레이션 봉을 하나의 시계열로 합친다. */
type CandleChartData = Pick<ScenarioGame, "history_candles" | "price_history" | "initial_reference_price" | "revealed_events" | "fills">;

function buildBars(game: CandleChartData, limit = 46): Bar[] {
  const bars: Bar[] = [];
  const seen = new Set<string>();

  for (const row of game.history_candles ?? []) {
    if (!row.close || seen.has(row.market_date)) continue;
    seen.add(row.market_date);
    bars.push({
      key: `real-${row.market_date}`,
      date: row.market_date,
      label: "시나리오 이전 실제 이력",
      open: row.open, high: row.high, low: row.low, close: row.close,
      volume: row.volume ?? 0, real: true, event: false, returnPct: 0,
    });
  }

  for (const point of game.price_history ?? []) {
    const close = point.close ?? point.price;
    if (!close) continue;
    // 시작 봉은 실제 이력의 마지막 날과 같은 날짜다. 두 번 그리지 않는다.
    if (point.step === 0 && seen.has(point.market_date ?? "")) continue;
    bars.push({
      key: `sim-${point.step}`,
      date: point.market_date ?? "",
      label: point.label,
      open: point.open ?? close,
      high: point.high ?? close,
      low: point.low ?? close,
      close,
      volume: point.volume ?? 0,
      real: point.step === 0,
      event: point.phase === "event_reaction",
      returnPct: point.return_pct ?? 0,
    });
  }

  return bars.slice(-limit);
}

function CandleChart({ game, preview = false }: { game: CandleChartData; preview?: boolean }) {
  const bars = useMemo(() => buildBars(game), [game]);
  const [hovered, setHovered] = useState<number | null>(null);

  const layout = useMemo(() => {
    if (bars.length < 2) return null;
    const reference = game.initial_reference_price;
    const rawTop = Math.max(...bars.map((bar) => bar.high), reference);
    const rawBottom = Math.min(...bars.map((bar) => bar.low), reference);
    const pad = (rawTop - rawBottom) * 0.12 || Math.max(rawTop * 0.01, 1);
    const top = rawTop + pad;
    const bottom = Math.max(rawBottom - pad, 0);
    const span = top - bottom || 1;
    const slot = (CHART_W - AXIS_W) / bars.length;
    return {
      top, bottom, span, slot,
      bodyW: Math.max(2, Math.min(13, slot * 0.6)),
      maxVolume: Math.max(...bars.map((bar) => bar.volume), 1),
      simStart: bars.findIndex((bar) => !bar.real),
      y: (value: number) => ((top - value) / span) * PRICE_H,
      cx: (index: number) => index * slot + slot / 2,
    };
  }, [bars, game.initial_reference_price]);

  if (!layout) {
    return (
      <div className="paper-chart-empty">
        <CandlestickChart size={22} />
        <strong>아직 열린 장이 없습니다</strong>
        <p>오른쪽 아래 진행 버튼을 누르면 하루씩 장이 열리고 캔들이 쌓입니다.</p>
      </div>
    );
  }

  const { top, span, slot, bodyW, maxVolume, simStart, y, cx } = layout;
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => top - span * ratio);

  // 사용자 체결은 해당 이벤트가 반응한 봉 위에 표시한다. 사전 판단은 왼쪽,
  // 사후 대응은 오른쪽으로 살짝 밀어 두 주문이 겹치지 않게 한다.
  const eventBars = bars.reduce<number[]>(
    (acc, bar, index) => (bar.event ? [...acc, index] : acc), []);
  const eventOrder = (game.revealed_events ?? []).map((item) => item.event_id);
  const markers = (game.fills ?? []).flatMap((fill, index) => {
    const position = eventOrder.indexOf(fill.event_id ?? "");
    const barIndex = eventBars[position >= 0 ? position : eventBars.length - 1];
    if (barIndex === undefined) return [];
    return [{
      key: fill.order_id ?? `fill-${index}`,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      x: cx(barIndex) + (fill.phase === "pre_event_decision" ? -bodyW : bodyW),
      y: y(fill.price),
    }];
  });

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

      <svg
        className="paper-chart-svg"
        viewBox={`0 0 ${CHART_W} ${PRICE_H + VOLUME_H + 22}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={preview ? "최근 실제 캔들 차트" : "시나리오 캔들 차트"}
        onMouseLeave={() => setHovered(null)}
      >
        {gridValues.map((value) => (
          <g key={value}>
            <line className="paper-chart-grid" x1={0} y1={y(value)} x2={CHART_W - AXIS_W} y2={y(value)} />
            <text className="paper-chart-axis" x={CHART_W - AXIS_W + 6} y={y(value) + 3}>
              {Math.round(value).toLocaleString("ko-KR")}
            </text>
          </g>
        ))}

        {!preview && (
          <line
            className="paper-chart-reference"
            x1={0} x2={CHART_W - AXIS_W}
            y1={y(game.initial_reference_price)} y2={y(game.initial_reference_price)}
          />
        )}

        {simStart > 0 && (
          <g>
            <line
              className="paper-chart-divider"
              x1={cx(simStart) - slot / 2} x2={cx(simStart) - slot / 2}
              y1={0} y2={PRICE_H + VOLUME_H + 6}
            />
            <text className="paper-chart-divider-label" x={cx(simStart) - slot / 2 + 5} y={11}>
              시뮬레이션 시작
            </text>
          </g>
        )}

        {bars.map((bar, index) => {
          const rising = bar.close >= bar.open;
          const flat = bar.high === bar.low && bar.open === bar.close;
          const bodyTop = y(Math.max(bar.open, bar.close));
          const bodyHeight = Math.max(1.4, Math.abs(y(bar.open) - y(bar.close)));
          const tone = preview ? (rising ? "up" : "down") : (bar.real ? "real" : rising ? "up" : "down");
          return (
            <g key={bar.key} className={`paper-candle ${tone} ${hovered === index ? "hovered" : ""}`}>
              {bar.event && <line className="paper-candle-event" x1={cx(index)} x2={cx(index)} y1={0} y2={PRICE_H} />}
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
                className="paper-candle-volume"
                x={cx(index) - bodyW / 2}
                y={PRICE_H + 10 + (VOLUME_H - (bar.volume / maxVolume) * VOLUME_H)}
                width={bodyW}
                height={Math.max(0.8, (bar.volume / maxVolume) * VOLUME_H)}
              />
              <rect
                className="paper-candle-hit"
                x={index * slot} y={0} width={slot} height={PRICE_H + VOLUME_H + 12}
                onMouseEnter={() => setHovered(index)}
              />
            </g>
          );
        })}

        {markers.map((marker) => (
          <g key={marker.key} className={`paper-fill-marker ${marker.side === "BUY" ? "buy" : "sell"}`}>
            <title>{`내 ${marker.side === "BUY" ? "매수" : "매도"} ${marker.quantity.toLocaleString("ko-KR")}주 · ${won(marker.price)}`}</title>
            <path d={marker.side === "BUY"
              ? `M ${marker.x} ${marker.y - 7} l 5 8 l -10 0 z`
              : `M ${marker.x} ${marker.y + 7} l 5 -8 l -10 0 z`} />
          </g>
        ))}
      </svg>

      <div className="paper-chart-dates">
        <span>{bars[0].date}</span>
        {simStart > 0 && <span>{bars[simStart]?.date}</span>}
        <span>{bars[bars.length - 1].date}</span>
      </div>

      <div className="paper-chart-legend">
        {preview ? (
          <><span className="up">양봉</span><span className="down">음봉</span><span className="real">실제 일봉</span></>
        ) : (
          <><span className="real">시나리오 이전 이력</span><span className="up">양봉</span><span className="down">음봉</span><span className="event">이벤트 공개일</span><span className="buy">내 매수</span><span className="sell">내 매도</span></>
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

/* ------------------------------------------------------------ psychology */

function PsychologyStrip({ round }: { round?: AgentRound }) {
  const groups = round?.psychology?.groups;
  if (!groups) return null;
  return (
    <div className="paper-psych">
      <div className="paper-psych-title">
        <Users size={12} />
        <span>투자자별 심리</span>
        <em>{round?.market_date ?? round?.label}</em>
      </div>
      <div className="paper-psych-rows">
        {Object.entries(GROUP_LABEL).map(([key, label]) => {
          const state = groups[key];
          if (!state) return null;
          const width = Math.min(50, Math.abs(state.sentiment) * 50);
          return (
            <div className={`paper-psych-row ${toneOf(state.sentiment)}`} key={key}>
              <span>{label}</span>
              <i>
                <b style={state.sentiment >= 0
                  ? { left: "50%", width: `${width}%` }
                  : { right: "50%", width: `${width}%` }} />
              </i>
              <em>{signedPct(state.sentiment * 100)}</em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- reaction feed */

function ReactionFeed({ game, busy, job }: { game: ScenarioGame; busy: boolean; job: Job | null }) {
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
        <p>장을 진행하면 40명의 에이전트가 커뮤니티와 X에 남긴 반응, 그리고 그날의 수급이 여기에 쌓입니다.</p>
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

/* ------------------------------------------------------------ report view */

const METRIC_LABEL: [string, string, (value: number) => string][] = [
  ["total_return_pct", "총 수익률", (value) => signedPct(value)],
  ["completed_events", "완료 이벤트", (value) => `${value}건`],
  ["pre_event_trades", "이벤트 전 거래", (value) => `${value}회`],
  ["post_event_trades", "이벤트 후 거래", (value) => `${value}회`],
  ["autonomous_market_days", "자율 거래일", (value) => `${value}일`],
  ["max_price_drawdown_pct", "최대 낙폭", (value) => `${value.toFixed(2)}%`],
  ["turnover_ratio", "자본 회전율", (value) => `${value.toFixed(2)}배`],
  ["average_confidence", "평균 확신도", (value) => `${value}%`],
];

function ReportView({
  assessment, canGenerate, generating, onGenerate,
}: {
  assessment: Assessment;
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
  const report = assessment.llm_report;
  const metrics = assessment.metrics ?? {};

  return (
    <div className="paper-report">
      <div className="paper-report-head">
        <div>
          <span>투자 성향</span>
          <strong>{assessment.style ?? "분석 중"}</strong>
        </div>
        {typeof metrics.total_return_pct === "number" && (
          <b className={toneOf(metrics.total_return_pct)}>{signedPct(metrics.total_return_pct)}</b>
        )}
      </div>

      <div className="paper-report-metrics">
        {METRIC_LABEL.map(([key, label, format]) => {
          const value = metrics[key];
          if (typeof value !== "number") return null;
          return (
            <div key={key}>
              <span>{label}</span>
              <strong className={key.endsWith("_pct") ? toneOf(value) : ""}>{format(value)}</strong>
            </div>
          );
        })}
      </div>

      {Boolean(assessment.findings?.length) && (
        <ul className="paper-report-findings">
          {assessment.findings?.map((finding) => <li key={finding}>{finding}</li>)}
        </ul>
      )}

      {Boolean(assessment.lessons?.length) && (
        <div className="paper-report-lessons">
          {assessment.lessons?.map((lesson) => (
            <div key={lesson.topic}>
              <b>{lesson.topic}</b>
              <p>{lesson.message}</p>
            </div>
          ))}
        </div>
      )}

      {report ? (
        <div className="paper-report-llm">
          {report.quantitative_summary && (
            <p className="paper-report-verified">{report.quantitative_summary}</p>
          )}
          {report.executive_summary && <p className="paper-report-summary">{report.executive_summary}</p>}
          {report.investor_profile && (
            <blockquote className="paper-report-profile">{report.investor_profile}</blockquote>
          )}

          {Boolean(report.event_reviews?.length) && (
            <div className="paper-report-events">
              {report.event_reviews?.map((review) => (
                <article key={review.event}>
                  <b>{review.event}</b>
                  <p><span>시장 반응</span>{review.market_reaction}</p>
                  <p><span>내 판단</span>{review.user_decision}</p>
                  <em>{review.lesson}</em>
                </article>
              ))}
            </div>
          )}

          <div className="paper-report-lists">
            {([["강점", report.strengths, "good"], ["주의 패턴", report.risk_patterns, "risk"],
               ["다음 원칙", report.action_plan, "plan"]] as const).map(([title, items, tone]) =>
              items?.length ? (
                <div className={tone} key={title}>
                  <b>{title}</b>
                  {items.map((item) => <p key={item}>{item}</p>)}
                </div>
              ) : null)}
          </div>
        </div>
      ) : (
        <div className="paper-report-cta">
          <p>
            {canGenerate
              ? "여기까지의 판단 기록으로 AI 종합 리포트를 만들 수 있습니다. 매 이벤트에서 무엇을 보고 어떻게 움직였는지 근거 중심으로 되짚어줍니다."
              : "모든 이벤트를 마치면 AI 종합 리포트를 만들 수 있습니다. 위 지표는 지금까지의 판단을 계산한 값입니다."}
          </p>
          {canGenerate && (
            <button type="button" onClick={onGenerate} disabled={generating}>
              {generating
                ? <><LoaderCircle size={14} className="spin" /> 리포트 작성 중</>
                : <><Sparkles size={14} /> AI 종합 리포트 생성</>}
            </button>
          )}
        </div>
      )}

      {assessment.disclaimer && <p className="paper-report-disclaimer">{assessment.disclaimer}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- setup */

type InvestmentMode = "new" | "holding";
type PracticeMode = "balanced" | "stress" | "opportunity" | "random";

const CASH_PRESETS = [10_000_000, 50_000_000, 100_000_000];
const COLLECTION_STEP_MIN_MS = 1_500;
const DURATION_OPTIONS = [
  { days: 10, label: "10거래일", caption: "단기 흐름" },
  { days: 20, label: "20거래일", caption: "한 달 연습" },
  { days: 60, label: "60거래일", caption: "중기 판단" },
];
const PRACTICE_OPTIONS: { key: PracticeMode; label: string; caption: string }[] = [
  { key: "balanced", label: "균형 판단", caption: "호재와 악재를 고르게 경험" },
  { key: "stress", label: "위기 대응", caption: "악재와 변동성 대응에 집중" },
  { key: "opportunity", label: "기회 포착", caption: "호재 신호와 진입 판단에 집중" },
  { key: "random", label: "무작위 실전", caption: "사건 구성을 매번 다르게" },
];

const parsePositiveInteger = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0;

function SetupScreen({
  onStart,
  onResume,
  starting,
  error,
  onClose,
}: {
  onStart: (input: {
    ticker: string; name: string; initialCash: number;
    investmentMode: InvestmentMode; initialPosition?: { quantity: number; averagePrice: number };
    simulationDays: number; practiceMode: PracticeMode;
  }) => void;
  onResume: (gameId: string) => void;
  starting: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState<GameSummary[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Security[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Security | null>(null);
  const [previewCandles, setPreviewCandles] = useState<HistoryCandle[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [collectionSources, setCollectionSources] = useState<CollectionSource[] | null>(null);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [collectionDwellComplete, setCollectionDwellComplete] = useState(false);
  const [investmentMode, setInvestmentMode] = useState<InvestmentMode | null>(null);
  const [investmentConfirmed, setInvestmentConfirmed] = useState(false);
  const [initialCash, setInitialCash] = useState(50_000_000);
  const [averagePrice, setAveragePrice] = useState(0);
  const [holdingQuantity, setHoldingQuantity] = useState(0);
  const [simulationDays, setSimulationDays] = useState(20);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("balanced");
  const pickedTicker = picked?.ticker;
  const step2Ref = useRef<HTMLElement | null>(null);
  const step3Ref = useRef<HTMLElement | null>(null);
  const step4Ref = useRef<HTMLElement | null>(null);
  const collectionReady = Boolean(collectionSources?.every((source) => source.status === "ready"));
  const collectionStepComplete = collectionReady && collectionDwellComplete;
  const investmentReady = investmentMode === "new"
    ? initialCash > 0
    : investmentMode === "holding" && averagePrice > 0 && holdingQuantity > 0;
  const activeStep = investmentConfirmed ? 4 : collectionStepComplete ? 3 : pickedTicker ? 2 : 1;

  useEffect(() => {
    let cancelled = false;
    callApi<{ data: GameSummary[] }>("/games?summary=1&limit=6")
      .then((payload) => {
        if (cancelled) return;
        setSaved((payload.data ?? []).filter((row) => row.total_events > 0));
      })
      // 이어하기 목록은 부가 기능이다. 실패해도 새 시나리오 생성은 막지 않는다.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

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
    if (!pickedTicker) return;
    const timer = window.setTimeout(() => {
      setCollectionDwellComplete(true);
    }, COLLECTION_STEP_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [pickedTicker]);

  useEffect(() => {
    if (!pickedTicker) return;
    let cancelled = false;
    callApi<{ data: { sources: CollectionSource[] } }>(`/securities/${encodeURIComponent(pickedTicker)}/scenario-context`)
      .then((payload) => {
        if (!cancelled) setCollectionSources(payload.data?.sources ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setCollectionError(cause instanceof Error ? cause.message : "시나리오 자료를 수집하지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, [pickedTicker]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!picked || !investmentMode || !investmentConfirmed || starting || initialCash < 0) return;
    if (investmentMode === "new" && initialCash <= 0) return;
    if (investmentMode === "holding" && (!averagePrice || !holdingQuantity)) return;
    onStart({
      ticker: picked.ticker, name: picked.name,
      initialCash: investmentMode === "new" ? initialCash : 0,
      investmentMode, simulationDays, practiceMode,
      initialPosition: investmentMode === "holding"
        ? { quantity: holdingQuantity, averagePrice }
        : undefined,
    });
  };

  const selectSecurity = (item: Security) => {
    if (picked?.ticker !== item.ticker) {
      setInvestmentMode(null);
      setInvestmentConfirmed(false);
      setAveragePrice(0);
      setHoldingQuantity(0);
    }
    setPreviewCandles(null);
    setPreviewError(null);
    setCollectionSources(null);
    setCollectionError(null);
    setCollectionDwellComplete(false);
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
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
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

      {Boolean(saved.length) && (
        <section className="paper-setup-block">
          <div className="paper-setup-heading"><span>이어서 하기</span><h3>진행 중인 시나리오가 있습니다</h3></div>
          <div className="paper-resume-list">
            {saved.map((row) => (
              <button key={row.game_id} type="button" onClick={() => onResume(row.game_id)} disabled={starting}>
                <div>
                  <strong>{row.name}</strong>
                  <span>{PHASE_META[row.phase]?.label ?? row.phase}</span>
                </div>
                <p>{row.scenario_premise || "이벤트 시나리오 모의 투자"}</p>
                <footer>
                  <em>이벤트 {Math.min(row.current_event_index + 1, row.total_events)}/{row.total_events} · {row.market_days}거래일</em>
                  {typeof row.total_return_pct === "number" && (
                    <b className={toneOf(row.total_return_pct)}>{signedPct(row.total_return_pct)}</b>
                  )}
                </footer>
              </button>
            ))}
          </div>
        </section>
      )}

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
                setCollectionSources(null);
                setCollectionError(null);
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
                  revealed_events: [], fills: [],
                }}
              />
            )}
          </section>
        )}
      </section>

      {picked && (
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
          <button type="button" className={investmentMode === "new" ? "active" : ""} aria-pressed={investmentMode === "new"} onClick={() => { setInvestmentMode("new"); setInvestmentConfirmed(false); }}>
            <CircleDollarSign size={15} /><span><strong>새로 투자하기</strong><small>현금으로 처음 시작</small></span>
          </button>
          <button type="button" className={investmentMode === "holding" ? "active" : ""} aria-pressed={investmentMode === "holding"} onClick={() => { setInvestmentMode("holding"); setInvestmentConfirmed(false); }}>
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
              <input id="paper-initial-cash" inputMode="numeric" value={initialCash ? initialCash.toLocaleString("ko-KR") : ""} onChange={(event) => { setInitialCash(parsePositiveInteger(event.target.value)); setInvestmentConfirmed(false); }} aria-label="투자할 금액" />
              <span>원</span>
            </div>
            <div className="paper-money-presets" aria-label="투자 금액 빠른 선택">
              {CASH_PRESETS.map((cash) => (
                <button key={cash} type="button" className={initialCash === cash ? "active" : ""} aria-pressed={initialCash === cash} onClick={() => { setInitialCash(cash); setInvestmentConfirmed(false); }}>+ {compactWon(cash)}원</button>
              ))}
            </div>
          </div>
        )}
        {investmentMode === "holding" && (
          <div className="paper-holding-inputs">
            <label htmlFor="paper-average-price"><span>평균 매입가</span><div><input id="paper-average-price" inputMode="numeric" value={averagePrice ? averagePrice.toLocaleString("ko-KR") : ""} onChange={(event) => { setAveragePrice(parsePositiveInteger(event.target.value)); setInvestmentConfirmed(false); }} /><em>원</em></div></label>
            <label htmlFor="paper-holding-quantity"><span>보유 수량</span><div><input id="paper-holding-quantity" inputMode="numeric" value={holdingQuantity ? holdingQuantity.toLocaleString("ko-KR") : ""} onChange={(event) => { setHoldingQuantity(parsePositiveInteger(event.target.value)); setInvestmentConfirmed(false); }} /><em>주</em></div></label>
          </div>
        )}
        {investmentMode && <p className="paper-setting-note"><CheckCircle2 size={13} /> {investmentMode === "holding" ? "입력한 보유 종목만으로 시작하며 추가 투자금은 사용하지 않습니다." : "실제 주문이나 계좌 연결 없이 입력한 조건으로만 연습합니다."}</p>}
        {investmentMode && (
          <button className="paper-start-button" type="button" disabled={!investmentReady} onClick={() => setInvestmentConfirmed(true)}>
            투자 상태 설정 완료 <ArrowRight size={14} />
          </button>
        )}
      </section>
      )}

      {investmentConfirmed && (
      <section ref={step4Ref} className="paper-setup-block paper-setup-reveal">
        <div className="paper-setup-heading"><span>04 · 시뮬레이션 설정</span><h3>어떤 방식으로 연습할까요?</h3></div>
        <div className="paper-simulation-field">
          <div className="paper-simulation-label"><span>연습 기간</span><small>거래일 기준</small></div>
          <div className="paper-duration-options">
            {DURATION_OPTIONS.map((option) => (
              <button key={option.days} type="button" className={simulationDays === option.days ? "active" : ""} aria-pressed={simulationDays === option.days} onClick={() => setSimulationDays(option.days)}>
                <strong>{option.label}</strong><small>{option.caption}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="paper-simulation-field">
          <div className="paper-simulation-label"><span>연습 유형</span><small>수집 자료에서 어떤 사건을 우선 구성할지 선택</small></div>
          <div className="paper-practice-options">
            {PRACTICE_OPTIONS.map((option) => (
              <button key={option.key} type="button" className={practiceMode === option.key ? "active" : ""} aria-pressed={practiceMode === option.key} onClick={() => setPracticeMode(option.key)}>
                <span>{practiceMode === option.key && <CheckCircle2 size={13} />}<strong>{option.label}</strong></span>
                <small>{option.caption}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
      )}

      {investmentConfirmed && (
        <>
          <div className="paper-hint paper-setup-reveal">
            <CalendarClock size={13} />
            사건 수와 시장 참여자는 선택한 기간과 수집 자료에 맞춰 자동으로 구성됩니다. 거래일 하나를 넘기는 데 15~25초 정도 걸립니다.
          </div>

          <button className="paper-start-button paper-setup-reveal" type="submit" disabled={starting}>
            {starting
              ? <><LoaderCircle size={17} className="spin" /> 수집한 자료로 시나리오를 만들고 있습니다</>
              : <><CircleDollarSign size={17} /> 모의 투자 시작하기 <ArrowRight size={16} /></>}
          </button>
          {starting && (
            <p className="paper-start-note">
              수집한 시장·경제·사건·커뮤니티 자료를 바탕으로 시나리오를 구성합니다. 최초 조회는 30초 정도 걸릴 수 있습니다.
            </p>
          )}
        </>
      )}

      {error && <p className="paper-error"><AlertTriangle size={14} /> {error}</p>}
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

function CoachOverlay({ onDone }: { onDone: () => void }) {
  return (
    <div className="paper-coach" role="dialog" aria-label="모의 투자 사용 방법">
      <div className="paper-coach-card">
        <span>HOW IT WORKS</span>
        <h3>한 번의 이벤트를 네 단계로 겪습니다</h3>
        <ol>
          <li><b>관망</b><p>이벤트 직전까지 하루씩 장이 열립니다. 40명의 에이전트가 스스로 거래하고, 뉴스·루머가 순서대로 흘러나옵니다. 주문은 낼 수 없습니다.</p></li>
          <li><b>사전 판단</b><p>이벤트 내용은 아직 비공개입니다. 신호만 보고 매수·매도를 담습니다. 담지 않으면 관망으로 기록됩니다.</p></li>
          <li><b>공개와 대응</b><p>이벤트가 드러나고 시장이 반응합니다. 과잉 반응인지 추세인지 판단해 다시 주문합니다.</p></li>
          <li><b>회고</b><p>모든 이벤트가 끝나면 매 판단의 근거와 결과를 묶은 리포트를 받습니다.</p></li>
        </ol>
        <button type="button" onClick={onDone}>시작하기 <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

function PhaseStepper({ phase }: { phase: Phase }) {
  const active = STEP_ORDER.indexOf(phase);
  return (
    <ol className="paper-stepper">
      {STEP_ORDER.map((step, index) => (
        <li key={step} className={index < active ? "done" : index === active ? "active" : ""}>
          <i>{index < active ? <CheckCircle2 size={12} /> : index + 1}</i>
          <span>{STEP_LABEL[step]}</span>
        </li>
      ))}
    </ol>
  );
}

function TradingScreen({
  game,
  job,
  busy,
  stalled,
  error,
  assessment,
  orderSubmitting,
  onOrder,
  onAdvance,
  onReset,
  onClose,
}: {
  game: ScenarioGame;
  job: Job | null;
  busy: boolean;
  stalled: boolean;
  error: string | null;
  assessment: Assessment | null;
  orderSubmitting: boolean;
  onOrder: (input: { side: "BUY" | "SELL"; quantity: number; rationale: string; confidence: number }) => void;
  onAdvance: (days?: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  // 모달은 사용자가 열었을 때만 마운트되므로 첫 렌더에서 바로 읽어도 안전하다.
  // 저장소 접근이 막힌 브라우저에서는 안내를 띄우지 않는다.
  const [coach, setCoach] = useState(() => {
    try { return window.localStorage.getItem(COACH_KEY) !== "done"; } catch { return false; }
  });
  const dismissCoach = useCallback(() => {
    setCoach(false);
    try { window.localStorage.setItem(COACH_KEY, "done"); } catch { /* 무시 */ }
  }, []);

  // 사용자가 직접 고르기 전까지는 시나리오가 끝났을 때 회고를 먼저 보여준다.
  const [tabChoice, setTabChoice] = useState<"feed" | "report" | null>(null);
  const tab = tabChoice ?? (game.phase === "completed" && assessment ? "report" : "feed");

  const meta = PHASE_META[game.phase] ?? PHASE_META.inter_event_market;
  const portfolio = game.portfolio;
  const returnTone = toneOf(portfolio.total_return_pct);
  const priceChangePct = game.initial_reference_price
    ? ((game.current_price - game.initial_reference_price) / game.initial_reference_price) * 100
    : 0;
  const priceTone = toneOf(priceChangePct);
  const eventProgress = game.total_events
    ? Math.min(100, ((game.phase === "completed" ? game.total_events : game.current_event_index) / game.total_events) * 100)
    : 0;
  const latestRound = game.agent_rounds?.[game.agent_rounds.length - 1];
  const event = game.current_event;

  return (
    <div className="paper-run">
      {coach && <CoachOverlay onDone={dismissCoach} />}

      <header className="paper-run-header">
        <div>
          <span>FINVERSE · PAPER TRADING</span>
          <h2 id="paper-trading-title">{game.name} <em>{game.ticker}</em></h2>
          <p>{game.scenario_premise || "이벤트 시나리오 모의 투자"}</p>
        </div>
        <div className="paper-run-header-actions">
          <div className="paper-quote">
            <strong className={priceTone}>{game.current_price.toLocaleString("ko-KR")}</strong>
            <em className={priceTone}>{signedPct(priceChangePct)}</em>
          </div>
          <span className={`paper-phase-pill ${game.phase}`}>{busy && <i />} {meta.label}</span>
          <button className="paper-reset" type="button" onClick={onReset} disabled={busy}>새 시나리오</button>
          <button className="scenario-modal-close" type="button" onClick={onClose} aria-label="모의 투자 닫기"><X size={20} /></button>
        </div>
      </header>

      <section className="paper-run-overview" aria-label="시나리오 진행 현황">
        <div className="paper-progress-copy">
          <PhaseStepper phase={game.phase} />
          <strong>{game.phase === "completed" ? game.total_events : game.current_event_index + 1} / {game.total_events} 이벤트</strong>
        </div>
        <div className="paper-progress"><i style={{ width: `${busy && job ? job.progress : eventProgress}%` }} className={busy ? "busy" : ""} /></div>
        <div className="paper-metrics">
          <div>
            <Wallet size={16} /><span>총자산</span>
            <strong>{compactWon(portfolio.equity)}</strong>
          </div>
          <div>
            {returnTone === "down" ? <TrendingDown size={16} /> : <TrendingUp size={16} />}<span>수익률</span>
            <strong className={returnTone}>{signedPct(portfolio.total_return_pct)}</strong>
          </div>
          <div>
            <CircleDollarSign size={16} /><span>현금</span>
            <strong>{compactWon(portfolio.cash)}</strong>
          </div>
          <div>
            <Flag size={16} /><span>보유</span>
            <strong>{portfolio.quantity.toLocaleString("ko-KR")} <em>주</em></strong>
          </div>
        </div>
        {error && <div className="paper-run-error"><AlertTriangle size={14} /> <span>{error}</span></div>}
        {stalled && !error && (
          <div className="paper-run-warning">
            <AlertTriangle size={14} />
            <span>응답이 8분 넘게 갱신되지 않았습니다. 백엔드가 재시작되었을 수 있습니다. 창을 닫았다 다시 열면 최신 상태를 불러옵니다.</span>
          </div>
        )}
      </section>

      <div className="paper-run-grid">
        <section className="paper-panel paper-chart-panel" aria-label="가격 차트">
          <div className="paper-panel-heading">
            <div><CandlestickChart size={15} /><span>시나리오 캔들</span></div>
            <em>{game.last_market_date ? `${game.last_market_date} 기준` : "시작 전"}</em>
          </div>
          <CandleChart game={game} />
          <PsychologyStrip round={latestRound} />
        </section>

        <section className="paper-panel paper-desk-panel" aria-label="주문">
          <div className="paper-panel-heading">
            <div><CircleDollarSign size={15} /><span>주문 티켓</span></div>
            <em>{meta.eyebrow}</em>
          </div>

          <div className="paper-now">
            <div className="paper-now-head">
              <span>지금 할 일</span>
              <b>{meta.label}</b>
            </div>
            <ol>
              {meta.todo.map((line) => <li key={line}>{emphasise(line)}</li>)}
            </ol>
            {!coach && (
              <button type="button" className="paper-now-help" onClick={() => setCoach(true)}>
                전체 흐름 다시 보기
              </button>
            )}
          </div>

          <div className="paper-desk-scroll">
            <div className="paper-holdings">
              <div><span>평가금액</span><strong>{compactWon(portfolio.market_value)}</strong></div>
              <div><span>평단가</span><strong>{portfolio.average_price ? portfolio.average_price.toLocaleString("ko-KR") : "—"}</strong></div>
              <div><span>평가손익</span><strong className={toneOf(portfolio.unrealized_pnl)}>{portfolio.unrealized_pnl ? compactWon(portfolio.unrealized_pnl) : "—"}</strong></div>
              <div><span>실현손익</span><strong className={toneOf(portfolio.realized_pnl)}>{portfolio.realized_pnl ? compactWon(portfolio.realized_pnl) : "—"}</strong></div>
            </div>

            {meta.canOrder
              ? <OrderDesk game={game} disabled={busy} onSubmit={onOrder} submitting={orderSubmitting} />
              : (
                <div className="paper-locked-note">
                  <strong>{meta.label}에는 주문할 수 없습니다</strong>
                  <p>{meta.guide}</p>
                </div>
              )}

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
              <div className="paper-fills">
                <span>체결 내역 {game.fills?.length}건</span>
                {[...(game.fills ?? [])].reverse().slice(0, 6).map((fill, index) => (
                  <div key={fill.order_id ?? index}>
                    <b className={fill.side === "BUY" ? "up" : "down"}>{fill.side === "BUY" ? "매수" : "매도"}</b>
                    <strong>{fill.quantity.toLocaleString("ko-KR")}주</strong>
                    <em>{fill.price.toLocaleString("ko-KR")}원</em>
                  </div>
                ))}
              </div>
            )}

          </div>

          <div className="paper-advance-row">
            {meta.action === "advance_days" && !busy && (
              <button className="paper-advance-day" type="button" onClick={() => onAdvance(1)}>
                <CalendarClock size={15} /> 하루만
              </button>
            )}
            <button className="paper-advance" type="button" onClick={() => onAdvance()} disabled={busy}>
              {busy
                ? <><LoaderCircle size={16} className="spin" /> {job?.message ?? "진행 중"}</>
                : <>{meta.cta} <ChevronRight size={16} /></>}
            </button>
          </div>
        </section>

        <section className="paper-panel paper-feed-panel" aria-label="시장 반응">
          <div className="paper-panel-heading">
            <div className="paper-tabs">
              <button type="button" className={tab === "feed" ? "active" : ""} onClick={() => setTabChoice("feed")}>
                <Radio size={13} /> 시장 반응
              </button>
              <button type="button" className={tab === "report" ? "active" : ""} onClick={() => setTabChoice("report")}>
                <Sparkles size={13} /> 투자 회고
              </button>
            </div>
            <em>{game.agent_rounds?.length ? `${game.agent_rounds.length}개 거래일` : "대기"}</em>
          </div>

          {tab === "feed" && event && (
            <div className={`paper-event-card ${event.status}`}>
              <div className="paper-event-top">
                <span><CalendarClock size={13} /> 이벤트 {event.sequence}</span>
                <em>{event.event_date} 예정 · {event.trading_days_until}거래일 남음</em>
              </div>
              {event.status === "revealed" && event.title
                ? <strong>{event.title}</strong>
                : <strong className="masked">아직 공개되지 않은 이벤트</strong>}
              <p>{event.status === "revealed" && event.description ? event.description : event.pre_brief}</p>
              {event.status === "revealed" && event.ontology_source
                ? <EventProvenanceStrip source={event.ontology_source} />
                : event.ontology_source && (
                    // 공개 전에는 내용을 숨기되, 지어낸 사건이 아니라는 것은 알린다.
                    <div className="paper-provenance pending">
                      <Landmark size={12} />
                      <span>실제로 일어난 사건입니다. 내용은 공개 시점에 드러납니다.</span>
                    </div>
                  )}
            </div>
          )}

          <div className="paper-feed-scroll">
            {tab === "feed"
              ? <ReactionFeed game={game} busy={busy} job={job} />
              : assessment
                ? <ReportView
                    assessment={assessment}
                    canGenerate={game.phase === "completed"}
                    generating={busy && job?.kind === "report"}
                    onGenerate={() => onAdvance()}
                  />
                : <div className="paper-feed-empty">
                    <Sparkles size={22} />
                    <strong>회고를 준비하는 중입니다</strong>
                    <p>거래 기록이 쌓이면 판단 성향과 지표가 여기에 정리됩니다.</p>
                  </div>}
          </div>
        </section>
      </div>

      <footer className="paper-run-footer">
        <span>GAME {game.game_id.slice(0, 22)}</span>
        <span>
          {game.event_provenance?.mode === "ontology_events"
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
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [stalled, setStalled] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const busy = job?.status === "queued" || job?.status === "running";

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refreshAssessment = useCallback(async (gameId: string) => {
    try {
      const report = await callApi<{ data: Assessment }>(`/scenarios/${gameId}/assessment`);
      setAssessment(report.data);
    } catch {
      // 회고는 부가 정보다. 실패해도 진행을 막지 않는다.
    }
  }, []);

  const refreshGame = useCallback(async (gameId: string) => {
    const payload = await callApi<{ data: ScenarioGame }>(`/games/${gameId}`);
    setGame(payload.data);
    return payload.data;
  }, []);

  const resume = useCallback(async (gameId: string) => {
    setStarting(true);
    setError(null);
    try {
      await refreshGame(gameId);
      await refreshAssessment(gameId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장된 시나리오를 불러오지 못했습니다.");
    } finally {
      setStarting(false);
    }
  }, [refreshGame, refreshAssessment]);

  const start = useCallback(async (input: {
    ticker: string; name: string; initialCash: number;
    investmentMode: InvestmentMode; initialPosition?: { quantity: number; averagePrice: number };
    simulationDays: number; practiceMode: PracticeMode;
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
          practice_mode: input.practiceMode,
          event_source: "ontology",
          // 캐시 리플레이 이력은 종가만 있어 캔들이 선으로 뭉개진다.
          // finverse는 실제 OHLC를 쓰고, DB가 죽었을 때만 백엔드가 캐시로 내려간다.
          prefer_live_finverse: true,
        }),
      });
      setGame(payload.data);
      await refreshAssessment(payload.data.game_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "시나리오를 만들지 못했습니다.");
    } finally {
      setStarting(false);
    }
  }, [refreshAssessment]);

  // 진행 중인 게임은 서버에 저장되어 있다. 목록에서 언제든 이어서 할 수 있다.
  const reset = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setGame(null);
    setAssessment(null);
    setJob(null);
    setError(null);
    setStalled(false);
  }, []);

  const pollJob = useCallback((jobId: string, gameId: string) => {
    let lastStamp = "";
    let lastMessage = "";
    let lastChangeAt = Date.now();
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
          await refreshGame(gameId);
          setJob(null);
          setStalled(false);
          await refreshAssessment(gameId);
          return;
        }
        if (next.status === "failed") {
          setError(next.error ?? "작업이 실패했습니다.");
          setJob(null);
          setStalled(false);
          await refreshGame(gameId).catch(() => undefined);
          return;
        }
        pollRef.current = setTimeout(tick, 1400);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "진행 상태를 확인하지 못했습니다.");
        setJob(null);
        setStalled(false);
      }
    };
    pollRef.current = setTimeout(tick, 900);
  }, [refreshGame, refreshAssessment]);

  const advance = useCallback(async (days?: number) => {
    if (!game || busy) return;
    setError(null);
    setStalled(false);
    const meta = PHASE_META[game.phase];
    try {
      const payload = await callApi<{ data: Job }>(`/scenarios/${game.game_id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: meta.action, ...(days ? { days } : {}) }),
      });
      setJob(payload.data);
      pollJob(payload.data.job_id, game.game_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "다음 단계를 시작하지 못했습니다.");
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

  return (
    <div className="modal-backdrop paper-trading-backdrop" onMouseDown={onClose}>
      <section
        className={`scenario-modal paper-trading-modal ${game ? "running" : "setup"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paper-trading-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {game
          ? <TradingScreen
              game={game}
              job={job}
              busy={busy}
              stalled={stalled}
              error={error}
              assessment={assessment}
              orderSubmitting={orderSubmitting}
              onOrder={submitOrder}
              onAdvance={advance}
              onReset={reset}
              onClose={onClose}
            />
          : <SetupScreen onStart={start} onResume={resume} starting={starting} error={error} onClose={onClose} />}
      </section>
    </div>
  );
}
