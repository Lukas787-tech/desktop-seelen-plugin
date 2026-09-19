<script lang="ts" module>
  import type { MenuItem } from '$lib/menu';

  /** A box in viewport coordinates: the click point, or the row a flyout hangs off. */
  export interface MenuAnchor {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  /** A branch row asking for its submenu. */
  export interface MenuOpen {
    index: number;
    items: MenuItem[];
    /** The row's own box, which is what the flyout is placed beside. */
    box: MenuAnchor;
    /** Kept so closing the submenu can hand focus back to the row that opened it. */
    row: HTMLElement;
    /** Opened from the keyboard, so the flyout should take focus. */
    focusFirst: boolean;
  }
</script>

<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { pop } from '$lib/motion';

  interface Props {
    items: MenuItem[];
    /** Where this level hangs: the click point for the root, a row for a flyout. */
    anchor: MenuAnchor;
    /** The root sits *at* its anchor; a submenu sits *beside* it. */
    root?: boolean;
    /** The row whose submenu is open, kept highlighted while it is. */
    openIndex?: number | null;
    /** Take focus once placed, because the keyboard opened this level. */
    focusFirst?: boolean;
    onopen: (open: MenuOpen) => void;
    /**
     * A leaf row was entered, or a branch was clicked shut: drop deeper levels.
     * `immediate` skips the pointer's grace period, because a keyboard move or
     * a click is a decision rather than a route across the menu.
     */
    onclosechildren: (immediate?: boolean) => void;
    /** The pointer is inside this level, so a pending close elsewhere is stale. */
    onkeepopen: () => void;
    /** An item ran; the whole menu closes. */
    onrun: () => void;
    /** Left arrow out of a submenu: close it and focus the row that opened it. */
    onback?: () => void;
  }

  let {
    items,
    anchor,
    root = false,
    openIndex = null,
    focusFirst = false,
    onopen,
    onclosechildren,
    onkeepopen,
    onrun,
    onback,
  }: Props = $props();

  const cfg = $derived(config.current);

  let list = $state<HTMLElement | null>(null);
  /**
   * Viewport coordinates, once measured, and the corner the menu grows out of.
   * Null means "not placed yet".
   */
  let placed = $state<{ left: number; top: number; origin: string } | null>(null);

  /** Reserve the tick column for the whole list, so labels line up. */
  const hasChecks = $derived(items.some((item) => item.checked !== undefined));

  /** Clearance from the display edge, and the gap between a row and its flyout. */
  const EDGE = 4;
  const GAP = 3;
  /** The menu's own padding, so a flyout's first row lines up with its parent row. */
  const PAD = 5;

  /**
   * Place the menu in viewport coordinates.
   *
   * Every level is a sibling in one fixed-position layer rather than a child of
   * the level above. That is not a style choice: `.panel` carries a
   * `backdrop-filter`, which makes an element a containing block for fixed
   * descendants *and* clips them to its own overflow - so a submenu nested
   * inside a scrollable parent menu was cut off, and its width pushed a
   * horizontal scrollbar onto the parent that had to be dragged to reach it.
   *
   * The same decisions give the transform origin: a menu grows out of the
   * corner that sits on the pointer, and a flyout unfolds from the side of the
   * row it hangs off.
   */
  $effect(() => {
    const node = list;
    if (!node) return;
    void items;
    void anchor;

    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const maxLeft = window.innerWidth - width - EDGE;
    const maxTop = window.innerHeight - height - EDGE;

    let left: number;
    let top: number;
    let origin: string;

    if (root) {
      // Opened at a point: flip back over it rather than sliding along the edge,
      // which is what puts the menu beside the pointer instead of under it.
      const flipX = anchor.left + width > window.innerWidth - EDGE;
      const flipY = anchor.top + height > window.innerHeight - EDGE;
      left = flipX ? anchor.left - width : anchor.left;
      top = flipY ? anchor.top - height : anchor.top;
      origin = `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`;
    } else {
      left = anchor.right + GAP;
      if (left + width > window.innerWidth - EDGE) {
        const flipped = anchor.left - GAP - width;
        // Only flip if the other side actually has room; otherwise clamping
        // below keeps it on screen without covering the parent twice.
        if (flipped >= EDGE) left = flipped;
      }
      top = anchor.top - PAD;
      origin = `${left < anchor.left ? 'right' : 'left'} top`;
    }

    placed = {
      left: Math.max(EDGE, Math.min(left, maxLeft)),
      top: Math.max(EDGE, Math.min(top, maxTop)),
      origin,
    };
  });

  // Focus lands only after the menu has been placed, so the first thing the
  // keyboard user sees is not a row at the top-left corner of the display.
  $effect(() => {
    if (!focusFirst || !placed) return;
    rows()[0]?.focus();
  });

  function rows(): HTMLButtonElement[] {
    if (!list) return [];
    return [...list.querySelectorAll<HTMLButtonElement>('button.row:not(:disabled)')];
  }

  function boxOf(element: HTMLElement): MenuAnchor {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }

  function openBranch(index: number, row: HTMLElement, focus = false) {
    const item = items[index];
    if (!item?.items) return;
    onopen({ index, items: item.items, box: boxOf(row), row, focusFirst: focus });
  }

  function run(item: MenuItem) {
    if (item.disabled || !item.action) return;
    item.action();
    onrun();
  }

  function focusStep(delta: number) {
    const all = rows();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = at < 0 ? (delta > 0 ? 0 : all.length - 1) : (at + delta + all.length) % all.length;
    all[next]?.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    const row = (event.target as HTMLElement).closest<HTMLElement>('button.row');
    const index = row ? Number(row.dataset.index) : -1;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusStep(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusStep(-1);
        break;
      case 'Home':
        event.preventDefault();
        rows()[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        rows().at(-1)?.focus();
        break;
      case 'ArrowRight':
        if (row && items[index]?.items) {
          event.preventDefault();
          openBranch(index, row, true);
        }
        break;
      case 'ArrowLeft':
        if (!root) {
          event.preventDefault();
          onback?.();
        }
        break;
    }
  }
</script>

<!-- The pointer being anywhere in this level means it has not been left behind,
     which is what lets a diagonal move into a flyout survive the row below.

     It leaves through a global transition: a level is removed when the whole
     menu closes, several blocks up in the surface, and a local transition only
     plays for the block it sits in directly. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="menu panel"
  class:unplaced={!placed}
  bind:this={list}
  role="menu"
  tabindex="-1"
  style:left="{placed?.left ?? 0}px"
  style:top="{placed?.top ?? 0}px"
  style:transform-origin={placed?.origin}
  style:border-radius="{Math.min(cfg.cornerRadius, 12)}px"
  out:pop|global={{ duration: 140, scale: 0.96 }}
  onpointerenter={onkeepopen}
  onpointermove={onkeepopen}
  {onkeydown}
>
  {#each items as item, i (i)}
    {#if item.separator}
      <hr />
    {:else if item.header}
      <p class="header">{item.label}</p>
    {:else if item.items}
      <button
        role="menuitem"
        class="row"
        class:open={openIndex === i}
        data-index={i}
        aria-haspopup="true"
        aria-expanded={openIndex === i}
        onpointerenter={(e) => openBranch(i, e.currentTarget)}
        onclick={(e) => (openIndex === i ? onclosechildren(true) : openBranch(i, e.currentTarget))}
      >
        {#if hasChecks}<span class="tick" aria-hidden="true"></span>{/if}
        <span class="label">{item.label}</span>
        <span class="chevron" aria-hidden="true">&rsaquo;</span>
      </button>
    {:else}
      <button
        role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        class="row"
        class:danger={item.danger}
        data-index={i}
        aria-checked={item.checked}
        disabled={item.disabled}
        onpointerenter={() => onclosechildren()}
        onfocus={() => onclosechildren(true)}
        onclick={() => run(item)}
      >
        {#if hasChecks}
          <span class="tick" aria-hidden="true">{item.checked ? '✓' : ''}</span>
        {/if}
        <span class="label">{item.label}</span>
        {#if item.hint}<span class="hint">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 100;
    min-width: 200px;
    max-width: 320px;
    /* The Modules submenu lists every module; on a short display that is
       taller than the screen, so it scrolls rather than being cut off. */
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    /* Explicit, because `overflow-y: auto` alone computes the other axis to
       `auto` too - which is how a menu ever came to scroll sideways. */
    overflow-x: hidden;
    overscroll-behavior: contain;
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    cursor: default;
  }

  /*
   * Measured before it is placed; showing it at 0,0 first would flash.
   * Hidden by opacity rather than `visibility`, because the class that lifts
   * this is applied in the render *after* the effect that places the menu -
   * and a `visibility: hidden` element silently refuses the focus that a
   * keyboard-opened flyout takes in that same effect pass.
   */
  .menu.unplaced {
    opacity: 0;
    pointer-events: none;
  }

  /*
   * Once placed it grows out of its origin, and its rows follow a beat behind
   * one another. Not before: grown while unplaced, it would bloom at the
   * top-left corner of the display and then jump. Animations rather than
   * transitions, so they play as the class lifts and never again while the
   * menu stays open.
   */
  .menu:not(.unplaced) {
    animation: fx-pop var(--dur-slow) var(--ease) backwards;
  }

  .menu:not(.unplaced) > * {
    --travel: calc(var(--rs-travel, 1) * 0.55);
    animation: fx-rise var(--dur) var(--ease) backwards;
  }

  @supports (order: sibling-index()) {
    .menu:not(.unplaced) > * {
      animation-delay: calc(min(sibling-index() - 1, 16) * var(--step) * 0.35);
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    border-radius: calc(7px * var(--round, 1));
    background: transparent;
    color: var(--panel-fg);
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  .row:hover:not(:disabled),
  .row:focus-visible,
  .row.open {
    background: color-mix(in oklab, var(--color-gray-300, #666) 32%, transparent);
  }

  .row:active:not(:disabled) {
    scale: 0.98;
    transition-duration: var(--dur-fast);
  }

  .row:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .row.danger {
    color: var(--color-red-700, #f77);
  }

  .row.danger:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-red-700, #f77) 18%, transparent);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tick {
    flex: none;
    width: 11px;
    font-size: calc(11px * var(--text-scale, 1));
    line-height: 1;
    opacity: 0.9;
  }

  .hint,
  .chevron {
    flex: none;
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  /* The chevron leans toward the flyout it opens. */
  .chevron {
    transition:
      translate var(--dur) var(--ease-move),
      color var(--dur-fast) var(--ease);
  }

  .row:hover .chevron,
  .row.open .chevron {
    translate: 2px 0;
    color: var(--panel-fg);
  }

  .header {
    padding: 5px 10px 3px;
    font-size: calc(10px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--panel-fg-muted);
  }

  hr {
    height: 1px;
    border: 0;
    margin: 4px 6px;
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }
</style>
