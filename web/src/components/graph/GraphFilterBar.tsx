import type { LabelEntry } from "../../api/types";
import { LAYER_COLORS, LAYER_LABELS, nodeStyleOf } from "./graphStyles";
import type { Layer } from "./graphStyles";

type Props = {
  labels: LabelEntry[];
  selected: string[];
  onToggle: (label: string) => void;
  perLabel: number;
  onPerLabel: (value: number) => void;
};

const LAYER_ORDER: Layer[] = ["entity", "event", "scenario"];

/** 라벨 필터 — 계층별로 묶는다. 0건 라벨은 눌러도 소용없으므로 비활성화하되
    숨기지는 않는다. "정의는 됐고 아직 안 채워진 자리"가 이 화면의 정보다. */
export default function GraphFilterBar({
  labels,
  selected,
  onToggle,
  perLabel,
  onPerLabel,
}: Props) {
  const byLayer = new Map<Layer, LabelEntry[]>();
  for (const entry of labels) {
    const layer = nodeStyleOf(entry.label).layer;
    const list = byLayer.get(layer);
    if (list) list.push(entry);
    else byLayer.set(layer, [entry]);
  }

  return (
    <div className="filter-bar">
      {LAYER_ORDER.map((layer) => {
        const entries = byLayer.get(layer) ?? [];
        if (entries.length === 0) return null;
        return (
          <div className="filter-group" key={layer}>
            <span className="filter-layer" style={{ color: LAYER_COLORS[layer] }}>
              {LAYER_LABELS[layer]}
            </span>
            {entries.map((entry) => {
              const style = nodeStyleOf(entry.label);
              const active = selected.includes(entry.label);
              const empty = entry.count === 0;
              return (
                <button
                  type="button"
                  key={entry.label}
                  className={`chip${active ? " active" : ""}${empty ? " empty" : ""}`}
                  style={active ? { backgroundColor: style.color, borderColor: style.color } : undefined}
                  disabled={empty}
                  title={empty ? "어휘에는 있으나 아직 투영된 노드가 없습니다" : entry.label}
                  onClick={() => onToggle(entry.label)}
                >
                  {style.ko || entry.label}
                  <span className="chip-count">{entry.count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      <label className="filter-per-label">
        라벨당
        <input
          type="number"
          min={1}
          max={500}
          value={perLabel}
          onChange={(e) => onPerLabel(Number(e.target.value) || 1)}
        />
        개
      </label>
    </div>
  );
}
