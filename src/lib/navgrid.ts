/**
 * Spatial navigation: which control a direction should move to.
 *
 * Game mode is driven by four directions and has no tab order to fall back on -
 * a shelf of art, a row of section tabs and a column of settings all live on
 * one screen, and "down" from the last section tab has to mean the shelf under
 * it, not the next element in the document.
 *
 * So the answer is worked out from geometry, the way a television interface
 * does it: of everything lying in the direction pressed, take what overlaps the
 * current control across the direction of travel, and of those the nearest.
 *
 * Pure: it takes rectangles and returns an id, so `npm test` can check the
 * awkward cases (a wide row above a grid, a column beside a shelf) without a
 * browser.
 */

export type NavDirection = 'up' | 'down' | 'left' | 'right';

export interface NavRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Controls of the same group are preferred over ones outside it, so a long
   * shelf does not lose the selection to a nearer thing in another row.
   */
  group?: string;
  /** Skipped entirely: a disabled button, or a row scrolled out of reach. */
  disabled?: boolean;
}

interface Edges {
  near: number;
  far: number;
  crossStart: number;
  crossEnd: number;
  centre: number;
  crossCentre: number;
}

/**
 * A rectangle described along the direction of travel.
 *
 * `near`/`far` run with the direction and `cross*` across it, so one comparison
 * works for all four directions instead of four near-identical ones.
 */
function edgesOf(rect: NavRect, direction: NavDirection): Edges {
  const vertical = direction === 'up' || direction === 'down';
  const forward = direction === 'down' || direction === 'right';

  const start = vertical ? rect.y : rect.x;
  const size = vertical ? rect.h : rect.w;
  const crossStart = vertical ? rect.x : rect.y;
  const crossSize = vertical ? rect.w : rect.h;

  return {
    near: forward ? start + size : -start,
    far: forward ? start : -(start + size),
    crossStart,
    crossEnd: crossStart + crossSize,
    centre: forward ? start + size / 2 : -(start + size / 2),
    crossCentre: crossStart + crossSize / 2,
  };
}

/** How much of the cross axis two rectangles share, in pixels. */
function overlap(a: Edges, b: Edges): number {
  return Math.min(a.crossEnd, b.crossEnd) - Math.max(a.crossStart, b.crossStart);
}

/**
 * The control a direction should land on, or null at the edge.
 *
 * Scoring, in order of weight:
 *
 * 1. Anything not strictly ahead is out. "Strictly" is measured against the
 *    *centre*, not the edge: a tall panel beside a short one overlaps it, and
 *    an edge test would call the neighbour "not ahead" and refuse to move.
 * 2. Overlapping the current control across the direction of travel is worth a
 *    large discount, which is what keeps a column a column and a row a row.
 * 3. Then distance ahead, with the sideways offset counted at a fraction of
 *    its true size - the selection should prefer something a little to the
 *    side and close over something dead ahead and far away.
 */
export function pickNeighbour(
  fromId: string,
  rects: readonly NavRect[],
  direction: NavDirection,
): string | null {
  const from = rects.find((rect) => rect.id === fromId);
  if (!from) return null;
  const origin = edgesOf(from, direction);

  let best: string | null = null;
  let bestScore = Infinity;

  for (const rect of rects) {
    if (rect.id === fromId || rect.disabled) continue;
    const target = edgesOf(rect, direction);

    // Ahead, by the centre. A neighbour whose centre is level or behind is
    // never what the direction meant, however much the boxes overlap.
    const ahead = target.centre - origin.centre;
    if (ahead <= 0.5) continue;

    const shared = overlap(origin, target);
    const sideways = Math.abs(target.crossCentre - origin.crossCentre);

    // The gap between the boxes, which is what "nearest" should mean; a big
    // control is not further away for being big.
    const gap = Math.max(0, target.far - origin.near);

    let score = gap + ahead * 0.25 + sideways * (shared > 0 ? 0.08 : 0.9);
    if (shared > 0) score -= 6000;
    if (rect.group && rect.group === from.group) score -= 400;

    if (score < bestScore) {
      bestScore = score;
      best = rect.id;
    }
  }

  return best;
}

/**
 * The first control to select when a screen opens, or when the one that was
 * selected has gone.
 *
 * Top-left within the preferred group, because that is where a reader starts
 * and where every section of game mode puts its first real control.
 */
export function firstIn(rects: readonly NavRect[], group?: string): string | null {
  const usable = rects.filter((rect) => !rect.disabled && (!group || rect.group === group));
  const pool = usable.length ? usable : rects.filter((rect) => !rect.disabled);
  let best: NavRect | null = null;
  for (const rect of pool) {
    if (!best || rect.y < best.y - 4 || (Math.abs(rect.y - best.y) <= 4 && rect.x < best.x)) {
      best = rect;
    }
  }
  return best?.id ?? null;
}

/**
 * The control nearest a point, used when the selection has to be re-found -
 * a row re-rendered under it, a filter that removed what was selected.
 */
export function nearestTo(
  rects: readonly NavRect[],
  x: number,
  y: number,
  group?: string,
): string | null {
  const pool = rects.filter((rect) => !rect.disabled && (!group || rect.group === group));
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const rect of pool) {
    const distance = Math.hypot(rect.x + rect.w / 2 - x, rect.y + rect.h / 2 - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = rect.id;
    }
  }
  return best;
}
