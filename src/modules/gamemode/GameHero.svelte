<script lang="ts">
  import { config } from '$lib/config.svelte';
  import {
    displayName,
    formatLastPlayed,
    formatPlaytime,
    games,
    launcherOf,
    type GameEntry,
  } from '$lib/games.svelte';
  import { blurbs } from '$lib/blurbs.svelte';
  import { gameMode, navItem } from '$lib/gamemode.svelte';

  interface Props {
    game: GameEntry | null;
    /** Total in the library, shown when nothing is selected yet. */
    total: number;
  }

  let { game, total }: Props = $props();

  const cfg = $derived(config.current);
  const running = $derived(game ? games.isRunning(game.id) : false);
  const played = $derived(formatPlaytime(game?.minutes));
  const last = $derived(formatLastPlayed(game?.lastPlayed));

  /* Written by a model and cached on disk; absent until it has been asked for. */
  $effect(() => void blurbs.load());
  const blurb = $derived(game && cfg.gameModeShowBlurb ? blurbs.get(displayName(game)) : null);
</script>

<!--
  The selected game, written large.

  It is a caption for the backdrop rather than a panel of its own: the backdrop
  is already this game's art, and putting a box over it would hide the thing it
  describes. So no `.panel`, no fill - just text with enough shadow to stay
  legible over whatever the art turns out to be.
-->
<header class="hero" class:empty={!game}>
  {#if game}
    <p class="eyebrow">
      {launcherOf(game).label}
      {#if running}<span class="live">Running</span>{/if}
      {#if game.missing}<span class="warn">Not installed</span>{/if}
    </p>

    <h1>{displayName(game)}</h1>

    {#if blurb}
      <p class="blurb">{blurb}</p>
    {/if}

    {#if cfg.gameModeShowStats}
      <p class="facts">
        {#if played}<span>{played} played</span>{/if}
        {#if last}<span>Last played {last}</span>{/if}
        {#if !played && !last}<span>Never played</span>{/if}
        {#if game.launches}<span>{game.launches} launches</span>{/if}
      </p>
    {/if}

    <div class="actions">
      <button
        class="play"
        use:navItem={{ id: 'hero:play', group: 'hero', onactivate: () => gameMode.play(game.id) }}
        class:selected={gameMode.focusId === 'hero:play'}
        onclick={() => gameMode.play(game.id)}
        onpointerenter={() => gameMode.focus('hero:play')}
      >
        {running ? 'Switch to it' : 'Play'}
      </button>

      <button
        class="ghost"
        use:navItem={{ id: 'hero:details', group: 'hero', onactivate: () => (gameMode.detailsFor = game.id) }}
        class:selected={gameMode.focusId === 'hero:details'}
        onclick={() => (gameMode.detailsFor = game.id)}
        onpointerenter={() => gameMode.focus('hero:details')}
      >
        Details
      </button>

      <button
        class="ghost"
        use:navItem={{ id: 'hero:fav', group: 'hero', onactivate: () => games.toggleFavourite(game.id) }}
        class:selected={gameMode.focusId === 'hero:fav'}
        onclick={() => games.toggleFavourite(game.id)}
        onpointerenter={() => gameMode.focus('hero:fav')}
      >
        {game.favourite ? '★ Favourite' : '☆ Favourite'}
      </button>
    </div>
  {:else}
    <h1>{total ? 'Pick a game' : 'No games yet'}</h1>
    <p class="facts">
      <span>
        {total
          ? 'Move with the d-pad or the left stick.'
          : 'Games are found from the Start Menu, your download folders and whatever is seen running. Open the Games module on the desktop to scan.'}
      </span>
    </p>
  {/if}
</header>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 4px 4px;
    max-width: min(760px, 52vw);
    /*
     * Legibility over a wallpaper, in the scheme's own ground rather than in
     * black: on a light scheme a black glow behind dark text is a smudge, and
     * the ground is exactly the colour the text needs separating from.
     */
    text-shadow: 0 2px 14px var(--panel-ground);
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: calc(13px * var(--text-scale, 1));
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--panel-fg-muted);
  }

  /*
   * Tinted rather than filled: a solid hue needs text picked to contrast with
   * it, and the one colour that is certain to contrast with the scheme's own
   * background is the hue itself over a wash of it.
   */
  .live,
  .warn {
    padding: 2px 9px;
    border-radius: 999px;
    font-size: calc(11px * var(--text-scale, 1));
    letter-spacing: 0.04em;
    text-shadow: none;
    color: var(--color-green-400, #4ade80);
    background: color-mix(in oklab, var(--color-green-400, #4ade80) 22%, transparent);
  }

  .warn {
    color: var(--color-yellow-400, #facc15);
    background: color-mix(in oklab, var(--color-yellow-400, #facc15) 22%, transparent);
  }

  h1 {
    margin: 0;
    font-family: var(--display-font);
    /* Scales with the display rather than with the text setting: this is the
       one line meant to be read from a sofa. */
    font-size: clamp(34px, 3.6vw, 64px);
    font-weight: var(--display-weight, 200);
    line-height: 1.05;
    letter-spacing: -0.01em;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 0;
    font-size: calc(15px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .blurb {
    margin: 2px 0 0;
    max-width: 62ch;
    font-size: calc(16px * var(--text-scale, 1));
    line-height: 1.5;
    color: var(--panel-fg);
    opacity: 0.86;
  }

  .actions {
    display: flex;
    gap: 12px;
    margin-top: 10px;
  }

  .play,
  .ghost {
    padding: 12px 30px;
    cursor: pointer;
    font-size: calc(16px * var(--text-scale, 1));
    font-weight: 600;
    border-radius: calc(12px * var(--round, 1));
    text-shadow: none;
    transition:
      transform 160ms ease,
      box-shadow 160ms ease;
  }

  /*
   * The accent as a wash over the surface rather than as a fill, which is what
   * every other primary button in this package does (`.m-btn.m-primary`). A
   * solid accent would need its own text colour chosen per scheme; a wash keeps
   * the panel's ink readable whatever the accent turns out to be.
   */
  .play {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--accent, #7aa2f7) 62%, transparent);
  }

  .play:hover {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 78%, transparent);
  }

  .ghost {
    color: var(--panel-fg);
    background: var(--gm-surface-strong);
    border: var(--gm-edge);
    backdrop-filter: blur(8px);
  }

  .play.selected,
  .ghost.selected {
    transform: translateY(-2px);
    box-shadow:
      var(--gm-ring),
      0 10px 26px color-mix(in oklab, var(--panel-ground) 70%, transparent);
  }

  .hero.empty {
    max-width: min(640px, 60vw);
  }
</style>
