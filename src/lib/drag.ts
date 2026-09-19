/** Which edges a resize handle moves. */
export type ResizeEdge = 'e' | 's' | 'se';

export interface DraggableParams {
  /** Disable dragging entirely (layout lock). */
  disabled?: boolean;
  /** Cell size used when snapping. */
  gridSize: number;
  snap: boolean;
  /** Surface size, used to keep items on screen. */
  bounds: { width: number; height: number };
  /** Called at most once per frame while dragging. */
  onMove: (x: number, y: number) => void;
  /** Called once when the drag finishes. */
  onEnd: (x: number, y: number) => void;
}

function snapTo(value: number, grid: number, enabled: boolean): number {
  if (!enabled || grid <= 0) return Math.round(value);
  return Math.round(value / grid) * grid;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Pointer-drag behaviour for icons and panels.
 *
 * Uses pointer capture so a fast drag cannot escape the element, and defers the
 * first move until the pointer has travelled a few pixels so that a plain click
 * still registers as a click rather than a zero-distance drag.
 *
 * ## Why the geometry is read once
 *
 * The element's size and origin are measured on `pointerdown` and never again
 * during the drag. Reading `offsetWidth` inside `pointermove` - straight after
 * the previous move wrote a new `left` - forces the browser to lay the page out
 * synchronously, once per event. A high-rate mouse sends several of those per
 * frame, and over a blurred panel each forced layout also invalidates the
 * backdrop it samples, which is what made dragging a panel visibly lag behind
 * the pointer. Moves are also folded into one per animation frame: nothing
 * drawn between two frames is ever seen.
 */
export function draggable(node: HTMLElement, params: DraggableParams) {
  let current = params;
  const DRAG_THRESHOLD_PX = 4;

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let width = 0;
  let height = 0;
  let dragging = false;

  /** The position asked for most recently, and the frame that will apply it. */
  let nextX = 0;
  let nextY = 0;
  let frame = 0;

  function applyMove() {
    frame = 0;
    current.onMove(nextX, nextY);
  }

  function onPointerDown(event: PointerEvent) {
    if (current.disabled || event.button !== 0) return;
    // Let interactive children (buttons, inputs) keep their own behaviour.
    if ((event.target as HTMLElement).closest('[data-no-drag]')) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    originX = node.offsetLeft;
    originY = node.offsetTop;
    width = node.offsetWidth;
    height = node.offsetHeight;
    nextX = originX;
    nextY = originY;
    dragging = false;
    node.setPointerCapture(pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      node.classList.add('dragging');
    }

    const maxX = Math.max(0, current.bounds.width - width);
    const maxY = Math.max(0, current.bounds.height - height);
    const x = clamp(snapTo(originX + dx, current.gridSize, current.snap), 0, maxX);
    const y = clamp(snapTo(originY + dy, current.gridSize, current.snap), 0, maxY);
    if (x === nextX && y === nextY) return;
    nextX = x;
    nextY = y;
    if (!frame) frame = requestAnimationFrame(applyMove);
  }

  function finish(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    pointerId = null;

    if (dragging) {
      dragging = false;
      node.classList.remove('dragging');
      // Land exactly where the pointer let go, even if that frame never came.
      if (frame) {
        cancelAnimationFrame(frame);
        applyMove();
      }
      current.onEnd(nextX, nextY);
      // Swallow the click that follows a drag so it does not launch the icon.
      node.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true });
    }
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', finish);

  return {
    update(next: DraggableParams) {
      current = next;
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
    },
  };
}

export interface ResizableParams {
  /** Disable resizing entirely (layout lock). */
  disabled?: boolean;
  /** Cell size used when snapping. */
  gridSize: number;
  snap: boolean;
  /** Smallest usable size for the element. */
  min: { w: number; h: number };
  /** The element's current stored size, which the style applies. */
  size: { w: number; h: number };
  /** Surface size, used to keep the element on screen. */
  bounds: { width: number; height: number };
  /** Called at most once per frame while resizing. */
  onResize: (w: number, h: number) => void;
  /** Called once when the resize finishes. */
  onEnd: (w: number, h: number) => void;
}

/**
 * Pointer-resize behaviour for panels.
 *
 * Applied to the panel itself rather than to each grip, so the size maths has
 * one home: a grip only declares which edges it moves, with
 * `data-resize="e" | "s" | "se"`. Grips also carry `data-no-drag` so the
 * draggable action above leaves their pointer events alone.
 *
 * Like the drag, it measures the panel's position once on `pointerdown` and
 * applies at most one size per frame.
 */
export function resizable(node: HTMLElement, params: ResizableParams) {
  let current = params;

  let pointerId: number | null = null;
  let grip: HTMLElement | null = null;
  let edge: ResizeEdge = 'se';
  let startX = 0;
  let startY = 0;
  let originW = 0;
  let originH = 0;
  let left = 0;
  let top = 0;
  /**
   * The last size this action asked for.
   *
   * Reported at the end instead of re-reading the element: `offsetWidth`
   * includes the panel's border, so feeding it back as the stored width grew
   * every panel by its border on each resize.
   */
  let currentW = 0;
  let currentH = 0;
  let resized = false;
  let frame = 0;

  function applyResize() {
    frame = 0;
    current.onResize(currentW, currentH);
  }

  function onPointerDown(event: PointerEvent) {
    if (current.disabled || event.button !== 0) return;
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-resize]');
    if (!handle || !node.contains(handle)) return;

    event.preventDefault();
    // A resize is not a drag and not a click on whatever sits underneath.
    event.stopPropagation();

    pointerId = event.pointerId;
    grip = handle;
    edge = (handle.dataset.resize as ResizeEdge) || 'se';
    startX = event.clientX;
    startY = event.clientY;
    // The element's box includes its border; the stored size is the content
    // box the style sets, so start from that and never from the rendered size.
    originW = current.size.w;
    originH = current.size.h;
    left = node.offsetLeft;
    top = node.offsetTop;
    currentW = originW;
    currentH = originH;
    resized = false;
    node.classList.add('resizing');
    handle.setPointerCapture(pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;

    // Never past the surface edge: the panel keeps its top-left corner.
    const maxW = Math.max(current.min.w, current.bounds.width - left);
    const maxH = Math.max(current.min.h, current.bounds.height - top);

    const width =
      edge === 's'
        ? originW
        : clamp(
            snapTo(originW + (event.clientX - startX), current.gridSize, current.snap),
            current.min.w,
            maxW,
          );
    const height =
      edge === 'e'
        ? originH
        : clamp(
            snapTo(originH + (event.clientY - startY), current.gridSize, current.snap),
            current.min.h,
            maxH,
          );

    if (width === currentW && height === currentH) return;
    currentW = width;
    currentH = height;
    resized = true;
    if (!frame) frame = requestAnimationFrame(applyResize);
  }

  function finish(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (grip?.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId);
    pointerId = null;
    grip = null;
    node.classList.remove('resizing');
    if (frame) {
      cancelAnimationFrame(frame);
      applyResize();
    }
    if (resized) current.onEnd(currentW, currentH);
    resized = false;
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', finish);

  return {
    update(next: ResizableParams) {
      current = next;
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
    },
  };
}
