<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';

  import Modal from '../Modal.svelte';
  import { LAUNCHERS, LAUNCHER_ORDER, baseName, type LauncherId } from '$lib/detect';
  import {
    displayName,
    formatLastPlayed,
    formatPlaytime,
    games,
    launcherOf,
  } from '$lib/games.svelte';
  import GameArt from './GameArt.svelte';

  interface Props {
    id: string;
    onclose: () => void;
  }

  let { id, onclose }: Props = $props();

  const game = $derived(games.find(id));

  async function pickArt(): Promise<void> {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (typeof picked === 'string') games.update(id, { art: picked });
  }

  function remove(): void {
    games.remove(id);
    onclose();
  }
</script>

<Modal title={game ? displayName(game) : 'Game'} {onclose} width={480}>
  {#if !game}
    <p class="note">This game is no longer in the library.</p>
  {:else}
    {@const entry = game}
    <div class="head">
      <div class="preview" style:--art-ratio="2 / 3" style:--art-radius="10px">
        <GameArt game={entry} style="auto" />
      </div>
      <div class="stats">
        <div class="stat">
          <span class="value">{formatPlaytime(entry.minutes) ?? '--'}</span>
          <span class="key">played</span>
        </div>
        <div class="stat">
          <span class="value">{entry.launches ?? 0}</span>
          <span class="key">launches</span>
        </div>
        <div class="stat">
          <span class="value">{formatLastPlayed(entry.lastPlayed) ?? 'never'}</span>
          <span class="key">last</span>
        </div>
        <button class="m-btn" onclick={() => games.clearStats(id)}>Reset play time</button>
      </div>
    </div>

    <label class="row">
      <span class="label">Name</span>
      <input
        value={entry.customName ?? ''}
        placeholder={entry.name}
        aria-label="Name"
        oninput={(e) => games.update(id, { customName: e.currentTarget.value || null })}
      />
    </label>

    <label class="row">
      <span class="label">Store</span>
      <select
        value={launcherOf(entry).id}
        aria-label="Store"
        onchange={(e) => games.update(id, { customLauncher: e.currentTarget.value as LauncherId })}
      >
        {#each LAUNCHER_ORDER as launcher (launcher)}
          <option value={launcher}>{LAUNCHERS[launcher].label}</option>
        {/each}
      </select>
    </label>

    <div class="row">
      <span class="label">Cover art</span>
      <div class="buttons">
        <button class="m-btn" onclick={() => void pickArt()}>Choose image...</button>
        <button class="m-btn" disabled={!entry.art} onclick={() => games.update(id, { art: null })}>
          Remove
        </button>
      </div>
    </div>
    {#if entry.art}
      <p class="note path">{entry.art}</p>
    {/if}

    <div class="row">
      <span class="label">Linked program</span>
      <div class="buttons">
        <span class="note">
          {entry.exePath ? baseName(entry.exePath) : 'learned the first time you play it'}
        </span>
        <button
          class="m-btn"
          disabled={!entry.exePath}
          onclick={() => games.update(id, { exePath: null })}
        >
          Forget
        </button>
      </div>
    </div>
    <p class="note">
      Play time is measured from that program's window, so an entry with none is only ever counted
      as launched.
    </p>

    <div class="row">
      <span class="label">Favourite</span>
      <input
        type="checkbox"
        class="switch"
        role="switch"
        aria-label="Favourite"
        checked={entry.favourite === true}
        onchange={(e) => games.update(id, { favourite: e.currentTarget.checked })}
      />
    </div>

    <div class="row">
      <span class="label">Hidden</span>
      <input
        type="checkbox"
        class="switch"
        role="switch"
        aria-label="Hidden"
        checked={entry.hidden === true}
        onchange={(e) => games.update(id, { hidden: e.currentTarget.checked })}
      />
    </div>

    <footer>
      <p class="note path">{entry.target}</p>
      <button class="m-btn m-danger" onclick={remove}>Remove from the library</button>
    </footer>
  {/if}
</Modal>

<style>
  .head {
    display: flex;
    gap: 14px;
    margin-bottom: 14px;
  }

  .preview {
    width: 96px;
    flex: none;
  }

  .stats {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center;
    align-items: flex-start;
  }

  .stat {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .value {
    font-size: calc(15px * var(--text-scale, 1));
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .key {
    font-size: calc(10px * var(--text-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--panel-fg-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 0;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .label {
    flex: none;
    width: 110px;
    font-size: calc(12px * var(--text-scale, 1));
  }

  input:not([type='checkbox']),
  select {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    border: 0;
    border-radius: calc(7px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  .buttons {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .note {
    font-size: calc(11px * var(--text-scale, 1));
    line-height: 1.45;
    color: var(--panel-fg-muted);
    padding: 4px 0;
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono-font, ui-monospace, 'Cascadia Mono', Consolas, monospace);
    font-size: calc(10px * var(--text-scale, 1));
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  footer .path {
    flex: 1;
    min-width: 0;
  }

  /* A checkbox drawn as a switch, as the settings dialog draws its own. */
  .switch {
    flex: none;
    appearance: none;
    width: 32px;
    height: 18px;
    border-radius: calc(999px * var(--round, 1));
    position: relative;
    cursor: pointer;
    margin-left: auto;
    background: color-mix(in oklab, var(--color-gray-300, #666) 35%, transparent);
    transition: background 0.15s ease;
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s ease;
  }

  .switch:checked {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 70%, transparent);
  }

  .switch:checked::after {
    transform: translateX(14px);
  }
</style>
