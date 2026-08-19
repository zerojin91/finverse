import { describe, expect, it } from "vitest";
import { formatDay, formatNumber, plot } from "./sparkline";

const pts = (values: (number | null)[]) =>
  values.map((close, i) => ({ bas_dd: `2026080${i}`, close }));

describe("plot", () => {
  it("종가가 2개 미만이면 그리지 않는다", () => {
    expect(plot([], 100, 50)).toBeNull();
    expect(plot(pts([100]), 100, 50)).toBeNull();
    expect(plot(pts([null, null]), 100, 50)).toBeNull();
  });

  it("결측 종가는 건너뛴다", () => {
    const drawn = plot(pts([100, null, 200]), 100, 50);
    expect(drawn?.count).toBe(2);
  });

  it("값이 전부 같아도 NaN을 만들지 않는다", () => {
    // (value-min)/span 에서 span=0 이면 NaN 이 되고 SVG가 통째로 사라진다.
    const drawn = plot(pts([500, 500, 500]), 100, 50);
    expect(drawn).not.toBeNull();
    expect(drawn!.path).not.toContain("NaN");
    expect(drawn!.min).toBe(500);
    expect(drawn!.max).toBe(500);
  });

  it("변화율은 첫 값 대비 마지막 값", () => {
    const drawn = plot(pts([100, 150]), 100, 50);
    expect(drawn!.changePct).toBeCloseTo(50);
  });

  it("첫 값이 0이면 변화율은 null", () => {
    expect(plot(pts([0, 10]), 100, 50)!.changePct).toBeNull();
  });

  it("좌표가 주어진 상자 안에 들어간다", () => {
    const drawn = plot(pts([10, 90, 50, 70]), 200, 60, 2);
    for (const pair of drawn!.path.split(" ")) {
      const [x, y] = pair.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(200);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(60);
    }
  });

  it("높은 값이 위로 간다 (SVG는 y가 아래로 증가)", () => {
    const drawn = plot(pts([10, 90]), 100, 50);
    const [, y0] = drawn!.path.split(" ")[0].split(",").map(Number);
    const [, y1] = drawn!.path.split(" ")[1].split(",").map(Number);
    expect(y1).toBeLessThan(y0);
  });
});

describe("formatDay", () => {
  it("YYYYMMDD를 편다", () => {
    expect(formatDay("20260814")).toBe("2026-08-14");
  });

  it("분기 표기는 그대로 둔다", () => {
    expect(formatDay("2026Q2")).toBe("2026Q2");
  });
});

describe("formatNumber", () => {
  it("큰 값은 정수로", () => {
    expect(formatNumber(230000)).toBe("230,000");
  });

  it("작은 값은 소수점을 남긴다", () => {
    expect(formatNumber(0.1234)).toBe("0.1234");
  });
});
