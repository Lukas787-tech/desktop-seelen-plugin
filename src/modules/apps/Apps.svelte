<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { icons } from '$lib/icons.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { menuSeparator } from '$lib/menu';
  import { apps, revealInExplorer } from '$lib/launch.svelte';
  import { appsPanel, knownFrom, type KnownApp } from '$lib/apps-panel.svelte';
  import { store } from '$lib/store.svelte';

  const cfg = $derived(config.current);

  $effect(() => appsPanel.acquire());

  let query = $state('');
  let active = $state(0);
  let list = $state<HTMLElement | null>(null);

  const searching = $derived(query.trim().length > 0);
  const results = $derived(searching ? apps.search(query, 60).map(knownFrom) : []);
  const favourites = $derived(cfg.appsShowFavourites ? appsPanel.favourites : []);
  const recents = $derived(cfg.appsShowRecent ? appsPanel.recents(6) : []);

  // Reset the highlight whenever what is highlighted changes.
  $effect(() => {
    void query;
    active = 0;
  });

  /*
   * The full list, a chunk at a time. Every row resolves an icon, and a miss
   * asks the host to extract one - so rendering four hundred rows at once was
   * four hundred lookups and a burst of extraction requests the moment the panel
   * appeared. Rows are added as the list is scrolled towards its end instead.
   */
  const CHUNK = 60;
  let shown = $state(CHUNK);
  let sentinel = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!sentinel || !list) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) shown += CHUNK;
      },
      { root: list, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  const everything = $derived.by(() => {
    if (searching || !cfg.appsShowAll) return [];
    const groups: { letter: string; apps: KnownApp[] }[] = [];
    for (const item of apps.items.slice(0, shown)) {
      const first = item.display_name.trim().charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : '#';
      const last = groups[groups.length - 1];
      if (last?.letter === letter) last.apps.push(knownFrom(item));
      else groups.push({ letter, apps: [knownFrom(item)] });
    }
    return groups;
  });

  function iconOf(app: KnownApp): string | null {
    return icons.resolve({ path: app.target ?? app.path, umid: app.umid });
  }

  function open(app: KnownApp) {
    appsPanel.open(app);
    query = '';
  }

  function onKey(event: KeyboardEvent) {
    if (!searching) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(results.length - 1, active + 1);
      scrollActive();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, active - 1);
      scrollActive();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) open(chosen);
    } else if (event.key === 'Escape') {
      query = '';
    }
  }

  function scrollActive() {
    queueMicrotask(() => list?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }));
  }

  /** A free cell on the icon grid, scanning down from the top-right corner. */
  function freeIconSpot(): { x: number; y: number } {
    const grid = cfg.gridSize;
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (let x = Math.floor((width - grid) / grid) * grid; x >= 0; x -= grid) {
      for (let y = 40; y + grid <= height; y += grid) {
        const taken = store.state.icons.some((icon) => Math.abs(icon.x - x) < grid / 2 && Math.abs(icon.y - y) < grid / 2);
        if (!taken) return { x, y };
      }
    }
    return { x: 40, y: 40 };
  }

  function menu(event: MouseEvent, app: KnownApp, where: 'favourite' | 'recent' | 'list') {
    const favourite = appsPanel.isFavourite(app.path);
    overlay.openMenu(event, [
      { label: app.name, header: true },
      { label: 'Open', action: () => open(app) },
      { label: favourite ? 'Remove from favourites' : 'Add to favourites', action: () => appsPanel.toggleFavourite(app) },
      ...(where === 'favourite'
        ? [
            { label: 'Move earlier', action: () => appsPanel.moveFavourite(app.path, -1) },
            { label: 'Move later', action: () => appsPanel.moveFavourite(app.path, 1) },
          ]
        : []),
      {
        label: 'Put on the desktop',
        action: () => store.addIcon({ label: app.name, target: app.path, kind: 'app', umid: app.umid, ...freeIconSpot() }),
      },
      { label: 'Show in Explorer', action: () => void revealInExplorer(app.path) },
      ...(where === 'recent'
        ? [menuSeparator, { label: 'Forget', action: () => appsPanel.forget(app.path) }, { label: 'Clear recent apps', action: () => appsPanel.clearRecents() }]
        : []),
    ]);
  }
</script>

{#snippet row(app: KnownApp, where: 'favourite' | 'recent' | 'list', highlighted = false)}
  {@const src = iconOf(app)}
  <button
    class="m-row m-click app m-lazy"
    class:m-active={highlighted}
    data-active={highlighted}
    title={app.name}
    onclick={() => open(app)}
    oncontextmenu={(e) => menu(e, app, where)}
  >
    {#if src}<img class="m-icon" {src} alt="" loading="lazy" />{:else}<span class="m-glyph">&#9633;</span>{/if}
    <span class="m-text"><span class="m-title">{app.name}</span></span>
    {#if where !== 'favourite' && appsPanel.isFavourite(app.path)}<span class="m-glyph star">&#9733;</span>{/if}
  </button>
{/snippet}

{#snippet tile(app: KnownApp, where: 'favourite' | 'recent' | 'list')}
  {@const src = iconOf(app)}
  <button class="tile" title={app.name} onclick={() => open(app)} oncontextmenu={(e) => menu(e, app, where)}>
    {#if src}<img {src} alt="" loading="lazy" />{:else}<span class="blank"></span>{/if}
    <span class="name">{app.name}</span>
  </button>
{/snippet}

<div class="m-body" data-no-drag style:--tile="{cfg.appsTileSize}px">
  <input
    type="search"
    class="search"
    bind:value={query}
    placeholder={apps.items.length ? `Search ${apps.items.length} apps` : 'Search apps'}
    aria-label="Search apps"
    onkeydown={onKey}
  />

  <div class="m-scroll" bind:this={list}>
    {#if searching}
      {#each results as app, i (app.path)}
        {@render row(app, 'list', i === active)}
      {:else}
        <p class="m-empty">No app matches “{query.trim()}”.</p>
      {/each}
    {:else}
      {#if favourites.length}
        <div class="m-label">Favourites</div>
        {#if cfg.appsView === 'grid'}
          <div class="tiles">
            {#each favourites as app (app.id)}{@render tile(app, 'favourite')}{/each}
          </div>
        {:else}
          {#each favourites as app (app.id)}{@render row(app, 'favourite')}{/each}
        {/if}
      {/if}

      {#if recents.length}
        <div class="m-label">Recently opened</div>
        {#if cfg.appsView === 'grid'}
          <div class="tiles">
            {#each recents as app (app.id)}{@render tile(app, 'recent')}{/each}
          </div>
        {:else}
          {#each recents as app (app.id)}{@render row(app, 'recent')}{/each}
        {/if}
      {/if}

      {#if cfg.appsShowAll}
        {#if !apps.items.length}
          <p class="m-empty">Reading the Start Menu...</p>
        {/if}
        {#each everything as group (group.letter)}
          <div class="m-label">{group.letter}</div>
          {#if cfg.appsView === 'grid'}
            <div class="tiles">
              {#each group.apps as app (app.path)}{@render tile(app, 'list')}{/each}
            </div>
          {:else}
            {#each group.apps as app (app.path)}{@render row(app, 'list')}{/each}
          {/if}
        {/each}
        {#if shown < apps.items.length}
          <div class="sentinel" bind:this={sentinel}></div>
        {/if}
      {:else if !favourites.length && !recents.length}
        <p class="m-empty">Search above. Right-click an app to add it to favourites.</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .search {
    flex: none;
    width: 100%;
  }

  .m-scroll {
    display: flex;
    flex-direction: column;
    margin: 0 -6px;
    padding: 0 6px;
  }

  .app {
    flex: none;
  }

  .star {
    width: auto;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--accent, #7aa2f7);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--tile) + 24px), 1fr));
    gap: 2px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 6px 2px;
    border: 0;
    border-radius: calc(9px * var(--round, 1));
    font: inherit;
    color: var(--panel-fg);
    background: transparent;
    cursor: pointer;
    content-visibility: auto;
    contain-intrinsic-size: auto calc(var(--tile) + 30px);
    animation: fx-tile-in var(--dur-slow) var(--ease) backwards;
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
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .tile:active {
    scale: 0.94;
    transition-duration: var(--dur-fast);
  }

  .tile img,
  .blank {
    width: var(--tile);
    height: var(--tile);
    object-fit: contain;
    transition:
      translate var(--dur-slow) var(--ease-spring),
      scale var(--dur-slow) var(--ease-spring);
  }

  /* The icon floats up toward the pointer, as a desktop icon does. */
  .tile:hover img,
  .tile:hover .blank {
    translate: 0 -2px;
    scale: 1.1;
  }

  .blank {
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .name {
    max-width: 100%;
    font-size: calc(10.5px * var(--text-scale, 1));
    line-height: 1.2;
    text-align: center;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .sentinel {
    height: 1px;
  }
</style>
