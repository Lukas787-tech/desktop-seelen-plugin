<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { menuSeparator } from '$lib/menu';
  import { launch } from '$lib/launch.svelte';
  import { ENGINES, hostOf, resolveQuery, type EngineId } from '$lib/links';
  import { links, type LinkItem } from '$lib/links.svelte';
  import LinkEdit from './LinkEdit.svelte';

  const cfg = $derived(config.current);

  $effect(() => links.acquire());

  let query = $state('');
  const resolved = $derived(resolveQuery(query, cfg.linksEngine));

  function search(event: SubmitEvent) {
    event.preventDefault();
    if (!resolved) return;
    void launch(resolved.url, 'url');
    query = '';
  }

  function open(link: LinkItem) {
    void launch(link.url, 'url');
  }

  /** Icons that failed to load fall back to a letter, and are not asked for again. */
  let broken = $state<Set<string>>(new Set());

  function favicon(url: string): string {
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostOf(url))}.ico`;
  }

  function edit(linkId: string | null) {
    overlay.openDialog(LinkEdit, { linkId, onclose: () => overlay.closeDialog() });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the clipboard is a courtesy here */
    }
  }

  function menu(event: MouseEvent, link: LinkItem, index: number, count: number) {
    overlay.openMenu(event, [
      { label: link.title, header: true },
      { label: 'Open', action: () => open(link) },
      { label: 'Edit...', action: () => edit(link.id) },
      { label: 'Copy address', action: () => void copy(link.url) },
      { label: 'Move left', disabled: index === 0, action: () => links.move(link.id, -1) },
      { label: 'Move right', disabled: index === count - 1, action: () => links.move(link.id, 1) },
      menuSeparator,
      { label: 'Remove', danger: true, action: () => links.remove(link.id) },
    ]);
  }
</script>

<!-- Re-reads on the way in, for what the other display changed; not a control. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="m-body" data-no-drag onpointerenter={() => void links.file.refresh()}>
  {#if cfg.linksShowSearch}
    <form class="search" onsubmit={search}>
      <select
        class="engine"
        aria-label="Search engine"
        value={cfg.linksEngine}
        onchange={(e) => config.set('linksEngine', e.currentTarget.value as EngineId)}
      >
        {#each Object.entries(ENGINES) as [id, engine] (id)}
          <option value={id}>{engine.label}</option>
        {/each}
      </select>
      <input
        type="search"
        bind:value={query}
        placeholder="Search or type an address"
        aria-label="Search or address"
      />
    </form>
    {#if resolved && query.trim()}
      <p class="m-sub hint">{resolved.kind === 'address' ? 'Open' : 'Search'} {resolved.label} — Enter</p>
    {/if}
  {/if}

  <div class="tiles m-scroll" style:--tile="{cfg.linksTileSize}px">
    {#each links.links as link, index (link.id)}
      <button
        class="tile"
        title={link.url}
        onclick={() => open(link)}
        oncontextmenu={(e) => menu(e, link, index, links.links.length)}
      >
        <span class="face">
          {#if broken.has(link.id)}
            <span class="letter">{link.title.slice(0, 1).toUpperCase()}</span>
          {:else}
            <img
              src={favicon(link.url)}
              alt=""
              loading="lazy"
              onerror={() => (broken = new Set(broken).add(link.id))}
            />
          {/if}
        </span>
        {#if cfg.linksShowLabels}<span class="name">{link.title}</span>{/if}
      </button>
    {/each}
    <button class="tile add" title="Add a link" onclick={() => edit(null)}>
      <span class="face"><span class="letter">+</span></span>
      {#if cfg.linksShowLabels}<span class="name">Add</span>{/if}
    </button>
  </div>
</div>

<style>
  .search {
    flex: none;
    display: flex;
    gap: 4px;
  }

  .m-body .engine {
    flex: none;
    width: auto;
    max-width: 7.5em;
    padding-right: 4px;
    cursor: pointer;
  }

  .search input {
    flex: 1;
    min-width: 0;
  }

  .hint {
    flex: none;
    margin-top: -4px;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--tile) + 18px), 1fr));
    gap: 6px 4px;
    align-content: start;
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
  }

  .tile {
    animation: fx-tile-in var(--dur-slow) var(--ease) backwards;
    animation-delay: calc(var(--lag, 0ms) + var(--nth, 0) * var(--step) * 0.6);
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
    scale: 0.93;
    transition-duration: var(--dur-fast);
  }

  .face {
    display: grid;
    place-items: center;
    width: var(--tile);
    height: var(--tile);
    border-radius: calc(var(--tile) * 0.28);
    background: color-mix(in oklab, var(--color-gray-100, #333) 55%, transparent);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
    transition:
      translate var(--dur-slow) var(--ease-spring),
      scale var(--dur-slow) var(--ease-spring),
      box-shadow var(--dur) var(--ease);
  }

  /* The bookmark's face lifts toward the pointer and casts a deeper shadow. */
  .tile:hover .face {
    translate: 0 -2px;
    scale: 1.08;
    box-shadow: 0 8px 18px rgb(0 0 0 / 0.32);
  }

  .face img {
    width: 50%;
    height: 50%;
    object-fit: contain;
  }

  .letter {
    font-size: calc(var(--tile) * 0.42);
    font-weight: 600;
    color: var(--panel-fg-muted);
  }

  .add .face {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--color-gray-400, #888) 45%, transparent);
  }

  .name {
    max-width: 100%;
    font-size: calc(11px * var(--text-scale, 1));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
