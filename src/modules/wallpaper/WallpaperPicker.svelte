<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import Modal from '../Modal.svelte';
  import { wallpapers } from '$lib/wallpapers.svelte';
  import { store } from '$lib/store.svelte';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let error = $state('');

  const choice = $derived(store.state.wallpaper);

  async function pickFile() {
    error = '';
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Images and video',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'mp4', 'webm', 'ogg'],
          },
        ],
      });
      if (typeof picked !== 'string') return;
      store.setWallpaper({ source: 'file', path: picked });
      onclose();
    } catch (err) {
      error = `Could not open the file picker: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
</script>

<Modal title="Wallpaper for this display" {onclose} width={620}>
  <nav class="actions">
    <button onclick={pickFile}>Choose a file...</button>
    <button
      class:active={choice.source === 'none'}
      onclick={() => {
        store.setWallpaper({ source: 'none' });
        onclose();
      }}
    >
      None (show Windows wallpaper)
    </button>
  </nav>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if wallpapers.entries.length}
    <p class="hint">From your Seelen wallpaper library</p>
    <ul class="grid">
      {#each wallpapers.entries as entry (entry.id)}
        <li>
          <button
            class:active={choice.source === 'library' && choice.id === entry.id}
            title={entry.name}
            onclick={() => {
              store.setWallpaper({ source: 'library', id: entry.id });
              onclose();
            }}
          >
            {#if entry.thumbnailUrl}
              <img src={entry.thumbnailUrl} alt="" loading="lazy" />
            {:else}
              <div class="blank"></div>
            {/if}
            <span class="caption">
              <span class="name">{entry.name}</span>
              {#if entry.isVideo}<span class="tag">video</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">
      Your Seelen wallpaper library is empty. Use "Choose a file..." to pick an image or video.
    </p>
  {/if}
</Modal>

<style>
  .actions {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .actions button {
    padding: 6px 12px;
    font-size: 12px;
    border-radius: 8px;
    background: color-mix(in oklab, var(--color-gray-300, #666) 20%, transparent);
    color: var(--panel-fg);
    cursor: pointer;
  }

  .actions button.active {
    outline: 1px solid color-mix(in oklab, var(--color-blue-500, #37f) 70%, transparent);
  }

  .hint {
    font-size: 11px;
    color: var(--panel-fg-muted);
    margin-bottom: 8px;
  }

  .error {
    font-size: 12px;
    color: var(--color-red-700, #f77);
    margin-bottom: 8px;
  }

  .grid {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }

  .grid button {
    width: 100%;
    padding: 0;
    background: transparent;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    outline: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .grid button.active {
    outline: 2px solid color-mix(in oklab, var(--color-blue-500, #37f) 85%, transparent);
  }

  img,
  .blank {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }

  .caption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 5px 7px;
    font-size: 11px;
    color: var(--panel-fg);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 999px;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 34%, transparent);
    flex: none;
  }
</style>
