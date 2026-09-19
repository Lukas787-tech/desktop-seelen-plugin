<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { icons } from '$lib/icons.svelte';
  import {
    activateWindow,
    closeWindow,
    openWindows,
    ownMonitorId,
    sortWindows,
  } from '$lib/windows.svelte';
  import type { UserAppWindow } from '@seelen-ui/lib/types';

  const cfg = $derived(config.current);

  $effect(() => openWindows.acquire());

  const own = ownMonitorId();

  const listed = $derived.by(() => {
    let windows = openWindows.current;
    if (cfg.windowsThisDisplayOnly && own) windows = windows.filter((w) => w.monitor === own);
    if (cfg.windowsHideMinimised) windows = windows.filter((w) => !w.isIconic);
    return sortWindows(windows);
  });

  /** One entry per application, keeping each app's windows in focus order. */
  const groups = $derived.by(() => {
    const byApp = new Map<string, UserAppWindow[]>();
    for (const open of listed) {
      const key = open.appName || open.umid || 'Other';
      const group = byApp.get(key);
      if (group) group.push(open);
      else byApp.set(key, [open]);
    }
    return [...byApp.entries()].map(([name, windows]) => ({ name, windows }));
  });

  function iconFor(open: UserAppWindow): string | null {
    return icons.resolve({ path: open.process.path, umid: open.umid });
  }

  function label(open: UserAppWindow): string {
    return open.title || open.appName || 'Untitled window';
  }

  function onAuxClick(event: MouseEvent, hwnd: number) {
    // Middle click closes, exactly as it does on a taskbar button.
    if (event.button !== 1) return;
    event.preventDefault();
    closeWindow(hwnd);
  }
</script>

<div class="m-body" data-no-drag>
  <ul class="m-list">
    {#each groups as group (group.name)}
      {#if cfg.windowsGroupByApp}
        <li class="group">{group.name} <span class="m-muted">{group.windows.length}</span></li>
      {/if}
      {#each group.windows as open (open.hwnd)}
        <li class="m-row" class:dim={open.isIconic}>
          <button
            class="open"
            title={open.isIconic ? `${open.title} (minimised)` : open.title}
            onclick={() => void activateWindow(open.hwnd, label(open))}
            onauxclick={(e) => onAuxClick(e, open.hwnd)}
          >
            {#if cfg.windowsShowIcons}
              {@const src = iconFor(open)}
              {#if src}
                <img class="m-icon" {src} alt="" />
              {:else}
                <span class="m-glyph">&#9633;</span>
              {/if}
            {/if}
            <span class="m-text">
              <span class="m-title">{label(open)}</span>
              {#if !cfg.windowsGroupByApp && open.appName}
                <span class="m-sub">{open.appName}</span>
              {/if}
            </span>
          </button>
          <button
            class="m-quiet"
            aria-label="Close {label(open)}"
            title="Close"
            onclick={() => closeWindow(open.hwnd)}
          >
            &times;
          </button>
        </li>
      {/each}
    {:else}
      <li class="m-empty">
        {cfg.windowsThisDisplayOnly ? 'No windows on this display.' : 'No open windows.'}
      </li>
    {/each}
  </ul>
</div>

<style>
  .group {
    padding: 6px 6px 2px;
    font-size: calc(9px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--panel-fg-muted);
  }

  /* The row is the hit target; the button inside carries the pointer state. */
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    text-align: left;
    cursor: pointer;
  }

  .m-row:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .dim {
    opacity: 0.55;
  }
</style>
