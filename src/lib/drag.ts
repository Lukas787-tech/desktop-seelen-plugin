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
  /** Called continuously while dragging. */
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
 */
export function draggable(node: HTMLElement, params: DraggableParams) {
  let current = params;
  const DRAG_THRESHOLD_PX = 4;

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let dragging = false;

  function onPointerDown(event: PointerEvent) {
    if (current.disabled || event.button !== 0) return;
    // Let interactive children (buttons, inputs) keep their own behaviour.
    if ((event.target as HTMLElement).closest('[data-no-drag]')) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    originX = node.offsetLeft;
    originY = node.offsetTop;
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

    const maxX = Math.max(0, current.bounds.width - node.offsetWidth);
    const maxY = Math.max(0, current.bounds.height - node.offsetHeight);
    const x = clamp(snapTo(originX + dx, current.gridSize, current.snap), 0, maxX);
    const y = clamp(snapTo(originY + dy, current.gridSize, current.snap), 0, maxY);
    current.onMove(x, y);
  }

  function finish(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    pointerId = null;

    if (dragging) {
      dragging = false;
      node.classList.remove('dragging');
      current.onEnd(node.offsetLeft, node.offsetTop);
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
  /** Called continuously while resizing. */
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
    currentW = originW;
    currentH = originH;
    resized = false;
    node.classList.add('resizing');
    handle.setPointerCapture(pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;

    // Never past the surface edge: the panel keeps its top-left corner.
    const maxW = Math.max(current.min.w, current.bounds.width - node.offsetLeft);
    const maxH = Math.max(current.min.h, current.bounds.height - node.offsetTop);

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
    current.onResize(width, height);
  }

  function finish(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (grip?.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId);
    pointerId = null;
    grip = null;
    node.classList.remove('resizing');
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
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
    },
  };
}
