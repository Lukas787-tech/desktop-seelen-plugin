/**
 * Panel rectangles on a surface: whether two collide, whether one has left the
 * display, and where a new one fits. Pure, for `npm test`; the store re-exports
 * these, and `Surface.svelte` decides when to use them.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Bounds {
  width: number;
  height: number;
}

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/**
 * Where a panel of `size` can go without covering anything in `taken`.
 *
 * Scans the surface in `step`-sized moves, top to bottom and left to right, the
 * way a person fills a desk, keeping a margin from the display edge and a gap
 * from other panels. Returns null when nothing fits, which on a crowded 1080p
 * display is a real answer: the caller then keeps the panel where it is rather
 * than stacking it somewhere arbitrary.
 */
export function findFreeSpot(
  size: { w: number; h: number },
  taken: readonly Rect[],
  bounds: Bounds,
  step = 20,
): { x: number; y: number } | null {
  const margin = 40;
  const gap = 16;
  const stride = Math.max(4, step);
  const maxX = bounds.width - size.w - margin;
  const maxY = bounds.height - size.h - margin;
  for (let y = margin; y <= maxY; y += stride) {
    for (let x = margin; x <= maxX; x += stride) {
      const candidate = { x, y, w: size.w, h: size.h };
      if (!taken.some((rect) => overlaps(candidate, rect, gap))) return { x, y };
    }
  }
  return null;
}

/**
 * Whether a panel is out of reach: its header above or left of the display, or
 * less than a grabbable strip of it left inside the right or bottom edge.
 */
export function isOffSurface(rect: Rect, bounds: Bounds): boolean {
  return rect.x < 0 || rect.y < 0 || rect.x + Math.min(rect.w, 120) > bounds.width || rect.y + 40 > bounds.height;
}
