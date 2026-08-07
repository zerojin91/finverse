# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Canonical entry point is a Python wrapper around npm (`tools/site.py`), which auto-runs `npm ci` when `node_modules` is missing:

```bash
uv run python tools/site.py dev     # http://localhost:3000
uv run python tools/site.py build
uv run python tools/site.py test
uv run python tools/site.py lint
```

`npm run dev|build|test|lint` does the same thing if deps are already installed. Node >= 22.13.

**Tests require a build first** — `npm test` is `npm run build && node --test tests/rendered-html.test.mjs`. The test imports the built `dist/server/index.js` and calls the Worker's `fetch` with stub `ASSETS`/`ctx` bindings. To run one test against an existing build, skip the rebuild:

```bash
node --test --test-name-pattern="server-renders" tests/rendered-html.test.mjs
```

## Build stack — read before touching config

Despite `next.config.ts` and `vercel.json`, **the build does not run `next build`**. `package.json` scripts call `vinext` (Vite + `@vitejs/plugin-rsc` + `@cloudflare/vite-plugin`), so the real pipeline is Vite → Cloudflare Worker bundle in `dist/`. `vercel.json` is stale scaffolding; `next.config.ts` is empty.

- `worker/index.ts` — the deployed entry. Intercepts `/_vinext/image` for Cloudflare Images optimization, delegates everything else to `vinext/server/app-router-entry`.
- `vite.config.ts` — reads `.openai/hosting.json`; `d1`/`r2` are `null`, so no bindings are declared. Also forces HMR polling under Codex's seatbelt sandbox.
- `build/sites-vite-plugin.ts` — post-build step copying `.openai/hosting.json` (and `drizzle/` if it ever exists) into `dist/.openai`.

## Architecture

**The entire app is one client component.** `app/page.tsx` (~1400 lines) holds the type definitions, all hardcoded demo data, and every sub-component (`ForecastChart`, `KnowledgeGraphPreview`, `ScenarioBuildScreen`, `TwinPage`, …). `app/layout.tsx` only sets `<html lang="ko">` and metadata. There is no API route, database, or backend of any kind.

State lives in `Home()`: `activeTab` (`"market" | "twin"`), `selectedScenario`, and the scenario-builder modal machine (`builderMode` `form`→`build`, `buildStage` 1→6 advanced by 5s `setTimeout`, then `simulationStarted`). "Building a custom scenario" clones `scenarios[0]` with a new title — it computes nothing.

**No live data and no LLM calls exist yet.** Every number, news item, and AI-sounding insight is a literal in the `scenarios` array. `docs/ontology/finverse-ontology.md` specifies the intended data layer (KRX/DART/ECOS/FRED sourcing, the market→economy→events→sentiment ontology, and the MiroFish simulation step) — that is a spec for work not yet built, not a description of the code.

Charts are hand-written inline SVG with local `x()`/`y()` scale helpers, not a charting library.

### Gotchas

- **`tests/rendered-html.test.mjs` is a content snapshot.** It asserts on exact Korean UI strings and figures (`6,023.66`, `-10.84%`, `220,000원`, `sidebar-brand`) and on strings that must *not* appear (`top-tabs`, `내 금융 상태`, `codex-preview`). Editing copy or demo numbers in `app/page.tsx` breaks it — update the assertions deliberately, they encode intended UI state.
- **Styling is hand-written CSS**, ~460 classes in `app/globals.css` keyed to semantic class names, with a small `:root` token set (`--ink`, `--up` red / `--down` blue per Korean market convention). Tailwind is installed and wired into PostCSS but **never imported** — do not start writing utility classes.
- Scenario images and the OG image load from `raw.githubusercontent.com/zerojin91/finverse/main/public/...` even though the same files sit in `public/`. Local edits to those PNGs won't show until pushed.

## Product context

FINVERSE is a 2026 금융 AI Challenge entry: a Korean-language financial-judgment simulator. Two tabs only — 시장 인사이트 (market insight → simulate) and 마이 금융 트윈 (apply to a virtual profile). README.md is the full proposal; its stated safety rules constrain feature work: present conditional ranges with confidence intervals rather than point predictions, never recommend specific products, label everything as educational and virtual, and keep generative text separate from the numbers the simulation engine produces.

All UI copy is Korean.

## 하네스: 공모전 산출물 제작

**목표:** 기획서·MVP 기능명세서·발표자료를 사실 원장 기반으로 제작해, 문서 간 수치·기능 불일치와 과장된 구현 상태를 구조적으로 차단한다.

**트리거:** 공모전 산출물 관련 작업 요청 시 `finverse-deliverables` 스킬을 사용하라 — 기획서/명세서/발표자료 작성·수정, 본선 제출 준비, 최종 점검, 부분 재실행 포함. 단순 질문은 직접 응답 가능.

**실행 모드:** 서브 에이전트 + 피어 메시징. 이 빌드에는 `TeamCreate`가 없으므로 `Agent`(named, background) + `SendMessage` + `TaskCreate`로 팀 조율을 구현한다. `TeamCreate`가 생기면 오케스트레이터를 팀 모드로 전환할 것.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-08-07 | 초기 구성 (에이전트 5, 스킬 6) | 전체 | - |
