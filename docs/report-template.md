# 나의 투자 성향 분석 보고서

> **Session:** {{session_id}}  
> **Simulation Date:** {{simulation_date}}  
> **총 이벤트:** {{event_count}}개  
> **분석 시나리오:** {{scenario_count}}개  
> **분석 신뢰도:** {{analysis_confidence}}

---

# 1. 한눈에 보는 나의 투자 성향

## {{personality_type_kr}} · {{personality_type_en}}

> **“{{personality_summary_quote}}”**

| 항목 | 점수 | 해석 |
|---|---:|---|
| 판단 가변성 | **{{judgment_flexibility_score}} / 5** | {{judgment_flexibility_summary}} |
| 행동 통제성 | **{{behavioral_control_score}} / 5** | {{behavioral_control_summary}} |

**현재 위치:** `({{judgment_flexibility_score}}, {{behavioral_control_score}})`

- X축: **판단 가변성** — 고정형 `-5` ↔ 적응형 `+5`
- Y축: **행동 통제성** — 반응형 `-5` ↔ 통제형 `+5`

{{quadrant_chart}}

### 유형 구분

|  | 판단 고정형 | 판단 적응형 |
|---|---|---|
| **행동 통제형** | 원칙형 · The Anchor | 전략형 · The Adapter |
| **행동 반응형** | 고집 반응형 · The Defender | 추격형 · The Chaser |

### 이번 게임에서 가장 두드러진 특징

**강하게 나타난 특성**

- {{strong_trait_1}}
- {{strong_trait_2}}
- {{strong_trait_3}}

**주의할 행동 패턴**

- {{risk_pattern_1}}
- {{risk_pattern_2}}

---

# 2. 내가 마주한 시나리오

이번 게임에서 발생한 이벤트들을 **발생 원인, 정보 구조, 시장 전달 경로 및 수급 반응이 유사한 이벤트끼리 묶어** {{scenario_count}}개의 시나리오로 분류했습니다.

> 시나리오는 수익률 결과나 사용자의 선택을 기준으로 묶지 않습니다.  
> **이벤트 자체의 성격**을 기준으로 분류합니다.

---

{{#each scenarios}}

## Scenario {{scenario_number}}. {{scenario_name}}

**시나리오 유형:** {{scenario_category}}  
**발생 횟수:** {{event_count}}회  
**대표 이벤트:** {{representative_event}}  
**시장 특성:** {{scenario_market_characteristic}}

### 시나리오 정의

{{scenario_description}}

### 포함된 이벤트

| Event | 이벤트 | 충격 방향 | Surprise | 주요 영향 |
|---|---|---|---:|---|
{{event_table_rows}}

---

## 시장 참여자들은 어떻게 판단했는가

| 투자 주체 | 주요 판단 | 대표 행동 | 강도 | 핵심 근거 |
|---|---|---|---:|---|
{{actor_response_rows}}

### 나의 판단과 선택

**초기 판단**

{{user_initial_view}}

**새로운 정보 이후 판단**

{{user_updated_view}}

**실제 선택**

{{user_action_summary}}

### 다른 투자 주체와 비교

- **가장 유사했던 주체:** {{most_similar_actor}}
  - {{similarity_reason}}

- **가장 달랐던 주체:** {{most_different_actor}}
  - {{difference_reason}}

- **나만의 특징:** {{user_unique_behavior}}

---

## 이 시나리오에서 나타난 나의 반응

### 판단 측면

{{scenario_judgment_analysis}}

### 행동 측면

{{scenario_behavior_analysis}}

### 시장 참여자들과 비교했을 때 특징

{{scenario_comparative_analysis}}

---

## 이 시나리오가 성향 점수에 준 영향

| 성향 | 영향 | 주요 증거 |
|---|---:|---|
| 판단 가변성 | {{scenario_x_contribution}} | {{scenario_x_evidence}} |
| 행동 통제성 | {{scenario_y_contribution}} | {{scenario_y_evidence}} |

{{/each}}

---

# 3. 시나리오를 가로질러 나타난 나의 패턴

개별 이벤트 하나보다 중요한 것은 **서로 다른 시장 환경에서 반복적으로 나타난 판단과 행동 방식**입니다.

## 반복적으로 나타난 판단 패턴

{{cross_scenario_judgment_patterns}}

## 반복적으로 나타난 행동 패턴

{{cross_scenario_behavior_patterns}}

## 특정 상황에서 두드러졌던 특징

{{context_dependent_patterns}}

## 시장 상황에 따라 달라진 반응

{{scenario_dependent_reactions}}

---

# 4. 판단 가변성

## {{judgment_flexibility_score}} / 5

**고정형 `-5` ←──────── `0` ────────→ `+5` 적응형**

{{judgment_flexibility_bar}}

### 이 점수가 의미하는 것

{{judgment_flexibility_interpretation}}

판단 가변성은 다음 행동을 중심으로 평가했습니다.

- 새로운 정보에 따라 기존 전망을 얼마나 수정했는가
- 기존 투자 논리와 반대되는 정보를 얼마나 수용했는가
- 자신의 기존 포지션과 관계없이 판단을 수정할 수 있었는가
- 기존 원칙이나 판단을 새로운 상황에 맞게 얼마나 유연하게 수정했는가

### 주요 근거

{{judgment_flexibility_evidence}}

### 판단을 크게 바꾸었던 시나리오

{{high_flexibility_scenarios}}

### 기존 판단을 강하게 유지했던 시나리오

{{low_flexibility_scenarios}}

---

# 5. 행동 통제성

## {{behavioral_control_score}} / 5

**반응형 `-5` ←──────── `0` ────────→ `+5` 통제형**

{{behavioral_control_bar}}

### 이 점수가 의미하는 것

{{behavioral_control_interpretation}}

행동 통제성은 다음 행동을 중심으로 평가했습니다.

- 판단이 생긴 뒤 실제 주문까지 얼마나 즉각적으로 연결했는가
- 추가 정보나 확인을 기다릴 수 있었는가
- 직전 손실 또는 수익이 다음 행동에 영향을 미쳤는가
- FOMO, 공포, 후회, 손실 만회 욕구가 포지션 변경에 영향을 주었는가
- 강한 확신이나 시장 충격 속에서도 행동을 유보할 수 있었는가

### 주요 근거

{{behavioral_control_evidence}}

### 즉각적인 행동이 강하게 나타난 시나리오

{{reactive_behavior_scenarios}}

### 행동을 유보하거나 통제했던 시나리오

{{controlled_behavior_scenarios}}

---

# 6. 나의 투자 유형

# {{personality_type_kr}}

### {{personality_type_en}}

{{personality_description}}

### 이 유형의 핵심 특징

{{personality_core_characteristics}}

### 이 유형의 강점

- {{strength_1}}
- {{strength_2}}
- {{strength_3}}

### 시장에서 유리할 수 있는 상황

- {{favorable_context_1}}
- {{favorable_context_2}}

### 취약해질 수 있는 상황

- {{vulnerable_context_1}}
- {{vulnerable_context_2}}

### 이번 게임에서 실제로 나타난 사례

{{personality_supporting_examples}}

---

# 7. 중립점으로부터의 거리

**중립점:** `(0, 0)`  
**현재 위치:** `({{x}}, {{y}})`  
**중립점과의 거리:** `{{distance_from_center}} / 7.07`

{{distance_interpretation}}

> 중심에서 멀다는 것은 반드시 나쁘다는 의미가 아닙니다.  
> 특정 투자 환경에서는 극단적인 성향이 강점이 될 수 있습니다.  
> 다만 극단으로 갈수록 특정 상황에서 일부 인지 편향에 반복적으로 노출될 가능성이 커질 수 있습니다.

---

# 8. 나에게 나타날 가능성이 높은 인지 편향

{{#each bias_findings}}

## {{bias_name}}

**관련 축:** {{related_axis}}  
**위험도:** {{risk_level}}  
**주로 나타난 시나리오:** {{related_scenarios}}

### 게임에서 관찰된 행동

{{observed_behavior}}

### 왜 이 행동이 편향으로 이어질 수 있는가

{{bias_explanation}}

### 교정 방법

{{correction_method}}

### 다음 게임에서 확인할 질문

> {{self_check_question}}

{{/each}}

---

# 9. 상황별 행동 교정 가이드

{{#each scenario_guides}}

## {{scenario_name}}을 다시 만난다면

**이번 게임에서 나타난 나의 반응**

{{observed_pattern}}

**주의할 수 있는 편향**

{{related_bias}}

**행동 전 체크**

1. {{check_1}}
2. {{check_2}}
3. {{check_3}}

**권장 판단 또는 행동 원칙**

> {{recommended_rule}}

{{/each}}

---

# 10. 이번 게임에서 얻은 핵심 인사이트

### 가장 효과적이었던 판단 또는 행동

{{best_behavior}}

### 가장 개선할 가치가 큰 부분

{{highest_priority_improvement}}

### 다음 게임에서 하나만 바꾼다면

> **{{single_next_action}}**

---

# Appendix A. 성향 점수 산정 근거

## 판단 가변성

| Evidence | 방향 | 가중치 | 설명 |
|---|---:|---:|---|
{{x_score_evidence_table}}

**최종 점수:** {{x_score}}

---

## 행동 통제성

| Evidence | 방향 | 가중치 | 설명 |
|---|---:|---:|---|
{{y_score_evidence_table}}

**최종 점수:** {{y_score}}

---

# Appendix B. 분석 신뢰도

| 항목 | 평가 |
|---|---|
| 분석 가능한 이벤트 수 | {{diagnostic_event_count}} |
| 서로 다른 시나리오 수 | {{scenario_diversity}} |
| 판단 가변성 증거량 | {{x_evidence_strength}} |
| 행동 통제성 증거량 | {{y_evidence_strength}} |
| 서로 다른 시나리오에서의 증거 반복성 | {{cross_scenario_evidence_strength}} |
| 상충하는 증거의 정도 | {{conflicting_evidence_level}} |

**종합 신뢰도: {{analysis_confidence}}**

{{confidence_caveat}}