<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { coverUrl, displayName, formatPlaytime, games, initials, launcherOf, type GameEntry } from '$lib/games.svelte';
  import { gameMode, gameNavId, navItem } from '$lib/gamemode.svelte';
  import { icons } from '$lib/icons.svelte';
  import { naturalSize } from '$lib/iconsize';

  interface Props {
    game: GameEntry;
    /** Which row this tile is in; part of its navigation id. See `gameNavId`. */
    row: string;
    /** Take the selection on mount - the first tile of the first row. */
    autofocus?: boolean;
  }

  let { game, row, autofocus = false }: Props = $props();

  const cfg = $derived(config.current);
  const id = $derived(gameNavId(game.id, row));
  const selected = $derived(gameMode.focusId === id);
  const running = $derived(games.isRunning(game.id));

  const ratio = $derived(
    cfg.gameModeArtShape === 'portrait' ? '2 / 3' : cfg.gameModeArtShape === 'wide' ? '16 / 9' : '1',
  );

  /*
   * "Wall" is the same wrapped layout as "grid", drawn much larger - a screen
   * of a dozen tiles you can read across a room rather than a page of sixty.
   */
  const width = $derived(Math.round(cfg.gameModeTileSize * (cfg.gameModeLayout === 'wall' ? 1.7 : 1)));

  /**
   * The application's own icon, from Seelen's icon packs.
   *
   * `iconKey` is the shortcut the entry came from, which is what the packs
   * actually resolve; the target is the fallback for an entry that points
   * straight at an executable.
   */
  const iconSrc = $derived(icons.resolve({ path: game.iconKey ?? game.target, umid: game.umid }));

  /** A cover the user chose, shown only when they asked for covers. */
  let coverFailed = $state<string | null>(null);
  const cover = $derived(
    cfg.gameModeArtStyle === 'cover' && game.art && coverFailed !== game.art ? coverUrl(game) : null,
  );

  const played = $derived(formatPlaytime(game.minutes));
</script>

<!--
  One game.

  Every tile is the same surface - the panel material the rest of the desktop is
  made of - with the application's own icon on it and the title underneath.
  There is deliberately no colour per game: a shelf of forty differently tinted
  boxes is louder than the thing it is listing, and the icons are already what
  tells them apart. What marks the selected one is the accent, once, which is
  also the only place the accent appears on this screen.

  A real `button`, so it is reachable by keyboard and mouse exactly as it is by
  controller; `use:navItem` is what puts it on the pad's map.
-->
<button
  class="tile"
  class:selected
  class:still={!cfg.gameModeAnimate}
  style:--tile="{width}px"
  style:--ratio={ratio}
  use:navItem={{
    id,
    group: row,
    autofocus,
    onactivate: () => gameMode.play(game.id),
    ondetails: () => (gameMode.detailsFor = game.id),
  }}
  onclick={() => gameMode.play(game.id)}
  onpointerenter={() => gameMode.focus(id)}
  oncontextmenu={(e) => {
    e.preventDefault();
    gameMode.detailsFor = game.id;
  }}
  title={displayName(game)}
>
  <div class="face">
    {#if cover}
      <img class="cover" src={cover} alt="" draggable="false" onerror={() => (coverFailed = game.art ?? null)} />
    {:else if iconSrc && cfg.gameModeArtStyle !== 'plain'}
      <img class="icon" src={iconSrc} alt="" draggable="false" use:naturalSize />
    {:else}
      <span class="initials">{initials(game)}</span>
    {/if}

    {#if running}
      <span class="running" title="Running"></span>
    {/if}
    {#if game.favourite}
      <span class="star" aria-hidden="true">★</span>
    {/if}
  </div>

  <span class="name">{displayName(game)}</span>
  {#if cfg.gameModeShowStats}
    <span class="meta">{played ? `${played} · ` : ''}{launcherOf(game).label}</span>
  {/if}
</button>

<style>
  .tile {
    flex: none;
    width: var(--tile);
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 0;
    cursor: pointer;
    text-align: left;
    /* The scroll anchor: `scrollIntoView` lands the tile clear of the row's
       edge rather than flush against it. */
    scroll-margin: 90px;
    transition:
      transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1),
      opacity 220ms ease;
  }

  .tile.still {
    transition: none;
  }

  /*
   * The one surface every tile shares, composed the way `.panel` is - the
   * scheme's ground at the user's own opacity - so a shelf reads as the same
   * material as the module panels on the desktop behind it.
   */
  .face {
    position: relative;
    aspect-ratio: var(--ratio, 1);
    display: grid;
    place-items: center;
    border-radius: var(--surface-radius, 14px);
    /* The launcher's own surface tokens - see the block at the top of
       `GameMode.svelte`, which is where every fill on this screen comes from. */
    background: var(--gm-surface);
    border: var(--gm-edge);
    container-type: size;
    overflow: hidden;
    transition:
      border-color 200ms ease,
      box-shadow 200ms ease;
  }

  .tile.selected .face {
    border-color: var(--accent, #7aa2f7);
    box-shadow:
      var(--gm-ring),
      0 14px 34px color-mix(in oklab, var(--panel-ground) 65%, transparent);
  }

  .tile.selected {
    transform: scale(1.06);
    z-index: 2;
  }

  /* Unselected tiles step back, so one reads as "here" across a long shelf.
     Opacity rather than a brightness filter: a filter on a translucent surface
     darkens the wallpaper showing through it too. */
  .tile:not(.selected) {
    opacity: 0.66;
  }

  /*
   * Never larger than the file is: `--natural` is the icon's own pixel size,
   * published by `use:naturalSize`. See `src/lib/iconsize.ts` - an extracted
   * 32px icon blown up to fill a tile is the blur, and there is no bigger one
   * to ask the host for.
   */
  .icon {
    width: min(46cqw, 46cqh, var(--natural, 100%));
    height: min(46cqw, 46cqh, var(--natural, 100%));
    object-fit: contain;
  }

  .cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .initials {
    font-family: var(--display-font);
    font-size: min(26cqw, 30cqh);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--panel-fg-muted);
  }

  .running {
    position: absolute;
    top: 9px;
    left: 9px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-green-400, #4ade80);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--panel-ground) 80%, transparent);
  }

  .star {
    position: absolute;
    top: 7px;
    right: 9px;
    font-size: 14px;
    color: var(--color-yellow-400, #facc15);
  }

  .name {
    font-size: calc(15px * var(--text-scale, 1));
    font-weight: 600;
    line-height: 1.25;
    /* Two lines, then an ellipsis: a long title must not make one tile taller
       than its neighbours and push the row's baselines apart. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .meta {
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
