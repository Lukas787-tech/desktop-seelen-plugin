<script lang="ts">
  import type { Snippet } from 'svelte';
  import { config } from '$lib/config.svelte';
  import { draggable, resizable } from '$lib/drag';
  import { MIN_PANEL_SIZE, store, type DesktopPanel } from '$lib/store.svelte';

  interface Props {
    panel: DesktopPanel;
    bounds: { width: number; height: number };
    title: string;
    children: Snippet;
    /** Optional controls rendered in the panel header. */
    actions?: Snippet;
    /** Opens this module's own menu, from a right-click or the header button. */
    onmenu?: (event: MouseEvent) => void;
  }

  let { panel, bounds, title, children, actions, onmenu }: Props = $props();

  const cfg = $derived(config.current);

  function openMenu(event: MouseEvent) {
    if (!onmenu) return;
    event.preventDefault();
    // The surface has its own menu; a module's must win over it.
    event.stopPropagation();
    onmenu(event);
  }
</script>

<!--
  A panel is a region of the surface rather than a control: right-clicking it
  opens its menu, exactly as right-clicking the desktop opens the surface's.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
  class="panel module title-{cfg.titleStyle}"
  class:locked={cfg.lockLayout}
  style:left="{panel.x}px"
  style:top="{panel.y}px"
  style:width="{panel.w}px"
  style:height="{panel.h}px"
  use:draggable={{
    disabled: cfg.lockLayout,
    gridSize: cfg.gridSize,
    snap: cfg.snapToGrid,
    bounds,
    onMove: (x, y) => {
      panel.x = x;
      panel.y = y;
    },
    onEnd: (x, y) => store.moveItem(panel.id, x, y),
  }}
  use:resizable={{
    disabled: cfg.lockLayout,
    gridSize: cfg.gridSize,
    snap: cfg.snapToGrid,
    min: MIN_PANEL_SIZE,
    size: { w: panel.w, h: panel.h },
    bounds,
    onResize: (w, h) => {
      panel.w = w;
      panel.h = h;
    },
    onEnd: (w, h) => store.resizePanel(panel.id, w, h),
  }}
  oncontextmenu={openMenu}
>
  <header>
    <h2>{title}</h2>
    <div class="actions" data-no-drag>
      {#if actions}{@render actions()}{/if}
      {#if onmenu}
        <button
          class="menu-button"
          aria-haspopup="menu"
          aria-label="{title} options"
          title="{title} options"
          onclick={openMenu}
        >
          &#8943;
        </button>
      {/if}
    </div>
  </header>
  <div class="body">{@render children()}</div>

  {#if !cfg.lockLayout}
    <!-- Grips, not controls: they carry no action of their own, the resizable
         action above reads the edge they declare. -->
    <span class="grip east" data-resize="e" data-no-drag></span>
    <span class="grip south" data-resize="s" data-no-drag></span>
    <span class="grip corner" data-resize="se" data-no-drag></span>
  {/if}
</section>

<style>
  /*
   * Ground, edge, blur, corner and shadow all come from `.panel` in base.css
   * now, which reads the tokens `appearance.ts` sets on the surface root. This
   * block used to restate all five with the panel's own settings inlined -
   * which is how a panel and the menu beside it came to be two different
   * shades of the same colour.
   */
  .module {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    cursor: grab;
  }

  .module.locked {
    cursor: default;
  }

  /* `dragging` is toggled by the draggable action, so Svelte cannot see it. */
  :global(.module.dragging) {
    cursor: grabbing;
    box-shadow: var(--shadow-l, 8px 8px 24px rgb(0 0 0 / 0.34));
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-xs, 0.5rem);
    padding: 10px 12px 6px;
    flex: none;
  }

  h2 {
    font-family: var(--display-font);
    font-size: calc(var(--ui-size) * 0.79);
    font-weight: 600;
    color: var(--panel-fg-muted);
  }

  /* Three treatments, because a panel title is the most repeated piece of
     text on the surface and the one people most want to change or be rid of. */
  .title-caps h2 {
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }

  .title-hidden header {
    display: none;
  }

  /* With the header gone the body would otherwise start hard against the
     panel's own top edge. */
  .title-hidden .body {
    padding-top: 12px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: default;
  }

  /* Discoverable but quiet: the right-click menu is the primary route. */
  .menu-button {
    padding: 0 4px;
    border-radius: 6px;
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .module:hover .menu-button,
  .menu-button:focus-visible {
    opacity: 1;
  }

  .menu-button:hover {
    color: var(--panel-fg);
  }

  .body {
    flex: 1;
    min-height: 0;
    padding: 0 12px 12px;
    overflow: hidden;
  }

  /* Resize grips sit just inside the panel's own edges. */
  .grip {
    position: absolute;
    z-index: 2;
  }

  .east {
    top: 8px;
    right: 0;
    bottom: 12px;
    width: 7px;
    cursor: ew-resize;
  }

  .south {
    left: 8px;
    right: 12px;
    bottom: 0;
    height: 7px;
    cursor: ns-resize;
  }

  .corner {
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
  }

  /* A hint of the corner, visible only while the panel is under the pointer. */
  .corner::after {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 7px;
    height: 7px;
    border-right: 1.5px solid var(--panel-fg-muted);
    border-bottom: 1.5px solid var(--panel-fg-muted);
    border-bottom-right-radius: 3px;
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .module:hover .corner::after {
    opacity: 0.7;
  }

  :global(.module.resizing) {
    box-shadow: var(--shadow-l, 8px 8px 24px rgb(0 0 0 / 0.34));
  }
</style>
