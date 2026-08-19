/*
 * 스파크라인 기하 계산 — 순수 함수. 차트 라이브러리를 쓰지 않는다.
 * 값의 모양만 보여주면 되는 자리라 SVG polyline 한 줄이면 충분하고,
 * 의존성을 하나 더 들이는 값이 여기서는 안 나온다.
 */

export type Point = { bas_dd: string; close: number | null };

export type Plotted = {
  /** SVG polyline points 속성에 그대로 넣는 문자열 */
  path: string;
  min: number;
  max: number;
  first: number;
  last: number;
  /** 첫 값 대비 마지막 값의 변화율(%). 첫 값이 0이면 null */
  changePct: number | null;
  count: number;
};

/**
 * 종가가 있는 점만 골라 [0,width] x [0,height] 안에 그린다.
 *
 * 값이 전부 같으면 분모가 0이 되므로 그때는 세로 가운데에 직선을 놓는다.
 * 점이 하나뿐이면 선을 그릴 수 없어 null.
 */
export function plot(
  points: readonly Point[],
  width: number,
  height: number,
  pad = 2,
): Plotted | null {
  const values: number[] = [];
  for (const p of points) {
    if (p.close !== null && Number.isFinite(p.close)) values.push(p.close);
  }
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usableH = height - pad * 2;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  const path = values
    .map((value, i) => {
      const x = i * stepX;
      // span이 0이면 (value-min)/span 이 NaN 이 된다 — 가운데 고정.
      const ratio = span === 0 ? 0.5 : (value - min) / span;
      const y = pad + (1 - ratio) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const first = values[0];
  const last = values[values.length - 1];
  return {
    path,
    min,
    max,
    first,
    last,
    changePct: first === 0 ? null : ((last - first) / first) * 100,
    count: values.length,
  };
}

/** 20260814 -> 2026-08-14. 분기 표기(2026Q2) 등 다른 형식은 그대로 둔다. */
export function formatDay(raw: string): string {
  return /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`
    : raw;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  // 지수·지표는 소수점이 의미 있고, 주가는 정수로 충분하다.
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
