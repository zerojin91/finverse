// 금융 대가의 진단.
//
// 세 사람의 공개된 투자 원칙을 서로 다른 채점표로 만들어 같은 배분에 매긴다.
// 세 점수가 갈리는 지점이 곧 "무엇을 신경 써야 하는가"다.
//
// 포트폴리오는 국내주식과 현금 두 덩어리다.  개별 종목을 묻지 않으므로 채점도
// 종목 집중도가 아니라 위험자산 비중, 현금 여력, 매매 빈도로 한다.
//
// 점수는 여기서 결정적으로 계산한다.  생성형 모델은 이 숫자를 바꾸지 못하고
// 문장만 다시 쓴다(app/api/twin/mentor/route.ts).  본인의 발언이 아니라 원칙을
// 적용한 해석이라는 점을 화면에 함께 표시한다.

export type MentorInput = {
  stockWeight: number;
  cashWeight: number;
  moodScore: number;
  moodLabel: string;
  /** 1년 고점 대비 현재 낙폭 */
  drawdown: number;
  /** 백테스트에서 행동이 만든 차이 */
  behaviorGap: number;
  windowLabel: string;
  /** 그 구간에서 트윈이 일으킨 매매 건수 */
  tradeCount: number;
  character: string;
};

export type MentorVerdict = {
  key: "buffett" | "marks" | "dalio";
  name: string;
  principle: string;
  score: number;
  headline: string;
  body: string;
};

const clamp = (value: number, low = 5, high = 95) => Math.max(low, Math.min(high, Math.round(value)));
const pct = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

export function mentorVerdicts(input: MentorInput): MentorVerdict[] {
  // 오래 들고 갈 수 있는가: 자주 갈아타지 않고, 극단으로 몰지 않고, 여력이 있는가.
  const turnover = Math.min(40, input.tradeCount * 12);
  const extreme = Math.max(0, input.stockWeight - 0.85) * 200;
  const buffett = clamp(100 - turnover - extreme + Math.min(input.cashWeight, 0.2) * 50);

  // 사이클의 어디에 서 있는가: 공포일수록 유리하고, 현금이 있어야 그 유리함을 쓴다.
  const contrarian = (100 - input.moodScore) * 0.5;
  const dryPowder = (Math.min(input.cashWeight, 0.3) / 0.3) * 30;
  const tolerance = (1 - Math.min(1, Math.abs(input.drawdown) / 0.3)) * 20;
  const marks = clamp(contrarian + dryPowder + tolerance);

  // 균형: 한쪽으로 몰수록 깎인다. 전부 주식도, 전부 현금도 균형은 아니다.
  const dalio = clamp(100 - Math.abs(input.stockWeight - 0.6) * 150);

  return [
    {
      key: "buffett",
      name: "워런 버핏의 원칙",
      principle: "오래 들고 갈 수 있는가",
      score: buffett,
      headline: input.tradeCount >= 2
        ? `이 구간에서 ${input.tradeCount}번 손을 댔습니다`
        : `이 구간에서는 거의 손대지 않았습니다`,
      body: input.tradeCount >= 2
        ? `사고파는 횟수 자체가 비용이자 판단 실수의 기회입니다. 주식 ${pct(input.stockWeight)}를 그대로 두고 견딜 수 있는 수준인지, 아니면 처음부터 비중이 과했던 것인지 구분해야 합니다.`
        : `비중을 자주 바꾸지 않는 편입니다. 남은 질문은 지금의 주식 ${pct(input.stockWeight)}가 다음 하락에서도 손대지 않을 수 있는 크기냐입니다.`,
    },
    {
      key: "marks",
      name: "하워드 막스의 원칙",
      principle: "사이클의 어디에 서 있는가",
      score: marks,
      headline: `지금 시장 온도는 ${input.moodScore}, ${input.moodLabel}입니다`,
      body: input.moodScore < 45
        ? `기대가 낮아진 구간입니다. 이런 국면에서 필요한 건 예측이 아니라 실제로 쓸 수 있는 현금 ${pct(input.cashWeight)}와 미리 정한 기준입니다. 남들이 파는 이유가 내 이유와 같은지 확인하세요.`
        : `가격에 이미 좋은 기대가 담겨 있습니다. 지금 편안하게 느껴진다면 위험이 사라져서가 아니라 값에 반영되지 않아서일 수 있습니다. 현금 ${pct(input.cashWeight)}가 그때 쓸 몫입니다.`,
    },
    {
      key: "dalio",
      name: "레이 달리오의 원칙",
      principle: "한쪽으로 몰려 있지 않은가",
      score: dalio,
      headline: input.stockWeight >= 0.8
        ? `주식 ${pct(input.stockWeight)}, 사실상 한 방향입니다`
        : input.stockWeight <= 0.35
          ? `현금 ${pct(input.cashWeight)}, 지키는 쪽에 서 있습니다`
          : `주식과 현금이 ${pct(input.stockWeight)} 대 ${pct(input.cashWeight)}입니다`,
      body: input.stockWeight >= 0.8
        ? `충격이 오면 완충할 것이 거의 없습니다. 낙폭 자체보다, 낙폭을 견디는 동안 팔지 않을 수 있느냐가 문제입니다.`
        : input.stockWeight <= 0.35
          ? `잃지 않는 쪽은 지켰습니다. 다만 현금도 위험을 하나 집니다. 시간이 지날수록 구매력이 줄어든다는 위험입니다.`
          : `한쪽으로 몰려 있지 않습니다. 이 비중을 시장이 흔들릴 때도 유지할 수 있는지가 다음 문제입니다.`,
    },
  ];
}

/** 세 원칙 중 가장 낮은 점수. 화면에서 "가장 뼈아픈 한마디"로 쓴다. */
export const harshest = (verdicts: MentorVerdict[]) =>
  verdicts.reduce((low, verdict) => (verdict.score < low.score ? verdict : low), verdicts[0]);

export const behaviorNote = (input: MentorInput) =>
  `${input.windowLabel} 구간에서 ${input.character}인 나는 그대로 뒀을 때보다 ${signed(input.behaviorGap)}p였습니다.`;
