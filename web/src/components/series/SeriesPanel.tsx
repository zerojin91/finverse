import { useState } from "react";
import { useSeries } from "../../api/hooks";
import { formatDay, formatNumber, plot } from "./sparkline";

type Props = {
  uid: string;
  /** 이 라벨이 시계열을 가질 수 있는가. 없으면 접힌 채로 두고 요청도 안 한다. */
  hasSeries: boolean;
};

const WIDTH = 296;
const HEIGHT = 64;

/** 소스 이름을 화면 표기로. 두 소스는 산출 기준이 달라 그걸 같이 보여준다. */
const SOURCE_LABEL: Record<string, string> = {
  naver_finance: "Naver · 수정주가",
  naver: "Naver · 수정주가",
  krx_open_api: "KRX · 원주가",
  ECOS: "한국은행 ECOS",
  KOSIS: "KOSIS",
};

/**
 * 노드의 시계열. 값은 그래프에도 core에도 없고, 펼쳤을 때만 lake에서 읽는다
 * (scenario-ontology.md §0 — 시계열은 그래프에 넣지 않는다).
 */
export default function SeriesPanel({ uid, hasSeries }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const { data, isFetching, error } = useSeries(uid, source, open);

  if (!hasSeries) return null;

  const drawn = data ? plot(data.points, WIDTH, HEIGHT) : null;
  const up = drawn ? drawn.last >= drawn.first : true;

  return (
    <section className="panel-section">
      <h4>
        <button type="button" className="series-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? "▾" : "▸"} 시계열
        </button>
        <span className="muted small"> 펼칠 때 조회</span>
      </h4>

      {!open && <p className="muted small">그래프에는 값이 없습니다. 눌러서 불러옵니다.</p>}

      {open && isFetching && <p className="state">불러오는 중…</p>}
      {open && error && <p className="state error">{(error as Error).message}</p>}

      {open && data && data.kind === "none" && (
        <p className="muted small">이 라벨은 시계열을 갖지 않습니다.</p>
      )}

      {open && data && data.kind !== "none" && data.points.length === 0 && (
        <p className="muted small">수집된 시계열이 없습니다.</p>
      )}

      {open && data && drawn && (
        <>
          {data.sources.length > 1 && (
            <div className="series-sources">
              {data.sources.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`chip${s === data.source ? " active" : ""}`}
                  onClick={() => setSource(s)}
                >
                  {SOURCE_LABEL[s] ?? s}
                </button>
              ))}
            </div>
          )}

          <svg
            className="sparkline"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${formatDay(data.points[0].bas_dd)}부터 ${formatDay(
              data.points[data.points.length - 1].bas_dd,
            )}까지 종가 추이`}
          >
            <polyline
              points={drawn.path}
              fill="none"
              stroke={up ? "#dc2626" : "#2563eb"}
              strokeWidth="1.5"
            />
          </svg>

          <dl className="kv">
            <div className="kv-row">
              <dt>기간</dt>
              <dd>
                {formatDay(data.points[0].bas_dd)} ~{" "}
                {formatDay(data.points[data.points.length - 1].bas_dd)}
                {data.truncated && <span className="warn"> (최근 {drawn.count}개만)</span>}
              </dd>
            </div>
            <div className="kv-row">
              <dt>최근값</dt>
              <dd>
                {formatNumber(drawn.last)}
                {drawn.changePct !== null && (
                  <span className={up ? "up" : "down"}>
                    {" "}
                    {drawn.changePct >= 0 ? "+" : ""}
                    {drawn.changePct.toFixed(2)}%
                  </span>
                )}
              </dd>
            </div>
            <div className="kv-row">
              <dt>범위</dt>
              <dd>
                {formatNumber(drawn.min)} ~ {formatNumber(drawn.max)}
              </dd>
            </div>
            {data.source && (
              <div className="kv-row">
                <dt>기준</dt>
                <dd>{SOURCE_LABEL[data.source] ?? data.source}</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </section>
  );
}
