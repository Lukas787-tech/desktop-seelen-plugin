<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { icons } from '$lib/icons.svelte';
  import {
    NOTIFICATION_MODES,
    activate,
    dismiss,
    dismissAll,
    focusAssist,
    notifications,
    notificationsMode,
    relativeTime,
    setFocusAssist,
    setNotificationsMode,
    toastLines,
  } from '$lib/notifications.svelte';
  import { NotificationsMode } from '@seelen-ui/lib/types';

  const cfg = $derived(config.current);

  $effect(() => notifications.acquire());
  $effect(() => (cfg.notificationsShowControls ? focusAssist.acquire() : undefined));
  $effect(() => (cfg.notificationsShowControls ? notificationsMode.acquire() : undefined));

  // Only so the "3 m" stamps stay true; the list itself is event-driven.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const listed = $derived(
    notifications.current
      .slice()
      .sort((a, b) => b.date - a.date)
      .slice(0, cfg.notificationsMax),
  );
</script>

<div class="m-body" data-no-drag>
  {#if cfg.notificationsShowControls}
    <div class="controls">
      <label class="m-row m-click">
        <span class="m-text"><span class="m-title">Focus assist</span></span>
        <input
          type="checkbox"
          class="m-switch"
          role="switch"
          checked={focusAssist.current}
          onchange={(e) => setFocusAssist(e.currentTarget.checked)}
        />
      </label>
      {#if focusAssist.current}
        <select
          aria-label="What gets through"
          value={notificationsMode.current}
          onchange={(e) => setNotificationsMode(e.currentTarget.value as NotificationsMode)}
        >
          {#each NOTIFICATION_MODES as mode (mode.value)}
            <option value={mode.value}>{mode.label}</option>
          {/each}
        </select>
      {/if}
    </div>
  {/if}

  <ul class="m-list">
    {#each listed as notification (notification.id)}
      {@const lines = toastLines(notification.content)}
      {@const src = icons.resolve({ umid: notification.appUmid })}
      <li class="m-row">
        <button class="open" onclick={() => activate(notification)}>
          {#if src}<img class="m-icon" {src} alt="" />{/if}
          <span class="m-text">
            <span class="m-title">{lines[0] ?? notification.appName}</span>
            {#if cfg.notificationsShowBody && lines.length > 1}
              <span class="body">{lines.slice(1).join(' \u00B7 ')}</span>
            {/if}
            {#if cfg.notificationsShowApp}
              <span class="m-sub">{notification.appName} &middot; {relativeTime(notification.date, now)}</span>
            {/if}
          </span>
        </button>
        <button
          class="m-quiet"
          title="Dismiss"
          aria-label="Dismiss notification"
          onclick={() => dismiss(notification.id)}
        >
          &times;
        </button>
      </li>
    {:else}
      <li class="m-empty">Nothing new.</li>
    {/each}
  </ul>

  {#if listed.length}
    <button class="clear" onclick={dismissAll}>Clear all</button>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .controls label {
    flex: 1;
    cursor: pointer;
  }

  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .m-row {
    align-items: flex-start;
  }

  .m-row:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  /* The body is the only part worth wrapping; two lines, then an ellipsis. */
  .body {
    font-size: 11px;
    color: var(--panel-fg-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .clear {
    flex: none;
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--panel-fg-muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .clear:hover {
    color: var(--panel-fg);
  }
</style>
