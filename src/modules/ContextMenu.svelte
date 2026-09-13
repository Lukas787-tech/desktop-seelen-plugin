<script lang="ts">
  import type { MenuItem } from '$lib/menu';
  import MenuList, { type MenuAnchor, type MenuOpen } from './MenuList.svelte';

  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onclose: () => void;
  }

  let { x, y, items, onclose }: Props = $props();

  interface Level {
    items: MenuItem[];
    anchor: MenuAnchor;
    /** Which row of the level above opened this one, so it stays highlighted. */
    fromIndex: number;
    /** That row, so closing this level can hand focus back to it. */
    fromRow: HTMLElement | null;
    focusFirst: boolean;
  }

  /**
   * The open menus, root first.
   *
   * Flat rather than nested: each level is placed in viewport coordinates and
   * rendered as a sibling of the others, so a flyout is never inside the box it
   * hangs off. See the placement comment in `MenuList` for why that matters.
   */
  let levels = $state<Level[]>([]);

  // A fresh open (or a menu rebuilt with new items) starts from the root again.
  $effect(() => {
    levels = [
      {
        items,
        anchor: { left: x, top: y, right: x, bottom: y },
        fromIndex: -1,
        fromRow: null,
        focusFirst: false,
      },
    ];
  });

  /**
   * Closing a level is deferred by a beat.
   *
   * Moving the pointer diagonally from a row into its flyout crosses the rows
   * below it. Without the grace period the flyout would close under the pointer
   * on the way there, which is the classic reason a submenu feels unreachable.
   */
  const CLOSE_GRACE_MS = 220;
  let pendingClose: ReturnType<typeof setTimeout> | undefined;
  /** Which level asked for the close, so only a *deeper* one can cancel it. */
  let pendingDepth = -1;

  function cancelPendingClose() {
    if (pendingClose === undefined) return;
    clearTimeout(pendingClose);
    pendingClose = undefined;
    pendingDepth = -1;
  }

  function closeBelow(depth: number, immediate = false) {
    cancelPendingClose();
    if (immediate) {
      if (levels.length > depth + 1) levels = levels.slice(0, depth + 1);
      return;
    }
    pendingDepth = depth;
    pendingClose = setTimeout(() => {
      pendingClose = undefined;
      pendingDepth = -1;
      if (levels.length > depth + 1) levels = levels.slice(0, depth + 1);
    }, CLOSE_GRACE_MS);
  }

  /**
   * The pointer reached a level deeper than the one that asked to close: it was
   * on its way to the flyout after all. Moving *within* the level that asked
   * must not cancel, or its flyout would never close.
   */
  function keepOpen(depth: number) {
    if (pendingClose !== undefined && depth > pendingDepth) cancelPendingClose();
  }

  function open(depth: number, request: MenuOpen) {
    cancelPendingClose();
    const existing = levels[depth + 1];
    // Re-entering the row that is already open must not rebuild the flyout,
    // which would drop its own open submenu and any keyboard focus inside it.
    if (existing && existing.fromIndex === request.index && !request.focusFirst) return;
    levels = [
      ...levels.slice(0, depth + 1),
      {
        items: request.items,
        anchor: request.box,
        fromIndex: request.index,
        fromRow: request.row,
        focusFirst: request.focusFirst,
      },
    ];
  }

  /** Left arrow out of a flyout: drop it and put focus back on its own row. */
  function back(depth: number) {
    const level = levels[depth];
    cancelPendingClose();
    levels = levels.slice(0, depth);
    level?.fromRow?.focus();
  }

  $effect(() => () => cancelPendingClose());
</script>

<svelte:window
  onkeydown={(e) => e.key === 'Escape' && onclose()}
  onpointerdown={onclose}
  onblur={onclose}
  onresize={onclose}
/>

<!-- One fixed layer holding every open level. The handler keeps a click inside
     any of them from reaching the window handler above and closing the menu. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="layer" onpointerdown={(e) => e.stopPropagation()}>
  {#each levels as level, depth (depth)}
    <MenuList
      items={level.items}
      anchor={level.anchor}
      root={depth === 0}
      openIndex={levels[depth + 1]?.fromIndex ?? null}
      focusFirst={level.focusFirst}
      onopen={(request) => open(depth, request)}
      onclosechildren={(immediate) => closeBelow(depth, immediate)}
      onkeepopen={() => keepOpen(depth)}
      onback={depth > 0 ? () => back(depth) : undefined}
      onrun={onclose}
    />
  {/each}
</div>

<style>
  /*
   * Zero-sized: the levels inside are each positioned against the viewport, so
   * this only exists to catch the pointer events that must not close the menu.
   * It must not create a containing block (no transform, no filter) or the
   * fixed levels would be clipped to it.
   */
  .layer {
    position: fixed;
    left: 0;
    top: 0;
  }
</style>
