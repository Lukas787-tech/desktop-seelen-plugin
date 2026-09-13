<script lang="ts">
  import { config } from '$lib/config.svelte';
  import {
    clearHistory,
    clipboard,
    copyEntry,
    deleteEntry,
    pasteEntry,
    previewOf,
    sourceLogo,
  } from '$lib/clipboard.svelte';
  import { relativeTime } from '$lib/notifications.svelte';

  const cfg = $derived(config.current);

  $effect(() => clipboard.acquire());

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  /** The row just acted on, so the panel can say what it did. */
  let flashed = $state<string | null>(null);

  const data = $derived(clipboard.current);
  const listed = $derived(data.history.slice(0, cfg.clipboardMax));

  function use(id: string) {
    if (cfg.clipboardPasteOnClick) pasteEntry(id);
    else copyEntry(id);
    flashed = id;
    setTimeout(() => (flashed = flashed === id ? null : flashed), 900);
  }
</script>

<div class="m-body" data-no-drag>
  {#if !data.isHistoryEnabled}
    <p class="m-empty">
      Clipboard history is off in Windows. Turn it on with Win+V, or in Settings &rsaquo; System
      &rsaquo; Clipboard.
    </p>
  {:else}
    <ul class="m-list">
      {#each listed as entry (entry.id)}
        {@const preview = previewOf(entry)}
        {@const logo = cfg.clipboardShowSource ? sourceLogo(entry) : null}
        <li class="m-row">
          <button class="open" onclick={() => use(entry.id)} title={preview.text}>
            {#if preview.image && cfg.clipboardShowImages}
              <img class="thumb" src={preview.image} alt="" />
            {:else if logo}
              <img class="m-icon" src={logo} alt="" />
            {:else}
              <span class="m-glyph">
                {preview.kind === 'files' ? '\u{1F4C4}' : preview.kind === 'link' ? '\u{1F517}' : '\u201C'}
              </span>
            {/if}
            <span class="m-text">
              <span class="m-title">
                {flashed === entry.id
                  ? cfg.clipboardPasteOnClick
                    ? 'Pasted'
                    : 'Copied'
                  : preview.text || preview.kind}
              </span>
              {#if cfg.clipboardShowSource}
                <span class="m-sub">
                  {entry.sourceAppName ?? 'Unknown app'} &middot; {relativeTime(entry.timestamp, now)}
                </span>
              {/if}
            </span>
          </button>
          <button
            class="m-quiet"
            title="Remove from history"
            aria-label="Remove entry"
            onclick={() => deleteEntry(entry.id)}
          >
            &times;
          </button>
        </li>
      {:else}
        <li class="m-empty">Nothing copied yet.</li>
      {/each}
    </ul>

    {#if listed.length}
      <button class="clear" onclick={clearHistory}>Clear history</button>
    {/if}
  {/if}
</div>

<style>
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
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .m-row:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .thumb {
    flex: none;
    width: 28px;
    height: 20px;
    object-fit: cover;
    border-radius: 3px;
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
