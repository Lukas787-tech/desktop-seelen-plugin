<script lang="ts">
  import { config } from '$lib/config.svelte';
  import {
    FOLDERS,
    SEP,
    commonRoot,
    displayName,
    folderContents,
    folderTypeFrom,
    listDirectory,
    type FileEntry,
  } from '$lib/files.svelte';
  import { icons } from '$lib/icons.svelte';
  import { launch, revealInExplorer } from '$lib/launch.svelte';
  import { menuSeparator, type MenuItem } from '$lib/menu';
  import { overlay } from '$lib/overlay.svelte';
  import { store } from '$lib/store.svelte';

  const cfg = $derived(config.current);

  const folder = $derived(folderTypeFrom(cfg.filesFolder));

  // Re-runs when the chosen folder changes; the cleanup releases the old one.
  $effect(() => folderContents.watch(folder));

  /** Where we are, as segments below the folder the host walked. */
  let trail = $state<string[]>([]);
  let filter = $state('');

  // A different folder is a different tree: start at the top of it.
  $effect(() => {
    void folder;
    trail = [];
    filter = '';
  });

  const root = $derived(commonRoot(folderContents.paths));
  const here = $derived([root, ...trail].join(SEP));

  const listing = $derived(
    listDirectory(folderContents.paths, here, {
      limit: cfg.filesMax,
      sort: cfg.filesSort,
      filter,
    }),
  );

  const folderLabel = $derived(FOLDERS.find((f) => f.value === folder)?.label ?? 'Files');

  /**
   * The path as buttons.
   *
   * A deep trail is collapsed to an ellipsis and the last two levels: the panel
   * is a few hundred pixels wide, and a breadcrumb that scrolls is worse than
   * one that does not show every step.
   */
  const crumbs = $derived.by(() => {
    const all = trail.map((name, i) => ({ name, depth: i + 1 }));
    if (all.length <= 2) return { hidden: 0, shown: all };
    return { hidden: all.length - 2, shown: all.slice(-2) };
  });

  function enter(entry: FileEntry): void {
    trail = [...trail, entry.name];
    filter = '';
  }

  function goTo(depth: number): void {
    trail = trail.slice(0, depth);
    filter = '';
  }

  function open(entry: FileEntry): void {
    if (entry.directory) enter(entry);
    else void launch(entry.path, 'file');
  }

  /** Puts an entry on the desktop as an icon, near the top-left of the grid. */
  function pin(entry: FileEntry): void {
    store.addIcon({
      label: displayName(entry.path),
      target: entry.path,
      kind: entry.directory ? 'folder' : 'file',
      umid: null,
      x: 40,
      y: 40 + store.state.icons.length * 12,
    });
  }

  /** Switches which known folder is browsed, on this display or on all. */
  function folderMenu(event: MouseEvent): void {
    overlay.openMenu(
      event,
      FOLDERS.map((known) => ({
        label: known.label,
        checked: known.value === folder,
        hint: config.overrides.has('filesFolder') && known.value === folder ? 'this display' : undefined,
        action: () => config.set('filesFolder', known.value as never),
      })),
    );
  }

  function entryMenu(entry: FileEntry): MenuItem[] {
    return [
      { label: displayName(entry.path), header: true },
      entry.directory
        ? { label: 'Open here', action: () => enter(entry) }
        : { label: 'Open', action: () => void launch(entry.path, 'file') },
      {
        label: entry.directory ? 'Open in Explorer' : 'Show in Explorer',
        action: () =>
          entry.directory
            ? void launch(entry.path, 'folder')
            : void revealInExplorer(entry.path),
      },
      menuSeparator,
      { label: 'Add to desktop', action: () => pin(entry) },
    ];
  }

  function iconFor(entry: FileEntry): string | null {
    return cfg.filesShowIcons && !entry.directory ? icons.resolve({ path: entry.path }) : null;
  }
</script>

<div
  class="m-body files"
  data-no-drag
  style:--tile="{cfg.filesTileSize}px"
>
  <div class="bar">
    <button
      class="tool"
      title="Up one level"
      aria-label="Up one level"
      disabled={!trail.length}
      onclick={() => goTo(trail.length - 1)}
    >
      &#8593;
    </button>

    <nav class="crumbs" aria-label="Path">
      <button class="crumb root" title={here || folderLabel} onclick={() => goTo(0)}>
        {folderLabel}
      </button>
      <button
        class="caret"
        aria-label="Choose a folder"
        title="Choose a folder"
        onclick={folderMenu}
      >
        &#9662;
      </button>
      {#if crumbs.hidden}
        <span class="sep">&rsaquo;</span>
        <button
          class="crumb"
          title="Back {crumbs.hidden} level{crumbs.hidden === 1 ? '' : 's'}"
          onclick={() => goTo(trail.length - 2)}
        >
          &hellip;
        </button>
      {/if}
      {#each crumbs.shown as crumb (crumb.depth)}
        <span class="sep">&rsaquo;</span>
        <button class="crumb" title={crumb.name} onclick={() => goTo(crumb.depth)}>
          {crumb.name}
        </button>
      {/each}
    </nav>

    <button
      class="tool"
      title="Open this folder in Explorer"
      aria-label="Open this folder in Explorer"
      disabled={!here}
      onclick={() => void launch(here, 'folder')}
    >
      &#8599;
    </button>
    <button
      class="tool"
      title={cfg.filesView === 'list' ? 'Show tiles' : 'Show a list'}
      aria-label="Change view"
      onclick={() => config.set('filesView', cfg.filesView === 'list' ? 'grid' : 'list')}
    >
      {cfg.filesView === 'list' ? '▦' : '≡'}
    </button>
  </div>

  {#if cfg.filesShowSearch}
    <input
      class="filter"
      bind:value={filter}
      placeholder="Filter this folder..."
      aria-label="Filter this folder"
    />
  {/if}

  {#if !listing.entries.length}
    <p class="m-empty">
      {#if folderContents.loading}
        Reading the folder...
      {:else if filter.trim()}
        Nothing here matches that.
      {:else if trail.length}
        This folder is empty.
      {:else}
        Nothing in {folderLabel}.
      {/if}
    </p>
  {:else if cfg.filesView === 'grid'}
    <div class="tiles">
      {#each listing.entries as entry (entry.path)}
        {@const src = iconFor(entry)}
        <button
          class="tile"
          title={entry.name}
          onclick={() => open(entry)}
          oncontextmenu={(e) => overlay.openMenu(e, entryMenu(entry))}
        >
          <span class="art">
            {#if entry.directory}
              {@render folderGlyph()}
            {:else if src}
              <img {src} alt="" />
            {:else}
              {@render fileGlyph(entry)}
            {/if}
          </span>
          <span class="label">{displayName(entry.path)}</span>
        </button>
      {/each}
    </div>
  {:else}
    <ul class="m-list">
      {#each listing.entries as entry (entry.path)}
        {@const src = iconFor(entry)}
        <li class="m-row m-click">
          <button
            class="hit"
            title={entry.name}
            onclick={() => open(entry)}
            oncontextmenu={(e) => overlay.openMenu(e, entryMenu(entry))}
          >
            {#if entry.directory}
              {@render folderGlyph()}
            {:else if src}
              <img class="m-icon" {src} alt="" />
            {:else}
              {@render fileGlyph(entry)}
            {/if}
            <span class="m-text">
              <span class="m-title">{displayName(entry.path)}</span>
            </span>
          </button>
          {#if entry.directory && entry.count}
            <span class="count">{entry.count}</span>
          {:else if entry.ext}
            <span class="count ext">{entry.ext}</span>
          {/if}
          <button
            class="m-quiet"
            title="Add to desktop"
            aria-label="Add {displayName(entry.path)} to desktop"
            onclick={() => pin(entry)}
          >
            &plus;
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if listing.total > listing.entries.length}
    <p class="foot">
      Showing {listing.entries.length} of {listing.total}.
    </p>
  {/if}
</div>

{#snippet folderGlyph()}
  <svg class="glyph folder" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3 6.6A1.6 1.6 0 0 1 4.6 5h3.9c.42 0 .82.17 1.12.46l1.1 1.08c.3.3.7.46 1.12.46h6.56A1.6 1.6 0 0 1 20 8.6v9.8A1.6 1.6 0 0 1 18.4 20H4.6A1.6 1.6 0 0 1 3 18.4z"
    />
  </svg>
{/snippet}

{#snippet fileGlyph(entry: FileEntry)}
  <svg class="glyph file" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 3.6A1.6 1.6 0 0 1 7.6 2h6.2L19 7.2v13.2A1.6 1.6 0 0 1 17.4 22H7.6A1.6 1.6 0 0 1 6 20.4z" />
    <path class="fold" d="M13.6 2 19 7.4h-4.2a1.2 1.2 0 0 1-1.2-1.2z" />
  </svg>
  <span class="sr">{entry.ext}</span>
{/snippet}

<style>
  .files {
    gap: 6px;
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }

  .tool {
    flex: none;
    width: 21px;
    height: 21px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 20%, transparent);
  }

  .tool:hover:not(:disabled) {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 38%, transparent);
  }

  .tool:disabled {
    opacity: 0.35;
    cursor: default;
  }

  /* The path never wraps and never scrolls: the last levels are what matter. */
  .crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1px;
    overflow: hidden;
  }

  .crumb {
    min-width: 0;
    padding: 2px 4px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--panel-fg-muted);
    font: inherit;
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .crumb:last-of-type {
    color: var(--panel-fg);
    font-weight: 600;
  }

  .crumb:hover,
  .caret:hover {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .crumb.root {
    flex: none;
    max-width: 40%;
  }

  .caret {
    flex: none;
    padding: 2px 2px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: 9px;
    line-height: 1;
    cursor: pointer;
  }

  .sep {
    flex: none;
    font-size: 11px;
    color: var(--panel-fg-muted);
    opacity: 0.6;
  }

  .filter {
    flex: none;
  }

  .hit {
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

  /* Folder count, or a file's type when it has no icon of its own. */
  .count {
    flex: none;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--panel-fg-muted);
  }

  .count.ext {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.7;
  }

  .glyph {
    flex: none;
    width: 18px;
    height: 18px;
  }

  .folder {
    fill: color-mix(in oklab, var(--accent, #7aa2f7) 78%, #fff 6%);
  }

  .file {
    fill: color-mix(in oklab, var(--color-gray-300, #666) 62%, transparent);
  }

  .file .fold {
    fill: color-mix(in oklab, var(--color-gray-300, #999) 90%, transparent);
  }

  .tiles {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr));
    gap: 6px 4px;
    margin: 0 -6px;
    padding: 0 6px 4px;
    align-content: start;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 6px 3px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--panel-fg);
    font: inherit;
    cursor: pointer;
    min-width: 0;
  }

  .tile:hover,
  .tile:focus-visible {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .art {
    display: grid;
    place-items: center;
    width: 46%;
    min-width: 26px;
    aspect-ratio: 1;
  }

  .art img,
  .art .glyph {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .label {
    width: 100%;
    font-size: 10px;
    line-height: 1.25;
    text-align: center;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  .foot {
    flex: none;
    font-size: 10px;
    color: var(--panel-fg-muted);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
