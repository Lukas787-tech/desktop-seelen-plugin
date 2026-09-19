<script lang="ts">
  import { untrack } from 'svelte';
  import { config } from '$lib/config.svelte';
  import { draggable } from '$lib/drag';
  import { icons } from '$lib/icons.svelte';
  import { launch } from '$lib/launch.svelte';
  import { store, type DesktopIcon } from '$lib/store.svelte';

  interface Props {
    icon: DesktopIcon;
    bounds: { width: number; height: number };
    selected: boolean;
    onselect: (id: string, additive: boolean) => void;
    oncontext: (event: MouseEvent, id: string) => void;
  }

  let { icon, bounds, selected, onselect, oncontext }: Props = $props();

  const cfg = $derived(config.current);

  const src = $derived(
    icons.resolveWithOverride(icon.iconPath, { path: icon.target, umid: icon.umid }),
  );

  // The tile is a square cell with room for a wrapped label underneath.
  const tileWidth = $derived(Math.max(cfg.gridSize, cfg.iconSize + 24));

  /* Its place in the surface's opening wave, read once; see `Panel.svelte`. */
  const enterSteps = untrack(() => Math.round(Math.min(18, icon.x / 160 + icon.y / 140)));

  /** True for the length of the launch pulse, which is the only sign a double-click landed. */
  let launching = $state(false);
  let launchTimer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    void launch(icon.target, icon.kind);
    if (launching) return;
    launching = true;
    launchTimer = setTimeout(() => (launching = false), 700);
  }

  $effect(() => () => clearTimeout(launchTimer));

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  }
</script>

<div
  class="icon labels-{cfg.iconLabelStyle}"
  class:selected
  class:launching
  class:hover-label={cfg.labelMode === 'hover'}
  role="button"
  tabindex="0"
  style:left="{icon.x}px"
  style:top="{icon.y}px"
  style:width="{tileWidth}px"
  style:border-radius="{Math.min(cfg.cornerRadius, 14)}px"
  style:--enter={enterSteps}
  title={icon.label}
  ondblclick={open}
  onkeydown={onKeyDown}
  onclick={(e) => onselect(icon.id, e.ctrlKey || e.shiftKey)}
  oncontextmenu={(e) => oncontext(e, icon.id)}
  use:draggable={{
    disabled: cfg.lockLayout,
    gridSize: cfg.gridSize,
    snap: cfg.snapToGrid,
    bounds,
    onMove: (x, y) => {
      icon.x = x;
      icon.y = y;
    },
    onEnd: (x, y) => store.moveItem(icon.id, x, y),
  }}
>
  <div class="art" style:width="{cfg.iconSize}px" style:height="{cfg.iconSize}px">
    {#if src}
      <img {src} alt="" draggable="false" />
    {:else}
      <div class="fallback">{icon.label.slice(0, 1).toUpperCase()}</div>
    {/if}
  </div>

  {#if cfg.labelMode !== 'never'}
    <span class="label">{icon.label}</span>
  {/if}
</div>

<style>
  .icon {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 4px;
    cursor: pointer;
    /* Present but clear, so selecting draws the ring in rather than switching it on. */
    outline: 1px solid transparent;
    outline-offset: 5px;
    animation: fx-tile-in var(--dur-enter) var(--ease) backwards;
    transition:
      background-color var(--dur-fast) var(--ease),
      outline-color var(--dur) var(--ease),
      outline-offset var(--dur-slow) var(--ease-spring);
  }

  :global(.booting) .icon {
    animation-delay: calc(var(--enter) * var(--step));
  }

  .icon:hover {
    background: color-mix(in oklab, var(--color-gray-500, #888) 22%, transparent);
    border-radius: var(--icon-radius);
  }

  .icon.selected {
    background: color-mix(in oklab, var(--accent) 32%, transparent);
    outline-color: color-mix(in oklab, var(--accent) 60%, transparent);
    outline-offset: 0;
    border-radius: var(--icon-radius);
  }

  .icon:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 0;
  }

  .icon:global(.dragging) {
    z-index: 10;
    cursor: grabbing;
  }

  /* The art floats up toward the pointer, dips under a press and is carried
     high while dragged - all on springs, so each settles with a little bounce. */
  .art {
    display: grid;
    place-items: center;
    transition:
      translate var(--dur-slow) var(--ease-spring),
      scale var(--dur-slow) var(--ease-spring);
  }

  .icon:hover .art {
    translate: 0 -3px;
    scale: 1.08;
  }

  .icon:active .art {
    translate: 0 0;
    scale: 0.92;
    transition-duration: var(--dur-fast);
  }

  .icon:global(.dragging) .art {
    translate: 0 -5px;
    scale: 1.14;
  }

  .icon.launching .art {
    animation: fx-beat 680ms var(--ease);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.5));
    transition: filter var(--dur) var(--ease);
  }

  .icon:hover img,
  .icon:global(.dragging) img {
    filter: drop-shadow(0 8px 12px rgb(0 0 0 / 0.45));
  }

  .fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    border-radius: var(--icon-radius);
    font-size: calc(18px * var(--text-scale, 1));
    font-weight: 600;
    background: color-mix(in oklab, var(--color-gray-300, #666) 40%, transparent);
  }

  .label {
    font-size: calc(var(--ui-size) * 0.79);
    line-height: 1.25;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  /*
   * Three treatments for text that sits on a wallpaper of any colour. The two
   * bare ones are a fixed light ink rather than the panel ink: a label is on
   * the wallpaper, not on a panel, and a light colour scheme's dark ink over a
   * dark photo is unreadable. The pill carries its own ground, so it can use
   * the scheme's ink after all.
   */
  .labels-shadow .label,
  .labels-plain .label {
    color: #f4f4f6;
  }

  .labels-shadow {
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.85);
  }

  .labels-pill .label {
    padding: 1px 7px;
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(
      in oklab,
      var(--panel-ground) calc(min(1, var(--panel-alpha) + 0.25) * 100%),
      transparent
    );
  }

  .hover-label .label {
    opacity: 0;
    translate: 0 -3px;
    transition:
      opacity var(--dur) var(--ease),
      translate var(--dur) var(--ease-move);
  }

  .hover-label:hover .label,
  .hover-label:focus-visible .label {
    opacity: 1;
    translate: 0 0;
  }
</style>
