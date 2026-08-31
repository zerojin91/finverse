"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronRight, Plus, UserRound } from "lucide-react";
import { PageHeading, Panel } from "@/components/ds";
import { twinGeometry } from "@/lib/charts";
import { DISCLAIMER, MARKET_STAMP, experts, holdings, scenarios } from "@/lib/finverse-data";

export default function FinancialTwinScreen() {
  const [selectedId, setSelectedId] = React.useState(scenarios[0].id);
  const selected = scenarios.find((s) => s.id === selectedId) ?? scenarios[0];
  const tg = twinGeometry(scenarios, selectedId);

  return (
    <div className="twin-page" data-screen-label="마이 금융 트윈">
      <PageHeading
        className="twin-heading"
        kicker="MY FINANCIAL TWIN"
        title="내 금융 상태를 이해하고, 다음 선택을 미리 확인하세요."
        stamp={
          <>
            <CalendarDays size={15} />
            {MARKET_STAMP}
          </>
        }
      />

      <Panel
        className="twin-assets-panel"
        title="나의 자산 현황"
        aside={
          <span className="twin-profile-chip">
            <UserRound size={13} /> 김민서님
          </span>
        }
      >
        <div className="twin-assets-grid">
          <div className="twin-metric">
            <span>총 자산(평가금액)</span>
            <strong>128,450,000원</strong>
            <small>
              전일 대비 <b className="up">+1,250,000원 (+0.98%)</b>
            </small>
          </div>
          <div className="twin-metric">
            <span>현금 비중</span>
            <strong>
              18.4<em>%</em>
            </strong>
            <small>23,600,000원</small>
          </div>
          <div className="twin-metric">
            <span>목표 달성률</span>
            <strong>
              62<em>%</em>
            </strong>
            <div className="twin-progress">
              <i style={{ width: "62%" }} />
            </div>
            <small>목표 금액 200,000,000원</small>
          </div>
          <div className="twin-net-chart">
            <div>
              <span>순자산 추이 (최근 6개월)</span>
              <strong>+18.4%</strong>
            </div>
            <svg viewBox="0 0 280 92" aria-label="최근 6개월 순자산 추이">
              <line x1="0" y1="22" x2="280" y2="22" />
              <line x1="0" y1="48" x2="280" y2="48" />
              <line x1="0" y1="74" x2="280" y2="74" />
              <path d="M4 71 C19 65 28 69 40 58 S62 62 74 50 S93 46 104 48 S124 38 137 41 S152 29 166 34 S183 22 196 28 S212 21 222 24 S237 11 248 17 S262 8 276 4" />
            </svg>
            <div className="twin-chart-labels">
              {["2월", "3월", "4월", "5월", "6월", "7월"].map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <section className="twin-main-grid">
        <Panel
          title="포트폴리오 보유 현황"
          aside={
            <button className="twin-text-button" type="button">
              전체 보기 <ChevronRight size={15} />
            </button>
          }
        >
          <div className="twin-table-wrap">
            <table className="twin-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th>현재가</th>
                  <th>비중</th>
                  <th>등락률(1D)</th>
                  <th>기여도(1D)</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.name}>
                    <td>
                      <div className="twin-holding-name">
                        <span className={`twin-holding-symbol ${h.tone}`}>{h.symbol}</span>
                        <div>
                          <strong>{h.name}</strong>
                          <small>{h.code}</small>
                        </div>
                      </div>
                    </td>
                    <td>{h.value}</td>
                    <td>{h.weight}</td>
                    <td className={h.tone}>{h.change}</td>
                    <td className={h.tone}>{h.contribution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="twin-table-note">* 가격과 수익률은 {MARKET_STAMP}이며, 실제 계좌와 다를 수 있습니다.</p>
        </Panel>

        <Panel title="시나리오별 내 자산 경로" aside={<span className="twin-path-caption">조건에 따른 가상 경로</span>}>
          <div className="twin-scenario-cards">
            {scenarios.map((s, i) => (
              <button
                key={s.id}
                className={`twin-scenario-card${s.id === selectedId ? " active" : ""}`}
                type="button"
                aria-pressed={s.id === selectedId}
                onClick={() => setSelectedId(s.id)}
              >
                <span className="twin-radio" />
                <span>
                  <small>시나리오 {i + 1}</small>
                  <strong>{s.title}</strong>
                  <em>{s.forecast}</em>
                </span>
                <i>{s.tone === "up" ? "상승" : "하락"}</i>
              </button>
            ))}
            <Link className="twin-scenario-card twin-add-scenario" href="/insights#scenarios">
              <Plus size={20} />
              <span>
                <small>내 시나리오</small>
                <strong>직접 만들기</strong>
              </span>
            </Link>
          </div>

          <div className="twin-selected-path">
            <div className="twin-selected-path-head">
              <div>
                <span>선택 시나리오</span>
                <strong>{selected.title}</strong>
              </div>
              <b className={selected.tone}>{selected.forecast}</b>
            </div>
            <svg className="twin-path-chart" viewBox="0 0 540 170" role="img" aria-label="나의 자산 예상 경로">
              {[28, 60, 92, 124].map((gy) => (
                <line key={gy} x1={24} y1={gy} x2={520} y2={gy} stroke="var(--line)" strokeWidth={1} />
              ))}
              <polygon points={tg.band} fill={tg.bandFill} />
              {tg.lines.map((l, i) => (
                <path
                  key={i}
                  d={l.d}
                  fill="none"
                  stroke={l.color}
                  strokeWidth={l.selected ? 2.8 : 1.6}
                  strokeDasharray={l.selected ? undefined : "5 4"}
                  strokeLinecap="round"
                  opacity={l.selected ? 1 : 0.72}
                />
              ))}
              <circle cx={24} cy={tg.startY} r={4} fill="var(--ink)" />
              {tg.lines.map((l, i) => (
                <text key={i} x={452} y={l.labelY} fill={l.color} fontSize={11} fontWeight={700}>
                  {l.label}
                </text>
              ))}
              <text x={32} y={tg.startY - 9} fill="var(--text)" fontSize={11} fontWeight={700}>
                128.5
              </text>
              <text x={18} y={154} fill="#a1a1aa" fontSize={10}>
                현재
              </text>
              <text x={180} y={154} fill="#a1a1aa" fontSize={10}>
                7일 후
              </text>
              <text x={342} y={154} fill="#a1a1aa" fontSize={10}>
                14일 후
              </text>
              <text x={486} y={154} fill="#a1a1aa" fontSize={10}>
                1개월 후
              </text>
            </svg>
            <p>* 조건부 가상 경로이며 실제 수익률을 보장하지 않습니다.</p>
          </div>
        </Panel>
      </section>

      <Panel className="twin-experts-panel" title="금융 대가의 한마디" aside={<span>시나리오에 대한 서로 다른 관점</span>}>
        <div className="twin-expert-grid">
          {experts.map((x) => (
            <article key={x.initials}>
              <div className="twin-expert-avatar">{x.initials}</div>
              <div>
                <span>{x.who}</span>
                <h3>{x.line}</h3>
                <p>{x.body}</p>
                <button type="button">
                  직접 이야기해보기 <ArrowRight size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="twin-disclaimer">{DISCLAIMER}</div>
      </Panel>
    </div>
  );
}
