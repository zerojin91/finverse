// 네 사람의 다른 시선.
//
// 예전에는 셋이 모두 자산 배분만 보고 같은 말을 세 번 했다.  지금은 각자 다른
// 것을 본다.  겹치지 않아야 "네 사람이 갈린다"는 것이 화면에서 의미를 갖는다.
//
//   버핏   - 내 배분과 매매 빈도 : 이걸 10년 들고 갈 수 있나
//   막스   - 시장 온도와 시나리오 : 지금 사이클의 어디인가
//   카너먼 - 내 성향과 백테스트   : 이 규칙이 나를 어디서 다치게 하나
//   박현주 - 위험자산의 국적      : 왜 전부 한 나라에 있나
//
// 입장(괜찮다·걱정된다·위험하다)과 근거 숫자는 여기서 결정적으로 계산한다.
// 생성형 모델은 입장을 바꾸지 못하고 문장만 다시 쓴다(app/api/twin/mentor/route.ts).
// 실존 인물의 발언이 아니라 공개된 원칙·연구를 적용한 해석이라고 화면에 표시한다.
// 화면에 나오는 숫자는 전부 이 서비스가 계산한 값이고, 외부 통계는 인용하지 않는다.

export type MentorStance = "ok" | "watch" | "risk";

export type MentorInput = {
  stockWeight: number;
  cashWeight: number;
  /** 0(극단적 공포) ~ 100(극단적 탐욕) */
  moodScore: number;
  moodLabel: string;
  /** 1년 고점 대비 현재 낙폭 */
  drawdown: number;

  /** 타임머신에서 고른 구간과 그 결과 */
  windowLabel: string;
  buyHoldReturn: number;
  behaviorGap: number;
  tradeCount: number;
  soldCount: number;
  /** 판 뒤 그 구간 안에서 다시 들어왔는가 */
  reentered: boolean;

  character: string;
  /** 실제로 매도가 걸리는 낙폭 */
  panicThreshold: number;
  reentryDelay: number;

  /** 시장 인사이트에서 시나리오를 가져왔다면 */
  scenario?: { title: string; forecast: string; holdReturn: number; myReturn: number; sold: boolean };
};

export type MentorVerdict = {
  key: "buffett" | "marks" | "kahneman" | "parkhyeonjoo";
  name: string;
  /** 이 사람이 답하는 질문 */
  question: string;
  stance: MentorStance;
  headline: string;
  body: string;
  /** 투자 지시가 아니라, 스스로 확인할 항목 */
  check: string;
};

const pct = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

export const stanceLabels: Record<MentorStance, string> = { ok: "괜찮습니다", watch: "걱정됩니다", risk: "위험합니다" };
const severity: Record<MentorStance, number> = { ok: 0, watch: 1, risk: 2 };

export function mentorVerdicts(input: MentorInput): MentorVerdict[] {
  return [buffett(input), marks(input), kahneman(input), parkHyeonJoo(input)];
}

/** 내 배분과 매매 빈도를 본다. 10년 들고 갈 수 있는 크기인가. */
function buffett(input: MentorInput): MentorVerdict {
  const stance: MentorStance =
    input.tradeCount >= 4 || input.stockWeight >= 0.9 ? "risk"
      : input.tradeCount >= 2 || input.stockWeight >= 0.75 ? "watch"
        : "ok";
  const headline = input.tradeCount >= 2
    ? `주식 ${pct(input.stockWeight)}인데 ${input.windowLabel} 구간에서 ${input.tradeCount}번 손을 댔습니다`
    : `주식 ${pct(input.stockWeight)}를 거의 손대지 않았습니다`;
  const body = input.tradeCount >= 2
    ? `오래 들고 가겠다는 비중과 실제로 손댄 횟수가 어긋납니다. 문제는 시장이 아니라 처음부터 견딜 수 없는 크기였을 가능성입니다. 사고파는 횟수 자체가 비용이자 판단 실수의 기회입니다.`
    : input.stockWeight >= 0.75
      ? `비중을 자주 바꾸지 않는 건 좋습니다. 다만 주식 ${pct(input.stockWeight)}는 다음 하락에서 시험받을 크기입니다. 지금 편안한 이유가 아직 안 겪어서일 수 있습니다.`
      : `비중도 매매도 안정적입니다. 남은 질문은 이 돈을 언제 쓸 것이냐입니다. 쓸 시점이 가까우면 지금의 주식 ${pct(input.stockWeight)}도 큰 편입니다.`;
  return {
    key: "buffett",
    name: "워런 버핏의 원칙",
    question: "이걸 10년 들고 갈 수 있나",
    stance,
    headline,
    body,
    check: "다음 -20%에서도 팔지 않을 비중을 숫자로 적어두었는가",
  };
}

/** 지금 시장과 가져온 시나리오를 본다. 사이클의 어디인가. */
function marks(input: MentorInput): MentorVerdict {
  const fearful = input.moodScore < 45;
  const greedy = input.moodScore > 65;
  const dry = input.cashWeight < 0.15;
  const stance: MentorStance =
    (fearful && dry) || (greedy && input.stockWeight >= 0.8) ? "risk"
      : dry || greedy ? "watch"
        : "ok";
  const scenarioLine = input.scenario
    ? ` 게다가 가져온 시나리오(${input.scenario.title} ${input.scenario.forecast})는 여기서 한 번 더 ${signed(input.scenario.holdReturn)}를 봅니다.`
    : "";
  // 헤드라인이 배지보다 앞서 나가지 않게 한다. 현금이 모자랄 때만 그렇게 읽히는 표현을 쓴다.
  const headline = fearful && dry
    ? `시장 온도 ${input.moodScore}, ${input.moodLabel}인데 현금이 ${pct(input.cashWeight)}뿐입니다`
    : `시장 온도 ${input.moodScore}, ${input.moodLabel} 구간입니다`;
  const body = fearful
    ? `기대가 낮아진 국면에서 값이 되는 건 예측이 아니라 실제로 쓸 수 있는 현금입니다.${scenarioLine} 지금 현금이 ${dry ? "거의 없어서, 싸질수록 할 수 있는 게 줄어듭니다" : `${pct(input.cashWeight)} 남아 있어 선택지가 있습니다`}.`
    : greedy
      ? `가격에 이미 좋은 기대가 담겨 있습니다.${scenarioLine} 지금 편안하게 느껴진다면 위험이 사라져서가 아니라 값에 반영되지 않아서일 수 있습니다.`
      : `어느 쪽으로도 치우치지 않은 구간입니다.${scenarioLine} 이런 때 정한 기준이 공포·탐욕 구간에서 실제로 지켜집니다.`;
  return {
    key: "marks",
    name: "하워드 막스의 원칙",
    question: "지금 사이클의 어디인가",
    stance,
    headline,
    body,
    check: `현금 ${pct(input.cashWeight)}를 어느 지점에서 쓸지 미리 정해두었는가`,
  };
}

/** 내 성향과 백테스트 실측을 본다. 이 규칙이 어디서 나를 다치게 하나. */
function kahneman(input: MentorInput): MentorVerdict {
  const stuckOut = input.soldCount > 0 && !input.reentered;
  const stance: MentorStance =
    input.behaviorGap <= -0.05 || stuckOut ? "risk"
      : input.behaviorGap < 0 ? "watch"
        : "ok";
  const headline = input.soldCount === 0
    ? `${input.windowLabel} 구간에서는 규칙이 걸리지 않았습니다`
    : input.behaviorGap < 0
      ? `${input.character}인 내 규칙이 ${signed(input.behaviorGap)}p를 만들었습니다`
      : `이번 구간에서는 파는 쪽이 유리했습니다 (${signed(input.behaviorGap)}p)`;
  const body = input.soldCount === 0
    ? `매도 임계 ${signed(input.panicThreshold)}에 닿지 않아 아무 일도 없었습니다. 버틴 것이 아니라 시험받지 않은 것이니, 낙폭이 더 깊은 구간도 눌러보세요.`
    : stuckOut
      ? `${signed(input.panicThreshold)}에서 팔고 ${input.reentryDelay}거래일을 기다리는 성향이라 이 구간 안에서는 돌아오지 못했습니다. 손실을 만든 건 매도가 아니라 돌아오는 기준이 없다는 점입니다. 나가는 규칙만 있고 들어오는 규칙이 없으면 반등은 늘 남의 것이 됩니다.`
      : input.behaviorGap < 0
        ? `그대로 뒀다면 ${signed(input.buyHoldReturn)}였습니다. 판 것 자체보다 다시 산 가격이 판 가격보다 높았는지를 보세요. 팔고 사는 왕복이 손실의 실제 형태입니다.`
        : `이번엔 빠져나온 것이 맞았습니다. 다만 같은 규칙이 다른 구간에서도 맞는지는 별개입니다. 한 번 통한 규칙을 실력으로 기억하면 다음 구간에서 더 크게 겁니다.`;
  return {
    key: "kahneman",
    name: "대니얼 카너먼의 관점",
    question: "이 규칙이 나를 어디서 다치게 하나",
    stance,
    headline,
    body,
    check: "파는 조건 말고 다시 사는 조건을 숫자로 정했는가",
  };
}

/** 위험자산의 국적을 본다. 이 계좌는 한 나라에 얼마나 걸려 있나. */
function parkHyeonJoo(input: MentorInput): MentorVerdict {
  const stance: MentorStance =
    input.stockWeight >= 0.7 ? "risk"
      : input.stockWeight >= 0.4 ? "watch"
        : "ok";
  const headline = input.stockWeight >= 0.4
    ? `위험자산 전부가 국내주식 한 덩어리입니다 (자산의 ${pct(input.stockWeight)})`
    : `국내주식 ${pct(input.stockWeight)}, 나머지는 현금입니다`;
  const body = input.stockWeight >= 0.7
    ? `이 계좌의 성과는 한국 경제와 원화에 그대로 붙어 있습니다. 종목을 몇 개로 나누든 나라가 하나면 분산이 아닙니다. 국내 증시가 길게 눌리는 구간에서는 버티는 것 말고 할 수 있는 일이 없습니다.`
    : input.stockWeight >= 0.4
      ? `위험자산이 한 나라에만 있습니다. 현금 ${pct(input.cashWeight)}가 완충은 되지만, 완충과 분산은 다른 일입니다. 현금은 하락을 덜 아프게 할 뿐 다른 곳의 상승을 가져다주지는 않습니다.`
      : `위험자산 비중 자체가 낮아 국적 쏠림이 당장 문제가 되지는 않습니다. 다만 비중을 올릴 때는 어디를 늘릴지부터 정하는 편이 낫습니다.`;
  return {
    key: "parkhyeonjoo",
    name: "박현주의 원칙",
    question: "왜 전부 한 나라에 있나",
    stance,
    headline,
    body,
    check: "이 돈이 한국 경제 한 곳에 걸려 있어도 괜찮은 기간인가",
  };
}

/** 가장 심각한 입장. 화면에서 먼저 읽히도록 강조한다. */
export const mostSevere = (verdicts: MentorVerdict[]) =>
  verdicts.reduce((worst, verdict) => (severity[verdict.stance] > severity[worst.stance] ? verdict : worst), verdicts[0]);

export const behaviorNote = (input: MentorInput) =>
  `${input.windowLabel} 구간에서 나는 그대로 뒀을 때보다 ${signed(input.behaviorGap)}p였습니다. 성향 판정은 ${input.character}입니다.`;
