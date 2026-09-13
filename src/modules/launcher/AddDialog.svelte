<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import Modal from '../Modal.svelte';
  import { apps } from '$lib/launch.svelte';
  import { icons } from '$lib/icons.svelte';
  import { store, type DesktopIcon } from '$lib/store.svelte';

  interface Props {
    /** Where new icons are placed, in surface coordinates. */
    dropAt: { x: number; y: number };
    onclose: () => void;
  }

  let { dropAt, onclose }: Props = $props();

  // The installed-application index is only needed while this dialog is open.
  onMount(() => {
    let release: (() => void) | null = null;
    let closed = false;
    void apps.acquire().then((off) => (closed ? off() : (release = off)));
    return () => {
      closed = true;
      release?.();
    };
  });

  let tab = $state<'apps' | 'url'>('apps');
  let query = $state('');
  let url = $state('');
  let urlLabel = $state('');
  let error = $state('');

  const results = $derived(apps.search(query, 60));

  /** Stacks additions so several items in one session do not overlap. */
  let added = 0;
  function nextPosition() {
    const perColumn = 6;
    const x = dropAt.x + Math.floor(added / perColumn) * 110;
    const y = dropAt.y + (added % perColumn) * 96;
    added++;
    return { x, y };
  }

  function addApp(displayName: string, path: string, umid: string | null) {
    const { x, y } = nextPosition();
    store.addIcon({ label: displayName, target: path, kind: 'app', umid, x, y });
  }

  async function pickFiles(directory: boolean) {
    error = '';
    try {
      const picked = await open({ multiple: true, directory });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      for (const path of paths) {
        const { x, y } = nextPosition();
        const item: Omit<DesktopIcon, 'id'> = {
          label: basename(path),
          target: path,
          kind: directory ? 'folder' : 'file',
          umid: null,
          x,
          y,
        };
        store.addIcon(item);
      }
      onclose();
    } catch (err) {
      error = `Could not open the file picker: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function basename(path: string): string {
    const parts = path.split(/[\\/]/);
    const name = parts[parts.length - 1] ?? path;
    return name.replace(/\.(lnk|exe|url)$/i, '');
  }

  function addUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    const href = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const { x, y } = nextPosition();
    store.addIcon({
      label: urlLabel.trim() || href.replace(/^https?:\/\//, '').split('/')[0] || href,
      target: href,
      kind: 'url',
      umid: null,
      x,
      y,
    });
    onclose();
  }
</script>

<Modal title="Add to desktop" {onclose}>
  <nav class="tabs">
    <button class:active={tab === 'apps'} onclick={() => (tab = 'apps')}>Applications</button>
    <button class:active={tab === 'url'} onclick={() => (tab = 'url')}>Web link</button>
    <span class="spacer"></span>
    <button onclick={() => pickFiles(false)}>Choose files...</button>
    <button onclick={() => pickFiles(true)}>Choose folder...</button>
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
        {@const src = icons.resolve({ path: app.target ?? app.path, umid: app.umid })}
        <li>
          <button onclick={() => addApp(app.display_name, app.path, app.umid)}>
            {#if src}
              <img {src} alt="" />
            {:else}
              <span class="dot"></span>
            {/if}
            <span class="name">{app.display_name}</span>
          </button>
        </li>
      {:else}
        <li class="empty">No application matches that.</li>
      {/each}
    </ul>
  {:else}
    <div class="url-form">
      <label>
        <span>Address</span>
        <input bind:value={url} placeholder="example.com" aria-label="Address" />
      </label>
      <label>
        <span>Label (optional)</span>
        <input bind:value={urlLabel} placeholder="Example" aria-label="Label" />
      </label>
      <button class="primary" onclick={addUrl} disabled={!url.trim()}>Add link</button>
    </div>
  {/if}
</Modal>

<style>
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

  input {
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
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 2px;
    max-height: 46vh;
    overflow-y: auto;
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

  .apps button:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
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

  .empty,
  .error {
    color: var(--panel-fg-muted);
    font-size: 12px;
  }

  .error {
    color: var(--color-red-700, #f77);
    margin-bottom: 8px;
  }

  .url-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .url-form label {
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
