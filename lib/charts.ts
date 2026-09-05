import type { Scenario } from "./finverse-data";

/** Chart geometry helpers. All return SVG path/point strings so charts stay server-renderable. */

export const UP = "#ef4444";
export const DOWN = "#2563eb";
export const INK = "var(--ink)";
export const toneColor = (tone: "up" | "down") => (tone === "up" ? UP : DOWN);
export const toneBand = (tone: "up" | "down") => (tone === "up" ? "rgba(239,68,68,.12)" : "rgba(37,99,235,.12)");

export interface ForecastGeometry {
  grid: number[];
  actualPath: string;
  forecastPath: string;
  band: string;
  splitX: number;
  splitY: number;
  endX: number;
  endY: number;
  endValue: number;
  width: number;
  height: number;
}

/** Ink actual line → tone-colored forecast line with a 70% confidence band. */
export function forecastGeometry(actual: number[], scenario: Scenario, width = 760, height = 290): ForecastGeometry {
  const padL = 16, padR = 90, padT = 26, padB = 30;
  const all = [...actual, ...scenario.path];
  const min = Math.min(...all) - 300;
  const max = Math.max(...all) + 300;
  const n = actual.length + scenario.path.length - 1;
  const x = (i: number) => padL + (i / n) * (width - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);
  const f = (i: number) => x(actual.length - 1 + i);

  const grid = [0, 1, 2, 3].map((g) => padT + (g * (height - padT - padB)) / 3);
  const actualPath = actual.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const forecastPath = scenario.path.map((v, i) => `${i ? "L" : "M"}${f(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const upper = scenario.path.map((v, i) => `${f(i).toFixed(1)},${y(v + 60 + i * 55).toFixed(1)}`).join(" ");
  const lower = [...scenario.path]
    .map((v, i) => ({ v, i }))
    .reverse()
    .map(({ v, i }) => `${f(i).toFixed(1)},${y(v - 60 - i * 55).toFixed(1)}`)
    .join(" ");
  const endValue = scenario.path[scenario.path.length - 1];

  return {
    grid,
    actualPath,
    forecastPath,
    band: `${upper} ${lower}`,
    splitX: f(0),
    splitY: y(actual[actual.length - 1]),
    endX: f(scenario.path.length - 1),
    endY: y(endValue),
    endValue,
    width,
    height,
  };
}

export interface TwinGeometry {
  lines: { d: string; color: string; selected: boolean; label: string; labelY: number }[];
  band: string;
  bandFill: string;
  startY: number;
}

/** Three indexed net-worth paths; the selected one is solid, the others dashed. */
export function twinGeometry(all: Scenario[], selectedId: string): TwinGeometry {
  const start = 128.5;
  const colors = [INK, UP, DOWN];
  const x = (i: number) => 24 + (i / 11) * 496;
  const y = (v: number) => 142 - ((v - 94) / 54) * 110;
  const series = (target: number) =>
    Array.from({ length: 12 }, (_, i) => start + ((target - start) * i) / 11 + Math.sin(i * 1.25) * 0.65);

  const si = Math.max(0, all.findIndex((s) => s.id === selectedId));
  const sets = all.map((s) => series(s.twinTarget));
  const sel = sets[si];
  const d = (l: number[]) => l.map((v, i) => `${i ? "L " : "M "}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const upper = sel.map((v, i) => `${x(i).toFixed(1)},${y(v + 4 + i * 0.45).toFixed(1)}`).join(" ");
  const lower = [...sel]
    .map((v, i) => ({ v, i }))
    .reverse()
    .map(({ v, i }) => `${x(i).toFixed(1)},${y(v - 4 - i * 0.45).toFixed(1)}`)
    .join(" ");

  return {
    lines: all.map((s, i) => ({
      d: d(sets[i]),
      color: colors[i % colors.length],
      selected: i === si,
      label: `${s.twinTarget.toFixed(1)} (${s.twinNote})`,
      labelY: y(s.twinTarget) - (i === 0 ? 7 : i === 1 ? 0 : -9),
    })),
    band: `${upper} ${lower}`,
    bandFill: si === 0 ? "rgba(17,17,19,.08)" : `${colors[si % colors.length]}18`,
    startY: y(start),
  };
}

/** 66×66 sparkline for the mini index cards. */
export function sparkline(points: number[]) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pts = points
    .map((v, i) => `${(5 + (i * 56) / (points.length - 1)).toFixed(1)},${(55 - ((v - min) / range) * 44).toFixed(1)}`)
    .join(" ");
  const lastY = 55 - ((points[points.length - 1] - min) / range) * 44;
  return { pts, lastY };
}
