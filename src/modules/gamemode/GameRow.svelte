<script lang="ts">
  import { config } from '$lib/config.svelte';
  import type { GameEntry } from '$lib/games.svelte';

  import GameTile from './GameTile.svelte';

  interface Props {
    id: string;
    label: string;
    games: readonly GameEntry[];
    /** The first tile of the first row takes the selection when a section opens. */
    autofocus?: boolean;
    /** Shown in place of the tiles when the row is empty but worth keeping. */
    empty?: string;
  }

  let { id, label, games, autofocus = false, empty }: Props = $props();

  const cfg = $derived(config.current);
</script>

<!--
  A shelf.

  It scrolls sideways and the selection is what scrolls it - there is no
  scrollbar to grab and no arrows to click, because a controller has neither.
  The row still overflows rather than wrapping, so `scrollIntoView` on the
  selected tile is the only thing that ever moves it.
-->
<section class="row" aria-label={label}>
  <h2>
    {label}
    {#if games.length}<span class="count">{games.length}</span>{/if}
  </h2>

  {#if games.length}
    <div class="strip" class:grid={cfg.gameModeLayout !== 'shelf'}>
      {#each games as game, i (game.id)}
        <GameTile {game} row={id} autofocus={autofocus && i === 0} />
      {/each}
    </div>
  {:else if empty}
    <p class="empty">{empty}</p>
  {/if}
</section>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h2 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
    padding-inline: 4px;
    font-family: var(--display-font);
    font-size: calc(19px * var(--text-scale, 1));
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .count {
    font-size: calc(13px * var(--text-scale, 1));
    font-weight: 400;
    color: var(--panel-fg-muted);
  }

  .strip {
    display: flex;
    gap: 22px;
    /*
     * Room for the selected tile's lift.
     *
     * It scales 9% about its own centre, so the first tile of a row grows
     * about nine pixels to the *left* of where it sits - past the scroller's
     * own edge, where its title was being cut in half. The padding gives it
     * that room and the negative margin puts the row's first tile back in line
     * with the heading above it.
     */
    padding: 14px 20px 22px;
    margin-inline: -16px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  /* "Grid" and "wall" wrap instead of scrolling: the whole library at once, and
     the selection walks it in two dimensions. */
  .strip.grid {
    flex-wrap: wrap;
    overflow-x: hidden;
  }

  .empty {
    margin: 0;
    padding: 18px 4px 24px;
    font-size: calc(14px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }
</style>
