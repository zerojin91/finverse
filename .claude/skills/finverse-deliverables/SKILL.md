---
name: finverse-deliverables
description: "FINVERSE 2026 금융 AI Challenge 공모전 산출물 제작 오케스트레이터. 기획서·MVP 기능명세서·발표자료를 사실 원장 기반으로 일관되게 만들고 교차 검증한다. 공모전 산출물 만들기, 기획서/명세서/발표자료 준비, 본선 제출 준비, 심사 자료 작성 요청 시 사용. 후속 작업에도 반드시 이 스킬을 사용할 것 — 산출물 재실행, 다시 실행, 업데이트, 수정, 보완, 기획서만 다시, 발표자료만 수정, 명세서 갱신, 이전 결과 기반 개선, 최종 제출 전 점검, 수치 대조, 정합성 재검증 요청 포함."
---

# FINVERSE Deliverables Orchestrator

2026 금융 AI Challenge 본선 산출물(기획서 · MVP 기능명세서 · 발표자료)을 **사실 원장 기반**으로 제작하고 교차 검증하는 통합 워크플로우.

## 실행 모드: 서브 에이전트 + 피어 메시징

이 환경에는 `TeamCreate`가 없다. 대신 `Agent` 도구로 **이름이 있는 백그라운드 서브 에이전트**를 띄우고, 에이전트들이 `SendMessage`로 서로 직접 통신하며, `TaskCreate`로 공유 작업 목록을 유지한다. 팀 모드의 핵심 이득(팀원 간 직접 조율)은 유지하면서 실제 존재하는 도구만 쓴다.

- 스폰: `Agent(subagent_type: "{name}", model: "opus", run_in_background: true)`
- 피어 통신: 에이전트가 `SendMessage({to: "{상대 이름}"})`. 상대는 `ListAgents`에 뜬 이름으로 지정
- 리더 보고: 서브 에이전트가 `SendMessage({to: "main"})`
- 공유 상태: `TaskCreate` / `TaskUpdate` / `TaskGet`

## 에이전트 구성

| 에이전트 | subagent_type | 역할 | 스킬 | 출력 |
|---------|--------------|------|------|------|
| fact-curator | `fact-curator` | 사실 원장 관리, 등재 심사 | `fact-ledger` | `_workspace/01_fact_curator_ledger.md` |
| proposal-writer | `proposal-writer` | 공모전 기획서 7개 항목 + HWPX | `competition-proposal` | `_workspace/02_proposal_writer_draft.md` |
| spec-writer | `spec-writer` | MVP 기능명세서 | `feature-spec` | `_workspace/03_spec_writer_features.md` |
| deck-builder | `deck-builder` | 발표자료·데모 시나리오·Q&A | `pitch-deck` | `_workspace/04_deck_builder_deck.md` |
| consistency-qa | `consistency-qa` | 경계면 교차 검증 | `doc-consistency-check` | `_workspace/05_consistency_qa_report.md` |

## 워크플로우

### Phase 0: 컨텍스트 확인

`_workspace/` 존재 여부로 실행 모드를 가른다.

| 상태 | 모드 | 행동 |
|------|------|------|
| `_workspace/` 없음 | **초기 실행** | Phase 1로 |
| 있음 + 사용자가 특정 문서만 수정 요청 | **부분 재실행** | 해당 작성자 + consistency-qa만 스폰. 기존 산출물 경로를 프롬프트에 포함해 읽고 고치게 한다 |
| 있음 + 새 입력(코드 변경, 새 요구사항) | **새 실행** | 기존 `_workspace/`를 `_workspace_{YYYYMMDD_HHMMSS}/`로 이동 후 Phase 1 |

부분 재실행이 기본이다. 전체 재생성은 QA가 이미 통과시킨 내용을 퇴행시킨다.

### Phase 1: 준비

1. `_workspace/` 생성 (또는 새 실행 시 기존 것을 타임스탬프 디렉토리로 이동 후 재생성)
2. 사용자에게 확인할 항목이 있으면 여기서 한 번에 묻는다:
   - 팀원 실명 (기획서 「구성원 성명」 칸)
   - 발표 시간 (없으면 8분+5분 가정)
   - 제출 마감일
3. 확인 결과를 `_workspace/00_input/context.md`에 저장

### Phase 2: 사실 원장 구축 (선행 · 동기)

**다른 모든 작업이 여기에 의존하므로 단독으로 먼저 완료한다.**

```
Agent(
  subagent_type: "fact-curator",
  model: "opus",
  run_in_background: false,
  prompt: "skills/fact-ledger를 따라 사실 원장을 구축하라.
           출력: _workspace/01_fact_curator_ledger.md
           대상: app/page.tsx, README.md, docs/PRD.md, docs/ontology/,
                 배포 URL https://finverse-ai-kr.vercel.app"
)
```

원장이 나오면 리더가 읽고 다음을 확인한 뒤 진행한다:
- `[구현됨]` / `[부분]` / `[계획]` 태그가 채워졌는가
- 표현 규칙 섹션이 있는가
- 6번 「미확정」 섹션에 사용자 확인이 필요한 항목이 남았는가 → 남았으면 Phase 1로 되돌아가 묻는다

### Phase 3: 문서 병렬 작성

**한 메시지에서 3개 Agent를 동시 호출** (`run_in_background: true`).

| 에이전트 | 프롬프트 요지 |
|---------|-------------|
| proposal-writer | `skills/competition-proposal`을 따라 양식 7개 항목 작성. 원장(`_workspace/01_*`)의 수치만 인용. 원장에 없는 값이 필요하면 `SendMessage({to: "fact-curator"})`로 등재 요청. 완료 시 `SendMessage({to: "main"})` |
| spec-writer | `skills/feature-spec`을 따라 기능명세서 작성. 기능 ID 목록이 확정되면 `SendMessage({to: "proposal-writer"})`로 공유 |
| deck-builder | `skills/pitch-deck`을 따라 발표자료 작성. 기획서·명세서 초안을 기다리는 동안 발표 흐름과 예상 Q&A부터 진행 |

fact-curator는 Phase 3 동안 **살려둔다** — 등재 요청을 받아야 한다. `SendMessage`로 재개하면 이전 컨텍스트를 유지한 채 처리한다.

작업 목록 등록:

```
TaskCreate(tasks: [
  { title: "기획서 7개 항목 초안", assignee: "proposal-writer" },
  { title: "기능명세서 초안", assignee: "spec-writer" },
  { title: "발표 흐름 + Q&A", assignee: "deck-builder" },
  { title: "발표자료 본문", assignee: "deck-builder", depends_on: ["기획서 7개 항목 초안", "기능명세서 초안"] },
])
```

### Phase 4: 증분 검증

**전체 완성을 기다리지 않는다.** 작성자 하나가 완료를 알릴 때마다 즉시 consistency-qa를 호출해 그 문서만 원장과 대조한다. 초기 불일치가 뒤 문서로 전파되면 수정 비용이 배로 커진다.

```
Agent(
  subagent_type: "consistency-qa",
  model: "opus",
  run_in_background: false,
  prompt: "skills/doc-consistency-check를 따라 {완료된 문서}를 검증하라.
           경계면 B1(수치)·B2(구현 상태)·B5(표현 규칙) 우선.
           결함은 해당 작성자에게 SendMessage로 즉시 통지하고
           _workspace/05_consistency_qa_report.md에 누적 기록하라."
)
```

3개 문서가 모두 나오면 전체 경계면(B1~B7)을 검증한다.

### Phase 5: 수정 루프

QA 보고서의 `치명` / `높음` 결함이 0이 될 때까지 반복한다. **최대 2회.**

1. 각 작성자에게 `SendMessage`로 결함 목록 전달 (파일 + 위치 + 수정 제안)
2. 수정 완료 알림 수신
3. consistency-qa에게 해당 문서 재검증 요청

2회 후에도 남으면 중단하고 남은 결함을 사용자에게 보고한다. 무한 루프보다 미해결 목록이 낫다.

### Phase 6: 최종 산출

1. **HWPX 생성** — proposal-writer가 `tools/fill_hwpx.py`의 `CONTENT`를 갱신하고 실행. 스크립트의 `verify()`가 zip 구조·XML·항목 반영을 자동 검사한다. 원본 템플릿 `docs/(첨부1)*.hwpx`는 덮어쓰지 않는다.
2. **B6 검증** — consistency-qa가 생성된 HWPX의 실제 텍스트를 초안 md와 대조한다. 생성 파이프라인이 텍스트를 누락할 수 있다.
3. **최종 파일 배치** — `docs/`에 산출물 배치:
   - `docs/2026 금융 AI Challenge 기획서_FINVERSE.hwpx`
   - `docs/MVP-기능명세서.md`
   - `docs/발표자료.md`
4. **PDF 변환은 사용자에게 안내한다.** HWPX→PDF는 한글 프로그램이 필요하고 이 환경에서 자동화되지 않는다. 변환 후 레이아웃 확인을 요청한다.
5. `_workspace/`는 **보존한다** (사후 검증·감사 추적용).

### Phase 7: 피드백 수집

사용자에게 묻는다:
- 산출물에서 고칠 부분이 있는가
- 에이전트 구성이나 순서에 바꾸고 싶은 점이 있는가

피드백이 나오면 `harness:harness` 스킬의 Phase 7-2 반영 경로에 따라 에이전트·스킬·오케스트레이터를 갱신하고 `CLAUDE.md` 변경 이력에 기록한다.

## 데이터 흐름

```
[리더] ── Agent(동기) ──> fact-curator ──> 01_ledger.md
                              ↑ SendMessage(등재 요청)
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
  proposal-writer  ←SendMessage→  spec-writer   deck-builder
       │                      │                      │
   02_draft.md          03_features.md          04_deck.md
       │                      │                      │
       └────── 완료 알림 ─────┴──────────────────────┘
                              ↓
                      consistency-qa (증분)
                              ↓
                     05_qa_report.md ──SendMessage(결함)──> 작성자
                              ↓
                      HWPX / 최종 문서
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| fact-curator 실패 | **진행 불가.** 1회 재시도 후 재실패 시 중단하고 사용자에게 보고. 원장 없이 문서를 쓰면 하네스의 존재 이유가 사라진다 |
| 작성자 1명 실패 | 1회 재시도. 재실패 시 나머지로 진행하고 최종 보고서에 "{문서} 미완성" 명시 |
| 배포 URL 접근 실패 | 코드 기준으로 진행. 원장과 QA 보고서 양쪽에 "배포 앱 미검증" 명시. **통과로 처리하지 않는다** |
| 원장 등재 거부로 작성자가 막힘 | 리더가 개입. 그 수치 없이 서술할 방법을 지시하거나, 사용자에게 근거를 확인 |
| 문서 간 값 충돌 | 삭제하지 않고 출처와 함께 병기한 뒤 원장이 판정. 판정 불가면 사용자에게 |
| 수정 루프 2회 초과 | 중단하고 미해결 결함 목록을 사용자에게 보고 |
| `fill_hwpx.py` verify 실패 | 무엇이 걸렸는지 확인 후 수정. 원본 템플릿은 절대 덮어쓰지 않는다 |

## 테스트 시나리오

### 정상 흐름
1. 사용자: "공모전 산출물 준비해줘"
2. Phase 0 — `_workspace/` 없음 → 초기 실행
3. Phase 1 — 팀원 실명·발표 시간 확인
4. Phase 2 — fact-curator가 원장 생성. `[구현됨]` 기능 목록과 `[계획]` 데이터 파이프라인이 구분됨
5. Phase 3 — 작성자 3명 병렬. spec-writer가 기능 ID 목록을 proposal-writer에게 공유
6. Phase 4 — 기획서 초안 완료 즉시 QA가 수치 대조. "시나리오 5종" 오기를 원장의 "3종"과 대조해 검출
7. Phase 5 — proposal-writer가 수정, QA 재검증 통과
8. Phase 6 — HWPX 생성, B6 대조, `docs/`에 배치
9. 예상 결과: 세 문서의 모든 수치가 원장과 일치, 치명·높음 결함 0

### 에러 흐름
1. Phase 2에서 배포 URL 접근 실패
2. fact-curator가 1회 재시도 후 코드베이스만으로 원장 구성, 상단에 "배포 앱 미검증" 명시
3. Phase 4에서 QA가 경계면 B2(구현 상태)를 "미검증 항목"으로 분류. 통과 처리하지 않음
4. Phase 6 최종 보고에 "배포 앱 대조 미수행 — 제출 전 수동 확인 필요" 포함
5. 사용자가 직접 배포 URL을 확인한 뒤 부분 재실행으로 B2만 재검증
