// 행동 트윈 프로필.  온보딩 6문항 -> 행동 파라미터 -> 편향 리포트.
//
// 문항은 "무엇을 아느냐"가 아니라 "그 상황에서 실제로 무엇을 하느냐"를 묻는다.
// 지식 점수가 아니라 매매 규칙을 만들어야 시뮬레이션에 넣을 수 있기 때문이다.

import type { BacktestResult, BehaviorProfile, Holding, TradeEvent } from "./backtest";
import { CASH, STOCK, effectivePanicThreshold } from "./backtest";

export type ProfileQuestion = {
  id: string;
  prompt: string;
  hint: string;
  options: { id: string; label: string; detail: string; value: Partial<BehaviorProfile> }[];
};

export const questions: ProfileQuestion[] = [
  {
    id: "threshold",
    prompt: "보유 자산이 한 달 만에 빠지고 있습니다. 어디서부터 잠이 안 오나요?",
    hint: "손실회피 · 견딜 수 있는 낙폭",
    options: [
      { id: "shallow", label: "-10%", detail: "숫자가 빨개지면 바로 신경 쓰인다", value: { panicDrawdown: -0.1 } },
      { id: "mid", label: "-20%", detail: "한동안은 지켜보지만 이쯤이면 불안하다", value: { panicDrawdown: -0.2 } },
      { id: "deep", label: "-30%", detail: "웬만하면 버티는 편이다", value: { panicDrawdown: -0.3 } },
      { id: "very-deep", label: "-45%", detail: "장기 자금이라 신경 쓰지 않는다", value: { panicDrawdown: -0.45 } },
    ],
  },
  {
    id: "action",
    prompt: "그 지점에 실제로 닿으면 무엇을 하나요?",
    hint: "공포 매도 · 손실 확정 방식",
    options: [
      { id: "all", label: "전부 정리한다", detail: "더 빠지기 전에 현금으로 옮긴다", value: { panicAction: 1 } },
      { id: "half", label: "절반만 줄인다", detail: "일부는 남기고 위험을 낮춘다", value: { panicAction: 0.5 } },
      { id: "avoid", label: "앱을 열지 않는다", detail: "판단을 미루다 뒤늦게 조금 정리한다", value: { panicAction: 0.2, reentryDelay: 60 } },
      { id: "hold", label: "그대로 둔다", detail: "계획한 기간까지는 건드리지 않는다", value: { panicAction: 0 } },
    ],
  },
  {
    id: "crowd",
    prompt: "시장이 흔들릴 때 뉴스·커뮤니티·유튜브를 얼마나 보나요?",
    hint: "군집행동 · 외부 의견의 영향",
    options: [
      { id: "low", label: "거의 안 본다", detail: "내 기준으로만 판단한다", value: { herding: 0.1 } },
      { id: "mid", label: "하루 몇 번 확인한다", detail: "분위기는 참고한다", value: { herding: 0.45 } },
      { id: "high", label: "계속 찾아본다", detail: "다들 파는 분위기면 마음이 급해진다", value: { herding: 0.85 } },
    ],
  },
  {
    id: "profit",
    prompt: "20% 수익이 났습니다. 어떻게 하나요?",
    hint: "처분효과 · 이익 실현 습관",
    options: [
      { id: "keep", label: "그대로 둔다", detail: "목표 기간까지 유지한다", value: { disposition: 0 } },
      { id: "part", label: "일부 정리한다", detail: "수익을 확정해두면 마음이 편하다", value: { disposition: 0.5 } },
      { id: "most", label: "대부분 정리한다", detail: "번 것을 잃는 게 제일 싫다", value: { disposition: 1 } },
    ],
  },
  {
    id: "reentry",
    prompt: "한 번 팔고 나면 다시 들어가기까지 얼마나 걸리나요?",
    hint: "현재편향 · 판단 회피",
    options: [
      { id: "fast", label: "일주일 안", detail: "기회가 보이면 바로 다시 산다", value: { reentryDelay: 5 } },
      { id: "month", label: "한 달쯤", detail: "흐름을 확인하고 들어간다", value: { reentryDelay: 20 } },
      { id: "quarter", label: "몇 달", detail: "확실해질 때까지 기다린다", value: { reentryDelay: 60 } },
      { id: "never", label: "잘 못 돌아간다", detail: "한 번 데이면 한동안 쳐다보지 않는다", value: { reentryDelay: 250 } },
    ],
  },
  {
    id: "chase",
    prompt: "신고가 경신 뉴스가 쏟아집니다. 남은 현금이 있다면?",
    hint: "과신 · FOMO",
    options: [
      { id: "none", label: "계획대로 둔다", detail: "비중을 바꾸지 않는다", value: { chase: 0 } },
      { id: "some", label: "조금 더 담는다", detail: "흐름은 타되 크게 늘리진 않는다", value: { chase: 0.4 } },
      { id: "much", label: "적극적으로 담는다", detail: "지금 안 사면 놓칠 것 같다", value: { chase: 0.9 } },
    ],
  },
];

export const defaultProfile: BehaviorProfile = { panicDrawdown: -0.2, panicAction: 0.5, herding: 0.45, disposition: 0.5, reentryDelay: 20, chase: 0.4 };

export function deriveProfile(answers: Record<string, string>): BehaviorProfile {
  let profile = { ...defaultProfile };
  for (const question of questions) {
    const option = question.options.find((item) => item.id === answers[question.id]);
    if (option) profile = { ...profile, ...option.value };
  }
  return profile;
}

export type TwinCharacter = { key: string; name: string; tagline: string; watch: string };

export function characterFor(profile: BehaviorProfile): TwinCharacter {
  if (profile.panicAction >= 0.8 && profile.reentryDelay >= 60)
    return { key: "exit", name: "공포 이탈형", tagline: "빠르게 손실을 끊지만, 회복 구간에는 시장 밖에 있습니다.", watch: "매도보다 재진입 기준을 먼저 정해두세요." };
  if (profile.panicAction >= 0.5 && profile.herding >= 0.6)
    return { key: "crowd", name: "군중 동조형", tagline: "내 기준보다 시장 분위기가 결정을 앞당깁니다.", watch: "매도 조건을 커뮤니티가 아니라 숫자로 적어두세요." };
  if (profile.chase >= 0.8)
    return { key: "chaser", name: "추격 돌진형", tagline: "오르는 흐름에 올라타지만 고점 부근에서 비중이 가장 커집니다.", watch: "추가 매수 한도를 미리 정해두세요." };
  if (profile.disposition >= 0.8)
    return { key: "early", name: "조기 익절형", tagline: "손실은 견디고 이익은 빨리 확정합니다.", watch: "이익 구간을 끊는 기준이 손실 구간보다 엄격하지 않은지 보세요." };
  if (profile.panicAction <= 0.2 && profile.chase <= 0.2 && profile.disposition <= 0.5)
    return { key: "steady", name: "무던한 장기형", tagline: "잘 흔들리지 않지만 위험 점검도 미루기 쉽습니다.", watch: "버티는 것과 방치하는 것을 구분하세요." };
  return { key: "balanced", name: "균형 탐색형", tagline: "상황에 따라 다르게 반응하는, 가장 흔한 유형입니다.", watch: "구간마다 기준이 달라지지 않는지 기록해보세요." };
}

export type BiasCard = { bias: string; headline: string; body: string; tone: "warn" | "info" | "good" };

const pct = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const day = (compact: string) => `${compact.slice(0, 4)}.${compact.slice(4, 6)}.${compact.slice(6, 8)}`;

/** 매도 이후 재진입(또는 구간 끝)까지 버티기 경로가 오른 정도. */
function missedRebound(result: BacktestResult, sell: TradeEvent) {
  const next = result.events.find((event) => event.type === "reentry" && event.index > sell.index);
  const end = next ? next.index : result.buyHold.length - 1;
  return { gain: result.buyHold[end] / result.buyHold[sell.index] - 1, days: end - sell.index, returned: Boolean(next) };
}

export function buildReport(result: BacktestResult, profile: BehaviorProfile): BiasCard[] {
  const cards: BiasCard[] = [];
  const sells = result.events.filter((event) => event.type === "panic-sell");
  const first = sells[0];

  if (first) {
    const after = missedRebound(result, first);
    // 판 뒤 시장이 올랐는지 내렸는지에 따라 같은 매도의 의미가 달라진다.
    const consequence = after.gain > 0
      ? `그 뒤 ${after.days}거래일 동안 시장은 ${pct(after.gain)} 올랐고, 트윈은 그 구간에 ${after.returned ? "뒤늦게 참여했습니다" : "끝내 참여하지 못했습니다"}.`
      : `그 뒤 ${after.days}거래일 동안 시장은 ${pct(after.gain)} 더 내려서 이번 매도는 손실을 줄였습니다. 다만 같은 규칙이 항상 맞지는 않는다는 점을 다른 구간에서도 확인해보세요.`;
    cards.push({
      bias: "손실회피 · 공포 매도",
      headline: `${day(first.date)}에 팔았습니다`,
      body: `트윈은 ${first.detail}했습니다. ${consequence}`,
      tone: after.gain > 0 ? "warn" : "info",
    });
  } else {
    cards.push({
      bias: "손실회피 · 공포 매도",
      headline: `최대 ${pct(result.maxDrawdown)} 낙폭을 버텼습니다`,
      body: `설정한 임계(${pct(profile.panicDrawdown)})에 닿지 않아 매도가 없었습니다. 버틴 것 자체가 성과는 아니며, 이 구간에서 회복이 ${result.recoveryDays === null ? "구간 안에 오지 않았다는 점" : `${result.recoveryDays}거래일 걸렸다는 점`}을 함께 보세요.`,
      tone: "good",
    });
  }

  if (profile.herding >= 0.6 && first) {
    const raw = profile.panicDrawdown;
    const effective = effectivePanicThreshold(profile);
    cards.push({
      bias: "군집행동",
      headline: `기준보다 ${((Math.abs(raw) - Math.abs(effective)) * 100).toFixed(1)}%p 먼저 팔았습니다`,
      body: `스스로 정한 임계는 ${pct(raw)}였지만, 외부 의견에 민감한 성향이 실제 매도 지점을 ${pct(effective)}로 앞당겼습니다.`,
      tone: "warn",
    });
  }

  const reentry = result.events.find((event) => event.type === "reentry");
  if (first && !reentry) {
    cards.push({
      bias: "현재편향 · 판단 회피",
      headline: "구간이 끝날 때까지 돌아오지 않았습니다",
      body: `재진입까지 ${profile.reentryDelay}거래일을 기다리는 성향이라, 이 구간 안에서는 다시 들어갈 시점을 찾지 못했습니다. 나가는 기준만 있고 들어오는 기준이 없을 때 나타나는 형태입니다.`,
      tone: "warn",
    });
  } else if (reentry) {
    cards.push({
      bias: "현재편향 · 판단 회피",
      headline: `${day(reentry.date)}에 다시 들어갔습니다`,
      body: `${reentry.detail}했습니다. 판 가격보다 비싸게 다시 산 구간이 있는지 확인해보세요.`,
      tone: "info",
    });
  }

  const takeProfits = result.events.filter((event) => event.type === "take-profit");
  if (takeProfits.length) {
    cards.push({
      bias: "처분효과",
      headline: `이익 구간에서 ${takeProfits.length}번 미리 줄였습니다`,
      body: `${takeProfits[0].detail}했습니다. 손실은 견디고 이익은 빨리 확정하는 방향이면, 남는 것은 손실 쪽 위험뿐입니다.`,
      tone: "warn",
    });
  }

  const chases = result.events.filter((event) => event.type === "chase-buy");
  if (chases.length) {
    cards.push({
      bias: "과신 · FOMO",
      headline: `신고가에서 ${chases.length}번 비중을 늘렸습니다`,
      body: "가장 편안하게 느껴지는 시점(신고가)에 위험 노출이 가장 커집니다. 다음 하락에서 체감 낙폭이 커지는 이유입니다.",
      tone: "warn",
    });
  }

  return cards;
}

export type AllocationPreset = { id: string; name: string; detail: string; stockWeight: number };

/** 주식과 현금 두 덩어리로만 나눈 기본 구성. 개별 종목은 묻지 않는다. */
export const allocationPresets: AllocationPreset[] = [
  { id: "aggressive", name: "공격형", detail: "현금은 최소한만 남깁니다", stockWeight: 0.9 },
  { id: "balanced", name: "균형형", detail: "충격이 왔을 때 쓸 현금을 남깁니다", stockWeight: 0.6 },
  { id: "defensive", name: "안정형", detail: "절반 이상을 현금으로 둡니다", stockWeight: 0.3 },
];

/** 총 자산과 주식 비중을 두 줄짜리 보유 현황으로 바꾼다. */
export const allocationHoldings = (total: number, stockWeight: number): Holding[] => [
  { symbol: STOCK, amount: total * stockWeight },
  { symbol: CASH, amount: total * (1 - stockWeight) },
];
