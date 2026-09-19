<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { config } from '$lib/config.svelte';
  import { draggable, resizable } from '$lib/drag';
  import { pop } from '$lib/motion';
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

  /*
   * This panel's place in the surface's opening wave, in stagger steps: the
   * layout assembles itself from the top-left corner instead of appearing all
   * at once. Read once, deliberately - it lands in an inherited custom
   * property, and one that followed the panel's position would restyle every
   * row inside it on each frame of a drag.
   */
  const enterSteps = untrack(() => Math.round(Math.min(22, panel.x / 200 + panel.y / 120)));

  /*
   * Position and size glide when something other than the pointer moves them -
   * Reset position, a module stepping out of another's way - but only once the
   * panel has been painted where it starts. Before that, the first placement
   * would slide it across from wherever the default layout had it.
   */
  let settled = $state(false);

  onMount(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => (settled = true));
    });
    return () => cancelAnimationFrame(frame);
  });

  /*
   * The light that follows the pointer across the glass.
   *
   * Its position is written straight onto the glow element, which is a leaf,
   * and not onto the panel: a custom property on the panel is inherited by
   * every row inside it, so each pointer move would restyle the whole module.
   * The panel's box is measured when the pointer arrives rather than on every
   * move, for the forced-layout reason `drag.ts` gives.
   */
  let glow = $state<HTMLElement | null>(null);
  let box: { left: number; top: number; ratio: number } | null = null;
  let glowFrame = 0;
  let glowX = 0;
  let glowY = 0;

  function measure(event: PointerEvent) {
    const node = event.currentTarget as HTMLElement;
    const rect = node.getBoundingClientRect();
    // The offline preview scales its whole stage; the glow is placed in the
    // panel's own, unscaled pixels.
    box = { left: rect.left, top: rect.top, ratio: rect.width > 0 ? node.offsetWidth / rect.width : 1 };
    track(event);
  }

  function track(event: PointerEvent) {
    // Mid-drag the panel travels with the pointer, so the glow already sits
    // where it was grabbed and the box measured on entry no longer holds.
    if (!box || !glow || event.buttons !== 0) return;
    glowX = (event.clientX - box.left) * box.ratio;
    glowY = (event.clientY - box.top) * box.ratio;
    if (glowFrame) return;
    glowFrame = requestAnimationFrame(() => {
      glowFrame = 0;
      glow?.style.setProperty('--gx', `${glowX}px`);
      glow?.style.setProperty('--gy', `${glowY}px`);
    });
  }

  $effect(() => () => cancelAnimationFrame(glowFrame));

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

  It arrives from a CSS keyframe and leaves through `pop`: a panel switched off
  is removed at once, before a stylesheet could move it.

  `data-module` is a public hook: a user stylesheet can target one module's
  panel by it, and the Appearance dialog's CSS tab documents it as such.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
  class="panel module title-{cfg.titleStyle} decor-{cfg.titleDecor} align-{cfg.titleAlign}"
  class:locked={cfg.lockLayout}
  class:settled
  class:snap={cfg.snapToGrid}
  data-module={panel.kind}
  style:left="{panel.x}px"
  style:top="{panel.y}px"
  style:width="{panel.w}px"
  style:height="{panel.h}px"
  style:--enter={enterSteps}
  out:pop={{ duration: 240, y: 14, scale: 0.94 }}
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
  onpointerenter={measure}
  onpointermove={track}
  onpointerup={measure}
>
  {#if cfg.animations && cfg.panelGlow}
    <span class="glow" bind:this={glow} aria-hidden="true"></span>
  {/if}

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
   * now, which reads the tokens `appearance.ts` sets on `body`. This block used
   * to restate all five with the panel's own settings inlined - which is how a
   * panel and the menu beside it came to be two different shades of the same
   * colour.
   */
  .module {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    cursor: grab;
    /* A panel's contents cannot change the layout of anything outside it, so
       a ticking clock or a streaming reply re-lays-out one box rather than
       the surface. Not `paint`: that would clip the shadow. */
    contain: layout style;

    /* What a panel always transitions; the position and size glides add to it. */
    --panel-tr:
      box-shadow var(--dur) var(--ease),
      border-color var(--dur) var(--ease),
      scale var(--dur-slow) var(--ease-spring);
    transition: var(--panel-tr);
    /* Which keyframe is the Entrance setting's; see `--entrance` in `motion.css`. */
    animation: var(--entrance, fx-panel-in) var(--dur-enter) var(--ease) backwards;
  }

  /*
   * During the opening wave each panel waits for its place in it, and `--lag`
   * makes the rows, bars and graphs inside it wait too - otherwise they would
   * finish arriving on glass that had not yet appeared.
   */
  :global(.booting) .module {
    animation-delay: calc(var(--enter) * var(--step));
    --lag: calc(var(--enter) * var(--step) + var(--dur));
  }

  .module.settled {
    transition:
      var(--panel-tr),
      left var(--dur-slow) var(--ease-move),
      top var(--dur-slow) var(--ease-move),
      width var(--dur-slow) var(--ease-move),
      height var(--dur-slow) var(--ease-move);
  }

  /* The edge brightens under the pointer, in whichever colour it is drawn in. */
  .module:hover {
    --panel-edge-lift: 22%;
  }

  .module.locked {
    cursor: default;
  }

  /*
   * Picked up: the panel lifts toward the viewer and rises above its
   * neighbours. `dragging` and `resizing` are toggled by the actions in
   * `drag.ts`, so Svelte cannot see them.
   */
  .module:global(.dragging) {
    cursor: grabbing;
    z-index: 10;
    scale: 1.018;
    box-shadow:
      0 30px 70px rgb(0 0 0 / 0.42),
      0 8px 20px rgb(0 0 0 / 0.24);
  }

  .module:global(.resizing) {
    box-shadow: var(--shadow-l, 8px 8px 24px rgb(0 0 0 / 0.34));
  }

  /* Under the pointer's direct control a glide on position would only trail behind it... */
  .module:global(.dragging),
  .module:global(.resizing) {
    transition: var(--panel-tr);
  }

  /* ...unless it snaps: then it jumps a cell at a time, and a short glide
     turns each jump into a magnetic step. */
  .module.snap:global(.dragging) {
    transition:
      var(--panel-tr),
      left var(--dur-fast) var(--ease),
      top var(--dur-fast) var(--ease);
  }

  .module.snap:global(.resizing) {
    transition:
      var(--panel-tr),
      width var(--dur-fast) var(--ease),
      height var(--dur-fast) var(--ease);
  }

  /*
   * The light under the pointer: a soft bloom across the glass and a brighter
   * arc where it meets the edge. Behind the contents - `z-index: -1` inside the
   * panel's own stacking context - so it lights the glass and never the text.
   */
  .glow {
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(
      380px circle at var(--gx, 50%) var(--gy, 0%),
      color-mix(in oklab, var(--accent, #7aa2f7) 10%, rgb(255 255 255 / 0.07)),
      transparent 70%
    );
    transition: opacity var(--dur-slow) var(--ease);
  }

  .glow::after {
    content: '';
    position: absolute;
    inset: 0;
    padding: 1px;
    border-radius: inherit;
    background: radial-gradient(
      200px circle at var(--gx, 50%) var(--gy, 0%),
      color-mix(in oklab, var(--accent, #7aa2f7) 50%, rgb(255 255 255 / 0.9)),
      transparent 80%
    );
    /* Only the one-pixel ring the padding leaves: the content box is cut out. */
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask-composite: exclude;
    opacity: 0.6;
  }

  .module:hover .glow {
    opacity: 1;
  }

  /* A resize moves the edge away from the pointer, so the light would be left behind. */
  .module:global(.resizing) .glow {
    opacity: 0;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-xs, 0.5rem);
    padding: calc(var(--panel-pad, 12px) - 2px) var(--panel-pad, 12px) 6px;
    flex: none;
  }

  h2 {
    font-family: var(--display-font);
    font-size: calc(var(--ui-size) * 0.79);
    font-weight: var(--title-weight, 600);
    color: var(--panel-fg-muted);
    transition: color var(--dur) var(--ease);
  }

  .module:hover h2 {
    color: var(--panel-fg);
  }

  /* Four treatments, because a panel title is the most repeated piece of
     text on the surface and the one people most want to change or be rid of. */
  .title-caps h2 {
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }

  .title-lower h2 {
    text-transform: lowercase;
  }

  /* ------------------------------------------------------ title decoration */

  /* `[ clock ]`, the way a tiling window manager's bar labels a block. */
  .decor-bracket h2::before,
  .decor-bracket h2::after {
    color: var(--accent, #7aa2f7);
  }

  .decor-bracket h2::before {
    content: '[ ';
  }

  .decor-bracket h2::after {
    content: ' ]';
  }

  /* A rule under the title, inset to the body's own padding. */
  .decor-underline header {
    margin: 0 var(--panel-pad, 12px) calc(var(--panel-pad, 12px) * 0.6);
    padding-inline: 0;
    padding-bottom: 7px;
    border-bottom: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 45%, transparent);
    transition: border-color var(--dur) var(--ease);
  }

  .module.decor-underline:hover header {
    border-bottom-color: color-mix(in oklab, var(--accent, #7aa2f7) 70%, transparent);
  }

  /* The title in a tinted tab. */
  .decor-tab h2 {
    padding: 2px 9px;
    border-radius: calc(999px * var(--round, 1));
    background: color-mix(in oklab, var(--accent, #7aa2f7) 22%, transparent);
    color: var(--panel-fg);
  }

  /*
   * A filled title bar, edge to edge, the way a window of the Motif era wore
   * one. The ink is the ground colour rather than the text colour: the bar is
   * the accent, and ground-on-accent is the pairing every scheme's own accent
   * was chosen to carry.
   */
  .decor-bar header {
    padding-block: calc(var(--panel-pad, 12px) * 0.45);
    margin-bottom: calc(var(--panel-pad, 12px) * 0.6);
    background: linear-gradient(
      90deg,
      var(--accent, #7aa2f7),
      color-mix(in oklab, var(--accent-2, #bb9af7) 70%, var(--accent, #7aa2f7))
    );
  }

  .decor-bar h2,
  .module.decor-bar:hover h2,
  .decor-bar .menu-button {
    color: var(--color-gray-50, #111);
    text-shadow: none;
  }

  .decor-bar .menu-button:hover {
    color: var(--color-gray-50, #111);
    background: rgb(0 0 0 / 0.14);
  }

  /* A lit dot in the accent, before the title. */
  .decor-dot h2 {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .decor-dot h2::before {
    content: '';
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: calc(999px * var(--round, 1));
    background: var(--accent, #7aa2f7);
    box-shadow: 0 0 8px color-mix(in oklab, var(--accent, #7aa2f7) 70%, transparent);
  }

  /* ------------------------------------------------------- title alignment */

  /* Centred against the whole header, not against what the actions leave. */
  .align-center header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
  }

  .align-center h2 {
    grid-column: 2;
    text-align: center;
  }

  .align-center .actions {
    grid-column: 3;
    justify-self: end;
  }

  .align-right header {
    flex-direction: row-reverse;
  }

  /* After the alignments, which would otherwise put a grid back on it. */
  .title-hidden header {
    display: none;
  }

  /* With the header gone the body would otherwise start hard against the
     panel's own top edge. */
  .title-hidden .body {
    padding-top: var(--panel-pad, 12px);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: default;
  }

  /* Discoverable but quiet: the right-click menu is the primary route. It
     slides in with the hover and turns a quarter as it is pointed at. */
  .menu-button {
    padding: 0 4px;
    border-radius: calc(6px * var(--round, 1));
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: calc(15px * var(--text-scale, 1));
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    translate: 5px 0;
    transition:
      opacity var(--dur-fast) var(--ease),
      translate var(--dur) var(--ease-move),
      rotate var(--dur-slow) var(--ease-spring),
      scale var(--dur) var(--ease-spring),
      color var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }

  .module:hover .menu-button,
  .menu-button:focus-visible {
    opacity: 1;
    translate: 0 0;
  }

  .menu-button:hover {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
    rotate: 90deg;
  }

  .menu-button:active {
    scale: 0.85;
  }

  .body {
    flex: 1;
    min-height: 0;
    padding: 0 var(--panel-pad, 12px) var(--panel-pad, 12px);
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

  /* A hint of the corner, drawn in from the inside while the panel is under the pointer. */
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
    translate: -3px -3px;
    transition:
      opacity var(--dur) var(--ease),
      translate var(--dur) var(--ease-move);
  }

  .module:hover .corner::after {
    opacity: 0.7;
    translate: 0 0;
  }
</style>
