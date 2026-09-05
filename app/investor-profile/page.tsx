"use client";

import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./profile.module.css";

type Choice = {
  label: "A" | "B" | "C" | "D";
  text: string;
  x: number;
  y: number;
};

type Question = {
  title: string;
  context: string;
  choices: Choice[];
};

const questions: Question[] = [
  {
    title: "보유 종목에 예상보다 부정적인 실적 발표가 나왔다.",
    context: "기존에는 장기 전망을 긍정적으로 보고 있었다. 시장은 장 초반 크게 하락했다. 가장 가까운 행동은?",
    choices: [
      { label: "A", text: "한 번의 실적으로 기존 판단을 바꾸지는 않는다. 기존 투자 논리가 훼손됐는지 충분히 확인할 때까지 포지션도 유지한다.", x: -0.5, y: 0.5 },
      { label: "B", text: "기존 전망을 바로 재검토하고 투자 논리를 낮춰 잡는다. 다만 실적 내용을 더 분석한 뒤 포지션 변경 여부를 결정한다.", x: 0.5, y: 0.5 },
      { label: "C", text: "장기 전망은 여전히 유효하다고 생각하지만 추가 하락이 걱정되어 우선 일부 매도한다.", x: -0.5, y: -0.5 },
      { label: "D", text: "실적이 기존 기대와 다르다고 판단해 전망을 바로 낮추고 포지션도 즉시 축소한다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "보유하지 않은 종목이 강한 호재와 함께 하루 만에 크게 상승했다.",
    context: "예상보다 훨씬 강한 산업 데이터가 같이 발표됐다.",
    choices: [
      { label: "A", text: "기존에 비싸다고 판단했던 종목이므로 한 번의 데이터만으로 생각을 바꾸지 않는다. 매수도 하지 않는다.", x: -0.5, y: 0.5 },
      { label: "B", text: "기존 생각이 틀렸을 가능성을 인정하고 적정가치를 다시 계산하지만, 새로운 가격에서 매수할지는 추가 확인한다.", x: 0.5, y: 0.5 },
      { label: "C", text: "여전히 가격이 과도하다고 생각하지만 더 오를 가능성이 신경 쓰여 일부라도 진입한다.", x: -0.5, y: -0.5 },
      { label: "D", text: "산업 환경이 예상보다 강하다고 판단을 수정하고 상승 흐름을 놓치기 전에 바로 진입한다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "매수 직후 주가가 예상과 반대로 빠르게 하락했다.",
    context: "아직 투자 논리를 명확하게 훼손하는 새로운 정보는 없다.",
    choices: [
      { label: "A", text: "처음 세운 투자 논리가 유지되는 한 판단을 바꾸지 않고 계획했던 대응 기준도 그대로 따른다.", x: -0.5, y: 0.5 },
      { label: "B", text: "가격 움직임 자체도 새로운 정보일 수 있다고 보고 기존 판단을 다시 검토하지만, 이유를 확인하기 전에는 포지션을 바꾸지 않는다.", x: 0.5, y: 0.5 },
      { label: "C", text: "투자 논리는 여전히 맞다고 생각하지만 손실 확대가 신경 쓰여 일단 포지션을 줄인다.", x: -0.5, y: -0.5 },
      { label: "D", text: "예상과 다른 가격 움직임을 보고 기존 판단의 신뢰도를 낮추며 바로 포지션을 줄인다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "이미 큰 수익이 난 종목에 추가 호재가 발표됐다.",
    context: "호재가 지속적인 실적 개선으로 이어질지는 아직 불확실하다.",
    choices: [
      { label: "A", text: "기존 목표가격과 매도 기준을 유지하고, 이번 뉴스만으로 투자 판단이나 포지션을 바꾸지 않는다.", x: -0.5, y: 0.5 },
      { label: "B", text: "기존 목표가격이 너무 낮았을 가능성을 검토해 전망을 상향하지만, 추가 매수는 후속 데이터를 본 뒤 결정한다.", x: 0.5, y: 0.5 },
      { label: "C", text: "기존 목표가격은 그대로지만 상승세가 더 이어질 것 같아 추가 매수한다.", x: -0.5, y: -0.5 },
      { label: "D", text: "새로운 호재를 반영해 전망을 상향하고 상승 기회를 활용하기 위해 바로 추가 매수한다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "전문가와 시장 참여자 대부분이 내 견해와 반대되는 의견을 내기 시작했다.",
    context: "아직 결정적인 신규 데이터는 없다.",
    choices: [
      { label: "A", text: "다른 사람들의 견해만으로 기존 판단을 수정하지 않고, 새로운 객관적 근거가 나올 때까지 기다린다.", x: -0.5, y: 0.5 },
      { label: "B", text: "시장의 집단적 판단도 정보라고 보고 기존 견해를 다시 평가하지만, 직접 확인할 근거가 생길 때까지 거래하지 않는다.", x: 0.5, y: 0.5 },
      { label: "C", text: "내 판단은 여전히 맞다고 생각하지만 시장이 반대로 움직일 것이 걱정돼 포지션을 일부 줄인다.", x: -0.5, y: -0.5 },
      { label: "D", text: "시장 참여자들의 견해 변화를 중요한 신호로 받아들이고 내 판단과 포지션을 빠르게 수정한다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "보유 종목에서 서로 상반된 정보가 동시에 나왔다.",
    context: "실적은 예상보다 좋았지만, 향후 전망은 예상보다 약하다.",
    choices: [
      { label: "A", text: "기존 투자 논리에서 중요하게 봤던 핵심 지표를 우선하며 전체 판단을 쉽게 바꾸지 않는다. 거래도 기존 계획대로 한다.", x: -0.5, y: 0.5 },
      { label: "B", text: "긍정·부정 정보를 모두 반영해 기존 전망을 수정하지만 어느 쪽 영향이 더 큰지 정리될 때까지 행동은 보류한다.", x: 0.5, y: 0.5 },
      { label: "C", text: "기존 관점은 유지하지만 불확실성이 커졌다고 느껴 우선 포지션을 줄인다.", x: -0.5, y: -0.5 },
      { label: "D", text: "새롭게 들어온 정보에 맞춰 전망을 빠르게 조정하고 그 판단에 맞게 바로 포지션도 변경한다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "최근 두 번의 매매에서 연속으로 손실을 봤다.",
    context: "곧 평소라면 매수했을 만한 새로운 기회가 나타났다.",
    choices: [
      { label: "A", text: "최근 손실과 관계없이 기존 투자 기준을 그대로 적용하고, 조건이 충족되는지 충분히 확인한 뒤 결정한다.", x: -0.5, y: 0.5 },
      { label: "B", text: "최근 시장에서 내 판단 기준이 잘 작동하지 않았을 가능성을 검토해 기준을 재평가하지만, 바로 진입하지는 않는다.", x: 0.5, y: 0.5 },
      { label: "C", text: "기존 매수 기준은 여전히 맞다고 생각하고, 손실을 만회할 기회라는 생각에 평소보다 빠르게 진입한다.", x: -0.5, y: -0.5 },
      { label: "D", text: "최근 손실을 계기로 기존 시장 판단을 수정하고, 새로운 기회가 더 적합하다고 판단해 바로 포지션을 잡는다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "중앙은행 발표 직후 시장이 예상과 완전히 다른 방향으로 움직였다.",
    context: "발표 내용 자체의 해석도 엇갈리고 있다.",
    choices: [
      { label: "A", text: "사전에 세운 해석이 명백히 틀렸다는 근거가 나오기 전까지 기존 관점을 유지하고 시장 반응을 더 관찰한다.", x: -0.5, y: 0.5 },
      { label: "B", text: "예상 밖 시장 반응을 중요하게 받아들여 기존 관점을 수정할 준비를 하지만, 가격이 안정될 때까지 거래하지 않는다.", x: 0.5, y: 0.5 },
      { label: "C", text: "내 해석은 여전히 맞다고 보지만 반대 방향의 시장 움직임이 부담스러워 즉시 포지션을 축소한다.", x: -0.5, y: -0.5 },
      { label: "D", text: "시장 반응을 보며 내 해석이 틀렸을 수 있다고 판단하고 즉시 반대 방향으로 포지션을 조정한다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "오래 보유한 종목의 핵심 사업 환경이 조금씩 변하고 있다는 신호가 나타난다.",
    context: "아직 명확한 악재라고 단정할 수준은 아니다.",
    choices: [
      { label: "A", text: "장기 투자 논리를 뒤집을 정도의 증거가 아니므로 기존 전망과 포지션을 유지한다.", x: -0.5, y: 0.5 },
      { label: "B", text: "작은 변화라도 장기적으로 중요할 수 있다고 보고 투자 논리를 다시 점검하지만, 확신이 생길 때까지 포지션은 유지한다.", x: 0.5, y: 0.5 },
      { label: "C", text: "장기 전망은 여전히 긍정적이지만 불안감이 커져 미리 일부 매도한다.", x: -0.5, y: -0.5 },
      { label: "D", text: "환경 변화가 시작됐다고 판단해 기존 장기 전망을 낮추고 포지션도 바로 축소한다.", x: 0.5, y: -0.5 },
    ],
  },
  {
    title: "강하게 확신했던 투자 아이디어와 정반대되는 결정적인 데이터가 발표됐다.",
    context: "데이터의 신뢰도는 높은 편이다.",
    choices: [
      { label: "A", text: "하나의 데이터만으로 오랫동안 형성한 투자 논리를 폐기하지 않는다. 다만 추가 확인이 끝날 때까지 새로운 행동도 하지 않는다.", x: -0.5, y: 0.5 },
      { label: "B", text: "기존 판단이 틀렸을 가능성을 인정하고 투자 논리를 수정한다. 다만 실제 포지션 변경은 영향 범위를 다시 계산한 뒤 진행한다.", x: 0.5, y: 0.5 },
      { label: "C", text: "기존 투자 논리에 대한 믿음은 유지하지만 추가 손실이 우려돼 즉시 포지션을 줄인다.", x: -0.5, y: -0.5 },
      { label: "D", text: "기존 판단을 폐기하고 새로운 정보를 기준으로 전망과 포지션을 즉시 변경한다.", x: 0.5, y: -0.5 },
    ],
  },
];

const profiles = {
  anchor: { name: "원칙형", english: "The Anchor", headline: "기준이 흔들리기 전까지, 행동을 서두르지 않습니다.", body: "새로운 정보가 들어와도 투자 논리와 계획을 먼저 점검하는 편입니다. 시뮬레이션에서는 반증 조건을 놓치지 않는지 함께 살펴보세요." },
  adapter: { name: "전략형", english: "The Adapter", headline: "새 정보를 반영하되, 행동은 계획 안에서 결정합니다.", body: "판단을 유연하게 업데이트하면서도 바로 움직이기보다 근거와 순서를 확인합니다. 시뮬레이션에서 강점과 빈틈을 구체적인 행동 기준으로 바꿔보세요." },
  defender: { name: "고집 반응형", english: "The Defender", headline: "관점은 유지하지만, 불확실성에 빠르게 반응합니다.", body: "기존 논리를 지키려는 힘과 손실을 줄이려는 행동이 함께 나타납니다. 시뮬레이션에서는 판단과 행동의 기준이 서로 어긋나는 순간을 확인합니다." },
  chaser: { name: "추격형", english: "The Chaser", headline: "새 정보와 가격 변화에 빠르게 맞춰 움직입니다.", body: "변화에 민감하게 반응하는 만큼, 행동 전에 확인할 최소 기준이 중요합니다. 시뮬레이션에서 속도가 도움이 되는 때와 비용이 되는 때를 구분해보세요." },
} as const;

type Stage = "intro" | "test" | "result";

export default function InvestorProfilePage() {
  const [stage, setStage] = useState<Stage>("intro");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Array<Choice | undefined>>([]);

  const selected = answers[current];
  const score = useMemo(() => answers.reduce((sum, answer) => ({ x: sum.x + (answer?.x ?? 0), y: sum.y + (answer?.y ?? 0) }), { x: 0, y: 0 }), [answers]);
  const profileKey = score.x < 0 ? (score.y >= 0 ? "anchor" : "defender") : (score.y >= 0 ? "adapter" : "chaser");
  const profile = profiles[profileKey];
  const coordinate = { left: `${((score.x + 5) / 10) * 100}%`, bottom: `${((score.y + 5) / 10) * 100}%` };

  const choose = (choice: Choice) => {
    setAnswers((previous) => {
      const next = [...previous];
      next[current] = choice;
      return next;
    });
  };

  const start = () => { setStage("test"); setCurrent(0); setAnswers([]); };
  const next = () => { if (current === questions.length - 1) setStage("result"); else setCurrent((value) => value + 1); };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/" className={styles.brand} aria-label="Finverse 홈">finverse<span>.</span></a>
        <span className={styles.headerLabel}>투자 성향 진단</span>
      </header>

      {stage === "intro" && (
        <section className={styles.intro} aria-labelledby="profile-title">
          <p className={styles.eyebrow}>FIRST SIMULATION</p>
          <h1 id="profile-title">내가 보는 나의<br />투자 성향 파악하기</h1>
          <p className={styles.introLead}>10가지 시장 장면에서 가장 가까운 대응을 고르면, 나의 판단 방식과 행동 방식을 좌표로 정리해드립니다.</p>
          <div className={styles.introGrid}>
            <article><span>01</span><strong>실제 상황을 상상해요</strong><p>정답을 고르기보다, 평소의 나와 가장 가까운 행동을 선택합니다.</p></article>
            <article><span>02</span><strong>선택은 화면에만 남아요</strong><p>문항을 푸는 동안 점수나 유형은 보이지 않아 결과를 의도적으로 고르기 어렵습니다.</p></article>
            <article><span>03</span><strong>첫 시뮬레이션의 기준이 돼요</strong><p>결과는 이후 시나리오별 투자 행동 보고서의 출발점으로 활용됩니다.</p></article>
          </div>
          <button className={styles.primaryButton} type="button" onClick={start}>시작하기 <ArrowRight size={17} aria-hidden="true" /></button>
        </section>
      )}

      {stage === "test" && (
        <section className={styles.test} aria-labelledby="question-title">
          <div className={styles.progressHead}><span>QUESTION {String(current + 1).padStart(2, "0")}</span><strong>{current + 1} / {questions.length}</strong></div>
          <div className={styles.progressTrack}><i style={{ width: `${((current + 1) / questions.length) * 100}%` }} /></div>
          <div className={styles.question}><p className={styles.eyebrow}>시장 상황</p><h1 id="question-title">{questions[current].title}</h1><p>{questions[current].context}</p></div>
          <div className={styles.choices} role="radiogroup" aria-label="가장 가까운 대응 선택">
            {questions[current].choices.map((choice) => (
              <button key={choice.label} type="button" role="radio" aria-checked={selected?.label === choice.label} className={`${styles.choice} ${selected?.label === choice.label ? styles.choiceSelected : ""}`} onClick={() => choose(choice)}>
                <span className={styles.choiceLetter}>{selected?.label === choice.label ? <Check size={16} aria-hidden="true" /> : choice.label}</span><span>{choice.text}</span>
              </button>
            ))}
          </div>
          <div className={styles.testActions}>
            <button type="button" className={styles.backButton} onClick={() => setCurrent((value) => Math.max(0, value - 1))} disabled={current === 0}><ArrowLeft size={16} aria-hidden="true" /> 이전</button>
            <button type="button" className={styles.primaryButton} onClick={next} disabled={!selected}>{current === questions.length - 1 ? "결과 보기" : "다음 문항"}<ArrowRight size={17} aria-hidden="true" /></button>
          </div>
        </section>
      )}

      {stage === "result" && (
        <section className={styles.result} aria-labelledby="result-title">
          <div className={styles.resultHeading}><p className={styles.eyebrow}>YOUR INVESTMENT COORDINATE</p><h1 id="result-title">당신이 보는 투자 성향</h1><p>이 결과는 좋고 나쁨을 판단하지 않습니다. 시장을 해석하고 행동을 결정하는 현재의 경향을 보여줍니다.</p></div>
          <div className={styles.resultLayout}>
            <div className={styles.mapWrap} aria-label={`투자 성향 좌표: X ${score.x}, Y ${score.y}`}>
              <span className={styles.mapYTop}>계획에 따라 행동</span><span className={styles.mapYBottom}>즉시 행동</span>
              <div className={styles.coordinateMap}>
                <span className={`${styles.quadrant} ${styles.anchor}`}>원칙형<small>The Anchor</small></span>
                <span className={`${styles.quadrant} ${styles.adapter}`}>전략형<small>The Adapter</small></span>
                <span className={`${styles.quadrant} ${styles.defender}`}>고집 반응형<small>The Defender</small></span>
                <span className={`${styles.quadrant} ${styles.chaser}`}>추격형<small>The Chaser</small></span>
                <span className={styles.xLeft}>기존 기준 유지</span><span className={styles.xRight}>새 정보 반영</span>
                <span className={styles.coordinateDot} style={coordinate}><i /></span>
              </div>
            </div>
            <article className={styles.profileCard}>
              <span className={styles.profileKicker}>{profile.english}</span><h2>{profile.name}</h2><h3>{profile.headline}</h3><p>{profile.body}</p>
              <div className={styles.scoreLine}><span>판단 가변성 <strong>{score.x > 0 ? "+" : ""}{score.x.toFixed(1)}</strong></span><span>행동 통제성 <strong>{score.y > 0 ? "+" : ""}{score.y.toFixed(1)}</strong></span></div>
              <a href="/" className={styles.primaryButton}>첫 시뮬레이션 시작하기 <ArrowRight size={17} aria-hidden="true" /></a>
            </article>
          </div>
          <button className={styles.resetButton} type="button" onClick={start}><RotateCcw size={14} aria-hidden="true" /> 다시 응답하기</button>
        </section>
      )}
    </main>
  );
}
