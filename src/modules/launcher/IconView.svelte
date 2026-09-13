<script lang="ts">
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

  function open() {
    void launch(icon.target, icon.kind);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  }
</script>

<div
  class="icon"
  class:selected
  class:hover-label={cfg.labelMode === 'hover'}
  role="button"
  tabindex="0"
  style:left="{icon.x}px"
  style:top="{icon.y}px"
  style:width="{tileWidth}px"
  style:border-radius="{Math.min(cfg.cornerRadius, 14)}px"
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
    /* Text over an arbitrary wallpaper needs its own contrast. */
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.85);
  }

  .icon:hover {
    background: color-mix(in oklab, var(--color-gray-500, #888) 22%, transparent);
    border-radius: var(--icon-radius);
  }

  .icon.selected {
    background: color-mix(in oklab, var(--accent) 32%, transparent);
    outline: 1px solid color-mix(in oklab, var(--accent) 60%, transparent);
    border-radius: var(--icon-radius);
  }

  .icon:focus-visible {
    outline: 2px solid var(--accent);
  }

  .art {
    display: grid;
    place-items: center;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.5));
  }

  .fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    border-radius: var(--icon-radius);
    font-size: 18px;
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

  .hover-label .label {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .hover-label:hover .label,
  .hover-label:focus-visible .label {
    opacity: 1;
  }
</style>
