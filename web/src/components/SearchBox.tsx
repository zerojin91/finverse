import { useState } from "react";
import { useSearch } from "../api/hooks";
import { nodeStyleOf } from "./graph/graphStyles";

type Props = {
  onPick: (uid: string) => void;
};

/** 노드 검색 — 고르면 캔버스가 그 노드로 이동하고 이웃을 불러온다. */
export default function SearchBox({ onPick }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useSearch(text.trim());

  return (
    <div className="search-box">
      <input
        type="search"
        value={text}
        placeholder="종목·지수·섹터·지표 검색 (이름, 티커, uid)"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // blur 즉시 닫으면 결과 클릭이 먹히지 않는다 — 한 틱 늦춘다.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && text.trim() && (
        <ul className="search-results">
          {isFetching && <li className="state">검색 중…</li>}
          {data?.hits.length === 0 && !isFetching && <li className="state">결과 없음</li>}
          {data?.hits.map((hit) => {
            const style = nodeStyleOf(hit.label);
            return (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(hit.id);
                    setOpen(false);
                  }}
                >
                  <span className="dot" style={{ backgroundColor: style.color }} />
                  <span className="hit-name">{hit.name}</span>
                  <span className="hit-label">{style.ko || hit.label}</span>
                </button>
              </li>
            );
          })}
          {data?.truncated && <li className="state">…더 있습니다. 검색어를 좁혀보세요.</li>}
        </ul>
      )}
    </div>
  );
}
