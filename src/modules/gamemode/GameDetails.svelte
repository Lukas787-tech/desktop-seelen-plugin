<script lang="ts">
  import { config } from '$lib/config.svelte';
  import {
    coverUrl,
    displayName,
    formatLastPlayed,
    formatPlaytime,
    games,
    initials,
    launcherOf,
  } from '$lib/games.svelte';
  import { blurbs } from '$lib/blurbs.svelte';
  import { gameMode, navItem } from '$lib/gamemode.svelte';
  import { icons } from '$lib/icons.svelte';
  import { naturalSize } from '$lib/iconsize';
  import { revealInExplorer } from '$lib/launch.svelte';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const cfg = $derived(config.current);
  const game = $derived(games.find(id) ?? null);
  const running = $derived(game ? games.isRunning(game.id) : false);

  /**
   * Everything a tile cannot hold.
   *
   * Deliberately a short list: this is a screen operated from across a room, so
   * it offers the handful of things worth doing without a keyboard - play,
   * favourite, hide - and leaves renaming, cover art and the executable binding
   * to the desktop's own Games panel, which has a mouse and a file picker.
   */
  const rows = $derived.by(() => {
    if (!game) return [];
    const list: { id: string; label: string; value: string }[] = [
      { id: 'store', label: 'Store', value: launcherOf(game).label },
      { id: 'played', label: 'Play time', value: formatPlaytime(game.minutes) ?? 'never played' },
      { id: 'last', label: 'Last played', value: formatLastPlayed(game.lastPlayed) ?? '—' },
      { id: 'launches', label: 'Launches', value: String(game.launches ?? 0) },
      { id: 'target', label: 'Target', value: game.target },
    ];
    return list;
  });

  $effect(() => void blurbs.load());
  const blurb = $derived(game && cfg.gameModeShowBlurb ? blurbs.get(displayName(game)) : null);

  /* The same face a tile wears, larger: one surface, the icon on it. */
  const iconSrc = $derived(
    game ? icons.resolve({ path: game.iconKey ?? game.target, umid: game.umid }) : null,
  );
  const cover = $derived(game?.art ? coverUrl(game) : null);

  function close(): void {
    gameMode.detailsFor = null;
  }
</script>

{#if game}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="sheet panel" role="dialog" tabindex="-1" aria-label={displayName(game)} onclick={(e) => e.stopPropagation()}>
      <div class="face" style:--ratio={cfg.gameModeArtShape === 'wide' ? '16 / 9' : '1'}>
        {#if cover}
          <img class="cover" src={cover} alt="" draggable="false" />
        {:else if iconSrc}
          <img class="icon" src={iconSrc} alt="" draggable="false" use:naturalSize />
        {:else}
          <span class="initials">{initials(game)}</span>
        {/if}
      </div>

      <div class="body">
        <h2>{displayName(game)}</h2>

        {#if blurb}
          <p class="blurb">{blurb}</p>
        {/if}

        <dl>
          {#each rows as row (row.id)}
            <div>
              <dt>{row.label}</dt>
              <dd class:path={row.id === 'target'}>{row.value}</dd>
            </div>
          {/each}
        </dl>

        <div class="actions">
          <button
            class="primary"
            class:selected={gameMode.focusId === 'det:play'}
            use:navItem={{ id: 'det:play', group: 'details', autofocus: true, onactivate: () => gameMode.play(game.id) }}
            onclick={() => gameMode.play(game.id)}
            onpointerenter={() => gameMode.focus('det:play')}
          >
            {running ? 'Switch to it' : 'Play'}
          </button>

          <button
            class:selected={gameMode.focusId === 'det:fav'}
            use:navItem={{ id: 'det:fav', group: 'details', onactivate: () => games.toggleFavourite(game.id) }}
            onclick={() => games.toggleFavourite(game.id)}
            onpointerenter={() => gameMode.focus('det:fav')}
          >
            {game.favourite ? 'Remove from favourites' : 'Add to favourites'}
          </button>

          <button
            class:selected={gameMode.focusId === 'det:hide'}
            use:navItem={{
              id: 'det:hide',
              group: 'details',
              onactivate: () => {
                games.setHidden(game.id, !game.hidden);
                gameMode.say(game.hidden ? 'Hidden from the library' : 'Back in the library');
                close();
              },
            }}
            onclick={() => {
              games.setHidden(game.id, !game.hidden);
              close();
            }}
            onpointerenter={() => gameMode.focus('det:hide')}
          >
            {game.hidden ? 'Show in the library' : 'Hide from the library'}
          </button>

          <button
            class:selected={gameMode.focusId === 'det:reveal'}
            use:navItem={{ id: 'det:reveal', group: 'details', onactivate: () => void revealInExplorer(game.target) }}
            onclick={() => void revealInExplorer(game.target)}
            onpointerenter={() => gameMode.focus('det:reveal')}
          >
            Show in Explorer
          </button>

          <button
            class:selected={gameMode.focusId === 'det:close'}
            use:navItem={{ id: 'det:close', group: 'details', onactivate: close }}
            onclick={close}
            onpointerenter={() => gameMode.focus('det:close')}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    /* The scheme's ground, so a light theme dims rather than blacks out. */
    background: color-mix(in oklab, var(--panel-ground) 72%, transparent);
    backdrop-filter: blur(6px);
  }

  .sheet {
    display: flex;
    gap: 28px;
    padding: 28px;
    width: min(880px, 76vw);
    max-height: 78vh;
  }

  .face {
    flex: none;
    width: 200px;
    aspect-ratio: var(--ratio, 1);
    display: grid;
    place-items: center;
    container-type: size;
    overflow: hidden;
    border-radius: var(--surface-radius, 14px);
    background: var(--gm-surface);
    border: var(--gm-edge);
  }

  .face .cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* As on a tile: no icon is drawn bigger than it is. See `iconsize.ts`. */
  .face .icon {
    width: min(46cqw, 46cqh, var(--natural, 100%));
    height: min(46cqw, 46cqh, var(--natural, 100%));
    object-fit: contain;
  }

  .face .initials {
    font-family: var(--display-font);
    font-size: min(26cqw, 30cqh);
    font-weight: 600;
    color: var(--panel-fg-muted);
  }

  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: auto;
  }

  h2 {
    margin: 0;
    font-family: var(--display-font);
    font-size: calc(30px * var(--text-scale, 1));
    font-weight: 600;
    line-height: 1.1;
  }

  .blurb {
    margin: 0;
    font-size: calc(15px * var(--text-scale, 1));
    line-height: 1.5;
    color: var(--panel-fg);
    opacity: 0.86;
  }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 20px;
    margin: 0;
    font-size: calc(14px * var(--text-scale, 1));
  }

  dl > div {
    display: contents;
  }

  dt {
    color: var(--panel-fg-muted);
  }

  dd {
    margin: 0;
    min-width: 0;
  }

  /* A target is a path, and a path is the one value here that will not fit. */
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: auto;
    padding-top: 8px;
  }

  .actions button {
    padding: 11px 20px;
    cursor: pointer;
    font-size: calc(14px * var(--text-scale, 1));
    font-weight: 600;
    border-radius: var(--gm-pill);
    background: var(--gm-surface-strong);
    border: var(--gm-edge);
    transition:
      background 140ms ease,
      box-shadow 140ms ease;
  }

  .actions button.primary {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 62%, transparent);
  }

  .actions button.selected {
    box-shadow: var(--gm-ring);
  }
</style>
