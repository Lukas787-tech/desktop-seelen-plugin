<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import type { StartMenuItem } from '@seelen-ui/lib/types';

  import Modal from '../Modal.svelte';
  import {
    LAUNCHERS,
    LAUNCHER_ORDER,
    kindOfTarget,
    launcherFor,
    type LauncherId,
  } from '$lib/detect';
  import { games } from '$lib/games.svelte';
  import { icons } from '$lib/icons.svelte';
  import { apps } from '$lib/launch.svelte';

  interface Props {
    /** Which tab to open on; the panel's "N found" chip comes straight here. */
    tab?: 'apps' | 'found' | 'link';
    onclose: () => void;
  }

  let { tab: initialTab = 'apps', onclose }: Props = $props();

  // The installed-application index is only held while this dialog is open.
  onMount(() => {
    let release: (() => void) | null = null;
    let closed = false;
    void apps.acquire().then((off) => (closed ? off() : (release = off)));
    return () => {
      closed = true;
      release?.();
    };
  });

  // Seeded once and then owned by the dialog, which is created fresh on every
  // open - the prop is where it starts, not what it follows.
  // svelte-ignore state_referenced_locally
  let tab = $state<'apps' | 'found' | 'link'>(initialTab);
  let query = $state('');
  let url = $state('');
  let urlLabel = $state('');
  let urlLauncher = $state<LauncherId>('steam');
  let error = $state('');

  const results = $derived(apps.search(query, 80));

  /** Targets already in the library, so the same game is not listed twice. */
  const owned = $derived(new Set(games.all.map((game) => game.target.toLowerCase())));

  function addApp(item: StartMenuItem): void {
    const target = (item.target ?? item.path).trim();
    if (!target) return;
    games.addManual({
      name: item.display_name,
      target,
      kind: kindOfTarget(target),
      umid: item.umid,
      // The shortcut, not the target: it is what the icon packs resolve, and
      // for a protocol target it is the only thing that has an icon at all.
      iconKey: item.path,
      launcher: launcherFor(target, item.path),
    });
  }

  function baseName(path: string): string {
    const name = path.split(/[\\/]/).pop() ?? path;
    return name.replace(/\.(exe|lnk|url|bat)$/i, '');
  }

  async function pickFiles(): Promise<void> {
    error = '';
    try {
      const picked = await open({
        multiple: true,
        directory: false,
        filters: [{ name: 'Programs and shortcuts', extensions: ['exe', 'lnk', 'url', 'bat'] }],
      });
      if (!picked) return;
      for (const path of Array.isArray(picked) ? picked : [picked]) {
        games.addManual({
          name: baseName(path),
          target: path,
          kind: 'app',
          iconKey: path,
          launcher: launcherFor(path),
        });
      }
      onclose();
    } catch (err) {
      error = `Could not open the file picker: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function addAllFound(): void {
    for (const candidate of games.suggestions.slice()) games.addSuggestion(candidate);
  }

  function addLink(): void {
    const trimmed = url.trim();
    if (!trimmed) return;
    games.addManual({
      name: urlLabel.trim() || trimmed.replace(/^[a-z0-9+.-]+:\/\//i, '').slice(0, 40),
      target: trimmed,
      kind: kindOfTarget(trimmed),
      launcher: urlLauncher,
    });
    onclose();
  }
</script>

<Modal title="Add games" {onclose} width={580}>
  <p class="lede">
    The scan reads the Start Menu, walks Downloads, the Desktop and Documents looking for game
    files, and picks up anything it sees running &mdash; which is how a Game Pass title with no
    shortcut anywhere is found. Whatever it was not sure about is under <b>Found</b>.
    <button class="link" onclick={() => void games.scan()} disabled={games.scanning}>
      {games.scanning ? `Searching ${games.scanStep ?? '...'}` : 'Search again'}
    </button>
  </p>

  <nav class="tabs">
    <button class:active={tab === 'apps'} onclick={() => (tab = 'apps')}>Installed</button>
    <button class:active={tab === 'found'} onclick={() => (tab = 'found')}>
      Found{games.suggestions.length ? ` (${games.suggestions.length})` : ''}
    </button>
    <button class:active={tab === 'link'} onclick={() => (tab = 'link')}>Launcher link</button>
    <span class="spacer"></span>
    <button onclick={() => void pickFiles()}>Choose files...</button>
  </nav>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if tab === 'apps'}
    <input
      class="search"
      bind:value={query}
      placeholder="Search {apps.items.length} installed applications..."
      aria-label="Search applications"
    />
    <ul class="apps">
      {#each results as app, i (`${app.path}#${i}`)}
        {@const target = (app.target ?? app.path).trim()}
        {@const added = owned.has(target.toLowerCase())}
        {@const src = icons.resolve({ path: app.target ?? app.path, umid: app.umid })}
        <li>
          <button disabled={added} onclick={() => addApp(app)}>
            {#if src}
              <img {src} alt="" />
            {:else}
              <span class="dot"></span>
            {/if}
            <span class="name">{app.display_name}</span>
            {#if added}<span class="tag">added</span>{/if}
          </button>
        </li>
      {:else}
        <li class="empty">No application matches that.</li>
      {/each}
    </ul>
  {:else if tab === 'found'}
    {#if !games.suggestions.length}
      <p class="hint">
        {games.scanning
          ? `Searching ${games.scanStep ?? '...'}`
          : 'Nothing else on this machine looked like a game. Anything you have turned down is not offered again.'}
        {#if games.state.dismissed.length}
          <button class="link" onclick={() => games.clearDismissed()}>
            Offer the {games.state.dismissed.length} I turned down again
          </button>
        {/if}
      </p>
    {:else}
      <p class="hint">
        Programs the scan is not sure about: a game with no engine files beside it looks exactly
        like anything else that was downloaded, so these are offered rather than added.
      </p>
      <ul class="found">
        {#each games.suggestions as candidate (candidate.key)}
          <li>
            <span class="what">
              <span class="name">{candidate.name}</span>
              <span class="why" title={candidate.target}>
                {candidate.reason} &middot; {candidate.target}
              </span>
            </span>
            <button class="m-btn m-primary" onclick={() => games.addSuggestion(candidate)}>
              Add
            </button>
            <button
              class="m-btn"
              title="Never offer this one again"
              onclick={() => games.dismissSuggestion(candidate.key)}
            >
              No
            </button>
          </li>
        {/each}
      </ul>
      <button class="primary" onclick={addAllFound}>Add all {games.suggestions.length}</button>
    {/if}
  {:else}
    <div class="form">
      <p class="hint">
        A store's own link starts the game through its client, which is what a Start Menu shortcut
        does too &mdash; for example <code>steam://rungameid/220</code> or
        <code>com.epicgames.launcher://apps/fortnite?action=launch</code>.
      </p>
      <label>
        <span>Link</span>
        <input bind:value={url} placeholder="steam://rungameid/220" aria-label="Link" />
      </label>
      <label>
        <span>Name</span>
        <input bind:value={urlLabel} placeholder="Half-Life 2" aria-label="Name" />
      </label>
      <label>
        <span>Store</span>
        <select bind:value={urlLauncher} aria-label="Store">
          {#each LAUNCHER_ORDER as id (id)}
            <option value={id}>{LAUNCHERS[id].label}</option>
          {/each}
        </select>
      </label>
      <button class="primary" onclick={addLink} disabled={!url.trim()}>Add game</button>
    </div>
  {/if}
</Modal>

<style>
  .lede {
    font-size: 11px;
    line-height: 1.45;
    color: var(--panel-fg-muted);
    margin-bottom: 12px;
  }

  .link {
    padding: 0;
    background: transparent;
    border: 0;
    font: inherit;
    color: var(--color-blue-400, #7aa2f7);
    cursor: pointer;
    text-decoration: underline;
  }

  .link:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
  }

  .tabs .spacer {
    flex: 1;
  }

  .tabs button {
    padding: 5px 10px;
    font-size: 12px;
    border-radius: 7px;
    background: color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
    color: var(--panel-fg);
    cursor: pointer;
  }

  .tabs button.active {
    background: color-mix(in oklab, var(--color-gray-300, #666) 40%, transparent);
  }

  input,
  select {
    width: 100%;
    padding: 7px 10px;
    font: inherit;
    font-size: 12px;
    border-radius: 8px;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  .search {
    margin-bottom: 10px;
  }

  .apps {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 2px;
    max-height: 44vh;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .apps button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border-radius: 8px;
    background: transparent;
    color: var(--panel-fg);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .apps button:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }

  .apps button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .apps img {
    width: 20px;
    height: 20px;
    object-fit: contain;
    flex: none;
  }

  .dot {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    flex: none;
    background: color-mix(in oklab, var(--color-gray-300, #666) 40%, transparent);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    flex: none;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--panel-fg-muted);
  }

  .empty,
  .error {
    color: var(--panel-fg-muted);
    font-size: 12px;
  }

  .error {
    color: var(--color-red-700, #f77);
    margin-bottom: 8px;
  }

  .found {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 40vh;
    overflow-y: auto;
    overflow-x: hidden;
    margin-bottom: 10px;
  }

  .found li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: 8px;
  }

  .found li:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* The end of a path says more than its start, so it is what survives. */
  .why {
    font-size: 10px;
    color: var(--panel-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .hint {
    font-size: 11px;
    line-height: 1.5;
    color: var(--panel-fg-muted);
  }

  code {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 4px;
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--panel-fg-muted);
  }

  .primary {
    align-self: flex-start;
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 12px;
    cursor: pointer;
    color: #fff;
    background: color-mix(in oklab, var(--color-blue-600, #37f) 90%, transparent);
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
