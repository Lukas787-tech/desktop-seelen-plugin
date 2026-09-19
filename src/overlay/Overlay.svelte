<script lang="ts">
  import { onMount } from 'svelte';
  import type { WidgetId } from '@seelen-ui/lib/types';

  import { displayName, formatPlaytime, games, launcherOf, type GameEntry } from '$lib/games.svelte';
  import { icons } from '$lib/icons.svelte';
  import { naturalSize } from '$lib/iconsize';
  import { pad } from '$lib/gamepad.svelte';
  import { parseBindings, glyphFor, resolveLayout, type PadAction, type PadLayout } from '$lib/gamepad';
  import { Disposables, SeelenCommand, Widget, invoke } from '$lib/seelen';
  import { activateWindow, closeWindow, openWindows, showDesktop, sortWindows } from '$lib/windows.svelte';

  /** The desktop surface, which the game-mode summon is addressed to. */
  const DESKTOP_WIDGET_ID = '@ralfm/desktop' as unknown as WidgetId;

  const widget = Widget.self;
  const disposables = new Disposables();

  /*
   * Everything this reads is read-only.
   *
   * `games.readOnly()` loads the library without watching windows: the play
   * clock belongs to the desktop surface, and a second process keeping its own
   * would double every session and write the file from under the first. The
   * window list comes straight from the host instead, which is also the only
   * thing this needs it for.
   */
  onMount(() => {
    void games.readOnly();
    // An icon pack that will not start costs this overlay its pictures and
    // nothing else, so it must not take the rest of it down with it.
    void icons
      .start()
      .then((off) => disposables.addFn(off))
      .catch(() => {});
    disposables.addFn(openWindows.acquire());
    disposables.addFn(pad.acquire());
    disposables.addFn(pad.listen((event) => onPad(event)));

    /*
     * Every summon starts at the top, whatever the last one left behind.
     *
     * The host shows a lazy widget itself when its trigger fires, so there is
     * nothing to show here - only the foreground to insist on, because a
     * controller is unreadable in a document that does not have focus.
     */
    widget.onTrigger(() => {
      at = 0;
      void widget.focus().catch(() => {});
    });

    return () => disposables.dispose();
  });

  const windows = $derived(sortWindows(openWindows.current).filter((w) => !w.isIconic));

  /**
   * The game you are in, if you are in one.
   *
   * Whatever was in the foreground last is what the overlay came up over, and
   * an entry in the library whose executable matches it is what that window is.
   * No match is the ordinary case for anything that is not a game, and then the
   * overlay simply has no title to show.
   */
  const front = $derived(windows[0] ?? null);
  const game = $derived.by<GameEntry | null>(() => {
    const exe = front?.process?.path?.toLowerCase();
    if (!exe) return null;
    return (
      games.all.find((one) => one.exePath?.toLowerCase() === exe || one.target.toLowerCase() === exe) ?? null
    );
  });

  const iconSrc = $derived(
    game
      ? icons.resolve({ path: game.iconKey ?? game.target, umid: game.umid })
      : front
        ? icons.resolve({ path: front.process?.path, umid: front.umid })
        : null,
  );

  /* ------------------------------------------------------------- clock -- */

  let now = $state(new Date());
  onMount(() => {
    const timer = setInterval(() => (now = new Date()), 20_000);
    return () => clearInterval(timer);
  });
  const clock = $derived(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));

  /* ----------------------------------------------------------- actions -- */

  interface Row {
    id: string;
    label: string;
    hint?: string;
    run: () => void;
  }

  function close(): void {
    widget.hide();
  }

  /** Closes first, so what is behind is back before the action lands on it. */
  function leave(run: () => void): void {
    close();
    run();
  }

  const rows = $derived.by<Row[]>(() => {
    const list: Row[] = [
      { id: 'back', label: front ? `Back to ${front.appName || front.title}` : 'Back', run: close },
      {
        id: 'gamemode',
        label: 'Open game mode',
        hint: 'The console launcher',
        run: () =>
          leave(() => {
            void invoke(SeelenCommand.TriggerWidget, {
              payload: { id: DESKTOP_WIDGET_ID, customArgs: { action: 'game-mode' } },
            }).catch(() => {});
          }),
      },
      {
        id: 'desktop',
        label: 'Show the desktop',
        hint: 'Minimise everything',
        run: () => leave(() => void showDesktop()),
      },
    ];

    if (front) {
      list.push({
        id: 'quit',
        label: `Close ${front.appName || front.title}`,
        hint: 'Asks the window to close',
        run: () => leave(() => closeWindow(front.hwnd)),
      });
    }

    /*
     * The other windows, by application name - with their own title as the
     * hint, because two windows of one editor are otherwise two identical rows
     * and picking between them is a guess.
     */
    for (const window of windows.slice(1, 7)) {
      const name = window.appName || window.title || 'Untitled';
      list.push({
        id: `win:${window.hwnd}`,
        label: name,
        hint: window.title && window.title !== name ? window.title : 'Switch to it',
        run: () => leave(() => void activateWindow(window.hwnd, name)),
      });
    }

    list.push({
      id: 'lock',
      label: 'Lock',
      run: () => leave(() => void invoke(SeelenCommand.Lock).catch(() => {})),
    });
    return list;
  });

  /* --------------------------------------------------------- selection -- */

  /*
   * One column, walked with an index.
   *
   * Deliberately not the launcher's spatial navigator (`navgrid.ts`): that one
   * exists because a section rail, a shelf and a settings column share a
   * screen and "down" has to be answered by measuring. This is a single list of
   * short rows, where "down" is the next one, and measuring rectangles to work
   * that out would be a more complicated way to get the same answer.
   */
  let at = $state(0);
  $effect(() => {
    if (at >= rows.length) at = Math.max(0, rows.length - 1);
  });

  function step(by: 1 | -1): void {
    if (!rows.length) return;
    at = (at + by + rows.length) % rows.length;
    pad.buzzPrimary(0.15, 25);
  }

  function activate(): void {
    const row = rows[at];
    if (!row) return;
    pad.buzzPrimary(0.5, 70);
    row.run();
  }

  const bindings = $derived(parseBindings(''));
  const layout = $derived<Exclude<PadLayout, 'auto'>>(resolveLayout('auto', pad.primary?.id ?? ''));

  function run(action: PadAction): void {
    if (action === 'up') step(-1);
    else if (action === 'down') step(1);
    else if (action === 'confirm') activate();
    else if (action === 'back' || action === 'quit') close();
  }

  /*
   * A release does nothing, and a button bound to more than one action runs
   * every one of them - which is how the reader reports a binding, and is what
   * the launcher does with the same events.
   */
  function onPad(event: { phase: 'press' | 'repeat' | 'release'; actions: PadAction[] }): void {
    if (event.phase === 'release') return;
    for (const action of event.actions) run(action);
  }

  function onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        step(-1);
        return;
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        step(1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate();
        return;
      case 'Escape':
        event.preventDefault();
        close();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

</script>

<svelte:options runes={true} />

<!--
  The in-game overlay.

  The widget's window covers the display; this is the only thing drawn on it, so
  everything around the card is a scrim over whatever is running. Clicking that
  scrim is "back to the game", which is what every overlay of this kind does.
-->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <section class="card panel" onclick={(e) => e.stopPropagation()}>
    <header>
      <div class="face">
        {#if iconSrc}
          <img src={iconSrc} alt="" draggable="false" use:naturalSize />
        {:else}
          <span class="glyph">▦</span>
        {/if}
      </div>

      <div class="what">
        <h1>{game ? displayName(game) : front ? front.appName || front.title : 'Nothing is running'}</h1>
        <p class="facts">
          {#if game}
            <span>{launcherOf(game).label}</span>
            {#if formatPlaytime(game.minutes)}<span>{formatPlaytime(game.minutes)} played</span>{/if}
          {:else if front}
            <span>Not in the game library</span>
          {:else}
            <span>Pick something to do</span>
          {/if}
        </p>
      </div>

      <div class="right">
        <span class="clock">{clock}</span>
        {#if pad.connected}
          <span class="chip on">Controller</span>
        {:else}
          <span class="chip">Keyboard</span>
        {/if}
      </div>
    </header>

    <ul class="rows">
      {#each rows as row, i (row.id)}
        <li>
          <button class="row" class:selected={i === at} onclick={row.run} onpointerenter={() => (at = i)}>
            <span class="label">{row.label}</span>
            {#if row.hint}<span class="hint">{row.hint}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>

    <footer>
      <span><kbd>{glyphFor(bindings.confirm, layout)}</kbd> Choose</span>
      <span><kbd>{glyphFor(bindings.back, layout)}</kbd> Back to the game</span>
      <span class="note">Rebind this overlay's shortcut in Seelen's settings.</span>
    </footer>
  </section>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    /* The scheme's ground rather than black, so a light theme dims instead of
       blacking out whatever is behind it. */
    background: color-mix(in oklab, var(--panel-ground, #12131a) 58%, transparent);
    backdrop-filter: blur(10px);
    animation: fade 140ms ease both;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  .card {
    width: min(620px, 82vw);
    max-height: 84vh;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 24px;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .face {
    flex: none;
    width: 68px;
    height: 68px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: var(--surface-radius, 14px);
    background: color-mix(in oklab, var(--panel-ground) calc(var(--panel-alpha, 0.72) * 62%), transparent);
    border: var(--panel-border-width, 1px) solid
      color-mix(in oklab, var(--color-gray-300, #666) var(--panel-edge, 34%), transparent);
  }

  /* Never drawn bigger than the file is; see `src/lib/iconsize.ts`. */
  .face img {
    width: min(38px, var(--natural, 38px));
    height: min(38px, var(--natural, 38px));
    object-fit: contain;
  }

  .face .glyph {
    font-size: 24px;
    color: var(--panel-fg-muted);
  }

  .what {
    flex: 1;
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-family: var(--display-font);
    font-size: calc(24px * var(--text-scale, 1));
    font-weight: 600;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 4px 0 0;
    font-size: calc(13px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .right {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .clock {
    font-family: var(--display-font);
    font-size: calc(20px * var(--text-scale, 1));
    font-variant-numeric: tabular-nums;
  }

  .chip {
    padding: 3px 10px;
    font-size: calc(11px * var(--text-scale, 1));
    border-radius: 999px;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .chip.on {
    color: var(--color-green-400, #4ade80);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: baseline;
    gap: 14px;
    padding: 13px 18px;
    cursor: pointer;
    text-align: left;
    border-radius: calc(12px * var(--round, 1));
    background: color-mix(in oklab, var(--panel-ground) calc(var(--panel-alpha, 0.72) * 62%), transparent);
    border: var(--panel-border-width, 1px) solid
      color-mix(in oklab, var(--color-gray-300, #666) var(--panel-edge, 34%), transparent);
    transition:
      background 140ms ease,
      box-shadow 140ms ease;
  }

  /* The same one idea of "the pad is here" the launcher uses: an accent
     outline over a faint wash of it, never a fill. */
  .row.selected {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 22%, transparent);
    box-shadow: 0 0 0 2px var(--accent, #7aa2f7);
  }

  .label {
    flex: 1;
    min-width: 0;
    font-size: calc(16px * var(--text-scale, 1));
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    flex: none;
    max-width: 45%;
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 18px;
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  footer span {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  .note {
    margin-left: auto;
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    padding-inline: 6px;
    font: inherit;
    font-weight: 700;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 34%, transparent);
    border: var(--panel-border-width, 1px) solid
      color-mix(in oklab, var(--color-gray-300, #666) var(--panel-edge, 34%), transparent);
    border-radius: 999px;
  }
</style>
