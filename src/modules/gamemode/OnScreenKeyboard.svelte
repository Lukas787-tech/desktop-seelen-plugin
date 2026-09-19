<script lang="ts">
  import { gameMode, navItem } from '$lib/gamemode.svelte';
  import { pad } from '$lib/gamepad.svelte';

  /**
   * Text entry for a controller.
   *
   * It writes into `gameMode.query` directly rather than synthesising key
   * presses at the search field. That is not a shortcut - a `KeyboardEvent`
   * built in script carries `isTrusted: false`, and the browser performs no
   * default action for an untrusted event, so a dispatched "s" would reach
   * every handler on the page and still leave the field empty. Setting the
   * value is the only thing that actually types.
   */

  const ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-'],
  ];

  let shift = $state(false);

  function type(char: string): void {
    gameMode.query += shift ? char.toUpperCase() : char;
    // One-shot, like a phone keyboard: a capital is almost always the first
    // letter and nothing else.
    shift = false;
    pad.buzzPrimary(0.25, 35);
  }

  function backspace(): void {
    gameMode.query = gameMode.query.slice(0, -1);
    pad.buzzPrimary(0.25, 35);
  }
</script>

<div class="osk panel" role="group" aria-label="On-screen keyboard">
  <div class="preview">
    <span class="typed">{gameMode.query || 'Search games'}</span>
    <span class="caret" aria-hidden="true"></span>
  </div>

  {#each ROWS as row, r (r)}
    <div class="krow">
      {#each row as char (char)}
        <button
          class="key"
          class:selected={gameMode.focusId === `osk:${char}`}
          use:navItem={{ id: `osk:${char}`, group: 'osk', onactivate: () => type(char), autofocus: r === 1 && char === 'q' }}
          onclick={() => type(char)}
          onpointerenter={() => gameMode.focus(`osk:${char}`)}
        >
          {shift ? char.toUpperCase() : char}
        </button>
      {/each}
    </div>
  {/each}

  <div class="krow">
    <button
      class="key wide"
      class:on={shift}
      class:selected={gameMode.focusId === 'osk:shift'}
      use:navItem={{ id: 'osk:shift', group: 'osk', onactivate: () => (shift = !shift) }}
      onclick={() => (shift = !shift)}
      onpointerenter={() => gameMode.focus('osk:shift')}
    >
      Shift
    </button>
    <button
      class="key space"
      class:selected={gameMode.focusId === 'osk:space'}
      use:navItem={{ id: 'osk:space', group: 'osk', onactivate: () => type(' ') }}
      onclick={() => type(' ')}
      onpointerenter={() => gameMode.focus('osk:space')}
    >
      Space
    </button>
    <button
      class="key wide"
      class:selected={gameMode.focusId === 'osk:back'}
      use:navItem={{ id: 'osk:back', group: 'osk', onactivate: backspace }}
      onclick={backspace}
      onpointerenter={() => gameMode.focus('osk:back')}
    >
      Delete
    </button>
    <button
      class="key wide done"
      class:selected={gameMode.focusId === 'osk:done'}
      use:navItem={{ id: 'osk:done', group: 'osk', onactivate: () => (gameMode.keyboard = false) }}
      onclick={() => (gameMode.keyboard = false)}
      onpointerenter={() => gameMode.focus('osk:done')}
    >
      Done
    </button>
  </div>
</div>

<style>
  .osk {
    position: absolute;
    left: 50%;
    bottom: 96px;
    translate: -50% 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 18px;
    width: min(760px, 78vw);
  }

  .preview {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 6px;
    padding: 10px 14px;
    border-radius: var(--gm-radius);
    background: var(--gm-surface-strong);
    border: var(--gm-edge);
    font-size: calc(18px * var(--text-scale, 1));
  }

  .typed {
    white-space: pre;
  }

  .caret {
    width: 2px;
    height: 1.1em;
    background: var(--accent, #7aa2f7);
    animation: blink 1.1s steps(1) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .krow {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .key {
    flex: 1;
    min-width: 0;
    height: 52px;
    display: grid;
    place-items: center;
    cursor: pointer;
    font-size: calc(17px * var(--text-scale, 1));
    border-radius: var(--gm-radius);
    background: var(--gm-surface);
    border: var(--gm-edge);
    transition:
      background 120ms ease,
      box-shadow 120ms ease;
  }

  .key.wide {
    flex: 1.6;
    font-size: calc(14px * var(--text-scale, 1));
  }

  .key.space {
    flex: 4;
    font-size: calc(14px * var(--text-scale, 1));
  }

  .key:hover {
    background: var(--gm-surface-strong);
  }

  .key.on {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 40%, transparent);
  }

  .key.done {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 30%, transparent);
  }

  /* The selection ring, not a focus ring: the DOM focus stays wherever the host
     put it, and this is what the controller is actually on. */
  .key.selected {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 62%, transparent);
    box-shadow: var(--gm-ring);
  }
</style>
