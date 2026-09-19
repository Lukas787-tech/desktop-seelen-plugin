/**
 * The little bit of chart geometry the panels share: a series scaled into a
 * box, a smooth line through it, the area under that line, and an axis maximum
 * a person can read.
 *
 * SVG paths rather than a canvas. A panel redraws a graph every few seconds at
 * most, SVG scales with the panel for free, and a `path` whose `d` changes is
 * one attribute write - there is no context to size, clear or keep in step
 * with the device pixel ratio.
 */

export type Point = readonly [x: number, y: number];

/** One line on a `Graph`. */
export interface GraphSeries {
  values: readonly number[];
  /** The value at the top of the graph. */
  max: number;
  min?: number;
  /** Fill the area under the line. */
  fill?: boolean;
  tone?: 'accent' | 'warm' | 'muted';
}

/**
 * Scales `values` into a `width` x `height` box, newest on the right.
 *
 * `slots` fixes the horizontal spacing, so a series still filling up grows in
 * from the right at its final pitch instead of stretching to fill the width.
 */
export function scale(
  values: readonly number[],
  width: number,
  height: number,
  max: number,
  slots = values.length,
  min = 0,
): Point[] {
  const count = Math.max(2, slots);
  const step = width / (count - 1);
  const offset = (count - values.length) * step;
  const range = max - min || 1;
  return values.map((v, i) => {
    const clamped = Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
    return [offset + i * step, height - ((clamped - min) / range) * height] as const;
  });
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * A line through the points: straight segments, or a monotone cubic.
 *
 * Monotone rather than Catmull-Rom because a load graph must never overshoot -
 * a smoothed CPU line that dips below zero between two zero samples reads as a
 * bug, and Catmull-Rom does exactly that.
 */
export function linePath(points: readonly Point[], smooth = true): string {
  if (points.length === 0) return '';
  const [x0, y0] = points[0] as Point;
  if (points.length === 1 || !smooth) {
    return `M${fmt(x0)},${fmt(y0)}${points.slice(1).map(([x, y]) => `L${fmt(x)},${fmt(y)}`).join('')}`;
  }

  // Fritsch-Carlson tangents.
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = points[i] as Point;
    const [xb, yb] = points[i + 1] as Point;
    dx[i] = xb - xa;
    slope[i] = dx[i] ? (yb - ya) / (dx[i] as number) : 0;
  }
  const tangent: number[] = [slope[0] ?? 0];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1] as number;
    const b = slope[i] as number;
    tangent[i] = a * b <= 0 ? 0 : (3 * ((dx[i - 1] as number) + (dx[i] as number))) /
      ((2 * (dx[i] as number) + (dx[i - 1] as number)) / a + ((dx[i] as number) + 2 * (dx[i - 1] as number)) / b);
  }
  tangent[n - 1] = slope[n - 2] ?? 0;

  let d = `M${fmt(x0)},${fmt(y0)}`;
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = points[i] as Point;
    const [xb, yb] = points[i + 1] as Point;
    const h = (dx[i] as number) / 3;
    d += `C${fmt(xa + h)},${fmt(ya + h * (tangent[i] as number))} ${fmt(xb - h)},${fmt(yb - h * (tangent[i + 1] as number))} ${fmt(xb)},${fmt(yb)}`;
  }
  return d;
}

/** The same line, closed down to the baseline, for a filled area. */
export function areaPath(points: readonly Point[], height: number, smooth = true): string {
  if (points.length < 2) return '';
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  return `${linePath(points, smooth)}L${fmt(last[0])},${fmt(height)}L${fmt(first[0])},${fmt(height)}Z`;
}

/** Rounds up to 1, 2 or 5 times a power of ten, so an axis reads cleanly. */
export function niceMax(value: number, floor = 1): number {
  const v = Math.max(floor, value);
  const power = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 5, 10]) {
    if (v <= step * power) return step * power;
  }
  return 10 * power;
}
