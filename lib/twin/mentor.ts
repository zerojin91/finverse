// 금융 대가의 진단.
//
// 세 사람의 공개된 투자 원칙을 서로 다른 채점표로 만들어 같은 포트폴리오에
// 매긴다.  세 점수가 갈리는 지점이 곧 "무엇을 신경 써야 하는가"다.
//
// 점수는 여기서 결정적으로 계산한다.  생성형 모델은 이 숫자를 바꾸지 못하고
// 문장만 다시 쓴다(app/api/twin/mentor/route.ts).  본인의 발언이 아니라 원칙을
// 적용한 해석이라는 점을 화면에 함께 표시한다.

export type MentorInput = {
  cashWeight: number;
  topWeight: number;
  topName: string;
  /** 비중 제곱합. 1 에 가까울수록 한 곳에 몰려 있다 */
  herfindahl: number;
  assetCount: number;
  sectorCount: number;
  moodScore: number;
  moodLabel: string;
  drawdown: number;
  behaviorGap: number;
  windowLabel: string;
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
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

export function mentorVerdicts(input: MentorInput): MentorVerdict[] {
  const concentration = Math.max(0, input.topWeight - 0.4) * 150;
  const turnover = Math.min(30, input.tradeCount * 4);
  const buffett = clamp(100 - concentration - turnover + Math.min(input.cashWeight, 0.2) * 50);

  const contrarian = (100 - input.moodScore) * 0.5;
  const dryPowder = (Math.min(input.cashWeight, 0.3) / 0.3) * 30;
  const tolerance = (1 - Math.min(1, Math.abs(input.drawdown) / 0.3)) * 20;
  const marks = clamp(contrarian + dryPowder + tolerance);

  const spread = (1 - input.herfindahl) * 70;
  const sectors = Math.min(1, input.sectorCount / 5) * 20;
  const dalio = clamp(spread + sectors + Math.min(input.cashWeight, 0.2) * 50);

  return [
    {
      key: "buffett",
      name: "워런 버핏의 원칙",
      principle: "집중과 이해 · 오래 들고 갈 수 있는가",
      score: buffett,
      headline: input.topWeight > 0.4
        ? `${input.topName} 한 종목이 ${pct(input.topWeight)}입니다`
        : `${input.assetCount}개로 나눠 담았습니다`,
      body: input.topWeight > 0.4
        ? `집중 자체가 잘못은 아니지만, 그 비중은 "이 회사의 이익이 어디서 나오는지 설명할 수 있을 때"만 정당합니다. 설명이 막히는 지점이 곧 줄여야 할 비중입니다.`
        : `분산은 되어 있습니다. 다음 질문은 각 종목을 왜 들고 있는지 한 문장으로 말할 수 있느냐입니다. 말이 막히는 종목이 먼저 흔들립니다.`,
    },
    {
      key: "marks",
      name: "하워드 막스의 원칙",
      principle: "사이클의 어디에 서 있는가",
      score: marks,
      headline: `지금 시장 온도는 ${input.moodScore}, ${input.moodLabel}입니다`,
      body: input.moodScore < 45
        ? `기대가 낮아진 구간입니다. 이런 국면에서 필요한 건 예측이 아니라 버틸 수 있는 현금(${pct(input.cashWeight)})과 사전에 정한 기준입니다. 남들이 파는 이유가 내 이유와 같은지 확인하세요.`
        : `가격에 이미 좋은 기대가 담겨 있습니다. 지금 편안하게 느껴진다면 그건 위험이 사라져서가 아니라 위험이 값에 반영되지 않아서일 수 있습니다.`,
    },
    {
      key: "dalio",
      name: "레이 달리오의 원칙",
      principle: "분산 · 서로 다르게 움직이는가",
      score: dalio,
      headline: input.sectorCount <= 2
        ? `${input.sectorCount}개 업종에 몰려 있습니다`
        : `${input.sectorCount}개 업종에 걸쳐 있습니다`,
      body: input.sectorCount <= 2
        ? `종목 수보다 중요한 건 서로 다르게 움직이느냐입니다. 같은 업종 여러 개는 사실상 한 개이고, 충격은 그 업종에 한꺼번에 옵니다.`
        : `업종은 나뉘어 있습니다. 다만 국내 주식끼리는 같은 방향으로 움직이기 쉬우니, 현금(${pct(input.cashWeight)})이 실제 완충 역할을 할 만큼인지 보세요.`,
    },
  ];
}

/** 세 원칙 중 가장 낮은 점수. 화면에서 "가장 뼈아픈 한마디"로 쓴다. */
export const harshest = (verdicts: MentorVerdict[]) =>
  verdicts.reduce((low, verdict) => (verdict.score < low.score ? verdict : low), verdicts[0]);

export const behaviorNote = (input: MentorInput) =>
  `${input.windowLabel} 구간에서 ${input.character}인 당신의 트윈은 버티기 대비 ${signed(input.behaviorGap)}p였습니다.`;
