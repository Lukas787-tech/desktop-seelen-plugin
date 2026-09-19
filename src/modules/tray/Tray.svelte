<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { fileUrl } from '$lib/assets';
  import { SystrayIconAction, trayAction, trayIcons, trayKey, trayLabel } from '$lib/tray.svelte';
  import type { SysTrayIcon } from '@seelen-ui/lib/types';

  const cfg = $derived(config.current);

  $effect(() => trayIcons.acquire());

  const listed = $derived(
    (cfg.trayShowHidden ? trayIcons.current : trayIcons.current.filter((icon) => icon.is_visible))
      .slice()
      .sort((a, b) => Number(b.is_visible) - Number(a.is_visible)),
  );

  /** Icons whose image failed to load, so they fall back to a letter. */
  let broken = $state<Set<string>>(new Set());

  function markBroken(key: string) {
    if (broken.has(key)) return;
    broken = new Set(broken).add(key);
  }

  function source(icon: SysTrayIcon): string | null {
    // Cache-busted by the image hash, so a changing icon (a battery, a sync
    // spinner) is fetched again rather than served stale by the asset loader.
    const url = fileUrl(icon.icon_path);
    if (!url) return null;
    return icon.icon_image_hash ? `${url}?h=${icon.icon_image_hash}` : url;
  }

  function onContext(event: MouseEvent, icon: SysTrayIcon) {
    // The application's own menu, not the panel's.
    event.preventDefault();
    event.stopPropagation();
    trayAction(icon, SystrayIconAction.RightClick);
  }

  function onAux(event: MouseEvent, icon: SysTrayIcon) {
    if (event.button !== 1) return;
    event.preventDefault();
    trayAction(icon, SystrayIconAction.MiddleClick);
  }
</script>

<div class="m-body" data-no-drag>
  {#if listed.length === 0}
    <p class="m-empty">No tray icons reported.</p>
  {:else if cfg.trayShowLabels}
    <ul class="m-list">
      {#each listed as icon (trayKey(icon))}
        {@const key = trayKey(icon)}
        {@const src = broken.has(key) ? null : source(icon)}
        <li>
          <button
            class="m-row"
            class:hidden={!icon.is_visible}
            title={icon.tooltip}
            onclick={() => trayAction(icon, SystrayIconAction.LeftClick)}
            oncontextmenu={(e) => onContext(e, icon)}
            onauxclick={(e) => onAux(e, icon)}
          >
            {#if src}
              <img class="m-icon" {src} alt="" onerror={() => markBroken(key)} />
            {:else}
              <span class="m-glyph letter">{trayLabel(icon).slice(0, 1).toUpperCase()}</span>
            {/if}
            <span class="m-text">
              <span class="m-title">{trayLabel(icon)}</span>
              {#if icon.tooltip.includes('\n')}
                <span class="m-sub">{icon.tooltip.split(/\r?\n/).slice(1).join(' · ')}</span>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="grid m-scroll" style:--size="{cfg.trayIconSize}px">
      {#each listed as icon (trayKey(icon))}
        {@const key = trayKey(icon)}
        {@const src = broken.has(key) ? null : source(icon)}
        <button
          class="tile"
          class:hidden={!icon.is_visible}
          title={icon.tooltip || trayLabel(icon)}
          aria-label={trayLabel(icon)}
          onclick={() => trayAction(icon, SystrayIconAction.LeftClick)}
          oncontextmenu={(e) => onContext(e, icon)}
          onauxclick={(e) => onAux(e, icon)}
        >
          {#if src}
            <img {src} alt="" onerror={() => markBroken(key)} />
          {:else}
            <span class="letter">{trayLabel(icon).slice(0, 1).toUpperCase()}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--size) + 14px), 1fr));
    gap: 4px;
    align-content: start;
  }

  .tile {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    padding: 0;
    border: 0;
    border-radius: calc(8px * var(--round, 1));
    background: transparent;
    cursor: pointer;
    animation: fx-pop var(--dur-slow) var(--ease) backwards;
    animation-delay: calc(var(--lag, 0ms) + var(--nth, 0) * var(--step) * 0.5);
    transition:
      background-color var(--dur-fast) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  @supports (order: sibling-index()) {
    .tile {
      --nth: min(sibling-index() - 1, 14);
    }
  }

  .tile:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .tile:active {
    scale: 0.88;
    transition-duration: var(--dur-fast);
  }

  .tile img {
    width: var(--size);
    height: var(--size);
    object-fit: contain;
    transition: scale var(--dur-slow) var(--ease-spring);
  }

  .tile:hover img {
    scale: 1.16;
  }

  .letter {
    display: grid;
    place-items: center;
    width: var(--size, 18px);
    height: var(--size, 18px);
    border-radius: calc(6px * var(--round, 1));
    font-size: calc(var(--size, 18px) * 0.5);
    font-weight: 600;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }

  .m-glyph.letter {
    font-size: calc(10px * var(--text-scale, 1));
  }

  .hidden {
    opacity: 0.6;
  }
</style>
