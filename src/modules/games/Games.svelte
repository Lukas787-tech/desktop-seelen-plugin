<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';

  import { config } from '$lib/config.svelte';
  import { LAUNCHER_ORDER, LAUNCHERS, baseName } from '$lib/detect';
  import {
    displayName,
    formatLastPlayed,
    formatPlaytime,
    games,
    launcherOf,
    sortGames,
    type GameEntry,
  } from '$lib/games.svelte';
  import { revealInExplorer } from '$lib/launch.svelte';
  import { menuSeparator, type MenuItem } from '$lib/menu';
  import { overlay } from '$lib/overlay.svelte';
  import { activateWindow } from '$lib/windows.svelte';

  import AddGames from './AddGames.svelte';
  import GameArt from './GameArt.svelte';
  import GameEdit from './GameEdit.svelte';

  const cfg = $derived(config.current);

  // The library, the window watcher and the play clock all belong to the panel:
  // while this module is off, none of them exist.
  $effect(() => games.acquire());

  // Read as their own deriveds so these effects re-run when the *setting*
  // changes rather than on every write to any setting.
  const autoDetect = $derived(cfg.gamesAutoDetect);
  const tracking = $derived(cfg.gamesTrackPlaytime);
  const deepScan = $derived(cfg.gamesDeepScan);
  const scanRunning = $derived(cfg.gamesScanRunning);
  $effect(() => games.setAutoDetect(autoDetect));
  $effect(() => {
    games.tracking = tracking;
  });
  $effect(() => {
    games.deepScan = deepScan;
  });
  $effect(() => {
    games.scanRunning = scanRunning;
  });

  let query = $state('');
  let showHidden = $state(false);

  const hiddenCount = $derived(games.all.filter((game) => game.hidden).length);

  const listed = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    // Two independent filters, so each switch means exactly one thing: hidden
    // entries need the panel's own chip, uninstalled ones need the setting.
    const list = games.all.filter(
      (game) =>
        (game.hidden ? showHidden : true) &&
        (game.missing ? cfg.gamesShowMissing : true) &&
        (!needle || displayName(game).toLowerCase().includes(needle)),
    );
    return sortGames(list, cfg.gamesSort, cfg.gamesFavouritesFirst);
  });

  /** One section per store when grouping is on, otherwise the whole library. */
  const groups = $derived.by(() => {
    if (!cfg.gamesGroupByLauncher) return [{ id: 'all', label: '', entries: listed }];
    const byLauncher = new Map<string, GameEntry[]>();
    for (const game of listed) {
      const id = launcherOf(game).id;
      const bucket = byLauncher.get(id);
      if (bucket) bucket.push(game);
      else byLauncher.set(id, [game]);
    }
    return LAUNCHER_ORDER.filter((id) => byLauncher.has(id)).map((id) => ({
      id,
      label: LAUNCHERS[id].label,
      entries: byLauncher.get(id) ?? [],
    }));
  });

  const ratio = $derived(
    cfg.gamesArtShape === 'portrait' ? '2 / 3' : cfg.gamesArtShape === 'wide' ? '16 / 9' : '1',
  );

  /** Play time and when it was last played, as one line under the title. */
  function subtitle(game: GameEntry): string {
    const parts: string[] = [];
    const played = formatPlaytime(game.minutes);
    const last = formatLastPlayed(game.lastPlayed);
    if (played) parts.push(played);
    if (last) parts.push(last);
    if (!parts.length && game.missing) return 'not installed';
    if (!parts.length) return 'never played';
    return parts.join(' · ');
  }

  /** The store and the stats as one line, for a list row. */
  function rowSubtitle(game: GameEntry): string {
    return cfg.gamesShowLauncher
      ? `${launcherOf(game).label} · ${subtitle(game)}`
      : subtitle(game);
  }

  /** Everything the tile cannot show, on one hover. */
  function tooltip(game: GameEntry): string {
    return `${displayName(game)}\n${launcherOf(game).label} · ${subtitle(game)}`;
  }

  /** A click plays the game - or brings it forward when it is already up. */
  function activate(game: GameEntry): void {
    const window = games.windowFor(game);
    if (window) void activateWindow(window.hwnd, displayName(game));
    else games.play(game.id);
  }

  function addGames(tab: 'apps' | 'found' | 'link' = 'apps'): void {
    overlay.openDialog(AddGames, { tab, onclose: () => overlay.closeDialog() });
  }

  function editGame(game: GameEntry): void {
    overlay.openDialog(GameEdit, { id: game.id, onclose: () => overlay.closeDialog() });
  }

  async function pickArt(game: GameEntry): Promise<void> {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (typeof picked === 'string') games.update(game.id, { art: picked });
  }

  function itemMenu(game: GameEntry): MenuItem[] {
    const running = games.isRunning(game.id);
    return [
      { label: displayName(game), header: true },
      running
        ? { label: 'Switch to it', action: () => activate(game) }
        : { label: 'Play', action: () => games.play(game.id) },
      {
        label: game.favourite ? 'Remove from favourites' : 'Add to favourites',
        action: () => games.toggleFavourite(game.id),
      },
      menuSeparator,
      { label: 'Choose cover art...', action: () => void pickArt(game) },
      {
        label: 'Remove cover art',
        disabled: !game.art,
        action: () => games.update(game.id, { art: null }),
      },
      { label: 'Edit...', action: () => editGame(game) },
      {
        label: 'Show in Explorer',
        disabled: game.kind !== 'app',
        action: () => void revealInExplorer(game.target),
      },
      menuSeparator,
      {
        label: 'Forget the linked program',
        hint: game.exePath ? baseName(game.exePath) : undefined,
        disabled: !game.exePath,
        action: () => games.update(game.id, { exePath: null }),
      },
      {
        label: 'Reset play time',
        disabled: !game.minutes && !game.launches,
        action: () => games.clearStats(game.id),
      },
      menuSeparator,
      game.hidden
        ? { label: 'Show in the list', action: () => games.setHidden(game.id, false) }
        : { label: 'Hide from the list', action: () => games.setHidden(game.id, true) },
      {
        label: 'Remove',
        danger: true,
        // Removing something detection found only lasts until the next scan;
        // hiding is what makes it stay gone.
        hint: game.source === 'detected' && !game.missing ? 'until the next scan' : undefined,
        action: () => games.remove(game.id),
      },
    ];
  }
</script>

<div
  class="m-body games"
  data-no-drag
  style:--tile="{cfg.gamesTileSize}px"
  style:--art-ratio={ratio}
  style:--art-radius="{Math.min(cfg.cornerRadius, 14)}px"
>
  <div class="bar">
    {#if cfg.gamesShowSearch}
      <input
        class="search"
        bind:value={query}
        placeholder="Search {games.all.length} games..."
        aria-label="Search games"
      />
    {:else}
      <span class="m-sub count">{listed.length} games</span>
    {/if}

    {#if games.suggestions.length}
      <button
        class="chip found"
        title="{games.suggestions.length} more programs looked like games"
        onclick={() => addGames('found')}
      >
        {games.suggestions.length} found
      </button>
    {/if}

    {#if games.duplicateCount}
      <button
        class="chip dupes"
        title="The same game was found more than once - by a shortcut and by the process it started, say. This folds them into one entry, keeping whichever one you have renamed, given a cover or starred."
        onclick={() => games.mergeDuplicates()}
      >
        {games.duplicateCount} duplicate{games.duplicateCount === 1 ? '' : 's'}
      </button>
    {/if}

    {#if hiddenCount}
      <button
        class="chip"
        class:on={showHidden}
        title={showHidden ? 'Hide them again' : 'Show hidden games'}
        onclick={() => (showHidden = !showHidden)}
      >
        {hiddenCount} hidden
      </button>
    {/if}

    <button class="tool" title="Add games..." aria-label="Add games" onclick={() => addGames()}>
      &plus;
    </button>
    <button
      class="tool"
      class:busy={games.scanning}
      title={games.scanning
        ? `Reading ${games.scanStep ?? '...'}`
        : cfg.gamesAutoDetect
          ? 'Search for games again'
          : 'Detection is off in settings'}
      aria-label="Search for games"
      disabled={games.scanning}
      onclick={() => void games.scan()}
    >
      &#8635;
    </button>
  </div>

  {#if games.scanning && games.scanStep}
    <p class="scanning">Searching {games.scanStep}...</p>
  {/if}

  {#if !listed.length}
    <p class="m-empty">
      {#if games.scanning}
        Searching {games.scanStep ?? 'this machine'}...
      {:else if query.trim()}
        Nothing matches that.
      {:else if games.all.length}
        Nothing to show: every game is hidden or uninstalled.
      {:else if cfg.gamesAutoDetect}
        Nothing found yet. Add games by hand with &plus;, or start one and it will be picked up.
      {:else}
        Detection is off. Add games by hand with &plus;.
      {/if}
    </p>
  {:else}
    <div class="scroll">
      {#each groups as group (group.id)}
        {#if group.label}
          <h3 class="group">{group.label} <span class="m-muted">{group.entries.length}</span></h3>
        {/if}

        {#if cfg.gamesLayout === 'list'}
          <ul class="rows">
            {#each group.entries as game (game.id)}
              {@const running = cfg.gamesShowRunning && games.isRunning(game.id)}
              <li class="m-row m-click row" class:dim={game.hidden || game.missing}>
                <button
                  class="hit"
                  title={displayName(game)}
                  onclick={() => activate(game)}
                  oncontextmenu={(e) => overlay.openMenu(e, itemMenu(game))}
                >
                  <GameArt {game} style={cfg.gamesArtStyle} fixed={22} />
                  <span class="m-text">
                    <span class="m-title">
                      {#if game.favourite}<span class="star" aria-hidden="true">&#9733;</span>{/if}
                      {displayName(game)}
                    </span>
                    {#if cfg.gamesShowStats}
                      <span class="m-sub">{rowSubtitle(game)}</span>
                    {/if}
                  </span>
                </button>
                {#if running}<span class="dot" title="Running"></span>{/if}
                <button
                  class="m-quiet"
                  aria-label="{displayName(game)} options"
                  title="Options"
                  onclick={(e) => overlay.openMenu(e, itemMenu(game))}
                >
                  &#8943;
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="tiles" class:strip={cfg.gamesLayout === 'shelf'}>
            {#each group.entries as game (game.id)}
              {@const running = cfg.gamesShowRunning && games.isRunning(game.id)}
              <div
                class="tile"
                class:zoom={cfg.gamesHoverZoom}
                class:dim={game.hidden || game.missing}
              >
                <button
                  class="hit"
                  title={tooltip(game)}
                  onclick={() => activate(game)}
                  oncontextmenu={(e) => overlay.openMenu(e, itemMenu(game))}
                >
                  <GameArt {game} style={cfg.gamesArtStyle} />

                  <span class="overlay" aria-hidden="true">
                    {#if cfg.gamesShowLauncher}
                      <span class="badge" style:--hue={launcherOf(game).hue}>
                        {launcherOf(game).label}
                      </span>
                    {/if}
                    {#if game.favourite}<span class="star tile-star">&#9733;</span>{/if}
                    {#if running}<span class="dot"></span>{/if}
                  </span>

                  {#if cfg.gamesLabelMode === 'hover'}
                    <span class="caption">
                      <span class="caption-name">{displayName(game)}</span>
                      {#if cfg.gamesShowStats}<span class="caption-sub">{subtitle(game)}</span>{/if}
                    </span>
                  {/if}
                </button>

                <button
                  class="more"
                  aria-label="{displayName(game)} options"
                  title="Options"
                  onclick={(e) => overlay.openMenu(e, itemMenu(game))}
                >
                  &#8943;
                </button>

                {#if cfg.gamesLabelMode === 'always'}
                  <span class="name">{displayName(game)}</span>
                  {#if cfg.gamesShowStats}<span class="sub">{subtitle(game)}</span>{/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .games {
    gap: 6px;
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .search {
    flex: 1;
    min-width: 0;
  }

  .count {
    flex: 1;
  }

  .tool {
    flex: none;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: calc(6px * var(--round, 1));
    font-size: calc(13px * var(--text-scale, 1));
    line-height: 1;
    cursor: pointer;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 20%, transparent);
  }

  .tool:hover:not(:disabled) {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 38%, transparent);
  }

  .tool.busy {
    opacity: 0.6;
  }

  .chip {
    flex: none;
    padding: 2px 7px;
    border: 0;
    border-radius: calc(999px * var(--round, 1));
    font: inherit;
    font-size: calc(10px * var(--text-scale, 1));
    cursor: pointer;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .chip.found {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--accent, #7aa2f7) 30%, transparent);
  }

  /* Amber rather than the accent: this one is pointing out a mess, not
     offering something new. It goes when there is nothing left to merge. */
  .chip.dupes {
    color: var(--color-yellow-400, #facc15);
    background: color-mix(in oklab, var(--color-yellow-400, #facc15) 20%, transparent);
  }

  .scanning {
    flex: none;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .chip.on {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--accent, #7aa2f7) 40%, transparent);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    margin: 0 -6px;
    padding: 0 6px;
  }

  .group {
    padding: 6px 0 4px;
    font-size: calc(9px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--panel-fg-muted);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr));
    gap: 10px 8px;
    padding-bottom: 4px;
  }

  /* A shelf is one row that scrolls sideways, so the tiles keep their size. */
  .tiles.strip {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    padding-bottom: 8px;
  }

  .tiles.strip .tile {
    width: var(--tile);
    flex: none;
  }

  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .tile.dim {
    opacity: 0.45;
  }

  .hit {
    display: block;
    position: relative;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--art-radius, 10px);
  }

  .tile.zoom .hit {
    transition:
      translate var(--dur-slow) var(--ease-spring),
      scale var(--dur-slow) var(--ease-spring),
      box-shadow var(--dur) var(--ease);
  }

  /* Cover art lifts off the shelf on a spring, and dips under a press. */
  .tile.zoom .hit:hover,
  .tile.zoom .hit:focus-visible {
    translate: 0 -3px;
    scale: 1.045;
    box-shadow: 0 12px 26px rgb(0 0 0 / 0.42);
  }

  .tile.zoom .hit:active {
    scale: 0.97;
    transition-duration: var(--dur-fast);
  }

  .hit:focus-visible {
    outline: 2px solid var(--accent, #7aa2f7);
    outline-offset: 2px;
  }

  /* Badges float over the art rather than taking room from it. */
  .overlay {
    position: absolute;
    inset: 4px;
    display: flex;
    align-items: flex-start;
    gap: 4px;
    pointer-events: none;
  }

  .badge {
    max-width: 100%;
    padding: 1px 5px;
    border-radius: calc(999px * var(--round, 1));
    font-size: calc(9px * var(--text-scale, 1));
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #fff;
    background: hsl(var(--hue) 55% 34% / 0.86);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
  }

  .star {
    color: #ffd166;
  }

  .tile-star {
    margin-left: auto;
    font-size: calc(11px * var(--text-scale, 1));
    line-height: 1;
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.6);
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    margin-left: auto;
    border-radius: 50%;
    background: #4ade80;
    box-shadow: 0 0 0 2px rgb(0 0 0 / 0.35);
  }

  .tile-star + .dot {
    margin-left: 4px;
  }

  /* The hover caption sits on the art, so nothing shifts when it appears. */
  .caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 14px 6px 5px;
    border-radius: 0 0 var(--art-radius, 10px) var(--art-radius, 10px);
    background: linear-gradient(to top, rgb(0 0 0 / 0.85), transparent);
    opacity: 0;
    transition: opacity 0.14s ease;
  }

  .hit:hover .caption,
  .hit:focus-visible .caption {
    opacity: 1;
  }

  .caption-name {
    font-size: calc(11px * var(--text-scale, 1));
    font-weight: 600;
    line-height: 1.2;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caption-sub {
    font-size: calc(9px * var(--text-scale, 1));
    color: rgb(255 255 255 / 0.72);
  }

  .name {
    font-size: calc(11px * var(--text-scale, 1));
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    font-size: calc(9px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .more {
    position: absolute;
    right: 3px;
    bottom: auto;
    top: 3px;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: calc(6px * var(--round, 1));
    font-size: calc(12px * var(--text-scale, 1));
    line-height: 1;
    cursor: pointer;
    color: #fff;
    background: rgb(0 0 0 / 0.55);
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .tile:hover .more,
  .more:focus-visible {
    opacity: 1;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    list-style: none;
  }

  .row.dim {
    opacity: 0.5;
  }

  .row .hit {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: 0;
  }

  .row .dot {
    margin-left: 0;
  }
</style>
