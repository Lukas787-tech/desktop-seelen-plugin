<script lang="ts">
  import { icons } from '$lib/icons.svelte';
  import { artHues, coverUrl, initials, type GameEntry } from '$lib/games.svelte';

  interface Props {
    game: GameEntry;
    /** How a game with no cover image of its own is drawn. */
    style: 'auto' | 'icon' | 'plain';
    /** A fixed square size in pixels; otherwise the tile's width and shape. */
    fixed?: number | null;
  }

  let { game, style, fixed = null }: Props = $props();

  /**
   * The cover that would not load.
   *
   * A user-chosen image is served through the asset protocol, and that protocol
   * serves some trees and refuses others - `Program Files` and `Downloads` are
   * both refused, measured. There is no way to ask in advance, so the image is
   * tried and the tile falls back to its generated art when the load fails,
   * rather than leaving an empty box where the cover should be.
   */
  let failedArt = $state<string | null>(null);

  const cover = $derived(game.art && failedArt !== game.art ? coverUrl(game) : null);
  const hues = $derived(artHues(game));

  const iconSrc = $derived.by(() => {
    if (style === 'plain') return null;
    const path = game.iconKey ?? (game.kind === 'app' ? game.target : null);
    if (!path && !game.umid) return null;
    return icons.resolve({ path, umid: game.umid });
  });
</script>

<div
  class="art"
  class:neutral={style === 'icon' && !cover}
  class:fixed={fixed !== null}
  style:--from={hues.from}
  style:--to={hues.to}
  style:width={fixed !== null ? `${fixed}px` : null}
>
  {#if cover}
    <img class="cover" src={cover} alt="" draggable="false" onerror={() => (failedArt = game.art ?? null)} />
  {:else if iconSrc}
    <img class="icon" src={iconSrc} alt="" draggable="false" />
  {:else}
    <span class="initials">{initials(game)}</span>
  {/if}
</div>

<style>
  .art {
    position: relative;
    width: 100%;
    aspect-ratio: var(--art-ratio, 1);
    border-radius: var(--art-radius, 10px);
    overflow: hidden;
    display: grid;
    place-items: center;
    /* Sized in container units below, so one tile scales the whole thing. */
    container-type: size;
    background: linear-gradient(
      152deg,
      hsl(var(--from) 58% 44%) 0%,
      hsl(var(--to) 62% 22%) 100%
    );
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.09);
  }

  .art.fixed {
    aspect-ratio: 1;
    flex: none;
  }

  /* "Icon only": no colour of its own, so the icon carries the tile. */
  .art.neutral {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* The floors keep a 22px list tile legible; the tiles scale from there. */
  .icon {
    width: max(14px, min(48cqw, 48cqh));
    height: max(14px, min(48cqw, 48cqh));
    object-fit: contain;
    filter: drop-shadow(0 2px 5px rgb(0 0 0 / 0.45));
  }

  .initials {
    font-size: max(9px, min(30cqw, 34cqh));
    font-weight: 650;
    letter-spacing: 0.02em;
    color: #fff;
    opacity: 0.92;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  }
</style>
