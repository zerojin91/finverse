export type Tone = "up" | "down" | "flat";

export interface ScenarioEvent {
  week: string;
  category: string;
  title: string;
  body: string;
  impact: string;
}

export interface Scenario {
  id: string;
  title: string;
  duration: string;
  tags: string[];
  forecast: string;
  tone: Exclude<Tone, "flat">;
  icon: "chart" | "brain" | "dollar";
  /** KOSPI path, index 0 = today's close. */
  path: number[];
  events: ScenarioEvent[];
  /** Indexed net-worth target at 1 month (current = 128.5). */
  twinTarget: number;
  twinNote: string;
  art: string;
}

/** Values mirror the static preview data in the FINVERSE app (2026.07.28 KRX close). */
export const scenarios: Scenario[] = [
  {
    id: "kospi-rebound",
    title: "KOSPI 조건부 반등",
    duration: "1개월",
    tags: ["외국인 순매수", "AI CapEx"],
    forecast: "KOSPI +24.5%",
    tone: "up",
    icon: "chart",
    path: [6023.66, 6200, 6400, 6650, 6800, 6900, 7050, 7180, 7300, 7400, 7460, 7500],
    twinTarget: 140.2,
    twinNote: "+9.1%",
    art: "/scenarios/kospi-rebound.png",
    events: [
      {
        week: "8/4 전후",
        category: "수급·실적",
        title: "외국인 순매수 회복과 SK하이닉스 서프라이즈",
        body: "외국인 수급이 회복되고 영업이익이 컨센서스 64.1조원을 10% 이상 웃돌면 1주 중심값 6,650을 시험합니다.",
        impact: "+10.0%",
      },
      {
        week: "8/11 전후",
        category: "빅테크·AI",
        title: "Microsoft·Meta AI CapEx 유지·확대",
        body: "메모리·HBM 수요가 재확인되고 밸류에이션 재평가가 겹치면 2주 중심값 7,050까지 반등이 이어집니다.",
        impact: "+17.0%",
      },
      {
        week: "8/28 전후",
        category: "분기점",
        title: "20일 이동평균 7,232 회복 여부",
        body: "조건이 모두 유지될 때 1개월 중심값은 7,500, 기본 시나리오 밴드는 6,700~8,300입니다.",
        impact: "+24.5%",
      },
    ],
  },
  {
    id: "chip-miss",
    title: "반도체 실적 미스·AI CapEx 둔화",
    duration: "1개월",
    tags: ["SK하이닉스 실적 하회", "AI 투자 재평가"],
    forecast: "KOSPI -13.8%",
    tone: "down",
    icon: "brain",
    path: [6023.66, 5900, 5750, 5650, 5480, 5380, 5300, 5230, 5180, 5150, 5180, 5190],
    twinTarget: 121.6,
    twinNote: "-5.4%",
    art: "/scenarios/chip-miss.png",
    events: [
      {
        week: "8/4 전후",
        category: "실적",
        title: "SK하이닉스 실적 미스 또는 보수적 가이던스",
        body: "컨센서스 64.1조원 하회가 확인되면 HBM 수요와 메모리 가격 추정치가 함께 낮아집니다.",
        impact: "-5.5%",
      },
      {
        week: "8/11 전후",
        category: "빅테크·AI",
        title: "AI CapEx 수익성 검증 국면",
        body: "투자 확대보다 회수 속도를 강조하면 반도체 밸류에이션 재평가가 지연되고 2주 중심값은 5,300까지 낮아질 수 있습니다.",
        impact: "-9.8%",
      },
      {
        week: "8/28 전후",
        category: "산업",
        title: "CXMT 경쟁 우려와 이익 추정치 하향",
        body: "중국 메모리 공급 확대 우려가 지속되면 1개월 중심값 5,190, 하단 4,600까지 열어둡니다.",
        impact: "-13.8%",
      },
    ],
  },
  {
    id: "risk-off",
    title: "외국인 매도·원화 약세 재확산",
    duration: "1개월",
    tags: ["외국인 순매도", "원·달러·금리"],
    forecast: "KOSPI -8.7%",
    tone: "down",
    icon: "dollar",
    path: [6023.66, 5920, 5780, 5650, 5600, 5550, 5525, 5480, 5460, 5480, 5490, 5500],
    twinTarget: 107.8,
    twinNote: "-16.1%",
    art: "/scenarios/risk-off.png",
    events: [
      {
        week: "8/1 전후",
        category: "수급·환율",
        title: "외국인 순매도 3거래일 이상 지속",
        body: "현물과 선물에서 매도가 겹치고 원·달러 환율이 상승하면 1주 중심값 5,650을 시험합니다.",
        impact: "-3.2%",
      },
      {
        week: "8/8 전후",
        category: "금리·매크로",
        title: "금리·에너지·지정학 리스크 재부각",
        body: "할인율과 위험 프리미엄이 함께 올라 2주 중심값은 5,525를 가리킵니다.",
        impact: "-6.1%",
      },
      {
        week: "8/28 전후",
        category: "변동성",
        title: "레버리지 청산과 프로그램 매매 재충격",
        body: "사이드카·서킷브레이커가 반복되면 1개월 중심값 5,500, 하단 4,900까지 열어둡니다.",
        impact: "-8.7%",
      },
    ],
  },
];

export interface SignalTopic {
  title: string;
  summary: string;
  stars: 1 | 2 | 3;
}
export interface Signal {
  key: "economy" | "country" | "event" | "community";
  label: string;
  impact: string;
  topics: SignalTopic[];
}

export const signals: Signal[] = [
  {
    key: "economy",
    label: "경제",
    impact: "금리·환율 변화는 기업 조달비용과 수출주 이익 전망을 바꿔 KOSPI 적정 가치에 연결됩니다.",
    topics: [
      { title: "금리 정책", summary: "기준금리 경로가 성장주의 할인율과 시장 밸류에이션에 영향을 줍니다.", stars: 3 },
      { title: "환율 변동성", summary: "원화 가치 변화는 수출주 이익과 외국인 자금 흐름에 함께 연결됩니다.", stars: 2 },
    ],
  },
  {
    key: "country",
    label: "국가",
    impact: "주요국 정책과 경기는 글로벌 위험선호, 환율과 한국 수출 전망을 통해 KOSPI에 연결됩니다.",
    topics: [
      { title: "미국 금리 정책", summary: "미국의 금리 기대는 외국인 자금과 성장주 할인율에 영향을 줍니다.", stars: 3 },
      { title: "중국 경기", summary: "중국 수요 변화는 한국 수출 및 경기 민감주의 이익 전망에 반영됩니다.", stars: 2 },
    ],
  },
  {
    key: "event",
    label: "이벤트",
    impact: "수급과 기업 실적 이벤트는 대형주 비중이 높은 KOSPI의 단기 변동성을 빠르게 바꿀 수 있습니다.",
    topics: [
      { title: "외국인 수급", summary: "외국인 현물·선물 수급 변화가 지수 방향과 변동성에 연결됩니다.", stars: 3 },
      { title: "반도체 실적", summary: "반도체 이익 기대는 KOSPI의 실적 전망에 큰 비중으로 반영됩니다.", stars: 3 },
    ],
  },
  {
    key: "community",
    label: "커뮤니티",
    impact: "온라인 투자심리는 단기 거래 집중을 보여주는 보조 신호이며 지수 움직임의 원인으로 단정하지 않습니다.",
    topics: [
      { title: "반도체 투자심리", summary: "대형 반도체주에 대한 기대와 경계가 단기 거래 집중에 연결될 수 있습니다.", stars: 2 },
      { title: "국내 증시 신뢰", summary: "국내 증시와 외국인 수급에 대한 인식은 위험선호의 보조 지표입니다.", stars: 1 },
    ],
  },
];

export const miniIndices = [
  { name: "코스닥", value: "834.20", change: "-30.45 (3.52%)", points: [862, 856, 849, 852, 844, 840, 836, 834] },
  { name: "S&P 500", value: "5,982.72", change: "-54.21 (0.90%)", points: [6068, 6052, 6040, 6024, 6012, 6002, 5991, 5983] },
  { name: "나스닥", value: "19,546.73", change: "-187.42 (0.95%)", points: [19840, 19812, 19790, 19752, 19720, 19680, 19622, 19547] },
];

export const holdings = [
  { symbol: "S", name: "삼성전자", code: "005930 · KOSPI", value: "220,000원", weight: "28.6%", change: "+1.03%", contribution: "+286,500원", tone: "up" as Tone },
  { symbol: "H", name: "SK하이닉스", code: "000660 · KOSPI", value: "1,555,000원", weight: "24.3%", change: "-0.74%", contribution: "-182,400원", tone: "down" as Tone },
  { symbol: "E", name: "KODEX 200", code: "069500 · KOSPI", value: "34,210원", weight: "18.7%", change: "+0.42%", contribution: "+90,800원", tone: "up" as Tone },
  { symbol: "$", name: "USD 현금", code: "KRW 환산", value: "23,600,000원", weight: "18.4%", change: "0.00%", contribution: "0원", tone: "flat" as Tone },
];

export const experts = [
  { initials: "WB", who: "워런 버핏 관점", line: "좋은 기업도 가격보다 이익의 지속성을 먼저 확인하세요.", body: "반등을 따라가기보다 HBM 수요와 외국인 수급이 함께 돌아오는지 확인합니다." },
  { initials: "HM", who: "하워드 막스 관점", line: "낙폭보다 먼저, 기대가 얼마나 낮아졌는지 계산하세요.", body: "실적 리스크와 AI CapEx 둔화가 일시적 충격인지 추세 변화인지 구분합니다." },
  { initials: "TR", who: "트럼프식 시장 관점", line: "정책과 자금 흐름이 바뀌기 전에는 현금을 협상 카드로 두세요.", body: "환율·외국인 수급·정책 뉴스가 같은 방향인지 확인하고 행동합니다." },
];

/** KOSPI actuals leading into 2026.07.28. */
export const kospiActual = [5224, 5480, 5760, 6080, 6244, 5700, 5052, 5900, 6599, 7600, 8476, 8300, 8476, 7400, 6720, 6250, 6023.66];

export const MARKET_STAMP = "2026.07.28 KRX 장마감 기준";
export const DISCLAIMER = "상기 정보는 AI 분석 기반 참고 자료이며, 투자 판단의 최종 책임은 본인에게 있습니다.";

export const stars = (n: number) => "★★★".slice(0, n) + "☆☆☆".slice(0, 3 - n);
export const toneOf = (signed: string): Tone => (signed.startsWith("+") ? "up" : signed.startsWith("-") ? "down" : "flat");
